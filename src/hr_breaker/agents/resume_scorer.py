"""Lightweight agent: score resume text vs job (0-100) for pre-assessment."""

from functools import lru_cache

from pydantic import BaseModel, Field
from pydantic_ai import Agent

from hr_breaker.config import get_model_settings, get_settings
from hr_breaker.models import JobPosting


class ResumeScore(BaseModel):
    """ATS-style score 0-100 for resume vs job."""

    score: int  # 0-100


SYSTEM_PROMPT = """You are an ATS (Applicant Tracking System) scorer. Given a resume (plain text) and a job posting summary, output a single integer score from 0 to 100.

Score 0-100: how well the resume matches the job (keywords, experience relevance, clarity). Be strict but fair. Output ONLY the score as a JSON object: {"score": N}.
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
            await log_usage_event(
                pool, audit_user_id, "analyze_ats_score", model, input_tokens=inp, output_tokens=out
            )
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


class BreakdownScores(BaseModel):
    """Independent scores 0-100: Skills, Experience, Portfolio."""

    skills: int  # match of skills/keywords to job
    experience: int  # relevance of work experience to job
    portfolio: int  # projects, achievements, certifications relevance
    rejection_risk_score: int  # 0-100, where 100 means very high rejection risk
    critical_issues: list[str] = Field(default_factory=list)  # 1-2 short issues that drive rejection risk
    risk_summary: str | None = None  # short plain-language explanation of the risk
    improvement_tips: str | None = None  # optional: short text with headers and tips for better match


BREAKDOWN_SYSTEM = """You are an ATS analyst. Given a resume (plain text) and a job posting summary, output independent scores and risk analysis.

SCORES (required, integers 0-100):
- skills: How well the resume's skills and keywords match the job requirements (tools, technologies, methodologies).
- experience: How relevant the candidate's work experience is to the role (titles, domains, seniority).
- portfolio: How well projects, achievements, certifications, or education match what the job values.
- rejection_risk_score: Probability of rejection at screening stage (0-100). Higher means worse.

RISK CONSISTENCY RULES (required):
- If there are critical gaps (missing core skills, missing quantified impact, weak role relevance), rejection_risk_score MUST be elevated.
- If you output critical_issues, rejection_risk_score should usually not be low.
- Very low risk (<30) is only valid when resume is strongly aligned across skills, experience and portfolio.

CRITICAL ISSUES (required, list of 1-2 short strings):
- Provide the top issues that most likely cause rejection. Each issue should be short and concrete.

RISK SUMMARY (optional, short string):
- One concise sentence explaining the current rejection risk and why.

IMPROVEMENT_TIPS (optional): If the resume could be improved for this job, provide a short text (2-4 blocks). Each block: a clear header (e.g. "Keywords", "Experience", "Structure") and 1-2 short sentences with concrete tips for better match. Use line breaks between blocks. Write improvement_tips in the language specified in the user message (default: English). If the resume is already an excellent match (scores high), you may leave improvement_tips empty or null.

Be strict but fair. Output valid integers 0-100 for each score field."""


@lru_cache
def get_breakdown_scorer_agent() -> Agent:
    settings = get_settings()
    return Agent(
        f"google-gla:{settings.gemini_flash_model}",
        output_type=BreakdownScores,
        system_prompt=BREAKDOWN_SYSTEM,
        model_settings=get_model_settings(),
    )


async def get_breakdown_scores(
    resume_text: str,
    job: JobPosting,
    output_language: str | None = None,
    audit_user_id: str | None = None,
) -> BreakdownScores:
    """Return independent Skills/Experience/Portfolio and rejection-risk fields from LLM.
    output_language: e.g. 'en', 'ru'. Default English. Used for improvement_tips text."""
    from hr_breaker.services.db import get_pool
    from hr_breaker.services.usage_audit import log_usage_event, tokens_from_run_result

    settings = get_settings()
    model = settings.gemini_flash_model
    agent = get_breakdown_scorer_agent()
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
                "analyze_breakdown",
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
            pool, audit_user_id, "analyze_breakdown", model, input_tokens=inp, output_tokens=out_tok
        )
    return BreakdownScores(
        skills=max(0, min(100, out.skills)),
        experience=max(0, min(100, out.experience)),
        portfolio=max(0, min(100, out.portfolio)),
        rejection_risk_score=max(0, min(100, out.rejection_risk_score)),
        critical_issues=critical_issues,
        risk_summary=risk_summary,
        improvement_tips=tips,
    )
