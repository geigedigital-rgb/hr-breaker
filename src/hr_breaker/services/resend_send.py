"""Send email via Resend HTTP API (optional dependency: httpx)."""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

RESEND_API = "https://api.resend.com/emails"


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
