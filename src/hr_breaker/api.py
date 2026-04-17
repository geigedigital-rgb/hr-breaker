"""
FastAPI backend for HR-Breaker (React frontend).
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import logging
import re
import secrets
import tempfile
import time
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Request, Query, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, Response, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field

from hr_breaker.agents import (
    AnalysisInsights,
    extract_name,
    extract_resume_schema_strict,
    extract_resume_summary,
    get_analysis_insights,
    parse_job_posting,
    score_resume_vs_job,
)
from hr_breaker.config import get_settings
from hr_breaker.filters.keyword_matcher import check_keywords
from hr_breaker.services.pdf_parser import extract_text_from_pdf, extract_text_from_pdf_bytes
import fitz  # pymupdf
from hr_breaker.models import GeneratedPDF, JobPosting, ResumeSource, UnifiedResumeSchema, ValidationResult
from hr_breaker.orchestration import optimize_for_job
from hr_breaker.services import (
    CloudflareBlockedError,
    HTMLRenderer,
    PDFStorage,
    list_templates,
    render_template_html,
    scrape_job_posting,
    wrap_full_html,
)
from hr_breaker.services.job_scraper import extract_company_logo_url
from hr_breaker.services.email_automation_registry import (
    AUTOMATION_DEFINITIONS,
    automation_def_by_id,
    parse_automation_states,
)
from hr_breaker.services.email_winback import public_base_for_email
from hr_breaker.services.auth import (
    create_access_token,
    create_optimize_snapshot_token,
    create_session_draft_token,
    decode_token,
    hash_password,
    verify_password,
)
from hr_breaker.services.usage_audit import log_usage_event
from hr_breaker.utils import extract_text_from_html
from hr_breaker.services.db import (
    get_pool,
    user_create,
    user_get_by_email,
    user_get_by_id,
    user_get_by_google_id,
    user_get_readiness,
    user_get_subscription,
    user_increment_readiness,
    user_record_visit,
    user_update_google_id,
    user_set_stripe_customer_id,
    user_update_subscription,
    user_set_current_period_end,
    user_get_id_by_stripe_customer_id,
    ensure_seed_user,
    user_set_partner_program_access,
    usage_audit_list_admin,
    backfill_user_id,
    user_list_all,
    user_list_paginated,
    usage_audit_list_for_user,
    user_resumes_db_rows,
    user_set_admin_blocked,
    user_delete_by_id,
    referral_attribution_detail_for_invited,
    db_list_all,
    db_recent_resumes_with_user,
    db_get_by_filename,
    user_increment_free_analyses,
    user_increment_free_optimize,
    READINESS_DELTA_ANALYSIS,
    READINESS_DELTA_OPTIMIZE,
    referral_admin_chains,
    referral_admin_events,
    referral_admin_update_commission_status,
    referral_get_or_create_code,
    referral_mark_processed_event,
    referral_partner_commissions,
    referral_partner_summary,
    admin_email_settings_get,
    admin_email_settings_update,
    admin_email_campaign_log_insert,
    email_segment_optimized_unpaid_count,
    email_segment_optimized_unpaid_emails,
    email_winback_pending_count,
    email_winback_delete_all_pending,
    email_winback_pending_list_for_user,
    admin_email_audience_list,
    email_stagger_pending_count,
    email_stagger_due_pending_count,
    email_stagger_delete_all_pending_and_processing,
    optimization_snapshot_get_by_id_for_user,
    optimization_snapshot_get_latest_valid,
    optimization_snapshot_insert,
    optimize_session_draft_delete,
    optimize_session_draft_get,
    optimize_session_draft_upsert,
    user_set_marketing_emails_opt_in,
    uploaded_pdf_upsert,
    uploaded_pdf_get,
    uploaded_pdf_delete,
)
from hr_breaker.services.reviews_repo import (
    reviews_apply_patch,
    reviews_count_email_recent,
    reviews_count_ip_recent,
    reviews_export_csv,
    reviews_insert,
    reviews_list_admin,
    reviews_list_public,
    reviews_stats,
)
from hr_breaker.services.referral_service import (
    COOKIE_DAYS,
    MIN_PAYOUT_CENTS,
    partner_terms,
    process_first_paid_invoice_commission,
    try_apply_referral_after_auth,
)
from hr_breaker.services.resend_send import resend_list_templates

# For SSE progress events
def _put_progress(queue: asyncio.Queue | None, percent: int, message: str) -> None:
    if queue is not None:
        try:
            queue.put_nowait(("progress", percent, message))
        except asyncio.QueueFull:
            pass


def _put_admin_log(queue: asyncio.Queue | None, user: dict | None, entry: dict[str, Any]) -> None:
    """Stream structured pipeline events to admin clients (SSE); no-op if not admin or no queue."""
    if queue is None or not user or not _is_admin_user(user):
        return
    e = {**entry, "ts": datetime.now(timezone.utc).isoformat()}
    if "phase" not in e:
        e["phase"] = "optimize"
    try:
        queue.put_nowait(("admin_log", e))
    except asyncio.QueueFull:
        pass

logger = logging.getLogger(__name__)

FREE_ANALYSES_PER_MONTH = 10

# --------------------------------------------------------------------------
# Simple in-memory TTL cache for LLM results shared between /analyze and /optimize
# --------------------------------------------------------------------------
_PIPELINE_CACHE_TTL = 600  # 10 minutes
_pipeline_cache: dict[str, tuple[Any, float]] = {}


def _cache_key(prefix: str, text: str) -> str:
    return prefix + hashlib.sha256(text.encode()).hexdigest()


def _cache_get(key: str) -> Any | None:
    entry = _pipeline_cache.get(key)
    if entry is None:
        return None
    value, ts = entry
    if time.monotonic() - ts > _PIPELINE_CACHE_TTL:
        _pipeline_cache.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: Any) -> None:
    _pipeline_cache[key] = (value, time.monotonic())
# --------------------------------------------------------------------------
FREE_OPTIMIZE_PER_MONTH = 10
PENDING_EXPORT_TTL_SECONDS = 15 * 60
PENDING_EXPORT_DIRNAME = "pending_optimize_exports"
_SCHEMA_NAME_PLACEHOLDERS = {"candidate", "кандидат"}


def _compose_person_name(first_name: str | None, last_name: str | None) -> str:
    """Build a display name from extracted first/last parts."""
    out = " ".join(p.strip() for p in [first_name or "", last_name or ""] if p and p.strip()).strip()
    return "" if _is_placeholder_person_name(out) else out


def _is_placeholder_person_name(name: str | None) -> bool:
    raw = (name or "").strip().lower()
    if not raw:
        return True
    return raw in _SCHEMA_NAME_PLACEHOLDERS


def _guess_name_from_resume_text(content: str) -> str:
    """Heuristic fallback for name when LLM extractor returns empty/placeholder."""
    lines = [ln.strip() for ln in (content or "").splitlines() if ln.strip()][:8]
    section_like = {
        "summary",
        "experience",
        "education",
        "skills",
        "work experience",
        "profile",
        "контакты",
        "опыт",
        "образование",
        "навыки",
    }
    token_re = r"^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'’.-]*$"
    for line in lines:
        if len(line) > 60:
            continue
        low = line.lower()
        if low in section_like:
            continue
        if any(ch in line for ch in ("@", "http://", "https://", "/", "(", ")", ":", "|")):
            continue
        parts = [p for p in line.split() if p]
        if len(parts) < 2 or len(parts) > 4:
            continue
        if not all(re.match(token_re, p) for p in parts):
            continue
        return line
    return ""


def _split_full_name(full_name: str) -> tuple[str | None, str | None]:
    """Split full name into first/last parts for storage fields."""
    parts = [p.strip() for p in (full_name or "").split() if p.strip()]
    if not parts:
        return None, None
    if len(parts) == 1:
        return parts[0], None
    return parts[0], " ".join(parts[1:])


def _normalized_landing_cors_origins(raw: str) -> list[str]:
    """Parse LANDING_ALLOWED_ORIGINS and ensure both apex and www for pitchcv.app when either is present."""
    parts = [o.strip() for o in (raw or "").split(",") if o.strip()]
    seen: set[str] = set()
    out: list[str] = []
    for o in parts:
        if o not in seen:
            seen.add(o)
            out.append(o)
    apex = "https://pitchcv.app"
    www = "https://www.pitchcv.app"
    if apex in seen and www not in seen:
        out.append(www)
        seen.add(www)
    if www in seen and apex not in seen:
        out.append(apex)
        seen.add(apex)
    return out


def _pending_export_dir() -> Path:
    d = pdf_storage.output_dir / PENDING_EXPORT_DIRNAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def _cleanup_expired_pending_exports() -> None:
    now_ts = time.time()
    base = _pending_export_dir()
    for meta_path in base.glob("*.json"):
        try:
            data = json.loads(meta_path.read_text(encoding="utf-8"))
            created_at = float(data.get("created_at") or 0.0)
            if created_at and now_ts - created_at <= PENDING_EXPORT_TTL_SECONDS:
                continue
        except Exception:
            pass
        token = meta_path.stem
        pdf_path = base / f"{token}.pdf"
        try:
            meta_path.unlink(missing_ok=True)
        except Exception:
            pass
        try:
            pdf_path.unlink(missing_ok=True)
        except Exception:
            pass


def _save_pending_export(*, user_id: str, pdf_bytes: bytes, filename: str, meta: dict[str, Any]) -> tuple[str, float]:
    _cleanup_expired_pending_exports()
    token = secrets.token_urlsafe(24)
    base = _pending_export_dir()
    created_at = time.time()
    expires_at = created_at + PENDING_EXPORT_TTL_SECONDS
    (base / f"{token}.pdf").write_bytes(pdf_bytes)
    payload = {
        "created_at": created_at,
        "expires_at": expires_at,
        "user_id": user_id,
        "filename": filename,
        **(meta or {}),
    }
    (base / f"{token}.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return token, expires_at


def _read_pending_export(token: str) -> dict[str, Any] | None:
    _cleanup_expired_pending_exports()
    safe = (token or "").strip()
    if not safe or "/" in safe or "\\" in safe:
        return None
    base = _pending_export_dir()
    meta_path = base / f"{safe}.json"
    pdf_path = base / f"{safe}.pdf"
    if not meta_path.is_file() or not pdf_path.is_file():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    created_at = float(meta.get("created_at") or 0.0)
    if created_at and time.time() - created_at > PENDING_EXPORT_TTL_SECONDS:
        try:
            meta_path.unlink(missing_ok=True)
        except Exception:
            pass
        try:
            pdf_path.unlink(missing_ok=True)
        except Exception:
            pass
        return None
    return {"token": safe, "meta": meta, "pdf_path": pdf_path, "meta_path": meta_path}


# CORS: app frontend + landing (pitchcv.app + www — distinct origins in browsers)
_settings_cors = get_settings()
_cors_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
if (_settings_cors.landing_allowed_origins or "").strip():
    _cors_origins = _cors_origins + _normalized_landing_cors_origins(_settings_cors.landing_allowed_origins)

app = FastAPI(title="HR-Breaker API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

router = APIRouter(prefix="/api", tags=["api"])
pdf_storage = PDFStorage()

# User-facing message when Google returns "API key not valid"
_API_KEY_INVALID_MSG = (
    "API key not valid. Get a key from https://aistudio.google.com/apikey (not from GCP Console). "
    "In .env use one line: GOOGLE_API_KEY=AIza... with no quotes or spaces."
)


def _is_api_key_invalid(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return "api key not valid" in msg or "api_key_invalid" in msg


def _sanitize_url(url: str) -> str:
    """Remove newlines and trim; add https:// if no scheme (e.g. stepstone.de/... -> https://stepstone.de/...)."""
    if not url:
        return url
    u = url.strip().replace("\n", "").replace("\r", "").strip()
    if u and not (u.startswith("http://") or u.startswith("https://")):
        u = "https://" + u
    return u


def _client_ip(request: Request) -> str | None:
    xff = (request.headers.get("x-forwarded-for") or "").strip()
    if xff:
        return xff.split(",")[0].strip() or None
    if request.client:
        return request.client.host
    return None


def _parse_review_date_query(value: str | None, *, end_of_day: bool = False) -> datetime | None:
    """Interpret YYYY-MM-DD as UTC day boundary for admin filters."""
    if not value or not str(value).strip():
        return None
    s = str(value).strip()
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        d = date.fromisoformat(s)
        if end_of_day:
            return datetime(d.year, d.month, d.day, 23, 59, 59, 999999, tzinfo=timezone.utc)
        return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _admin_emails_set() -> set[str]:
    s = get_settings()
    emails = {(s.admin_email or "").strip().lower()}
    extra = (s.admin_emails or "").strip()
    if extra:
        emails |= {x.strip().lower() for x in extra.split(",") if x.strip()}
    return {e for e in emails if e}


def _is_job_list_url(url: str) -> bool:
    """True if URL is a job search/list page, not a single job posting (e.g. Indeed search results)."""
    from urllib.parse import urlparse
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    path = (parsed.path or "").lower()
    if "indeed.com" in host:
        # Single job: /viewjob?jk=... or /rc/clk?jk=...; list: /q-..., /jobs, /jobsearch
        if "/viewjob" in path or "jk=" in (parsed.query or ""):
            return False
        if "/q-" in path or path.endswith("/jobs") or "/jobs.html" in path or "/jobsearch" in path:
            return True
    return False


# --- Request/Response schemas ---


class ExtractNameRequest(BaseModel):
    content: str


class ExtractNameResponse(BaseModel):
    first_name: str | None
    last_name: str | None


class ExtractResumeSummaryRequest(BaseModel):
    content: str


class ExtractResumeSummaryResponse(BaseModel):
    full_name: str | None
    specialty: str | None
    skills: str | None


class ParsePdfResponse(BaseModel):
    content: str


class JobParseRequest(BaseModel):
    url: str | None = None
    text: str | None = None


class OptimizeRequest(BaseModel):
    resume_content: str
    job_text: str | None = None
    job_url: str | None = None
    improve_mode: bool = False  # True = general resume improvement (no job matching)
    max_iterations: int | None = None
    parallel: bool = True
    aggressive_tailoring: bool = False  # True = add skills from job (with user warning)
    pre_ats_score: int | None = None  # from /analyze, for history
    pre_keyword_score: float | None = None  # from /analyze, for history
    source_was_pdf: bool = False  # True when user uploaded original as PDF (for Home filter + thumbnail)
    output_language: str | None = None  # e.g. "en", "ru". Default: English for all LLM output
    # Client session (stored in optimization_snapshots JSON for email / ?resume= restore; not used by optimizer)
    session_template_id: str | None = Field(None, max_length=200)
    session_photo_data_url: str | None = Field(None, max_length=900_000)
    session_analyze: dict[str, Any] | None = None  # AnalyzeResponse-shaped JSON from client


class AnalyzeRequest(BaseModel):
    resume_content: str
    job_text: str | None = None
    job_url: str | None = None
    improve_mode: bool = False  # True = general resume improvement (no job matching)
    output_language: str | None = None  # e.g. "en", "ru". Default: English
    session_template_id: str | None = Field(None, max_length=200)


class RecommendationItem(BaseModel):
    category: str
    labels: list[str]


class CallbackBlockerOut(BaseModel):
    """LLM-structured reasons for weak callback likelihood (1-2 items)."""

    headline: str
    impact: str
    action: str


class AnalyzeResponse(BaseModel):
    ats_score: int  # 0-100
    keyword_score: float
    keyword_threshold: float
    job: JobPostingOut | None = None  # parsed job for preview when job_url was used
    recommendations: list[RecommendationItem] = Field(default_factory=list)
    # LLM-provided rejection risk 0-100 and top critical reasons
    rejection_risk_score: int | None = None
    critical_issues: list[str] = Field(default_factory=list)
    callback_blockers: list[CallbackBlockerOut] = Field(default_factory=list)
    risk_summary: str | None = None
    improvement_tips: str | None = None  # LLM-generated tips with headers for "recommendations" block
    # Admin-only: ordered pipeline steps (scraping, parsing, scoring, LLM); omitted for non-admins
    admin_pipeline_log: list[dict[str, Any]] | None = None
    # JWT (purpose session_draft) for /optimize?resume= after server persisted analyze; null without DB / guest.
    resume_session_token: str | None = None


class FilterResultOut(BaseModel):
    filter_name: str
    passed: bool
    score: float
    threshold: float
    issues: list[str]
    suggestions: list[str]


class ValidationResultOut(BaseModel):
    passed: bool
    results: list[FilterResultOut]


class JobPostingOut(BaseModel):
    title: str
    company: str
    requirements: list[str]
    keywords: list[str]
    description: str


class ChangeDetailOut(BaseModel):
    category: str
    description: str | None = None
    items: list[str]


class OptimizeResponse(BaseModel):
    success: bool
    pdf_base64: str | None = None
    pdf_filename: str | None = None
    pending_export_token: str | None = None
    pending_export_expires_at: str | None = None
    validation: ValidationResultOut
    job: JobPostingOut
    key_changes: list[ChangeDetailOut] | None = None
    error: str | None = None
    optimized_resume_text: str | None = None  # for "improve more" — next round uses this as resume_content
    schema_json: str | None = None
    # Saved result summary (TTL); link opens read-only snapshot without login.
    snapshot_url: str | None = None
    snapshot_expires_at: str | None = None


class OptimizationSnapshotPublicOut(BaseModel):
    """Saved optimization result (JWT). Public GET or authenticated for-me."""

    expires_at: str
    pdf_filename: str | None = None
    pdf_download_available: bool = False
    job: JobPostingOut
    validation: ValidationResultOut
    key_changes: list[ChangeDetailOut] | None = None
    schema_json: str | None = None
    pre_ats_score: int | None = None
    pre_keyword_score: float | None = None
    post_ats_score: int | None = None
    post_keyword_score: float | None = None
    pending_export_token: str | None = None
    job_url: str | None = None
    optimized_resume_text: str | None = None
    selected_template_id: str | None = None
    photo_data_url: str | None = None
    pre_analyze: AnalyzeResponse | None = None
    snapshot_source_was_pdf: bool | None = None


class SessionDraftRestoreOut(BaseModel):
    """Persisted in-progress session (stages 1–2) for /optimize?resume= JWT purpose session_draft."""

    expires_at: str
    stage: int
    resume_content: str
    job_url: str | None = None
    job: JobPostingOut
    analyze: AnalyzeResponse | None = None
    selected_template_id: str | None = None


class OptimizationResumeRestoreOut(BaseModel):
    """Authenticated /optimization-snapshot/for-me: completed snapshot or mid-flow draft."""

    kind: Literal["complete", "draft"]
    complete: OptimizationSnapshotPublicOut | None = None
    draft: SessionDraftRestoreOut | None = None


class HistoryItem(BaseModel):
    filename: str
    company: str
    job_title: str
    timestamp: str
    first_name: str | None
    last_name: str | None
    pre_ats_score: int | None = None
    post_ats_score: int | None = None
    pre_keyword_score: float | None = None
    post_keyword_score: float | None = None
    company_logo_url: str | None = None
    job_url: str | None = None
    source_checksum: str = ""
    source_was_pdf: bool = False


class HistoryResponse(BaseModel):
    items: list[HistoryItem]


ReviewStatusLiteral = Literal["pending", "approved", "rejected", "hidden"]


class ReviewCreateIn(BaseModel):
    author_name: str = Field(..., min_length=1, max_length=200)
    author_email: str = Field(..., min_length=3, max_length=320)
    rating: int = Field(..., ge=1, le=5)
    would_recommend: Literal["yes", "no"]
    title: str = Field(..., min_length=1, max_length=300)
    body: str = Field(..., min_length=1, max_length=20000)
    author_role: str | None = Field(None, max_length=200)
    country: str | None = Field(None, max_length=120)
    feature_tag: str | None = Field(None, max_length=80)
    consent_to_publish: bool
    consent_to_process: bool
    fax_extension: str | None = Field(None, max_length=200)


class ReviewPublicItem(BaseModel):
    id: str
    author_name: str
    rating: int
    title: str
    body: str
    published_at: str | None = None
    verified: bool
    source: str
    feature_tag: str | None = None


class ReviewPublicListOut(BaseModel):
    items: list[ReviewPublicItem]


class ReviewStatsOut(BaseModel):
    average_rating: float
    review_count: int
    recommend_percent: float | None = None


class ReviewPatchIn(BaseModel):
    status: ReviewStatusLiteral | None = None
    verified: bool | None = None
    pinned: bool | None = None
    title: str | None = Field(None, min_length=1, max_length=300)
    body: str | None = Field(None, min_length=1, max_length=20000)
    admin_notes: str | None = Field(None, max_length=8000)


class ReviewsAdminListOut(BaseModel):
    items: list[dict[str, Any]]
    total: int


# --- Auth ---
_http_bearer = HTTPBearer(auto_error=False)


class LoginRequest(BaseModel):
    email: str
    password: str
    referral_code: str | None = None
    referral_source_url: str | None = None


class ReadinessOut(BaseModel):
    """Market Readiness: status indicator (not gamification)."""
    score: int
    stage: str
    progress_to_next: float
    streak_days: int


class SubscriptionOut(BaseModel):
    plan: str  # free | trial | monthly
    status: str  # free | trial | active | canceled
    current_period_end: str | None = None
    free_analyses_count: int = 0
    free_optimize_count: int = 0


class AuthUserOut(BaseModel):
    id: str
    email: str
    name: str | None
    readiness: ReadinessOut | None = None
    subscription: SubscriptionOut | None = None
    partner_program_access: bool = False


class LoginResponse(BaseModel):
    access_token: str
    user: AuthUserOut


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_http_bearer),
) -> dict | None:
    """Return current user from JWT when DB is used (header or query param ?token=); else None (no auth)."""
    pool = await get_pool()
    if pool is None:
        return None
    settings = get_settings()
    if not settings.jwt_secret:
        return None
    token_query = request.query_params.get("token") if request else None
    token = (credentials and credentials.credentials) or token_query
    if not token:
        raise HTTPException(401, "Not authenticated")
    payload = decode_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(401, "Invalid or expired token")
    try:
        user = await user_get_by_id(pool, payload["sub"])
    except (TimeoutError, OSError, asyncio.TimeoutError) as e:
        logger.warning("get_current_user: DB unavailable (%s): %s", type(e).__name__, e)
        raise HTTPException(
            503,
            "Database unavailable. Check DATABASE_URL, VPN, or network — then retry.",
        ) from e
    except Exception as e:
        if type(e).__module__.startswith("asyncpg"):
            logger.warning("get_current_user: asyncpg error: %s", e)
            raise HTTPException(
                503,
                "Database unavailable. Check DATABASE_URL, VPN, or network — then retry.",
            ) from e
        raise
    if not user:
        raise HTTPException(401, "User not found")
    if user.get("admin_blocked"):
        raise HTTPException(403, "Account disabled")
    return user


async def get_optional_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_http_bearer),
) -> dict | None:
    """Return current user if valid token present; else None (no 401). For endpoints that work with or without auth."""
    pool = await get_pool()
    if pool is None:
        return None
    settings = get_settings()
    if not settings.jwt_secret:
        return None
    token_query = request.query_params.get("token") if request else None
    token = (credentials and credentials.credentials) or token_query
    if not token:
        return None
    payload = decode_token(token)
    if not payload or "sub" not in payload:
        return None
    try:
        user = await user_get_by_id(pool, payload["sub"])
    except (TimeoutError, OSError, asyncio.TimeoutError) as e:
        logger.debug("get_optional_user: DB skip (%s)", type(e).__name__)
        return None
    except Exception as e:
        if type(e).__module__.startswith("asyncpg"):
            logger.debug("get_optional_user: asyncpg skip: %s", e)
            return None
        raise
    if user and user.get("admin_blocked"):
        raise HTTPException(403, "Account disabled")
    return user


def _is_admin_user(user: dict | None) -> bool:
    """True if user email is in ADMIN_EMAIL / ADMIN_EMAILS (always gets full plan)."""
    if not user or not user.get("email"):
        return False
    return (user.get("email") or "").strip().lower() in _admin_emails_set()


def _partner_enabled() -> bool:
    return bool(get_settings().partner_program_enabled)


def _partner_user_allowed(user: dict) -> bool:
    """User-facing partner cabinet (referral link, commissions) — only if admin enabled flag."""
    return bool(user.get("partner_program_access"))


def _synthetic_admin_user_from_jwt(payload: dict[str, Any]) -> dict:
    """Minimal user row when DB is down but JWT carries admin email (same secret as login)."""
    return {
        "id": str(payload["sub"]),
        "email": payload.get("email") or "",
        "admin_blocked": False,
    }


async def get_admin_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_http_bearer),
) -> dict:
    """Require valid JWT and admin email. If Postgres is unreachable, allow admin JWT claims only."""
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured. Set DATABASE_URL in .env")
    settings = get_settings()
    if not settings.jwt_secret:
        raise HTTPException(401, "Not authenticated")
    token_query = request.query_params.get("token") if request else None
    token = (credentials and credentials.credentials) or token_query
    if not token:
        raise HTTPException(401, "Not authenticated")
    payload = decode_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(401, "Invalid or expired token")

    email_from_jwt = (payload.get("email") or "").strip().lower()
    admin_emails = _admin_emails_set()
    jwt_is_configured_admin = bool(email_from_jwt and email_from_jwt in admin_emails)

    try:
        user = await user_get_by_id(pool, str(payload["sub"]))
    except (TimeoutError, OSError, asyncio.TimeoutError) as e:
        logger.warning("get_admin_user: DB unavailable (%s): %s", type(e).__name__, e)
        if jwt_is_configured_admin:
            return _synthetic_admin_user_from_jwt(payload)
        raise HTTPException(
            503,
            "Database unavailable. Check DATABASE_URL, VPN, or network — then retry.",
        ) from e
    except Exception as e:
        if type(e).__module__.startswith("asyncpg"):
            logger.warning("get_admin_user: asyncpg error: %s", e)
            if jwt_is_configured_admin:
                return _synthetic_admin_user_from_jwt(payload)
            raise HTTPException(
                503,
                "Database unavailable. Check DATABASE_URL, VPN, or network — then retry.",
            ) from e
        raise

    if user:
        if user.get("admin_blocked"):
            raise HTTPException(403, "Account disabled")
        if not _is_admin_user(user):
            raise HTTPException(403, "Admin access required")
        return user

    if jwt_is_configured_admin:
        return _synthetic_admin_user_from_jwt(payload)
    raise HTTPException(401, "User not found")


_FUNNEL_ANALYSIS_ACTIONS = frozenset({
    "analyze_ats_score",
    "analyze_insights",
    "job_parse",
    "extract_name",
})


def _reject_if_protected_admin_target(user: dict) -> None:
    """Block destructive edits on accounts that match ADMIN_EMAIL(S)."""
    if _is_admin_user(user):
        raise HTTPException(400, "Action not allowed on admin accounts")


async def _admin_build_user_detail(pool, user_id: str) -> AdminUserDetailResponse | None:
    user = await user_get_by_id(pool, user_id)
    if not user:
        return None
    uid = str(user["id"])
    audits = await usage_audit_list_for_user(pool, uid, limit=200)
    resumes = await user_resumes_db_rows(pool, uid, limit=150)
    att = await referral_attribution_detail_for_invited(pool, uid)
    sub = await user_get_subscription(pool, uid)
    readiness_raw = await user_get_readiness(pool, uid)
    readiness = ReadinessOut(**readiness_raw) if readiness_raw else None

    has_analyzed = any(
        a.get("action") in _FUNNEL_ANALYSIS_ACTIONS and a.get("success") for a in audits
    )
    has_pdf = len(resumes) > 0
    plan = (sub.get("plan") or "free").lower()
    status_eff = (sub.get("status") or "free").lower()
    has_paid = plan in ("trial", "monthly") and status_eff in ("trial", "active")

    stages = [
        AdminFunnelStageOut(id="registered", label="Registered", done=True),
        AdminFunnelStageOut(id="analyzed", label="Ran resume vs job analysis", done=has_analyzed),
        AdminFunnelStageOut(id="tailored", label="Generated tailored resume (PDF)", done=has_pdf),
        AdminFunnelStageOut(id="subscribed", label="Active trial or paid plan", done=has_paid),
    ]
    stopped = next((s for s in stages if not s.done), None)
    current_summary = stopped.label if stopped else "Completed all tracked funnel steps"

    journey: list[AdminJourneyEntryOut] = []
    created = user.get("created_at")
    if created:
        journey.append(AdminJourneyEntryOut(
            kind="account",
            at=created.isoformat() if hasattr(created, "isoformat") else str(created),
            title="Account created",
            detail=str(user.get("email") or ""),
        ))
    if att and att.get("first_seen_at"):
        fs = att["first_seen_at"]
        ref_parts = [f"code: {att.get('code') or '—'}"]
        if att.get("referrer_email"):
            ref_parts.append(f"referrer: {att['referrer_email']}")
        if att.get("source_url"):
            ref_parts.append(f"landing: {att['source_url']}")
        journey.append(AdminJourneyEntryOut(
            kind="referral",
            at=fs.isoformat() if hasattr(fs, "isoformat") else str(fs),
            title="Referral / acquisition",
            detail="; ".join(ref_parts),
        ))
    for r in resumes:
        cr = r.get("created_at")
        fname = r.get("filename") or ""
        pre_s = r.get("pre_ats_score")
        post_s = r.get("post_ats_score")
        cs = (r.get("source_checksum") or "").strip()
        src_path = pdf_storage.get_source_path(cs) if cs else None
        has_src = bool(src_path and src_path.is_file())
        extra: list[str] = []
        if pre_s is not None or post_s is not None:
            extra.append(f"ATS {pre_s if pre_s is not None else '—'}→{post_s if post_s is not None else '—'}")
        ju = (r.get("job_url") or "").strip()
        if ju:
            extra.append(ju if len(ju) <= 96 else f"{ju[:93]}…")
        detail_resume = fname
        if extra:
            detail_resume = f"{fname} · " + " · ".join(extra) if fname else " · ".join(extra)
        pdf_fn = fname if fname.lower().endswith(".pdf") else None
        journey.append(AdminJourneyEntryOut(
            kind="resume",
            at=cr.isoformat() if cr and hasattr(cr, "isoformat") else "",
            title=f'PDF resume: {(r.get("company") or "—")} / {(r.get("job_title") or "—")}',
            detail=detail_resume or fname or None,
            pdf_filename=pdf_fn,
            has_stored_source=has_src if pdf_fn else None,
        ))
    for a in audits:
        ts = a.get("created_at")
        err = (a.get("error_message") or "").strip()
        meta = a.get("metadata") or {}
        meta_line: str | None = None
        if isinstance(meta, dict) and meta and not err:
            bits: list[str] = []
            if "has_pdf" in meta:
                bits.append("pdf" if meta.get("has_pdf") else "no_pdf")
            if "validation_passed" in meta:
                bits.append("ok" if meta.get("validation_passed") else "val_fail")
            if bits:
                meta_line = ", ".join(bits)
        detail_audit: str | None
        if err:
            detail_audit = err[:400]
        elif meta_line:
            detail_audit = meta_line
        else:
            detail_audit = None
        tin = a.get("input_tokens")
        tout = a.get("output_tokens")
        journey.append(AdminJourneyEntryOut(
            kind="audit",
            at=ts.isoformat() if ts and hasattr(ts, "isoformat") else "",
            title=str(a.get("action") or "event"),
            detail=detail_audit,
            action=str(a.get("action") or ""),
            success=bool(a.get("success")) if a.get("success") is not None else None,
            model=(str(m).strip() if (m := a.get("model")) else None) or None,
            input_tokens=int(tin) if tin is not None else None,
            output_tokens=int(tout) if tout is not None else None,
        ))

    journey.sort(key=lambda x: x.at or "", reverse=True)

    referral_out = None
    if att:
        fst = att.get("first_seen_at")
        referral_out = AdminUserReferralOut(
            code=str(att.get("code") or ""),
            referrer_email=att.get("referrer_email"),
            source_url=att.get("source_url"),
            first_seen_at=fst.isoformat() if fst and hasattr(fst, "isoformat") else "",
            status=str(att.get("status") or ""),
        )

    created_at_str = created.isoformat() if created and hasattr(created, "isoformat") else ""

    return AdminUserDetailResponse(
        id=uid,
        email=str(user.get("email") or ""),
        name=user.get("name"),
        created_at=created_at_str,
        admin_blocked=bool(user.get("admin_blocked")),
        has_google=bool(user.get("google_id")),
        has_password=bool(user.get("password_hash")),
        partner_program_access=bool(user.get("partner_program_access")),
        subscription=SubscriptionOut(
            plan=sub.get("plan", "free"),
            status=sub.get("status", "free"),
            current_period_end=sub.get("current_period_end"),
            free_analyses_count=int(sub.get("free_analyses_count") or 0),
            free_optimize_count=int(sub.get("free_optimize_count") or 0),
        ),
        readiness=readiness,
        referral=referral_out,
        stages=stages,
        current_stage_summary=current_summary,
        resume_count=len(resumes),
        journey=journey,
    )


def _user_out(u: dict, subscription: dict | None = None) -> AuthUserOut:
    out = AuthUserOut(
        id=str(u["id"]),
        email=u["email"],
        name=u.get("name"),
        partner_program_access=bool(u.get("partner_program_access")),
    )
    if subscription is not None:
        # Admin always gets full plan for UI and limits
        if _is_admin_user(u):
            subscription = {
                "plan": "monthly",
                "status": "active",
                "current_period_end": None,
                "free_analyses_count": 0,
                "free_optimize_count": 0,
            }
        out.subscription = SubscriptionOut(
            plan=subscription.get("plan", "free"),
            status=subscription.get("status", "free"),
            current_period_end=subscription.get("current_period_end"),
            free_analyses_count=subscription.get("free_analyses_count", 0),
            free_optimize_count=int(subscription.get("free_optimize_count") or 0),
        )
    return out


class SettingsResponse(BaseModel):
    has_api_key: bool
    max_iterations: int
    output_dir: str


class HealthResponse(BaseModel):
    database: str  # "connected" | "disabled" | "error"
    detail: str | None = None


class AdminStatsResponse(BaseModel):
    users_count: int
    resumes_count: int
    database: str  # "connected" | "disabled" | "error"


class AdminUserOut(BaseModel):
    id: str
    email: str
    name: str | None
    created_at: str
    subscription_status: str | None = None
    subscription_plan: str | None = None
    stripe_subscription_id: str | None = None
    partner_program_access: bool = False
    admin_blocked: bool = False


class AdminUsersResponse(BaseModel):
    items: list[AdminUserOut]
    total: int


class AdminJourneyEntryOut(BaseModel):
    kind: str
    at: str
    title: str
    detail: str | None = None
    action: str | None = None
    success: bool | None = None
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    pdf_filename: str | None = Field(None, description="When kind is resume: PDF basename for admin open.")
    has_stored_source: bool | None = Field(None, description="When kind is resume: stored source .txt on disk.")


class AdminFunnelStageOut(BaseModel):
    id: str
    label: str
    done: bool


class AdminUserReferralOut(BaseModel):
    code: str
    referrer_email: str | None = None
    source_url: str | None = None
    first_seen_at: str
    status: str


class AdminUserDetailResponse(BaseModel):
    id: str
    email: str
    name: str | None
    created_at: str
    admin_blocked: bool
    has_google: bool
    has_password: bool
    partner_program_access: bool
    subscription: SubscriptionOut
    readiness: ReadinessOut | None = None
    referral: AdminUserReferralOut | None = None
    stages: list[AdminFunnelStageOut]
    current_stage_summary: str
    resume_count: int
    journey: list[AdminJourneyEntryOut]


class AdminUserBlockedBody(BaseModel):
    admin_blocked: bool


class AdminUserSubscriptionPatchBody(BaseModel):
    subscription_status: str | None = None
    subscription_plan: str | None = None
    current_period_end: datetime | None = None


class AdminConfigResponse(BaseModel):
    """Read-only config for admin (no secrets)."""
    database_configured: bool
    jwt_configured: bool
    google_oauth_configured: bool
    stripe_configured: bool
    landing_origins_count: int
    landing_rate_limit_hours: int
    landing_pending_ttl_seconds: int
    max_iterations: int
    frontend_url: str
    # Raw EMAIL_PUBLIC_BASE_URL; empty if unset (see email_effective_public_base).
    email_public_base_url: str
    # Origin for CTA/logo/unsubscribe: email_public_base_url or frontend_url.
    email_effective_public_base: str
    adzuna_configured: bool
    partner_program_enabled: bool


class AdminEmailControlOut(BaseModel):
    winback_auto_enabled: bool
    winback_delay_min_minutes: int
    winback_delay_max_minutes: int
    resend_configured: bool
    resend_from_configured: bool
    pending_queue_count: int
    # If true, Resend published template id is set for that app template (send uses template + variables).
    resend_template_reminder_configured: bool
    resend_template_short_nudge_configured: bool
    # Stored in Postgres (admin); optional env RESEND_TEMPLATE_* still works as fallback.
    resend_template_reminder_no_download: str = ""
    resend_template_short_nudge: str = ""


class AdminEmailControlPatchBody(BaseModel):
    winback_auto_enabled: bool | None = None
    winback_delay_min_minutes: int | None = Field(None, ge=5, le=120)
    winback_delay_max_minutes: int | None = Field(None, ge=5, le=180)
    resend_template_reminder_no_download: str | None = Field(None, max_length=200)
    resend_template_short_nudge: str | None = Field(None, max_length=200)


class AdminEmailSegmentPreviewBody(BaseModel):
    segment_id: str = Field(..., description="e.g. optimized_unpaid_recent")
    days: int = Field(30, ge=1, le=365)
    sample_limit: int = Field(15, ge=1, le=50)


class AdminEmailSegmentPreviewOut(BaseModel):
    segment_id: str
    days: int
    recipients_count: int
    sample_emails: list[str]


class AdminEmailSegmentSendBody(BaseModel):
    segment_id: str
    template_id: str = "reminder-no-download"
    dry_run: bool = True
    days: int = Field(30, ge=1, le=365)
    limit: int = Field(15, ge=1, le=100)


class AdminEmailSegmentSendOut(BaseModel):
    segment_id: str
    template_id: str
    dry_run: bool
    attempted: int
    sent: int
    failed: int
    errors_sample: list[str]


class AdminResendTemplateItem(BaseModel):
    id: str
    name: str


class AdminEmailSendOneBody(BaseModel):
    email: str
    resend_template_id: str = Field(..., min_length=2, max_length=200)


class AdminEmailSendOneOut(BaseModel):
    ok: bool
    email: str
    resend_template_id: str
    error: str | None = None


class AdminEmailCtaInfoOut(BaseModel):
    """What DOWNLOAD_URL (etc.) will resolve to for win-back / Quick send."""
    email: str
    user_found: bool
    has_valid_snapshot: bool
    snapshot_expires_at: str | None = None
    has_saved_pdf: bool = False


class AdminWinbackPendingItemOut(BaseModel):
    id: str
    run_at: str
    template_id: str
    status: str


class AdminOptimizeDraftSummaryOut(BaseModel):
    stage: int | None = None
    expires_at: str | None = None
    updated_at: str | None = None


class AdminOptimizeSnapshotSummaryOut(BaseModel):
    has_valid: bool
    expires_at: str | None = None
    stage: int | None = None
    created_at: str | None = None


class AdminUserJourneyOut(BaseModel):
    """Admin: optimize funnel + queue for one account (inspect duplicates / stages)."""
    email: str
    user_found: bool
    user_id: str | None = None
    marketing_emails_opt_in: bool | None = None
    subscription_plan: str | None = None
    subscription_status: str | None = None
    admin_blocked: bool | None = None
    optimize_draft: AdminOptimizeDraftSummaryOut | None = None
    optimize_snapshot: AdminOptimizeSnapshotSummaryOut
    winback_pending: list[AdminWinbackPendingItemOut] = Field(default_factory=list)


class AdminEmailAutomationItemOut(BaseModel):
    id: str
    name: str
    description: str
    channel: str
    dedupe_summary: str
    conditions_code: str
    wired: bool
    enabled: bool
    paused: bool
    pending_queue_count: int | None = None
    pending_due_count: int | None = None
    supports_enable_toggle: bool = False
    supports_pause: bool = False
    supports_clear_queue: bool = False


class AdminEmailAutomationsListOut(BaseModel):
    items: list[AdminEmailAutomationItemOut]
    global_pending_queue_count: int


class AdminEmailAutomationPatchBody(BaseModel):
    enabled: bool | None = None
    paused: bool | None = None


class AdminEmailClearQueueOut(BaseModel):
    deleted: int


class AdminEmailAudienceUserOut(BaseModel):
    id: str
    email: str | None = None
    name: str | None = None
    created_at: str
    marketing_emails_opt_in: bool | None = None
    has_analyzed: bool
    has_optimized: bool
    winback_sent: int = 0
    winback_last_sent: str | None = None
    stagger_sent_count: int = 0
    stagger_campaign_kinds: str | None = None


class AdminEmailAudienceResponse(BaseModel):
    items: list[AdminEmailAudienceUserOut]
    total: int


class AdminEmailStaggerPreviewOut(BaseModel):
    campaign_kind: str
    eligible_count: int
    sample_user_ids: list[str] = Field(default_factory=list)
    sample_emails: list[str] = Field(default_factory=list)
    has_active_queue_for_kind: bool
    pending_count: int


class AdminEmailStaggerSnapshotBody(BaseModel):
    template_id: str = Field(..., min_length=1, max_length=200)


class AdminEmailStaggerSnapshotOut(BaseModel):
    run_id: str | None = None
    enqueued: int
    campaign_kind: str
    template_id: str
    first_run_at: str | None = None
    last_run_at: str | None = None


class AdminEmailStaggerProcessOut(BaseModel):
    ok: bool
    processed: bool = False
    paused: bool = False
    message: str | None = None
    error: str | None = None
    recipient_id: str | None = None
    result: str | None = None
    detail: str | None = None
    email: str | None = None


class AdminActivityItem(BaseModel):
    filename: str
    company: str
    job_title: str
    created_at: str
    user_email: str | None = None
    pdf_on_disk: bool = True
    # uploaded = user upload (filename uploaded_*); generated = tailored PDF
    file_kind: str = "generated"
    source_was_pdf: bool = False
    has_stored_source: bool = False


class AdminActivityResponse(BaseModel):
    items: list[AdminActivityItem]
    total: int


class AdminUsageAuditItem(BaseModel):
    id: str
    user_email: str | None = None
    action: str
    model: str | None = None
    success: bool
    error_message: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    metadata: dict = Field(default_factory=dict)
    created_at: str


class AdminUsageAuditResponse(BaseModel):
    items: list[AdminUsageAuditItem]


class AdminPartnerAccessBody(BaseModel):
    partner_program_access: bool


class PartnerCommissionItem(BaseModel):
    invited_email: str | None = None
    amount_cents: int
    currency: str
    status: str
    created_at: str
    reason: str | None = None


class PartnerMeResponse(BaseModel):
    referral_link: str
    payout_threshold_cents: int
    eligible_cents: int
    paid_cents: int
    eligible_count: int
    pending_count: int
    paid_count: int
    rejected_count: int
    items: list[PartnerCommissionItem]


class PartnerLinkResponse(BaseModel):
    referral_link: str
    code: str


class PartnerTermsResponse(BaseModel):
    items: list[str]


class AdminReferralChainItem(BaseModel):
    id: str
    first_seen_at: str
    expires_at: str
    attribution_status: str
    attribution_reason: str | None = None
    code: str
    referrer_email: str | None = None
    invited_email: str | None = None
    commission_id: str | None = None
    amount_cents: int | None = None
    currency: str | None = None
    commission_status: str | None = None
    commission_reason: str | None = None


class AdminReferralChainsResponse(BaseModel):
    items: list[AdminReferralChainItem]


class AdminReferralEventItem(BaseModel):
    id: str
    event_type: str
    stripe_event_id: str | None = None
    user_email: str | None = None
    referrer_email: str | None = None
    invited_email: str | None = None
    metadata: dict = Field(default_factory=dict)
    created_at: str


class AdminReferralEventsResponse(BaseModel):
    items: list[AdminReferralEventItem]


class AdminReferralActionRequest(BaseModel):
    commission_id: str
    reason: str | None = None


class VacancyCard(BaseModel):
    """Unified vacancy card for search results (Adzuna etc.)."""
    id: str
    title: str
    company: str
    location: str | None = None
    salary_min: int | None = None
    salary_max: int | None = None
    salary_text: str | None = None
    contract_type: str | None = None
    posted_at: str | None = None
    snippet: str | None = None
    url: str
    source: str = "adzuna"


class VacancySearchResponse(BaseModel):
    items: list[VacancyCard]
    total: int
    page: int
    page_size: int


class AdminResumeSchemaExtractRequest(BaseModel):
    resume_content: str
    target_role: str | None = None
    target_locale: str | None = None


class AdminTemplateListItem(BaseModel):
    id: str
    name: str
    source: str
    supports_photo: bool
    supports_columns: bool
    pdf_stability_score: float
    default_css_vars: dict[str, str]
    recommended: bool


class AdminTemplateListResponse(BaseModel):
    items: list[AdminTemplateListItem]


class AdminTemplateRenderRequest(BaseModel):
    """JSON body uses key \"schema\" (JSON Resume data); Python field is resume_schema to avoid BaseModel.schema shadowing."""

    model_config = ConfigDict(populate_by_name=True)

    template_id: str
    resume_schema: UnifiedResumeSchema = Field(alias="schema")


class AdminTemplateRenderHtmlResponse(BaseModel):
    html_body: str
    full_html: str


class AdminTemplateRenderPdfResponse(BaseModel):
    pdf_base64: str
    page_count: int
    warnings: list[str] = Field(default_factory=list)


# --- Auth endpoints ---

@router.post("/auth/register", response_model=LoginResponse)
async def api_register(req: LoginRequest) -> LoginResponse:
    """Register with email and password."""
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured. Set DATABASE_URL in .env")
    existing = await user_get_by_email(pool, req.email)
    if existing:
        raise HTTPException(400, "Email already registered")
    pass_hash = hash_password(req.password)
    user = await user_create(pool, req.email, password_hash=pass_hash)
    if _partner_enabled() and req.referral_code:
        try:
            await try_apply_referral_after_auth(
                pool,
                invited_user_id=str(user["id"]),
                invited_email=user["email"],
                referral_code=req.referral_code,
                source_url=req.referral_source_url,
                ttl_days=COOKIE_DAYS,
            )
        except Exception as e:
            logger.warning("Referral apply failed on register for user=%s: %s", user.get("id"), e)
    subscription = await user_get_subscription(pool, str(user["id"]))
    token = create_access_token(str(user["id"]), user["email"])
    return LoginResponse(access_token=token, user=_user_out(user, subscription=subscription))


@router.post("/auth/login", response_model=LoginResponse)
async def api_login(req: LoginRequest) -> LoginResponse:
    """Login with email and password."""
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured. Set DATABASE_URL in .env")
    user = await user_get_by_email(pool, req.email)
    if not user or not user.get("password_hash"):
        raise HTTPException(401, "Invalid email or password")
    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    if user.get("admin_blocked"):
        raise HTTPException(403, "Account disabled")
    if _partner_enabled() and req.referral_code:
        try:
            await try_apply_referral_after_auth(
                pool,
                invited_user_id=str(user["id"]),
                invited_email=user["email"],
                referral_code=req.referral_code,
                source_url=req.referral_source_url,
                ttl_days=COOKIE_DAYS,
            )
        except Exception as e:
            logger.warning("Referral apply failed on login for user=%s: %s", user.get("id"), e)
    try:
        token = create_access_token(str(user["id"]), user["email"])
    except ValueError as e:
        if "JWT_SECRET" in str(e):
            raise HTTPException(503, "Server misconfiguration: JWT_SECRET not set in .env") from e
        raise
    subscription = await user_get_subscription(pool, str(user["id"]))
    return LoginResponse(access_token=token, user=_user_out(user, subscription=subscription))


@router.get("/auth/me", response_model=AuthUserOut)
async def api_me(user: dict | None = Depends(get_current_user)) -> AuthUserOut:
    """Return current user and Market Readiness; record visit for streak (idempotent per day)."""
    if user is None:
        pool = await get_pool()
        if pool is None:
            return AuthUserOut(id="local", email="local@localhost", name="Local")
        raise HTTPException(401, "Not authenticated")
    pool = await get_pool()
    subscription = None
    if pool and user:
        await user_record_visit(pool, str(user["id"]))
        readiness = await user_get_readiness(pool, str(user["id"]))
        subscription = await user_get_subscription(pool, str(user["id"]))
        out = _user_out(user, subscription=subscription)
        if readiness:
            out.readiness = ReadinessOut(**readiness)
        return out
    return _user_out(user)


@router.get("/auth/google")
async def api_google_login(redirect_uri: str | None = Query(None, description="Optional OAuth redirect URI")):
    """Redirect to Google OAuth consent screen. Frontend should open this URL (e.g. window.location or popup)."""
    settings = get_settings()
    if not settings.google_oauth_client_id:
        raise HTTPException(503, "Google OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID in .env")
    from urllib.parse import urlencode
    effective_redirect_uri = (redirect_uri or "").strip() or f"{settings.frontend_url.rstrip('/')}/auth/callback"
    params = urlencode({
        "client_id": settings.google_oauth_client_id,
        "redirect_uri": effective_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "consent",
    })
    return RedirectResponse(url=f"https://accounts.google.com/o/oauth2/v2/auth?{params}")


class GoogleCallbackRequest(BaseModel):
    code: str
    redirect_uri: str | None = None
    referral_code: str | None = None
    referral_source_url: str | None = None


@router.post("/auth/google/callback", response_model=LoginResponse)
async def api_google_exchange(req: GoogleCallbackRequest) -> LoginResponse:
    """Exchange Google OAuth code for our JWT. Call from frontend after redirect from Google."""
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    import httpx
    settings = get_settings()
    redirect_uri = (req.redirect_uri or "").strip() or f"{settings.frontend_url.rstrip('/')}/auth/callback"
    async with httpx.AsyncClient() as client:
        token_r = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": req.code,
                "client_id": settings.google_oauth_client_id,
                "client_secret": settings.google_oauth_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if token_r.status_code != 200:
        logger.warning("Google token exchange failed: %s", token_r.text)
        raise HTTPException(400, "Google login failed")
    data = token_r.json()
    access_token = data.get("access_token")
    if not access_token:
        raise HTTPException(400, "Google login failed")
    async with httpx.AsyncClient() as client:
        user_r = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if user_r.status_code != 200:
        raise HTTPException(400, "Google login failed")
    info = user_r.json()
    email = (info.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(400, "Google account has no email")
    google_id = info.get("id")
    name = info.get("name") or email.split("@")[0]
    user = await user_get_by_google_id(pool, google_id)
    if not user:
        user = await user_get_by_email(pool, email)
        if user:
            await user_update_google_id(pool, str(user["id"]), google_id)
        else:
            await user_create(pool, email, name=name, google_id=google_id)
            user = await user_get_by_email(pool, email)
    if _partner_enabled() and req.referral_code:
        try:
            await try_apply_referral_after_auth(
                pool,
                invited_user_id=str(user["id"]),
                invited_email=user["email"],
                referral_code=req.referral_code,
                source_url=req.referral_source_url,
                ttl_days=COOKIE_DAYS,
            )
        except Exception as e:
            logger.warning("Referral apply failed on google callback for user=%s: %s", user.get("id"), e)
    user = await user_get_by_id(pool, str(user["id"]))
    if not user:
        raise HTTPException(400, "Google login failed")
    if user.get("admin_blocked"):
        raise HTTPException(403, "Account disabled")
    token = create_access_token(str(user["id"]), user["email"])
    subscription = await user_get_subscription(pool, str(user["id"]))
    return LoginResponse(access_token=token, user=_user_out(user, subscription=subscription))


@router.get("/r/{code}")
async def api_referral_redirect(code: str, request: Request):
    if not _partner_enabled():
        raise HTTPException(404, "Partner program disabled")
    """
    Public referral entrypoint.
    Stores referral code in cookie and redirects user to login.
    """
    settings = get_settings()
    frontend = (settings.frontend_url or "").rstrip("/") or "http://localhost:5173"
    clean_code = (code or "").strip().lower()
    dest = f"{frontend}/login?ref={clean_code}"
    response = RedirectResponse(url=dest)
    response.set_cookie(
        key="hr_ref_code",
        value=clean_code,
        max_age=COOKIE_DAYS * 24 * 3600,
        httponly=True,
        samesite="lax",
    )
    response.set_cookie(
        key="hr_ref_src",
        value=str(request.url),
        max_age=COOKIE_DAYS * 24 * 3600,
        httponly=True,
        samesite="lax",
    )
    return response


@router.post("/partner/link", response_model=PartnerLinkResponse)
async def api_partner_link(user: dict | None = Depends(get_current_user)) -> PartnerLinkResponse:
    if not _partner_enabled():
        raise HTTPException(404, "Partner program disabled")
    if not user:
        raise HTTPException(401, "Not authenticated")
    if not _partner_user_allowed(user):
        raise HTTPException(403, "Partner access not enabled for this account")
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    code = await referral_get_or_create_code(pool, str(user["id"]), user.get("email"))
    frontend = (get_settings().frontend_url or "").rstrip("/") or "http://localhost:5173"
    return PartnerLinkResponse(
        code=code,
        referral_link=f"{frontend}/api/r/{code}",
    )


@router.get("/partner/me", response_model=PartnerMeResponse)
async def api_partner_me(
    user: dict | None = Depends(get_current_user),
    limit: int = Query(200, ge=1, le=500),
) -> PartnerMeResponse:
    if not _partner_enabled():
        raise HTTPException(404, "Partner program disabled")
    if not user:
        raise HTTPException(401, "Not authenticated")
    if not _partner_user_allowed(user):
        raise HTTPException(403, "Partner access not enabled for this account")
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    code = await referral_get_or_create_code(pool, str(user["id"]), user.get("email"))
    frontend = (get_settings().frontend_url or "").rstrip("/") or "http://localhost:5173"
    summary = await referral_partner_summary(pool, str(user["id"]))
    rows = await referral_partner_commissions(pool, str(user["id"]), limit=limit)
    items = [
        PartnerCommissionItem(
            invited_email=r.get("invited_email"),
            amount_cents=int(r.get("amount_cents") or 0),
            currency=(r.get("currency") or "usd").lower(),
            status=(r.get("status") or "hold"),
            created_at=r["created_at"].isoformat() if r.get("created_at") else "",
            reason=r.get("reason"),
        )
        for r in rows
    ]
    return PartnerMeResponse(
        referral_link=f"{frontend}/api/r/{code}",
        payout_threshold_cents=MIN_PAYOUT_CENTS,
        eligible_cents=summary["eligible_cents"],
        paid_cents=summary["paid_cents"],
        eligible_count=summary["eligible_count"],
        pending_count=summary["pending_count"],
        paid_count=summary["paid_count"],
        rejected_count=summary["rejected_count"],
        items=items,
    )


@router.get("/partner/terms", response_model=PartnerTermsResponse)
async def api_partner_terms() -> PartnerTermsResponse:
    if not _partner_enabled():
        raise HTTPException(404, "Partner program disabled")
    return PartnerTermsResponse(items=partner_terms())


# --- Payments (Stripe) ---

class CreateCheckoutRequest(BaseModel):
    price_key: str = Field(..., description="trial or monthly")
    success_url: str = Field(..., description="URL to redirect after success")
    cancel_url: str = Field(..., description="URL to redirect if user cancels")


class CreateCheckoutResponse(BaseModel):
    url: str  # Stripe Checkout URL to redirect to


async def _get_or_create_stripe_customer_id(pool, user_id: str) -> str | None:
    """Return existing stripe_customer_id for user or None (caller will create and persist)."""
    user = await user_get_by_id(pool, user_id)
    if not user:
        return None
    return user.get("stripe_customer_id") or None


@router.post("/payments/create-checkout-session", response_model=CreateCheckoutResponse)
async def api_create_checkout_session(
    req: CreateCheckoutRequest,
    user: dict | None = Depends(get_current_user),
) -> CreateCheckoutResponse:
    """Create Stripe Checkout session and return URL. Requires auth."""
    if not user:
        raise HTTPException(401, "Not authenticated")
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    settings = get_settings()
    if not settings.stripe_secret_key or not settings.stripe_price_monthly_id:
        raise HTTPException(503, "Stripe not configured (STRIPE_PRICE_MONTHLY_ID required)")
    from hr_breaker.services.stripe_service import (
        create_checkout_session as stripe_create_checkout,
        PRICE_KEY_TRIAL,
        PRICE_KEY_MONTHLY,
    )
    if req.price_key not in (PRICE_KEY_TRIAL, PRICE_KEY_MONTHLY):
        raise HTTPException(400, "price_key must be 'trial' or 'monthly'")
    try:
        url = await stripe_create_checkout(
            user_id=str(user["id"]),
            user_email=user["email"],
            price_key=req.price_key,
            success_url=req.success_url,
            cancel_url=req.cancel_url,
            pool=pool,
            get_or_create_customer_id=_get_or_create_stripe_customer_id,
            set_stripe_customer_id=user_set_stripe_customer_id,
        )
    except Exception as e:
        logger.error("Checkout creation failed: %s", e)
        raise HTTPException(400, str(e))
    return CreateCheckoutResponse(url=url)


class CreatePortalRequest(BaseModel):
    return_url: str = Field(..., description="URL to return to after leaving Stripe Customer Portal")


@router.post("/payments/create-portal-session", response_model=CreateCheckoutResponse)
async def api_create_portal_session(
    req: CreatePortalRequest,
    user: dict | None = Depends(get_current_user),
) -> CreateCheckoutResponse:
    """Open Stripe Customer Portal (cancel subscription, payment methods). Requires auth + Stripe customer."""
    if not user:
        raise HTTPException(401, "Not authenticated")
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise HTTPException(503, "Stripe not configured")
    urow = await user_get_by_id(pool, str(user["id"]))
    if not urow:
        raise HTTPException(404, "User not found")
    customer_id = (urow.get("stripe_customer_id") or "").strip()
    if not customer_id:
        raise HTTPException(
            400,
            "No billing profile yet. Complete a subscription checkout first, then you can manage or cancel here.",
        )
    from hr_breaker.services.stripe_service import create_billing_portal_session

    try:
        url = create_billing_portal_session(customer_id, req.return_url)
    except Exception as e:
        logger.error("Billing portal session failed: %s", e)
        raise HTTPException(400, str(e))
    return CreateCheckoutResponse(url=url)


@router.post("/payments/webhook")
async def api_stripe_webhook(request: Request) -> Response:
    """Stripe webhook: verify signature and handle checkout.session.completed, subscription updated/deleted."""
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    if not sig:
        raise HTTPException(400, "Missing stripe-signature")
    from hr_breaker.services import stripe_service
    try:
        event = stripe_service.construct_event(payload, sig)
    except ValueError as e:
        logger.warning("Stripe webhook signature invalid: %s", e)
        raise HTTPException(400, "Invalid signature")
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    ev_id = str(getattr(event, "id", "") or "")
    if ev_id:
        is_new = await referral_mark_processed_event(pool, ev_id)
        if not is_new:
            return Response(status_code=200)
    ev_type = getattr(event, "type", None)
    data = getattr(event, "data", None) or {}
    obj = data.get("object") if isinstance(data, dict) else getattr(data, "object", None)
    if ev_type == "checkout.session.completed" and obj:
        await stripe_service.handle_checkout_session_completed(
            obj, pool,
            user_update_subscription=user_update_subscription,
        )
    elif ev_type == "customer.subscription.updated" and obj:
        await stripe_service.handle_subscription_updated(
            obj, pool,
            get_user_id_by_stripe_customer=user_get_id_by_stripe_customer_id,
            user_update_subscription=user_update_subscription,
        )
    elif ev_type == "customer.subscription.deleted" and obj:
        await stripe_service.handle_subscription_deleted(
            obj, pool,
            get_user_id_by_stripe_customer=user_get_id_by_stripe_customer_id,
            user_update_subscription=user_update_subscription,
        )
    elif ev_type == "invoice.payment_succeeded" and obj:
        if _partner_enabled():
            await process_first_paid_invoice_commission(
                pool,
                invoice=obj,
                stripe_event_id=ev_id or None,
            )
    return Response(status_code=200)


# --- Landing (pitchcv.app): public trial analysis, no auth ---
# Rate limit: 1 request per IP per N hours (in-memory; for multi-instance use Redis)
_landing_rate: dict[str, float] = {}
_landing_rate_lock = asyncio.Lock()


def _client_ip(request: Request) -> str:
    """Client IP for rate limiting (X-Forwarded-For when behind proxy)."""
    forwarded = request.headers.get("x-forwarded-for", "").strip()
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host or "unknown"
    return "unknown"


async def _landing_rate_limit(ip: str, limit_hours: int) -> None:
    """Raise HTTP 429 if IP has already used the landing analysis within limit_hours."""
    async with _landing_rate_lock:
        now = time.time()
        window = limit_hours * 3600
        # Evict old entries
        to_del = [k for k, v in _landing_rate.items() if now - v > window]
        for k in to_del:
            del _landing_rate[k]
        if ip in _landing_rate and now - _landing_rate[ip] < window:
            raise HTTPException(
                429,
                "One free check per 24 hours. Sign up at my.pitchcv.app for unlimited access.",
            )
        _landing_rate[ip] = now


# --- Landing save → login → claim flow (pending uploads) ---
_landing_pending: dict[str, dict] = {}  # token -> { resume_content, job_text, resume_filename, created_at }
_landing_pending_lock = asyncio.Lock()


def _landing_pending_cleanup(ttl_seconds: int) -> None:
    now = time.time()
    to_del = [k for k, v in _landing_pending.items() if now - v.get("created_at", 0) > ttl_seconds]
    for k in to_del:
        _landing_pending.pop(k, None)


class LandingSaveResponse(BaseModel):
    token: str
    resume_filename: str
    job_title: str | None = None


class LandingPendingResponse(BaseModel):
    resume_filename: str
    job_title: str | None = None
    # True when landing saved only a resume (no job) → app opens /improve to choose Improve vs Tailor.
    resume_only: bool = False


class LandingClaimResponse(BaseModel):
    resume_content: str
    job_text: str | None = None
    resume_filename: str


@router.post("/landing/save", response_model=LandingSaveResponse)
async def api_landing_save(
    request: Request,
    resume: UploadFile | None = File(None, description="Resume file (PDF, DOCX, or text)"),
    resume_text: str | None = Form(None, description="Resume as plain text (alternative to file)"),
    job_text: str | None = Form(None, description="Job description text"),
) -> LandingSaveResponse:
    """
    Save resume for landing→login→claim flow. Optional job_text (omit or empty = resume-only → /improve).
    No auth. Returns token for /login?pending=TOKEN.
    CORS only from LANDING_ALLOWED_ORIGINS. Token TTL: LANDING_PENDING_TTL_SECONDS (default 15 min).
    """
    settings = get_settings()
    ip = _client_ip(request)

    resume_content = ""
    resume_filename = "resume.txt"
    body: bytes | None = None
    if resume and resume.filename:
        resume_filename = (resume.filename or "resume").split("/")[-1].strip() or "resume"
        body = await resume.read()
        if len(body) > 5 * 1024 * 1024:
            raise HTTPException(400, "Resume file too large (max 5 MB).")
        ext = (resume_filename or "").split(".")[-1].lower()
        if ext == "pdf":
            resume_content = await asyncio.to_thread(extract_text_from_pdf_bytes, body)
        elif ext in ("docx", "doc"):
            resume_content = await asyncio.to_thread(_extract_text_from_docx, body)
        else:
            resume_content = body.decode("utf-8", errors="replace")
    elif resume_text is not None:
        resume_content = resume_text
    else:
        raise HTTPException(400, "Provide resume file (resume) or resume text (resume_text).")

    if len(resume_content) > settings.landing_max_resume_chars:
        raise HTTPException(
            400,
            f"Resume text too long (max {settings.landing_max_resume_chars} characters).",
        )
    resume_content = resume_content.strip()
    if not resume_content:
        raise HTTPException(400, "Resume is empty or text could not be extracted.")

    job_text_resolved = (job_text or "").strip()
    job_title: str | None = None
    resume_only = not job_text_resolved
    if not resume_only:
        try:
            job = await parse_job_posting(job_text_resolved)
            job_title = job.title or None
        except Exception:
            pass

    token = secrets.token_urlsafe(32)
    ttl = settings.landing_pending_ttl_seconds
    async with _landing_pending_lock:
        _landing_pending_cleanup(ttl)
        _landing_pending[token] = {
            "resume_content": resume_content,
            "job_text": job_text_resolved if job_text_resolved else None,
            "resume_filename": resume_filename,
            "job_title": job_title,
            "resume_only": resume_only,
            "resume_pdf_body": body
            if body is not None and resume and resume.filename and (resume.filename or "").lower().endswith(".pdf")
            else None,
            "created_at": time.time(),
        }
    logger.info("Landing save OK ip=%s token=%s", ip, token[:8])
    return LandingSaveResponse(
        token=token,
        resume_filename=resume_filename,
        job_title=job_title,
    )


@router.get("/landing/pending", response_model=LandingPendingResponse)
async def api_landing_pending(token: str = Query(..., description="Pending token from /landing/save")) -> LandingPendingResponse:
    """Return resume_filename and job_title for login page display. No auth. Token is not consumed."""
    settings = get_settings()
    ttl = settings.landing_pending_ttl_seconds
    async with _landing_pending_lock:
        _landing_pending_cleanup(ttl)
        data = _landing_pending.get(token)
    if not data:
        raise HTTPException(404, "Link expired or invalid. Upload your files again on the home page.")
    return LandingPendingResponse(
        resume_filename=data["resume_filename"],
        job_title=data.get("job_title"),
        resume_only=bool(data.get("resume_only")),
    )


@router.get("/landing/claim", response_model=LandingClaimResponse)
async def api_landing_claim(
    token: str = Query(..., description="Pending token"),
    user: dict | None = Depends(get_current_user),
) -> LandingClaimResponse:
    """After login: claim pending upload and get resume_content + job for analysis. Consumes token."""
    settings = get_settings()
    ttl = settings.landing_pending_ttl_seconds
    async with _landing_pending_lock:
        _landing_pending_cleanup(ttl)
        data = _landing_pending.pop(token, None)
    if not data:
        raise HTTPException(404, "Link expired or already used. Upload your files again.")
    # If landing upload was a PDF, register it into "My resumes" after login.
    try:
        user_id = str(user["id"]) if user else None
        pdf_body = data.get("resume_pdf_body")
        if user_id and isinstance(pdf_body, (bytes, bytearray)) and len(pdf_body) > 50:
            await _register_uploaded_pdf_bytes(
                body=bytes(pdf_body),
                content=data["resume_content"],
                user_id=user_id,
            )
    except Exception as e:
        logger.warning("Landing claim: failed to register uploaded PDF for user: %s", e)
    return LandingClaimResponse(
        resume_content=data["resume_content"],
        job_text=data.get("job_text"),
        resume_filename=data["resume_filename"],
    )


@router.post("/landing/analyze", response_model=AnalyzeResponse)
async def api_landing_analyze(
    request: Request,
    resume: UploadFile | None = File(None, description="Resume file (PDF, DOCX, or text)"),
    resume_text: str | None = Form(None, description="Resume as plain text (alternative to file)"),
    job_text: str | None = Form(None, description="Job description text"),
) -> AnalyzeResponse:
    """
    Public trial analysis for landing (pitchcv.app). No auth.
    Returns: ATS score, keyword score, job preview, recommendations, improvement tips.
    Rate limit: 1 request per IP per 24h (configurable). CORS allowed only for LANDING_ALLOWED_ORIGINS.
    """
    settings = get_settings()
    if not settings.google_api_key:
        raise HTTPException(503, "GOOGLE_API_KEY not set.")
    ip = _client_ip(request)
    await _landing_rate_limit(ip, settings.landing_rate_limit_hours)

    # Resume: file or text
    resume_content = ""
    if resume and resume.filename:
        body = await resume.read()
        if len(body) > 5 * 1024 * 1024:  # 5 MB max file
            raise HTTPException(400, "Resume file too large (max 5 MB).")
        ext = (resume.filename or "").split(".")[-1].lower()
        if ext == "pdf":
            resume_content = await asyncio.to_thread(extract_text_from_pdf_bytes, body)
        elif ext in ("docx", "doc"):
            resume_content = await asyncio.to_thread(_extract_text_from_docx, body)
        else:
            resume_content = body.decode("utf-8", errors="replace")
    elif resume_text is not None:
        resume_content = resume_text
    else:
        raise HTTPException(400, "Provide resume file (resume) or resume text (resume_text).")

    if len(resume_content) > settings.landing_max_resume_chars:
        raise HTTPException(
            400,
            f"Resume text too long (max {settings.landing_max_resume_chars} characters).",
        )
    resume_content = resume_content.strip()
    if not resume_content:
        raise HTTPException(400, "Resume is empty or text could not be extracted.")

    # Job: text only
    if not job_text:
        raise HTTPException(400, "Provide job description text (job_text).")
    job_text_resolved = job_text
    if not job_text_resolved or not job_text_resolved.strip():
        raise HTTPException(400, "Job text is empty.")

    try:
        job = await parse_job_posting(job_text_resolved)
    except Exception as e:
        logger.exception("Landing analyze job parse failed: %s", e)
        if _is_api_key_invalid(e):
            raise HTTPException(503, _API_KEY_INVALID_MSG)
        raise HTTPException(500, "Job parsing failed.")

    kw_result = await asyncio.to_thread(check_keywords, resume_content, job)
    ats_score, insights = await asyncio.gather(
        score_resume_vs_job(resume_content, job),
        get_analysis_insights(resume_content, job),
    )
    job_out = JobPostingOut(
        title=job.title,
        company=job.company,
        requirements=job.requirements,
        keywords=job.keywords,
        description=job.description,
    )
    recommendations = _recommendations_from_insights(
        insights,
        ats_score=ats_score,
        keyword_score=kw_result.score,
        keyword_threshold=settings.filter_keyword_threshold,
        missing_keywords=kw_result.missing_keywords,
        job_keywords=job.keywords or [],
        requirements=job.requirements or [],
        has_requirements=bool(job.requirements),
    )
    callback_heads = _critical_headlines_from_insights(insights)
    callback_out = [
        CallbackBlockerOut(headline=b.headline, impact=b.impact, action=b.action) for b in insights.callback_blockers
    ]
    logger.info("Landing analyze OK ip=%s ats=%s", ip, ats_score)
    risk_score = _normalize_rejection_risk(
        model_risk=insights.rejection_risk_score,
        critical_issues=callback_heads,
        ats_score=ats_score,
        keyword_score=kw_result.score,
        keyword_threshold=settings.filter_keyword_threshold,
    )
    return AnalyzeResponse(
        ats_score=ats_score,
        keyword_score=kw_result.score,
        keyword_threshold=settings.filter_keyword_threshold,
        job=job_out,
        recommendations=recommendations,
        rejection_risk_score=risk_score,
        critical_issues=callback_heads,
        callback_blockers=callback_out,
        risk_summary=insights.risk_summary,
        improvement_tips=insights.improvement_tips,
    )


# --- Endpoints ---


@router.post("/resume/extract-name", response_model=ExtractNameResponse)
async def api_extract_name(req: ExtractNameRequest) -> ExtractNameResponse:
    """Extract first/last name from resume content."""
    first_name, last_name = await extract_name(req.content)
    return ExtractNameResponse(first_name=first_name, last_name=last_name)


@router.post("/resume/extract-summary", response_model=ExtractResumeSummaryResponse)
async def api_extract_resume_summary(req: ExtractResumeSummaryRequest) -> ExtractResumeSummaryResponse:
    """Extract structured summary (name, specialty, skills) from resume content via LLM."""
    settings = get_settings()
    if not settings.google_api_key:
        raise HTTPException(503, "GOOGLE_API_KEY not set. Add it to .env and restart the backend.")
    try:
        summary = await extract_resume_summary(req.content)
        return ExtractResumeSummaryResponse(
            full_name=summary.full_name,
            specialty=summary.specialty,
            skills=summary.skills,
        )
    except Exception as e:
        if _is_api_key_invalid(e):
            raise HTTPException(503, detail=_API_KEY_INVALID_MSG)
        logger.exception("extract-resume-summary failed: %s", e)
        raise HTTPException(500, detail=str(e))


@router.post("/resume/parse-pdf", response_model=ParsePdfResponse)
async def api_parse_resume_pdf(file: UploadFile = File(...)) -> ParsePdfResponse:
    """Extract text from uploaded PDF resume."""
    tmp_path: Path | None = None
    try:
        if not file.filename or not file.filename.lower().endswith(".pdf"):
            raise HTTPException(400, "Expected a PDF file")
        body = await file.read()
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(body)
            tmp_path = Path(tmp.name)
        content = await asyncio.to_thread(extract_text_from_pdf, tmp_path)
        return ParsePdfResponse(content=content)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("parse-pdf failed: %s", e)
        raise HTTPException(500, detail=f"PDF error: {e!s}")
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass


def _extract_text_from_docx(data: bytes) -> str:
    """Extract plain text from .docx file bytes."""
    from docx import Document
    doc = Document(io.BytesIO(data))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


async def _resume_upload_to_text(filename: str | None, data: bytes) -> str:
    """Plain text from uploaded resume bytes (PDF, DOCX, or UTF-8 text-like)."""
    if not data:
        raise HTTPException(400, "Empty file")
    name = (filename or "resume.txt").lower()
    if name.endswith(".pdf"):
        tmp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(data)
                tmp_path = Path(tmp.name)
            return await asyncio.to_thread(extract_text_from_pdf, tmp_path)
        finally:
            if tmp_path is not None:
                tmp_path.unlink(missing_ok=True)
    if name.endswith(".docx"):
        return await asyncio.to_thread(_extract_text_from_docx, data)
    if name.endswith((".txt", ".md", ".tex", ".html", ".htm")):
        return data.decode("utf-8", errors="replace")
    raise HTTPException(
        400,
        "Unsupported file type. Use PDF, DOCX, TXT, MD, TEX, or HTML.",
    )


@router.post("/resume/parse-docx", response_model=ParsePdfResponse)
async def api_parse_resume_docx(file: UploadFile = File(...)) -> ParsePdfResponse:
    """Extract text from uploaded Word (.docx) resume."""
    try:
        if not file.filename or not file.filename.lower().endswith(".docx"):
            raise HTTPException(400, "Expected a .docx file")
        body = await file.read()
        content = await asyncio.to_thread(_extract_text_from_docx, body)
        return ParsePdfResponse(content=content)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("parse-docx failed: %s", e)
        raise HTTPException(500, detail=f"DOCX error: {e!s}")


@router.post("/resume/thumbnail")
async def api_resume_thumbnail(file: UploadFile = File(...)) -> Response:
    """Return first page of uploaded PDF as PNG (for preview in Optimize step 1)."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Expected a PDF file")
    body = await file.read()
    try:
        doc = fitz.open(stream=body, filetype="pdf")
        try:
            if doc.page_count == 0:
                raise HTTPException(400, "PDF has no pages")
            page = doc[0]
            # alpha=False: some PDFs yield a fully transparent pixmap; PNG then looks blank in <img>.
            pix = page.get_pixmap(dpi=120, alpha=False)
            png_bytes = pix.tobytes("png")
            return Response(
                content=png_bytes,
                media_type="image/png",
                headers={"Cache-Control": "no-store"},
            )
        finally:
            doc.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Resume thumbnail failed: %s", e)
        raise HTTPException(500, "Failed to generate thumbnail")


class RegisterUploadResponse(BaseModel):
    """Response after registering an uploaded PDF for «Мои резюме»."""
    filename: str


async def _register_uploaded_pdf_bytes(
    *,
    body: bytes,
    content: str,
    user_id: str | None,
) -> str:
    """Store uploaded PDF bytes as history record (same behavior as /resume/register-upload)."""
    checksum = hashlib.sha256(content.encode()).hexdigest()
    first_name, last_name = await extract_name(content)
    settings = get_settings()
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_hash = checksum[:12]
    filename = f"uploaded_{safe_hash}_{ts}.pdf"
    path = settings.output_dir / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    pdf_storage.save_source_content(checksum, content)
    record = GeneratedPDF(
        path=path,
        source_checksum=checksum,
        company="",
        job_title="",
        first_name=first_name,
        last_name=last_name,
        source_was_pdf=True,
    )
    await pdf_storage.save_record_async(record, user_id=user_id)
    # Persist bytes and text in DB so uploads survive container restarts (Railway ephemeral disk).
    try:
        pool = await get_pool()
        if pool:
            await uploaded_pdf_upsert(
                pool,
                source_checksum=checksum,
                filename=filename,
                user_id=user_id,
                pdf_data=body,
                extracted_text=content,
            )
    except Exception as e:
        logger.warning("uploaded_pdf_upsert failed (non-fatal): %s", e)
    return filename


@router.post("/resume/register-upload", response_model=RegisterUploadResponse)
async def api_register_upload(file: UploadFile = File(...), user: dict | None = Depends(get_current_user)) -> RegisterUploadResponse:
    """Save uploaded PDF and create a history record (user-scoped when DB is used)."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Expected a PDF file")
    body = await file.read()
    if len(body) < 50:
        raise HTTPException(400, "PDF file too small")
    try:
        content = await asyncio.to_thread(extract_text_from_pdf_bytes, body)
    except Exception as e:
        logger.exception("register-upload: extract text failed: %s", e)
        raise HTTPException(500, detail=f"PDF error: {e!s}")
    user_id = str(user["id"]) if user else None
    filename = await _register_uploaded_pdf_bytes(body=body, content=content, user_id=user_id)
    return RegisterUploadResponse(filename=filename)


@router.post("/job/parse", response_model=JobPostingOut)
async def api_parse_job(req: JobParseRequest) -> JobPostingOut:
    """Parse job from URL (scrape first) or raw text."""
    settings = get_settings()
    if not settings.google_api_key:
        raise HTTPException(503, "GOOGLE_API_KEY not set. Add it to .env and restart the backend.")

    if req.url and req.text:
        raise HTTPException(400, "Provide either url or text, not both")
    if req.url:
        url = _sanitize_url(req.url)
        if _is_job_list_url(url):
            raise HTTPException(
                422,
                "This is a job search page link. Use a link to a single job posting (e.g. indeed.com/viewjob?jk=...).",
            )
        try:
            job_text = await asyncio.to_thread(scrape_job_posting, url)
        except CloudflareBlockedError:
            raise HTTPException(422, "Job URL blocked by bot protection. Paste text instead.")
        except Exception as e:
            raise HTTPException(422, str(e))
    elif req.text:
        job_text = req.text
    else:
        raise HTTPException(400, "Provide url or text")

    try:
        job = await parse_job_posting(job_text)
    except Exception as e:
        logger.exception("job/parse failed: %s", e)
        if _is_api_key_invalid(e):
            raise HTTPException(401, _API_KEY_INVALID_MSG)
        raise HTTPException(500, f"Job parse failed: {e!s}")

    return JobPostingOut(
        title=job.title,
        company=job.company,
        requirements=job.requirements,
        keywords=job.keywords,
        description=job.description,
    )


# Шум из TF-IDF: обрезки типа m/w/d, однобуквенные, слишком короткие
_KEYWORD_NOISE = frozenset(
    {
        "m",
        "w",
        "d",
        "m w",
        "w d",
        "m d",
        "m w d",
        "w m",
        "d m",
        "d w",
        "z b",
        "z.b",
        "zb",
    }
)
_KEYWORD_STOPWORDS = frozenset(
    {
        # English
        "a",
        "an",
        "and",
        "or",
        "the",
        "to",
        "of",
        "for",
        "in",
        "on",
        "with",
        "by",
        "from",
        "at",
        "as",
        # German
        "der",
        "die",
        "das",
        "den",
        "dem",
        "des",
        "ein",
        "eine",
        "einer",
        "einem",
        "einen",
        "und",
        "oder",
        "mit",
        "im",
        "in",
        "am",
        "an",
        "zu",
        "zur",
        "zum",
        "für",
        "von",
        "bei",
        "als",
        "auch",
        # Common abbreviations/particles producing noisy chips
        "z",
        "b",
        "zb",
    }
)
_MIN_KEYWORD_LEN = 3
_MAX_KEYWORDS_DISPLAY = 7
# UI chips in Optimize "Keywords" — show more concrete terms than legacy short lists
_RECOMMENDATION_KEYWORD_CHIPS_MAX = 14


def _filter_meaningful_keywords(
    missing_keywords: list[str],
    job_keywords: list[str],
    *,
    max_count: int | None = None,
) -> list[str]:
    """Оставляем только осмысленные термины; приоритет — недостающие ключевые слова из вакансии (job.keywords)."""
    cap = max_count if max_count is not None else _MAX_KEYWORDS_DISPLAY
    job_lower = {k.strip().lower() for k in job_keywords if k and len(k.strip()) >= _MIN_KEYWORD_LEN}
    seen: set[str] = set()
    result: list[str] = []

    def _ok(k: str) -> bool:
        if len(k) < _MIN_KEYWORD_LEN or k in _KEYWORD_NOISE or k.isdigit():
            return False
        if "http://" in k or "https://" in k or "@" in k:
            return False
        tokens = [t for t in re.split(r"\s+", k) if t]
        if not tokens or len(tokens) > 4:
            return False
        if any(len(t) == 1 for t in tokens):
            return False
        if all(t in _KEYWORD_STOPWORDS or t.isdigit() for t in tokens):
            return False
        if len(tokens) == 1 and tokens[0] in _KEYWORD_STOPWORDS:
            return False
        return True

    # Сначала — недостающие термины, которые явно указаны в вакансии (job.keywords)
    for kw in missing_keywords:
        k = (kw or "").strip().lower()
        if not k or k in seen or not _ok(k):
            continue
        if k not in job_lower:
            continue
        seen.add(k)
        result.append(kw.strip())
        if len(result) >= cap:
            return result
    # Затем — остальные из missing (TF-IDF), без шума.
    # Здесь требования строже: односложные и служебные фразы часто попадают как артефакты.
    for kw in missing_keywords:
        k = (kw or "").strip().lower()
        if not k or k in seen or not _ok(k):
            continue
        tokens = [t for t in re.split(r"\s+", k) if t]
        if len(tokens) == 1 and len(tokens[0]) < 4:
            continue
        seen.add(k)
        result.append(kw.strip())
        if len(result) >= cap:
            break
    return result


def _build_recommendations(
    ats_score: int,
    keyword_score: float,
    keyword_threshold: float,
    missing_keywords: list[str],
    job_keywords: list[str],
    requirements: list[str],
    critical_issues: list[str],
    has_requirements: bool,
) -> list[RecommendationItem]:
    """Return three categories in a stable order."""
    meaningful = _filter_meaningful_keywords(missing_keywords, job_keywords or [], max_count=_MAX_KEYWORDS_DISPLAY)
    need_kw = keyword_score < keyword_threshold
    need_structure = ats_score < 70
    need_requirements = has_requirements and (ats_score < 80 or keyword_score < keyword_threshold)

    def _clean_label(text: str) -> str:
        t = " ".join((text or "").strip().split())
        t = t.rstrip(" .,:;")
        return t[:90]

    def _structure_labels_from_issues(issues: list[str]) -> list[str]:
        labels: list[str] = []
        for issue in issues:
            low = (issue or "").lower()
            if any(x in low for x in ("typo", "grammar", "spelling", "fehler", "ошиб")):
                labels.append("Fix spelling and grammar issues")
            elif any(x in low for x in ("paragraph", "bullet", "section", "structure", "format")):
                labels.append("Restructure long paragraphs into clear bullets")
            elif any(x in low for x in ("clarity", "unclear", "readability")):
                labels.append("Improve clarity with concise evidence-driven wording")
        if not labels and need_structure:
            labels = ["Use clear section headings"]
        uniq: list[str] = []
        for l in labels:
            c = _clean_label(l)
            if c and c not in uniq:
                uniq.append(c)
            if len(uniq) >= 3:
                break
        return uniq

    def _requirements_labels(reqs: list[str], kws: list[str], issues: list[str]) -> list[str]:
        labels: list[str] = []
        req_candidates = [r for r in reqs if (r or "").strip()]
        for kw in kws[:6]:
            kl = kw.lower()
            hit = next((r for r in req_candidates if kl in r.lower()), None)
            if hit:
                labels.append(_clean_label(hit))
        for issue in issues:
            low = (issue or "").lower()
            if any(x in low for x in ("missing", "gap", "must-have", "requirement", "anforder")):
                labels.append(_clean_label(issue))
        if not labels and need_requirements:
            labels = ["Address must-have requirements explicitly"]
        uniq: list[str] = []
        for l in labels:
            if l and l not in uniq:
                uniq.append(l)
            if len(uniq) >= 3:
                break
        return uniq

    if need_kw:
        kw_labels = [_clean_label(w) for w in meaningful[:4] if _clean_label(w)]
        if not kw_labels:
            kw_labels = [
                "Mirror exact vacancy terminology",
                "Add role-specific hard skills",
            ]
    else:
        kw_labels = ["OK"]

    structure_labels = _structure_labels_from_issues(critical_issues) if need_structure else ["OK"]
    req_labels = (
        _requirements_labels(requirements, meaningful, critical_issues)
        if need_requirements
        else ["OK"]
    )

    return [
        RecommendationItem(category="Keywords", labels=kw_labels),
        RecommendationItem(category="Structure", labels=structure_labels),
        RecommendationItem(category="Requirements", labels=req_labels),
    ]


def _critical_headlines_from_insights(insights: AnalysisInsights) -> list[str]:
    return [b.headline for b in insights.callback_blockers if (b.headline or "").strip()]


def _recommendations_from_insights(
    insights: AnalysisInsights,
    *,
    ats_score: int,
    keyword_score: float,
    keyword_threshold: float,
    missing_keywords: list[str],
    job_keywords: list[str],
    requirements: list[str],
    has_requirements: bool,
) -> list[RecommendationItem]:
    """Structure/Requirements: prefer LLM lines; Keywords: concrete missing terms (TF-IDF), not LLM prose."""
    issues = _critical_headlines_from_insights(insights)
    fallback = _build_recommendations(
        ats_score=ats_score,
        keyword_score=keyword_score,
        keyword_threshold=keyword_threshold,
        missing_keywords=missing_keywords,
        job_keywords=job_keywords,
        requirements=requirements,
        critical_issues=issues,
        has_requirements=has_requirements,
    )
    by_cat = {r.category: r.labels for r in fallback}
    need_kw = keyword_score < keyword_threshold
    meaningful_kw = _filter_meaningful_keywords(
        missing_keywords,
        job_keywords or [],
        max_count=_RECOMMENDATION_KEYWORD_CHIPS_MAX,
    )

    def _clean_keyword_chip(text: str) -> str:
        t = " ".join((text or "").strip().split())
        t = t.rstrip(" .,:;")
        return t[:48] if t else ""

    def keyword_labels() -> list[str]:
        chips = [_clean_keyword_chip(w) for w in meaningful_kw]
        chips = [c for c in chips if c]
        if chips:
            return chips
        if not need_kw:
            return ["OK"]
        return by_cat.get(
            "Keywords",
            ["Mirror exact vacancy terminology", "Add role-specific hard skills"],
        )

    def labels_for(llm_list: list[str], fb_key: str) -> list[str]:
        if llm_list:
            return llm_list[:3]
        return by_cat.get(fb_key, ["OK"])

    return [
        RecommendationItem(category="Keywords", labels=keyword_labels()),
        RecommendationItem(category="Structure", labels=labels_for(insights.improvement_structure, "Structure")),
        RecommendationItem(
            category="Requirements", labels=labels_for(insights.improvement_requirements, "Requirements")
        ),
    ]


def _normalize_rejection_risk(
    model_risk: int,
    critical_issues: list[str],
    ats_score: int,
    keyword_score: float,
    keyword_threshold: float,
) -> int:
    """Keep LLM risk consistent with critical gaps and base ATS/keyword signals."""
    risk = max(0, min(100, int(model_risk)))
    issues_count = len([x for x in critical_issues if str(x).strip()])
    floors: list[int] = []
    if issues_count >= 1:
        floors.append(45)
    if issues_count >= 2:
        floors.append(55)
    if ats_score < 70 or keyword_score < keyword_threshold:
        floors.append(45)
    if ats_score < 60 or keyword_score < max(0.55, keyword_threshold - 0.1):
        floors.append(60)
    if floors:
        risk = max(risk, max(floors))
    return risk


@router.post("/analyze", response_model=AnalyzeResponse)
async def api_analyze(req: AnalyzeRequest, user: dict | None = Depends(get_optional_user)) -> AnalyzeResponse:
    """Pre-assessment: score current resume vs job (ATS + keywords) before optimization."""
    user_id = str(user["id"]) if user and user.get("id") else None
    if user_id and user_id != "local" and not _is_admin_user(user):
        pool = await get_pool()
        if pool:
            sub = await user_get_subscription(pool, user_id)
            if sub:
                plan = sub.get("plan") or "free"
                status = sub.get("status") or "free"
                has_paid = plan in ("trial", "monthly") and status in ("active", "trial")
                if not has_paid:
                    free_count = int(sub.get("free_analyses_count") or 0)
                    if free_count >= FREE_ANALYSES_PER_MONTH:
                        raise HTTPException(
                            402,
                            f"Free plan limit reached ({FREE_ANALYSES_PER_MONTH} analyses/month). Upgrade for unlimited scans.",
                        )
                
                # Increment regardless of plan so we track usage
                await user_increment_free_analyses(pool, user_id)

    settings = get_settings()
    if not settings.google_api_key:
        raise HTTPException(503, "GOOGLE_API_KEY not set. Add it to .env and restart the backend.")

    audit_uid = None
    if user and user.get("id") and str(user["id"]) != "local":
        audit_uid = str(user["id"])

    is_admin = bool(user and _is_admin_user(user))
    pipe: list[dict[str, Any]] = []

    def alog(step: str, message: str, data: dict[str, Any] | None = None) -> None:
        if not is_admin:
            return
        entry: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "phase": "analyze",
            "step": step,
            "message": message,
        }
        if data is not None:
            entry["data"] = data
        pipe.append(entry)

    alog(
        "request",
        "Analyze pipeline start",
        {
            "resume_chars": len(req.resume_content),
            "job_url": bool(req.job_url),
            "job_text_chars": len((req.job_text or "").strip()),
            "output_language": (req.output_language or "en").strip().lower() or "en",
        },
    )

    job_text = req.job_text
    if req.improve_mode and not job_text:
        job_text = None  # Will use IMPROVE_MODE_JOB below
    elif req.job_url and not job_text:
        url = _sanitize_url(req.job_url)
        if _is_job_list_url(url):
            raise HTTPException(
                422,
                "This is a job search page link. Use a link to a single job posting (e.g. indeed.com/viewjob?jk=...).",
            )
        try:
            from urllib.parse import urlparse

            host = urlparse(url).netloc or url[:64]
            alog("scrape", "Fetching job URL", {"host": host})
            job_text = await asyncio.to_thread(scrape_job_posting, url)
            alog("scrape", "Job page scraped to plain text", {"job_text_chars": len(job_text)})
        except CloudflareBlockedError:
            pool = await get_pool()
            await log_usage_event(
                pool, audit_uid, "analyze_job_scrape", None, success=False, error_message="Cloudflare blocked"
            )
            raise HTTPException(422, "Job URL blocked by bot protection. Paste text instead.")
        except Exception as e:
            pool = await get_pool()
            await log_usage_event(
                pool, audit_uid, "analyze_job_scrape", None, success=False, error_message=str(e)[:2000]
            )
            raise HTTPException(422, str(e))
    if not job_text and not req.improve_mode:
        raise HTTPException(400, "Provide job_text or job_url")

    if req.improve_mode and not job_text:
        from hr_breaker.orchestration import IMPROVE_MODE_JOB
        job = IMPROVE_MODE_JOB
    else:
        if not req.job_url:
            alog("job_input", "Using pasted job description (no URL)", {"job_text_chars": len(job_text or "")})

        _job_cache_key = _cache_key("job:", job_text or "")
        job = _cache_get(_job_cache_key)
        if job is None:
            try:
                job = await parse_job_posting(job_text, audit_user_id=audit_uid)
            except Exception as e:
                logger.exception("analyze job parse failed: %s", e)
                if _is_api_key_invalid(e):
                    raise HTTPException(401, _API_KEY_INVALID_MSG)
                raise HTTPException(500, f"Job parse failed: {e!s}")
            _cache_set(_job_cache_key, job)

    alog(
        "parse_job",
        "Job posting structured (LLM)",
        {
            "title": job.title,
            "company": job.company,
            "keywords_n": len(job.keywords or []),
            "requirements_n": len(job.requirements or []),
            "description_chars": len(job.description or ""),
        },
    )

    resume_stripped = req.resume_content.strip()
    job_out = JobPostingOut(
        title=job.title,
        company=job.company,
        requirements=job.requirements,
        keywords=job.keywords,
        description=job.description,
    )
    tpl_draft = (req.session_template_id or "").strip()[:200] or ""
    if user_id and user_id != "local":
        pool_d1 = await get_pool()
        if pool_d1:
            exp_d = datetime.now(timezone.utc) + timedelta(days=3)
            try:
                await optimize_session_draft_upsert(
                    pool_d1,
                    user_id=user_id,
                    payload={
                        "stage": 1,
                        "resume_text": resume_stripped,
                        "job_url": (req.job_url or "").strip() or None,
                        "job": job_out.model_dump(),
                        "selected_template_id": tpl_draft or None,
                    },
                    expires_at=exp_d,
                )
            except Exception as e:
                logger.warning("optimize_session_draft_upsert stage 1: %s", e)
    out_lang = (req.output_language or "en").strip().lower() or "en"
    kw_result = await asyncio.to_thread(check_keywords, resume_stripped, job)
    alog(
        "keywords",
        "Keyword match (TF-IDF vs job)",
        {"score": kw_result.score, "missing_keywords_n": len(kw_result.missing_keywords)},
    )
    # Run ATS and breakdown (Skills/Experience/Portfolio) in parallel
    ats_score, insights = await asyncio.gather(
        score_resume_vs_job(resume_stripped, job, audit_user_id=audit_uid),
        get_analysis_insights(resume_stripped, job, output_language=out_lang, audit_user_id=audit_uid),
    )
    alog(
        "parallel_llm",
        "ATS score + resume insights (LLM)",
        {
            "ats_score": ats_score,
            "rejection_risk_model": insights.rejection_risk_score,
            "callback_blockers_n": len(insights.callback_blockers),
        },
    )
    recommendations = _recommendations_from_insights(
        insights,
        ats_score=ats_score,
        keyword_score=kw_result.score,
        keyword_threshold=settings.filter_keyword_threshold,
        missing_keywords=kw_result.missing_keywords,
        job_keywords=job.keywords or [],
        requirements=job.requirements or [],
        has_requirements=bool(job.requirements),
    )
    callback_heads = _critical_headlines_from_insights(insights)
    callback_out = [
        CallbackBlockerOut(headline=b.headline, impact=b.impact, action=b.action) for b in insights.callback_blockers
    ]
    if user:
        pool = await get_pool()
        if pool:
            await user_increment_readiness(pool, str(user["id"]), delta=READINESS_DELTA_ANALYSIS)
    risk_score = _normalize_rejection_risk(
        model_risk=insights.rejection_risk_score,
        critical_issues=callback_heads,
        ats_score=ats_score,
        keyword_score=kw_result.score,
        keyword_threshold=settings.filter_keyword_threshold,
    )
    resp = AnalyzeResponse(
        ats_score=ats_score,
        keyword_score=kw_result.score,
        keyword_threshold=settings.filter_keyword_threshold,
        job=job_out,
        recommendations=recommendations,
        rejection_risk_score=risk_score,
        critical_issues=callback_heads,
        callback_blockers=callback_out,
        risk_summary=insights.risk_summary,
        improvement_tips=insights.improvement_tips,
        admin_pipeline_log=pipe if is_admin else None,
    )
    resume_tok: str | None = None
    if user_id and user_id != "local":
        pool_d2 = await get_pool()
        if pool_d2:
            exp_d2 = datetime.now(timezone.utc) + timedelta(days=3)
            analyze_dump = resp.model_dump(mode="json")
            analyze_dump.pop("resume_session_token", None)
            if not is_admin:
                analyze_dump.pop("admin_pipeline_log", None)
            try:
                await optimize_session_draft_upsert(
                    pool_d2,
                    user_id=user_id,
                    payload={
                        "stage": 2,
                        "resume_text": resume_stripped,
                        "job_url": (req.job_url or "").strip() or None,
                        "job": job_out.model_dump(),
                        "pre_ats_score": resp.ats_score,
                        "pre_keyword_score": resp.keyword_score,
                        "recommendations": [r.model_dump() for r in resp.recommendations],
                        "analyze": analyze_dump,
                        "selected_template_id": tpl_draft or None,
                    },
                    expires_at=exp_d2,
                )
                resume_tok = create_session_draft_token(user_id, exp_d2)
            except Exception as e:
                logger.warning("optimize_session_draft_upsert stage 2: %s", e)
    if resume_tok:
        resp = resp.model_copy(update={"resume_session_token": resume_tok})
    return resp


async def _run_optimize(
    req: OptimizeRequest,
    progress_queue: asyncio.Queue | None = None,
    user: dict | None = None,
) -> OptimizeResponse:
    """Run full optimization; optionally push (percent, message) to progress_queue."""
    user_id = str(user["id"]) if user and user.get("id") else None
    audit_uid = user_id if user_id and user_id != "local" else None
    if user_id and user_id != "local" and not _is_admin_user(user):
        pool = await get_pool()
        if pool:
            sub = await user_get_subscription(pool, user_id)
            if sub:
                plan = sub.get("plan") or "free"
                status = sub.get("status") or "free"
                has_paid = plan in ("trial", "monthly") and status in ("active", "trial")
                if not has_paid:
                    free_opt = int(sub.get("free_optimize_count") or 0)
                    if free_opt >= FREE_OPTIMIZE_PER_MONTH:
                        err_msg = (
                            f"Free plan limit reached ({FREE_OPTIMIZE_PER_MONTH} optimizations/month). "
                            "Start a trial to continue and download PDFs."
                        )
                        _put_progress(progress_queue, 100, err_msg)
                        raise HTTPException(402, err_msg)

    settings = get_settings()
    if not settings.google_api_key:
        raise HTTPException(503, "GOOGLE_API_KEY not set. Add it to .env and restart the backend.")

    _put_progress(progress_queue, 0, "Starting…")
    _put_admin_log(
        progress_queue,
        user,
        {
            "step": "request",
            "message": "Optimize pipeline start",
            "data": {
                "resume_chars": len(req.resume_content or ""),
                "job_url": bool(req.job_url),
                "job_text_chars": len((req.job_text or "").strip()),
                "parallel": req.parallel,
                "aggressive_tailoring": req.aggressive_tailoring,
                "output_language": (req.output_language or "en").strip().lower() or "en",
            },
        },
    )
    job_text = req.job_text
    if not req.improve_mode:
        if req.job_url and not job_text:
            url = _sanitize_url(req.job_url)
            if _is_job_list_url(url):
                return OptimizeResponse(
                    success=False,
                    validation=ValidationResultOut(passed=False, results=[]),
                    job=JobPostingOut(title="", company="", requirements=[], keywords=[], description=""),
                    error="This is a job search page link. Use a link to a single job posting (e.g. indeed.com/viewjob?jk=...).",
                )
            _put_progress(progress_queue, 2, "Loading job from URL…")
            try:
                job_text = await asyncio.to_thread(scrape_job_posting, url)
                _put_progress(progress_queue, 5, "Job loaded")
                _put_admin_log(
                    progress_queue,
                    user,
                    {"step": "scrape", "message": "Job URL scraped to text", "data": {"job_text_chars": len(job_text)}},
                )
            except CloudflareBlockedError:
                pool = await get_pool()
                await log_usage_event(
                    pool, audit_uid, "optimize_job_scrape", None, success=False, error_message="Cloudflare blocked"
                )
                return OptimizeResponse(
                    success=False,
                    validation=ValidationResultOut(passed=False, results=[]),
                    job=JobPostingOut(title="", company="", requirements=[], keywords=[], description=""),
                    error="Job URL blocked by bot protection. Paste job text instead.",
                )
            except Exception as e:
                pool = await get_pool()
                await log_usage_event(
                    pool, audit_uid, "optimize_job_scrape", None, success=False, error_message=str(e)[:2000]
                )
                return OptimizeResponse(
                    success=False,
                    validation=ValidationResultOut(passed=False, results=[]),
                    job=JobPostingOut(title="", company="", requirements=[], keywords=[], description=""),
                    error=str(e),
                )
        if not job_text:
            raise HTTPException(400, "Provide job_text or job_url")

    _put_admin_log(
        progress_queue,
        user,
        {
            "step": "job_text",
            "message": "Job description text ready for pipeline" if not req.improve_mode else "Improve mode — no job text",
            "data": {"chars": len(job_text or ""), "improve_mode": req.improve_mode, "from_scrape": bool(req.job_url and req.job_text is None)},
        },
    )

    source = ResumeSource(content=req.resume_content)
    _put_progress(progress_queue, 7, "Extracting name from resume…")
    _name_cache_key = _cache_key("name:", req.resume_content)
    _cached_name = _cache_get(_name_cache_key)
    if _cached_name is not None:
        source.first_name, source.last_name = _cached_name
        _put_progress(progress_queue, 10, "Name extracted")
    else:
        try:
            first_name, last_name = await extract_name(req.resume_content, audit_user_id=audit_uid)
            source.first_name = first_name
            source.last_name = last_name
            _cache_set(_name_cache_key, (first_name, last_name))
            _put_progress(progress_queue, 10, "Name extracted")
            _put_admin_log(
                progress_queue,
                user,
                {
                    "step": "name",
                    "message": "Name extracted from resume (LLM)",
                    "data": {"first_name": source.first_name, "last_name": source.last_name},
                },
            )
        except Exception as e:
            logger.exception("Optimize failed")
            err_msg = _API_KEY_INVALID_MSG if _is_api_key_invalid(e) else str(e)
            pool = await get_pool()
            await log_usage_event(
                pool, audit_uid, "optimize_extract_name", None, success=False, error_message=err_msg[:2000]
            )
            return OptimizeResponse(
                success=False,
                validation=ValidationResultOut(passed=False, results=[]),
                job=JobPostingOut(title="", company="", requirements=[], keywords=[], description=""),
                error=err_msg,
            )
    extracted_full_name = _compose_person_name(source.first_name, source.last_name)
    if not extracted_full_name:
        guessed_full_name = _guess_name_from_resume_text(extract_text_from_html(req.resume_content))
        if guessed_full_name:
            guessed_first, guessed_last = _split_full_name(guessed_full_name)
            source.first_name = guessed_first
            source.last_name = guessed_last
            extracted_full_name = guessed_full_name

    def on_progress(percent: int, message: str) -> None:
        _put_progress(progress_queue, percent, message)

    def push_admin_log(entry: dict[str, Any]) -> None:
        _put_admin_log(progress_queue, user, entry)

    out_lang = (req.output_language or "en").strip().lower() or "en"
    _job_cache_key = _cache_key("job:", job_text or "__improve_mode__") if not req.improve_mode else None
    _cached_job = _cache_get(_job_cache_key) if _job_cache_key else None
    try:
        optimized, validation, job = await optimize_for_job(
            source,
            job_text=job_text if _cached_job is None and not req.improve_mode else None,
            job=_cached_job,
            max_iterations=1,
            parallel=req.parallel,
            on_progress=on_progress if progress_queue is not None else None,
            on_admin_log=push_admin_log if _is_admin_user(user) else None,
            no_shame=req.aggressive_tailoring,
            output_language=out_lang,
            audit_user_id=audit_uid,
            pre_ats_score=req.pre_ats_score,
            pre_keyword_score=req.pre_keyword_score,
            improve_mode=req.improve_mode,
        )
        # Store result for future reuse if it wasn't cached already
        if _cached_job is None and _job_cache_key is not None:
            _cache_set(_job_cache_key, job)
    except Exception as e:
        logger.exception("Optimize failed")
        err_msg = _API_KEY_INVALID_MSG if _is_api_key_invalid(e) else str(e)
        pool = await get_pool()
        await log_usage_event(
            pool, audit_uid, "optimize_pipeline", None, success=False, error_message=err_msg[:2000]
        )
        return OptimizeResponse(
            success=False,
            validation=ValidationResultOut(passed=False, results=[]),
            job=JobPostingOut(title="", company="", requirements=[], keywords=[], description=""),
            error=err_msg,
        )

    # Single strict pass only: no second deep-retry generation.

    validation_out = ValidationResultOut(
        passed=validation.passed,
        results=[
            FilterResultOut(
                filter_name=r.filter_name,
                passed=r.passed,
                score=r.score,
                threshold=r.threshold,
                issues=r.issues,
                suggestions=r.suggestions,
            )
            for r in validation.results
        ],
    )
    job_out = JobPostingOut(
        title=job.title,
        company=job.company,
        requirements=job.requirements,
        keywords=job.keywords,
        description=job.description,
    )
    key_changes_out = None
    if optimized and optimized.changes:
        key_changes_out = [
            ChangeDetailOut(category=c.category, description=c.description, items=c.items)
            for c in optimized.changes
        ]

    _put_admin_log(
        progress_queue,
        user,
        {
            "step": "pipeline_job",
            "message": "Job posting after optimize loop",
            "data": {
                "title": job.title,
                "company": job.company,
                "keywords_n": len(job.keywords or []),
            },
        },
    )
    _put_admin_log(
        progress_queue,
        user,
        {
            "step": "validation_summary",
            "message": "Validation filters summary",
            "data": {
                "passed": validation.passed,
                "filters": [
                    {"name": r.filter_name, "passed": r.passed, "score": round(float(r.score), 4)}
                    for r in validation.results
                ],
            },
        },
    )

    opt_uid = str(user["id"]) if user and user.get("id") else None

    pdf_filename = None
    pdf_b64 = None
    pending_export_token: str | None = None
    pending_export_expires_at: str | None = None
    optimized_resume_text: str | None = None
    schema_json: str | None = None
    post_ats: int | None = None
    post_kw: float | None = None
    snapshot_url_out: str | None = None
    snapshot_expires_at_out: str | None = None
    _put_progress(progress_queue, 85, "Saving PDF…")
    can_export_pdf = True
    if user and not _is_admin_user(user):
        pool_for_sub = await get_pool()
        if pool_for_sub:
            sub = await user_get_subscription(pool_for_sub, str(user["id"]))
            if (sub.get("plan") or "free") == "free":
                can_export_pdf = False

    async def _extract_schema_json_for_templates() -> str | None:
        """Second LLM pass for template JSON; runs in parallel with PDF save / post-ATS to shorten wall time."""
        if not optimized or not optimized.html:
            return None
        try:
            from hr_breaker.agents.resume_schema_extractor import extract_resume_schema_strict

            _put_progress(progress_queue, 90, "Extracting structured data for templates…")
            schema_obj = await extract_resume_schema_strict(
                optimized.html,
                target_role=job.title,
                target_locale=out_lang,
                source_checksum=source.checksum,
            )
            extracted_full_name = _compose_person_name(source.first_name, source.last_name)
            if extracted_full_name and _is_placeholder_person_name(schema_obj.basics.name):
                schema_obj.basics.name = extracted_full_name
            return schema_obj.model_dump_json()
        except Exception as e:
            logger.warning("Failed to extract schema for templates: %s", e)
            return None

    schema_extract_task: asyncio.Task[str | None] | None = None
    if optimized and optimized.html:
        schema_extract_task = asyncio.create_task(_extract_schema_json_for_templates())

    if optimized and optimized.pdf_bytes and can_export_pdf:
        unique_suffix = datetime.now().strftime("%Y%m%d_%H%M%S")
        pdf_path = pdf_storage.generate_path(
            source.first_name, source.last_name, job.company, job.title,
            unique_suffix=unique_suffix,
        )
        pdf_path.parent.mkdir(parents=True, exist_ok=True)
        pdf_path.write_bytes(optimized.pdf_bytes)
        # Post ATS: same methodology as pre (score_resume_vs_job on text) so "до" and "после" are comparable
        try:
            optimized_resume_text = await asyncio.to_thread(extract_text_from_pdf_bytes, optimized.pdf_bytes)
            post_ats = await score_resume_vs_job(optimized_resume_text, job)
        except Exception as e:
            logger.warning("Post ATS score from text failed, falling back to LLMChecker score: %s", e)
            for r in validation.results:
                if r.filter_name == "LLMChecker":
                    post_ats = round(r.score * 100)
                    break
        for r in validation.results:
            if r.filter_name == "KeywordMatcher":
                post_kw = r.score
                break
        _put_admin_log(
            progress_queue,
            user,
            {
                "step": "pdf_export",
                "message": "PDF written to disk; extracted text for post-ATS score",
                "data": {
                    "path": pdf_path.name,
                    "pdf_bytes": len(optimized.pdf_bytes),
                    "extracted_text_chars": len(optimized_resume_text or ""),
                    "post_ats_score": post_ats,
                    "post_keyword_score": post_kw,
                },
            },
        )
        pdf_storage.save_source_content(source.checksum, source.content)
        company_logo_url: str | None = None
        if req.job_url:
            try:
                company_logo_url = await asyncio.to_thread(
                    extract_company_logo_url, _sanitize_url(req.job_url)
                )
            except Exception as e:
                logger.debug("Logo extraction skipped for %s: %s", req.job_url, e)
        user_id = str(user["id"]) if user else None
        await pdf_storage.save_record_async(GeneratedPDF(
            path=pdf_path,
            source_checksum=source.checksum,
            company=job.company,
            job_title=job.title,
            first_name=source.first_name,
            last_name=source.last_name,
            pre_ats_score=req.pre_ats_score,
            post_ats_score=post_ats,
            pre_keyword_score=req.pre_keyword_score,
            post_keyword_score=post_kw,
            company_logo_url=company_logo_url,
            job_url=req.job_url,
            source_was_pdf=req.source_was_pdf,
        ), user_id=user_id)
        pdf_filename = pdf_path.name
        pdf_b64 = base64.b64encode(optimized.pdf_bytes).decode()
    elif optimized and optimized.pdf_bytes and not can_export_pdf:
        txt = (optimized.pdf_text or "").strip()
        if txt:
            optimized_resume_text = txt
        if user and user.get("id"):
            pending_name = pdf_storage.generate_path(
                source.first_name, source.last_name, job.company, job.title,
                unique_suffix=datetime.now().strftime("%Y%m%d_%H%M%S"),
            ).name
            pending_export_token, pending_exp_ts = _save_pending_export(
                user_id=str(user["id"]),
                pdf_bytes=optimized.pdf_bytes,
                filename=pending_name,
                meta={
                    "source_checksum": source.checksum,
                    "company": job.company,
                    "job_title": job.title,
                    "first_name": source.first_name,
                    "last_name": source.last_name,
                    "pre_ats_score": req.pre_ats_score,
                    "pre_keyword_score": req.pre_keyword_score,
                    "job_url": req.job_url,
                    "source_was_pdf": bool(req.source_was_pdf),
                },
            )
            pending_export_expires_at = datetime.fromtimestamp(pending_exp_ts, tz=timezone.utc).isoformat()
            _put_admin_log(
                progress_queue,
                user,
                {
                    "step": "pending_export",
                    "message": "PDF generated but held for upgrade (no direct download on free)",
                    "data": {"pdf_bytes": len(optimized.pdf_bytes), "has_text_fallback": bool(txt)},
                },
            )
    if schema_extract_task is not None:
        schema_json = await schema_extract_task
    # Comparable post scores for DB snapshot / response when PDF was not saved to history (free hold) or text-only path
    if post_kw is None and validation.results:
        for r in validation.results:
            if r.filter_name == "KeywordMatcher":
                post_kw = r.score
                break
    if post_ats is None and optimized_resume_text and job and optimized_resume_text.strip():
        try:
            post_ats = await score_resume_vs_job(optimized_resume_text.strip(), job)
        except Exception as e:
            logger.warning("Post ATS score from resume text failed: %s", e)
            for r in validation.results:
                if r.filter_name == "LLMChecker":
                    post_ats = round(r.score * 100)
                    break
    _put_progress(progress_queue, 100, "Done")

    if opt_uid:
        pool_rd = await get_pool()
        if pool_rd and validation.passed and optimized and optimized.pdf_bytes:
            await user_increment_readiness(pool_rd, opt_uid, delta=READINESS_DELTA_OPTIMIZE)
        if (
            pool_rd
            and opt_uid != "local"
            and not _is_admin_user(user)
            and optimized
        ):
            u_done = await user_get_by_id(pool_rd, opt_uid)
            if u_done:
                pln = u_done.get("subscription_plan") or "free"
                stt = u_done.get("subscription_status") or "free"
                paid_done = pln in ("trial", "monthly") and stt in ("active", "trial")
                if not paid_done:
                    await user_increment_free_optimize(pool_rd, opt_uid)

    pool_done = await get_pool()
    ok = validation.passed and bool(optimized and optimized.pdf_bytes)
    snapshot_saved = False
    if audit_uid and pool_done:
        opt_fail_reason: str | None = None
        if not ok:
            if not optimized:
                opt_fail_reason = "Optimizer produced no result"
            elif not getattr(optimized, "pdf_bytes", None):
                opt_fail_reason = "PDF was not generated (no bytes from renderer)"
            elif not validation.passed:
                opt_fail_reason = "Validation filters did not pass"
            else:
                opt_fail_reason = "Optimize finished without a successful PDF"
        oc_meta: dict = {
            "validation_passed": validation.passed,
            "has_pdf": bool(optimized and optimized.pdf_bytes),
        }
        if pending_export_token:
            oc_meta["pending_export"] = True
        await log_usage_event(
            pool_done,
            audit_uid,
            "optimize_complete",
            None,
            success=ok,
            error_message=opt_fail_reason,
            metadata=oc_meta,
        )
    # Save snapshot whenever the optimizer produced output — regardless of validation.passed.
    # The frontend transitions to "result" stage for any non-error response, so the user always
    # sees their result; we must always persist it so they can return via email link.
    has_optimizer_output = bool(optimized and optimized.pdf_bytes)
    if pool_done and has_optimizer_output and opt_uid and opt_uid != "local":
        try:
            snap_exp = datetime.now(timezone.utc) + timedelta(days=3)
            tpl_snap = (req.session_template_id or "").strip()[:200] or None
            photo_snap = _sanitize_photo_for_snapshot(req.session_photo_data_url)
            analyze_snap = _sanitize_session_analyze_payload(req.session_analyze)
            payload_snap: dict[str, Any] = {
                "stage": 4,
                "job": job_out.model_dump(),
                "validation": validation_out.model_dump(),
                "key_changes": [c.model_dump() for c in key_changes_out] if key_changes_out else [],
                "schema_json": schema_json,
                "pre_ats_score": req.pre_ats_score,
                "pre_keyword_score": req.pre_keyword_score,
                "post_ats_score": post_ats,
                "post_keyword_score": post_kw,
                "pending_export_token": pending_export_token,
                "job_url": req.job_url,
                "optimized_resume_text": optimized_resume_text,
                "selected_template_id": tpl_snap,
                "photo_data_url": photo_snap,
                "pre_analyze": analyze_snap,
                "snapshot_source_was_pdf": bool(req.source_was_pdf),
            }
            snap_id = await optimization_snapshot_insert(
                pool_done,
                user_id=opt_uid,
                pdf_filename=pdf_filename,
                payload=payload_snap,
                expires_at=snap_exp,
            )
            if snap_id:
                snapshot_saved = True
                tok = create_optimize_snapshot_token(opt_uid, snap_id, snap_exp)
                base_pub = (settings.email_public_base_url or settings.frontend_url or "").strip().rstrip("/")
                snapshot_url_out = f"{base_pub}/optimize?resume={quote(tok, safe='')}"
                snapshot_expires_at_out = snap_exp.isoformat()
                try:
                    await optimize_session_draft_delete(pool_done, opt_uid)
                except Exception as e:
                    logger.warning("optimize_session_draft_delete: %s", e)
        except Exception:
            logger.exception("optimization_snapshot_insert failed for user_id=%s", opt_uid)
    else:
        snapshot_saved = False

    # Schedule win-back when a snapshot was persisted (same bar as email deep link), not only when filters passed.
    if pool_done and snapshot_saved:
        from hr_breaker.services.email_winback import maybe_schedule_winback_after_optimize

        try:
            await maybe_schedule_winback_after_optimize(
                pool_done, user, optimize_succeeded=True, is_admin_user_fn=_is_admin_user
            )
        except Exception as e:
            logger.warning("Win-back schedule skipped: %s", e)

    return OptimizeResponse(
        success=ok,
        pdf_base64=pdf_b64,
        pdf_filename=pdf_filename,
        pending_export_token=pending_export_token,
        pending_export_expires_at=pending_export_expires_at,
        validation=validation_out,
        job=job_out,
        key_changes=key_changes_out,
        optimized_resume_text=optimized_resume_text,
        schema_json=schema_json,
        snapshot_url=snapshot_url_out,
        snapshot_expires_at=snapshot_expires_at_out,
    )


@router.post("/optimize", response_model=OptimizeResponse)
async def api_optimize(req: OptimizeRequest, user: dict | None = Depends(get_current_user)) -> OptimizeResponse:
    """Run full optimization: parse job (if needed), optimize, save PDF, return result (user-scoped when DB is used)."""
    return await _run_optimize(req, progress_queue=None, user=user)


@router.post("/optimize/stream")
async def api_optimize_stream(req: OptimizeRequest, user: dict | None = Depends(get_current_user)):
    """Stream progress events (SSE), then final result in last event."""
    queue: asyncio.Queue = asyncio.Queue()

    async def run_and_finish() -> None:
        try:
            result = await _run_optimize(req, progress_queue=queue, user=user)
            queue.put_nowait(("done", result))
        except Exception as e:
            logger.exception("Optimize stream failed: %s", e)
            queue.put_nowait(("error", str(e)))

    task = asyncio.create_task(run_and_finish())

    async def event_stream():
        try:
            while True:
                item = await asyncio.wait_for(queue.get(), timeout=300.0)
                if item[0] == "progress":
                    _, percent, message = item
                    yield f"data: {json.dumps({'percent': percent, 'message': message}, ensure_ascii=False)}\n\n"
                elif item[0] == "admin_log":
                    _, log_entry = item
                    yield f"data: {json.dumps({'log': log_entry}, ensure_ascii=False)}\n\n"
                elif item[0] == "done":
                    _, result = item
                    payload = {"percent": 100, "message": "Done", "result": result.model_dump(mode="json")}
                    yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                    break
                elif item[0] == "error":
                    _, err = item
                    yield f"data: {json.dumps({'percent': 100, 'error': err}, ensure_ascii=False)}\n\n"
                    break
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/optimize/pending-export/{token}")
async def api_download_pending_optimize_export(token: str, user: dict = Depends(get_current_user)):
    """Download previously generated optimize PDF after upgrade, without re-running optimize."""
    uid = str(user.get("id") or "")
    if not uid or uid == "local":
        raise HTTPException(401, "Sign in is required")
    if not _is_admin_user(user):
        pool = await get_pool()
        if not pool:
            raise HTTPException(503, "Database unavailable")
        sub = await user_get_subscription(pool, uid)
        plan = sub.get("plan") or "free"
        status = sub.get("status") or "free"
        has_paid = plan in ("trial", "monthly") and status in ("active", "trial")
        if not has_paid:
            raise HTTPException(402, "PDF export requires trial or subscription")

    pending = _read_pending_export(token)
    if not pending:
        raise HTTPException(404, "Saved optimize session not found or expired")
    meta = pending["meta"]
    owner_uid = str(meta.get("user_id") or "")
    if owner_uid != uid and not _is_admin_user(user):
        raise HTTPException(403, "Not allowed")
    pdf_path_pending: Path = pending["pdf_path"]
    if not pdf_path_pending.is_file():
        raise HTTPException(404, "Saved PDF not found")

    company = str(meta.get("company") or "")
    job_title = str(meta.get("job_title") or "")
    first_name = meta.get("first_name")
    last_name = meta.get("last_name")
    final_path = pdf_storage.generate_path(
        first_name, last_name, company, job_title, unique_suffix=datetime.now().strftime("%Y%m%d_%H%M%S")
    )
    final_path.parent.mkdir(parents=True, exist_ok=True)
    final_path.write_bytes(pdf_path_pending.read_bytes())
    await pdf_storage.save_record_async(
        GeneratedPDF(
            path=final_path,
            source_checksum=str(meta.get("source_checksum") or ""),
            company=company,
            job_title=job_title,
            timestamp=datetime.now(),
            first_name=first_name if isinstance(first_name, str) else None,
            last_name=last_name if isinstance(last_name, str) else None,
            pre_ats_score=meta.get("pre_ats_score"),
            post_ats_score=None,
            pre_keyword_score=meta.get("pre_keyword_score"),
            post_keyword_score=None,
            company_logo_url=None,
            job_url=meta.get("job_url"),
            source_was_pdf=bool(meta.get("source_was_pdf")),
        ),
        user_id=uid,
    )
    try:
        pending["meta_path"].unlink(missing_ok=True)
    except Exception:
        pass
    try:
        pdf_path_pending.unlink(missing_ok=True)
    except Exception:
        pass
    return FileResponse(
        final_path,
        media_type="application/pdf",
        filename=final_path.name,
        headers={"Cache-Control": "no-store"},
    )


class HealthLiveResponse(BaseModel):
    """Fast response for load balancers (Railway). Do not call DB here — first DB connect runs migrations and can exceed healthcheck timeout."""

    ok: bool = True
    service: str = "hr-breaker"


@router.get("/health", response_model=HealthLiveResponse)
async def api_health() -> HealthLiveResponse:
    return HealthLiveResponse()


@router.get("/health/db", response_model=HealthResponse)
async def api_health_db() -> HealthResponse:
    """Postgres reachability (can be slow on cold start while migrations run)."""
    settings = get_settings()
    if not (settings.database_url or "").strip():
        return HealthResponse(database="disabled", detail="DATABASE_URL not set")
    try:
        from hr_breaker.services.db import get_pool

        pool = await get_pool()
        if pool is None:
            return HealthResponse(database="error", detail="Pool not created (asyncpg missing or connection failed)")
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return HealthResponse(database="connected")
    except Exception as e:
        logger.exception("Health DB check failed: %s", e)
        return HealthResponse(database="error", detail=str(e))


# --- Admin (marichakgroup@gmail.com or ADMIN_EMAIL) ---


@router.post("/admin/resume-schema/extract", response_model=UnifiedResumeSchema)
async def api_admin_extract_resume_schema(
    req: AdminResumeSchemaExtractRequest,
    _admin: dict = Depends(get_admin_user),
) -> UnifiedResumeSchema:
    content = (req.resume_content or "").strip()
    if not content:
        raise HTTPException(400, "resume_content is required")
    checksum = hashlib.sha256(content.encode("utf-8")).hexdigest()
    schema = await extract_resume_schema_strict(
        content,
        target_role=req.target_role,
        target_locale=req.target_locale,
        source_checksum=checksum,
    )
    return schema


@router.post("/admin/resume-schema/extract-file", response_model=UnifiedResumeSchema)
async def api_admin_extract_resume_schema_file(
    file: UploadFile = File(...),
    target_role: str | None = Form(None),
    target_locale: str | None = Form(None),
    _admin: dict = Depends(get_admin_user),
) -> UnifiedResumeSchema:
    body = await file.read()
    text = (await _resume_upload_to_text(file.filename, body)).strip()
    if not text:
        raise HTTPException(400, "Could not extract text from file")
    checksum = hashlib.sha256(body).hexdigest()
    return await extract_resume_schema_strict(
        text,
        target_role=target_role,
        target_locale=target_locale,
        source_checksum=checksum,
    )


@router.get("/templates", response_model=AdminTemplateListResponse)
async def api_templates(
    _user: dict | None = Depends(get_current_user),
) -> AdminTemplateListResponse:
    items = [
        AdminTemplateListItem(
            id=t.id,
            name=t.name,
            source=t.source,
            supports_photo=t.supports_photo,
            supports_columns=t.supports_columns,
            pdf_stability_score=t.pdf_stability_score,
            default_css_vars=t.default_css_vars,
            recommended=t.recommended,
        )
        for t in list_templates()
    ]
    return AdminTemplateListResponse(items=items)


@router.post("/templates/render-pdf", response_model=AdminTemplateRenderPdfResponse)
async def api_templates_render_pdf(
    req: AdminTemplateRenderRequest,
    _user: dict | None = Depends(get_current_user),
) -> AdminTemplateRenderPdfResponse:
    try:
        html_body = render_template_html(req.resume_schema, req.template_id)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    renderer = HTMLRenderer()
    result = renderer.render(html_body)
    pdf_b64 = base64.b64encode(result.pdf_bytes).decode("utf-8")
    return AdminTemplateRenderPdfResponse(
        pdf_base64=pdf_b64,
        page_count=result.page_count,
        warnings=result.warnings,
    )


@router.get("/admin/templates", response_model=AdminTemplateListResponse)
async def api_admin_templates(
    _admin: dict = Depends(get_admin_user),
) -> AdminTemplateListResponse:
    items = [
        AdminTemplateListItem(
            id=t.id,
            name=t.name,
            source=t.source,
            supports_photo=t.supports_photo,
            supports_columns=t.supports_columns,
            pdf_stability_score=t.pdf_stability_score,
            default_css_vars=t.default_css_vars,
            recommended=t.recommended,
        )
        for t in list_templates()
    ]
    return AdminTemplateListResponse(items=items)


@router.post("/admin/templates/render-html", response_model=AdminTemplateRenderHtmlResponse)
async def api_admin_templates_render_html(
    req: AdminTemplateRenderRequest,
    _admin: dict = Depends(get_admin_user),
) -> AdminTemplateRenderHtmlResponse:
    try:
        html_body = render_template_html(req.resume_schema, req.template_id)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    full_html = wrap_full_html(html_body)
    return AdminTemplateRenderHtmlResponse(html_body=html_body, full_html=full_html)


@router.post("/admin/templates/render-pdf", response_model=AdminTemplateRenderPdfResponse)
async def api_admin_templates_render_pdf(
    req: AdminTemplateRenderRequest,
    _admin: dict = Depends(get_admin_user),
) -> AdminTemplateRenderPdfResponse:
    try:
        html_body = render_template_html(req.resume_schema, req.template_id)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    renderer = HTMLRenderer()
    result = renderer.render(html_body)
    pdf_b64 = base64.b64encode(result.pdf_bytes).decode("utf-8")
    return AdminTemplateRenderPdfResponse(
        pdf_base64=pdf_b64,
        page_count=result.page_count,
        warnings=result.warnings,
    )


@router.get("/admin/stats", response_model=AdminStatsResponse)
async def api_admin_stats(
    _admin: dict = Depends(get_admin_user),
) -> AdminStatsResponse:
    """Return counts and DB status for admin dashboard."""
    pool = await get_pool()
    db_status = "disabled"
    users_count = 0
    resumes_count = 0
    if pool:
        try:
            async with pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            db_status = "connected"
            users = await user_list_all(pool, limit=10_000)
            users_count = len(users)
            records = await pdf_storage.list_all_async(user_id=None)
            resumes_count = len(records)
        except Exception as e:
            logger.exception("Admin stats failed: %s", e)
            db_status = "error"
    return AdminStatsResponse(users_count=users_count, resumes_count=resumes_count, database=db_status)


@router.get("/admin/users", response_model=AdminUsersResponse)
async def api_admin_users(
    _admin: dict = Depends(get_admin_user),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> AdminUsersResponse:
    """List users (admin only), paginated."""
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    users, total = await user_list_paginated(pool, limit=limit, offset=offset)
    items = [
        AdminUserOut(
            id=str(u["id"]),
            email=u["email"],
            name=u.get("name"),
            created_at=u["created_at"].isoformat() if u.get("created_at") else "",
            subscription_status=(u.get("subscription_status") or "free").lower() if u.get("subscription_status") is not None else "free",
            subscription_plan=(u.get("subscription_plan") or "free").lower() if u.get("subscription_plan") is not None else "free",
            stripe_subscription_id=(str(u["stripe_subscription_id"]).strip() if u.get("stripe_subscription_id") else None),
            partner_program_access=bool(u.get("partner_program_access")),
            admin_blocked=bool(u.get("admin_blocked")),
        )
        for u in users
    ]
    return AdminUsersResponse(items=items, total=total)


@router.get("/admin/users/{user_id}/detail", response_model=AdminUserDetailResponse)
async def api_admin_user_detail(
    user_id: str,
    _admin: dict = Depends(get_admin_user),
) -> AdminUserDetailResponse:
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    detail = await _admin_build_user_detail(pool, user_id)
    if not detail:
        raise HTTPException(404, "User not found")
    return detail


@router.patch("/admin/users/{user_id}/blocked")
async def api_admin_user_blocked(
    user_id: str,
    body: AdminUserBlockedBody,
    _admin: dict = Depends(get_admin_user),
) -> dict[str, bool]:
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    target = await user_get_by_id(pool, user_id)
    if not target:
        raise HTTPException(404, "User not found")
    _reject_if_protected_admin_target(target)
    ok = await user_set_admin_blocked(pool, user_id, body.admin_blocked)
    if not ok:
        raise HTTPException(500, "Failed to update user")
    return {"ok": True}


@router.patch("/admin/users/{user_id}/subscription")
async def api_admin_user_subscription(
    user_id: str,
    body: AdminUserSubscriptionPatchBody,
    _admin: dict = Depends(get_admin_user),
) -> dict[str, bool]:
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    target = await user_get_by_id(pool, user_id)
    if not target:
        raise HTTPException(404, "User not found")
    _reject_if_protected_admin_target(target)
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(400, "No subscription fields to update")
    period_sent = "current_period_end" in patch
    period_val = patch.pop("current_period_end", None)
    kwargs: dict = {}
    if "subscription_status" in patch:
        kwargs["subscription_status"] = patch["subscription_status"]
    if "subscription_plan" in patch:
        kwargs["subscription_plan"] = patch["subscription_plan"]
    if kwargs:
        await user_update_subscription(pool, user_id, **kwargs)
    if period_sent:
        await user_set_current_period_end(pool, user_id, period_val)
    return {"ok": True}


@router.delete("/admin/users/{user_id}")
async def api_admin_user_delete(
    user_id: str,
    _admin: dict = Depends(get_admin_user),
) -> dict[str, bool]:
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    target = await user_get_by_id(pool, user_id)
    if not target:
        raise HTTPException(404, "User not found")
    _reject_if_protected_admin_target(target)
    ok = await user_delete_by_id(pool, user_id)
    if not ok:
        raise HTTPException(500, "Failed to delete user")
    return {"ok": True}


@router.get("/admin/config", response_model=AdminConfigResponse)
async def api_admin_config(
    _admin: dict = Depends(get_admin_user),
) -> AdminConfigResponse:
    """Return read-only config for admin (no secrets)."""
    settings = get_settings()
    origins = [o.strip() for o in (settings.landing_allowed_origins or "").split(",") if o.strip()]
    return AdminConfigResponse(
        database_configured=bool((settings.database_url or "").strip()),
        jwt_configured=bool((settings.jwt_secret or "").strip()),
        google_oauth_configured=bool((settings.google_oauth_client_id or "").strip()),
        stripe_configured=bool((settings.stripe_secret_key or "").strip() and (settings.stripe_price_monthly_id or "").strip()),
        landing_origins_count=len(origins),
        landing_rate_limit_hours=settings.landing_rate_limit_hours,
        landing_pending_ttl_seconds=settings.landing_pending_ttl_seconds,
        max_iterations=settings.max_iterations,
        frontend_url=settings.frontend_url or "",
        email_public_base_url=(settings.email_public_base_url or "").strip(),
        email_effective_public_base=public_base_for_email(settings),
        adzuna_configured=bool((settings.adzuna_app_id or "").strip() and (settings.adzuna_app_key or "").strip()),
        partner_program_enabled=bool(settings.partner_program_enabled),
    )


SEGMENT_OPTIMIZED_UNPAID = "optimized_unpaid_recent"


@router.get("/admin/email/control", response_model=AdminEmailControlOut)
async def api_admin_email_control(_admin: dict = Depends(get_admin_user)) -> AdminEmailControlOut:
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    settings = get_settings()
    cfg = await admin_email_settings_get(pool)
    pending = await email_winback_pending_count(pool)
    rk = bool((settings.resend_api_key or "").strip())
    rf = bool((settings.resend_from or "").strip())
    r_db = (cfg.get("resend_template_reminder_no_download") or "").strip()
    r_env = (settings.resend_template_reminder_no_download or "").strip()
    n_db = (cfg.get("resend_template_short_nudge") or "").strip()
    n_env = (settings.resend_template_short_nudge or "").strip()
    tr = bool(r_db or r_env)
    tn = bool(n_db or n_env)
    return AdminEmailControlOut(
        winback_auto_enabled=bool(cfg.get("winback_auto_enabled")),
        winback_delay_min_minutes=int(cfg.get("winback_delay_min_minutes") or 25),
        winback_delay_max_minutes=int(cfg.get("winback_delay_max_minutes") or 30),
        resend_configured=rk and rf,
        resend_from_configured=rf,
        pending_queue_count=pending,
        resend_template_reminder_configured=tr,
        resend_template_short_nudge_configured=tn,
        resend_template_reminder_no_download=str(cfg.get("resend_template_reminder_no_download") or ""),
        resend_template_short_nudge=str(cfg.get("resend_template_short_nudge") or ""),
    )


@router.patch("/admin/email/control", response_model=AdminEmailControlOut)
async def api_admin_email_control_patch(
    body: AdminEmailControlPatchBody,
    _admin: dict = Depends(get_admin_user),
) -> AdminEmailControlOut:
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    await admin_email_settings_update(
        pool,
        winback_auto_enabled=body.winback_auto_enabled,
        winback_delay_min_minutes=body.winback_delay_min_minutes,
        winback_delay_max_minutes=body.winback_delay_max_minutes,
        resend_template_reminder_no_download=body.resend_template_reminder_no_download,
        resend_template_short_nudge=body.resend_template_short_nudge,
    )
    settings = get_settings()
    cfg = await admin_email_settings_get(pool)
    pending = await email_winback_pending_count(pool)
    rk = bool((settings.resend_api_key or "").strip())
    rf = bool((settings.resend_from or "").strip())
    r_db = (cfg.get("resend_template_reminder_no_download") or "").strip()
    r_env = (settings.resend_template_reminder_no_download or "").strip()
    n_db = (cfg.get("resend_template_short_nudge") or "").strip()
    n_env = (settings.resend_template_short_nudge or "").strip()
    tr = bool(r_db or r_env)
    tn = bool(n_db or n_env)
    return AdminEmailControlOut(
        winback_auto_enabled=bool(cfg.get("winback_auto_enabled")),
        winback_delay_min_minutes=int(cfg.get("winback_delay_min_minutes") or 25),
        winback_delay_max_minutes=int(cfg.get("winback_delay_max_minutes") or 30),
        resend_configured=rk and rf,
        resend_from_configured=rf,
        pending_queue_count=pending,
        resend_template_reminder_configured=tr,
        resend_template_short_nudge_configured=tn,
        resend_template_reminder_no_download=str(cfg.get("resend_template_reminder_no_download") or ""),
        resend_template_short_nudge=str(cfg.get("resend_template_short_nudge") or ""),
    )


@router.post("/admin/email/queue/process")
async def api_admin_email_queue_process(
    _admin: dict = Depends(get_admin_user),
    limit: int = Query(25, ge=1, le=100),
) -> dict[str, Any]:
    """Process due win-back rows and due stagger rows (single cron URL — same as before for win-back, plus stagger)."""
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    from hr_breaker.services.email_winback import process_winback_due_batch
    from hr_breaker.services.email_stagger_campaign import process_stagger_due_batch

    winback = await process_winback_due_batch(pool, limit=limit)
    stagger = await process_stagger_due_batch(pool, limit=limit)
    return {"winback": winback, "stagger": stagger}


@router.get("/admin/email/resend/templates", response_model=list[AdminResendTemplateItem])
async def api_admin_email_resend_templates(_admin: dict = Depends(get_admin_user)) -> list[AdminResendTemplateItem]:
    """List Resend templates available for admin quick-send."""
    settings = get_settings()
    api_key = (settings.resend_api_key or "").strip()
    if not api_key:
        raise HTTPException(400, "RESEND_API_KEY is not set")
    try:
        items = await resend_list_templates(api_key=api_key)
    except Exception as e:
        logger.exception("Resend templates list failed: %s", e)
        msg = str(e).strip() or "Failed to load templates from Resend"
        raise HTTPException(502, msg[:2000])
    return [AdminResendTemplateItem(id=x["id"], name=x["name"]) for x in items]


@router.post("/admin/email/send-one", response_model=AdminEmailSendOneOut)
async def api_admin_email_send_one(
    body: AdminEmailSendOneBody,
    _admin: dict = Depends(get_admin_user),
) -> AdminEmailSendOneOut:
    """Simple manual send: one email + one explicit Resend template id."""
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    from hr_breaker.services.email_winback import send_resend_template_to_email

    em = (body.email or "").strip()
    if not em or "@" not in em:
        raise HTTPException(400, "Valid email is required")
    try:
        await send_resend_template_to_email(
            pool,
            to_email=em,
            resend_template_id=(body.resend_template_id or "").strip(),
        )
    except Exception as e:
        return AdminEmailSendOneOut(
            ok=False,
            email=em,
            resend_template_id=(body.resend_template_id or "").strip(),
            error=str(e)[:500],
        )
    return AdminEmailSendOneOut(
        ok=True,
        email=em,
        resend_template_id=(body.resend_template_id or "").strip(),
    )


@router.get("/admin/email/cta-info", response_model=AdminEmailCtaInfoOut)
async def api_admin_email_cta_info(
    email: str = Query(..., min_length=3, max_length=254),
    _admin: dict = Depends(get_admin_user),
) -> AdminEmailCtaInfoOut:
    """Preview for Quick send: valid optimization snapshot and/or saved PDF for CTA link."""
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    from hr_breaker.services.email_winback import admin_email_cta_digest_for_email

    settings = get_settings()
    d = await admin_email_cta_digest_for_email(pool, settings, email=email.strip())
    return AdminEmailCtaInfoOut(**d)


def _admin_dt_iso(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.isoformat()
    return str(v)


def _build_admin_automation_list_out(
    cfg: dict[str, Any],
    *,
    pending_winback: int,
    pending_stagger: int,
    pending_stagger_due: int = 0,
) -> AdminEmailAutomationsListOut:
    states = parse_automation_states(cfg.get("automation_states"))
    items: list[AdminEmailAutomationItemOut] = []
    for a in AUTOMATION_DEFINITIONS:
        aid = a["id"]
        row = states.get(aid)
        paused = bool((row or {}).get("paused")) if isinstance(row, dict) else False
        if aid == "post_optimize_winback":
            enabled = bool(cfg.get("winback_auto_enabled"))
            pend: int | None = pending_winback
            sup_en = True
            sup_pause = True
            sup_clear = True
        elif aid == "analyze_optimize_stagger_campaign":
            enabled = pending_stagger > 0
            pend = pending_stagger
            sup_en = False
            sup_pause = True
            sup_clear = True
        else:
            enabled = False
            pend = None
            sup_en = False
            sup_pause = False
            sup_clear = False
        pend_due: int | None = pending_stagger_due if aid == "analyze_optimize_stagger_campaign" else None
        items.append(
            AdminEmailAutomationItemOut(
                id=aid,
                name=a["name"],
                description=a["description"],
                channel=a["channel"],
                dedupe_summary=a["dedupe_summary"],
                conditions_code=a["conditions_code"],
                wired=a["wired"],
                enabled=enabled,
                paused=paused,
                pending_queue_count=pend,
                pending_due_count=pend_due,
                supports_enable_toggle=sup_en,
                supports_pause=sup_pause,
                supports_clear_queue=sup_clear,
            )
        )
    return AdminEmailAutomationsListOut(items=items, global_pending_queue_count=pending_winback + pending_stagger)


@router.get("/admin/email/automations", response_model=AdminEmailAutomationsListOut)
async def api_admin_email_automations(_admin: dict = Depends(get_admin_user)) -> AdminEmailAutomationsListOut:
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    cfg = await admin_email_settings_get(pool)
    pending_w = await email_winback_pending_count(pool)
    pending_s = await email_stagger_pending_count(pool, campaign_kind=None)
    pending_s_due = await email_stagger_due_pending_count(pool, campaign_kind=None)
    return _build_admin_automation_list_out(
        cfg, pending_winback=pending_w, pending_stagger=pending_s, pending_stagger_due=pending_s_due
    )


@router.patch("/admin/email/automations/{automation_id}", response_model=AdminEmailAutomationsListOut)
async def api_admin_email_automations_patch(
    automation_id: str,
    body: AdminEmailAutomationPatchBody,
    _admin: dict = Depends(get_admin_user),
) -> AdminEmailAutomationsListOut:
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    aid = (automation_id or "").strip()
    if automation_def_by_id(aid) is None:
        raise HTTPException(404, "Unknown automation")
    if aid not in ("post_optimize_winback", "analyze_optimize_stagger_campaign"):
        raise HTTPException(400, "Unsupported automation for PATCH")
    if body.enabled is None and body.paused is None:
        raise HTTPException(400, "Provide enabled and/or paused")
    st_patch: dict[str, Any] | None = None
    if body.paused is not None:
        st_patch = {aid: {"paused": body.paused}}
    if aid == "post_optimize_winback":
        await admin_email_settings_update(
            pool,
            winback_auto_enabled=body.enabled,
            automation_states=st_patch,
        )
    else:
        if body.enabled is not None:
            raise HTTPException(400, "This flow has no enable toggle; use pause only.")
        await admin_email_settings_update(pool, automation_states=st_patch)
    cfg = await admin_email_settings_get(pool)
    pending_w = await email_winback_pending_count(pool)
    pending_s = await email_stagger_pending_count(pool, campaign_kind=None)
    pending_s_due = await email_stagger_due_pending_count(pool, campaign_kind=None)
    return _build_admin_automation_list_out(
        cfg, pending_winback=pending_w, pending_stagger=pending_s, pending_stagger_due=pending_s_due
    )


@router.post("/admin/email/automations/{automation_id}/clear-pending-queue", response_model=AdminEmailClearQueueOut)
async def api_admin_email_automations_clear_queue(
    automation_id: str,
    _admin: dict = Depends(get_admin_user),
) -> AdminEmailClearQueueOut:
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    aid = (automation_id or "").strip()
    if aid == "post_optimize_winback":
        n = await email_winback_delete_all_pending(pool)
        return AdminEmailClearQueueOut(deleted=n)
    if aid == "analyze_optimize_stagger_campaign":
        from hr_breaker.services.email_stagger_campaign import CAMPAIGN_KIND_ANALYZE_OPTIMIZE_UNPAID

        n = await email_stagger_delete_all_pending_and_processing(pool, campaign_kind=CAMPAIGN_KIND_ANALYZE_OPTIMIZE_UNPAID)
        return AdminEmailClearQueueOut(deleted=n)
    raise HTTPException(400, "Unknown automation for clear-pending-queue.")


@router.get("/admin/email/audience", response_model=AdminEmailAudienceResponse)
async def api_admin_email_audience(
    _admin: dict = Depends(get_admin_user),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    q: str | None = Query(None, max_length=200, description="Filter by email substring (case-insensitive)."),
    activity: Literal["any", "analyzed", "optimized", "login_only"] = Query(
        "any",
        description="Product activity: any; analyzed; optimized; login_only = no successful analyze/optimize in audit.",
    ),
) -> AdminEmailAudienceResponse:
    """All users (paginated) with analyze/optimize flags and recorded marketing sends (win-back + stagger)."""
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    rows, total = await admin_email_audience_list(pool, limit=limit, offset=offset, search=q, activity=activity)
    items = [
        AdminEmailAudienceUserOut(
            id=str(r["id"]),
            email=r.get("email"),
            name=r.get("name"),
            created_at=str(r.get("created_at") or ""),
            marketing_emails_opt_in=r.get("marketing_emails_opt_in"),
            has_analyzed=bool(r.get("has_analyzed")),
            has_optimized=bool(r.get("has_optimized")),
            winback_sent=int(r.get("winback_sent") or 0),
            winback_last_sent=str(r["winback_last_sent"]) if r.get("winback_last_sent") else None,
            stagger_sent_count=int(r.get("stagger_sent_count") or 0),
            stagger_campaign_kinds=str(r["stagger_campaign_kinds"]) if r.get("stagger_campaign_kinds") else None,
        )
        for r in rows
    ]
    return AdminEmailAudienceResponse(items=items, total=total)


@router.get("/admin/email/stagger-campaign/preview", response_model=AdminEmailStaggerPreviewOut)
async def api_admin_email_stagger_preview(
    max_ids: int = Query(
        100,
        ge=0,
        le=500,
        description="How many sample emails to return (same cohort as snapshot); 0 = count only, no addresses.",
    ),
    _admin: dict = Depends(get_admin_user),
) -> AdminEmailStaggerPreviewOut:
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    from hr_breaker.services.email_stagger_campaign import CAMPAIGN_KIND_ANALYZE_OPTIMIZE_UNPAID, preview_stagger_campaign

    d = await preview_stagger_campaign(
        pool, campaign_kind=CAMPAIGN_KIND_ANALYZE_OPTIMIZE_UNPAID, max_sample=max_ids
    )
    return AdminEmailStaggerPreviewOut(**d)


@router.post("/admin/email/stagger-campaign/snapshot", response_model=AdminEmailStaggerSnapshotOut)
async def api_admin_email_stagger_snapshot(
    body: AdminEmailStaggerSnapshotBody,
    admin: dict = Depends(get_admin_user),
) -> AdminEmailStaggerSnapshotOut:
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    from hr_breaker.services.email_stagger_campaign import CAMPAIGN_KIND_ANALYZE_OPTIMIZE_UNPAID, snapshot_enqueue_campaign

    admin_email = (admin.get("email") or "").strip() or None
    try:
        out = await snapshot_enqueue_campaign(
            pool,
            template_id=body.template_id.strip(),
            created_by_email=admin_email,
            campaign_kind=CAMPAIGN_KIND_ANALYZE_OPTIMIZE_UNPAID,
        )
    except ValueError as e:
        raise HTTPException(409, str(e)) from e
    return AdminEmailStaggerSnapshotOut(**out)


@router.post("/admin/email/stagger-campaign/process", response_model=AdminEmailStaggerProcessOut)
async def api_admin_email_stagger_process(_admin: dict = Depends(get_admin_user)) -> AdminEmailStaggerProcessOut:
    """One stagger send (respects run_at schedule). For cron use POST /admin/email/queue/process."""
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    from hr_breaker.services.email_stagger_campaign import process_stagger_next_send

    raw = await process_stagger_next_send(pool)
    return AdminEmailStaggerProcessOut(**raw)


class AdminEmailStaggerBatchOut(BaseModel):
    ok: bool
    paused: bool = False
    error: str | None = None
    message: str | None = None
    claimed: int = 0
    sent: int = 0
    failed: int = 0
    skipped: int = 0
    failed_details: list[str] = Field(default_factory=list)


@router.post("/admin/email/stagger-campaign/send-batch", response_model=AdminEmailStaggerBatchOut)
async def api_admin_email_stagger_send_batch(
    n: int = Query(20, ge=1, le=100, description="Number of emails to send immediately (ignores run_at schedule)."),
    _admin: dict = Depends(get_admin_user),
) -> AdminEmailStaggerBatchOut:
    """Send up to n pending stagger emails NOW, ignoring run_at schedule.
    Deduplication via email_stagger_sent_log — already-sent users are never re-sent even after page reload.
    """
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    from hr_breaker.services.email_stagger_campaign import process_stagger_batch_force

    raw = await process_stagger_batch_force(pool, n=n)
    return AdminEmailStaggerBatchOut(
        ok=bool(raw.get("ok", True)),
        paused=bool(raw.get("paused", False)),
        error=str(raw["error"]) if raw.get("error") else None,
        message=str(raw["message"]) if raw.get("message") else None,
        claimed=int(raw.get("claimed", 0)),
        sent=int(raw.get("sent", 0)),
        failed=int(raw.get("failed", 0)),
        skipped=int(raw.get("skipped", 0)),
        failed_details=[str(x) for x in (raw.get("failed_details") or [])],
    )


@router.get("/admin/email/user-journey", response_model=AdminUserJourneyOut)
async def api_admin_email_user_journey(
    email: str = Query(..., min_length=3, max_length=254),
    _admin: dict = Depends(get_admin_user),
) -> AdminUserJourneyOut:
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    em = email.strip()
    u = await user_get_by_email(pool, em)
    if not u:
        return AdminUserJourneyOut(
            email=em,
            user_found=False,
            optimize_snapshot=AdminOptimizeSnapshotSummaryOut(has_valid=False),
        )
    uid = str(u["id"])
    sub = await user_get_subscription(pool, uid)
    draft_row = await optimize_session_draft_get(pool, uid)
    draft_out: AdminOptimizeDraftSummaryOut | None = None
    if draft_row:
        pl_d = _draft_payload_dict(draft_row)
        draft_out = AdminOptimizeDraftSummaryOut(
            stage=_snap_int_field(pl_d.get("stage")),
            expires_at=_admin_dt_iso(draft_row.get("expires_at")),
            updated_at=_admin_dt_iso(draft_row.get("updated_at")),
        )
    snap_row = await optimization_snapshot_get_latest_valid(pool, uid)
    snap_sum = AdminOptimizeSnapshotSummaryOut(has_valid=False)
    if snap_row:
        pl_s = _optimization_snapshot_payload(snap_row)
        snap_sum = AdminOptimizeSnapshotSummaryOut(
            has_valid=True,
            expires_at=_admin_dt_iso(snap_row.get("expires_at")),
            stage=_snap_int_field(pl_s.get("stage")),
            created_at=_admin_dt_iso(snap_row.get("created_at")),
        )
    wb_rows = await email_winback_pending_list_for_user(pool, uid)
    wb_out: list[AdminWinbackPendingItemOut] = []
    for r in wb_rows:
        wb_out.append(
            AdminWinbackPendingItemOut(
                id=str(r.get("id") or ""),
                run_at=_admin_dt_iso(r.get("run_at")) or "",
                template_id=str(r.get("template_id") or ""),
                status=str(r.get("status") or ""),
            )
        )
    return AdminUserJourneyOut(
        email=em,
        user_found=True,
        user_id=uid,
        marketing_emails_opt_in=u.get("marketing_emails_opt_in"),
        subscription_plan=(sub or {}).get("plan"),
        subscription_status=(sub or {}).get("status"),
        admin_blocked=bool(u.get("admin_blocked")),
        optimize_draft=draft_out,
        optimize_snapshot=snap_sum,
        winback_pending=wb_out,
    )


@router.post("/admin/email/segment/preview", response_model=AdminEmailSegmentPreviewOut)
async def api_admin_email_segment_preview(
    body: AdminEmailSegmentPreviewBody,
    _admin: dict = Depends(get_admin_user),
) -> AdminEmailSegmentPreviewOut:
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    if body.segment_id != SEGMENT_OPTIMIZED_UNPAID:
        raise HTTPException(400, f"Unknown segment_id (supported: {SEGMENT_OPTIMIZED_UNPAID})")
    cnt = await email_segment_optimized_unpaid_count(pool, body.days)
    sample = await email_segment_optimized_unpaid_emails(pool, body.days, body.sample_limit)
    return AdminEmailSegmentPreviewOut(
        segment_id=body.segment_id,
        days=body.days,
        recipients_count=cnt,
        sample_emails=sample,
    )


@router.post("/admin/email/segment/send", response_model=AdminEmailSegmentSendOut)
async def api_admin_email_segment_send(
    body: AdminEmailSegmentSendBody,
    admin: dict = Depends(get_admin_user),
) -> AdminEmailSegmentSendOut:
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    if body.segment_id != SEGMENT_OPTIMIZED_UNPAID:
        raise HTTPException(400, f"Unknown segment_id (supported: {SEGMENT_OPTIMIZED_UNPAID})")
    from hr_breaker.services.email_winback import send_winback_to_email

    emails = await email_segment_optimized_unpaid_emails(pool, body.days, body.limit)
    admin_email = (admin.get("email") or "").strip() or None
    errors: list[str] = []
    sent = 0
    failed = 0
    if body.dry_run:
        await admin_email_campaign_log_insert(
            pool,
            segment_id=body.segment_id,
            template_id=body.template_id,
            dry_run=True,
            recipients_planned=len(emails),
            recipients_sent=0,
            error=None,
            created_by_email=admin_email,
        )
        return AdminEmailSegmentSendOut(
            segment_id=body.segment_id,
            template_id=body.template_id,
            dry_run=True,
            attempted=len(emails),
            sent=0,
            failed=0,
            errors_sample=[],
        )
    for em in emails:
        try:
            await send_winback_to_email(pool, to_email=em, template_id=body.template_id)
            sent += 1
        except Exception as e:
            failed += 1
            errors.append(f"{em}: {e}"[:500])
    await admin_email_campaign_log_insert(
        pool,
        segment_id=body.segment_id,
        template_id=body.template_id,
        dry_run=False,
        recipients_planned=len(emails),
        recipients_sent=sent,
        error=("; ".join(errors[:3]) if errors else None),
        created_by_email=admin_email,
    )
    return AdminEmailSegmentSendOut(
        segment_id=body.segment_id,
        template_id=body.template_id,
        dry_run=False,
        attempted=len(emails),
        sent=sent,
        failed=failed,
        errors_sample=errors[:5],
    )


def _email_unsubscribe_redirect_url(ok: bool) -> str:
    s = get_settings()
    base = (s.frontend_url or "http://localhost:5173").rstrip("/")
    return f"{base}/email/unsubscribed?{'ok' if ok else 'err'}=1"


@router.get("/email/unsubscribe")
async def api_email_unsubscribe(token: str = Query("", min_length=10)) -> RedirectResponse:
    """Public one-click unsubscribe from marketing email (JWT from outbound message). No login."""
    pool = await get_pool()
    if pool is None:
        return RedirectResponse(url=_email_unsubscribe_redirect_url(False), status_code=302)
    payload = decode_token(token.strip())
    if not payload or payload.get("purpose") != "email_unsub":
        return RedirectResponse(url=_email_unsubscribe_redirect_url(False), status_code=302)
    uid = str(payload.get("sub") or "").strip()
    if not uid:
        return RedirectResponse(url=_email_unsubscribe_redirect_url(False), status_code=302)
    await user_set_marketing_emails_opt_in(pool, uid, False)
    return RedirectResponse(url=_email_unsubscribe_redirect_url(True), status_code=302)


def _sanitize_photo_for_snapshot(raw: str | None, *, max_len: int = 700_000) -> str | None:
    if not raw:
        return None
    s = raw.strip()
    if len(s) > max_len:
        logger.warning("Ignoring session_photo_data_url for snapshot: length %s exceeds %s", len(s), max_len)
        return None
    return s


def _sanitize_session_analyze_payload(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if not raw or not isinstance(raw, dict):
        return None
    cleaned = {k: v for k, v in raw.items() if k != "admin_pipeline_log"}
    try:
        AnalyzeResponse.model_validate(cleaned)
        return cleaned
    except Exception:
        logger.warning("Ignoring invalid session_analyze for optimization snapshot")
        return None


@router.get("/email/open-resume")
async def api_email_open_resume(token: str = Query("", min_length=10)):
    """Open a specific saved resume from email using signed JWT token."""
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    payload = decode_token(token.strip())
    if not payload or payload.get("purpose") != "email_resume_open":
        raise HTTPException(401, "Invalid or expired token")
    uid = str(payload.get("sub") or "").strip()
    filename = str(payload.get("fn") or "").strip()
    if not uid or not filename or "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid link payload")
    record = await pdf_storage.get_record_by_filename_async(filename, user_id=uid)
    if not record:
        raise HTTPException(404, "Resume not found")
    settings = get_settings()
    path = settings.output_dir / filename
    if not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline"},
    )


def _optimization_snapshot_row_expires_at(row: dict[str, Any]) -> datetime:
    exp = row.get("expires_at")
    if exp is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    if getattr(exp, "tzinfo", None) is None:
        exp = exp.replace(tzinfo=timezone.utc)
    return exp


def _optimization_snapshot_payload(row: dict[str, Any]) -> dict[str, Any]:
    pl = row.get("payload") or {}
    if isinstance(pl, str):
        try:
            return json.loads(pl)
        except Exception:
            return {}
    if isinstance(pl, dict):
        return pl
    return {}


def _snap_int_field(v: Any) -> int | None:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(round(v))
    return None


def _snap_float_field(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    return None


async def _build_optimization_snapshot_public_out(row: dict[str, Any], user_id: str) -> OptimizationSnapshotPublicOut:
    exp = _optimization_snapshot_row_expires_at(row)
    pl = _optimization_snapshot_payload(row)
    raw_fn = row.get("pdf_filename")
    pdf_fn = str(raw_fn).strip() if raw_fn else ""
    if not pdf_fn or "/" in pdf_fn or "\\" in pdf_fn:
        pdf_fn = ""
    pdf_ok = False
    if pdf_fn:
        rec = await pdf_storage.get_record_by_filename_async(pdf_fn, user_id=user_id)
        if rec:
            path = get_settings().output_dir / pdf_fn
            pdf_ok = path.is_file()
    job_d = pl.get("job") or {}
    val_d = pl.get("validation") or {"passed": False, "results": []}
    kc_raw = pl.get("key_changes")
    key_changes: list[ChangeDetailOut] | None = None
    if isinstance(kc_raw, list) and kc_raw:
        try:
            key_changes = [ChangeDetailOut.model_validate(x) for x in kc_raw]
        except Exception:
            key_changes = None
    try:
        job_out = JobPostingOut.model_validate(job_d)
    except Exception:
        job_out = JobPostingOut(title="", company="", requirements=[], keywords=[], description="")
    try:
        validation_out = ValidationResultOut.model_validate(val_d)
    except Exception:
        validation_out = ValidationResultOut(passed=False, results=[])
    schema_json = pl.get("schema_json")
    if schema_json is not None and not isinstance(schema_json, str):
        schema_json = None
    _ju = pl.get("job_url")
    job_url_out: str | None = None
    if _ju is not None:
        js = str(_ju).strip()
        job_url_out = js or None
    _pet = pl.get("pending_export_token")
    pet_out: str | None = None
    if _pet is not None:
        ps = str(_pet).strip()
        pet_out = ps or None
    _ort = pl.get("optimized_resume_text")
    ort_out: str | None = None
    if _ort is not None:
        os_ = str(_ort)
        ort_out = os_ if os_.strip() else None

    pre_analyze_out: AnalyzeResponse | None = None
    pa_raw = pl.get("pre_analyze")
    if isinstance(pa_raw, dict):
        try:
            pad = {k: v for k, v in pa_raw.items() if k != "admin_pipeline_log"}
            pre_analyze_out = AnalyzeResponse.model_validate(pad)
        except Exception:
            pre_analyze_out = None

    tpl_raw = pl.get("selected_template_id")
    tpl_out = str(tpl_raw).strip()[:200] if tpl_raw is not None and str(tpl_raw).strip() else None
    ph_raw = pl.get("photo_data_url")
    photo_out: str | None = None
    if isinstance(ph_raw, str) and ph_raw.strip():
        phs = ph_raw.strip()
        photo_out = phs if len(phs) <= 700_000 else None
    swp = pl.get("snapshot_source_was_pdf")
    snapshot_source_was_pdf: bool | None = bool(swp) if swp is not None else None

    return OptimizationSnapshotPublicOut(
        expires_at=exp.isoformat(),
        pdf_filename=pdf_fn or None,
        pdf_download_available=pdf_ok,
        job=job_out,
        validation=validation_out,
        key_changes=key_changes,
        schema_json=schema_json,
        pre_ats_score=_snap_int_field(pl.get("pre_ats_score")),
        pre_keyword_score=_snap_float_field(pl.get("pre_keyword_score")),
        post_ats_score=_snap_int_field(pl.get("post_ats_score")),
        post_keyword_score=_snap_float_field(pl.get("post_keyword_score")),
        pending_export_token=pet_out,
        job_url=job_url_out,
        optimized_resume_text=ort_out,
        selected_template_id=tpl_out or None,
        photo_data_url=photo_out,
        pre_analyze=pre_analyze_out,
        snapshot_source_was_pdf=snapshot_source_was_pdf,
    )


def _draft_payload_dict(row: dict[str, Any]) -> dict[str, Any]:
    pl = row.get("payload") or {}
    if isinstance(pl, str):
        try:
            return json.loads(pl)
        except Exception:
            return {}
    if isinstance(pl, dict):
        return pl
    return {}


def _build_session_draft_restore_out(row: dict[str, Any]) -> SessionDraftRestoreOut:
    exp = row.get("expires_at")
    if exp is None:
        exp_s = ""
    elif isinstance(exp, datetime):
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        exp_s = exp.isoformat()
    else:
        exp_s = str(exp)
    pl = _draft_payload_dict(row)
    stage = int(pl.get("stage") or 0)
    resume_content = str(pl.get("resume_text") or pl.get("resume_content") or "")
    ju = pl.get("job_url")
    job_url_out: str | None = None
    if ju is not None:
        js = str(ju).strip()
        job_url_out = js or None
    job_d = pl.get("job") or {}
    try:
        job_out = JobPostingOut.model_validate(job_d)
    except Exception:
        job_out = JobPostingOut(title="", company="", requirements=[], keywords=[], description="")
    analyze_out: AnalyzeResponse | None = None
    ar = pl.get("analyze")
    if isinstance(ar, dict):
        try:
            pad = {k: v for k, v in ar.items() if k != "admin_pipeline_log"}
            analyze_out = AnalyzeResponse.model_validate(pad)
        except Exception:
            analyze_out = None
    tpl_raw = pl.get("selected_template_id")
    tpl_out = str(tpl_raw).strip()[:200] if tpl_raw is not None and str(tpl_raw).strip() else None
    return SessionDraftRestoreOut(
        expires_at=exp_s,
        stage=stage,
        resume_content=resume_content,
        job_url=job_url_out,
        job=job_out,
        analyze=analyze_out,
        selected_template_id=tpl_out or None,
    )


@router.get("/optimization-snapshot", response_model=OptimizationSnapshotPublicOut)
async def api_optimization_snapshot(token: str = Query("", min_length=10)) -> OptimizationSnapshotPublicOut:
    """Public JSON for saved optimize result (JWT from email or last run). No login."""
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    payload = decode_token(token.strip())
    if not payload or payload.get("purpose") != "optimize_snapshot":
        raise HTTPException(401, "Invalid or expired link")
    uid = str(payload.get("sub") or "").strip()
    sid = str(payload.get("sid") or "").strip()
    if not uid or not sid:
        raise HTTPException(400, "Invalid link payload")
    row = await optimization_snapshot_get_by_id_for_user(pool, snapshot_id=sid, user_id=uid)
    if not row:
        raise HTTPException(404, "Saved result not found")
    exp = _optimization_snapshot_row_expires_at(row)
    if exp <= datetime.now(timezone.utc):
        raise HTTPException(410, "This saved result has expired")
    return await _build_optimization_snapshot_public_out(row, uid)


@router.get("/optimization-snapshot/for-me", response_model=OptimizationResumeRestoreOut)
async def api_optimization_snapshot_for_me(
    token: str = Query("", min_length=10),
    user: dict = Depends(get_current_user),
) -> OptimizationResumeRestoreOut:
    """Snapshot (completed optimize) or mid-flow draft (session_draft JWT); requires login."""
    if not user or user.get("id") == "local":
        raise HTTPException(401, "Sign in to restore this session")
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    payload = decode_token(token.strip())
    if not payload:
        raise HTTPException(401, "Invalid or expired link")
    purpose = str(payload.get("purpose") or "")
    uid = str(payload.get("sub") or "").strip()
    if not uid:
        raise HTTPException(400, "Invalid link payload")
    if uid != str(user.get("id") or ""):
        raise HTTPException(403, "This link belongs to another account")
    if purpose == "optimize_snapshot":
        sid = str(payload.get("sid") or "").strip()
        if not sid:
            raise HTTPException(400, "Invalid link payload")
        row = await optimization_snapshot_get_by_id_for_user(pool, snapshot_id=sid, user_id=uid)
        if not row:
            raise HTTPException(404, "Saved result not found")
        exp = _optimization_snapshot_row_expires_at(row)
        if exp <= datetime.now(timezone.utc):
            raise HTTPException(410, "This saved result has expired")
        complete = await _build_optimization_snapshot_public_out(row, uid)
        return OptimizationResumeRestoreOut(kind="complete", complete=complete, draft=None)
    if purpose == "session_draft":
        drow = await optimize_session_draft_get(pool, uid)
        if not drow:
            raise HTTPException(404, "No saved in-progress session")
        exp_d = drow.get("expires_at")
        if isinstance(exp_d, datetime):
            if exp_d.tzinfo is None:
                exp_d = exp_d.replace(tzinfo=timezone.utc)
            if exp_d <= datetime.now(timezone.utc):
                raise HTTPException(410, "This session link has expired")
        draft = _build_session_draft_restore_out(drow)
        return OptimizationResumeRestoreOut(kind="draft", complete=None, draft=draft)
    raise HTTPException(401, "Invalid or expired link")


@router.get("/optimization-snapshot/pdf")
async def api_optimization_snapshot_pdf(token: str = Query("", min_length=10)):
    """Serve PDF for a valid optimization snapshot token (same constraints as JSON)."""
    pool = await get_pool()
    if pool is None:
        raise HTTPException(503, "Database not configured")
    payload = decode_token(token.strip())
    if not payload or payload.get("purpose") != "optimize_snapshot":
        raise HTTPException(401, "Invalid or expired link")
    uid = str(payload.get("sub") or "").strip()
    sid = str(payload.get("sid") or "").strip()
    if not uid or not sid:
        raise HTTPException(400, "Invalid link payload")
    row = await optimization_snapshot_get_by_id_for_user(pool, snapshot_id=sid, user_id=uid)
    if not row:
        raise HTTPException(404, "Saved result not found")
    exp = _optimization_snapshot_row_expires_at(row)
    if exp <= datetime.now(timezone.utc):
        raise HTTPException(410, "This saved result has expired")
    raw_fn = row.get("pdf_filename")
    pdf_fn = str(raw_fn).strip() if raw_fn else ""
    if not pdf_fn or "/" in pdf_fn or "\\" in pdf_fn:
        raise HTTPException(404, "No PDF for this saved result")
    rec = await pdf_storage.get_record_by_filename_async(pdf_fn, user_id=uid)
    if not rec:
        raise HTTPException(404, "Resume not found")
    settings = get_settings()
    path = settings.output_dir / pdf_fn
    if not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline"},
    )


def _admin_activity_file_kind(filename: str) -> str:
    return "uploaded" if (filename or "").lower().startswith("uploaded_") else "generated"


def _admin_has_stored_source(checksum: str) -> bool:
    cs = (checksum or "").strip()
    if not cs:
        return False
    p = pdf_storage.get_source_path(cs)
    return p is not None and p.is_file()


@router.get("/admin/activity", response_model=AdminActivityResponse)
async def api_admin_activity(
    _admin: dict = Depends(get_admin_user),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> AdminActivityResponse:
    """Recent resume generations (admin only). With DB: includes user email. Without DB: list from index, no email."""
    settings = get_settings()
    pool = await get_pool()
    items: list[AdminActivityItem] = []
    total = 0
    if pool:
        try:
            rows, total = await db_recent_resumes_with_user(
                pool, settings.output_dir, limit=limit, offset=offset
            )
            for r in rows:
                fn = r["filename"]
                items.append(AdminActivityItem(
                    filename=fn,
                    company=r["company"],
                    job_title=r["job_title"],
                    created_at=r["created_at"].isoformat() if r.get("created_at") else "",
                    user_email=r.get("user_email"),
                    pdf_on_disk=bool(r.get("pdf_on_disk", True)),
                    file_kind=_admin_activity_file_kind(fn),
                    source_was_pdf=bool(r.get("source_was_pdf")),
                    has_stored_source=_admin_has_stored_source(r.get("source_checksum") or ""),
                ))
        except Exception as e:
            logger.exception("Admin activity failed: %s", e)
    else:
        records = await pdf_storage.list_all_async(user_id=None)
        records = sorted(
            records,
            key=lambda x: x.timestamp or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        total = len(records)
        for r in records[offset : offset + limit]:
            path = settings.output_dir / r.path.name
            fn = r.path.name
            items.append(AdminActivityItem(
                filename=fn,
                company=r.company,
                job_title=r.job_title or "",
                created_at=r.timestamp.isoformat() if r.timestamp else "",
                user_email=None,
                pdf_on_disk=path.is_file(),
                file_kind=_admin_activity_file_kind(fn),
                source_was_pdf=bool(r.source_was_pdf),
                has_stored_source=_admin_has_stored_source(r.source_checksum or ""),
            ))
    return AdminActivityResponse(items=items, total=total)


def _safe_admin_pdf_filename(filename: str) -> str:
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "Invalid filename")
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Expected a PDF filename")
    return filename


@router.get("/admin/pdf/{filename}")
async def api_admin_pdf_open(filename: str, _admin: dict = Depends(get_admin_user)):
    """Serve a PDF from the output directory for inline viewing (admin only)."""
    fn = _safe_admin_pdf_filename(filename)
    settings = get_settings()
    path = settings.output_dir / fn
    if not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{fn}"'},
    )


@router.get("/admin/resume-source/{filename}")
async def api_admin_resume_source(filename: str, _admin: dict = Depends(get_admin_user)):
    """Download stored resume source text for a history filename (admin only)."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "Invalid filename")
    settings = get_settings()
    pool = await get_pool()
    record: GeneratedPDF | None = None
    if pool:
        record = await db_get_by_filename(pool, settings.output_dir, filename, user_id=None)
    else:
        record = pdf_storage.get_record_by_filename(filename)
    if not record or not (record.source_checksum or "").strip():
        raise HTTPException(404, "Record or source checksum not found")
    src = pdf_storage.get_source_path(record.source_checksum)
    if not src or not src.is_file():
        raise HTTPException(404, "Source text not on disk")
    safe_name = f"source_{filename.replace('.pdf', '')[:80]}.txt"
    return FileResponse(
        src,
        media_type="text/plain; charset=utf-8",
        filename=safe_name,
    )


@router.get("/admin/usage-audit", response_model=AdminUsageAuditResponse)
async def api_admin_usage_audit(
    _admin: dict = Depends(get_admin_user),
    limit: int = Query(200, ge=1, le=2000),
) -> AdminUsageAuditResponse:
    """LLM usage, models, tokens, and logged errors per user (admin)."""
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    rows = await usage_audit_list_admin(pool, limit=limit)
    items: list[AdminUsageAuditItem] = []
    for r in rows:
        meta = r.get("metadata") or {}
        if hasattr(meta, "keys") and not isinstance(meta, dict):
            meta = dict(meta)
        elif not isinstance(meta, dict):
            meta = {}
        items.append(
            AdminUsageAuditItem(
                id=str(r["id"]),
                user_email=r.get("user_email"),
                action=r.get("action") or "",
                model=r.get("model"),
                success=bool(r.get("success", True)),
                error_message=r.get("error_message"),
                input_tokens=int(r.get("input_tokens") or 0),
                output_tokens=int(r.get("output_tokens") or 0),
                metadata=meta,
                created_at=r["created_at"].isoformat() if r.get("created_at") else "",
            )
        )
    return AdminUsageAuditResponse(items=items)


@router.patch("/admin/users/{user_id}/partner-access")
async def api_admin_user_partner_access(
    user_id: str,
    body: AdminPartnerAccessBody,
    _admin: dict = Depends(get_admin_user),
) -> dict:
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    ok = await user_set_partner_program_access(pool, user_id, body.partner_program_access)
    if not ok:
        raise HTTPException(404, "User not found")
    return {"ok": True, "partner_program_access": body.partner_program_access}


@router.get("/admin/referrals/chains", response_model=AdminReferralChainsResponse)
async def api_admin_referral_chains(
    _admin: dict = Depends(get_admin_user),
    limit: int = Query(200, ge=1, le=1000),
) -> AdminReferralChainsResponse:
    if not _partner_enabled():
        raise HTTPException(404, "Partner program disabled")
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    rows = await referral_admin_chains(pool, limit=limit)
    items = [
        AdminReferralChainItem(
            id=str(r["id"]),
            first_seen_at=r["first_seen_at"].isoformat() if r.get("first_seen_at") else "",
            expires_at=r["expires_at"].isoformat() if r.get("expires_at") else "",
            attribution_status=r.get("attribution_status") or "",
            attribution_reason=r.get("attribution_reason"),
            code=r.get("code") or "",
            referrer_email=r.get("referrer_email"),
            invited_email=r.get("invited_email"),
            commission_id=str(r["commission_id"]) if r.get("commission_id") else None,
            amount_cents=int(r["amount_cents"]) if r.get("amount_cents") is not None else None,
            currency=r.get("currency"),
            commission_status=r.get("commission_status"),
            commission_reason=r.get("commission_reason"),
        )
        for r in rows
    ]
    return AdminReferralChainsResponse(items=items)


@router.get("/admin/referrals/events", response_model=AdminReferralEventsResponse)
async def api_admin_referral_events(
    _admin: dict = Depends(get_admin_user),
    limit: int = Query(300, ge=1, le=2000),
) -> AdminReferralEventsResponse:
    if not _partner_enabled():
        raise HTTPException(404, "Partner program disabled")
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    rows = await referral_admin_events(pool, limit=limit)
    items = [
        AdminReferralEventItem(
            id=str(r["id"]),
            event_type=r.get("event_type") or "",
            stripe_event_id=r.get("stripe_event_id"),
            user_email=r.get("user_email"),
            referrer_email=r.get("referrer_email"),
            invited_email=r.get("invited_email"),
            metadata=r.get("metadata") or {},
            created_at=r["created_at"].isoformat() if r.get("created_at") else "",
        )
        for r in rows
    ]
    return AdminReferralEventsResponse(items=items)


async def _admin_update_commission_status(
    admin_user: dict,
    req: AdminReferralActionRequest,
    *,
    status: str,
) -> dict[str, bool]:
    if not _partner_enabled():
        raise HTTPException(404, "Partner program disabled")
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    ok = await referral_admin_update_commission_status(
        pool,
        req.commission_id,
        status=status,
        reason=req.reason,
        reviewer_user_id=str(admin_user["id"]),
    )
    if not ok:
        raise HTTPException(404, "Commission not found")
    return {"ok": True}


@router.post("/admin/referrals/approve")
async def api_admin_referral_approve(
    req: AdminReferralActionRequest,
    admin_user: dict = Depends(get_admin_user),
) -> dict[str, bool]:
    return await _admin_update_commission_status(admin_user, req, status="approved")


@router.post("/admin/referrals/reject")
async def api_admin_referral_reject(
    req: AdminReferralActionRequest,
    admin_user: dict = Depends(get_admin_user),
) -> dict[str, bool]:
    return await _admin_update_commission_status(admin_user, req, status="rejected")


@router.post("/admin/referrals/hold")
async def api_admin_referral_hold(
    req: AdminReferralActionRequest,
    admin_user: dict = Depends(get_admin_user),
) -> dict[str, bool]:
    return await _admin_update_commission_status(admin_user, req, status="hold")


@router.post("/admin/referrals/block")
async def api_admin_referral_block(
    req: AdminReferralActionRequest,
    admin_user: dict = Depends(get_admin_user),
) -> dict[str, bool]:
    return await _admin_update_commission_status(admin_user, req, status="blocked")


# --- Landing reviews (pitchcv.app → my.pitchcv.app/api/reviews*) ---
@router.post("/reviews", response_model=None, status_code=201)
async def api_reviews_create(request: Request, body: ReviewCreateIn) -> Response | dict[str, str]:
    if body.fax_extension is not None and str(body.fax_extension).strip():
        return Response(status_code=204)
    if not body.consent_to_process:
        raise HTTPException(400, "consent_to_process must be true")
    if not body.consent_to_publish:
        raise HTTPException(400, "consent_to_publish must be true")
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    settings = get_settings()
    ip = _client_ip(request)
    lim_ip = max(1, settings.reviews_rate_limit_ip_per_hour)
    lim_em = max(1, settings.reviews_rate_limit_email_per_day)
    if await reviews_count_ip_recent(pool, ip, 1) >= lim_ip:
        raise HTTPException(
            429,
            {"error": "rate_limit", "detail": "Too many submissions from this network. Try again later."},
        )
    if await reviews_count_email_recent(pool, body.author_email, 1) >= lim_em:
        raise HTTPException(
            429,
            {"error": "rate_limit", "detail": "Too many submissions for this email. Try again tomorrow."},
        )
    wid = body.would_recommend == "yes"
    rid = await reviews_insert(
        pool,
        author_name=body.author_name,
        author_email=body.author_email,
        author_role=body.author_role,
        country=body.country,
        rating=body.rating,
        would_recommend=wid,
        title=body.title,
        body=body.body,
        feature_tag=body.feature_tag,
        consent_to_publish=body.consent_to_publish,
        source="native",
        submitter_ip=ip,
    )
    return {"id": rid, "status": "pending"}


@router.get("/reviews/public", response_model=ReviewPublicListOut)
async def api_reviews_public(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    sort: str = Query("recent"),
) -> ReviewPublicListOut:
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    rows = await reviews_list_public(pool, limit=limit, offset=offset, sort=sort)
    items = [ReviewPublicItem(**r) for r in rows]
    return ReviewPublicListOut(items=items)


@router.get("/reviews/stats", response_model=ReviewStatsOut)
async def api_reviews_stats() -> ReviewStatsOut:
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    s = await reviews_stats(pool)
    return ReviewStatsOut(**s)


@router.get("/reviews/export.csv")
async def api_reviews_export_csv(
    _admin: dict = Depends(get_admin_user),
    status: str | None = Query(None),
    rating: int | None = Query(None, ge=1, le=5),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
) -> Response:
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    df = _parse_review_date_query(date_from, end_of_day=False)
    dt = _parse_review_date_query(date_to, end_of_day=True)
    text = await reviews_export_csv(
        pool,
        status=status,
        rating=rating,
        date_from=df,
        date_to=dt,
    )
    return Response(
        content=text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="reviews_export.csv"'},
    )


@router.get("/reviews", response_model=ReviewsAdminListOut)
async def api_reviews_admin_list(
    _admin: dict = Depends(get_admin_user),
    status: str | None = Query(None),
    rating: int | None = Query(None, ge=1, le=5),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> ReviewsAdminListOut:
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    df = _parse_review_date_query(date_from, end_of_day=False)
    dt = _parse_review_date_query(date_to, end_of_day=True)
    rows, total = await reviews_list_admin(
        pool,
        status=status,
        rating=rating,
        date_from=df,
        date_to=dt,
        limit=limit,
        offset=offset,
    )
    return ReviewsAdminListOut(items=rows, total=total)


@router.patch("/reviews/{review_id}", response_model=None)
async def api_reviews_patch(
    review_id: str,
    body: ReviewPatchIn,
    admin_user: dict = Depends(get_admin_user),
) -> dict[str, Any]:
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(400, "No fields to update")
    row = await reviews_apply_patch(
        pool,
        review_id,
        moderator_user_id=str(admin_user["id"]),
        patch=patch,
    )
    if row is None:
        raise HTTPException(404, "Review not found")
    return row


@router.get("/history", response_model=HistoryResponse)
async def api_history(user: dict | None = Depends(get_current_user)) -> HistoryResponse:
    """List generated PDFs with metadata (scoped to user when DB is used)."""
    user_id = str(user["id"]) if user else None
    records = await pdf_storage.list_all_async(user_id=user_id)
    items = [
        HistoryItem(
            filename=r.path.name,
            company=r.company,
            job_title=r.job_title,
            timestamp=r.timestamp.isoformat(),
            first_name=r.first_name,
            last_name=r.last_name,
            pre_ats_score=r.pre_ats_score,
            post_ats_score=r.post_ats_score,
            pre_keyword_score=r.pre_keyword_score,
            post_keyword_score=r.post_keyword_score,
            company_logo_url=r.company_logo_url,
            job_url=r.job_url,
            source_checksum=r.source_checksum,
            source_was_pdf=r.source_was_pdf,
        )
        for r in records
    ]
    return HistoryResponse(items=items)


@router.get("/history/original/{filename}")
async def api_history_original(filename: str, user: dict | None = Depends(get_current_user)):
    """Download original resume content (as .txt) for a history record."""
    if "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid filename")
    user_id = str(user["id"]) if user else None
    record = await pdf_storage.get_record_by_filename_async(filename, user_id=user_id)
    if not record or not record.source_checksum:
        raise HTTPException(404, "Original not found")
    path = pdf_storage.get_source_path(record.source_checksum)
    dl_name = f"original_{record.company}_{record.job_title or 'resume'}.txt".replace(" ", "_")
    if path:
        return FileResponse(path, media_type="text/plain; charset=utf-8", filename=dl_name)
    # Fallback: return extracted text stored in DB alongside the uploaded PDF bytes.
    if filename.startswith("uploaded_"):
        pool = await get_pool()
        if pool:
            row = await uploaded_pdf_get(pool, source_checksum=record.source_checksum)
            if row and row["extracted_text"]:
                return Response(
                    content=row["extracted_text"].encode("utf-8"),
                    media_type="text/plain; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{dl_name}"'},
                )
    raise HTTPException(404, "Original content not stored")


@router.delete("/history/{filename}")
async def api_history_delete(filename: str, user: dict | None = Depends(get_current_user)):
    """Delete a history record and its PDF file (user-scoped when DB is used)."""
    if "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid filename")
    user_id = str(user["id"]) if user else None
    record = await pdf_storage.get_record_by_filename_async(filename, user_id=user_id)
    if not await pdf_storage.delete_record_async(filename, user_id=user_id):
        raise HTTPException(404, "Record not found")
    # Also remove uploaded PDF bytes from DB when deleting an uploaded source PDF.
    if filename.startswith("uploaded_") and record and record.source_checksum:
        try:
            pool = await get_pool()
            if pool:
                await uploaded_pdf_delete(pool, source_checksum=record.source_checksum)
        except Exception as e:
            logger.warning("uploaded_pdf_delete failed (non-fatal): %s", e)
    return {"ok": True}


@router.get("/history/download/{filename}")
async def api_download(filename: str, user: dict | None = Depends(get_current_user)):
    """Download a generated PDF by filename (user-scoped when DB is used). Paid plan required."""
    if "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid filename")
    user_id = str(user["id"]) if user else None
    if user_id:
        pool = await get_pool()
        if pool and not _is_admin_user(user):
            sub = await user_get_subscription(pool, user_id)
            if (sub.get("plan") or "free") == "free":
                raise HTTPException(402, "Upgrade to a paid plan to download PDFs")
        record = await pdf_storage.get_record_by_filename_async(filename, user_id=user_id)
        if not record:
            raise HTTPException(404, "File not found")
    settings = get_settings()
    path = settings.output_dir / filename
    if not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(path, filename=filename, media_type="application/pdf")


@router.get("/history/open/{filename}")
async def api_history_open(filename: str, user: dict | None = Depends(get_current_user)):
    """Serve PDF for display in browser (inline); user-scoped when DB is used."""
    if "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid filename")
    user_id = str(user["id"]) if user else None
    record = None
    if user_id:
        pool = await get_pool()
        if pool and not _is_admin_user(user):
            sub = await user_get_subscription(pool, user_id)
            if (sub.get("plan") or "free") == "free" and not filename.startswith("uploaded_"):
                raise HTTPException(
                    402,
                    "Upgrade to a paid plan to view PDFs. Go to Upgrade in the menu.",
                )
        record = await pdf_storage.get_record_by_filename_async(filename, user_id=user_id)
        if not record:
            raise HTTPException(404, "File not found")
    settings = get_settings()
    path = settings.output_dir / filename
    if not path.is_file():
        # Fallback: serve uploaded source PDF bytes from DB (survives container restarts).
        if filename.startswith("uploaded_") and record and record.source_checksum:
            pool = await get_pool()
            if pool:
                row = await uploaded_pdf_get(pool, source_checksum=record.source_checksum)
                if row and row["pdf_data"]:
                    return Response(
                        content=bytes(row["pdf_data"]),
                        media_type="application/pdf",
                        headers={"Content-Disposition": "inline"},
                    )
        raise HTTPException(404, "File not found")
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline"},
    )


@router.get("/history/thumbnail/{filename}")
async def api_history_thumbnail(filename: str, user: dict | None = Depends(get_current_user)):
    """Return first page of a generated PDF as PNG (user-scoped when DB is used)."""
    if "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid filename")
    user_id = str(user["id"]) if user else None
    record = None
    if user_id:
        record = await pdf_storage.get_record_by_filename_async(filename, user_id=user_id)
        if not record:
            raise HTTPException(404, "File not found")
    settings = get_settings()
    path = settings.output_dir / filename

    async def _render_pdf_thumbnail(pdf_bytes: bytes) -> Response:
        def _do() -> bytes:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            try:
                if doc.page_count == 0:
                    raise ValueError("PDF has no pages")
                page = doc[0]
                pix = page.get_pixmap(dpi=120, alpha=False)
                return pix.tobytes("png")
            finally:
                doc.close()

        try:
            png = await asyncio.to_thread(_do)
            return Response(
                content=png,
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=86400"},
            )
        except Exception as e:
            logger.exception("Thumbnail render failed for %s: %s", filename, e)
            raise HTTPException(500, "Failed to generate thumbnail")

    if not path.is_file():
        # Fallback: render thumbnail from uploaded PDF bytes stored in DB.
        if filename.startswith("uploaded_") and record and record.source_checksum:
            pool = await get_pool()
            if pool:
                row = await uploaded_pdf_get(pool, source_checksum=record.source_checksum)
                if row and row["pdf_data"]:
                    return await _render_pdf_thumbnail(bytes(row["pdf_data"]))
        raise HTTPException(404, "File not found")
    try:
        pdf_bytes = await asyncio.to_thread(path.read_bytes)
        return await _render_pdf_thumbnail(pdf_bytes)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Thumbnail failed for %s: %s", filename, e)
        raise HTTPException(500, "Failed to generate thumbnail")


@router.get("/settings", response_model=SettingsResponse)
async def api_settings() -> SettingsResponse:
    """Return public settings for UI."""
    settings = get_settings()
    return SettingsResponse(
        has_api_key=bool(settings.google_api_key),
        max_iterations=settings.max_iterations,
        output_dir=str(settings.output_dir.resolve()),
    )


def _adzuna_job_to_card(job: dict, country: str = "de") -> VacancyCard:
    """Map Adzuna job dict to VacancyCard."""
    job_id = str(job.get("id", ""))
    company = job.get("company") or {}
    company_name = company.get("display_name", "") if isinstance(company, dict) else str(company)
    loc = job.get("location") or {}
    location_name = loc.get("display_name") if isinstance(loc, dict) else None
    salary_min = job.get("salary_min")
    salary_max = job.get("salary_max")
    salary_text = None
    if salary_min is not None or salary_max is not None:
        if salary_min and salary_max:
            salary_text = f"{salary_min:,} – {salary_max:,} €".replace(",", " ")
        elif salary_min:
            salary_text = f"от {salary_min:,} €".replace(",", " ")
        elif salary_max:
            salary_text = f"до {salary_max:,} €".replace(",", " ")
    desc = (job.get("description") or "")[:300]
    if len((job.get("description") or "")) > 300:
        desc = desc.rstrip() + "…"
    return VacancyCard(
        id=f"adzuna_{country}_{job_id}",
        title=job.get("title") or "",
        company=company_name,
        location=location_name,
        salary_min=salary_min,
        salary_max=salary_max,
        salary_text=salary_text,
        contract_type=job.get("contract_type") or job.get("contract_time"),
        posted_at=job.get("created"),
        snippet=desc or None,
        url=job.get("redirect_url") or "",
        source="adzuna",
    )


@router.get("/vacancies/search", response_model=VacancySearchResponse)
async def api_vacancies_search(
    q: str = Query(..., min_length=1, max_length=200),
    location: str | None = Query(None, max_length=100),
    full_time: bool | None = Query(None),
    permanent: bool | None = Query(None),
    salary_min: int | None = Query(None, ge=0),
    page: int = Query(1, ge=1, le=50),
    page_size: int = Query(20, ge=1, le=50),
) -> VacancySearchResponse:
    """Search job vacancies (Adzuna, Germany). Requires ADZUNA_APP_ID and ADZUNA_APP_KEY in .env."""
    import httpx

    settings = get_settings()
    if not settings.adzuna_app_id or not settings.adzuna_app_key:
        raise HTTPException(
            503,
            "Job search not configured. Add ADZUNA_APP_ID and ADZUNA_APP_KEY to .env (get keys at https://developer.adzuna.com/).",
        )
    country = "de"
    url = f"https://api.adzuna.com/v1/api/jobs/{country}/search/{page}"
    params = {
        "app_id": settings.adzuna_app_id,
        "app_key": settings.adzuna_app_key,
        "what": q.strip(),
        "results_per_page": page_size,
    }
    if location and location.strip():
        params["where"] = location.strip()
    if full_time is True:
        params["full_time"] = "1"
    if permanent is True:
        params["permanent"] = "1"
    if salary_min is not None:
        params["salary_min"] = str(salary_min)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPStatusError as e:
        logger.warning("Adzuna API error: %s", e.response.text)
        raise HTTPException(502, "Job search service is temporarily unavailable.")
    except httpx.RequestError as e:
        logger.warning("Adzuna request failed: %s", e)
        raise HTTPException(502, "Could not reach job search service.")
    results = data.get("results") or []
    total = data.get("count") if isinstance(data.get("count"), int) else len(results)
    items = [_adzuna_job_to_card(j, country) for j in results]
    return VacancySearchResponse(items=items, total=total, page=page, page_size=page_size)


async def _startup_seed_and_backfill() -> None:
    """Runs after app listens — avoids Railway healthcheck timeout when DB connect/migrations are slow."""
    try:
        pool = await get_pool()
        if pool is None:
            return
        user_id = await ensure_seed_user(pool)
        n = await backfill_user_id(pool, user_id)
        if n:
            logger.info("Backfilled %d history record(s) to user marichakgroup@gmail.com", n)
    except Exception as e:
        logger.exception("Startup seed/backfill failed: %s", e)


@app.on_event("startup")
async def startup_deferred_seed() -> None:
    """Do not await DB here: Neon/asyncpg connect + migrations can exceed healthcheck window (503)."""
    asyncio.create_task(_startup_seed_and_backfill())


app.include_router(router)

# Serve React SPA when frontend_dist is present (e.g. in Docker: /app/frontend_dist)
_frontend_dist = Path.cwd() / "frontend_dist"
if not _frontend_dist.is_dir():
    _frontend_dist = Path(__file__).resolve().parent.parent / "frontend_dist"
if _frontend_dist.is_dir():
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/") or full_path == "api":
            raise HTTPException(404)
        path = _frontend_dist / full_path
        if path.is_file():
            return FileResponse(path)
        return FileResponse(_frontend_dist / "index.html")


def run_api(host: str = "0.0.0.0", port: int = 8000, reload: bool = False) -> None:
    import uvicorn
    uvicorn.run(
        "hr_breaker.api:app",
        host=host,
        port=port,
        reload=reload,
        reload_dirs=["src"] if reload else None,
    )
