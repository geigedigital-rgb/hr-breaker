import logging
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from pydantic import BaseModel

# Load .env from project root so it works regardless of CWD (e.g. uvicorn from any dir)
_env_path = Path(__file__).resolve().parent.parent.parent / ".env"
load_dotenv(_env_path, override=True)
# Fallback: load from current working directory (e.g. when run from project root)
load_dotenv(override=False)


def setup_logging() -> logging.Logger:
    general_level = os.getenv("LOG_LEVEL_GENERAL", "WARNING").upper()
    project_level = os.getenv("LOG_LEVEL", "WARNING").upper()

    logging.basicConfig(
        level=getattr(logging, general_level, logging.WARNING),
        format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
        datefmt="%H:%M:%S",
    )

    project_logger = logging.getLogger("hr_breaker")
    project_logger.setLevel(getattr(logging, project_level, logging.WARNING))
    return project_logger


logger = setup_logging()


class Settings(BaseModel):
    """Application settings."""

    google_api_key: str = ""
    gemini_pro_model: str = "gemini-3-pro-preview"
    gemini_flash_model: str = "gemini-3-flash-preview"
    gemini_thinking_budget: int | None = 8192
    cache_dir: Path = Path(".cache/resumes")
    output_dir: Path = Path("output")
    max_iterations: int = 1
    pass_threshold: float = 0.7
    fast_mode: bool = True

    # Scraper settings
    scraper_httpx_timeout: float = 15.0
    scraper_wayback_timeout: float = 10.0
    scraper_playwright_timeout: int = 60000  # ms; тяжёлые сайты (StepStone и т.п.) могут грузиться дольше
    scraper_use_stealth: bool = True  # use playwright-stealth when installed (reduces bot detection)
    scraper_playwright_locale: str = "en-US"  # e.g. de-DE for StepStone Germany
    scraper_httpx_max_retries: int = 3
    scraper_wayback_max_age_days: int = 30
    scraper_min_text_length: int = 200
    # Adzuna job search API (e.g. Germany)
    adzuna_app_id: str = ""
    adzuna_app_key: str = ""

    # Apify (StepStone etc.): optional paid scrapers
    scraper_use_apify: bool = False
    scraper_apify_actor_id: str = "fatihtahta/stepstone-scraper-fast-reliable-4-1k"
    scraper_apify_domains: str = "stepstone.de,stepstone.at,stepstone.be,stepstone.nl"
    scraper_apify_timeout: int = 60  # seconds; actor often scrapes multiple pages, keep lower to fail fast
    apify_token: str = ""  # from APIFY_TOKEN; required when SCRAPER_USE_APIFY=true

    # Database (optional): Postgres for history and auth; e.g. Neon DATABASE_URL
    database_url: str = ""
    # Auth: JWT secret (required when using auth); Google OAuth for "Login with Google"
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""
    frontend_url: str = "http://localhost:5173"  # for OAuth redirect

    # Filter thresholds
    filter_hallucination_threshold: float = 0.9
    filter_keyword_threshold: float = 0.25
    filter_llm_threshold: float = 0.7
    filter_vector_threshold: float = 0.4
    filter_ai_generated_threshold: float = 0.4

    # Resume length limits
    resume_max_chars: int = 4500
    resume_max_words: int = 520
    resume_page2_overflow_chars: int = 1000

    # Keyword matcher params
    keyword_tfidf_max_features: int = 200
    keyword_tfidf_cutoff: float = 0.1
    keyword_max_missing_display: int = 10

    # Model settings
    sentence_transformer_model: str = "all-MiniLM-L6-v2"

    # Agent limits
    agent_name_extractor_chars: int = 2000
    agent_resume_summary_chars: int = 3500

    # Stripe (payments). Price IDs from Stripe Dashboard → Products → Prices
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""  # Webhook signing secret (whsec_...)
    stripe_publishable_key: str = ""  # For frontend if needed (e.g. Customer Portal)
    stripe_price_trial_id: str = ""   # One-time $2.99 trial 7-day access
    stripe_price_monthly_id: str = ""  # Recurring $29/month

    # Landing (pitchcv.app): public trial analysis, no auth
    landing_allowed_origins: str = ""  # Comma-separated, e.g. https://pitchcv.app,https://www.pitchcv.app
    landing_rate_limit_hours: int = 24  # 1 request per IP per N hours
    landing_max_resume_chars: int = 50_000  # Max resume text size (anti-fraud)
    landing_max_job_url_len: int = 2048  # Max job_url length
    landing_pending_ttl_seconds: int = 900  # Pending upload token TTL (15 min) for save→login→claim flow

    # Admin: primary email + optional comma-separated list (same access as admin_email)
    admin_email: str = "marichakgroup@gmail.com"
    admin_emails: str = ""
    partner_program_enabled: bool = True

    # Landing reviews (POST /api/reviews) rate limits when DATABASE_URL is set
    reviews_rate_limit_ip_per_hour: int = 10
    reviews_rate_limit_email_per_day: int = 3


def get_settings() -> Settings:
    """Return settings from env. No cache so .env changes (e.g. MAX_ITERATIONS) apply without restart."""
    load_dotenv()  # re-read .env so edits take effect
    thinking_env = os.getenv("GEMINI_THINKING_BUDGET")
    thinking_budget: int | None = 8192
    if thinking_env is not None:
        thinking_budget = int(thinking_env) if thinking_env else None
    return Settings(
        google_api_key=os.getenv("GOOGLE_API_KEY", ""),
        gemini_pro_model=os.getenv("GEMINI_PRO_MODEL") or "gemini-3-pro-preview",
        gemini_flash_model=os.getenv("GEMINI_FLASH_MODEL") or "gemini-3-flash-preview",
        gemini_thinking_budget=thinking_budget,
        fast_mode=os.getenv("HR_BREAKER_FAST_MODE", "true").lower() in ("true", "1", "yes"),
        # Product policy: always single-pass optimization.
        max_iterations=1,
        # Scraper settings
        scraper_httpx_timeout=float(os.getenv("SCRAPER_HTTPX_TIMEOUT", "15")),
        scraper_wayback_timeout=float(os.getenv("SCRAPER_WAYBACK_TIMEOUT", "10")),
        scraper_playwright_timeout=int(os.getenv("SCRAPER_PLAYWRIGHT_TIMEOUT", "60000")),
        scraper_use_stealth=os.getenv("SCRAPER_USE_STEALTH", "true").lower() in ("true", "1", "yes"),
        scraper_playwright_locale=os.getenv("SCRAPER_PLAYWRIGHT_LOCALE", "en-US"),
        scraper_httpx_max_retries=int(os.getenv("SCRAPER_HTTPX_MAX_RETRIES", "3")),
        scraper_wayback_max_age_days=int(os.getenv("SCRAPER_WAYBACK_MAX_AGE_DAYS", "30")),
        scraper_min_text_length=int(os.getenv("SCRAPER_MIN_TEXT_LENGTH", "200")),
        scraper_use_apify=os.getenv("SCRAPER_USE_APIFY", "false").lower() in ("true", "1", "yes"),
        scraper_apify_actor_id=os.getenv("SCRAPER_APIFY_ACTOR_ID", "fatihtahta/stepstone-scraper-fast-reliable-4-1k"),
        scraper_apify_domains=os.getenv("SCRAPER_APIFY_DOMAINS", "stepstone.de,stepstone.at,stepstone.be,stepstone.nl"),
        scraper_apify_timeout=int(os.getenv("SCRAPER_APIFY_TIMEOUT", "60")),
        apify_token=os.getenv("APIFY_TOKEN", ""),
        adzuna_app_id=os.getenv("ADZUNA_APP_ID", ""),
        adzuna_app_key=os.getenv("ADZUNA_APP_KEY", ""),
        database_url=os.getenv("DATABASE_URL", ""),
        jwt_secret=os.getenv("JWT_SECRET", ""),
        jwt_algorithm=os.getenv("JWT_ALGORITHM", "HS256"),
        jwt_expire_minutes=int(os.getenv("JWT_EXPIRE_MINUTES", str(60 * 24 * 7))),
        google_oauth_client_id=os.getenv("GOOGLE_OAUTH_CLIENT_ID", ""),
        google_oauth_client_secret=os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", ""),
        frontend_url=os.getenv("FRONTEND_URL", "http://localhost:5173"),
        # Filter thresholds
        filter_hallucination_threshold=float(os.getenv("FILTER_HALLUCINATION_THRESHOLD", "0.9")),
        filter_keyword_threshold=float(os.getenv("FILTER_KEYWORD_THRESHOLD", "0.25")),
        filter_llm_threshold=float(os.getenv("FILTER_LLM_THRESHOLD", "0.7")),
        filter_vector_threshold=float(os.getenv("FILTER_VECTOR_THRESHOLD", "0.4")),
        filter_ai_generated_threshold=float(os.getenv("FILTER_AI_GENERATED_THRESHOLD", "0.4")),
        # Resume length limits
        resume_max_chars=int(os.getenv("RESUME_MAX_CHARS", "4500")),
        resume_max_words=int(os.getenv("RESUME_MAX_WORDS", "520")),
        resume_page2_overflow_chars=int(os.getenv("RESUME_PAGE2_OVERFLOW_CHARS", "1000")),
        # Keyword matcher params
        keyword_tfidf_max_features=int(os.getenv("KEYWORD_TFIDF_MAX_FEATURES", "200")),
        keyword_tfidf_cutoff=float(os.getenv("KEYWORD_TFIDF_CUTOFF", "0.1")),
        keyword_max_missing_display=int(os.getenv("KEYWORD_MAX_MISSING_DISPLAY", "10")),
        # Model settings
        sentence_transformer_model=os.getenv("SENTENCE_TRANSFORMER_MODEL", "all-MiniLM-L6-v2"),
        # Agent limits
        agent_name_extractor_chars=int(os.getenv("AGENT_NAME_EXTRACTOR_CHARS", "2000")),
        agent_resume_summary_chars=int(os.getenv("AGENT_RESUME_SUMMARY_CHARS", "3500")),
        stripe_secret_key=os.getenv("STRIPE_SECRET_KEY", ""),
        stripe_webhook_secret=os.getenv("STRIPE_WEBHOOK_SECRET", ""),
        stripe_publishable_key=os.getenv("STRIPE_PUBLISHABLE_KEY", ""),
        stripe_price_trial_id=os.getenv("STRIPE_PRICE_TRIAL_ID", ""),
        stripe_price_monthly_id=os.getenv("STRIPE_PRICE_MONTHLY_ID", ""),
        landing_allowed_origins=os.getenv("LANDING_ALLOWED_ORIGINS", ""),
        landing_rate_limit_hours=int(os.getenv("LANDING_RATE_LIMIT_HOURS", "24")),
        landing_max_resume_chars=int(os.getenv("LANDING_MAX_RESUME_CHARS", "50000")),
        landing_max_job_url_len=int(os.getenv("LANDING_MAX_JOB_URL_LEN", "2048")),
        landing_pending_ttl_seconds=int(os.getenv("LANDING_PENDING_TTL_SECONDS", "900")),
        admin_email=os.getenv("ADMIN_EMAIL", "marichakgroup@gmail.com").strip().lower() or "marichakgroup@gmail.com",
        admin_emails=os.getenv("ADMIN_EMAILS", ""),
        partner_program_enabled=os.getenv("PARTNER_PROGRAM_ENABLED", "true").lower() in ("true", "1", "yes"),
        reviews_rate_limit_ip_per_hour=int(os.getenv("REVIEWS_RATE_LIMIT_IP_PER_HOUR", "10")),
        reviews_rate_limit_email_per_day=int(os.getenv("REVIEWS_RATE_LIMIT_EMAIL_PER_DAY", "3")),
    )


def get_model_settings() -> dict[str, Any] | None:
    """Get GoogleModelSettings with thinking config if budget is set."""
    settings = get_settings()
    if settings.gemini_thinking_budget is not None:
        return {
            "google_thinking_config": {
                "thinking_budget": settings.gemini_thinking_budget
            }
        }
    return None
