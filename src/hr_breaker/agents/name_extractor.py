from pydantic import BaseModel
from pydantic_ai import Agent

from hr_breaker.config import get_model_settings, get_settings


class ExtractedName(BaseModel):
    first_name: str | None
    last_name: str | None


SYSTEM_PROMPT = """Extract the person's name from this resume/CV content.

Return:
- first_name: The person's first/given name
- last_name: The person's last/family name (may include middle names)

If you cannot find a name, return null for both fields.
Handle any format: LaTeX, plain text, markdown, HTML, etc.
Ignore formatting commands - extract the actual name text only.
"""


async def extract_name(
    content: str, audit_user_id: str | None = None
) -> tuple[str | None, str | None]:
    """Extract first and last name from resume content using LLM."""
    from hr_breaker.services.db import get_pool
    from hr_breaker.services.usage_audit import log_usage_event, tokens_from_run_result

    settings = get_settings()
    model = settings.gemini_flash_model
    agent = Agent(
        f"google-gla:{model}",
        output_type=ExtractedName,
        system_prompt=SYSTEM_PROMPT,
        model_settings=get_model_settings(),
    )
    snippet = content[:settings.agent_name_extractor_chars]
    try:
        result = await agent.run(f"Extract the name from this resume:\n\n{snippet}")
    except Exception as e:
        if audit_user_id:
            pool = await get_pool()
            await log_usage_event(
                pool,
                audit_user_id,
                "extract_name",
                model,
                success=False,
                error_message=str(e)[:2000],
            )
        raise
    if audit_user_id:
        pool = await get_pool()
        inp, out = tokens_from_run_result(result)
        await log_usage_event(pool, audit_user_id, "extract_name", model, input_tokens=inp, output_tokens=out)
    return result.output.first_name, result.output.last_name
