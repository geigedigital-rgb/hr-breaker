"""
Stripe checkout and webhook handling for HR-Breaker subscriptions.

- Trial: subscription $29/mo with 7-day trial + one-time $2.99 as a second Checkout line item (STRIPE_PRICE_TRIAL_ID).
  Checkout shows $2.99 due today; after trial ends Stripe charges $29/mo.
- If STRIPE_PRICE_TRIAL_ID is unset: Checkout shows $0 (subscription in trial only); legacy webhook charges $2.99 after — confusing UX.
- Monthly: subscription $29/month, no trial.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta

from hr_breaker.config import get_settings
from hr_breaker.services.usage_audit import log_usage_event

from hr_breaker.services.db import email_winback_delete_pending_for_user

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


def _validate_trial_prices(stripe_mod, monthly_price_id: str, trial_price_id: str) -> None:
    """
    Fail fast with a clear message before Checkout Session.create.

    Stripe requires STRIPE_PRICE_TRIAL_ID to be one-time; currencies of monthly + trial must match.
    """
    try:
        mp = stripe_mod.Price.retrieve(monthly_price_id)
        tp = stripe_mod.Price.retrieve(trial_price_id)
    except stripe_mod.StripeError as e:
        raise ValueError(
            f"Could not load Stripe prices (check IDs and STRIPE_SECRET_KEY test/live mode): {e}"
        ) from e

    m_type = getattr(mp, "type", None) or ""
    t_type = getattr(tp, "type", None) or ""
    if t_type != "one_time":
        raise ValueError(
            f"STRIPE_PRICE_TRIAL_ID ({trial_price_id}) must be a One-time price in Stripe; "
            f"current type is {t_type!r}. Recreate the price as One-off."
        )
    if m_type != "recurring":
        raise ValueError(
            f"STRIPE_PRICE_MONTHLY_ID ({monthly_price_id}) must be a Recurring price; "
            f"current type is {m_type!r}."
        )
    mc = (getattr(mp, "currency", None) or "").lower()
    tc = (getattr(tp, "currency", None) or "").lower()
    if mc != tc:
        raise ValueError(
            f"Currency mismatch: monthly price is {mc.upper()}, trial price is {tc.upper()}. "
            "Create the $2.99 one-time price in the same currency as the monthly subscription."
        )


def _stripe_error_detail(exc: BaseException) -> str:
    """Human-readable Stripe API error for API responses / logs."""
    parts: list[str] = [str(exc).strip() or type(exc).__name__]
    code = getattr(exc, "code", None)
    if code:
        parts.append(f"code={code}")
    json_body = getattr(exc, "json_body", None)
    if isinstance(json_body, dict):
        err = json_body.get("error")
        if isinstance(err, dict):
            msg = err.get("message")
            if msg and msg not in parts[0]:
                parts.append(str(msg))
            ptype = err.get("type")
            if ptype and f"type={ptype}" not in " ".join(parts):
                parts.append(f"type={ptype}")
    return " | ".join(parts)


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


def create_billing_portal_session(customer_id: str, return_url: str) -> str:
    """
    Stripe Customer Portal — cancel subscription, update payment method, etc.
    Portal must be enabled in Stripe Dashboard → Settings → Customer portal.
    """
    stripe = _stripe()
    try:
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=return_url,
        )
        return session.url or ""
    except stripe.StripeError as e:
        detail = _stripe_error_detail(e)
        logger.error("Stripe Billing Portal Error: %s", detail)
        raise ValueError(f"Stripe Billing Portal: {detail}") from e


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
    Trial = monthly subscription with 7-day trial; $2.99 is a one-time line item when STRIPE_PRICE_TRIAL_ID is set.
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
    settings = get_settings()
    trial_fee_price = (settings.stripe_price_trial_id or "").strip()

    line_items: list[dict] = [{"price": price_id, "quantity": 1}]
    session_params = {
        "customer": customer_id,
        "mode": "subscription",
        "line_items": line_items,
        "success_url": success_url,
        "cancel_url": cancel_url,
        "metadata": {"hr_breaker_user_id": user_id, "price_key": price_key},
        "allow_promotion_codes": True,
    }
    if is_trial:
        # One-time fee: add as a second line item (Stripe puts one-time prices on the initial invoice only).
        # Do NOT use subscription_data.add_invoice_items — it is not a valid Checkout Session parameter.
        sub_data: dict = {"trial_period_days": TRIAL_DAYS}
        if trial_fee_price:
            _validate_trial_prices(stripe, price_id, trial_fee_price)
            line_items.append({"price": trial_fee_price, "quantity": 1})
        else:
            logger.warning(
                "STRIPE_PRICE_TRIAL_ID unset: Checkout shows $0 for trial; $2.99 is charged only via "
                "webhook after success (fragile). Add a one-time $2.99 Price and set STRIPE_PRICE_TRIAL_ID."
            )
        session_params["subscription_data"] = sub_data

    try:
        session = stripe.checkout.Session.create(**session_params)
        return session.url or ""
    except stripe.StripeError as e:
        detail = _stripe_error_detail(e)
        logger.error("Stripe Checkout Error: %s", detail)
        raise ValueError(f"Stripe Checkout: {detail}") from e


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

        # $2.99: if STRIPE_PRICE_TRIAL_ID is set, Checkout already collected it (one-time line item on first invoice).
        # Legacy: no trial price id → charge here (user saw $0 on Checkout).
        trial_checkout_ok = True
        trial_checkout_err: str | None = None
        if price_key == PRICE_KEY_TRIAL and not (get_settings().stripe_price_trial_id or "").strip():
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
                    logger.info("Trial signup fee $2.99 charged for user %s (legacy webhook path)", user_id)
            except Exception as e:
                logger.exception("Failed to charge trial $2.99 for user %s: %s", user_id, e)
                trial_checkout_ok = False
                trial_checkout_err = str(e)[:2000]
                try:
                    stripe.Subscription.modify(sub_id, cancel_at_period_end=True)
                    logger.warning("Subscription set to cancel at period end after failed $2.99 charge")
                except Exception as e2:
                    logger.exception("Failed to cancel subscription: %s", e2)
        await log_usage_event(
            pool,
            str(user_id),
            "stripe_checkout_completed",
            None,
            success=trial_checkout_ok,
            error_message=trial_checkout_err,
            metadata={
                "price_key": price_key or "",
                "subscription_plan": "trial",
                "subscription_status": "trial",
                "stripe_subscription_id": sub.id,
            },
        )
        if trial_checkout_ok:
            try:
                await email_winback_delete_pending_for_user(pool, str(user_id))
            except Exception as e:
                logger.debug("email_winback_delete_pending_for_user: %s", e)
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
        await log_usage_event(
            pool,
            str(user_id),
            "stripe_checkout_completed",
            None,
            success=True,
            metadata={
                "price_key": price_key or "",
                "subscription_plan": "monthly",
                "subscription_status": "active",
                "stripe_subscription_id": sub.id,
            },
        )
        try:
            await email_winback_delete_pending_for_user(pool, str(user_id))
        except Exception as e:
            logger.debug("email_winback_delete_pending_for_user: %s", e)


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
    if sub_status in ("trial", "active"):
        try:
            await email_winback_delete_pending_for_user(pool, str(user_id))
        except Exception as e:
            logger.debug("email_winback_delete_pending_for_user: %s", e)


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
