"""
Postgres persistence for landing reviews (moderation + public API).

Requires DATABASE_URL and asyncpg (hr-breaker[db]).
"""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any

REVIEWS_TABLE = "reviews"

_REVIEW_TABLE_SQL = f"""
CREATE TABLE IF NOT EXISTS {REVIEWS_TABLE} (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_name TEXT NOT NULL,
    author_email TEXT NOT NULL,
    author_role TEXT,
    country TEXT,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    would_recommend BOOLEAN NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    feature_tag TEXT,
    source TEXT NOT NULL DEFAULT 'native',
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    consent_to_publish BOOLEAN NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_moderator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    admin_notes TEXT,
    helpful_count INTEGER NOT NULL DEFAULT 0,
    language TEXT,
    submitter_ip TEXT
);
"""

_REVIEW_INDEXES = [
    f"CREATE INDEX IF NOT EXISTS idx_reviews_public ON {REVIEWS_TABLE}(status, consent_to_publish, pinned DESC, published_at DESC NULLS LAST)",
    f"CREATE INDEX IF NOT EXISTS idx_reviews_created ON {REVIEWS_TABLE}(created_at DESC)",
    f"CREATE INDEX IF NOT EXISTS idx_reviews_status_created ON {REVIEWS_TABLE}(status, created_at DESC)",
    f"CREATE INDEX IF NOT EXISTS idx_reviews_email_time ON {REVIEWS_TABLE}(lower(trim(author_email)), created_at DESC)",
    f"CREATE INDEX IF NOT EXISTS idx_reviews_ip_time ON {REVIEWS_TABLE}(submitter_ip, created_at DESC)",
]


async def ensure_reviews_schema(conn) -> None:
    await conn.execute(_REVIEW_TABLE_SQL)
    for stmt in _REVIEW_INDEXES:
        await conn.execute(stmt)


def _norm_email(email: str) -> str:
    return (email or "").strip().lower()


async def reviews_count_ip_recent(pool, ip: str | None, hours: int) -> int:
    if not ip:
        return 0
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            SELECT COUNT(*)::int AS c FROM {REVIEWS_TABLE}
            WHERE submitter_ip = $1 AND created_at > NOW() - ($2::int * INTERVAL '1 hour')
            """,
            ip,
            max(1, int(hours)),
        )
        return int(row["c"]) if row else 0


async def reviews_count_email_recent(pool, email: str, days: int) -> int:
    e = _norm_email(email)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            SELECT COUNT(*)::int AS c FROM {REVIEWS_TABLE}
            WHERE lower(trim(author_email)) = $1
              AND created_at > NOW() - ($2::int * INTERVAL '1 day')
            """,
            e,
            max(1, int(days)),
        )
        return int(row["c"]) if row else 0


async def reviews_insert(
    pool,
    *,
    author_name: str,
    author_email: str,
    author_role: str | None,
    country: str | None,
    rating: int,
    would_recommend: bool,
    title: str,
    body: str,
    feature_tag: str | None,
    consent_to_publish: bool,
    source: str = "native",
    submitter_ip: str | None = None,
) -> str:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            INSERT INTO {REVIEWS_TABLE} (
                author_name, author_email, author_role, country, rating, would_recommend,
                title, body, feature_tag, consent_to_publish, source, status, submitter_ip
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12)
            RETURNING id::text
            """,
            author_name.strip(),
            author_email.strip(),
            author_role.strip() if author_role else None,
            country.strip() if country else None,
            rating,
            would_recommend,
            title.strip(),
            body.strip(),
            feature_tag.strip() if feature_tag else None,
            consent_to_publish,
            source,
            submitter_ip,
        )
        return row["id"]


async def reviews_list_public(
    pool,
    *,
    limit: int = 20,
    offset: int = 0,
    sort: str = "recent",
) -> list[dict[str, Any]]:
    sort = sort if sort in ("recent", "rating") else "recent"
    # pinned DESC, then sort key, tie-break id
    order_rating = "r.rating DESC, r.published_at DESC NULLS LAST, r.id DESC"
    order_recent = "r.published_at DESC NULLS LAST, r.id DESC"
    order_tail = order_rating if sort == "rating" else order_recent
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT r.id::text AS id, r.author_name, r.rating, r.title, r.body,
                   r.published_at, r.verified, r.source, r.feature_tag
            FROM {REVIEWS_TABLE} r
            WHERE r.status = 'approved' AND r.consent_to_publish = TRUE
            ORDER BY r.pinned DESC, {order_tail}
            LIMIT $1 OFFSET $2
            """,
            limit,
            offset,
        )
        out: list[dict[str, Any]] = []
        for r in rows:
            d = dict(r)
            p = d.get("published_at")
            if p is not None and hasattr(p, "isoformat"):
                d["published_at"] = p.isoformat()
            out.append(d)
        return out


async def reviews_stats(pool) -> dict[str, Any]:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            SELECT
              COALESCE(ROUND(AVG(rating)::numeric, 1), 0)::float AS average_rating,
              COUNT(*)::int AS review_count,
              COUNT(*) FILTER (WHERE would_recommend IS NOT NULL)::int AS with_recommend,
              COUNT(*) FILTER (WHERE would_recommend = TRUE)::int AS recommend_yes
            FROM {REVIEWS_TABLE}
            WHERE status = 'approved' AND consent_to_publish = TRUE
            """
        )
        if not row:
            return {"average_rating": 0.0, "review_count": 0, "recommend_percent": None}
        avg = float(row["average_rating"])
        cnt = int(row["review_count"])
        denom = int(row["with_recommend"])
        yes = int(row["recommend_yes"])
        rec = round(100.0 * yes / denom, 1) if denom > 0 else None
        return {
            "average_rating": avg,
            "review_count": cnt,
            "recommend_percent": rec,
        }


async def reviews_list_admin(
    pool,
    *,
    status: str | None = None,
    rating: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    conditions: list[str] = ["1=1"]
    args: list[Any] = []
    i = 1
    if status:
        conditions.append(f"status = ${i}")
        args.append(status)
        i += 1
    if rating is not None:
        conditions.append(f"rating = ${i}")
        args.append(rating)
        i += 1
    if date_from:
        conditions.append(f"created_at >= ${i}")
        args.append(date_from)
        i += 1
    if date_to:
        conditions.append(f"created_at <= ${i}")
        args.append(date_to)
        i += 1
    where_sql = " AND ".join(conditions)
    args_limit = list(args) + [limit, offset]
    async with pool.acquire() as conn:
        total_row = await conn.fetchrow(
            f"SELECT COUNT(*)::int AS c FROM {REVIEWS_TABLE} WHERE {where_sql}",
            *args,
        )
        total = int(total_row["c"]) if total_row else 0
        rows = await conn.fetch(
            f"""
            SELECT id::text AS id, author_name, author_email, author_role, country, rating, would_recommend,
                   title, body, feature_tag, source, verified, pinned, consent_to_publish, status,
                   published_at, created_at, updated_at, last_moderator_id::text AS last_moderator_id,
                   admin_notes, helpful_count, language, submitter_ip
            FROM {REVIEWS_TABLE}
            WHERE {where_sql}
            ORDER BY created_at DESC
            LIMIT ${i} OFFSET ${i + 1}
            """,
            *args_limit,
        )
        out = []
        for r in rows:
            d = dict(r)
            if d.get("published_at") and hasattr(d["published_at"], "isoformat"):
                d["published_at"] = d["published_at"].isoformat()
            if d.get("created_at") and hasattr(d["created_at"], "isoformat"):
                d["created_at"] = d["created_at"].isoformat()
            if d.get("updated_at") and hasattr(d["updated_at"], "isoformat"):
                d["updated_at"] = d["updated_at"].isoformat()
            out.append(d)
        return out, total


async def reviews_apply_patch(
    pool,
    review_id: str,
    *,
    moderator_user_id: str | None,
    patch: dict[str, Any],
) -> dict[str, Any] | None:
    """Apply only keys present in patch (from model_dump(exclude_unset=True))."""
    if not patch:
        return await reviews_get_admin_row(pool, review_id)
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                f"SELECT * FROM {REVIEWS_TABLE} WHERE id = $1::uuid FOR UPDATE",
                review_id,
            )
            if row is None:
                return None
            old = dict(row)
            new_status = patch["status"] if "status" in patch else old["status"]
            new_verified = patch["verified"] if "verified" in patch else old["verified"]
            new_pinned = patch["pinned"] if "pinned" in patch else old["pinned"]
            new_title = (
                str(patch["title"]).strip()
                if "title" in patch
                else old["title"]
            )
            new_body = (
                str(patch["body"]).strip()
                if "body" in patch
                else old["body"]
            )
            new_notes = patch["admin_notes"] if "admin_notes" in patch else old.get("admin_notes")

            published_at = old.get("published_at")
            if (
                new_status == "approved"
                and (old.get("status") or "") != "approved"
                and published_at is None
            ):
                published_at = datetime.now(timezone.utc)

            mod_id = (
                moderator_user_id
                if moderator_user_id is not None
                else old.get("last_moderator_id")
            )

            await conn.execute(
                f"""
                UPDATE {REVIEWS_TABLE}
                SET status = $2,
                    verified = $3,
                    pinned = $4,
                    title = $5,
                    body = $6,
                    admin_notes = $7,
                    published_at = $8,
                    last_moderator_id = $9::uuid,
                    updated_at = NOW()
                WHERE id = $1::uuid
                """,
                review_id,
                new_status,
                new_verified,
                new_pinned,
                new_title,
                new_body,
                new_notes,
                published_at,
                mod_id,
            )

    return await reviews_get_admin_row(pool, review_id)


async def reviews_get_admin_row(pool, review_id: str) -> dict[str, Any] | None:
    """One row with timestamps as ISO strings (admin JSON)."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            SELECT id::text AS id, author_name, author_email, author_role, country, rating, would_recommend,
                   title, body, feature_tag, source, verified, pinned, consent_to_publish, status,
                   published_at, created_at, updated_at, last_moderator_id::text AS last_moderator_id,
                   admin_notes, helpful_count, language, submitter_ip
            FROM {REVIEWS_TABLE}
            WHERE id = $1::uuid
            """,
            review_id,
        )
    if row is None:
        return None
    d = dict(row)
    for key in ("published_at", "created_at", "updated_at"):
        v = d.get(key)
        if v is not None and hasattr(v, "isoformat"):
            d[key] = v.isoformat()
    return d


_REVIEWS_EXPORT_COLUMNS = [
    "id",
    "author_name",
    "author_email",
    "author_role",
    "country",
    "rating",
    "would_recommend",
    "title",
    "body",
    "feature_tag",
    "source",
    "verified",
    "pinned",
    "consent_to_publish",
    "status",
    "published_at",
    "created_at",
    "updated_at",
    "last_moderator_id",
    "admin_notes",
    "helpful_count",
    "language",
    "submitter_ip",
]


async def reviews_export_csv(
    pool,
    *,
    status: str | None = None,
    rating: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> str:
    conditions: list[str] = ["1=1"]
    args: list[Any] = []
    i = 1
    if status:
        conditions.append(f"status = ${i}")
        args.append(status)
        i += 1
    if rating is not None:
        conditions.append(f"rating = ${i}")
        args.append(rating)
        i += 1
    if date_from:
        conditions.append(f"created_at >= ${i}")
        args.append(date_from)
        i += 1
    if date_to:
        conditions.append(f"created_at <= ${i}")
        args.append(date_to)
        i += 1
    where_sql = " AND ".join(conditions)
    cols_sql = ", ".join(_REVIEWS_EXPORT_COLUMNS)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"SELECT {cols_sql} FROM {REVIEWS_TABLE} WHERE {where_sql} ORDER BY created_at DESC",
            *args,
        )
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(_REVIEWS_EXPORT_COLUMNS)
    for r in rows:
        d = dict(r)
        w.writerow([_csv_cell(d.get(c)) for c in _REVIEWS_EXPORT_COLUMNS])
    return buf.getvalue()


def _csv_cell(v: Any) -> str:
    if v is None:
        return ""
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v)
