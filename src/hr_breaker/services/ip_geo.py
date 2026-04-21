"""Resolve public IP → country for admin views only; results cached in Postgres."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

logger = logging.getLogger("hr_breaker.ip_geo")

_BATCH_URL = "http://ip-api.com/batch?fields=status,message,query,country,countryCode"
_CHUNK = 45
_CHUNK_PAUSE_SEC = 2.5


async def resolve_ips_for_admin(pool: Any, ips: list[str]) -> None:
    """
    Ensure ip_country_cache has entries for given IPs (best-effort, rate-limited).
    Only called from admin endpoints — not on user login.
    """
    from hr_breaker.services.db import ip_geo_cache_fetch_for_ips, ip_geo_cache_upsert

    raw = list({(i or "").strip()[:64] for i in ips if i and str(i).strip()})
    if not raw:
        return
    known = await ip_geo_cache_fetch_for_ips(pool, raw)
    missing = [ip for ip in raw if ip not in known]
    if not missing:
        return

    async with httpx.AsyncClient(timeout=35.0) as client:
        for start in range(0, len(missing), _CHUNK):
            chunk = missing[start : start + _CHUNK]
            try:
                r = await client.post(_BATCH_URL, json=chunk)
                r.raise_for_status()
                data = r.json()
            except Exception as e:
                logger.warning("ip_geo batch failed (%s): %s", type(e).__name__, e)
                await asyncio.sleep(_CHUNK_PAUSE_SEC)
                continue
            if not isinstance(data, list):
                await asyncio.sleep(_CHUNK_PAUSE_SEC)
                continue
            for j, ip in enumerate(chunk):
                item = data[j] if j < len(data) else {}
                if item.get("status") == "success":
                    await ip_geo_cache_upsert(
                        pool,
                        str(item.get("query") or ip),
                        str(item.get("country") or ""),
                        str(item.get("countryCode") or ""),
                    )
                elif item.get("query"):
                    await ip_geo_cache_upsert(pool, str(item["query"]), "", "")
            await asyncio.sleep(_CHUNK_PAUSE_SEC)
