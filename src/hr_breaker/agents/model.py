"""Canonical Gemini model id for pydantic-ai Agent constructors."""

from __future__ import annotations

from functools import lru_cache


@lru_cache
def _google_provider_prefix() -> str:
    """Return the provider prefix supported by the installed pydantic-ai.

    Older releases (e.g. 1.51) only know ``google-gla`` / ``google-vertex``.
    Newer releases dropped ``google-gla`` in favor of ``google``.
    """
    try:
        from pydantic_ai.providers import infer_provider_class

        try:
            infer_provider_class("google")
            return "google"
        except ValueError:
            pass
        try:
            infer_provider_class("google-gla")
            return "google-gla"
        except ValueError:
            pass
    except Exception:
        pass
    return "google-gla"


def gemini_model(model_name: str) -> str:
    """Build a provider-qualified model string compatible with local and Railway pydantic-ai."""
    name = (model_name or "").strip()
    if not name:
        name = "gemini-2.5-flash"
    prefix = _google_provider_prefix()
    if ":" in name:
        provider, _, rest = name.partition(":")
        if provider in {"google-gla", "gemini", "google"}:
            return f"{prefix}:{rest}"
        return name
    return f"{prefix}:{name}"
