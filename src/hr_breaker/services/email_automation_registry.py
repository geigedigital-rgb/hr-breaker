"""
Catalog of email automations (code-defined). Admin UI lists these; DB stores per-id flags in admin_email_settings.automation_states.

Adding a new flow (until DB-driven editor exists):
1. Append to AUTOMATION_DEFINITIONS with a stable `id` and set `wired` when backend logic exists.
2. Implement scheduling / sending in Python (see email_winback.maybe_schedule_* and process_winback_due_batch).
3. If the flow needs Resend template ids editable in admin, add columns or JSON on admin_email_settings (or a new table) + PATCH in api.py.
4. In frontend AdminEmailSend, add the `id` to AUTOMATION_MAIN_EDITOR_IDS when this flow gets a full settings form on Main.

Extend AUTOMATION_DEFINITIONS when adding new flows — keep `id` stable for API PATCH /admin/email/automations/{id}.
"""

from __future__ import annotations

from typing import Any, Literal, TypedDict


class AutomationDef(TypedDict):
    id: str
    name: str
    description: str
    channel: Literal["queue", "manual_segment", "planned"]
    dedupe_summary: str
    conditions_code: str
    wired: bool
    """If False, enable/pause/clear-queue are no-ops or rejected until implemented."""


AUTOMATION_DEFINITIONS: list[AutomationDef] = [
    {
        "id": "post_optimize_winback",
        "name": "Post-optimize win-back",
        "description": (
            "After a successful optimize, schedules one delayed email for users who are still on the free plan "
            "and have not opted out of marketing. Uses the win-back template (Resend or inline HTML)."
        ),
        "channel": "queue",
        "dedupe_summary": (
            "At most one pending row per user in email_winback_schedule. A new successful optimize replaces "
            "the previous pending slot (same run_at window recalculated)."
        ),
        "conditions_code": (
            "maybe_schedule_winback_after_optimize() in email_winback.py: DB configured, winback enabled, "
            "not paused, user not admin, not paid/trial active, marketing_emails_opt_in is not False."
        ),
        "wired": True,
    },
    {
        "id": "segment_optimized_unpaid",
        "name": "Segment: optimized, unpaid (manual blast)",
        "description": (
            "Admin-triggered sends from Automation & send — not a background cron. Preview / dry-run / send "
            "with explicit limits."
        ),
        "channel": "manual_segment",
        "dedupe_summary": "Each run is explicit; dry-run logs to admin_email_campaign_log. No automatic re-send.",
        "conditions_code": "email_segment_optimized_unpaid_emails() in db.py — optimize_complete in window, unpaid.",
        "wired": True,
    },
    {
        "id": "draft_analyze_followup",
        "name": "Abandoned flow after analyze (planned)",
        "description": (
            "Future: delayed transactional email when a user saved analyze (stage 2) but did not finish optimize. "
            "Will reuse optimize_session_drafts + dedicated schedule or template."
        ),
        "channel": "planned",
        "dedupe_summary": "Not wired — design: one pending job per user per automation key; skip if snapshot stage≥4.",
        "conditions_code": "Planned — hook after optimize_session_draft_upsert stage 2; send only if still draft.",
        "wired": False,
    },
]


def automation_def_by_id(aid: str) -> AutomationDef | None:
    for a in AUTOMATION_DEFINITIONS:
        if a["id"] == aid:
            return a
    return None


def parse_automation_states(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str):
        import json

        try:
            o = json.loads(raw)
            return dict(o) if isinstance(o, dict) else {}
        except Exception:
            return {}
    return {}


def is_post_optimize_winback_paused(cfg: dict[str, Any]) -> bool:
    st = parse_automation_states(cfg.get("automation_states")).get("post_optimize_winback") or {}
    return bool(st.get("paused"))
