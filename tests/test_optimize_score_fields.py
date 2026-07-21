"""OptimizeResponse score deltas — same methodology as /analyze."""

from hr_breaker.api import (
    OptimizeResponse,
    _keyword_score_to_pct,
    _optimize_score_fields,
)


def test_keyword_score_to_pct_fraction_and_percent():
    assert _keyword_score_to_pct(0.42) == 42
    assert _keyword_score_to_pct(42) == 42
    assert _keyword_score_to_pct(None) is None


def test_optimize_score_fields_deltas():
    fields = _optimize_score_fields(
        pre_ats=50,
        pre_kw=0.40,
        post_ats=70,
        post_kw=0.60,
    )
    assert fields["pre_ats_score"] == 50
    assert fields["post_ats_score"] == 70
    assert fields["improvement_ats_pp"] == 20
    assert fields["improvement_keyword_pp"] == 20  # 40% → 60%
    assert fields["improvement_overall_pp"] == 20  # 45 → 65


def test_optimize_response_includes_score_fields():
    from hr_breaker.api import JobPostingOut, ValidationResultOut

    fields = _optimize_score_fields(pre_ats=40, pre_kw=0.3, post_ats=55, post_kw=0.5)
    # pre overall 35, post overall round(52.5)=52 → +17 pp
    assert fields["improvement_overall_pp"] == 17
    resp = OptimizeResponse(
        success=True,
        validation=ValidationResultOut(passed=True, results=[]),
        job=JobPostingOut(title="T", company="C", requirements=[], keywords=[], description=""),
        error=None,
        **fields,
    )
    assert resp.pre_ats_score == 40
    assert resp.post_ats_score == 55
    assert resp.improvement_ats_pp == 15
    assert resp.improvement_overall_pp == 17
