"""Send email via Resend HTTP API (optional dependency: httpx)."""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

RESEND_API = "https://api.resend.com/emails"
RESEND_TEMPLATES_API = "https://api.resend.com/templates"


async def resend_send_html(
    *,
    api_key: str,
    from_addr: str,
    to: str,
    subject: str,
    html: str,
) -> dict[str, Any]:
    """POST one message. Raises httpx.HTTPStatusError on 4xx/5xx."""
    payload = {"from": from_addr, "to": [to], "subject": subject, "html": html}
    async with httpx.AsyncClient(timeout=45.0) as client:
        r = await client.post(
            RESEND_API,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
        )
        r.raise_for_status()
        try:
            return dict(r.json()) if r.content else {}
        except Exception:
            return {"raw": r.text[:500]}


async def resend_send_template(
    *,
    api_key: str,
    from_addr: str,
    to: str,
    subject: str,
    template_id: str,
    variables: dict[str, str],
) -> dict[str, Any]:
    """Send using a published Resend Dashboard template (id or alias). Variables: see docs/EMAIL_RESEND.md."""
    payload: dict[str, Any] = {
        "from": from_addr,
        "to": [to],
        "subject": subject,
        "template": {"id": template_id.strip(), "variables": variables},
    }
    async with httpx.AsyncClient(timeout=45.0) as client:
        r = await client.post(
            RESEND_API,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
        )
        r.raise_for_status()
        try:
            return dict(r.json()) if r.content else {}
        except Exception:
            return {"raw": r.text[:500]}


async def resend_list_templates(
    *,
    api_key: str,
) -> list[dict[str, str]]:
    """List published templates from Resend Dashboard. Returns [{id, name}] best-effort."""
    out: list[dict[str, str]] = []
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(
            RESEND_TEMPLATES_API,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )
        r.raise_for_status()
        payload: dict[str, Any] = dict(r.json()) if r.content else {}
    raw_items = payload.get("data")
    if not isinstance(raw_items, list):
        return out
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        tid = str(item.get("id") or "").strip()
        name = str(item.get("name") or item.get("alias") or tid).strip()
        if not tid:
            continue
        out.append({"id": tid, "name": name or tid})
    return out
