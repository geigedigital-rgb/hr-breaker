from functools import lru_cache

from pydantic_ai import Agent

from hr_breaker.config import get_model_settings, get_settings
from hr_breaker.models import JobPosting

SYSTEM_PROMPT = """You are a job posting parser. Extract ONLY what is explicitly stated in the text.

Rules (strict):
- Extract exactly what appears in the source. Do NOT invent, add, paraphrase, or infer.
- If a field is not clearly present in the text, leave it empty: title="" or company="" or requirements=[] or keywords=[] or description="".
- Do NOT write summaries or descriptions that are not in the source. For description, use only verbatim or near-verbatim excerpts from the text, or leave empty.
- requirements: list only items that are explicitly stated (bullets, "Du bringst mit:", "Requirements:", etc.). One requirement per list item. Do not combine or invent.
- keywords: only words/phrases that appear in the text (tools, technologies, skills named in the posting). Do not add similar terms.
- title: exact job title as written, or "" if not found.
- company: exact company/employer name as written, or "" if not found.

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


async def parse_job_posting(text: str) -> JobPosting:
    """Parse job posting text into structured data."""
    agent = get_job_parser_agent()
    result = await agent.run(f"Parse this job posting:\n\n{text}")
    job = result.output
    job.raw_text = text
    return job
