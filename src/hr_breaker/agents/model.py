"""Canonical Gemini model id for pydantic-ai Agent constructors."""

from __future__ import annotations

import os
from functools import lru_cache


# Retired Gemini ids still set in prod env (GEMINI_PRO_MODEL) after Google 404'd them.
_GEMINI_MODEL_ALIASES = {
    "gemini-3-pro-preview": "gemini-3.1-pro-preview",
    "models/gemini-3-pro-preview": "gemini-3.1-pro-preview",
}


def canonical_gemini_model_id(model_name: str) -> str:
    name = (model_name or "").strip()
    if name.startswith("models/"):
        name = name[len("models/") :]
    return _GEMINI_MODEL_ALIASES.get(name, name)


@lru_cache
def _google_provider_prefix() -> str:
    """Return the provider prefix supported by the installed pydantic-ai.

    Older releases (e.g. 1.51) only know ``google-gla`` / ``google-vertex``.
    Newer releases dropped ``google-gla`` in favor of ``google``.

    Do **not** call ``infer_provider_class("google-gla")`` here: loading that
    provider imports ``google.genai``, which can hang for minutes on macOS when
    ADC probes the GCE metadata server. Prefer an explicit env override, then a
    lightweight registry name check, then a safe default string.
    """
    override = (os.getenv("GEMINI_PROVIDER_PREFIX") or "").strip()
    if override in {"google", "google-gla", "google-vertex"}:
        return override

    try:
        from pydantic_ai.providers import infer_provider_class

        # "google" is the new name — probing it does not load google.genai.
        try:
            infer_provider_class("google")
            return "google"
        except ValueError:
            pass
    except Exception:
        pass

    # Older pydantic-ai: model strings still use google-gla:… without importing
    # the provider class up front.
    return "google-gla"


def gemini_model(model_name: str) -> str:
    """Build a provider-qualified model string compatible with local and Railway pydantic-ai."""
    name = (model_name or "").strip()
    if not name:
        name = "gemini-2.5-flash"
    prefix = _google_provider_prefix()
    if ":" in name:
        provider, _, rest = name.partition(":")
        rest = canonical_gemini_model_id(rest)
        if provider in {"google-gla", "gemini", "google"}:
            return f"{prefix}:{rest}"
        return f"{provider}:{rest}" if rest else name
    name = canonical_gemini_model_id(name)
    return f"{prefix}:{name}"
