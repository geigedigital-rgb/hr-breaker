"""Extract structured summary (name, specialty, skills) from resume content using LLM."""

from pydantic import BaseModel
from pydantic_ai import Agent

from hr_breaker.config import get_model_settings, get_settings


class ResumeSummary(BaseModel):
    """Structured resume summary for display in UI."""

    full_name: str | None = None
    specialty: str | None = None
    skills: str | None = None


SYSTEM_PROMPT = """You are a resume/CV parser. Extract structured data for display in a summary card.

Input: resume content in any format (plain text, LaTeX, markdown, HTML, etc.).

Output (strict):
- full_name: The person's full name as written (e.g. "John Smith", "Anna Müller"). If not found, null.
- specialty: The job title, desired position, or professional role (e.g. "Frontend Developer", "Data Scientist"). Take from headline, title line, or "Objective" — one short phrase. If not found, null.
- skills: A short comma-separated list of key skills/technologies (e.g. "Python, SQL, React, AWS"). Max 120 characters. Skip section headers (like "SPRACHEN", "EDUCATION", "PERSONLICHE DATEN"). If none found, null.

Rules:
- Preserve original language; do not translate.
- Extract only what is clearly stated; do not invent.
- Ignore formatting commands and section headers; extract actual content.
- For skills: prefer technical/hard skills; limit to most relevant 5–10 items.
"""


async def extract_resume_summary(content: str) -> ResumeSummary:
    """Extract full_name, specialty, and skills from resume content using LLM."""
    settings = get_settings()
    snippet = content[: settings.agent_resume_summary_chars]
    agent = Agent(
        f"google-gla:{settings.gemini_flash_model}",
        output_type=ResumeSummary,
        system_prompt=SYSTEM_PROMPT,
        model_settings=get_model_settings(),
    )
    result = await agent.run(f"Extract structured summary from this resume:\n\n{snippet}")
    return result.output
