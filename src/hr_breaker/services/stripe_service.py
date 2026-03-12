"""
Stripe checkout and webhook handling for HR-Breaker subscriptions.

- Trial: subscription to monthly $29 with 7-day trial; at signup we charge $2.99 (invoice).
  After 7 days Stripe automatically charges $29/month. Card required → protects from abuse.
- Monthly: subscription $29/month, no trial.
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
# Amount charged at trial signup (cents)
TRIAL_SIGNUP_CENTS = 299  # $2.99
TRIAL_SIGNUP_CURRENCY = "usd"


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
        # Trial uses the monthly price with trial_period_days
        pid = settings.stripe_price_monthly_id
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
    Create Stripe Checkout session.
    Trial = subscription to monthly price with 7-day trial (then we charge $2.99 in webhook).
    Monthly = subscription to monthly price, no trial.
    """
    stripe = _stripe()
    price_id = get_price_id(price_key)
    customer_id = await get_or_create_customer_id(pool, user_id)
    if not customer_id:
        customer = stripe.Customer.create(email=user_email, metadata={"hr_breaker_user_id": user_id})
        customer_id = customer.id
        await set_stripe_customer_id(pool, user_id, customer_id)

    is_trial = price_key == PRICE_KEY_TRIAL
    session_params = {
        "customer": customer_id,
        "mode": "subscription",
        "line_items": [{"price": price_id, "quantity": 1}],
        "success_url": success_url,
        "cancel_url": cancel_url,
        "metadata": {"hr_breaker_user_id": user_id, "price_key": price_key},
        "allow_promotion_codes": True,
    }
    if is_trial:
        session_params["subscription_data"] = {"trial_period_days": TRIAL_DAYS}
    session = stripe.checkout.Session.create(**session_params)
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
    """
    On successful checkout: for subscription (trial or monthly) sync DB.
    For trial: also charge $2.99 now via invoice; if that fails, cancel the subscription.
    """
    metadata = getattr(session, "metadata", None) or {}
    user_id = (metadata or {}).get("hr_breaker_user_id")
    price_key = (metadata or {}).get("price_key")
    if not user_id:
        logger.warning("checkout.session.completed: no hr_breaker_user_id in metadata")
        return

    if getattr(session, "mode", None) != "subscription":
        return
    sub_id = getattr(session, "subscription", None)
    if not sub_id:
        return

    stripe = _stripe()
    sub = stripe.Subscription.retrieve(sub_id)
    trial_end_ts = getattr(sub, "trial_end", None)
    current_period_end_ts = getattr(sub, "current_period_end", None)
    current_period_end = datetime.fromtimestamp(current_period_end_ts, tz=timezone.utc) if current_period_end_ts else None
    status = getattr(sub, "status", None)

    # DB: trialing or active
    if status == "trialing":
        period_end = datetime.fromtimestamp(trial_end_ts, tz=timezone.utc) if trial_end_ts else current_period_end
        await user_update_subscription(
            pool,
            user_id,
            stripe_subscription_id=sub.id,
            subscription_status="trial",
            subscription_plan="trial",
            current_period_end=period_end,
        )
        logger.info("Trial subscription created for user %s until %s", user_id, period_end)

        # Charge $2.99 now (trial signup fee)
        if price_key == PRICE_KEY_TRIAL:
            try:
                customer_id = getattr(session, "customer", None)
                if customer_id:
                    stripe.InvoiceItem.create(
                        customer=customer_id,
                        amount=TRIAL_SIGNUP_CENTS,
                        currency=TRIAL_SIGNUP_CURRENCY,
                        description="Trial 7 days — HR-Breaker",
                    )
                    inv = stripe.Invoice.create(
                        customer=customer_id,
                        collection_method="charge_automatically",
                        auto_advance=True,
                    )
                    stripe.Invoice.pay(inv.id)
                    logger.info("Trial signup fee $2.99 charged for user %s", user_id)
            except Exception as e:
                logger.exception("Failed to charge trial $2.99 for user %s: %s", user_id, e)
                try:
                    stripe.Subscription.modify(sub_id, cancel_at_period_end=True)
                    logger.warning("Subscription set to cancel at period end after failed $2.99 charge")
                except Exception as e2:
                    logger.exception("Failed to cancel subscription: %s", e2)
        return

    # Active (no trial) — e.g. monthly signup
    if status == "active" and current_period_end:
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
    """Sync subscription status and current_period_end from Stripe. trialing → trial, active → monthly."""
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
    if status == "trialing":
        plan, sub_status = "trial", "trial"
    elif status in ("active",):
        plan, sub_status = "monthly", "active"
    elif status in ("canceled", "unpaid", "past_due", "incomplete_expired"):
        plan, sub_status = "monthly", "canceled"
    else:
        plan, sub_status = "monthly", status or "canceled"
    await user_update_subscription(
        pool,
        user_id,
        stripe_subscription_id=sub_id,
        subscription_status=sub_status,
        subscription_plan=plan,
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
