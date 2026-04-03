"""Extract structured unified schema from raw resume text."""

from __future__ import annotations

from pydantic_ai import Agent

from hr_breaker.config import get_model_settings, get_settings
from hr_breaker.models import UnifiedResumeSchema

EXTRACTOR_PROMPT = """
You extract resume content into a strict JSON schema.

Rules:
- Use only facts present in the resume text.
- Never invent companies, dates, degrees, tools, or metrics.
- Keep text concise.
- Use ISO-like date strings when available (YYYY-MM or YYYY-MM-DD). If unknown, keep null.
- Prefer splitting skills into groups by domain.
- Place profile links in basics.profiles with network names (LinkedIn, GitHub, etc).
- Keep output language same as source resume.
- Output must be directly consumable by resume templates (no extra fields, no markdown, no comments).
- Fill core sections first: basics, work, education, skills, projects.
- If a value is missing, keep null or empty list instead of inventing.

Return only valid JSON for UnifiedResumeSchema.
"""

VERIFIER_PROMPT = """
You verify and correct a draft UnifiedResumeSchema against the original resume text.

Rules:
- The original text is the ONLY source of truth. Remove employers, dates, degrees, skills, bullets, or metrics not clearly present in the text.
- You may rephrase for clarity inside existing facts, but do not add new factual claims.
- Preserve valid structure: basics, work, education, skills, etc.
- Output must be a complete UnifiedResumeSchema (all required sections present; use empty strings/lists where appropriate).
- Keep the same language as the original resume for free text.
"""


def get_resume_schema_extractor() -> Agent:
    settings = get_settings()
    return Agent(
        f"google-gla:{settings.gemini_flash_model}",
        output_type=UnifiedResumeSchema,
        system_prompt=EXTRACTOR_PROMPT,
        model_settings=get_model_settings(),
    )


def get_resume_schema_verifier() -> Agent:
    settings = get_settings()
    return Agent(
        f"google-gla:{settings.gemini_flash_model}",
        output_type=UnifiedResumeSchema,
        system_prompt=VERIFIER_PROMPT,
        model_settings=get_model_settings(),
    )


async def extract_resume_schema(
    resume_content: str,
    target_role: str | None = None,
    target_locale: str | None = None,
    source_checksum: str | None = None,
) -> UnifiedResumeSchema:
    agent = get_resume_schema_extractor()
    prompt = f"""Resume text:
{resume_content}

Context:
- target_role: {target_role or ""}
- target_locale: {target_locale or ""}
- source_checksum: {source_checksum or ""}
"""
    result = await agent.run(prompt)
    schema = result.output
    if target_role:
        schema.meta.target_role = target_role
    if target_locale:
        schema.meta.target_locale = target_locale
    if source_checksum:
        schema.meta.source_checksum = source_checksum
    return schema


async def extract_resume_schema_strict(
    resume_content: str,
    target_role: str | None = None,
    target_locale: str | None = None,
    source_checksum: str | None = None,
) -> UnifiedResumeSchema:
    """Two-pass: extract then verify against source so templates get a tightened schema."""
    draft = await extract_resume_schema(
        resume_content,
        target_role=target_role,
        target_locale=target_locale,
        source_checksum=source_checksum,
    )
    verifier = get_resume_schema_verifier()
    prompt = f"""Original resume text (source of truth):
---
{resume_content}
---

Draft schema JSON (may contain unsupported facts):
{draft.model_dump_json(indent=2)}

Output the final UnifiedResumeSchema: drop anything not supported by the original text; keep structure valid."""
    result = await verifier.run(prompt)
    final = result.output
    final.meta = draft.meta
    return UnifiedResumeSchema.model_validate(final.model_dump())
