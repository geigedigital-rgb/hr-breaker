"""Unified resume schema for editor + template rendering."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

_MAX_SECTION_ITEMS = 20
_MAX_SKILL_GROUPS = 6
_MAX_SKILL_KEYWORDS_PER_GROUP = 6
_MAX_TOTAL_SKILL_TOKENS = 24
_MAX_SKILL_TOKEN_CHARS = 64


class SchemaMeta(BaseModel):
    target_role: str | None = None
    target_locale: str | None = None
    source_checksum: str | None = None
    layout_hints: dict[str, str] = Field(default_factory=dict)


class SchemaLocation(BaseModel):
    city: str | None = None
    region: str | None = None
    country: str | None = None

    def compact(self) -> str:
        parts = [self.city, self.region, self.country]
        return ", ".join(p.strip() for p in parts if p and p.strip())


class SchemaProfile(BaseModel):
    network: str
    username: str | None = None
    url: str | None = None


class SchemaBasics(BaseModel):
    name: str = ""
    label: str | None = None
    image: str | None = None
    email: str | None = None
    phone: str | None = None
    url: str | None = None
    summary: str | None = None
    location: SchemaLocation | None = None
    profiles: list[SchemaProfile] = Field(default_factory=list)


class SchemaWork(BaseModel):
    name: str
    location: str | None = None
    description: str | None = None
    position: str
    url: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    highlights: list[str] = Field(default_factory=list)


class SchemaEducation(BaseModel):
    institution: str
    url: str | None = None
    area: str | None = None
    study_type: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    score: str | None = None
    courses: list[str] = Field(default_factory=list)


class SchemaSkill(BaseModel):
    name: str
    level: str | None = None
    keywords: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _normalize(self) -> "SchemaSkill":
        self.name = (self.name or "").strip()
        if self.level is not None:
            normalized_level = self.level.strip()
            self.level = normalized_level or None

        seen: set[str] = set()
        normalized_keywords: list[str] = []
        name_key = self.name.casefold() if self.name else ""
        for raw in self.keywords:
            keyword = (raw or "").strip()
            if not keyword:
                continue
            if len(keyword) > _MAX_SKILL_TOKEN_CHARS:
                keyword = keyword[:_MAX_SKILL_TOKEN_CHARS].rstrip()
            key = keyword.casefold()
            if key in seen or (name_key and key == name_key):
                continue
            seen.add(key)
            normalized_keywords.append(keyword)
            if len(normalized_keywords) >= _MAX_SKILL_KEYWORDS_PER_GROUP:
                break
        self.keywords = normalized_keywords
        return self


class SchemaProject(BaseModel):
    name: str
    description: str | None = None
    highlights: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    start_date: str | None = None
    end_date: str | None = None
    url: str | None = None


class SchemaCertificate(BaseModel):
    name: str
    date: str | None = None
    issuer: str | None = None
    url: str | None = None


class SchemaLanguage(BaseModel):
    language: str
    fluency: str | None = None


class SchemaAward(BaseModel):
    title: str
    date: str | None = None
    awarder: str | None = None
    summary: str | None = None


class SchemaPublication(BaseModel):
    name: str
    publisher: str | None = None
    release_date: str | None = None
    url: str | None = None
    summary: str | None = None


class UnifiedResumeSchema(BaseModel):
    schema_version: Literal["1.0"] = "1.0"
    meta: SchemaMeta = Field(default_factory=SchemaMeta)
    basics: SchemaBasics = Field(default_factory=SchemaBasics)
    work: list[SchemaWork] = Field(default_factory=list)
    education: list[SchemaEducation] = Field(default_factory=list)
    skills: list[SchemaSkill] = Field(default_factory=list)
    projects: list[SchemaProject] = Field(default_factory=list)
    certificates: list[SchemaCertificate] = Field(default_factory=list)
    languages: list[SchemaLanguage] = Field(default_factory=list)
    awards: list[SchemaAward] = Field(default_factory=list)
    publications: list[SchemaPublication] = Field(default_factory=list)

    @field_validator("work", "education", "projects", mode="after")
    @classmethod
    def _cap_list_sizes(cls, value: list[BaseModel]) -> list[BaseModel]:
        return value[:_MAX_SECTION_ITEMS]

    @field_validator("skills", mode="after")
    @classmethod
    def _normalize_skills(cls, value: list[SchemaSkill]) -> list[SchemaSkill]:
        normalized: list[SchemaSkill] = []
        seen_tokens: set[str] = set()
        remaining_tokens = _MAX_TOTAL_SKILL_TOKENS
        for skill in value:
            if len(normalized) >= _MAX_SKILL_GROUPS or remaining_tokens <= 0:
                break

            skill.name = (skill.name or "").strip()
            name_key = skill.name.casefold() if skill.name else ""
            if name_key and name_key in seen_tokens:
                skill.name = ""
                name_key = ""

            group_keywords: list[str] = []
            for keyword in skill.keywords:
                key = keyword.casefold()
                if key in seen_tokens or (name_key and key == name_key):
                    continue
                group_keywords.append(keyword)
                if len(group_keywords) >= _MAX_SKILL_KEYWORDS_PER_GROUP:
                    break

            tokens_left_for_keywords = remaining_tokens - (1 if skill.name else 0)
            if tokens_left_for_keywords < 0:
                break
            skill.keywords = group_keywords[:tokens_left_for_keywords]

            if not skill.name and not skill.keywords:
                continue

            if skill.name:
                seen_tokens.add(skill.name.casefold())
                remaining_tokens -= 1
            for keyword in skill.keywords:
                seen_tokens.add(keyword.casefold())
                remaining_tokens -= 1

            normalized.append(skill)
        return normalized
