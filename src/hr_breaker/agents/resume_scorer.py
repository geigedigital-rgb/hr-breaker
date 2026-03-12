"""Lightweight agent: score resume text vs job (0-100) for pre-assessment."""

from functools import lru_cache

from pydantic import BaseModel
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


async def score_resume_vs_job(resume_text: str, job: JobPosting) -> int:
    """Return ATS-style score 0-100. Uses only resume text (no PDF)."""
    agent = get_resume_scorer_agent()
    summary = _job_summary(job)
    prompt = f"## Job:\n{summary}\n\n## Resume (text):\n{resume_text[:6000]}"
    result = await agent.run(prompt)
    return max(0, min(100, result.output.score))


class BreakdownScores(BaseModel):
    """Independent scores 0-100: Skills, Experience, Portfolio."""

    skills: int  # match of skills/keywords to job
    experience: int  # relevance of work experience to job
    portfolio: int  # projects, achievements, certifications relevance
    improvement_tips: str | None = None  # optional: short text with headers and tips for better match


BREAKDOWN_SYSTEM = """You are an ATS analyst. Given a resume (plain text) and a job posting summary, output three independent scores 0-100 and optional improvement tips.

SCORES (required, integers 0-100):
- skills: How well the resume's skills and keywords match the job requirements (tools, technologies, methodologies).
- experience: How relevant the candidate's work experience is to the role (titles, domains, seniority).
- portfolio: How well projects, achievements, certifications, or education match what the job values.

IMPROVEMENT_TIPS (optional): If the resume could be improved for this job, provide a short text in English (2-4 blocks). Each block: a clear header (e.g. "Keywords", "Experience", "Structure") and 1-2 short sentences with concrete tips for better match. Use line breaks between blocks. If the resume is already an excellent match (scores high), you may leave improvement_tips empty or null.

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


async def get_breakdown_scores(resume_text: str, job: JobPosting) -> BreakdownScores:
    """Return independent Skills, Experience, Portfolio scores 0-100 and optional improvement_tips from LLM."""
    agent = get_breakdown_scorer_agent()
    summary = _job_summary(job)
    prompt = f"## Job:\n{summary}\n\n## Resume (text):\n{resume_text[:6000]}"
    result = await agent.run(prompt)
    out = result.output
    tips = getattr(out, "improvement_tips", None)
    if isinstance(tips, str):
        tips = tips.strip() or None
    return BreakdownScores(
        skills=max(0, min(100, out.skills)),
        experience=max(0, min(100, out.experience)),
        portfolio=max(0, min(100, out.portfolio)),
        improvement_tips=tips,
    )
