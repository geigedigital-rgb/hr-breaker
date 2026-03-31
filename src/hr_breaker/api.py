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
import secrets
import tempfile
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Request, Query, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, Response, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi import FastAPI
from pydantic import BaseModel, Field

from hr_breaker.agents import extract_name, extract_resume_summary, get_breakdown_scores, parse_job_posting, score_resume_vs_job
from hr_breaker.config import get_settings
from hr_breaker.filters.keyword_matcher import check_keywords
from hr_breaker.services.pdf_parser import extract_text_from_pdf, extract_text_from_pdf_bytes
import fitz  # pymupdf
from hr_breaker.models import GeneratedPDF, JobPosting, ResumeSource, ValidationResult
from hr_breaker.orchestration import optimize_for_job
from hr_breaker.services import PDFStorage, scrape_job_posting, CloudflareBlockedError
from hr_breaker.services.job_scraper import extract_company_logo_url
from hr_breaker.services.auth import create_access_token, decode_token, hash_password, verify_password
from hr_breaker.services.usage_audit import log_usage_event
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

# For SSE progress events
def _put_progress(queue: asyncio.Queue | None, percent: int, message: str) -> None:
    if queue is not None:
        try:
            queue.put_nowait(("progress", percent, message))
        except asyncio.QueueFull:
            pass

logger = logging.getLogger(__name__)


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
    max_iterations: int | None = None
    parallel: bool = True
    aggressive_tailoring: bool = False  # True = add skills from job (with user warning)
    pre_ats_score: int | None = None  # from /analyze, for history
    pre_keyword_score: float | None = None  # from /analyze, for history
    source_was_pdf: bool = False  # True when user uploaded original as PDF (for Home filter + thumbnail)
    output_language: str | None = None  # e.g. "en", "ru". Default: English for all LLM output


class AnalyzeRequest(BaseModel):
    resume_content: str
    job_text: str | None = None
    job_url: str | None = None
    output_language: str | None = None  # e.g. "en", "ru". Default: English


class RecommendationItem(BaseModel):
    category: str
    labels: list[str]


class AnalyzeResponse(BaseModel):
    ats_score: int  # 0-100
    keyword_score: float
    keyword_threshold: float
    job: JobPostingOut | None = None  # parsed job for preview when job_url was used
    recommendations: list[RecommendationItem] = Field(default_factory=list)
    # Independent breakdown from LLM (Skills, Experience, Portfolio) 0-100
    skills_score: int | None = None
    experience_score: int | None = None
    portfolio_score: int | None = None
    # LLM-provided rejection risk 0-100 and top critical reasons
    rejection_risk_score: int | None = None
    critical_issues: list[str] = Field(default_factory=list)
    risk_summary: str | None = None
    improvement_tips: str | None = None  # LLM-generated tips with headers for "recommendations" block


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
    validation: ValidationResultOut
    job: JobPostingOut
    key_changes: list[ChangeDetailOut] | None = None
    error: str | None = None
    optimized_resume_text: str | None = None  # for "improve more" — next round uses this as resume_content


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
    user = await user_get_by_id(pool, payload["sub"])
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
    user = await user_get_by_id(pool, payload["sub"])
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


async def get_admin_user(user: dict | None = Depends(get_current_user)) -> dict:
    """Require current user and admin email; else 403."""
    if not user:
        raise HTTPException(403, "Not authenticated")
    if not _is_admin_user(user):
        raise HTTPException(403, "Admin access required")
    return user


_FUNNEL_ANALYSIS_ACTIONS = frozenset({
    "analyze_ats_score",
    "analyze_breakdown",
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
        extra: list[str] = []
        if pre_s is not None or post_s is not None:
            extra.append(f"ATS {pre_s if pre_s is not None else '—'}→{post_s if post_s is not None else '—'}")
        ju = (r.get("job_url") or "").strip()
        if ju:
            extra.append(ju if len(ju) <= 96 else f"{ju[:93]}…")
        detail_resume = fname
        if extra:
            detail_resume = f"{fname} · " + " · ".join(extra) if fname else " · ".join(extra)
        journey.append(AdminJourneyEntryOut(
            kind="resume",
            at=cr.isoformat() if cr and hasattr(cr, "isoformat") else "",
            title=f'PDF resume: {(r.get("company") or "—")} / {(r.get("job_title") or "—")}',
            detail=detail_resume or fname or None,
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
    adzuna_configured: bool
    partner_program_enabled: bool


class AdminActivityItem(BaseModel):
    filename: str
    company: str
    job_title: str
    created_at: str
    user_email: str | None = None
    pdf_on_disk: bool = True


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
    Save resume + job for landing→login→claim flow. No auth. Returns token for /login?pending=TOKEN.
    CORS only from LANDING_ALLOWED_ORIGINS. Token TTL: LANDING_PENDING_TTL_SECONDS (default 15 min).
    """
    settings = get_settings()
    ip = _client_ip(request)

    resume_content = ""
    resume_filename = "resume.txt"
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

    if not job_text:
        raise HTTPException(400, "Provide job description text (job_text).")

    job_text_resolved = job_text
    job_title: str | None = None
    try:
        job = await parse_job_posting(job_text_resolved)
        job_title = job.title or None
    except Exception:
        pass
    if not job_text_resolved or not job_text_resolved.strip():
        raise HTTPException(400, "Job text is empty.")

    token = secrets.token_urlsafe(32)
    ttl = settings.landing_pending_ttl_seconds
    async with _landing_pending_lock:
        _landing_pending_cleanup(ttl)
        _landing_pending[token] = {
            "resume_content": resume_content,
            "job_text": job_text_resolved.strip(),
            "resume_filename": resume_filename,
            "job_title": job_title,
            "resume_pdf_body": body if resume and resume.filename and resume.filename.lower().endswith(".pdf") else None,
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
    ats_score, breakdown = await asyncio.gather(
        score_resume_vs_job(resume_content, job),
        get_breakdown_scores(resume_content, job),
    )
    job_out = JobPostingOut(
        title=job.title,
        company=job.company,
        requirements=job.requirements,
        keywords=job.keywords,
        description=job.description,
    )
    recommendations = _build_recommendations(
        ats_score=ats_score,
        keyword_score=kw_result.score,
        keyword_threshold=settings.filter_keyword_threshold,
        missing_keywords=kw_result.missing_keywords,
        job_keywords=job.keywords or [],
        has_requirements=bool(job.requirements),
    )
    logger.info("Landing analyze OK ip=%s ats=%s", ip, ats_score)
    risk_score = _normalize_rejection_risk(
        model_risk=breakdown.rejection_risk_score,
        critical_issues=breakdown.critical_issues,
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
        skills_score=breakdown.skills,
        experience_score=breakdown.experience,
        portfolio_score=breakdown.portfolio,
        rejection_risk_score=risk_score,
        critical_issues=breakdown.critical_issues,
        risk_summary=breakdown.risk_summary,
        improvement_tips=breakdown.improvement_tips,
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
            pix = page.get_pixmap(dpi=120)
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
_KEYWORD_NOISE = frozenset({"m", "w", "d", "m w", "w d", "m d", "m w d", "w m", "d m", "d w"})
_MIN_KEYWORD_LEN = 3
_MAX_KEYWORDS_DISPLAY = 7


def _filter_meaningful_keywords(
    missing_keywords: list[str],
    job_keywords: list[str],
) -> list[str]:
    """Оставляем только осмысленные термины; приоритет — недостающие ключевые слова из вакансии (job.keywords)."""
    job_lower = {k.strip().lower() for k in job_keywords if k and len(k.strip()) >= _MIN_KEYWORD_LEN}
    seen: set[str] = set()
    result: list[str] = []

    def _ok(k: str) -> bool:
        return (
            len(k) >= _MIN_KEYWORD_LEN
            and k not in _KEYWORD_NOISE
            and not k.isdigit()
        )

    # Сначала — недостающие термины, которые явно указаны в вакансии (job.keywords)
    for kw in missing_keywords:
        k = (kw or "").strip().lower()
        if not k or k in seen or not _ok(k):
            continue
        if k not in job_lower:
            continue
        seen.add(k)
        result.append(kw.strip())
        if len(result) >= _MAX_KEYWORDS_DISPLAY:
            return result
    # Затем — остальные из missing (TF-IDF), без шума
    for kw in missing_keywords:
        k = (kw or "").strip().lower()
        if not k or k in seen or not _ok(k):
            continue
        seen.add(k)
        result.append(kw.strip())
        if len(result) >= _MAX_KEYWORDS_DISPLAY:
            break
    return result


def _build_recommendations(
    ats_score: int,
    keyword_score: float,
    keyword_threshold: float,
    missing_keywords: list[str],
    job_keywords: list[str],
    has_requirements: bool,
) -> list[RecommendationItem]:
    """Return three categories in a stable order."""
    meaningful = _filter_meaningful_keywords(missing_keywords, job_keywords or [])
    need_kw = keyword_score < keyword_threshold
    need_structure = ats_score < 70
    need_requirements = has_requirements and (ats_score < 80 or keyword_score < keyword_threshold)

    # Labels: max 2 words for UI chips (green check = OK, orange ! = improve).
    if need_kw:
        kw_labels = ["Add keywords"] if not meaningful else [f"{w}" for w in meaningful[:3]]  # 1–2 word keywords when possible
        if len(kw_labels) > 1 and any(len(l.split()) > 2 for l in kw_labels):
            kw_labels = ["Add keywords"]
    else:
        kw_labels = ["OK"]

    structure_label = "Clear sections" if need_structure else "OK"
    requirements_label = "Match requirements" if need_requirements else "OK"

    return [
        RecommendationItem(category="Keywords", labels=kw_labels),
        RecommendationItem(category="Structure", labels=[structure_label]),
        RecommendationItem(category="Requirements", labels=[requirements_label]),
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
            u_data = await user_get_by_id(pool, user_id)
            if u_data:
                plan = u_data.get("subscription_plan") or "free"
                status = u_data.get("subscription_status") or "free"
                has_paid = plan in ("trial", "monthly") and status in ("active", "trial")
                if not has_paid:
                    free_count = u_data.get("free_analyses_count", 0)
                    if free_count >= 1:
                        raise HTTPException(402, "Free plan limit reached (1 scan). Please upgrade to a paid plan for unlimited ATS scans.")
                
                # Increment regardless of plan so we track usage
                await user_increment_free_analyses(pool, user_id)

    settings = get_settings()
    if not settings.google_api_key:
        raise HTTPException(503, "GOOGLE_API_KEY not set. Add it to .env and restart the backend.")

    audit_uid = None
    if user and user.get("id") and str(user["id"]) != "local":
        audit_uid = str(user["id"])

    job_text = req.job_text
    if req.job_url and not job_text:
        url = _sanitize_url(req.job_url)
        if _is_job_list_url(url):
            raise HTTPException(
                422,
                "This is a job search page link. Use a link to a single job posting (e.g. indeed.com/viewjob?jk=...).",
            )
        try:
            job_text = await asyncio.to_thread(scrape_job_posting, url)
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
    if not job_text:
        raise HTTPException(400, "Provide job_text or job_url")

    try:
        job = await parse_job_posting(job_text, audit_user_id=audit_uid)
    except Exception as e:
        logger.exception("analyze job parse failed: %s", e)
        if _is_api_key_invalid(e):
            raise HTTPException(401, _API_KEY_INVALID_MSG)
        raise HTTPException(500, f"Job parse failed: {e!s}")

    resume_stripped = req.resume_content.strip()
    out_lang = (req.output_language or "en").strip().lower() or "en"
    kw_result = await asyncio.to_thread(check_keywords, resume_stripped, job)
    # Run ATS and breakdown (Skills/Experience/Portfolio) in parallel
    ats_score, breakdown = await asyncio.gather(
        score_resume_vs_job(resume_stripped, job, audit_user_id=audit_uid),
        get_breakdown_scores(resume_stripped, job, output_language=out_lang, audit_user_id=audit_uid),
    )
    job_out = JobPostingOut(
        title=job.title,
        company=job.company,
        requirements=job.requirements,
        keywords=job.keywords,
        description=job.description,
    )
    recommendations = _build_recommendations(
        ats_score=ats_score,
        keyword_score=kw_result.score,
        keyword_threshold=settings.filter_keyword_threshold,
        missing_keywords=kw_result.missing_keywords,
        job_keywords=job.keywords or [],
        has_requirements=bool(job.requirements),
    )
    if user:
        pool = await get_pool()
        if pool:
            await user_increment_readiness(pool, str(user["id"]), delta=READINESS_DELTA_ANALYSIS)
    risk_score = _normalize_rejection_risk(
        model_risk=breakdown.rejection_risk_score,
        critical_issues=breakdown.critical_issues,
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
        skills_score=breakdown.skills,
        experience_score=breakdown.experience,
        portfolio_score=breakdown.portfolio,
        rejection_risk_score=risk_score,
        critical_issues=breakdown.critical_issues,
        risk_summary=breakdown.risk_summary,
        improvement_tips=breakdown.improvement_tips,
    )


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
            u_data = await user_get_by_id(pool, user_id)
            if u_data:
                plan = u_data.get("subscription_plan") or "free"
                status = u_data.get("subscription_status") or "free"
                has_paid = plan in ("trial", "monthly") and status in ("active", "trial")
                if not has_paid:
                    free_opt = int(u_data.get("free_optimize_count") or 0)
                    if free_opt >= 1:
                        err_msg = (
                            "Free auto-improvement already used. Start a trial to run again and download PDFs."
                        )
                        _put_progress(progress_queue, 100, err_msg)
                        raise HTTPException(402, err_msg)

    settings = get_settings()
    if not settings.google_api_key:
        raise HTTPException(503, "GOOGLE_API_KEY not set. Add it to .env and restart the backend.")

    _put_progress(progress_queue, 0, "Starting…")
    job_text = req.job_text
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

    source = ResumeSource(content=req.resume_content)
    _put_progress(progress_queue, 7, "Extracting name from resume…")
    try:
        first_name, last_name = await extract_name(req.resume_content, audit_user_id=audit_uid)
        source.first_name = first_name
        source.last_name = last_name
        _put_progress(progress_queue, 10, "Name extracted")
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

    def on_progress(percent: int, message: str) -> None:
        _put_progress(progress_queue, percent, message)

    out_lang = (req.output_language or "en").strip().lower() or "en"
    try:
        optimized, validation, job = await optimize_for_job(
            source,
            job_text=job_text,
            max_iterations=req.max_iterations or settings.max_iterations,
            parallel=req.parallel,
            on_progress=on_progress if progress_queue is not None else None,
            no_shame=req.aggressive_tailoring,
            output_language=out_lang,
            audit_user_id=audit_uid,
        )
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

    opt_uid = str(user["id"]) if user and user.get("id") else None

    pdf_filename = None
    pdf_b64 = None
    optimized_resume_text: str | None = None
    _put_progress(progress_queue, 85, "Saving PDF…")
    can_export_pdf = True
    if user and not _is_admin_user(user):
        pool_for_sub = await get_pool()
        if pool_for_sub:
            sub = await user_get_subscription(pool_for_sub, str(user["id"]))
            if (sub.get("plan") or "free") == "free":
                can_export_pdf = False
    if optimized and optimized.pdf_bytes and can_export_pdf:
        unique_suffix = datetime.now().strftime("%Y%m%d_%H%M%S")
        pdf_path = pdf_storage.generate_path(
            source.first_name, source.last_name, job.company, job.title,
            unique_suffix=unique_suffix,
        )
        pdf_path.parent.mkdir(parents=True, exist_ok=True)
        pdf_path.write_bytes(optimized.pdf_bytes)
        post_ats = None
        post_kw = None
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
    if audit_uid and pool_done:
        ok = validation.passed and bool(optimized and optimized.pdf_bytes)
        await log_usage_event(
            pool_done,
            audit_uid,
            "optimize_complete",
            None,
            success=ok,
            metadata={"validation_passed": validation.passed, "has_pdf": bool(optimized and optimized.pdf_bytes)},
        )

    return OptimizeResponse(
        success=validation.passed and bool(optimized and optimized.pdf_bytes),
        pdf_base64=pdf_b64,
        pdf_filename=pdf_filename,
        validation=validation_out,
        job=job_out,
        key_changes=key_changes_out,
        optimized_resume_text=optimized_resume_text,
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
        adzuna_configured=bool((settings.adzuna_app_id or "").strip() and (settings.adzuna_app_key or "").strip()),
        partner_program_enabled=bool(settings.partner_program_enabled),
    )


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
                items.append(AdminActivityItem(
                    filename=r["filename"],
                    company=r["company"],
                    job_title=r["job_title"],
                    created_at=r["created_at"].isoformat() if r.get("created_at") else "",
                    user_email=r.get("user_email"),
                    pdf_on_disk=bool(r.get("pdf_on_disk", True)),
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
            items.append(AdminActivityItem(
                filename=r.path.name,
                company=r.company,
                job_title=r.job_title or "",
                created_at=r.timestamp.isoformat() if r.timestamp else "",
                user_email=None,
                pdf_on_disk=path.is_file(),
            ))
    return AdminActivityResponse(items=items, total=total)


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
    if not path:
        raise HTTPException(404, "Original content not stored")
    return FileResponse(
        path,
        media_type="text/plain; charset=utf-8",
        filename=f"original_{record.company}_{record.job_title or 'resume'}.txt".replace(" ", "_"),
    )


@router.delete("/history/{filename}")
async def api_history_delete(filename: str, user: dict | None = Depends(get_current_user)):
    """Delete a history record and its PDF file (user-scoped when DB is used)."""
    if "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid filename")
    user_id = str(user["id"]) if user else None
    if not await pdf_storage.delete_record_async(filename, user_id=user_id):
        raise HTTPException(404, "Record not found")
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
    if user_id:
        pool = await get_pool()
        if pool and not _is_admin_user(user):
            sub = await user_get_subscription(pool, user_id)
            if (sub.get("plan") or "free") == "free":
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
    if user_id:
        record = await pdf_storage.get_record_by_filename_async(filename, user_id=user_id)
        if not record:
            raise HTTPException(404, "File not found")
    settings = get_settings()
    path = settings.output_dir / filename
    if not path.is_file():
        raise HTTPException(404, "File not found")
    try:
        doc = fitz.open(path)
        try:
            if doc.page_count == 0:
                raise HTTPException(404, "PDF has no pages")
            page = doc[0]
            pix = page.get_pixmap(dpi=120)
            png_bytes = pix.tobytes("png")
            return Response(
                content=png_bytes,
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=86400"},
            )
        finally:
            doc.close()
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
