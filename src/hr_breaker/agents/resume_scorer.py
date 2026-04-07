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


class CallbackBlocker(BaseModel):
    """One concrete reason callbacks are unlikely, with impact and fix (no generic CTAs)."""

    headline: str  # short diagnostic title, specific to THIS resume vs THIS job
    impact: str  # one sentence: why this hurts screening / callbacks
    action: str  # one sentence: truthful next step (tools, metrics, wording from posting)


class AnalysisInsights(BaseModel):
    """Risk and actionable improvement insights for pre-analysis."""

    rejection_risk_score: int  # 0-100, where 100 means very high rejection risk
    callback_blockers: list[CallbackBlocker] = Field(default_factory=list)
    risk_summary: str | None = None
    improvement_tips: str | None = None
    improvement_keywords: list[str] = Field(default_factory=list)
    improvement_structure: list[str] = Field(default_factory=list)
    improvement_requirements: list[str] = Field(default_factory=list)


INSIGHTS_SYSTEM = """You are an ATS and recruiter screening analyst. Given a resume (plain text) and a job posting summary, output structured, SPECIFIC insights for THIS pair only.

OUTPUT FIELDS:
- rejection_risk_score (required, integer 0-100): probability of rejection at screening. Higher = worse.

- callback_blockers (required, 1-2 objects): why this candidate may not get callbacks for THIS role.
  Each object: headline, impact, action — all three required, each one short sentence.
  headline: name a CONCRETE gap (e.g. missing tool X from posting, no metric for Y, role focus mismatch). NEVER use generic imperatives alone like "Add role-specific hard skills", "Mirror terminology", "Address requirements", "Improve keywords".
  impact: why that gap hurts ATS or human screening (one sentence).
  action: one truthful, specific step referencing tools/skills/requirements from the posting or resume where relevant.

- improvement_keywords (required, 1-3 strings): keyword / skills / terminology alignment. Each string ONE self-contained sentence: concrete gap or reinforcement + what to add (mention real tools/stack from the job when applicable). No generic one-liners without job/resume context.

- improvement_structure (required, 1-3 strings): layout, scanability, sections, bullets, length. Same style: one sentence each, specific to this resume.

- improvement_requirements (required, 1-3 strings): must-have requirements from the posting vs evidence in the resume. One sentence each; quote or paraphrase a real requirement when possible. Never output only "Address must-have requirements explicitly".

- risk_summary (optional): one sentence summarizing overall risk.
- improvement_tips (optional): legacy free-form tips; may be omitted if redundant.

FORBIDDEN (do not output as headline or as the sole content of any string):
Phrases that are only meta-advice with no resume/job anchor, e.g. "Add role-specific hard skills", "Mirror exact vacancy terminology", "Address must-have requirements explicitly", "Improve keyword coverage" without naming what is missing.

RISK CONSISTENCY:
- Strong gaps → higher rejection_risk_score.
- Very low risk (<30) only if alignment is clearly strong.

LANGUAGE:
- Write ALL user-facing strings in the language specified in the user message (default: English).

Be strict but fair. Output valid JSON matching the schema."""


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
        lang_instruction = (
            f"\n\nWrite ALL user-facing strings (callback_blockers, improvement lists, "
            f"risk_summary, improvement_tips) in: {output_language}."
        )
    else:
        lang_instruction = "\n\nWrite ALL user-facing strings in English."
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

    def _clamp_str(s: str, max_len: int) -> str:
        t = " ".join((s or "").strip().split())
        return t[:max_len] if len(t) > max_len else t

    blockers: list[CallbackBlocker] = []
    raw_blockers = getattr(out, "callback_blockers", None) or []
    for item in raw_blockers[:2]:
        if isinstance(item, CallbackBlocker):
            b = item
        elif isinstance(item, dict):
            try:
                b = CallbackBlocker(**item)
            except Exception:
                continue
        else:
            continue
        h, i, a = _clamp_str(b.headline, 220), _clamp_str(b.impact, 320), _clamp_str(b.action, 320)
        if h and i and a:
            blockers.append(CallbackBlocker(headline=h, impact=i, action=a))

    def _clamp_lines(lines: object, max_n: int, max_len: int) -> list[str]:
        if not isinstance(lines, list):
            return []
        out_lines: list[str] = []
        for x in lines:
            s = _clamp_str(str(x), max_len)
            if s and s not in out_lines:
                out_lines.append(s)
            if len(out_lines) >= max_n:
                break
        return out_lines

    kw = _clamp_lines(getattr(out, "improvement_keywords", None), 3, 400)
    st = _clamp_lines(getattr(out, "improvement_structure", None), 3, 400)
    rq = _clamp_lines(getattr(out, "improvement_requirements", None), 3, 400)

    if audit_user_id:
        pool = await get_pool()
        inp, out_tok = tokens_from_run_result(result)
        await log_usage_event(
            pool, audit_user_id, "analyze_insights", model, input_tokens=inp, output_tokens=out_tok
        )
    return AnalysisInsights(
        rejection_risk_score=max(0, min(100, out.rejection_risk_score)),
        callback_blockers=blockers,
        risk_summary=risk_summary,
        improvement_tips=tips,
        improvement_keywords=kw,
        improvement_structure=st,
        improvement_requirements=rq,
    )
