"""Unified resume schema for editor + template rendering."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


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

    @field_validator("work", "education", "skills", "projects", mode="after")
    @classmethod
    def _cap_list_sizes(cls, value: list[BaseModel]) -> list[BaseModel]:
        return value[:20]
