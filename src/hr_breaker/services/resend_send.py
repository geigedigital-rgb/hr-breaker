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
    text: str | None = None,
    reply_to: list[str] | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    """POST one message. Raises httpx.HTTPStatusError on 4xx/5xx."""
    payload: dict[str, Any] = {"from": from_addr, "to": [to], "subject": subject, "html": html}
    if text is not None:
        payload["text"] = text
    if reply_to:
        payload["reply_to"] = reply_to
    if headers:
        payload["headers"] = headers
    async with httpx.AsyncClient(timeout=45.0) as client:
        r = await client.post(
            RESEND_API,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
        )
        if not r.is_success:
            body = r.text[:1000] if r.content else ""
            logger.error("resend_send_html HTTP %s to=%s body=%s", r.status_code, to, body)
            raise RuntimeError(f"Resend HTTP {r.status_code}: {body or r.reason_phrase}")
        try:
            return dict(r.json()) if r.content else {}
        except Exception:
            return {"raw": r.text[:500]}


async def resend_send_template(
    *,
    api_key: str,
    from_addr: str,
    to: str,
    template_id: str,
    variables: dict[str, str],
    subject: str | None = None,
    reply_to: list[str] | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Send using a published Resend Dashboard template (id or alias).

    Payload format per Resend docs: POST /emails with "template": {"id": ..., "variables": {...}}.
    - Do NOT include html/text/react alongside template.
    - subject/from/reply_to in payload override the template defaults.
      If subject is None/empty, the template's own subject is used (recommended).
    - Reserved variable names Resend blocks: FIRST_NAME, LAST_NAME, EMAIL, UNSUBSCRIBE_URL.
    """
    tid = template_id.strip()
    _RESERVED = {"FIRST_NAME", "LAST_NAME", "EMAIL", "UNSUBSCRIBE_URL"}
    safe_vars = {k: v for k, v in variables.items() if k and k.upper() not in _RESERVED}

    payload: dict[str, Any] = {
        "from": from_addr,
        "to": [to],
        "template": {"id": tid, "variables": safe_vars},
    }
    # Only override subject if explicitly provided (otherwise Resend uses template's subject)
    if subject:
        payload["subject"] = subject
    if reply_to:
        payload["reply_to"] = reply_to
    if headers:
        payload["headers"] = headers
    logger.debug("resend_send_template to=%s template=%s vars=%s", to, tid, list(safe_vars.keys()))
    async with httpx.AsyncClient(timeout=45.0) as client:
        r = await client.post(
            RESEND_API,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
        )
        if not r.is_success:
            body = r.text[:1000] if r.content else ""
            logger.error(
                "resend_send_template HTTP %s to=%s template=%s body=%s",
                r.status_code,
                to,
                tid,
                body,
            )
            raise RuntimeError(
                f"Resend HTTP {r.status_code}: {body or r.reason_phrase}"
            )
        try:
            return dict(r.json()) if r.content else {}
        except Exception:
            return {"raw": r.text[:500]}


async def resend_list_templates(
    *,
    api_key: str,
) -> list[dict[str, str]]:
    """List templates from Resend (Dashboard → Templates). Paginates; returns [{id, name}].

    Resend may reject requests without a User-Agent. Template *sending* still uses the id you
    copy from the dashboard if the list API is unavailable on your plan.
    """
    out: list[dict[str, str]] = []
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "hr-breaker/1.0 (Resend templates list)",
    }
    after: str | None = None
    async with httpx.AsyncClient(timeout=45.0) as client:
        while True:
            params: dict[str, str] = {"limit": "100"}
            if after:
                params["after"] = after
            r = await client.get(RESEND_TEMPLATES_API, headers=headers, params=params)
            try:
                r.raise_for_status()
            except httpx.HTTPStatusError as e:
                body = (e.response.text or "")[:800]
                raise RuntimeError(
                    f"Resend GET /templates HTTP {e.response.status_code}: {body or e.response.reason_phrase}"
                ) from e
            payload: dict[str, Any] = dict(r.json()) if r.content else {}
            raw_items = payload.get("data")
            if not isinstance(raw_items, list):
                break
            for item in raw_items:
                if not isinstance(item, dict):
                    continue
                tid = str(item.get("id") or "").strip()
                name = str(item.get("name") or item.get("alias") or tid).strip()
                if not tid:
                    continue
                out.append({"id": tid, "name": name or tid})
            if not payload.get("has_more") or not raw_items:
                break
            last = raw_items[-1]
            if isinstance(last, dict):
                nxt = str(last.get("id") or "").strip()
                if nxt and nxt != after:
                    after = nxt
                    continue
            break
    return out
