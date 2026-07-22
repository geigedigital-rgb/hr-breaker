"""Agents for pre-assessment scoring and improvement insights."""

from functools import lru_cache

from pydantic import BaseModel, Field
from pydantic_ai import Agent

from hr_breaker.config import get_model_settings, get_settings
from hr_breaker.agents.model import gemini_model
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
        gemini_model(settings.gemini_flash_model),
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


class ImprovementTip(BaseModel):
    """Short scannable tip: title + one imperative line."""

    title: str  # 3–6 words, anchors a place in THIS resume (or JD gap for tailor)
    do: str  # one short imperative: rewrite / move / add — no essay


class AnalysisInsights(BaseModel):
    """Risk and actionable improvement insights for pre-analysis."""

    rejection_risk_score: int  # 0-100, where 100 means very high rejection risk
    callback_blockers: list[CallbackBlocker] = Field(default_factory=list)
    risk_summary: str | None = None
    improvement_tips: str | None = None  # legacy free-form; optional
    # Improve mode (no job): ATS-friendly writing / layout / impact on THIS resume
    tips_writing: list[ImprovementTip] = Field(default_factory=list)
    tips_structure: list[ImprovementTip] = Field(default_factory=list)
    tips_impact: list[ImprovementTip] = Field(default_factory=list)
    # Tailor mode (with job): must-have gaps vs THIS posting (structure shared)
    tips_requirements: list[ImprovementTip] = Field(default_factory=list)


class _ImproveModeLLMOut(BaseModel):
    rejection_risk_score: int
    callback_blockers: list[CallbackBlocker] = Field(default_factory=list)
    risk_summary: str | None = None
    tips_writing: list[ImprovementTip] = Field(default_factory=list)
    tips_structure: list[ImprovementTip] = Field(default_factory=list)
    tips_impact: list[ImprovementTip] = Field(default_factory=list)


class _TailorModeLLMOut(BaseModel):
    rejection_risk_score: int
    callback_blockers: list[CallbackBlocker] = Field(default_factory=list)
    risk_summary: str | None = None
    tips_structure: list[ImprovementTip] = Field(default_factory=list)
    tips_requirements: list[ImprovementTip] = Field(default_factory=list)


IMPROVE_INSIGHTS_SYSTEM = """You are a resume coach focused on ATS-friendly clarity — NOT matching a job posting.

There is NO vacancy. Advice must improve THIS resume alone: structure, wording, phrases, scanability, impact.

OUTPUT:
- rejection_risk_score (0-100): how likely a generic ATS/recruiter skim rejects this resume for weak structure/clarity (not job mismatch).
- callback_blockers (1-2): concrete ATS/clarity problems on THIS resume. headline / impact / action — short. No vacancy language.
- tips_writing (1-2): words and phrases — weak verbs, fluff, inconsistent tone, unclear bullets. Each tip: title (3-6 words naming the place) + do (one short imperative).
- tips_structure (1-2): sections, lists, order, length, headings for ATS parse/scan. Same title+do format.
- tips_impact (1-2): where THIS resume has task-only bullets without result/number — name the role/project. Same title+do format.
- risk_summary (optional): one short sentence.

TIP STYLE (mandatory):
- title: scannable, e.g. "Prozessanalyse → bullets", "PitchCV metrics missing"
- do: ≤18 words, imperative, concrete (rewrite / move / start with verb / add one number). No essays. No "meet the requirement".

FORBIDDEN:
- Any reference to a job posting, vacancy, "requirements", keyword matching against a role
- Meta fluff: "be more professional", "improve keywords", "add quantifiable results" without naming WHERE in this resume
- Long paragraphs

LANGUAGE: user-facing strings in the language from the user message (default English).
Output valid JSON matching the schema."""


TAILOR_INSIGHTS_SYSTEM = """You are an ATS and recruiter screening analyst. Given a resume and a job posting, output SPECIFIC gaps for THIS pair only.

OUTPUT:
- rejection_risk_score (0-100): screening rejection probability for THIS role. Higher = worse.
- callback_blockers (1-2): why callbacks are unlikely for THIS role. headline / impact / action — each one short sentence. Name concrete tools/skills/requirements from the posting.
- tips_structure (1-2): layout/scan issues that hurt matching THIS role. title (3-6 words) + do (≤18 words imperative).
- tips_requirements (1-2): must-have from the posting that is missing/weak in the resume. title names the gap; do says where to add truthful proof (skills / bullet / summary). Quote or paraphrase a real posting requirement when possible.
- risk_summary (optional): one sentence.

Do NOT invent keyword chip lists — keywords are computed separately.

FORBIDDEN as sole content: "Add role-specific hard skills", "Mirror terminology", "Address must-have requirements" without naming what from THIS posting.

LANGUAGE: user-facing strings in the language from the user message (default English).
Output valid JSON matching the schema."""


@lru_cache
def get_improve_insights_agent() -> Agent:
    settings = get_settings()
    return Agent(
        gemini_model(settings.gemini_flash_model),
        output_type=_ImproveModeLLMOut,
        system_prompt=IMPROVE_INSIGHTS_SYSTEM,
        model_settings=get_model_settings(),
    )


@lru_cache
def get_tailor_insights_agent() -> Agent:
    settings = get_settings()
    return Agent(
        gemini_model(settings.gemini_flash_model),
        output_type=_TailorModeLLMOut,
        system_prompt=TAILOR_INSIGHTS_SYSTEM,
        model_settings=get_model_settings(),
    )


# Back-compat alias used by older imports/tests
def get_analysis_insights_agent() -> Agent:
    return get_tailor_insights_agent()


def _clamp_str(s: str, max_len: int) -> str:
    t = " ".join((s or "").strip().split())
    return t[:max_len] if len(t) > max_len else t


def _clamp_tips(raw: object, max_n: int = 2) -> list[ImprovementTip]:
    if not isinstance(raw, list):
        return []
    out: list[ImprovementTip] = []
    for item in raw:
        if isinstance(item, ImprovementTip):
            tip = item
        elif isinstance(item, dict):
            try:
                tip = ImprovementTip(**item)
            except Exception:
                continue
        else:
            continue
        title = _clamp_str(tip.title, 72)
        do = _clamp_str(tip.do, 160)
        if title and do:
            out.append(ImprovementTip(title=title, do=do))
        if len(out) >= max_n:
            break
    return out


def _clamp_blockers(raw: object) -> list[CallbackBlocker]:
    blockers: list[CallbackBlocker] = []
    if not isinstance(raw, list):
        return blockers
    for item in raw[:2]:
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
    return blockers


def _lang_instruction(output_language: str | None) -> str:
    if output_language and output_language.lower() != "en":
        return (
            f"\n\nWrite ALL user-facing strings (callback_blockers, tip titles/do, "
            f"risk_summary) in: {output_language}."
        )
    return "\n\nWrite ALL user-facing strings in English."


async def get_analysis_insights(
    resume_text: str,
    job: JobPosting,
    output_language: str | None = None,
    audit_user_id: str | None = None,
    improve_mode: bool = False,
) -> AnalysisInsights:
    """Return rejection risk and improvement tips from LLM.

    improve_mode=True: resume-only ATS/writing tips (no job matching).
    improve_mode=False: tips anchored to the given job posting.
    """
    from hr_breaker.services.db import get_pool
    from hr_breaker.services.usage_audit import log_usage_event, tokens_from_run_result

    settings = get_settings()
    model = settings.gemini_flash_model
    lang = _lang_instruction(output_language)

    if improve_mode:
        agent = get_improve_insights_agent()
        prompt = f"## Resume (text):\n{resume_text[:6000]}{lang}"
    else:
        agent = get_tailor_insights_agent()
        summary = _job_summary(job)
        prompt = f"## Job:\n{summary}\n\n## Resume (text):\n{resume_text[:6000]}{lang}"

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
    risk_summary = getattr(out, "risk_summary", None)
    if isinstance(risk_summary, str):
        risk_summary = risk_summary.strip() or None

    blockers = _clamp_blockers(getattr(out, "callback_blockers", None))

    tips_writing = _clamp_tips(getattr(out, "tips_writing", None)) if improve_mode else []
    tips_structure = _clamp_tips(getattr(out, "tips_structure", None))
    tips_impact = _clamp_tips(getattr(out, "tips_impact", None)) if improve_mode else []
    tips_requirements = _clamp_tips(getattr(out, "tips_requirements", None)) if not improve_mode else []

    if audit_user_id:
        pool = await get_pool()
        inp, out_tok = tokens_from_run_result(result)
        await log_usage_event(
            pool, audit_user_id, "analyze_insights", model, input_tokens=inp, output_tokens=out_tok
        )

    return AnalysisInsights(
        rejection_risk_score=max(0, min(100, int(out.rejection_risk_score))),
        callback_blockers=blockers,
        risk_summary=risk_summary,
        improvement_tips=None,
        tips_writing=tips_writing,
        tips_structure=tips_structure,
        tips_impact=tips_impact,
        tips_requirements=tips_requirements,
    )
