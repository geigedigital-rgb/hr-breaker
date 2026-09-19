"""Unit tests for category scores hybrid clamp and annotation validation."""

from hr_breaker.agents.resume_scorer import (
    CategoryScoresLLM,
    WorkspaceAnnotationLLM,
    _clamp_annotations,
    build_category_scores,
)


def test_build_category_scores_hybrid_keywords_clamped():
    llm = CategoryScoresLLM(content=80, keywords=95, impact=60, formatting=70)
    # TF-IDF 50% → 50; LLM 95 clamped to 50+15=65
    cs = build_category_scores(llm, keyword_score_0_1=0.5)
    assert cs.content == 80
    assert cs.impact == 60
    assert cs.formatting == 70
    assert cs.keywords == 65


def test_build_category_scores_without_tfidf_uses_llm():
    llm = CategoryScoresLLM(content=10, keywords=22, impact=33, formatting=44)
    cs = build_category_scores(llm, keyword_score_0_1=None)
    assert cs.keywords == 22


def test_clamp_annotations_filters_and_ids():
    raw = [
        WorkspaceAnnotationLLM(
            severity="positive",
            title="Strong match",
            body="Experience aligns well.",
            section="experience",
            anchor_y=0.45,
        ),
        {"severity": "bad", "title": "X", "body": "Y", "section": "skills", "anchor_y": 1.5},
        {"severity": "warning", "title": "", "body": "skip", "section": "summary", "anchor_y": 0.2},
    ]
    out = _clamp_annotations(raw, max_n=5)
    assert len(out) == 2
    assert out[0].id == "ann-1"
    assert out[0].severity == "positive"
    assert out[1].severity == "suggestion"  # invalid → suggestion
    assert out[1].anchor_y <= 0.95


def test_clamp_annotations_empty_safe():
    assert _clamp_annotations(None) == []
    assert _clamp_annotations([]) == []
