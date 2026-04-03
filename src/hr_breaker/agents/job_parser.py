from functools import lru_cache

from pydantic_ai import Agent

from hr_breaker.config import get_model_settings, get_settings
from hr_breaker.models import JobPosting

LEGACY_SYSTEM_PROMPT = """You are a job posting parser. Extract ONLY what is explicitly stated in the text.

Rules (strict):
- Preserve the original language of the job posting in all extracted fields; do not translate.
- Extract exactly what appears in the source. Do NOT invent, add, paraphrase, or infer.
- If a field is not clearly present in the text, leave it empty: title="" or company="" or requirements=[] or keywords=[] or description="".
- Do NOT write summaries or descriptions that are not in the source. For description, use only verbatim or near-verbatim excerpts from the text, or leave empty.
- requirements: list only items that are explicitly stated (bullets, "Du bringst mit:", "Requirements:", etc.). One requirement per list item. Do not combine or invent.
- keywords: only words/phrases that appear in the text (tools, technologies, skills named in the posting). Do not add similar terms.
- title: exact job title as written, or "" if not found.
- company: exact company/employer name as written, or "" if not found.

Output schema: title (str), company (str), requirements (list of str), keywords (list of str), description (str). Use empty string or empty list when not in source.
"""

SYSTEM_PROMPT = """You are a job posting parser. Extract ONLY what is explicitly stated in the text.

Goal: maximize downstream resume-to-job matching quality in one pass while staying factual.

Rules (strict):
- Preserve the original language of the job posting in all extracted fields; do not translate.
- Extract exactly what appears in the source. Do NOT invent, add, or infer hidden facts.
- If a field is not clearly present in the text, leave it empty: title="" or company="" or requirements=[] or keywords=[] or description="".
- title: exact job title as written, or "" if not found.
- company: exact company/employer name as written, or "" if not found.

requirements:
- Capture explicit requirements only (bullets, "Requirements", "Must have", "Nice to have", "Du bringst mit", etc.).
- Keep one requirement per item.
- Prefer atomic, actionable lines over long merged sentences.
- Include both mandatory and optional requirements when explicitly labeled.

keywords:
- Include ONLY exact words/phrases present in the posting.
- Prioritize skills/tools/technologies/frameworks/domains/certifications that influence ATS matching.
- Deduplicate semantically identical repeats (keep canonical spelling from source).
- Keep short keyword phrases (1-4 words) and preserve source casing where possible.

description:
- Use concise near-verbatim excerpts from responsibilities/mission/impact sections.
- Do not paraphrase into new claims and do not add content not present in source.

Output schema: title (str), company (str), requirements (list of str), keywords (list of str), description (str). Use empty string or empty list when not in source.
"""


@lru_cache
def get_job_parser_agent() -> Agent:
    settings = get_settings()
    return Agent(
        f"google-gla:{settings.gemini_flash_model}",
        output_type=JobPosting,
        system_prompt=SYSTEM_PROMPT,
        model_settings=get_model_settings(),
    )


async def parse_job_posting(text: str, audit_user_id: str | None = None) -> JobPosting:
    """Parse job posting text into structured data."""
    from hr_breaker.config import get_settings
    from hr_breaker.services.db import get_pool
    from hr_breaker.services.usage_audit import log_usage_event, tokens_from_run_result

    agent = get_job_parser_agent()
    settings = get_settings()
    model = settings.gemini_flash_model
    try:
        result = await agent.run(f"Parse this job posting:\n\n{text}")
        job = result.output
        job.raw_text = text
        if audit_user_id:
            pool = await get_pool()
            inp, out = tokens_from_run_result(result)
            await log_usage_event(
                pool, audit_user_id, "job_parse", model, input_tokens=inp, output_tokens=out
            )
        return job
    except Exception as e:
        if audit_user_id:
            pool = await get_pool()
            await log_usage_event(
                pool,
                audit_user_id,
                "job_parse",
                model,
                success=False,
                error_message=str(e)[:2000],
            )
        raise
