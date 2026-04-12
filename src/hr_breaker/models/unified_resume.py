"""Unified resume schema for editor + template rendering."""

from __future__ import annotations

import re
from collections import OrderedDict
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


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


_MAX_SKILL_GROUPS = 6
_MAX_SKILLS_PER_GROUP = 6
_NOISY_SKILL_LABELS = {
    "r",
    "skill",
    "skills",
    "technology",
    "technologies",
    "tool",
    "tools",
    "tooling",
    "platform",
    "platforms",
    "software",
    "other",
    "misc",
    "miscellaneous",
    "various",
    "general",
    "additional",
    "etc",
}
_SKILL_ALIASES = {
    "python": "Python",
    "sql": "SQL",
    "mysql": "MySQL",
    "postgresql": "PostgreSQL",
    "postgres": "PostgreSQL",
    "sqlite": "SQLite",
    "bigquery": "BigQuery",
    "google bigquery": "BigQuery",
    "google big query": "BigQuery",
    "tableau": "Tableau",
    "looker": "Looker",
    "looker studio": "Looker Studio",
    "power bi": "Power BI",
    "google analytics": "Google Analytics",
    "mixpanel": "Mixpanel",
    "amplitude": "Amplitude",
    "dbt": "dbt",
    "airflow": "Airflow",
    "spark": "Spark",
    "pyspark": "PySpark",
    "excel": "Excel",
    "docker": "Docker",
    "kubernetes": "Kubernetes",
    "aws": "AWS",
    "gcp": "GCP",
    "azure": "Azure",
    "scikit learn": "scikit-learn",
    "sklearn": "scikit-learn",
    "tensorflow": "TensorFlow",
    "pytorch": "PyTorch",
    "machine learning": "Machine Learning",
    "ml": "Machine Learning",
    "artificial intelligence": "Artificial Intelligence",
    "ai": "Artificial Intelligence",
    "a/b testing": "A/B Testing",
    "ab testing": "A/B Testing",
    "a b testing": "A/B Testing",
    "causal inference": "Causal Inference",
    "marketing metrics": "Marketing Metrics",
    "campaign performance": "Campaign Performance",
}
_CATEGORY_ALIASES = {
    "languages": "Languages",
    "programming languages": "Languages",
    "language": "Languages",
    "frameworks": "Frameworks & Libraries",
    "libraries": "Frameworks & Libraries",
    "frameworks & libraries": "Frameworks & Libraries",
    "backend": "Frameworks & Libraries",
    "frontend": "Frameworks & Libraries",
    "databases": "Databases",
    "database": "Databases",
    "data": "Data & Analytics",
    "analytics": "Data & Analytics",
    "data analytics": "Data & Analytics",
    "data & analytics": "Data & Analytics",
    "bi": "BI & Visualization",
    "visualization": "BI & Visualization",
    "bi & visualization": "BI & Visualization",
    "dashboards": "BI & Visualization",
    "cloud": "Cloud & Infrastructure",
    "infrastructure": "Cloud & Infrastructure",
    "devops": "Cloud & Infrastructure",
    "cloud & infrastructure": "Cloud & Infrastructure",
    "tools": "Tools",
    "productivity tools": "Tools",
    "marketing": "Marketing & Experimentation",
    "experimentation": "Marketing & Experimentation",
    "marketing analytics": "Marketing & Experimentation",
    "marketing & experimentation": "Marketing & Experimentation",
}
_CATEGORY_PRIORITY = [
    "Languages",
    "Frameworks & Libraries",
    "Databases",
    "Data & Analytics",
    "BI & Visualization",
    "Cloud & Infrastructure",
    "Marketing & Experimentation",
    "Tools",
]
_SKILL_TO_CATEGORY = {
    "Python": "Languages",
    "SQL": "Languages",
    "R Programming": "Languages",
    "Java": "Languages",
    "JavaScript": "Languages",
    "TypeScript": "Languages",
    "Go": "Languages",
    "Rust": "Languages",
    "C++": "Languages",
    "C#": "Languages",
    "PHP": "Languages",
    "Ruby": "Languages",
    "Scala": "Languages",
    "FastAPI": "Frameworks & Libraries",
    "Django": "Frameworks & Libraries",
    "Flask": "Frameworks & Libraries",
    "Pandas": "Frameworks & Libraries",
    "NumPy": "Frameworks & Libraries",
    "scikit-learn": "Frameworks & Libraries",
    "TensorFlow": "Frameworks & Libraries",
    "PyTorch": "Frameworks & Libraries",
    "dbt": "Frameworks & Libraries",
    "Airflow": "Frameworks & Libraries",
    "Spark": "Frameworks & Libraries",
    "PySpark": "Frameworks & Libraries",
    "PostgreSQL": "Databases",
    "MySQL": "Databases",
    "SQLite": "Databases",
    "BigQuery": "Databases",
    "Snowflake": "Databases",
    "Redshift": "Databases",
    "Machine Learning": "Data & Analytics",
    "Artificial Intelligence": "Data & Analytics",
    "Statistics": "Data & Analytics",
    "Data Analysis": "Data & Analytics",
    "Data Modeling": "Data & Analytics",
    "ETL": "Data & Analytics",
    "Looker": "BI & Visualization",
    "Looker Studio": "BI & Visualization",
    "Tableau": "BI & Visualization",
    "Power BI": "BI & Visualization",
    "Google Analytics": "BI & Visualization",
    "Amplitude": "BI & Visualization",
    "Mixpanel": "BI & Visualization",
    "AWS": "Cloud & Infrastructure",
    "GCP": "Cloud & Infrastructure",
    "Azure": "Cloud & Infrastructure",
    "Docker": "Cloud & Infrastructure",
    "Kubernetes": "Cloud & Infrastructure",
    "A/B Testing": "Marketing & Experimentation",
    "Causal Inference": "Marketing & Experimentation",
    "Marketing Metrics": "Marketing & Experimentation",
    "Campaign Performance": "Marketing & Experimentation",
}


def _clean_skill_text(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = re.sub(r"\s+", " ", value).strip(" ,;|/-")
    cleaned = cleaned.replace("•", "").replace("·", "").strip()
    if not cleaned:
        return None
    lowered = cleaned.casefold()
    if lowered in _NOISY_SKILL_LABELS:
        return None
    alnum = re.sub(r"[^a-z0-9]+", "", lowered)
    if len(alnum) <= 1:
        return None
    alias = _SKILL_ALIASES.get(lowered)
    if alias:
        return alias
    if cleaned.islower():
        return cleaned.title()
    return cleaned


def _normalize_category_name(value: str | None) -> str | None:
    cleaned = _clean_skill_text(value)
    if not cleaned:
        return None
    lowered = cleaned.casefold()
    alias = _CATEGORY_ALIASES.get(lowered)
    if alias:
        return alias
    if any(token in lowered for token in ("analytics", "analysis", "data")):
        return "Data & Analytics"
    if any(token in lowered for token in ("visual", "dashboard", "bi")):
        return "BI & Visualization"
    if any(token in lowered for token in ("database", "sql", "warehouse")):
        return "Databases"
    if any(token in lowered for token in ("cloud", "infra", "devops")):
        return "Cloud & Infrastructure"
    if any(token in lowered for token in ("market", "experiment")):
        return "Marketing & Experimentation"
    if any(token in lowered for token in ("framework", "library", "backend", "frontend")):
        return "Frameworks & Libraries"
    if "language" in lowered:
        return "Languages"
    return cleaned if len(cleaned.split()) <= 4 else None


def _infer_skill_category(skill: str) -> str:
    category = _SKILL_TO_CATEGORY.get(skill)
    if category:
        return category
    lowered = skill.casefold()
    if any(token in lowered for token in ("sql", "query", "database", "warehouse")):
        return "Databases"
    if any(token in lowered for token in ("tableau", "looker", "power bi", "dashboard", "analytics", "mixpanel", "amplitude")):
        return "BI & Visualization"
    if any(token in lowered for token in ("experiment", "causal", "marketing", "campaign")):
        return "Marketing & Experimentation"
    if any(token in lowered for token in ("aws", "gcp", "azure", "docker", "kubernetes", "terraform", "cloud")):
        return "Cloud & Infrastructure"
    if any(token in lowered for token in ("python", "java", "javascript", "typescript", "scala", "ruby", "php", "go", "rust")):
        return "Languages"
    if any(token in lowered for token in ("api", "framework", "django", "flask", "fastapi", "spark", "airflow", "dbt")):
        return "Frameworks & Libraries"
    return "Tools"


def _normalize_skill_groups(groups: list[SchemaSkill]) -> list[SchemaSkill]:
    bucketed: OrderedDict[str, list[str]] = OrderedDict()
    seen: set[str] = set()

    for group in groups:
        category = _normalize_category_name(group.name)
        raw_items = list(group.keywords)
        if not raw_items and group.name:
            raw_items = [group.name]
            category = None
        elif group.name and category is None:
            raw_items = [group.name, *raw_items]

        for raw_item in raw_items:
            item = _clean_skill_text(raw_item)
            if not item:
                continue
            key = item.casefold()
            if key in seen:
                continue
            seen.add(key)
            inferred_category = _infer_skill_category(item)
            target_category = inferred_category if inferred_category != "Tools" else (category or inferred_category)
            bucketed.setdefault(target_category, []).append(item)

    if not bucketed:
        return []

    ordered_categories = sorted(
        bucketed.keys(),
        key=lambda name: (
            _CATEGORY_PRIORITY.index(name) if name in _CATEGORY_PRIORITY else len(_CATEGORY_PRIORITY),
            name,
        ),
    )
    normalized: list[SchemaSkill] = []
    for category_name in ordered_categories[:_MAX_SKILL_GROUPS]:
        items = bucketed[category_name][:_MAX_SKILLS_PER_GROUP]
        if items:
            normalized.append(SchemaSkill(name=category_name, keywords=items))
    return normalized


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

    @model_validator(mode="after")
    def _normalize_skills(self) -> "UnifiedResumeSchema":
        self.skills = _normalize_skill_groups(self.skills)
        return self
