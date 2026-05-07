"""
GA4 Measurement Protocol — server-side `purchase` for Stripe Checkout completion.

Requires GA4 Admin → Data streams → your Web stream → Measurement Protocol API secrets.
Env: GA4_MEASUREMENT_ID (G-…), GA4_API_SECRET.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

from hr_breaker.config import get_settings

logger = logging.getLogger(__name__)

GA4_MP_COLLECT = "https://www.google-analytics.com/mp/collect"
# _ga cookie yields two numeric groups joined by a dot (GA4 MP client_id).
_CLIENT_ID_RE = re.compile(r"^\d{1,20}\.\d{1,20}$")


def normalize_ga_client_id(raw: str | None) -> str | None:
    """Validate client_id from frontend (_ga-derived). Returns None if unusable."""
    if not raw:
        return None
    s = raw.strip()
    if len(s) > 128 or len(s) < 3:
        return None
    if not _CLIENT_ID_RE.match(s):
        return None
    return s


async def send_ga4_purchase_event(
    *,
    client_id: str,
    user_id: str | None,
    transaction_id: str,
    value: float,
    currency: str,
    item_id: str,
    item_name: str,
) -> None:
    """POST `purchase` to GA4 MP. Logs warnings on failure; does not raise."""
    settings = get_settings()
    mid = (settings.ga4_measurement_id or "").strip()
    secret = (settings.ga4_api_secret or "").strip()
    if not mid or not secret:
        return

    cur = (currency or "usd").strip().upper()
    if len(cur) != 3:
        cur = "USD"

    payload: dict[str, Any] = {
        "client_id": client_id,
        "events": [
            {
                "name": "purchase",
                "params": {
                    "transaction_id": transaction_id,
                    "value": round(float(value), 2),
                    "currency": cur,
                    "engagement_time_msec": 1,
                    "items": [
                        {
                            "item_id": item_id[:100],
                            "item_name": item_name[:100],
                            "price": round(float(value), 2),
                            "quantity": 1,
                        }
                    ],
                },
            }
        ],
    }
    if user_id:
        payload["user_id"] = str(user_id)[:256]

    params = {"measurement_id": mid, "api_secret": secret}
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.post(GA4_MP_COLLECT, params=params, json=payload)
            if r.status_code >= 400:
                logger.warning(
                    "GA4 MP purchase failed: status=%s body=%s",
                    r.status_code,
                    (r.text or "")[:500],
                )
    except Exception as e:
        logger.warning("GA4 MP purchase request error: %s", e)
