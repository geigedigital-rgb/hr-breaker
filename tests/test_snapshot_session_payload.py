"""Sanitize client-provided analyze JSON stored in optimization_snapshots."""

from hr_breaker.api import _sanitize_session_analyze_payload, _sanitize_photo_for_snapshot


def test_sanitize_analyze_accepts_minimal_valid():
    d = _sanitize_session_analyze_payload(
        {
            "ats_score": 72,
            "keyword_score": 0.61,
            "keyword_threshold": 0.6,
            "recommendations": [],
        }
    )
    assert d is not None
    assert d["ats_score"] == 72


def test_sanitize_analyze_strips_admin_pipeline_log():
    d = _sanitize_session_analyze_payload(
        {
            "ats_score": 50,
            "keyword_score": 0.5,
            "keyword_threshold": 0.6,
            "recommendations": [],
            "admin_pipeline_log": [{"x": 1}],
        }
    )
    assert d is not None
    assert "admin_pipeline_log" not in d


def test_sanitize_analyze_rejects_invalid():
    assert _sanitize_session_analyze_payload({"ats_score": "bad"}) is None


def test_sanitize_photo_rejects_huge():
    assert _sanitize_photo_for_snapshot("x" * 800_000) is None
    assert _sanitize_photo_for_snapshot("data:image/png;base64,abc") == "data:image/png;base64,abc"
