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
from typing import Any

from hr_breaker.config import get_settings
from hr_breaker.services.usage_audit import log_usage_event

from hr_breaker.services.db import email_winback_delete_pending_for_user

logger = logging.getLogger(__name__)


def _stripe_get(obj: object | None, key: str, default: Any = None) -> Any:
    """StripeObject and plain dict (some webhook paths) both supported."""
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _stripe_meta_dict(obj: object | None) -> dict[str, Any]:
    raw = _stripe_get(obj, "metadata", None) or {}
    if isinstance(raw, dict):
        return {str(k): ("" if v is None else str(v)) for k, v in raw.items()}
    try:
        return {str(k): ("" if v is None else str(v)) for k, v in dict(raw).items()}
    except Exception:
        return {}


def _stripe_expand_id(val: Any) -> str | None:
    """Subscription / Customer may be id string or nested {'id': ...}."""
    if val is None:
        return None
    if isinstance(val, str) and val.strip():
        return val.strip()
    if isinstance(val, dict):
        i = val.get("id")
        return str(i).strip() if i else None
    i = getattr(val, "id", None)
    return str(i).strip() if i else None


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


def stripe_subscription_allows_referral_commission(subscription_id: str) -> bool:
    """
    Partner payout: only after the referred user is on a paid monthly cycle.

    True when Stripe reports ``active`` and the subscription is not inside the
    free trial window (``trial_end`` unset or already passed). ``trialing`` or
    ``active`` with a future ``trial_end`` (paid signup during 7-day trial) → False.
    """
    stripe = _stripe()
    sub = stripe.Subscription.retrieve(subscription_id)
    status = (getattr(sub, "status", None) or "").strip()
    if status != "active":
        return False
    trial_end_ts = getattr(sub, "trial_end", None)
    if trial_end_ts:
        trial_end_dt = datetime.fromtimestamp(int(trial_end_ts), tz=timezone.utc)
        if trial_end_dt > datetime.now(timezone.utc):
            return False
    return True


async def handle_checkout_session_completed(
    session: object,
    pool,
    user_update_subscription,
) -> None:
    """
    On successful checkout: for subscription (trial or monthly) sync DB.
    For trial: also charge $2.99 now via invoice; if that fails, cancel the subscription.
    """
    metadata = _stripe_meta_dict(session)
    user_id = (metadata.get("hr_breaker_user_id") or "").strip() or None
    price_key = (metadata.get("price_key") or "").strip() or None
    if not user_id:
        logger.warning("checkout.session.completed: no hr_breaker_user_id in metadata")
        return

    if (_stripe_get(session, "mode", None) or "") != "subscription":
        return
    sub_id = _stripe_expand_id(_stripe_get(session, "subscription", None))
    if not sub_id:
        logger.warning("checkout.session.completed: no subscription on session")
        return

    stripe = _stripe()
    sub = stripe.Subscription.retrieve(sub_id)
    trial_end_ts = _stripe_get(sub, "trial_end", None)
    current_period_end_ts = _stripe_get(sub, "current_period_end", None)
    current_period_end = (
        datetime.fromtimestamp(int(current_period_end_ts), tz=timezone.utc) if current_period_end_ts else None
    )
    status = (_stripe_get(sub, "status", None) or "").strip()
    trial_end_dt = datetime.fromtimestamp(int(trial_end_ts), tz=timezone.utc) if trial_end_ts else None
    now = datetime.now(timezone.utc)
    in_trial_window = bool(trial_end_dt and trial_end_dt > now)
    # Same rule as subscription.updated: any Stripe trialing or still inside trial_end → DB trial.
    db_as_trial = status == "trialing" or in_trial_window

    if db_as_trial:
        period_end = trial_end_dt if trial_end_ts else current_period_end
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
                customer_id = _stripe_expand_id(_stripe_get(session, "customer", None))
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

    # Active (no trial window) — e.g. monthly signup
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
    else:
        logger.warning(
            "checkout.session.completed: unhandled subscription state user=%s sub=%s status=%s trial_end=%s period_end=%s",
            user_id,
            sub_id,
            status,
            trial_end_ts,
            current_period_end_ts,
        )


async def handle_subscription_updated(
    subscription: object,
    pool,
    get_user_id_by_stripe_customer,
    user_update_subscription,
) -> None:
    """Sync subscription status and current_period_end from Stripe. trialing → trial, active → monthly."""
    sub_id = _stripe_expand_id(_stripe_get(subscription, "id", None))
    customer_id = _stripe_expand_id(_stripe_get(subscription, "customer", None))
    if not customer_id or not sub_id:
        return
    status = (_stripe_get(subscription, "status", None) or "").strip()
    current_period_end_ts = _stripe_get(subscription, "current_period_end", None)
    trial_end_ts = _stripe_get(subscription, "trial_end", None)
    # During trialing, current_period_end is sometimes unset in early events — fall back to trial_end.
    period_ts = current_period_end_ts or (trial_end_ts if status == "trialing" else None)
    if not period_ts and trial_end_ts and status == "active":
        try:
            te = datetime.fromtimestamp(int(trial_end_ts), tz=timezone.utc)
            if te > datetime.now(timezone.utc):
                period_ts = trial_end_ts
        except (TypeError, ValueError, OSError):
            period_ts = None
    if not period_ts:
        logger.warning(
            "subscription.updated: missing period end (skip sync) sub=%s status=%s customer=%s",
            sub_id,
            status,
            customer_id,
        )
        return
    current_period_end = datetime.fromtimestamp(int(period_ts), tz=timezone.utc)
    user_id = await get_user_id_by_stripe_customer(pool, customer_id)
    if not user_id:
        logger.warning("subscription.updated: no user for customer %s", customer_id)
        return
    trial_end_dt = datetime.fromtimestamp(int(trial_end_ts), tz=timezone.utc) if trial_end_ts else None
    in_trial_window = bool(trial_end_dt and trial_end_dt > datetime.now(timezone.utc))

    if status == "trialing" or (status == "active" and in_trial_window):
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
    customer_id = _stripe_expand_id(_stripe_get(subscription, "customer", None))
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
