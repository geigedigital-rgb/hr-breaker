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
from datetime import datetime
from pathlib import Path

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
    user_get_id_by_stripe_customer_id,
    ensure_seed_user,
    backfill_user_id,
    user_list_all,
    db_list_all,
    db_recent_resumes_with_user,
    READINESS_DELTA_ANALYSIS,
    READINESS_DELTA_OPTIMIZE,
)

# For SSE progress events
def _put_progress(queue: asyncio.Queue | None, percent: int, message: str) -> None:
    if queue is not None:
        try:
            queue.put_nowait(("progress", percent, message))
        except asyncio.QueueFull:
            pass

logger = logging.getLogger(__name__)

# CORS: app frontend + landing (pitchcv.app)
_cors_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
if (get_settings().landing_allowed_origins or "").strip():
    _cors_origins = _cors_origins + [o.strip() for o in get_settings().landing_allowed_origins.split(",") if o.strip()]

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


class AnalyzeRequest(BaseModel):
    resume_content: str
    job_text: str | None = None
    job_url: str | None = None


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


# --- Auth ---
_http_bearer = HTTPBearer(auto_error=False)


class LoginRequest(BaseModel):
    email: str
    password: str


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


class AuthUserOut(BaseModel):
    id: str
    email: str
    name: str | None
    readiness: ReadinessOut | None = None
    subscription: SubscriptionOut | None = None


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
    return user


async def get_admin_user(user: dict | None = Depends(get_current_user)) -> dict:
    """Require current user and admin email; else 403."""
    if not user:
        raise HTTPException(403, "Not authenticated")
    settings = get_settings()
    admin_email = (settings.admin_email or "").strip().lower()
    if (user.get("email") or "").strip().lower() != admin_email:
        raise HTTPException(403, "Admin access required")
    return user


def _user_out(u: dict, subscription: dict | None = None) -> AuthUserOut:
    out = AuthUserOut(id=str(u["id"]), email=u["email"], name=u.get("name"))
    if subscription is not None:
        out.subscription = SubscriptionOut(
            plan=subscription.get("plan", "free"),
            status=subscription.get("status", "free"),
            current_period_end=subscription.get("current_period_end"),
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


class AdminUsersResponse(BaseModel):
    items: list[AdminUserOut]


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


class AdminActivityItem(BaseModel):
    filename: str
    company: str
    job_title: str
    created_at: str
    user_email: str | None = None


class AdminActivityResponse(BaseModel):
    items: list[AdminActivityItem]


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
async def api_google_login():
    """Redirect to Google OAuth consent screen. Frontend should open this URL (e.g. window.location or popup)."""
    settings = get_settings()
    if not settings.google_oauth_client_id:
        raise HTTPException(503, "Google OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID in .env")
    from urllib.parse import urlencode
    redirect_uri = f"{settings.frontend_url.rstrip('/')}/auth/callback"
    params = urlencode({
        "client_id": settings.google_oauth_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "consent",
    })
    return RedirectResponse(url=f"https://accounts.google.com/o/oauth2/v2/auth?{params}")


class GoogleCallbackRequest(BaseModel):
    code: str


@router.post("/auth/google/callback", response_model=LoginResponse)
async def api_google_exchange(req: GoogleCallbackRequest) -> LoginResponse:
    """Exchange Google OAuth code for our JWT. Call from frontend after redirect from Google."""
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    import httpx
    settings = get_settings()
    redirect_uri = f"{settings.frontend_url.rstrip('/')}/auth/callback"
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
    token = create_access_token(str(user["id"]), user["email"])
    subscription = await user_get_subscription(pool, str(user["id"]))
    return LoginResponse(access_token=token, user=_user_out(user, subscription=subscription))


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
_landing_pending: dict[str, dict] = {}  # token -> { resume_content, job_text, job_url, resume_filename, created_at }
_landing_pending_lock = asyncio.Lock()


def _landing_pending_cleanup(ttl_seconds: int) -> None:
    now = time.time()
    to_del = [k for k, v in _landing_pending.items() if now - v.get("created_at", 0) > ttl_seconds]
    for k in to_del:
        _landing_pending.pop(k, None)


class LandingSaveResponse(BaseModel):
    token: str
    resume_filename: str
    job_url: str | None = None
    job_title: str | None = None  # from parsed job if job_url was used


class LandingPendingResponse(BaseModel):
    resume_filename: str
    job_url: str | None = None
    job_title: str | None = None


class LandingClaimResponse(BaseModel):
    resume_content: str
    job_text: str | None = None
    job_url: str | None = None
    resume_filename: str


@router.post("/landing/save", response_model=LandingSaveResponse)
async def api_landing_save(
    request: Request,
    resume: UploadFile | None = File(None, description="Resume file (PDF, DOCX, or text)"),
    resume_text: str | None = Form(None, description="Resume as plain text (alternative to file)"),
    job_url: str | None = Form(None, description="URL of the job posting"),
    job_text: str | None = Form(None, description="Job description text (alternative to URL)"),
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

    if job_url and len(job_url) > settings.landing_max_job_url_len:
        raise HTTPException(400, "Job URL too long.")
    if not job_url and not job_text:
        raise HTTPException(400, "Provide job URL (job_url) or job text (job_text).")

    job_text_resolved = job_text
    job_title: str | None = None
    if job_url and not job_text_resolved:
        url = _sanitize_url(job_url)
        if _is_job_list_url(url):
            raise HTTPException(
                422,
                "This is a job search page link. Use a link to a single job posting.",
            )
        try:
            job_text_resolved = await asyncio.to_thread(scrape_job_posting, url)
        except CloudflareBlockedError:
            raise HTTPException(422, "Could not load job from URL. Paste the job description text manually.")
        except Exception as e:
            logger.warning("Landing save job scrape failed for %s: %s", ip, e)
            raise HTTPException(422, "Could not load job from URL.")
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
            "job_url": job_url.strip() if job_url else None,
            "resume_filename": resume_filename,
            "job_title": job_title,
            "created_at": time.time(),
        }
    logger.info("Landing save OK ip=%s token=%s", ip, token[:8])
    return LandingSaveResponse(
        token=token,
        resume_filename=resume_filename,
        job_url=job_url.strip() if job_url else None,
        job_title=job_title,
    )


@router.get("/landing/pending", response_model=LandingPendingResponse)
async def api_landing_pending(token: str = Query(..., description="Pending token from /landing/save")) -> LandingPendingResponse:
    """Return resume_filename and job_url for login page display. No auth. Token is not consumed."""
    settings = get_settings()
    ttl = settings.landing_pending_ttl_seconds
    async with _landing_pending_lock:
        _landing_pending_cleanup(ttl)
        data = _landing_pending.get(token)
    if not data:
        raise HTTPException(404, "Link expired or invalid. Upload your files again on the home page.")
    return LandingPendingResponse(
        resume_filename=data["resume_filename"],
        job_url=data.get("job_url"),
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
    return LandingClaimResponse(
        resume_content=data["resume_content"],
        job_text=data.get("job_text"),
        job_url=data.get("job_url"),
        resume_filename=data["resume_filename"],
    )


@router.post("/landing/analyze", response_model=AnalyzeResponse)
async def api_landing_analyze(
    request: Request,
    resume: UploadFile | None = File(None, description="Resume file (PDF, DOCX, or text)"),
    resume_text: str | None = Form(None, description="Resume as plain text (alternative to file)"),
    job_url: str | None = Form(None, description="URL of the job posting"),
    job_text: str | None = Form(None, description="Job description text (alternative to URL)"),
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

    # Job: URL or text
    if job_url and len(job_url) > settings.landing_max_job_url_len:
        raise HTTPException(400, "Job URL too long.")
    if not job_url and not job_text:
        raise HTTPException(400, "Provide job URL (job_url) or job text (job_text).")

    job_text_resolved = job_text
    if job_url and not job_text_resolved:
        url = _sanitize_url(job_url)
        if _is_job_list_url(url):
            raise HTTPException(
                422,
                "This is a job search page link. Use a link to a single job posting.",
            )
        try:
            job_text_resolved = await asyncio.to_thread(scrape_job_posting, url)
        except CloudflareBlockedError:
            raise HTTPException(422, "Could not load job from URL. Paste the job description text manually.")
        except Exception as e:
            logger.warning("Landing job scrape failed for %s: %s", ip, e)
            raise HTTPException(422, "Could not load job from URL.")
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
    return AnalyzeResponse(
        ats_score=ats_score,
        keyword_score=kw_result.score,
        keyword_threshold=settings.filter_keyword_threshold,
        job=job_out,
        recommendations=recommendations,
        skills_score=breakdown.skills,
        experience_score=breakdown.experience,
        portfolio_score=breakdown.portfolio,
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


class RegisterUploadResponse(BaseModel):
    """Response after registering an uploaded PDF for «Мои резюме»."""
    filename: str


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
    user_id = str(user["id"]) if user else None
    await pdf_storage.save_record_async(record, user_id=user_id)
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

    if need_kw:
        kw_labels = meaningful[:5] if meaningful else ["Skills from job description"]
    else:
        kw_labels = ["OK"]

    structure_label = (
        "Use clear sections (experience, education, skills) and headings for ATS"
        if need_structure
        else "OK"
    )
    requirements_label = (
        "Explicitly match job requirements in experience and skills"
        if need_requirements
        else "OK"
    )

    return [
        RecommendationItem(category="Keywords", labels=kw_labels),
        RecommendationItem(category="Structure", labels=[structure_label]),
        RecommendationItem(category="Requirements", labels=[requirements_label]),
    ]


@router.post("/analyze", response_model=AnalyzeResponse)
async def api_analyze(req: AnalyzeRequest, user: dict | None = Depends(get_optional_user)) -> AnalyzeResponse:
    """Pre-assessment: score current resume vs job (ATS + keywords) before optimization."""
    settings = get_settings()
    if not settings.google_api_key:
        raise HTTPException(503, "GOOGLE_API_KEY not set. Add it to .env and restart the backend.")

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
            raise HTTPException(422, "Job URL blocked by bot protection. Paste text instead.")
        except Exception as e:
            raise HTTPException(422, str(e))
    if not job_text:
        raise HTTPException(400, "Provide job_text or job_url")

    try:
        job = await parse_job_posting(job_text)
    except Exception as e:
        logger.exception("analyze job parse failed: %s", e)
        if _is_api_key_invalid(e):
            raise HTTPException(401, _API_KEY_INVALID_MSG)
        raise HTTPException(500, f"Job parse failed: {e!s}")

    resume_stripped = req.resume_content.strip()
    kw_result = await asyncio.to_thread(check_keywords, resume_stripped, job)
    # Run ATS and breakdown (Skills/Experience/Portfolio) in parallel
    ats_score, breakdown = await asyncio.gather(
        score_resume_vs_job(resume_stripped, job),
        get_breakdown_scores(resume_stripped, job),
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
    return AnalyzeResponse(
        ats_score=ats_score,
        keyword_score=kw_result.score,
        keyword_threshold=settings.filter_keyword_threshold,
        job=job_out,
        recommendations=recommendations,
        skills_score=breakdown.skills,
        experience_score=breakdown.experience,
        portfolio_score=breakdown.portfolio,
        improvement_tips=breakdown.improvement_tips,
    )


async def _run_optimize(
    req: OptimizeRequest,
    progress_queue: asyncio.Queue | None = None,
    user: dict | None = None,
) -> OptimizeResponse:
    """Run full optimization; optionally push (percent, message) to progress_queue."""
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
            return OptimizeResponse(
                success=False,
                validation=ValidationResultOut(passed=False, results=[]),
                job=JobPostingOut(title="", company="", requirements=[], keywords=[], description=""),
                error="Job URL blocked by bot protection. Paste job text instead.",
            )
        except Exception as e:
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
        first_name, last_name = await extract_name(req.resume_content)
        source.first_name = first_name
        source.last_name = last_name
        _put_progress(progress_queue, 10, "Name extracted")
    except Exception as e:
        logger.exception("Optimize failed")
        err_msg = _API_KEY_INVALID_MSG if _is_api_key_invalid(e) else str(e)
        return OptimizeResponse(
            success=False,
            validation=ValidationResultOut(passed=False, results=[]),
            job=JobPostingOut(title="", company="", requirements=[], keywords=[], description=""),
            error=err_msg,
        )

    def on_progress(percent: int, message: str) -> None:
        _put_progress(progress_queue, percent, message)

    try:
        optimized, validation, job = await optimize_for_job(
            source,
            job_text=job_text,
            max_iterations=req.max_iterations or settings.max_iterations,
            parallel=req.parallel,
            on_progress=on_progress if progress_queue is not None else None,
            no_shame=req.aggressive_tailoring,
        )
    except Exception as e:
        logger.exception("Optimize failed")
        err_msg = _API_KEY_INVALID_MSG if _is_api_key_invalid(e) else str(e)
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

    pdf_filename = None
    pdf_b64 = None
    optimized_resume_text: str | None = None
    _put_progress(progress_queue, 85, "Saving PDF…")
    can_export_pdf = True
    if user:
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
        if user_id:
            pool = await get_pool()
            if pool:
                await user_increment_readiness(pool, user_id, delta=READINESS_DELTA_OPTIMIZE)
        pdf_filename = pdf_path.name
        pdf_b64 = base64.b64encode(optimized.pdf_bytes).decode()
    _put_progress(progress_queue, 100, "Done")

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


@router.get("/health", response_model=HealthResponse)
async def api_health() -> HealthResponse:
    """Check if DB is configured and reachable (DATABASE_URL)."""
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
        logger.exception("Health check failed: %s", e)
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
    limit: int = Query(500, ge=1, le=2000),
) -> AdminUsersResponse:
    """List all users (admin only)."""
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database not configured")
    users = await user_list_all(pool, limit=limit)
    items = [
        AdminUserOut(
            id=str(u["id"]),
            email=u["email"],
            name=u.get("name"),
            created_at=u["created_at"].isoformat() if u.get("created_at") else "",
            subscription_status=(u.get("subscription_status") or "free").lower() if u.get("subscription_status") is not None else "free",
            subscription_plan=(u.get("subscription_plan") or "free").lower() if u.get("subscription_plan") is not None else "free",
        )
        for u in users
    ]
    return AdminUsersResponse(items=items)


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
    )


@router.get("/admin/activity", response_model=AdminActivityResponse)
async def api_admin_activity(
    _admin: dict = Depends(get_admin_user),
    limit: int = Query(50, ge=1, le=200),
) -> AdminActivityResponse:
    """Recent resume generations (admin only). With DB: includes user email. Without DB: list from index, no email."""
    settings = get_settings()
    pool = await get_pool()
    items: list[AdminActivityItem] = []
    if pool:
        try:
            rows = await db_recent_resumes_with_user(pool, settings.output_dir, limit=limit)
            for r in rows:
                items.append(AdminActivityItem(
                    filename=r["filename"],
                    company=r["company"],
                    job_title=r["job_title"],
                    created_at=r["created_at"].isoformat() if r.get("created_at") else "",
                    user_email=r.get("user_email"),
                ))
        except Exception as e:
            logger.exception("Admin activity failed: %s", e)
    else:
        records = await pdf_storage.list_all_async(user_id=None)
        for r in records[:limit]:
            items.append(AdminActivityItem(
                filename=r.path.name,
                company=r.company,
                job_title=r.job_title or "",
                created_at=r.timestamp.isoformat() if r.timestamp else "",
                user_email=None,
            ))
    return AdminActivityResponse(items=items)


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
        if pool:
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
        if pool:
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


@app.on_event("startup")
async def startup_seed_and_backfill() -> None:
    """Ensure seed user exists and backfill user_id on existing resume records."""
    pool = await get_pool()
    if pool is None:
        return
    try:
        user_id = await ensure_seed_user(pool)
        n = await backfill_user_id(pool, user_id)
        if n:
            logger.info("Backfilled %d history record(s) to user marichakgroup@gmail.com", n)
    except Exception as e:
        logger.exception("Startup seed/backfill failed: %s", e)


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
