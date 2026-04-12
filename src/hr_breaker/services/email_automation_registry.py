"""Catalog of currently active email automations (code-defined)."""

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
            "After a successful optimize with a saved snapshot, schedule one delayed email for users who are still "
            "on the free plan and have not opted out of marketing."
        ),
        "channel": "queue",
        "dedupe_summary": (
            "At most one pending row per user in email_winback_schedule; once a reminder was sent, later optimizes "
            "do not schedule the same automatic reminder again."
        ),
        "conditions_code": (
            "Run only after optimization_snapshot_insert() succeeds, win-back is enabled, not paused, user is not "
            "admin, user is unpaid, and reminder-no-download has not already been sent."
        ),
        "wired": True,
    }
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
