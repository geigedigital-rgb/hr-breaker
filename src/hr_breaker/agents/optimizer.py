import logging
from datetime import date
from importlib.resources import files

from pydantic import BaseModel, model_validator
from pydantic_ai import Agent, BinaryContent, ModelRetry

from hr_breaker.agents.combined_reviewer import pdf_to_image
from hr_breaker.config import get_model_settings, get_settings
from hr_breaker.filters.data_validator import validate_html
from hr_breaker.filters.keyword_matcher import check_keywords
from hr_breaker.models import (
    ChangeDetail,
    IterationContext,
    JobPosting,
    OptimizedResume,
    ResumeSource,
)
from hr_breaker.services.length_estimator import estimate_content_length
from hr_breaker.services.renderer import HTMLRenderer, RenderError
from hr_breaker.utils import extract_text_from_html

logger = logging.getLogger(__name__)


def _load_resume_guide() -> str:
    """Load the HTML generation guide for the optimizer (package-safe)."""
    return (
        files("hr_breaker.templates")
        .joinpath("resume_guide.md")
        .read_text(encoding="utf-8")
    )


OPTIMIZER_BASE = r"""
You are a resume optimization expert. Extract content from user's resume and create an optimized HTML resume for a job posting.

INPUT: The user's resume text (any format).

OUTPUT: Generate HTML for the <body> of a resume PDF. Do NOT include <html>, <head>, or <body> tags - only the content.

CONTENT RULES:
- When describing job experiences, show concrete results: focus on impact, not tasks.
- Include specific technologies within achievement descriptions.
- Feature keywords matching job requirements IF they exist in the original resume. You can add umbrella terms if relevant (e.g. if user was making transformer LLM models you can add "NLP")
- Prioritize and highlight experiences most relevant to the role
- If going over the one page limit: remove unrelated content to save space.
- Remove obvious skills (Excel, VS Code, Jupyter, GitHub, Jira) unless specifically required by the job or very relevant fot it.
- Exclude: location, language proficiency, age, hobbies unless required by job posting.
- Add a summary section highlighting the most relevant experiences.
- Try to preserve the original writing style if possible.
- Avoid leaving an empty space at the bottom of the page if you have useful content to fill.
- PROJECTS: Only include projects directly relevant to this job. Skip projects already listed under Publications. If no projects are relevant, omit the section entirely.
- PUBLICATIONS: Always use "PUBLICATIONS" (plural) as the section title, even for a single item.
- EDUCATION: By default include only the most recent / highest degree. Include multiple degrees only if they are both relevant to the role.

{content_rules}

CONTENT BUDGET:
- Target: ~500 words, ~4000 characters (these are rough estimates, actual fit depends on formatting)
- The ONLY authoritative check is page_count from check_content_length

TOOLS:
- REQUIRED: call check_content_length(html) with your final HTML before returning — output is REJECTED if you skip this
  - Returns actual page_count from rendered PDF (authoritative)
  - Also returns character/word estimates (rough guidance only)
  - If page_count > 1, trim content and call again until fits_one_page=true
- REQUIRED: call check_keywords_tool(html) with your final HTML before returning — check keyword coverage
  - If score < 0.40 — add the returned missing_keywords into the Skills section where truthful, then call again
- OPTIONAL: validate_structure(html) - Check HTML has proper headers/sections. Use after major structural changes.
- OPTIONAL: preview_resume(html) - Renders PDF preview image. Use to visually check layout.

LINKS:
- Preserve contacts info as in the original and never delete it
- Preserve URLs from the original resume (email, LinkedIn, GitHub, website, project links)
- Use full URLs (include https://) in the href attribute of every <a> tag
- Link display text must NOT start with https:// or http:// — show just the domain+path (e.g. linkedin.com/in/username, github.com/username)

PUBLICATIONS:
- Always append the DOI in parentheses at the end if available, e.g. "Author et al., Title, Venue Year (DOI: 10.xxxx/xxxx)"

PROFILE SOURCE (when input contains "## Contact" or "## Source documents ranked by relevance"):
- The input is a MERGED PROFILE from multiple documents — it contains more content than one resume
- "Candidate name:" field → use as the resume H1 name (first + last name)
- "## Contact" → copy these fields ONLY into the header contact line (email, phone, LinkedIn, GitHub, website)
- "## Additional links" → these are reference links for inline use in projects/publications, NOT for the header
- "## Source documents ranked by relevance" → use to decide which experiences to highlight and trim
- Be selective: include only the 3-5 most relevant experience entries for this specific job
- Summary: 2-3 sentences maximum, tightly focused on this specific role
- You MUST trim aggressively to fit one page — call check_content_length early and cut ruthlessly

{resume_guide}
"""

OPTIMIZER_STRICT_RULES = """
ALLOWED:
- You CAN add related technologies plausible from context (e.g. Python user likely knows pip, venv; React user likely knows npm, webpack)
- General/umbrella terms inferable from context: "NLP" if they did text processing, "SQL" if they used databases
- Rephrasing metrics with same values: "1% - 10%" -> "1-10%"
- Reordering and emphasizing existing content
- Using content that is commented out and making it visible
- You CAN use <style> tags if you need custom styling beyond the provided classes

STRICT RULES - NEVER VIOLATE:
- NEVER add specific named products or platforms absent from the original (e.g. "Amazon Bedrock", "LangChain", "Pinecone") unless they are a direct, obvious companion to something explicitly present (e.g. PostgreSQL user → may know MySQL) AND there is no other way to improve fit
- NEVER fabricate job titles, companies, degrees, certifications, or achievements
- NEVER invent metrics, numbers and achievements not in original
- DO NOT drop work experience or achievements (publications, patents, awards, etc.) unless they decrease fit
- Never use the em dash symbol, the word "delve" or other common markers of LLM-generated text.
- NEVER add <script> tags
- Do not cut critical content (like work experience, education, etc) if you can cut something else (like summary)
"""

OPTIMIZER_LENIENT_RULES = """
ALLOWED:
- You CAN add related technologies plausible from context (e.g. Python user likely knows pip, venv; React user likely knows npm, webpack)
- You CAN extrapolate skills from adjacent experience
- You CAN make light assumptions about the candidate
- General/umbrella terms inferable from context: "NLP" if they did text processing, "SQL" if they used databases
- Rephrasing metrics with same values: "1% - 10%" -> "1-10%"
- Reordering and emphasizing existing content
- Using content that is commented out and making it visible
- You CAN use <style> tags if you need custom styling beyond the provided classes

STRICT RULES - NEVER VIOLATE:
- NEVER fabricate job titles, companies, degrees, certifications, or achievements
- NEVER invent metrics, numbers and achievements not in original
- Never use the em dash symbol, the word "delve" or other common markers of LLM-generated text.
- NEVER add <script> tags
- Do not cut critical content (like work experience, education, etc) if you can cut something else (like summary)
"""


class OptimizerResult(BaseModel):
    html: str
    changes: list[ChangeDetail]

    @model_validator(mode="before")
    @classmethod
    def changes_accept_legacy_strings(cls, data):
        """Accept legacy list of strings as single category."""
        if not isinstance(data, dict) or "changes" not in data:
            return data
        raw = data["changes"]
        if isinstance(raw, list) and raw and isinstance(raw[0], str):
            data["changes"] = [ChangeDetail(category="Изменения", items=raw)]
        return data


def get_optimizer_agent(
    job: JobPosting, source: ResumeSource, no_shame: bool = False
) -> Agent:
    """Create optimizer agent with job/source context for filter tools."""
    settings = get_settings()
    resume_guide = _load_resume_guide()
    content_rules = OPTIMIZER_LENIENT_RULES if no_shame else OPTIMIZER_STRICT_RULES
    system_prompt = OPTIMIZER_BASE.format(
        content_rules=content_rules, resume_guide=resume_guide
    )
    agent = Agent(
        f"google-gla:{settings.gemini_pro_model}",
        output_type=OptimizerResult,
        system_prompt=system_prompt,
        model_settings=get_model_settings(),
    )
    _check_state: dict = {"called": False, "fits": False, "page_count": None}

    @agent.system_prompt
    def add_current_date() -> str:
        return f"Today's date: {date.today().strftime('%B %Y')}"

    @agent.tool_plain
    def check_content_length(html: str) -> dict:
        """Check if HTML content fits one page by rendering PDF. Call before finalizing."""
        est = estimate_content_length(html)

        # Actually render PDF to check real page count
        try:
            renderer = HTMLRenderer()
            render_result = renderer.render(html)
            page_count = render_result.page_count
            fits_one_page = page_count == 1
        except RenderError as e:
            _check_state["called"] = True
            _check_state["fits"] = False
            return {
                "fits_one_page": False,
                "error": f"Render failed: {e}",
                "estimates": {
                    "chars": est.chars,
                    "words": est.words,
                    "note": "Estimates only - fix render error first",
                },
            }

        _check_state["called"] = True
        _check_state["fits"] = fits_one_page
        _check_state["page_count"] = page_count
        result = {
            "fits_one_page": fits_one_page,
            "page_count": page_count,
            "estimates": {
                "chars": est.chars,
                "words": est.words,
                "limits": {"chars": settings.resume_max_chars, "words": settings.resume_max_words},
                "note": "Character/word counts are rough estimates, page_count is authoritative",
            },
        }
        if not fits_one_page:
            result["suggestion"] = (
                f"Content spans {page_count} pages. Remove ~{est.overflow_words} words (estimate)"
            )
        logger.debug(
            "check_content_length called: %d pages, %d chars, %d words, fits=%s",
            page_count,
            est.chars,
            est.words,
            fits_one_page,
        )
        return result

    @agent.output_validator
    def enforce_length_check(result: OptimizerResult) -> OptimizerResult:
        """Reject output if check_content_length was not called or did not pass."""
        if not _check_state["called"]:
            raise ModelRetry(
                "You must call check_content_length(html) with your final HTML before returning. "
                "Call it now to verify the resume fits one page."
            )
        if not _check_state["fits"]:
            page_count = _check_state["page_count"]
            raise ModelRetry(
                f"check_content_length returned page_count={page_count} - the resume does not fit one page. "
                "Trim content and call check_content_length again until fits_one_page=True, then return."
            )
        return result

    @agent.tool_plain
    def preview_resume(html: str) -> BinaryContent:
        """Render HTML to PDF and return preview image. Use to visually check layout."""
        logger.debug("preview_resume called")
        renderer = HTMLRenderer()
        result = renderer.render(html)
        image_bytes, _ = pdf_to_image(result.pdf_bytes)
        return BinaryContent(data=image_bytes, media_type="image/png")

    @agent.tool_plain
    def check_keywords_tool(html: str) -> dict:
        """Check keyword coverage vs job posting. Returns missing keywords ranked by TF-IDF importance."""
        resume_text = extract_text_from_html(html)
        result = check_keywords(resume_text, job)
        logger.debug(
            "check_keywords called: score=%.2f, missing=%d",
            result.score,
            len(result.missing_keywords),
        )
        return {
            "passed": result.passed,
            "score": round(result.score, 2),
            "missing_keywords": result.missing_keywords,
        }

    @agent.tool_plain
    def validate_structure(html: str) -> dict:
        """Check HTML structure - headers, sections, no scripts."""
        valid, issues = validate_html(html)
        logger.debug(
            "validate_structure called: valid=%s, issues=%d", valid, len(issues)
        )
        return {"valid": valid, "issues": issues}

    return agent


async def optimize_resume(
    source: ResumeSource,
    job: JobPosting,
    context: IterationContext,
    no_shame: bool = False,
    output_language: str | None = None,
    audit_user_id: str | None = None,
    pre_ats_score: int | None = None,
    pre_keyword_score: float | None = None,
) -> OptimizedResume:
    """Optimize resume for job posting.
    output_language: Preferred language for all LLM output (e.g. 'en', 'ru'). Default: English."""
    lang_override = ""
    out_lang = (output_language or "en").strip().lower() or "en"
    if out_lang == "en":
        lang_override = "\n\nLANGUAGE: Write ALL output (HTML body text, key changes categories, descriptions, item labels) in English.\n"
    elif out_lang == "ru":
        lang_override = """
LANGUAGE OVERRIDE: Write ALL output (HTML body text, key changes categories, descriptions, item labels) in Russian only. Use Russian for section titles and labels (e.g. Структура, Опыт, Навыки, Ключевые слова). Do not use the job posting language for output.
"""
    else:
        lang_override = f"\n\nLANGUAGE: Write ALL output in this language only: {out_lang}. Do not use the job posting language for output.\n"
    _pre_kw = check_keywords(context.original_resume, job)
    _missing_kw_hint = (
        f"- Top missing keywords (vs original resume): {', '.join(_pre_kw.missing_keywords[:8])}\n"
        if _pre_kw.missing_keywords
        else ""
    )
    prompt = f"""## Original Resume:
{context.original_resume}

## Job Posting:
Title: {job.title}
Company: {job.company}
Requirements: {', '.join(job.requirements)}
Keywords: {', '.join(job.keywords)}
Description: {job.description}
{lang_override}
{_missing_kw_hint}
## One-pass optimization objective:
- Treat this as the main and usually only iteration.
- Build a requirement-to-resume mapping internally before writing final HTML:
  1) list explicit requirements and keywords from the posting,
  2) match them to evidence from the original resume,
  3) update wording/ordering so the strongest matches are easy for ATS and recruiter scans.
- Keep every claim truthful to source resume content.
"""
    if pre_ats_score is not None or pre_keyword_score is not None:
        pre_kw_pct = (
            round(pre_keyword_score * 100)
            if pre_keyword_score is not None and pre_keyword_score <= 1
            else round(pre_keyword_score or 0)
        )
        prompt += f"""
## Baseline analysis before improvement:
- ATS score: {pre_ats_score if pre_ats_score is not None else "unknown"}%
- Keyword score: {pre_kw_pct if pre_keyword_score is not None else "unknown"}%

Optimization target for this single deep pass:
- Maximize truthful alignment with vacancy requirements and keywords.
- Aim for strong match quality (about 75%+ when realistically achievable from source resume).
"""
    if no_shame:
        prompt += """
NOTE: The user has chosen "aggressive tailoring". You MAY add skills and technologies from the job posting (Requirements/Keywords above) into the resume where they are plausible given the candidate's experience (e.g. data/analytics role + job asks for SQL, Power BI → add them to skills). Still do not fabricate job titles, companies, or achievements. The user will verify the result before sending.
"""

    if context.last_attempt:
        estimate = estimate_content_length(context.last_attempt)
        prompt += f"""
## Last Attempt (Iteration {context.iteration}):
{context.last_attempt}

## Current Content Stats:
- Current: {estimate.chars} chars, {estimate.words} words

NOTE: This is a REFINEMENT iteration. Make the smallest possible change to pass failed filters.
Do NOT rewrite from scratch - modify the last attempt minimally.
"""

    if context.validation:
        prompt += f"""
## Filter Results:
{context.format_filter_results()}

IMPORTANT: Make MINIMAL changes to fix ONLY the failed filters.
- Start from the Last Attempt HTML above
- Change ONLY what's needed to pass the failed filter(s)
- Do NOT rewrite, rephrase, or restructure content that isn't causing failures
- Do NOT add new spelling mistakes, keywords, or stylistic changes if they were already added before
- Preserve everything that already works
"""

    prompt += """
Return JSON with:
- html: The HTML body content (no wrapper tags, just the content for <body>)
- changes: Array of change groups. Each object: { "category": "string", "description": "optional short text", "items": ["label1", "label2", ...] }.
  Use the SAME language as the job posting for categories and all text. Examples: German job → Struktur, Erfahrung, Fähigkeiten, Schlüsselwörter; English → Structure, Experience, Skills, Keywords; Russian → Структура, Опыт, Навыки, Ключевые слова. For skills/technologies put each as an item. Keep items short (single words or short phrases). Do not transliterate (e.g. use "Erfahrung" not "Opyt" for German).

KEY CHANGES — TONE (critical):
- Do NOT write changelog-style labels ("Added…", "Included…", "Fixed…", "Added missing contact header").
- Write short outcome-focused lines: what got better for screening/ATS, not what was inserted.
- Good (adapt to job language): "Optimized for ATS screening", "Stronger keyword alignment with the role", "Clearer impact metrics", "Tighter structure for parsers", "Improved section hierarchy for recruiters".
- Bad: "Added contact block", "Included phone number", "Added LinkedIn link".
- Prefer meaning like: optimized / strengthened / clarified / aligned for ATS (and natural equivalents in German, Russian, etc.).

FINAL SELF-CHECK BEFORE RETURN:
- check_content_length says fits_one_page=true.
- check_keywords_tool score must be >= 0.40. If below — add missing_keywords into Skills section where truthful, then call check_keywords_tool again.
- Key changes reflect real matching improvements against requirements and keywords.

Output ONLY valid JSON. The html field should contain the raw HTML string.
"""

    from hr_breaker.services.db import get_pool
    from hr_breaker.services.usage_audit import log_usage_event, tokens_from_run_result

    settings = get_settings()
    model = settings.gemini_pro_model
    agent = get_optimizer_agent(job, source, no_shame=no_shame)
    try:
        result = await agent.run(prompt)
    except Exception as e:
        if audit_user_id:
            pool = await get_pool()
            await log_usage_event(
                pool,
                audit_user_id,
                "optimize_generate",
                model,
                success=False,
                error_message=str(e)[:2000],
                metadata={"iteration": context.iteration},
            )
        raise
    if audit_user_id:
        pool = await get_pool()
        inp, out = tokens_from_run_result(result)
        await log_usage_event(
            pool,
            audit_user_id,
            "optimize_generate",
            model,
            input_tokens=inp,
            output_tokens=out,
            metadata={"iteration": context.iteration},
        )
    return OptimizedResume(
        html=result.output.html,
        iteration=context.iteration,
        changes=result.output.changes,
        source_checksum=source.checksum,
    )
