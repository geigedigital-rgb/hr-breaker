"""One-shot staggered email campaign: snapshot eligible users (≥1 successful analyze), queue with 3–8 min gaps."""

from __future__ import annotations

import logging
import random
from datetime import datetime, timedelta, timezone

from hr_breaker.config import Settings, get_settings

from hr_breaker.services.email_automation_registry import is_analyze_optimize_stagger_paused

from hr_breaker.services.db import (
    admin_email_settings_get,
    email_stagger_active_recipient_exists,
    email_stagger_claim_next_due,
    email_stagger_eligible_count,
    email_stagger_eligible_sample_emails,
    email_stagger_eligible_user_ids,
    email_stagger_mark_failed,
    email_stagger_mark_sent,
    email_stagger_mark_skipped_marketing,
    email_stagger_mark_skipped_paid,
    email_stagger_pending_count,
    email_stagger_recipients_insert_one_by_one,
    email_stagger_run_insert,
    email_stagger_sent_log_upsert,
    user_get_by_id,
    user_get_subscription,
)
from hr_breaker.services.email_winback import (
    build_unsubscribe_url,
    latest_email_cta_url_for_user,
    resend_transactional_extras,
    resend_variables_for_send,
)
from hr_breaker.services.resend_send import resend_send_template

logger = logging.getLogger(__name__)

CAMPAIGN_KIND_ANALYZE_OPTIMIZE_UNPAID = "analyze_optimize_unpaid_v1"


def _gap_seconds() -> int:
    return random.randint(180, 480)


def _build_run_schedule(*, first_send_at: datetime, n: int) -> list[datetime]:
    """First row at first_send_at; each next row + random 3–8 minutes."""
    out: list[datetime] = []
    t = first_send_at
    for _ in range(n):
        out.append(t)
        t = t + timedelta(seconds=_gap_seconds())
    return out


async def preview_stagger_campaign(
    pool,
    *,
    campaign_kind: str = CAMPAIGN_KIND_ANALYZE_OPTIMIZE_UNPAID,
    max_sample: int = 8,
) -> dict:
    active = await email_stagger_active_recipient_exists(pool, campaign_kind=campaign_kind)
    pending = await email_stagger_pending_count(pool, campaign_kind=campaign_kind)
    cap = max(0, min(int(max_sample), 500))
    eligible_count = await email_stagger_eligible_count(pool, campaign_kind=campaign_kind)
    sample_emails: list[str] = []
    if cap > 0:
        sample_emails = await email_stagger_eligible_sample_emails(pool, campaign_kind=campaign_kind, limit=cap)
    return {
        "campaign_kind": campaign_kind,
        "eligible_count": eligible_count,
        "sample_user_ids": [],
        "sample_emails": sample_emails,
        "has_active_queue_for_kind": active,
        "pending_count": pending,
    }


async def snapshot_enqueue_campaign(
    pool,
    *,
    template_id: str,
    created_by_email: str | None,
    campaign_kind: str = CAMPAIGN_KIND_ANALYZE_OPTIMIZE_UNPAID,
) -> dict:
    tid = (template_id or "").strip()
    if not tid:
        raise ValueError("template_id is required")

    if await email_stagger_active_recipient_exists(pool, campaign_kind=campaign_kind):
        raise ValueError(
            "A queue for this campaign kind is already open (pending/processing rows). "
            "Process sends until the queue drains, then you can start a new snapshot."
        )

    user_ids = await email_stagger_eligible_user_ids(pool, campaign_kind=campaign_kind)
    if not user_ids:
        return {"run_id": None, "enqueued": 0, "campaign_kind": campaign_kind, "template_id": tid}

    first_at = datetime.now(timezone.utc) + timedelta(seconds=_gap_seconds())
    run_ats = _build_run_schedule(first_send_at=first_at, n=len(user_ids))

    run_id = await email_stagger_run_insert(
        pool,
        campaign_kind=campaign_kind,
        template_id=tid,
        recipient_count=len(user_ids),
        created_by_email=created_by_email,
    )
    await email_stagger_recipients_insert_one_by_one(
        pool, run_id=run_id, template_id=tid, user_ids=user_ids, run_ats=run_ats
    )
    logger.info(
        "Stagger campaign snapshot: kind=%s run_id=%s recipients=%s template_id=%s",
        campaign_kind,
        run_id,
        len(user_ids),
        tid,
    )
    return {
        "run_id": run_id,
        "enqueued": len(user_ids),
        "campaign_kind": campaign_kind,
        "template_id": tid,
        "first_run_at": run_ats[0].isoformat() if run_ats else None,
        "last_run_at": run_ats[-1].isoformat() if run_ats else None,
    }


def _user_is_paid(sub: dict | None) -> bool:
    if not sub:
        return False
    plan = (sub.get("plan") or "free").lower()
    st = (sub.get("status") or "free").lower()
    return plan in ("trial", "monthly") and st in ("active", "trial")


async def process_stagger_next_send(
    pool,
    *,
    settings: Settings | None = None,
) -> dict[str, object]:
    """Claim at most one due recipient and send via Resend template (same path as Quick Send).

    template_id stored per-row is the raw Resend template UUID entered at launch time.
    """
    s = settings or get_settings()
    api_key = (s.resend_api_key or "").strip()
    from_addr = (s.resend_from or "").strip()
    public_base = (s.email_public_base_url or s.frontend_url or "").strip().rstrip("/")

    if not api_key:
        return {"ok": False, "error": "RESEND_API_KEY is not set", "processed": False}
    if not from_addr:
        return {"ok": False, "error": "RESEND_FROM is not set", "processed": False}

    cfg = await admin_email_settings_get(pool)
    if is_analyze_optimize_stagger_paused(cfg):
        return {"ok": True, "paused": True, "processed": False, "message": "stagger campaign paused in admin"}

    row = await email_stagger_claim_next_due(pool)
    if not row:
        return {"ok": True, "processed": False, "message": "no due rows"}

    rid = str(row["id"])
    uid = str(row["user_id"])
    tmpl = str(row["template_id"] or "").strip()
    kind = str(row["campaign_kind"] or CAMPAIGN_KIND_ANALYZE_OPTIMIZE_UNPAID)
    run_id = str(row["run_id"])

    if not tmpl:
        await email_stagger_mark_failed(pool, recipient_id=rid, message="template_id is empty")
        return {"ok": True, "processed": True, "recipient_id": rid, "result": "failed", "detail": "no template_id"}

    try:
        u = await user_get_by_id(pool, uid)
        if not u or u.get("admin_blocked"):
            await email_stagger_mark_failed(pool, recipient_id=rid, message="user missing or blocked")
            return {"ok": True, "processed": True, "recipient_id": rid, "result": "failed", "detail": "user missing"}
        email = (u.get("email") or "").strip()
        if not email:
            await email_stagger_mark_failed(pool, recipient_id=rid, message="no email")
            return {"ok": True, "processed": True, "recipient_id": rid, "result": "failed", "detail": "no email"}
        if u.get("marketing_emails_opt_in") is False:
            await email_stagger_mark_skipped_marketing(pool, recipient_id=rid)
            return {"ok": True, "processed": True, "recipient_id": rid, "result": "skipped_marketing"}
        sub = await user_get_subscription(pool, uid)
        if _user_is_paid(sub):
            await email_stagger_mark_skipped_paid(pool, recipient_id=rid)
            return {"ok": True, "processed": True, "recipient_id": rid, "result": "skipped_paid"}

        # Build personalised variables (same as Quick Send)
        resume_url = await latest_email_cta_url_for_user(pool, s, uid)
        unsub = build_unsubscribe_url(s, uid)
        extras = resend_transactional_extras(s, unsubscribe_url=unsub)

        # subject omitted → Resend template's own subject is used (from dashboard)
        await resend_send_template(
            api_key=api_key,
            from_addr=from_addr,
            to=email,
            template_id=tmpl,
            variables=resend_variables_for_send(
                public_base=public_base,
                unsubscribe_url=unsub,
                resume_url=resume_url,
            ),
            reply_to=extras.get("reply_to"),
            headers=extras.get("headers"),
        )
        await email_stagger_mark_sent(pool, recipient_id=rid)
        await email_stagger_sent_log_upsert(pool, user_id=uid, campaign_kind=kind, run_id=run_id)
        logger.info("Stagger sent %s → %s template=%s", uid, email, tmpl)
        return {"ok": True, "processed": True, "recipient_id": rid, "result": "sent", "email": email}
    except Exception as e:
        msg = str(e)[:2000]
        logger.exception("Stagger send failed rid=%s uid=%s tmpl=%s: %s", rid, uid, tmpl, e)
        await email_stagger_mark_failed(pool, recipient_id=rid, message=msg)
        return {"ok": True, "processed": True, "recipient_id": rid, "result": "failed", "detail": msg}


async def process_stagger_due_batch(
    pool,
    *,
    limit: int = 25,
    settings: Settings | None = None,
) -> dict[str, object]:
    """Call process_stagger_next_send up to `limit` times (for shared cron with win-back)."""
    lim = max(1, min(int(limit), 100))
    runs: list[dict[str, object]] = []
    for _ in range(lim):
        r = await process_stagger_next_send(pool, settings=settings)
        runs.append(r)
        if not r.get("ok"):
            break
        if r.get("error"):
            break
        if r.get("paused"):
            break
        if not r.get("processed"):
            break

    sent = sum(1 for x in runs if x.get("result") == "sent")
    failed = sum(1 for x in runs if x.get("result") == "failed")
    skipped_marketing = sum(1 for x in runs if x.get("result") == "skipped_marketing")
    skipped_paid = sum(1 for x in runs if x.get("result") == "skipped_paid")
    last = runs[-1] if runs else {}
    return {
        "ok": bool(last.get("ok")) if runs else True,
        "paused": bool(last.get("paused")) if runs else False,
        "error": last.get("error") if runs and not last.get("ok") else None,
        "limit": lim,
        "iterations": len(runs),
        "sent": sent,
        "failed": failed,
        "skipped_marketing": skipped_marketing,
        "skipped_paid": skipped_paid,
        "last_message": last.get("message") if runs else None,
        "runs": runs,
    }
