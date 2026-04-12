"""
Optional Postgres (e.g. Neon) storage for history metadata and users.

When DATABASE_URL is set, the API uses this for auth and history (list/save/delete).
PDF and source .txt files stay on disk; only metadata is in the DB.

Requires: pip install 'hr-breaker[db]'
"""

import logging
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from hr_breaker.config import get_settings
from hr_breaker.models import GeneratedPDF
from hr_breaker.services.reviews_repo import ensure_reviews_schema

logger = logging.getLogger(__name__)

USERS_TABLE = "users"
RESUMES_TABLE = "generated_resumes"
REFERRAL_CODES_TABLE = "referral_codes"
REFERRAL_ATTRIBUTIONS_TABLE = "referral_attributions"
REFERRAL_COMMISSIONS_TABLE = "referral_commissions"
REFERRAL_EVENTS_TABLE = "referral_events"
REFERRAL_ABUSE_FLAGS_TABLE = "referral_abuse_flags"
REFERRAL_PROCESSED_EVENTS_TABLE = "referral_processed_events"
USAGE_AUDIT_TABLE = "usage_audit_log"
TABLE = RESUMES_TABLE

_USERS_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS {USERS_TABLE} (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    name TEXT,
    google_id TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON {USERS_TABLE}(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON {USERS_TABLE}(google_id);
"""

_RESUMES_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    filename TEXT PRIMARY KEY,
    source_checksum TEXT NOT NULL DEFAULT '',
    company TEXT NOT NULL DEFAULT '',
    job_title TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    first_name TEXT,
    last_name TEXT,
    pre_ats_score INTEGER,
    post_ats_score INTEGER,
    pre_keyword_score REAL,
    post_keyword_score REAL,
    company_logo_url TEXT,
    job_url TEXT,
    source_was_pdf BOOLEAN NOT NULL DEFAULT FALSE
);
"""

_REFERRAL_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS {REFERRAL_CODES_TABLE} (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL REFERENCES {USERS_TABLE}(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS {REFERRAL_ATTRIBUTIONS_TABLE} (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invited_user_id UUID NOT NULL UNIQUE REFERENCES {USERS_TABLE}(id) ON DELETE CASCADE,
    referrer_user_id UUID NOT NULL REFERENCES {USERS_TABLE}(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    source_url TEXT,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'attributed',
    reason TEXT
);

CREATE TABLE IF NOT EXISTS {REFERRAL_COMMISSIONS_TABLE} (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invited_user_id UUID NOT NULL UNIQUE REFERENCES {USERS_TABLE}(id) ON DELETE CASCADE,
    referrer_user_id UUID NOT NULL REFERENCES {USERS_TABLE}(id) ON DELETE CASCADE,
    stripe_invoice_id TEXT,
    amount_cents BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    rate_percent INTEGER NOT NULL DEFAULT 30,
    status TEXT NOT NULL DEFAULT 'hold',
    reason TEXT,
    reviewed_by UUID REFERENCES {USERS_TABLE}(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS {REFERRAL_EVENTS_TABLE} (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    user_id UUID REFERENCES {USERS_TABLE}(id) ON DELETE SET NULL,
    referrer_user_id UUID REFERENCES {USERS_TABLE}(id) ON DELETE SET NULL,
    invited_user_id UUID REFERENCES {USERS_TABLE}(id) ON DELETE SET NULL,
    stripe_event_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{{}}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS {REFERRAL_ABUSE_FLAGS_TABLE} (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_type TEXT NOT NULL,
    user_id UUID REFERENCES {USERS_TABLE}(id) ON DELETE CASCADE,
    score INTEGER NOT NULL DEFAULT 100,
    evidence JSONB NOT NULL DEFAULT '{{}}'::jsonb,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_by UUID REFERENCES {USERS_TABLE}(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS {REFERRAL_PROCESSED_EVENTS_TABLE} (
    event_id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ref_codes_owner ON {REFERRAL_CODES_TABLE}(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_ref_attr_referrer ON {REFERRAL_ATTRIBUTIONS_TABLE}(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_ref_attr_status ON {REFERRAL_ATTRIBUTIONS_TABLE}(status);
CREATE INDEX IF NOT EXISTS idx_ref_comm_referrer ON {REFERRAL_COMMISSIONS_TABLE}(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_ref_comm_status ON {REFERRAL_COMMISSIONS_TABLE}(status);
CREATE INDEX IF NOT EXISTS idx_ref_events_type_created ON {REFERRAL_EVENTS_TABLE}(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ref_events_referrer ON {REFERRAL_EVENTS_TABLE}(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_ref_events_invited ON {REFERRAL_EVENTS_TABLE}(invited_user_id);
"""

_pool = None


async def get_pool():
    """Return asyncpg pool when DATABASE_URL is set; else None."""
    global _pool
    settings = get_settings()
    if not settings.database_url.strip():
        return None
    if _pool is not None:
        return _pool
    try:
        import asyncpg
    except ImportError:
        logger.warning("asyncpg not installed; history will use index.json. Install: pip install 'hr-breaker[db]'")
        return None
    url = settings.database_url.strip()
    if not url:
        return None
    # Neon and most cloud Postgres require SSL; asyncpg uses sslmode from URL
    if "neon.tech" in url and "sslmode=" not in url:
        url = url + ("&" if "?" in url else "?") + "sslmode=require"
    try:
        pool = await asyncpg.create_pool(url, min_size=0, max_size=4, command_timeout=10)
        await init_table(pool)
        _pool = pool
        logger.info("Postgres pool created for history")
        return _pool
    except Exception as e:
        logger.exception("Failed to create Postgres pool: %s", e)
        return None


async def init_table(pool) -> None:
    """Create tables if not exist; run migrations (user_id, source_was_pdf)."""
    async with pool.acquire() as conn:
        await conn.execute(_USERS_SCHEMA)
        await conn.execute(_RESUMES_SCHEMA)
        await conn.execute(_REFERRAL_SCHEMA)
        await conn.execute(
            f"ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES {USERS_TABLE}(id) ON DELETE CASCADE"
        )
        await conn.execute(
            f"ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS source_was_pdf BOOLEAN NOT NULL DEFAULT FALSE"
        )
        await conn.execute(f"CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON {TABLE}(user_id)")
        # Market Readiness (non-gamified status)
        await conn.execute(
            f"ALTER TABLE {USERS_TABLE} ADD COLUMN IF NOT EXISTS market_readiness_score INTEGER NOT NULL DEFAULT 0"
        )
        await conn.execute(
            f"ALTER TABLE {USERS_TABLE} ADD COLUMN IF NOT EXISTS last_visit_date DATE"
        )
        await conn.execute(
            f"ALTER TABLE {USERS_TABLE} ADD COLUMN IF NOT EXISTS streak_days INTEGER NOT NULL DEFAULT 0"
        )
        # Stripe subscription
        await conn.execute(
            f"ALTER TABLE {USERS_TABLE} ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT"
        )
        await conn.execute(
            f"ALTER TABLE {USERS_TABLE} ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT"
        )
        await conn.execute(
            f"ALTER TABLE {USERS_TABLE} ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'free'"
        )
        await conn.execute(
            f"ALTER TABLE {USERS_TABLE} ADD COLUMN IF NOT EXISTS subscription_plan TEXT NOT NULL DEFAULT 'free'"
        )
        await conn.execute(
            f"ALTER TABLE {USERS_TABLE} ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ"
        )
        await conn.execute(
            f"ALTER TABLE {USERS_TABLE} ADD COLUMN IF NOT EXISTS free_analyses_count INTEGER NOT NULL DEFAULT 0"
        )
        await conn.execute(
            f"ALTER TABLE {USERS_TABLE} ADD COLUMN IF NOT EXISTS free_optimize_count INTEGER NOT NULL DEFAULT 0"
        )
        await conn.execute(
            f"ALTER TABLE {USERS_TABLE} ADD COLUMN IF NOT EXISTS free_quota_month_start DATE"
        )
        await conn.execute(f"CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON {USERS_TABLE}(stripe_customer_id)")
        await conn.execute(
            f"ALTER TABLE {USERS_TABLE} ADD COLUMN IF NOT EXISTS partner_program_access BOOLEAN NOT NULL DEFAULT FALSE"
        )
        await conn.execute(
            f"ALTER TABLE {USERS_TABLE} ADD COLUMN IF NOT EXISTS admin_blocked BOOLEAN NOT NULL DEFAULT FALSE"
        )
        await conn.execute(
            f"ALTER TABLE {USERS_TABLE} ADD COLUMN IF NOT EXISTS marketing_emails_opt_in BOOLEAN NOT NULL DEFAULT TRUE"
        )
        await conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {USAGE_AUDIT_TABLE} (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES {USERS_TABLE}(id) ON DELETE SET NULL,
                action TEXT NOT NULL,
                model TEXT,
                success BOOLEAN NOT NULL DEFAULT TRUE,
                error_message TEXT,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                metadata JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        await conn.execute(
            f"CREATE INDEX IF NOT EXISTS idx_usage_audit_created ON {USAGE_AUDIT_TABLE}(created_at DESC)"
        )
        await conn.execute(
            f"CREATE INDEX IF NOT EXISTS idx_usage_audit_user ON {USAGE_AUDIT_TABLE}(user_id)"
        )
        await ensure_reviews_schema(conn)
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_email_settings (
                id SMALLINT PRIMARY KEY DEFAULT 1,
                winback_auto_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                winback_delay_min_minutes INT NOT NULL DEFAULT 25,
                winback_delay_max_minutes INT NOT NULL DEFAULT 30,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT admin_email_settings_single CHECK (id = 1)
            )
            """
        )
        await conn.execute(
            "INSERT INTO admin_email_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING"
        )
        await conn.execute(
            "ALTER TABLE admin_email_settings ADD COLUMN IF NOT EXISTS resend_template_reminder_no_download TEXT NOT NULL DEFAULT ''"
        )
        await conn.execute(
            "ALTER TABLE admin_email_settings ADD COLUMN IF NOT EXISTS resend_template_short_nudge TEXT NOT NULL DEFAULT ''"
        )
        await conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS email_winback_schedule (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES {USERS_TABLE}(id) ON DELETE CASCADE,
                run_at TIMESTAMPTZ NOT NULL,
                template_id TEXT NOT NULL DEFAULT 'reminder-no-download',
                status TEXT NOT NULL DEFAULT 'pending',
                error_message TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                sent_at TIMESTAMPTZ,
                claimed_at TIMESTAMPTZ
            )
            """
        )
        await conn.execute(
            f"ALTER TABLE {EMAIL_WINBACK_SCHEDULE_TABLE} ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ"
        )
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_email_winback_due ON email_winback_schedule (status, run_at) WHERE status = 'pending'"
        )
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_email_campaign_log (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                segment_id TEXT NOT NULL,
                template_id TEXT NOT NULL,
                dry_run BOOLEAN NOT NULL,
                recipients_planned INT NOT NULL DEFAULT 0,
                recipients_sent INT NOT NULL DEFAULT 0,
                error TEXT,
                created_by_email TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )


async def db_insert(pool, output_dir: Path, pdf: GeneratedPDF, user_id: str) -> None:
    """Insert or replace one record for the given user."""
    async with pool.acquire() as conn:
        await conn.execute(
            f"""
            INSERT INTO {TABLE} (
                filename, user_id, source_checksum, company, job_title, created_at,
                first_name, last_name, pre_ats_score, post_ats_score,
                pre_keyword_score, post_keyword_score, company_logo_url, job_url, source_was_pdf
            ) VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (filename) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                source_checksum = EXCLUDED.source_checksum,
                company = EXCLUDED.company,
                job_title = EXCLUDED.job_title,
                created_at = EXCLUDED.created_at,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                pre_ats_score = EXCLUDED.pre_ats_score,
                post_ats_score = EXCLUDED.post_ats_score,
                pre_keyword_score = EXCLUDED.pre_keyword_score,
                post_keyword_score = EXCLUDED.post_keyword_score,
                company_logo_url = EXCLUDED.company_logo_url,
                job_url = EXCLUDED.job_url,
                source_was_pdf = EXCLUDED.source_was_pdf
            """,
            pdf.path.name,
            user_id,
            pdf.source_checksum,
            pdf.company,
            pdf.job_title,
            pdf.timestamp,
            pdf.first_name,
            pdf.last_name,
            pdf.pre_ats_score,
            pdf.post_ats_score,
            pdf.pre_keyword_score,
            pdf.post_keyword_score,
            pdf.company_logo_url,
            pdf.job_url,
            pdf.source_was_pdf,
        )


def _row_to_record(row, output_dir: Path) -> GeneratedPDF:
    """Convert asyncpg row to GeneratedPDF."""
    ts = row["created_at"]
    if isinstance(ts, datetime):
        pass
    else:
        ts = datetime.now()
    return GeneratedPDF(
        path=output_dir / row["filename"],
        source_checksum=row["source_checksum"] or "",
        company=row["company"] or "",
        job_title=row["job_title"] or "",
        timestamp=ts,
        first_name=row["first_name"],
        last_name=row["last_name"],
        pre_ats_score=row["pre_ats_score"],
        post_ats_score=row["post_ats_score"],
        pre_keyword_score=row["pre_keyword_score"],
        post_keyword_score=row["post_keyword_score"],
        company_logo_url=row["company_logo_url"],
        job_url=row["job_url"],
        source_was_pdf=row.get("source_was_pdf", False),
    )


async def db_list_all(pool, output_dir: Path, user_id: str | None = None) -> list[GeneratedPDF]:
    """List records, newest first. If user_id given, filter by it. Only includes records whose PDF exists on disk."""
    async with pool.acquire() as conn:
        if user_id:
            rows = await conn.fetch(
                f"SELECT * FROM {TABLE} WHERE user_id = $1::uuid ORDER BY created_at DESC",
                user_id,
            )
        else:
            rows = await conn.fetch(f"SELECT * FROM {TABLE} ORDER BY created_at DESC")
    records = [_row_to_record(dict(r), output_dir) for r in rows]
    return [r for r in records if r.path.is_file()]


async def db_get_by_filename(pool, output_dir: Path, filename: str, user_id: str | None = None) -> GeneratedPDF | None:
    """Get one record by filename; optionally require user_id match."""
    async with pool.acquire() as conn:
        if user_id:
            row = await conn.fetchrow(
                f"SELECT * FROM {TABLE} WHERE filename = $1 AND user_id = $2::uuid",
                filename,
                user_id,
            )
        else:
            row = await conn.fetchrow(f"SELECT * FROM {TABLE} WHERE filename = $1", filename)
    if row is None:
        return None
    return _row_to_record(dict(row), output_dir)


async def db_delete(pool, filename: str, user_id: str | None = None) -> bool:
    """Delete one record by filename; optionally require user_id match. Returns True if deleted."""
    async with pool.acquire() as conn:
        if user_id:
            n = await conn.execute(
                f"DELETE FROM {TABLE} WHERE filename = $1 AND user_id = $2::uuid",
                filename,
                user_id,
            )
        else:
            n = await conn.execute(f"DELETE FROM {TABLE} WHERE filename = $1", filename)
    return "1" in str(n) or "DELETE 1" in str(n)


# --- Users ---

async def user_create(pool, email: str, password_hash: str | None = None, name: str | None = None, google_id: str | None = None) -> dict:
    """Create a user. Returns {id, email, name, created_at}."""
    uid = uuid4()
    async with pool.acquire() as conn:
        await conn.execute(
            f"""
            INSERT INTO {USERS_TABLE} (id, email, password_hash, name, google_id)
            VALUES ($1::uuid, $2, $3, $4, $5)
            """,
            uid,
            email.lower().strip(),
            password_hash,
            name or email.split("@")[0],
            google_id,
        )
    return {"id": str(uid), "email": email, "name": name or email.split("@")[0], "created_at": datetime.now().isoformat()}


USER_SUBSCRIPTION_COLS = (
    "stripe_customer_id, stripe_subscription_id, subscription_status, subscription_plan, "
    "current_period_end, free_analyses_count, free_optimize_count, free_quota_month_start, partner_program_access, "
    "market_readiness_score, last_visit_date, streak_days, admin_blocked, marketing_emails_opt_in"
)

async def user_get_by_email(pool, email: str) -> dict | None:
    """Get user by email."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT id, email, password_hash, name, google_id, created_at, {USER_SUBSCRIPTION_COLS} FROM {USERS_TABLE} WHERE email = $1",
            email.lower().strip(),
        )
    if row is None:
        return None
    return dict(row)


async def user_get_by_id(pool, user_id: str) -> dict | None:
    """Get user by id (includes subscription fields)."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT id, email, password_hash, name, google_id, created_at, {USER_SUBSCRIPTION_COLS} FROM {USERS_TABLE} WHERE id = $1::uuid",
            user_id,
        )
    if row is None:
        return None
    return dict(row)


async def user_get_by_google_id(pool, google_id: str) -> dict | None:
    """Get user by Google OAuth id."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT id, email, password_hash, name, google_id, created_at, {USER_SUBSCRIPTION_COLS} FROM {USERS_TABLE} WHERE google_id = $1",
            google_id,
        )
    if row is None:
        return None
    return dict(row)


async def user_update_google_id(pool, user_id: str, google_id: str) -> None:
    """Link existing user to Google account."""
    async with pool.acquire() as conn:
        await conn.execute(
            f"UPDATE {USERS_TABLE} SET google_id = $1 WHERE id = $2::uuid",
            google_id,
            user_id,
        )


# --- Subscription (Stripe) ---

async def user_get_subscription(pool, user_id: str) -> dict:
    """Return subscription info for user and reset free counters monthly when needed."""
    from datetime import timezone

    month_start_utc = datetime.now(timezone.utc).date().replace(day=1)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT subscription_status, subscription_plan, current_period_end, free_analyses_count, free_optimize_count, free_quota_month_start FROM {USERS_TABLE} WHERE id = $1::uuid",
            user_id,
        )
    if row is None:
        return {"plan": "free", "status": "free", "current_period_end": None, "free_analyses_count": 0, "free_optimize_count": 0}
    status = (row["subscription_status"] or "free").lower()
    plan = (row["subscription_plan"] or "free").lower()
    period_end = row["current_period_end"]
    free_analyses_count = row["free_analyses_count"] or 0
    free_optimize_count = int(row["free_optimize_count"] or 0)
    free_quota_month_start = row["free_quota_month_start"]
    if period_end:
        now = datetime.now(timezone.utc)
        if getattr(period_end, "tzinfo", None) is None:
            period_end = period_end.replace(tzinfo=timezone.utc)
        if period_end < now and status in ("trial", "active"):
            status = "free"
            plan = "free"
    # Free quota resets every UTC month for non-paid users.
    if plan == "free" and (
        free_quota_month_start is None or free_quota_month_start < month_start_utc
    ):
        async with pool.acquire() as conn:
            await conn.execute(
                f"""
                UPDATE {USERS_TABLE}
                SET free_analyses_count = 0,
                    free_optimize_count = 0,
                    free_quota_month_start = $2
                WHERE id = $1::uuid
                """,
                user_id,
                month_start_utc,
            )
        free_analyses_count = 0
        free_optimize_count = 0
        free_quota_month_start = month_start_utc
    if plan == "free" and free_quota_month_start is None:
        # Backfill month marker for legacy rows in free plan.
        async with pool.acquire() as conn:
            await conn.execute(
                f"UPDATE {USERS_TABLE} SET free_quota_month_start = $2 WHERE id = $1::uuid",
                user_id,
                month_start_utc,
            )
    return {
        "plan": plan,
        "status": status,
        "current_period_end": period_end.isoformat() if period_end else None,
        "free_analyses_count": free_analyses_count,
        "free_optimize_count": free_optimize_count,
    }


async def user_set_stripe_customer_id(pool, user_id: str, stripe_customer_id: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            f"UPDATE {USERS_TABLE} SET stripe_customer_id = $1 WHERE id = $2::uuid",
            stripe_customer_id,
            user_id,
        )


async def user_get_id_by_stripe_customer_id(pool, stripe_customer_id: str) -> str | None:
    """Return user id for Stripe customer id, or None."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT id FROM {USERS_TABLE} WHERE stripe_customer_id = $1",
            stripe_customer_id,
        )
    return str(row["id"]) if row else None


async def user_update_subscription(
    pool,
    user_id: str,
    *,
    stripe_subscription_id: str | None = None,
    subscription_status: str | None = None,
    subscription_plan: str | None = None,
    current_period_end: datetime | None = None,
) -> None:
    """Update subscription fields. Pass only the keys you want to update."""
    updates = []
    values = []
    i = 1
    if stripe_subscription_id is not None:
        updates.append(f"stripe_subscription_id = ${i}")
        values.append(stripe_subscription_id)
        i += 1
    if subscription_status is not None:
        updates.append(f"subscription_status = ${i}")
        values.append(subscription_status)
        i += 1
    if subscription_plan is not None:
        updates.append(f"subscription_plan = ${i}")
        values.append(subscription_plan)
        i += 1
    if current_period_end is not None:
        updates.append(f"current_period_end = ${i}")
        values.append(current_period_end)
        i += 1
    if not updates:
        return
    values.append(user_id)
    async with pool.acquire() as conn:
        await conn.execute(
            f"UPDATE {USERS_TABLE} SET {', '.join(updates)} WHERE id = ${i}::uuid",
            *values,
        )


async def user_set_current_period_end(pool, user_id: str, end: datetime | None) -> None:
    """Set subscription period end; pass None to clear."""
    async with pool.acquire() as conn:
        await conn.execute(
            f"UPDATE {USERS_TABLE} SET current_period_end = $2 WHERE id = $1::uuid",
            user_id,
            end,
        )


async def user_increment_free_analyses(pool, user_id: str) -> None:
    """Increment the free analyses count for the user."""
    from datetime import timezone

    month_start_utc = datetime.now(timezone.utc).date().replace(day=1)
    async with pool.acquire() as conn:
        await conn.execute(
            f"""
            UPDATE {USERS_TABLE}
            SET free_analyses_count = free_analyses_count + 1,
                free_quota_month_start = COALESCE(free_quota_month_start, $2)
            WHERE id = $1::uuid
            """,
            user_id,
            month_start_utc,
        )


async def user_increment_free_optimize(pool, user_id: str) -> None:
    """Increment completed optimize runs while user was on free plan."""
    from datetime import timezone

    month_start_utc = datetime.now(timezone.utc).date().replace(day=1)
    async with pool.acquire() as conn:
        await conn.execute(
            f"""
            UPDATE {USERS_TABLE}
            SET free_optimize_count = free_optimize_count + 1,
                free_quota_month_start = COALESCE(free_quota_month_start, $2)
            WHERE id = $1::uuid
            """,
            user_id,
            month_start_utc,
        )


async def ensure_seed_user(pool) -> str:
    """Ensure user marichakgroup@gmail.com exists; return user id. Used for migration and default login."""
    from hr_breaker.services.auth import hash_password, verify_password

    seed_email = "marichakgroup@gmail.com"
    new_seed_password = "admin.97!"
    old_seed_password = "admin"

    row = await user_get_by_email(pool, seed_email)
    if row:
        # Backward-compatible migration: rotate only legacy default password.
        current_hash = row.get("password_hash") or ""
        should_rotate = (not current_hash) or verify_password(old_seed_password, current_hash)
        if should_rotate:
            async with pool.acquire() as conn:
                await conn.execute(
                    f"UPDATE {USERS_TABLE} SET password_hash = $1 WHERE id = $2::uuid",
                    hash_password(new_seed_password),
                    str(row["id"]),
                )
            logger.info("Seed admin password rotated to new default")
        return str(row["id"])

    pass_hash = hash_password(new_seed_password)
    user = await user_create(pool, seed_email, password_hash=pass_hash, name="Marichak")
    return user["id"]


async def backfill_user_id(pool, user_id: str) -> int:
    """Set user_id on all generated_resumes that have NULL user_id. Returns count updated."""
    async with pool.acquire() as conn:
        n = await conn.execute(
            f"UPDATE {TABLE} SET user_id = $1::uuid WHERE user_id IS NULL",
            user_id,
        )
    # e.g. "UPDATE 3" -> 3
    try:
        return int(n.split()[-1]) if n else 0
    except ValueError:
        return 0


async def user_list_all(pool, limit: int = 500) -> list[dict]:
    """List all users (id, email, name, created_at, subscription, partner flag). For admin only."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT id, email, name, created_at, subscription_status, subscription_plan, partner_program_access
            FROM {USERS_TABLE} ORDER BY created_at DESC LIMIT $1
            """,
            limit,
        )
    return [dict(r) for r in rows]


async def user_list_paginated(pool, *, limit: int, offset: int) -> tuple[list[dict], int]:
    """Ordered by created_at DESC. Returns (rows, total_count)."""
    async with pool.acquire() as conn:
        count_row = await conn.fetchrow(f"SELECT COUNT(*)::int AS c FROM {USERS_TABLE}")
        total = int(count_row["c"]) if count_row else 0
        rows = await conn.fetch(
            f"""
            SELECT id, email, name, created_at, subscription_status, subscription_plan, partner_program_access, admin_blocked
            FROM {USERS_TABLE} ORDER BY created_at DESC LIMIT $1 OFFSET $2
            """,
            limit,
            offset,
        )
    return [dict(r) for r in rows], total


async def usage_audit_list_for_user(pool, user_id: str, limit: int = 400) -> list[dict]:
    """Usage / LLM audit events for one user (newest first)."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT id, action, model, success, error_message, input_tokens, output_tokens, metadata, created_at
            FROM {USAGE_AUDIT_TABLE}
            WHERE user_id = $1::uuid
            ORDER BY created_at DESC
            LIMIT $2
            """,
            user_id,
            limit,
        )
    out: list[dict] = []
    for r in rows:
        d = dict(r)
        if d.get("metadata") is not None and hasattr(d["metadata"], "keys"):
            d["metadata"] = dict(d["metadata"])
        out.append(d)
    return out


async def user_resumes_db_rows(pool, user_id: str, limit: int = 200) -> list[dict]:
    """All generated_resumes rows for user (newest first), regardless of PDF on disk."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT filename, company, job_title, created_at, pre_ats_score, post_ats_score, job_url,
                   source_checksum
            FROM {TABLE}
            WHERE user_id = $1::uuid
            ORDER BY created_at DESC
            LIMIT $2
            """,
            user_id,
            limit,
        )
    return [dict(r) for r in rows]


async def user_set_admin_blocked(pool, user_id: str, blocked: bool) -> bool:
    async with pool.acquire() as conn:
        n = await conn.execute(
            f"UPDATE {USERS_TABLE} SET admin_blocked = $2 WHERE id = $1::uuid",
            user_id,
            bool(blocked),
        )
    return "UPDATE 1" in str(n)


async def user_delete_by_id(pool, user_id: str) -> bool:
    """Delete user row (CASCADE removes linked resumes, referrals, etc.)."""
    async with pool.acquire() as conn:
        n = await conn.execute(f"DELETE FROM {USERS_TABLE} WHERE id = $1::uuid", user_id)
    return "DELETE 1" in str(n)


async def user_set_partner_program_access(pool, user_id: str, enabled: bool) -> bool:
    """Set partner_program_access. Returns True if a row was updated."""
    async with pool.acquire() as conn:
        n = await conn.execute(
            f"UPDATE {USERS_TABLE} SET partner_program_access = $2 WHERE id = $1::uuid",
            user_id,
            bool(enabled),
        )
    return "UPDATE 1" in str(n) or (n and "1" in str(n))


async def usage_audit_insert(
    pool,
    *,
    user_id: str | None,
    action: str,
    model: str | None,
    success: bool,
    error_message: str | None,
    input_tokens: int,
    output_tokens: int,
    metadata: dict,
) -> None:
    import json as _json

    async with pool.acquire() as conn:
        await conn.execute(
            f"""
            INSERT INTO {USAGE_AUDIT_TABLE}
            (user_id, action, model, success, error_message, input_tokens, output_tokens, metadata)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb)
            """,
            user_id if user_id else None,
            action,
            model,
            success,
            error_message,
            int(input_tokens),
            int(output_tokens),
            _json.dumps(metadata or {}),
        )


async def usage_audit_list_admin(pool, limit: int = 500) -> list[dict]:
    """Recent usage/error events with user email."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT l.id, l.user_id, l.action, l.model, l.success, l.error_message,
                   l.input_tokens, l.output_tokens, l.metadata, l.created_at,
                   u.email AS user_email
            FROM {USAGE_AUDIT_TABLE} l
            LEFT JOIN {USERS_TABLE} u ON l.user_id = u.id
            ORDER BY l.created_at DESC
            LIMIT $1
            """,
            limit,
        )
    out = []
    for r in rows:
        d = dict(r)
        if d.get("metadata") is not None and hasattr(d["metadata"], "keys"):
            d["metadata"] = dict(d["metadata"])
        out.append(d)
    return out


async def db_recent_resumes_with_user(
    pool, output_dir: Path, *, limit: int = 100, offset: int = 0
) -> tuple[list[dict], int]:
    """Recent resume rows with user email. Paginated on DB; includes pdf_on_disk for each row."""
    async with pool.acquire() as conn:
        count_row = await conn.fetchrow(f"SELECT COUNT(*)::int AS c FROM {TABLE}")
        total = int(count_row["c"]) if count_row else 0
        rows = await conn.fetch(
            f"""
            SELECT r.filename, r.company, r.job_title, r.created_at, r.user_id, r.source_checksum,
                   r.source_was_pdf, u.email AS user_email
            FROM {TABLE} r
            LEFT JOIN {USERS_TABLE} u ON r.user_id = u.id
            ORDER BY r.created_at DESC
            LIMIT $1 OFFSET $2
            """,
            limit,
            offset,
        )
    result: list[dict] = []
    for r in rows:
        rec = dict(r)
        path = output_dir / rec["filename"]
        result.append({
            "filename": rec["filename"],
            "company": rec["company"] or "",
            "job_title": rec["job_title"] or "",
            "created_at": rec["created_at"],
            "user_email": rec.get("user_email") or None,
            "pdf_on_disk": path.is_file(),
            "source_checksum": (rec.get("source_checksum") or "") or "",
            "source_was_pdf": bool(rec.get("source_was_pdf")),
        })
    return result, total


# --- Referrals ---

def _safe_ref_code(seed: str) -> str:
    cleaned = "".join(ch for ch in (seed or "").lower() if ch.isalnum())
    if not cleaned:
        cleaned = "partner"
    return cleaned[:16]


async def referral_get_or_create_code(pool, user_id: str, email: str | None = None) -> str:
    """Return active referral code for user; create one if missing."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT code FROM {REFERRAL_CODES_TABLE} WHERE owner_user_id = $1::uuid AND active = TRUE ORDER BY created_at ASC LIMIT 1",
            user_id,
        )
        if row:
            return str(row["code"])

        base = _safe_ref_code((email or "partner").split("@")[0])
        candidate = f"{base}-{str(user_id).replace('-', '')[:8]}"
        i = 1
        while True:
            try:
                await conn.execute(
                    f"INSERT INTO {REFERRAL_CODES_TABLE} (owner_user_id, code, active) VALUES ($1::uuid, $2, TRUE)",
                    user_id,
                    candidate,
                )
                return candidate
            except Exception:
                i += 1
                candidate = f"{base}-{str(user_id).replace('-', '')[:8]}-{i}"


async def referral_get_referrer_by_code(pool, code: str) -> dict[str, Any] | None:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            SELECT rc.owner_user_id, rc.code, u.email
            FROM {REFERRAL_CODES_TABLE} rc
            JOIN {USERS_TABLE} u ON u.id = rc.owner_user_id
            WHERE rc.code = $1 AND rc.active = TRUE
            LIMIT 1
            """,
            (code or "").strip().lower(),
        )
    return dict(row) if row else None


async def referral_get_attribution_by_invited(pool, invited_user_id: str) -> dict[str, Any] | None:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT * FROM {REFERRAL_ATTRIBUTIONS_TABLE} WHERE invited_user_id = $1::uuid LIMIT 1",
            invited_user_id,
        )
    return dict(row) if row else None


async def referral_attribution_detail_for_invited(pool, invited_user_id: str) -> dict[str, Any] | None:
    """Attribution row with referrer email for admin user journey."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            SELECT a.code, a.source_url, a.first_seen_at, a.expires_at, a.status, a.reason,
                   ref.email AS referrer_email
            FROM {REFERRAL_ATTRIBUTIONS_TABLE} a
            LEFT JOIN {USERS_TABLE} ref ON ref.id = a.referrer_user_id
            WHERE a.invited_user_id = $1::uuid
            LIMIT 1
            """,
            invited_user_id,
        )
    return dict(row) if row else None


async def referral_create_attribution(
    pool,
    invited_user_id: str,
    referrer_user_id: str,
    code: str,
    expires_at: datetime,
    source_url: str | None = None,
    status: str = "attributed",
    reason: str | None = None,
) -> bool:
    """Create attribution once per invited user. Returns True when inserted."""
    async with pool.acquire() as conn:
        result = await conn.execute(
            f"""
            INSERT INTO {REFERRAL_ATTRIBUTIONS_TABLE} (
                invited_user_id, referrer_user_id, code, source_url, expires_at, status, reason
            ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
            ON CONFLICT (invited_user_id) DO NOTHING
            """,
            invited_user_id,
            referrer_user_id,
            (code or "").strip().lower(),
            source_url,
            expires_at,
            status,
            reason,
        )
    return "INSERT 0 1" in str(result)


async def referral_mark_attribution_status(
    pool, invited_user_id: str, status: str, reason: str | None = None
) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            f"UPDATE {REFERRAL_ATTRIBUTIONS_TABLE} SET status = $1, reason = $2 WHERE invited_user_id = $3::uuid",
            status,
            reason,
            invited_user_id,
        )


async def referral_mark_processed_event(pool, event_id: str) -> bool:
    """
    Mark Stripe webhook event as processed.
    Returns True if inserted (first seen), False if duplicate.
    """
    async with pool.acquire() as conn:
        result = await conn.execute(
            f"""
            INSERT INTO {REFERRAL_PROCESSED_EVENTS_TABLE} (event_id)
            VALUES ($1)
            ON CONFLICT (event_id) DO NOTHING
            """,
            event_id,
        )
    return "INSERT 0 1" in str(result)


async def referral_log_event(
    pool,
    event_type: str,
    *,
    user_id: str | None = None,
    referrer_user_id: str | None = None,
    invited_user_id: str | None = None,
    stripe_event_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            f"""
            INSERT INTO {REFERRAL_EVENTS_TABLE} (
                event_type, user_id, referrer_user_id, invited_user_id, stripe_event_id, metadata
            ) VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5, $6::jsonb)
            """,
            event_type,
            user_id,
            referrer_user_id,
            invited_user_id,
            stripe_event_id,
            metadata or {},
        )


async def referral_flag_abuse(
    pool,
    *,
    flag_type: str,
    user_id: str | None,
    score: int = 100,
    evidence: dict[str, Any] | None = None,
) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            f"""
            INSERT INTO {REFERRAL_ABUSE_FLAGS_TABLE} (flag_type, user_id, score, evidence)
            VALUES ($1, $2::uuid, $3, $4::jsonb)
            """,
            flag_type,
            user_id,
            max(0, min(score, 100)),
            evidence or {},
        )


async def referral_get_commission_by_invited(pool, invited_user_id: str) -> dict[str, Any] | None:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT * FROM {REFERRAL_COMMISSIONS_TABLE} WHERE invited_user_id = $1::uuid LIMIT 1",
            invited_user_id,
        )
    return dict(row) if row else None


async def referral_create_commission(
    pool,
    *,
    invited_user_id: str,
    referrer_user_id: str,
    stripe_invoice_id: str | None,
    amount_cents: int,
    currency: str = "usd",
    rate_percent: int = 30,
    status: str = "hold",
    reason: str | None = None,
) -> bool:
    """Create a one-time commission row. Returns True when inserted."""
    async with pool.acquire() as conn:
        result = await conn.execute(
            f"""
            INSERT INTO {REFERRAL_COMMISSIONS_TABLE} (
                invited_user_id, referrer_user_id, stripe_invoice_id, amount_cents, currency, rate_percent, status, reason
            ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (invited_user_id) DO NOTHING
            """,
            invited_user_id,
            referrer_user_id,
            stripe_invoice_id,
            int(amount_cents),
            (currency or "usd").lower(),
            int(rate_percent),
            status,
            reason,
        )
    return "INSERT 0 1" in str(result)


async def referral_partner_summary(pool, referrer_user_id: str) -> dict[str, Any]:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            SELECT
              COALESCE(COUNT(*) FILTER (WHERE c.status IN ('approved','paid')), 0) AS eligible_count,
              COALESCE(COUNT(*) FILTER (WHERE c.status = 'hold'), 0) AS pending_count,
              COALESCE(COUNT(*) FILTER (WHERE c.status = 'paid'), 0) AS paid_count,
              COALESCE(COUNT(*) FILTER (WHERE c.status = 'rejected'), 0) AS rejected_count,
              COALESCE(SUM(c.amount_cents) FILTER (WHERE c.status IN ('approved','paid')), 0) AS eligible_cents,
              COALESCE(SUM(c.amount_cents) FILTER (WHERE c.status = 'paid'), 0) AS paid_cents
            FROM {REFERRAL_COMMISSIONS_TABLE} c
            WHERE c.referrer_user_id = $1::uuid
            """,
            referrer_user_id,
        )
    d = dict(row) if row else {}
    return {
        "eligible_count": int(d.get("eligible_count") or 0),
        "pending_count": int(d.get("pending_count") or 0),
        "paid_count": int(d.get("paid_count") or 0),
        "rejected_count": int(d.get("rejected_count") or 0),
        "eligible_cents": int(d.get("eligible_cents") or 0),
        "paid_cents": int(d.get("paid_cents") or 0),
    }


async def referral_partner_commissions(pool, referrer_user_id: str, limit: int = 200) -> list[dict[str, Any]]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT c.*, u.email AS invited_email
            FROM {REFERRAL_COMMISSIONS_TABLE} c
            LEFT JOIN {USERS_TABLE} u ON u.id = c.invited_user_id
            WHERE c.referrer_user_id = $1::uuid
            ORDER BY c.created_at DESC
            LIMIT $2
            """,
            referrer_user_id,
            limit,
        )
    return [dict(r) for r in rows]


async def referral_admin_chains(pool, limit: int = 200) -> list[dict[str, Any]]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT
              a.id,
              a.first_seen_at,
              a.expires_at,
              a.status AS attribution_status,
              a.reason AS attribution_reason,
              a.code,
              ref_u.email AS referrer_email,
              inv_u.email AS invited_email,
              c.id AS commission_id,
              c.amount_cents,
              c.currency,
              c.status AS commission_status,
              c.reason AS commission_reason
            FROM {REFERRAL_ATTRIBUTIONS_TABLE} a
            LEFT JOIN {USERS_TABLE} ref_u ON ref_u.id = a.referrer_user_id
            LEFT JOIN {USERS_TABLE} inv_u ON inv_u.id = a.invited_user_id
            LEFT JOIN {REFERRAL_COMMISSIONS_TABLE} c ON c.invited_user_id = a.invited_user_id
            ORDER BY a.first_seen_at DESC
            LIMIT $1
            """,
            limit,
        )
    return [dict(r) for r in rows]


async def referral_admin_events(pool, limit: int = 300) -> list[dict[str, Any]]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT
              e.id,
              e.event_type,
              e.stripe_event_id,
              e.metadata,
              e.created_at,
              ref_u.email AS referrer_email,
              inv_u.email AS invited_email,
              u.email AS user_email
            FROM {REFERRAL_EVENTS_TABLE} e
            LEFT JOIN {USERS_TABLE} ref_u ON ref_u.id = e.referrer_user_id
            LEFT JOIN {USERS_TABLE} inv_u ON inv_u.id = e.invited_user_id
            LEFT JOIN {USERS_TABLE} u ON u.id = e.user_id
            ORDER BY e.created_at DESC
            LIMIT $1
            """,
            limit,
        )
    return [dict(r) for r in rows]


async def referral_admin_update_commission_status(
    pool,
    commission_id: str,
    *,
    status: str,
    reason: str | None,
    reviewer_user_id: str | None,
) -> bool:
    async with pool.acquire() as conn:
        result = await conn.execute(
            f"""
            UPDATE {REFERRAL_COMMISSIONS_TABLE}
            SET status = $1, reason = $2, reviewed_by = $3::uuid, reviewed_at = NOW()
            WHERE id = $4::uuid
            """,
            status,
            reason,
            reviewer_user_id,
            commission_id,
        )
    return "UPDATE 1" in str(result)


# --- Market Readiness (status indicator, not gamification) ---
# Этапы: первый 0–19 (20 очков), чтобы за 1 вход + анализ + оптимизацию (2+5+10=17) почти заполнить полоску.
READINESS_STAGES = [
    (0, 19, "Emerging"),
    (20, 39, "Structured"),
    (40, 79, "Competitive"),
    (80, 189, "Strong"),
    (190, 999999, "Interview-Ready"),
]

# Начисление очков (пропорционально: вход < анализ < оптимизация)
READINESS_DELTA_ANALYSIS = 5     # резюме прошло анализ (оценка по вакансии), без улучшения
READINESS_DELTA_OPTIMIZE = 10    # успешное улучшение (генерация PDF)
READINESS_DELTA_VISIT = 2        # вход в приложение, раз в день (любой: подряд или с перерывом)


def _stage_and_progress(score: int) -> tuple[str, float]:
    """Return (stage_name, progress_to_next) where progress_to_next is 0.0..1.0 within current stage."""
    score = max(0, min(score, 999999))
    for i, (lo, hi, name) in enumerate(READINESS_STAGES):
        if lo <= score <= hi:
            span = hi - lo + 1
            progress = (score - lo) / span if span else 0.0
            return (name, progress)
    return ("Interview-Ready", 1.0)


async def user_get_readiness(pool, user_id: str) -> dict | None:
    """Return { score, stage, progress_to_next, streak_days } for user."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""SELECT market_readiness_score, streak_days FROM {USERS_TABLE}
               WHERE id = $1::uuid""",
            user_id,
        )
    if row is None:
        return None
    score = int(row["market_readiness_score"] or 0)
    stage, progress = _stage_and_progress(score)
    return {
        "score": score,
        "stage": stage,
        "progress_to_next": round(progress, 3),
        "streak_days": int(row["streak_days"] or 0),
    }


async def user_increment_readiness(pool, user_id: str, delta: int = 5) -> None:
    """Slightly increase market readiness score (e.g. on upload, analysis, improvement). No events."""
    if delta <= 0:
        return
    async with pool.acquire() as conn:
        await conn.execute(
            f"""UPDATE {USERS_TABLE}
               SET market_readiness_score = GREATEST(0, market_readiness_score + $1)
               WHERE id = $2::uuid""",
            min(delta, 50),
            user_id,
        )


async def user_record_visit(pool, user_id: str) -> None:
    """Update last_visit_date, streak_days; add READINESS_DELTA_VISIT to score once per day (new entry)."""
    from datetime import date
    today = date.today()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT last_visit_date, streak_days, market_readiness_score FROM {USERS_TABLE} WHERE id = $1::uuid",
            user_id,
        )
        if row is None:
            return
        last = row["last_visit_date"]
        streak = int(row["streak_days"] or 0)
        if last == today:
            return
        if last is None:
            new_streak = 1
        else:
            delta_days = (today - last).days
            if delta_days == 1:
                new_streak = streak + 1
            else:
                new_streak = 1
        score_after = min(999999, int(row["market_readiness_score"] or 0) + READINESS_DELTA_VISIT)
        await conn.execute(
            f"""UPDATE {USERS_TABLE}
               SET last_visit_date = $1, streak_days = $2, market_readiness_score = $3
               WHERE id = $4::uuid""",
            today,
            new_streak,
            score_after,
            user_id,
        )


# --- Admin email automation & segments ---

ADMIN_EMAIL_SETTINGS_TABLE = "admin_email_settings"
EMAIL_WINBACK_SCHEDULE_TABLE = "email_winback_schedule"
ADMIN_EMAIL_CAMPAIGN_LOG_TABLE = "admin_email_campaign_log"


async def admin_email_settings_get(pool) -> dict[str, Any]:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(f"SELECT * FROM {ADMIN_EMAIL_SETTINGS_TABLE} WHERE id = 1")
    if row is None:
        return {
            "winback_auto_enabled": False,
            "winback_delay_min_minutes": 25,
            "winback_delay_max_minutes": 30,
            "resend_template_reminder_no_download": "",
            "resend_template_short_nudge": "",
        }
    d = dict(row)
    return {
        "winback_auto_enabled": bool(d.get("winback_auto_enabled")),
        "winback_delay_min_minutes": int(d.get("winback_delay_min_minutes") or 25),
        "winback_delay_max_minutes": int(d.get("winback_delay_max_minutes") or 30),
        "resend_template_reminder_no_download": str(d.get("resend_template_reminder_no_download") or "")[:200],
        "resend_template_short_nudge": str(d.get("resend_template_short_nudge") or "")[:200],
    }


async def admin_email_settings_update(
    pool,
    *,
    winback_auto_enabled: bool | None = None,
    winback_delay_min_minutes: int | None = None,
    winback_delay_max_minutes: int | None = None,
    resend_template_reminder_no_download: str | None = None,
    resend_template_short_nudge: str | None = None,
) -> dict[str, Any]:
    cur = await admin_email_settings_get(pool)
    n_auto = cur["winback_auto_enabled"] if winback_auto_enabled is None else bool(winback_auto_enabled)
    n_min = cur["winback_delay_min_minutes"] if winback_delay_min_minutes is None else int(winback_delay_min_minutes)
    n_max = cur["winback_delay_max_minutes"] if winback_delay_max_minutes is None else int(winback_delay_max_minutes)
    n_tr = (
        cur["resend_template_reminder_no_download"]
        if resend_template_reminder_no_download is None
        else (resend_template_reminder_no_download or "").strip()[:200]
    )
    n_tn = (
        cur["resend_template_short_nudge"]
        if resend_template_short_nudge is None
        else (resend_template_short_nudge or "").strip()[:200]
    )
    if n_min < 5:
        n_min = 5
    if n_min > 120:
        n_min = 120
    if n_max < n_min:
        n_max = n_min
    if n_max > 180:
        n_max = 180
    async with pool.acquire() as conn:
        await conn.execute(
            f"""
            UPDATE {ADMIN_EMAIL_SETTINGS_TABLE}
            SET winback_auto_enabled = $2,
                winback_delay_min_minutes = $3,
                winback_delay_max_minutes = $4,
                resend_template_reminder_no_download = $5,
                resend_template_short_nudge = $6,
                updated_at = NOW()
            WHERE id = $1
            """,
            1,
            n_auto,
            n_min,
            n_max,
            n_tr,
            n_tn,
        )
    return await admin_email_settings_get(pool)


async def email_winback_replace_pending(
    pool, user_id: str, run_at: datetime, template_id: str = "reminder-no-download"
) -> None:
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                f"DELETE FROM {EMAIL_WINBACK_SCHEDULE_TABLE} WHERE user_id = $1::uuid AND status = 'pending'",
                user_id,
            )
            await conn.execute(
                f"""
                INSERT INTO {EMAIL_WINBACK_SCHEDULE_TABLE} (user_id, run_at, template_id, status)
                VALUES ($1::uuid, $2, $3, 'pending')
                """,
                user_id,
                run_at,
                template_id,
            )


async def email_winback_claim_due_batch(pool, limit: int) -> list[dict[str, Any]]:
    """Mark rows as processing and return them (single worker / admin cron)."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                f"""
                UPDATE {EMAIL_WINBACK_SCHEDULE_TABLE}
                SET status = 'pending', claimed_at = NULL
                WHERE status = 'processing'
                  AND claimed_at IS NOT NULL
                  AND claimed_at < NOW() - interval '35 minutes'
                """
            )
            rows = await conn.fetch(
                f"""
                SELECT id, user_id, template_id FROM {EMAIL_WINBACK_SCHEDULE_TABLE}
                WHERE status = 'pending' AND run_at <= NOW()
                ORDER BY run_at ASC
                LIMIT $1
                FOR UPDATE SKIP LOCKED
                """,
                limit,
            )
            out = [dict(r) for r in rows]
            for r in out:
                await conn.execute(
                    f"""
                    UPDATE {EMAIL_WINBACK_SCHEDULE_TABLE}
                    SET status = 'processing', claimed_at = NOW()
                    WHERE id = $1::uuid
                    """,
                    r["id"],
                )
    return out


async def email_winback_mark_sent(pool, schedule_id: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            f"""
            UPDATE {EMAIL_WINBACK_SCHEDULE_TABLE}
            SET status = 'sent', sent_at = NOW(), error_message = NULL
            WHERE id = $1::uuid
            """,
            schedule_id,
        )


async def email_winback_mark_skipped_paid(pool, schedule_id: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            f"""
            UPDATE {EMAIL_WINBACK_SCHEDULE_TABLE}
            SET status = 'skipped_paid', sent_at = NOW(), error_message = NULL
            WHERE id = $1::uuid
            """,
            schedule_id,
        )


async def email_winback_mark_skipped_marketing(pool, schedule_id: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            f"""
            UPDATE {EMAIL_WINBACK_SCHEDULE_TABLE}
            SET status = 'skipped_marketing', sent_at = NOW(), error_message = NULL
            WHERE id = $1::uuid
            """,
            schedule_id,
        )


async def email_winback_mark_failed(pool, schedule_id: str, message: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            f"""
            UPDATE {EMAIL_WINBACK_SCHEDULE_TABLE}
            SET status = 'failed', error_message = $2, sent_at = NOW()
            WHERE id = $1::uuid
            """,
            schedule_id,
            (message or "")[:2000],
        )


async def admin_email_campaign_log_insert(
    pool,
    *,
    segment_id: str,
    template_id: str,
    dry_run: bool,
    recipients_planned: int,
    recipients_sent: int,
    error: str | None,
    created_by_email: str | None,
) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            f"""
            INSERT INTO {ADMIN_EMAIL_CAMPAIGN_LOG_TABLE}
            (segment_id, template_id, dry_run, recipients_planned, recipients_sent, error, created_by_email)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            segment_id,
            template_id,
            dry_run,
            recipients_planned,
            recipients_sent,
            error,
            created_by_email,
        )


def _sql_user_is_unpaid() -> str:
    return """NOT (
        LOWER(COALESCE(u.subscription_plan, 'free')) IN ('trial', 'monthly')
        AND LOWER(COALESCE(u.subscription_status, 'free')) IN ('active', 'trial')
    )"""


def _sql_user_marketing_opt_in() -> str:
    return "COALESCE(u.marketing_emails_opt_in, TRUE) = TRUE"


async def user_set_marketing_emails_opt_in(pool, user_id: str, opt_in: bool) -> bool:
    async with pool.acquire() as conn:
        n = await conn.execute(
            f"UPDATE {USERS_TABLE} SET marketing_emails_opt_in = $2 WHERE id = $1::uuid",
            user_id,
            bool(opt_in),
        )
    return "UPDATE 1" in str(n) or (n and "1" in str(n))


async def email_segment_optimized_unpaid_count(pool, days: int) -> int:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            WITH recent_opt AS (
                SELECT DISTINCT l.user_id AS uid
                FROM {USAGE_AUDIT_TABLE} l
                WHERE l.action = 'optimize_complete'
                  AND l.success = TRUE
                  AND l.user_id IS NOT NULL
                  AND l.created_at >= (NOW() - make_interval(days => $1::int))
            )
            SELECT COUNT(*)::int AS c
            FROM {USERS_TABLE} u
            INNER JOIN recent_opt ro ON ro.uid = u.id
            WHERE {_sql_user_is_unpaid()}
              AND COALESCE(u.admin_blocked, FALSE) = FALSE
              AND {_sql_user_marketing_opt_in()}
            """,
            days,
        )
    return int(row["c"]) if row else 0


async def email_segment_optimized_unpaid_emails(pool, days: int, limit: int) -> list[str]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            WITH recent_opt AS (
                SELECT DISTINCT l.user_id AS uid
                FROM {USAGE_AUDIT_TABLE} l
                WHERE l.action = 'optimize_complete'
                  AND l.success = TRUE
                  AND l.user_id IS NOT NULL
                  AND l.created_at >= (NOW() - make_interval(days => $1::int))
            )
            SELECT u.email
            FROM {USERS_TABLE} u
            INNER JOIN recent_opt ro ON ro.uid = u.id
            WHERE {_sql_user_is_unpaid()}
              AND COALESCE(u.admin_blocked, FALSE) = FALSE
              AND {_sql_user_marketing_opt_in()}
            ORDER BY u.email
            LIMIT $2
            """,
            days,
            limit,
        )
    return [str(r["email"]) for r in rows]


async def email_winback_pending_count(pool) -> int:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT COUNT(*)::int AS c FROM {EMAIL_WINBACK_SCHEDULE_TABLE} WHERE status = 'pending'"
        )
    return int(row["c"]) if row else 0


async def email_winback_delete_pending_for_user(pool, user_id: str) -> None:
    """Remove queued win-back when user subscribed (Stripe) or account deleted."""
    async with pool.acquire() as conn:
        await conn.execute(
            f"DELETE FROM {EMAIL_WINBACK_SCHEDULE_TABLE} WHERE user_id = $1::uuid AND status = 'pending'",
            user_id,
        )
