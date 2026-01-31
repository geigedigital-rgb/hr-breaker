from pydantic import BaseModel, Field


class JobPosting(BaseModel):
    """Structured job posting data. Empty string = not found in source (do not invent)."""

    title: str = ""
    company: str = ""
    requirements: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    description: str = ""
    raw_text: str = ""
