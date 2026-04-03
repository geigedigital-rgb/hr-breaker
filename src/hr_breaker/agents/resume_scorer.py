"""Agents for pre-assessment scoring and improvement insights."""

from functools import lru_cache

from pydantic import BaseModel, Field
from pydantic_ai import Agent

from hr_breaker.config import get_model_settings, get_settings
from hr_breaker.models import JobPosting


class ResumeScore(BaseModel):
    """ATS-style score 0-100 for resume vs job."""

    score: int  # 0-100


SYSTEM_PROMPT = """You are an ATS (Applicant Tracking System) scorer. Given a resume (plain text) and a job posting summary, output a single integer score from 0 to 100.

Score rubric (strict but fair):
- 90-100: Strong direct match on core requirements, role relevance, and concrete impact.
- 70-89: Good match with minor gaps or weaker evidence in some key areas.
- 50-69: Partial match; important requirements are missing or weakly evidenced.
- 0-49: Poor match; substantial gaps for this role.

Evaluate by: requirement coverage, keyword/skill alignment, role/seniority relevance, measurable outcomes, and clarity for ATS parsing.
Output ONLY the score as JSON: {"score": N}.
"""


@lru_cache
def get_resume_scorer_agent() -> Agent:
    settings = get_settings()
    return Agent(
        f"google-gla:{settings.gemini_flash_model}",
        output_type=ResumeScore,
        system_prompt=SYSTEM_PROMPT,
        model_settings=get_model_settings(),
    )


def _job_summary(job: JobPosting) -> str:
    parts = [f"Title: {job.title}", f"Company: {job.company}"]
    if job.requirements:
        parts.append("Requirements: " + "; ".join(job.requirements[:15]))
    if job.keywords:
        parts.append("Keywords: " + ", ".join(job.keywords[:30]))
    if job.description:
        parts.append("Description: " + (job.description[:800] + "..." if len(job.description) > 800 else job.description))
    return "\n".join(parts)


async def score_resume_vs_job(
    resume_text: str, job: JobPosting, audit_user_id: str | None = None
) -> int:
    """Return ATS-style score 0-100. Uses only resume text (no PDF)."""
    from hr_breaker.services.db import get_pool
    from hr_breaker.services.usage_audit import log_usage_event, tokens_from_run_result

    settings = get_settings()
    model = settings.gemini_flash_model
    agent = get_resume_scorer_agent()
    summary = _job_summary(job)
    prompt = f"## Job:\n{summary}\n\n## Resume (text):\n{resume_text[:6000]}"
    try:
        result = await agent.run(prompt)
        score = max(0, min(100, result.output.score))
        if audit_user_id:
            pool = await get_pool()
            inp, out = tokens_from_run_result(result)
            await log_usage_event(pool, audit_user_id, "analyze_ats_score", model, input_tokens=inp, output_tokens=out)
        return score
    except Exception as e:
        if audit_user_id:
            pool = await get_pool()
            await log_usage_event(
                pool,
                audit_user_id,
                "analyze_ats_score",
                model,
                success=False,
                error_message=str(e)[:2000],
            )
        raise


class AnalysisInsights(BaseModel):
    """Risk and actionable improvement insights for pre-analysis."""

    rejection_risk_score: int  # 0-100, where 100 means very high rejection risk
    critical_issues: list[str] = Field(default_factory=list)
    risk_summary: str | None = None
    improvement_tips: str | None = None


INSIGHTS_SYSTEM = """You are an ATS analyst. Given a resume (plain text) and a job posting summary, output risk analysis and actionable tips.

OUTPUT FIELDS:
- rejection_risk_score (required, integer 0-100): probability of rejection at screening stage. Higher means worse.
- critical_issues (required, list of 1-2 short strings): top issues that most likely cause rejection.
- risk_summary (optional, short string): one concise sentence explaining risk and why.
- improvement_tips (optional): 2-4 short blocks with clear headers (e.g. "Keywords", "Experience", "Structure"), each with 1-2 practical tips.

RISK CONSISTENCY RULES (required):
- If there are critical gaps (missing core skills, missing quantified impact, weak role relevance), rejection_risk_score must be elevated.
- If you output critical_issues, rejection_risk_score should usually not be low.
- Very low risk (<30) is only valid when alignment to role is strong and clear.

LANGUAGE:
- Write improvement_tips in the language specified in the user message (default: English).

Be strict but fair. Output valid values matching the schema."""


@lru_cache
def get_analysis_insights_agent() -> Agent:
    settings = get_settings()
    return Agent(
        f"google-gla:{settings.gemini_flash_model}",
        output_type=AnalysisInsights,
        system_prompt=INSIGHTS_SYSTEM,
        model_settings=get_model_settings(),
    )


async def get_analysis_insights(
    resume_text: str,
    job: JobPosting,
    output_language: str | None = None,
    audit_user_id: str | None = None,
) -> AnalysisInsights:
    """Return rejection risk and improvement tips from LLM."""
    from hr_breaker.services.db import get_pool
    from hr_breaker.services.usage_audit import log_usage_event, tokens_from_run_result

    settings = get_settings()
    model = settings.gemini_flash_model
    agent = get_analysis_insights_agent()
    summary = _job_summary(job)
    lang_instruction = ""
    if output_language and output_language.lower() != "en":
        lang_instruction = f"\n\nWrite improvement_tips in: {output_language}."
    prompt = f"## Job:\n{summary}\n\n## Resume (text):\n{resume_text[:6000]}{lang_instruction}"
    try:
        result = await agent.run(prompt)
    except Exception as e:
        if audit_user_id:
            pool = await get_pool()
            await log_usage_event(
                pool,
                audit_user_id,
                "analyze_insights",
                model,
                success=False,
                error_message=str(e)[:2000],
            )
        raise
    out = result.output
    tips = getattr(out, "improvement_tips", None)
    if isinstance(tips, str):
        tips = tips.strip() or None
    risk_summary = getattr(out, "risk_summary", None)
    if isinstance(risk_summary, str):
        risk_summary = risk_summary.strip() or None
    critical_issues = [str(x).strip() for x in (getattr(out, "critical_issues", None) or []) if str(x).strip()]
    critical_issues = critical_issues[:2]
    if audit_user_id:
        pool = await get_pool()
        inp, out_tok = tokens_from_run_result(result)
        await log_usage_event(
            pool, audit_user_id, "analyze_insights", model, input_tokens=inp, output_tokens=out_tok
        )
    return AnalysisInsights(
        rejection_risk_score=max(0, min(100, out.rejection_risk_score)),
        critical_issues=critical_issues,
        risk_summary=risk_summary,
        improvement_tips=tips,
    )
