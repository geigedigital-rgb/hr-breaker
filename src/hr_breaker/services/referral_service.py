from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

from hr_breaker.services.db import (
    REFERRAL_ATTRIBUTIONS_TABLE,
    referral_create_attribution,
    referral_create_commission,
    referral_flag_abuse,
    referral_get_attribution_by_invited,
    referral_get_commission_by_invited,
    referral_get_referrer_by_code,
    referral_log_event,
    user_get_id_by_stripe_customer_id,
)
from hr_breaker.services.stripe_service import stripe_subscription_allows_referral_commission

logger = logging.getLogger(__name__)

COOKIE_DAYS = 30
COMMISSION_RATE_PERCENT = 30
MIN_PAYOUT_CENTS = 35_000
PARTNER_WELCOME_BONUS_CENTS = 2000

_COUPON_HOST_DENYLIST = {
    "coupon",
    "coupons",
    "deal",
    "deals",
    "promo",
    "promocode",
    "promocodes",
}


def _to_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _invoice_get(invoice: object, key: str, default: Any = None) -> Any:
    if isinstance(invoice, dict):
        return invoice.get(key, default)
    return getattr(invoice, key, default)


def invoice_subscription_id(invoice: object) -> str | None:
    """Stripe subscription id from an invoice, if this is a subscription invoice."""
    sub = _invoice_get(invoice, "subscription", None)
    if sub is None:
        return None
    if isinstance(sub, str):
        s = sub.strip()
        return s or None
    if isinstance(sub, dict):
        sid = sub.get("id")
        if sid is None:
            return None
        s = str(sid).strip()
        return s or None
    sid = getattr(sub, "id", None)
    if sid is None:
        return None
    s = str(sid).strip()
    return s or None


def normalize_referral_code(code: str | None) -> str:
    return (code or "").strip().lower()


def has_coupon_like_source(source_url: str | None) -> bool:
    if not source_url:
        return False
    try:
        host = (urlparse(source_url).netloc or "").lower()
    except Exception:
        return False
    return any(part in host for part in _COUPON_HOST_DENYLIST)


def invoice_uses_coupon(invoice: object) -> bool:
    total_discount_amounts = _invoice_get(invoice, "total_discount_amounts", None)
    if total_discount_amounts:
        return True
    discount = _invoice_get(invoice, "discount", None)
    if discount:
        return True
    return False


def invoice_is_trial_like(invoice: object) -> bool:
    amount_paid = int(_invoice_get(invoice, "amount_paid", 0) or 0)
    if amount_paid <= 0:
        return True

    lines = _invoice_get(invoice, "lines", None)
    line_items = []
    if isinstance(lines, dict):
        line_items = lines.get("data") or []
    elif lines is not None:
        line_items = getattr(lines, "data", []) or []
    for item in line_items:
        desc = ""
        if isinstance(item, dict):
            desc = str(item.get("description") or "")
        else:
            desc = str(getattr(item, "description", "") or "")
        if "trial 7 days" in desc.lower():
            return True
    return False


async def _is_velocity_suspicious(pool, referrer_user_id: str) -> bool:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            SELECT COUNT(*) AS c
            FROM {REFERRAL_ATTRIBUTIONS_TABLE}
            WHERE referrer_user_id = $1::uuid
              AND first_seen_at >= NOW() - INTERVAL '10 minutes'
            """,
            referrer_user_id,
        )
    count = int(row["c"]) if row else 0
    return count >= 15


async def try_apply_referral_after_auth(
    pool,
    *,
    invited_user_id: str,
    invited_email: str,
    referral_code: str | None,
    source_url: str | None = None,
    ttl_days: int = COOKIE_DAYS,
) -> dict[str, Any]:
    """
    Attach referral attribution to an authenticated user.
    Enforces one-user-once and anti-abuse checks.
    """
    code = normalize_referral_code(referral_code)
    if not code:
        return {"applied": False, "reason": "empty_code"}

    existing = await referral_get_attribution_by_invited(pool, invited_user_id)
    if existing:
        return {"applied": False, "reason": "already_attributed"}

    ref = await referral_get_referrer_by_code(pool, code)
    if not ref:
        return {"applied": False, "reason": "invalid_code"}

    referrer_user_id = str(ref["owner_user_id"])
    referrer_email = str(ref.get("email") or "").strip().lower()
    invited_email_norm = (invited_email or "").strip().lower()

    if referrer_user_id == invited_user_id or (referrer_email and referrer_email == invited_email_norm):
        await referral_flag_abuse(
            pool,
            flag_type="self_referral_attempt",
            user_id=invited_user_id,
            evidence={"code": code, "referrer_user_id": referrer_user_id},
        )
        await referral_log_event(
            pool,
            "referral_self_referral_rejected",
            user_id=invited_user_id,
            referrer_user_id=referrer_user_id,
            invited_user_id=invited_user_id,
            metadata={"code": code},
        )
        return {"applied": False, "reason": "self_referral"}

    if has_coupon_like_source(source_url):
        await referral_flag_abuse(
            pool,
            flag_type="coupon_site_source",
            user_id=invited_user_id,
            evidence={"code": code, "source_url": source_url},
        )
        await referral_log_event(
            pool,
            "referral_coupon_source_rejected",
            user_id=invited_user_id,
            referrer_user_id=referrer_user_id,
            invited_user_id=invited_user_id,
            metadata={"code": code, "source_url": source_url},
        )
        return {"applied": False, "reason": "coupon_site"}

    status = "attributed"
    reason = None
    if await _is_velocity_suspicious(pool, referrer_user_id):
        status = "hold"
        reason = "high_velocity"
        await referral_flag_abuse(
            pool,
            flag_type="high_velocity_referrals",
            user_id=referrer_user_id,
            evidence={"code": code},
        )

    expires_at = datetime.now(timezone.utc) + timedelta(days=max(1, ttl_days))
    created = await referral_create_attribution(
        pool,
        invited_user_id=invited_user_id,
        referrer_user_id=referrer_user_id,
        code=code,
        source_url=source_url,
        expires_at=expires_at,
        status=status,
        reason=reason,
    )
    if not created:
        return {"applied": False, "reason": "already_attributed"}

    await referral_log_event(
        pool,
        "referral_attributed",
        user_id=invited_user_id,
        referrer_user_id=referrer_user_id,
        invited_user_id=invited_user_id,
        metadata={"code": code, "status": status, "source_url": source_url},
    )
    return {"applied": True, "status": status}


async def process_first_paid_invoice_commission(
    pool,
    *,
    invoice: object,
    stripe_event_id: str | None = None,
) -> dict[str, Any]:
    """
    Create one commission for first eligible paid invoice.
    Returns {"created": bool, "reason": str}.
    """
    customer_id = _invoice_get(invoice, "customer", None)
    if not customer_id:
        return {"created": False, "reason": "no_customer"}
    invited_user_id = await user_get_id_by_stripe_customer_id(pool, str(customer_id))
    if not invited_user_id:
        return {"created": False, "reason": "customer_not_mapped"}

    # Once per invited user.
    existing_commission = await referral_get_commission_by_invited(pool, invited_user_id)
    if existing_commission:
        return {"created": False, "reason": "already_commissioned"}

    attr = await referral_get_attribution_by_invited(pool, invited_user_id)
    if not attr:
        return {"created": False, "reason": "no_attribution"}

    expires_at = _to_utc(attr.get("expires_at"))
    now = datetime.now(timezone.utc)
    if expires_at and expires_at < now:
        await referral_log_event(
            pool,
            "referral_commission_skipped_expired",
            invited_user_id=invited_user_id,
            referrer_user_id=str(attr.get("referrer_user_id")),
            stripe_event_id=stripe_event_id,
            metadata={"expires_at": expires_at.isoformat()},
        )
        return {"created": False, "reason": "attribution_expired"}

    sub_id = invoice_subscription_id(invoice)
    if not sub_id:
        await referral_log_event(
            pool,
            "referral_commission_skipped_no_subscription",
            invited_user_id=invited_user_id,
            referrer_user_id=str(attr.get("referrer_user_id")),
            stripe_event_id=stripe_event_id,
            metadata={"invoice_id": _invoice_get(invoice, "id", None)},
        )
        return {"created": False, "reason": "no_subscription"}

    if not stripe_subscription_allows_referral_commission(sub_id):
        await referral_log_event(
            pool,
            "referral_commission_skipped_subscription_not_monthly_active",
            invited_user_id=invited_user_id,
            referrer_user_id=str(attr.get("referrer_user_id")),
            stripe_event_id=stripe_event_id,
            metadata={
                "invoice_id": _invoice_get(invoice, "id", None),
                "subscription_id": sub_id,
            },
        )
        return {"created": False, "reason": "subscription_not_monthly_active"}

    if invoice_is_trial_like(invoice):
        await referral_log_event(
            pool,
            "referral_commission_skipped_trial",
            invited_user_id=invited_user_id,
            referrer_user_id=str(attr.get("referrer_user_id")),
            stripe_event_id=stripe_event_id,
            metadata={"invoice_id": _invoice_get(invoice, "id", None)},
        )
        return {"created": False, "reason": "trial_or_zero"}

    if invoice_uses_coupon(invoice):
        await referral_log_event(
            pool,
            "referral_commission_skipped_coupon",
            invited_user_id=invited_user_id,
            referrer_user_id=str(attr.get("referrer_user_id")),
            stripe_event_id=stripe_event_id,
            metadata={"invoice_id": _invoice_get(invoice, "id", None)},
        )
        return {"created": False, "reason": "coupon"}

    amount_paid = int(_invoice_get(invoice, "amount_paid", 0) or 0)
    if amount_paid <= 0:
        return {"created": False, "reason": "non_positive_amount"}
    commission_cents = int(round((amount_paid * COMMISSION_RATE_PERCENT) / 100))
    if commission_cents <= 0:
        return {"created": False, "reason": "zero_commission"}

    currency = str(_invoice_get(invoice, "currency", "usd") or "usd").lower()
    stripe_invoice_id = str(_invoice_get(invoice, "id", "") or "")
    created = await referral_create_commission(
        pool,
        invited_user_id=invited_user_id,
        referrer_user_id=str(attr["referrer_user_id"]),
        stripe_invoice_id=stripe_invoice_id or None,
        amount_cents=commission_cents,
        currency=currency,
        rate_percent=COMMISSION_RATE_PERCENT,
        status="hold",
        reason="awaiting_review",
    )
    if not created:
        return {"created": False, "reason": "duplicate_insert"}

    await referral_log_event(
        pool,
        "referral_commission_created",
        invited_user_id=invited_user_id,
        referrer_user_id=str(attr["referrer_user_id"]),
        stripe_event_id=stripe_event_id,
        metadata={
            "invoice_id": stripe_invoice_id,
            "amount_paid_cents": amount_paid,
            "commission_cents": commission_cents,
            "currency": currency,
            "rate_percent": COMMISSION_RATE_PERCENT,
        },
    )
    logger.info(
        "Referral commission created invited=%s referrer=%s commission_cents=%s",
        invited_user_id,
        str(attr["referrer_user_id"]),
        commission_cents,
    )
    return {"created": True, "reason": "ok"}


def partner_terms() -> list[str]:
    return [
        "30% from the first paid monthly subscription charge only (after any 7-day trial; trialing / trial signup fees do not count).",
        f"A one-time ${PARTNER_WELCOME_BONUS_CENTS / 100:.0f} welcome credit from PitchCV is added when you join the partner program (counts toward your payout balance).",
        "Attribution window is 30 days from a valid referral click.",
        "No commission for registration, trial period, or email signup alone.",
        "One commission per invited user; duplicates are rejected.",
        "Self-referrals and coupon/deal-site traffic are prohibited.",
        "Minimum payout threshold is $350 and payouts are manual.",
    ]
