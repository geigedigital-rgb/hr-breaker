"""
Optional Postgres (e.g. Neon) storage for history metadata and users.

When DATABASE_URL is set, the API uses this for auth and history (list/save/delete).
PDF and source .txt files stay on disk; only metadata is in the DB.

Requires: pip install 'hr-breaker[db]'
"""

import logging
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from hr_breaker.config import get_settings
from hr_breaker.models import GeneratedPDF

logger = logging.getLogger(__name__)

USERS_TABLE = "users"
RESUMES_TABLE = "generated_resumes"
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
        await conn.execute(f"CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON {USERS_TABLE}(stripe_customer_id)")


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


USER_SUBSCRIPTION_COLS = "stripe_customer_id, stripe_subscription_id, subscription_status, subscription_plan, current_period_end, free_analyses_count"

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
    """Return subscription info for user. Resolves effective status (e.g. trial/active past period_end -> free)."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT subscription_status, subscription_plan, current_period_end, free_analyses_count FROM {USERS_TABLE} WHERE id = $1::uuid",
            user_id,
        )
    if row is None:
        return {"plan": "free", "status": "free", "current_period_end": None, "free_analyses_count": 0}
    status = (row["subscription_status"] or "free").lower()
    plan = (row["subscription_plan"] or "free").lower()
    period_end = row["current_period_end"]
    free_analyses_count = row["free_analyses_count"] or 0
    if period_end:
        from datetime import timezone
        now = datetime.now(timezone.utc)
        if getattr(period_end, "tzinfo", None) is None:
            period_end = period_end.replace(tzinfo=timezone.utc)
        if period_end < now and status in ("trial", "active"):
            status = "free"
            plan = "free"
    return {
        "plan": plan,
        "status": status,
        "current_period_end": period_end.isoformat() if period_end else None,
        "free_analyses_count": free_analyses_count,
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


async def user_increment_free_analyses(pool, user_id: str) -> None:
    """Increment the free analyses count for the user."""
    async with pool.acquire() as conn:
        await conn.execute(
            f"UPDATE {USERS_TABLE} SET free_analyses_count = free_analyses_count + 1 WHERE id = $1::uuid",
            user_id,
        )


async def ensure_seed_user(pool) -> str:
    """Ensure user marichakgroup@gmail.com exists; return user id. Used for migration and default login."""
    from hr_breaker.services.auth import hash_password
    row = await user_get_by_email(pool, "marichakgroup@gmail.com")
    if row:
        return str(row["id"])
    pass_hash = hash_password("admin")
    user = await user_create(pool, "marichakgroup@gmail.com", password_hash=pass_hash, name="Marichak")
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
    """List all users (id, email, name, created_at, subscription_status, subscription_plan). For admin only."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"SELECT id, email, name, created_at, subscription_status, subscription_plan FROM {USERS_TABLE} ORDER BY created_at DESC LIMIT $1",
            limit,
        )
    return [dict(r) for r in rows]


async def db_recent_resumes_with_user(pool, output_dir: Path, limit: int = 100) -> list[dict]:
    """Recent resume records with user email (join users). For admin activity feed. Only records with existing PDF."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT r.filename, r.company, r.job_title, r.created_at, r.user_id, u.email as user_email
            FROM {TABLE} r
            LEFT JOIN {USERS_TABLE} u ON r.user_id = u.id
            ORDER BY r.created_at DESC
            LIMIT $1
            """,
            limit,
        )
    result = []
    for r in rows:
        rec = dict(r)
        path = output_dir / rec["filename"]
        if path.is_file():
            result.append({
                "filename": rec["filename"],
                "company": rec["company"] or "",
                "job_title": rec["job_title"] or "",
                "created_at": rec["created_at"],
                "user_email": rec.get("user_email") or None,
            })
    return result


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
