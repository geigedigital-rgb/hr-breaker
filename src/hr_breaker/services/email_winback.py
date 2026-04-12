"""Win-back email: schedule, queue; send via Resend (Dashboard template or inline HTML)."""

from __future__ import annotations

import logging
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

from hr_breaker.config import Settings, get_settings

from hr_breaker.services.auth import create_email_unsubscribe_token
from hr_breaker.services.db import (
    admin_email_settings_get,
    email_winback_claim_due_batch,
    email_winback_mark_failed,
    email_winback_mark_sent,
    email_winback_mark_skipped_marketing,
    email_winback_mark_skipped_paid,
    email_winback_replace_pending,
    user_get_by_email,
    user_get_by_id,
    user_get_subscription,
)
from hr_breaker.services.resend_send import resend_send_html, resend_send_template

logger = logging.getLogger(__name__)


def public_base_for_email(settings: Settings) -> str:
    """Origin for logo/hero URLs and CTA links in outbound email (must be real HTTPS in production)."""
    raw = (settings.email_public_base_url or settings.frontend_url or "").strip()
    return raw.rstrip("/")


def build_unsubscribe_url(settings: Settings, user_id: str) -> str:
    """One-click link: GET /api/email/unsubscribe — must hit same host that serves the API (see EMAIL_PUBLIC_BASE_URL)."""
    base = public_base_for_email(settings)
    token = create_email_unsubscribe_token(user_id)
    return f"{base}/api/email/unsubscribe?token={quote(token, safe='')}"


_TEMPLATE_FILES = {
    "reminder-no-download": "reminder_no_download.html",
    "short-nudge": "short_nudge.html",
}


def _package_templates_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "email_templates"


def load_email_template_html(template_id: str) -> str:
    fn = _TEMPLATE_FILES.get(template_id)
    if not fn:
        raise ValueError(f"Unknown template_id: {template_id}")
    path = _package_templates_dir() / fn
    if not path.is_file():
        raise FileNotFoundError(f"Missing template file: {path}")
    return path.read_text(encoding="utf-8")


def merge_winback_placeholders(html: str, *, public_base: str, unsubscribe_url: str) -> str:
    """Inline HTML: merge tags; unsubscribe_url is signed one-click URL for this user."""
    base = (public_base or "").rstrip("/")
    logo = f"{base}/logo-color.svg" if base else "{{logo_url}}"
    hero = f"{base}/email/hero-winback.svg" if base else "{{hero_image_url}}"
    download = f"{base}/upgrade" if base else "{{download_url}}"
    unsub = unsubscribe_url or (f"{base}/settings" if base else "{{unsubscribe_url}}")
    h = html.replace("{{logo_url}}", logo)
    h = h.replace("{{hero_image_url}}", hero)
    h = h.replace("{{download_url}}", download)
    h = h.replace("{{unsubscribe_url}}", unsub)
    return h


def resend_variables_for_send(*, public_base: str, unsubscribe_url: str) -> dict[str, str]:
    """
    Variables for Resend Dashboard templates. Do not use Resend-reserved names as custom keys.
    Use UNSUBSCRIBE_LINK (not UNSUBSCRIBE_URL) for the one-click URL.
    """
    base = (public_base or "").rstrip("/")
    return {
        "LOGO_URL": f"{base}/logo-color.svg",
        "HERO_IMAGE_URL": f"{base}/email/hero-winback.svg",
        "DOWNLOAD_URL": f"{base}/upgrade",
        "SETTINGS_URL": f"{base}/settings",
        "UNSUBSCRIBE_LINK": unsubscribe_url,
    }


def resend_published_template_id(settings: Settings, app_template_id: str) -> str | None:
    """Return Resend template id/alias if configured for this app template key; else None → inline HTML."""
    tid = (app_template_id or "").strip()
    if tid == "reminder-no-download":
        x = (settings.resend_template_reminder_no_download or "").strip()
        return x or None
    if tid == "short-nudge":
        x = (settings.resend_template_short_nudge or "").strip()
        return x or None
    return None


async def deliver_winback_email(
    *,
    settings: Settings,
    api_key: str,
    from_addr: str,
    to: str,
    subject: str,
    app_template_id: str,
    public_base: str,
    user_id: str,
) -> None:
    unsub = build_unsubscribe_url(settings, user_id)
    rid = resend_published_template_id(settings, app_template_id)
    if rid:
        await resend_send_template(
            api_key=api_key,
            from_addr=from_addr,
            to=to,
            subject=subject,
            template_id=rid,
            variables=resend_variables_for_send(public_base=public_base, unsubscribe_url=unsub),
        )
        return
    raw = load_email_template_html(app_template_id)
    html = merge_winback_placeholders(raw, public_base=public_base, unsubscribe_url=unsub)
    await resend_send_html(
        api_key=api_key,
        from_addr=from_addr,
        to=to,
        subject=subject,
        html=html,
    )


def _user_is_paid(sub: dict[str, Any] | None) -> bool:
    if not sub:
        return False
    plan = (sub.get("plan") or "free").lower()
    st = (sub.get("status") or "free").lower()
    return plan in ("trial", "monthly") and st in ("active", "trial")


async def maybe_schedule_winback_after_optimize(
    pool,
    user: dict | None,
    *,
    optimize_succeeded: bool,
    is_admin_user_fn: Callable[[dict | None], bool],
) -> None:
    if not optimize_succeeded or not user:
        return
    uid = str(user.get("id") or "")
    if not uid or uid == "local" or is_admin_user_fn(user):
        return
    settings = get_settings()
    if not (settings.database_url or "").strip():
        return
    try:
        cfg = await admin_email_settings_get(pool)
        if not cfg.get("winback_auto_enabled"):
            return
        sub = await user_get_subscription(pool, uid)
        if _user_is_paid(sub):
            return
        urow = await user_get_by_id(pool, uid)
        if urow is not None and urow.get("marketing_emails_opt_in") is False:
            return
        lo = int(cfg.get("winback_delay_min_minutes") or 25)
        hi = int(cfg.get("winback_delay_max_minutes") or max(lo, 30))
        if hi < lo:
            hi = lo
        delay_m = random.randint(lo, hi)
        run_at = datetime.now(timezone.utc) + timedelta(minutes=delay_m)
        await email_winback_replace_pending(pool, uid, run_at, "reminder-no-download")
        logger.info("Scheduled win-back email for user %s at %s (in %s min)", uid, run_at.isoformat(), delay_m)
    except Exception as e:
        logger.warning("maybe_schedule_winback_after_optimize: %s", e)


async def process_winback_due_batch(pool, *, limit: int = 25) -> dict[str, Any]:
    """Send due scheduled emails (admin cron or manual button)."""
    settings = get_settings()
    api_key = (settings.resend_api_key or "").strip()
    from_addr = (settings.resend_from or "").strip()
    public_base = public_base_for_email(settings)
    subject = (settings.resend_winback_subject or "Your resume is ready").strip() or "Your resume is ready"

    sent = 0
    skipped = 0
    skipped_marketing = 0
    failed = 0
    errors: list[str] = []

    if not api_key or not from_addr:
        return {
            "ok": False,
            "error": "RESEND_API_KEY and RESEND_FROM must be set",
            "sent": 0,
            "skipped_paid": 0,
            "skipped_marketing": 0,
            "failed": 0,
        }

    batch = await email_winback_claim_due_batch(pool, min(limit, 100))
    for row in batch:
        sid = str(row["id"])
        uid = str(row["user_id"])
        tid = str(row.get("template_id") or "reminder-no-download")
        try:
            u = await user_get_by_id(pool, uid)
            if not u or u.get("admin_blocked"):
                await email_winback_mark_failed(pool, sid, "user missing or blocked")
                failed += 1
                continue
            email = (u.get("email") or "").strip()
            if not email:
                await email_winback_mark_failed(pool, sid, "no email")
                failed += 1
                continue
            if u.get("marketing_emails_opt_in") is False:
                await email_winback_mark_skipped_marketing(pool, sid)
                skipped_marketing += 1
                continue
            sub = await user_get_subscription(pool, uid)
            if _user_is_paid(sub):
                await email_winback_mark_skipped_paid(pool, sid)
                skipped += 1
                continue
            await deliver_winback_email(
                settings=settings,
                api_key=api_key,
                from_addr=from_addr,
                to=email,
                subject=subject,
                app_template_id=tid,
                public_base=public_base,
                user_id=uid,
            )
            await email_winback_mark_sent(pool, sid)
            sent += 1
        except Exception as e:
            msg = str(e)[:2000]
            logger.exception("Win-back send failed for schedule %s: %s", sid, e)
            errors.append(msg)
            await email_winback_mark_failed(pool, sid, msg)
            failed += 1

    return {
        "ok": True,
        "claimed": len(batch),
        "sent": sent,
        "skipped_paid": skipped,
        "skipped_marketing": skipped_marketing,
        "failed": failed,
        "errors_sample": errors[:5],
    }


async def send_winback_to_email(
    pool,
    *,
    to_email: str,
    template_id: str,
) -> None:
    """Send one win-back to a known address (manual segment send). Validates user exists and unpaid."""
    settings = get_settings()
    api_key = (settings.resend_api_key or "").strip()
    from_addr = (settings.resend_from or "").strip()
    public_base = public_base_for_email(settings)
    subject = (settings.resend_winback_subject or "Your resume is ready").strip() or "Your resume is ready"
    if not api_key or not from_addr:
        raise ValueError("RESEND_API_KEY and RESEND_FROM must be set")

    u = await user_get_by_email(pool, to_email.strip())
    if not u:
        raise ValueError("No user with this email")
    if u.get("admin_blocked"):
        raise ValueError("User is admin-blocked")
    if u.get("marketing_emails_opt_in") is False:
        raise ValueError("User opted out of marketing emails")
    uid = str(u["id"])
    sub = await user_get_subscription(pool, uid)
    if _user_is_paid(sub):
        raise ValueError("User has an active paid/trial subscription — skipped")

    await deliver_winback_email(
        settings=settings,
        api_key=api_key,
        from_addr=from_addr,
        to=to_email.strip(),
        subject=subject,
        app_template_id=template_id,
        public_base=public_base,
        user_id=uid,
    )
