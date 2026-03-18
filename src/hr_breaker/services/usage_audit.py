"""Log LLM usage and API errors for admin analytics (Postgres)."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def tokens_from_run_result(result: Any) -> tuple[int, int]:
    """Extract input/output tokens from pydantic_ai AgentRunResult."""
    try:
        u = result.usage()
        return int(u.input_tokens or 0), int(u.output_tokens or 0)
    except Exception:
        return 0, 0


async def log_usage_event(
    pool,
    user_id: str | None,
    action: str,
    model: str | None,
    *,
    success: bool = True,
    error_message: str | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    metadata: dict | None = None,
) -> None:
    """Best-effort insert; never raises to callers."""
    if pool is None:
        return
    try:
        from hr_breaker.services.db import usage_audit_insert

        await usage_audit_insert(
            pool,
            user_id=user_id,
            action=action,
            model=model,
            success=success,
            error_message=(error_message or "")[:2000] if error_message else None,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            metadata=metadata or {},
        )
    except Exception as e:
        logger.warning("usage_audit insert failed: %s", e)
