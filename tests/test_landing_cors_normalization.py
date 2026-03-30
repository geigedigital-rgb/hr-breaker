"""LANDING_ALLOWED_ORIGINS: apex and www pitchcv.app are paired for browser CORS."""

from hr_breaker.api import _normalized_landing_cors_origins


def test_adds_www_when_only_apex():
    assert _normalized_landing_cors_origins("https://pitchcv.app") == [
        "https://pitchcv.app",
        "https://www.pitchcv.app",
    ]


def test_adds_apex_when_only_www():
    assert _normalized_landing_cors_origins("https://www.pitchcv.app") == [
        "https://www.pitchcv.app",
        "https://pitchcv.app",
    ]


def test_both_present_no_duplicate():
    assert _normalized_landing_cors_origins(
        "https://pitchcv.app,https://www.pitchcv.app"
    ) == ["https://pitchcv.app", "https://www.pitchcv.app"]


def test_other_origins_unchanged():
    assert _normalized_landing_cors_origins("https://example.com") == ["https://example.com"]
