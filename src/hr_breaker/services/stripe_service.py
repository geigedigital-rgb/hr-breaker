"""
Stripe checkout and webhook handling for HR-Breaker subscriptions.

- Trial: one-time $2.99 (STRIPE_PRICE_TRIAL_ID) → set subscription_status=trial, current_period_end=now+7d
- Monthly: recurring $29 (STRIPE_PRICE_MONTHLY_ID) → subscription from Stripe, period from invoice
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta

from hr_breaker.config import get_settings

logger = logging.getLogger(__name__)

# Price key used by frontend/API
PRICE_KEY_TRIAL = "trial"
PRICE_KEY_MONTHLY = "monthly"
TRIAL_DAYS = 7


def _stripe():
    import stripe
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise ValueError("STRIPE_SECRET_KEY not set")
    stripe.api_key = settings.stripe_secret_key
    return stripe


def get_price_id(price_key: str) -> str:
    settings = get_settings()
    if price_key == PRICE_KEY_TRIAL:
        pid = settings.stripe_price_trial_id
    elif price_key == PRICE_KEY_MONTHLY:
        pid = settings.stripe_price_monthly_id
    else:
        raise ValueError(f"Unknown price_key: {price_key}")
    if not pid:
        raise ValueError(f"Stripe price not configured for {price_key}")
    return pid


async def create_checkout_session(
    user_id: str,
    user_email: str,
    price_key: str,
    success_url: str,
    cancel_url: str,
    pool,
    get_or_create_customer_id,
    set_stripe_customer_id,
) -> str:
    """
    Create Stripe Checkout session. Returns session URL to redirect to.
    get_or_create_customer_id(pool, user_id) -> stripe_customer_id | None (existing or None to create).
    set_stripe_customer_id(pool, user_id, stripe_customer_id) to persist new customer id.
    """
    stripe = _stripe()
    price_id = get_price_id(price_key)
    customer_id = await get_or_create_customer_id(pool, user_id)
    if not customer_id:
        customer = stripe.Customer.create(email=user_email, metadata={"hr_breaker_user_id": user_id})
        customer_id = customer.id
        await set_stripe_customer_id(pool, user_id, customer_id)

    mode = "payment" if price_key == PRICE_KEY_TRIAL else "subscription"
    session = stripe.checkout.Session.create(
        customer=customer_id,
        mode=mode,
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={"hr_breaker_user_id": user_id, "price_key": price_key},
        allow_promotion_codes=True,
    )
    return session.url or ""


def construct_event(payload: bytes, sig_header: str) -> object:
    """Verify and parse webhook event. Raises if invalid."""
    import stripe
    settings = get_settings()
    secret = settings.stripe_webhook_secret
    if not secret:
        raise ValueError("STRIPE_WEBHOOK_SECRET not set")
    return stripe.Webhook.construct_event(payload, sig_header, secret)


async def handle_checkout_session_completed(
    session: object,
    pool,
    user_update_subscription,
) -> None:
    """On successful payment: set trial (7d) for one-time trial; for subscription sync from Stripe."""
    metadata = getattr(session, "metadata", None) or {}
    user_id = (metadata or {}).get("hr_breaker_user_id")
    price_key = (metadata or {}).get("price_key")
    if not user_id:
        logger.warning("checkout.session.completed: no hr_breaker_user_id in metadata")
        return

    if getattr(session, "mode", None) == "payment":
        if price_key == PRICE_KEY_TRIAL:
            period_end = datetime.now(timezone.utc) + timedelta(days=TRIAL_DAYS)
            await user_update_subscription(
                pool,
                user_id,
                subscription_status="trial",
                subscription_plan="trial",
                current_period_end=period_end,
            )
            logger.info("Trial activated for user %s until %s", user_id, period_end)
        return

    if getattr(session, "mode", None) == "subscription":
        sub_id = getattr(session, "subscription", None)
        if not sub_id:
            return
        stripe = _stripe()
        sub = stripe.Subscription.retrieve(sub_id)
        current_period_end = datetime.fromtimestamp(sub.current_period_end, tz=timezone.utc)
        await user_update_subscription(
            pool,
            user_id,
            stripe_subscription_id=sub.id,
            subscription_status="active",
            subscription_plan="monthly",
            current_period_end=current_period_end,
        )
        logger.info("Subscription activated for user %s until %s", user_id, current_period_end)


async def handle_subscription_updated(
    subscription: object,
    pool,
    get_user_id_by_stripe_customer,
    user_update_subscription,
) -> None:
    """Sync subscription status and current_period_end from Stripe."""
    sub_id = getattr(subscription, "id", None)
    customer_id = getattr(subscription, "customer", None)
    if not customer_id or not sub_id:
        return
    status = getattr(subscription, "status", None)
    current_period_end_ts = getattr(subscription, "current_period_end", None)
    if not current_period_end_ts:
        return
    current_period_end = datetime.fromtimestamp(current_period_end_ts, tz=timezone.utc)
    user_id = await get_user_id_by_stripe_customer(pool, customer_id)
    if not user_id:
        logger.warning("subscription.updated: no user for customer %s", customer_id)
        return
    if status in ("active", "trialing"):
        status = "active"
    elif status in ("canceled", "unpaid", "past_due", "incomplete_expired"):
        status = "canceled"
    await user_update_subscription(
        pool,
        user_id,
        stripe_subscription_id=sub_id,
        subscription_status=status,
        subscription_plan="monthly",
        current_period_end=current_period_end,
    )


async def handle_subscription_deleted(
    subscription: object,
    pool,
    get_user_id_by_stripe_customer,
    user_update_subscription,
) -> None:
    """Clear subscription and set status to free."""
    customer_id = getattr(subscription, "customer", None)
    if not customer_id:
        return
    user_id = await get_user_id_by_stripe_customer(pool, customer_id)
    if not user_id:
        return
    await user_update_subscription(
        pool,
        user_id,
        stripe_subscription_id=None,
        subscription_status="free",
        subscription_plan="free",
        current_period_end=None,
    )
