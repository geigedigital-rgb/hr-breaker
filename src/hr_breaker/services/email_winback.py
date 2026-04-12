"""Win-back email: schedule, queue; send via Resend (Dashboard template or inline HTML)."""

from __future__ import annotations

import logging
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

from hr_breaker.config import Settings, get_settings

from hr_breaker.services.auth import (
    create_email_resume_open_token,
    create_email_unsubscribe_token,
    create_optimize_snapshot_token,
)
from hr_breaker.services.db import (
    admin_email_settings_get,
    db_list_all,
    optimization_snapshot_get_latest_valid,
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


def build_resume_open_url(settings: Settings, user_id: str, filename: str) -> str:
    """One-click link to open a specific saved PDF without login (signed JWT)."""
    base = public_base_for_email(settings)
    token = create_email_resume_open_token(user_id, filename)
    return f"{base}/api/email/open-resume?token={quote(token, safe='')}"


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


def _apply_email_token(html: str, token_name: str, value: str) -> str:
    """Replace Resend-style {{{TOKEN}}} and legacy {{TOKEN}} (token_name must match template)."""
    if not value:
        return html
    h = html
    h = h.replace("{{{" + token_name + "}}}", value)
    h = h.replace("{{" + token_name + "}}", value)
    return h


def merge_winback_placeholders(html: str, *, public_base: str, unsubscribe_url: str, resume_url: str = "") -> str:
    """Inline HTML: merge tags; unsubscribe_url is signed one-click URL for this user."""
    base = (public_base or "").rstrip("/")
    logo = f"{base}/logo-color.svg" if base else "{{logo_url}}"
    hero = f"{base}/email/hero-winback.svg" if base else "{{hero_image_url}}"
    download = resume_url or (f"{base}/upgrade" if base else "{{download_url}}")
    unsub = unsubscribe_url or (f"{base}/settings" if base else "{{unsubscribe_url}}")
    settings_url = f"{base}/settings" if base else "{{settings_url}}"
    h = html
    for stem in ("logo_url", "LOGO_URL"):
        h = _apply_email_token(h, stem, logo)
    for stem in ("hero_image_url", "HERO_IMAGE_URL"):
        h = _apply_email_token(h, stem, hero)
    for stem in ("download_url", "DOWNLOAD_URL", "resume_url", "RESUME_URL"):
        h = _apply_email_token(h, stem, download)
    for stem in ("unsubscribe_url", "UNSUBSCRIBE_LINK"):
        h = _apply_email_token(h, stem, unsub)
    for stem in ("settings_url", "SETTINGS_URL"):
        h = _apply_email_token(h, stem, settings_url)
    return h


def resend_variables_for_send(*, public_base: str, unsubscribe_url: str, resume_url: str = "") -> dict[str, str]:
    """
    Variables for Resend Dashboard templates.

    Resend editor uses {{{VARIABLE}}} in HTML; API keys must match template-declared names (case-sensitive).
    Do **not** use UNSUBSCRIBE_URL as a custom variable name — it is reserved and often renders empty.

    We send UPPERCASE keys plus lowercase/snake aliases so templates copied from repo HTML still work.
    """
    base = (public_base or "").rstrip("/")
    logo = f"{base}/logo-color.svg" if base else ""
    hero = f"{base}/email/hero-winback.svg" if base else ""
    open_resume = resume_url or (f"{base}/upgrade" if base else "")
    settings = f"{base}/settings" if base else ""
    unsub = unsubscribe_url or ""
    core: dict[str, str] = {
        "LOGO_URL": logo,
        "HERO_IMAGE_URL": hero,
        "DOWNLOAD_URL": open_resume,
        "RESUME_URL": open_resume,
        "SETTINGS_URL": settings,
        "UNSUBSCRIBE_LINK": unsub,
        # Aliases (templates pasted from inline HTML / mixed case)
        "logo_url": logo,
        "hero_image_url": hero,
        "download_url": open_resume,
        "resume_url": open_resume,
        "settings_url": settings,
        "unsubscribe_url": unsub,
        "unsubscribe_link": unsub,
    }
    return {k: (v if v is not None else "") for k, v in core.items()}


def winback_plain_text(*, resume_url: str, unsubscribe_url: str, settings_url: str) -> str:
    """Explicit text/plain part so clients see a simple message (not only HTML-to-text heuristics)."""
    ru = (resume_url or "").strip()
    uu = (unsubscribe_url or "").strip()
    su = (settings_url or "").strip()
    lines = [
        "Your tailored resume is available in PitchCV.",
        "",
        "Open your resume:",
        ru or "(link unavailable)",
        "",
    ]
    if su:
        lines.extend(["Account settings:", su, ""])
    if uu:
        lines.extend(["Unsubscribe from these messages:", uu, ""])
    lines.extend(["", "With best wishes,", "Anna", "The PitchCV team"])
    return "\n".join(lines)


def resend_transactional_extras(settings: Settings, *, unsubscribe_url: str) -> dict[str, Any]:
    """Reply-To and List-Unsubscribe header (RFC 2369) when HTTPS — common for legitimate service mail."""
    extra: dict[str, Any] = {}
    rt = (settings.resend_reply_to or "").strip()
    if rt:
        extra["reply_to"] = [rt]
    u = (unsubscribe_url or "").strip()
    if u.lower().startswith("https://"):
        extra["headers"] = {"List-Unsubscribe": f"<{u}>"}
    return extra


async def latest_resume_open_url_for_user(pool, settings: Settings, user_id: str) -> str:
    """Return one-click URL to newest saved resume for user; empty when no record exists."""
    records = await db_list_all(pool, settings.output_dir, user_id=user_id)
    if not records:
        return ""
    filename = records[0].path.name
    if not filename:
        return ""
    return build_resume_open_url(settings, user_id, filename)


async def latest_email_cta_url_for_user(pool, settings: Settings, user_id: str) -> str:
    """Primary CTA: non-expired optimize snapshot (`/optimize?resume=…`); else one-click saved PDF; else app home."""
    base = public_base_for_email(settings).rstrip("/")
    row = await optimization_snapshot_get_latest_valid(pool, user_id)
    if row:
        exp = row["expires_at"]
        if isinstance(exp, datetime):
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            sid = str(row["id"])
            try:
                tok = create_optimize_snapshot_token(user_id, sid, exp)
                return f"{base}/optimize?resume={quote(tok, safe='')}"
            except Exception:
                pass

    pdf_open = await latest_resume_open_url_for_user(pool, settings, user_id)
    if pdf_open:
        return pdf_open
    return f"{base}/"


def resend_published_template_id(
    settings: Settings,
    app_template_id: str,
    *,
    db_reminder: str = "",
    db_nudge: str = "",
) -> str | None:
    """Return Resend template id/alias: admin DB first, then env (optional dev / legacy). Else None → inline HTML."""
    tid = (app_template_id or "").strip()
    if tid == "reminder-no-download":
        x = (db_reminder or "").strip() or (settings.resend_template_reminder_no_download or "").strip()
        return x or None
    if tid == "short-nudge":
        x = (db_nudge or "").strip() or (settings.resend_template_short_nudge or "").strip()
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
    db_resend_template_reminder: str = "",
    db_resend_template_short_nudge: str = "",
    resume_url: str = "",
) -> None:
    unsub = build_unsubscribe_url(settings, user_id)
    base = (public_base or "").rstrip("/")
    download = (resume_url or "").strip() or (f"{base}/upgrade" if base else "")
    settings_url = f"{base}/settings" if base else ""
    extras = resend_transactional_extras(settings, unsubscribe_url=unsub)
    rid = resend_published_template_id(
        settings,
        app_template_id,
        db_reminder=db_resend_template_reminder,
        db_nudge=db_resend_template_short_nudge,
    )
    if rid:
        await resend_send_template(
            api_key=api_key,
            from_addr=from_addr,
            to=to,
            subject=subject,
            template_id=rid,
            variables=resend_variables_for_send(
                public_base=public_base,
                unsubscribe_url=unsub,
                resume_url=resume_url,
            ),
            reply_to=extras.get("reply_to"),
            headers=extras.get("headers"),
        )
        return
    raw = load_email_template_html(app_template_id)
    html = merge_winback_placeholders(
        raw,
        public_base=public_base,
        unsubscribe_url=unsub,
        resume_url=resume_url,
    )
    text_body = winback_plain_text(
        resume_url=download,
        unsubscribe_url=unsub,
        settings_url=settings_url,
    )
    await resend_send_html(
        api_key=api_key,
        from_addr=from_addr,
        to=to,
        subject=subject,
        html=html,
        text=text_body,
        reply_to=extras.get("reply_to"),
        headers=extras.get("headers"),
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

    cfg = await admin_email_settings_get(pool)
    db_r = str(cfg.get("resend_template_reminder_no_download") or "")
    db_n = str(cfg.get("resend_template_short_nudge") or "")

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
            resume_url = await latest_email_cta_url_for_user(pool, settings, uid)
            await deliver_winback_email(
                settings=settings,
                api_key=api_key,
                from_addr=from_addr,
                to=email,
                subject=subject,
                app_template_id=tid,
                public_base=public_base,
                user_id=uid,
                db_resend_template_reminder=db_r,
                db_resend_template_short_nudge=db_n,
                resume_url=resume_url,
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

    cfg = await admin_email_settings_get(pool)
    db_r = str(cfg.get("resend_template_reminder_no_download") or "")
    db_n = str(cfg.get("resend_template_short_nudge") or "")

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
    resume_url = await latest_email_cta_url_for_user(pool, settings, uid)

    await deliver_winback_email(
        settings=settings,
        api_key=api_key,
        from_addr=from_addr,
        to=to_email.strip(),
        subject=subject,
        app_template_id=template_id,
        public_base=public_base,
        user_id=uid,
        db_resend_template_reminder=db_r,
        db_resend_template_short_nudge=db_n,
        resume_url=resume_url,
    )


async def send_resend_template_to_email(
    pool,
    *,
    to_email: str,
    resend_template_id: str,
) -> None:
    """Send one email to a known user using explicit Resend template id (from dashboard list)."""
    settings = get_settings()
    api_key = (settings.resend_api_key or "").strip()
    from_addr = (settings.resend_from or "").strip()
    public_base = public_base_for_email(settings)
    subject = (settings.resend_winback_subject or "Your resume is ready").strip() or "Your resume is ready"
    if not api_key or not from_addr:
        raise ValueError("RESEND_API_KEY and RESEND_FROM must be set")
    rid = (resend_template_id or "").strip()
    if not rid:
        raise ValueError("Resend template id is required")

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
    resume_url = await latest_email_cta_url_for_user(pool, settings, uid)
    unsub = build_unsubscribe_url(settings, uid)
    extras = resend_transactional_extras(settings, unsubscribe_url=unsub)
    await resend_send_template(
        api_key=api_key,
        from_addr=from_addr,
        to=to_email.strip(),
        subject=subject,
        template_id=rid,
        variables=resend_variables_for_send(
            public_base=public_base,
            unsubscribe_url=unsub,
            resume_url=resume_url,
        ),
        reply_to=extras.get("reply_to"),
        headers=extras.get("headers"),
    )


async def admin_email_cta_digest_for_email(
    pool,
    settings: Settings,
    *,
    email: str,
) -> dict[str, Any]:
    """Admin Quick send: whether user has a valid optimize snapshot and/or saved PDF for DOWNLOAD_URL."""
    em = (email or "").strip()
    out: dict[str, Any] = {
        "email": em,
        "user_found": False,
        "has_valid_snapshot": False,
        "snapshot_expires_at": None,
        "has_saved_pdf": False,
    }
    if not em or "@" not in em:
        return out
    u = await user_get_by_email(pool, em)
    if not u:
        return out
    uid = str(u["id"])
    out["user_found"] = True
    row = await optimization_snapshot_get_latest_valid(pool, uid)
    if row:
        out["has_valid_snapshot"] = True
        exp = row.get("expires_at")
        if isinstance(exp, datetime):
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            out["snapshot_expires_at"] = exp.isoformat()
    pdf = await latest_resume_open_url_for_user(pool, settings, uid)
    out["has_saved_pdf"] = bool((pdf or "").strip())
    return out
