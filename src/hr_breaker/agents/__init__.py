"""Agent package — keep eager imports light so API can start without sklearn/WeasyPrint tools."""

from .job_parser import parse_job_posting
from .combined_reviewer import combined_review, compute_ats_score
from .name_extractor import extract_name
from .resume_summary_extractor import extract_resume_summary
from .hallucination_detector import detect_hallucinations
from .resume_scorer import (
    AnalysisInsights,
    CategoryScores,
    ImprovementTip,
    WorkspaceAnnotation,
    get_analysis_insights,
    score_resume_vs_job,
)
from .resume_schema_extractor import extract_resume_schema, extract_resume_schema_strict


def __getattr__(name: str):
    # optimizer pulls keyword_matcher tools + PDF preview stack; load on demand.
    if name == "optimize_resume":
        from .optimizer import optimize_resume

        return optimize_resume
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "parse_job_posting",
    "optimize_resume",
    "combined_review",
    "compute_ats_score",
    "extract_name",
    "extract_resume_summary",
    "detect_hallucinations",
    "score_resume_vs_job",
    "AnalysisInsights",
    "CategoryScores",
    "WorkspaceAnnotation",
    "ImprovementTip",
    "get_analysis_insights",
    "extract_resume_schema",
    "extract_resume_schema_strict",
]
