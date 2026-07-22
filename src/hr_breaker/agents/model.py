"""Canonical Gemini model id for pydantic-ai Agent constructors."""

from __future__ import annotations


def gemini_model(model_name: str) -> str:
    """Build a provider-qualified model string.

    pydantic-ai dropped the legacy ``google-gla:`` prefix in favor of ``google:``.
    Railway ``pip install .`` without a lockfile can pull that newer release and
    break every agent with ``Unknown provider: google-gla``.
    """
    name = (model_name or "").strip()
    if not name:
        name = "gemini-2.5-flash"
    if ":" in name:
        # Already qualified (google:…, google-gla:…, etc.) — normalize legacy prefix.
        provider, _, rest = name.partition(":")
        if provider in {"google-gla", "gemini"}:
            return f"google:{rest}"
        return name
    return f"google:{name}"
