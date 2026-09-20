"""Tests for deterministic template density fit-to-page."""

from __future__ import annotations

import pytest

from hr_breaker.models import UnifiedResumeSchema
from hr_breaker.services.template_engine import get_density_profile, render_template_html
from hr_breaker.services.template_fit import apply_density_profile, fit_schema_to_template


def _long_sentence(n: int = 90) -> str:
    return (
        "Delivered measurable outcomes across platform reliability, latency, and cost "
        "while partnering with product and design stakeholders on roadmap priorities. "
    ) * max(1, n // 90)


def _fat_schema() -> UnifiedResumeSchema:
    summary = (
        "Senior engineer with deep experience building distributed systems. "
        + _long_sentence(200)
        + "Passionate about mentoring and shipping durable APIs. "
        + _long_sentence(150)
    )
    work = []
    for i in range(8):
        work.append(
            {
                "name": f"Company {i + 1}",
                "position": f"Role {i + 1}",
                "start_date": f"{2010 + i}-01",
                "end_date": f"{2011 + i}-12" if i < 7 else "Present",
                "highlights": [
                    f"Highlight {j + 1} for role {i + 1}: " + _long_sentence(100)
                    for j in range(5)
                ],
            }
        )
    projects = []
    for i in range(5):
        projects.append(
            {
                "name": f"Project {i + 1}",
                "description": "Open-source toolkit used by teams worldwide. " + _long_sentence(120),
                "highlights": [
                    "Grew adoption significantly across enterprise customers.",
                    "Reduced incident volume through better observability.",
                    "Documented architecture for new contributors.",
                ],
            }
        )
    return UnifiedResumeSchema(
        basics={
            "name": "Alex Fat",
            "label": "Staff Engineer",
            "email": "alex@example.com",
            "summary": summary,
        },
        work=work,
        projects=projects,
        education=[
            {
                "institution": "State University",
                "area": "Computer Science",
                "study_type": "BSc",
                "start_date": "2006",
                "end_date": "2010",
            }
        ],
        skills=[
            {"name": "Backend", "keywords": ["Python", "Go", "PostgreSQL", "Redis", "Kafka"]},
            {"name": "Cloud", "keywords": ["AWS", "GCP", "Kubernetes", "Terraform"]},
        ],
        languages=[{"language": "English", "fluency": "Native"}],
    )


def _thin_schema() -> UnifiedResumeSchema:
    return UnifiedResumeSchema(
        basics={
            "name": "Sam Thin",
            "label": "Engineer",
            "email": "sam@example.com",
            "summary": "Builds reliable APIs.",
        },
        work=[
            {
                "name": "Acme",
                "position": "Engineer",
                "start_date": "2022-01",
                "end_date": "Present",
                "highlights": ["Shipped core API"],
            }
        ],
        education=[
            {
                "institution": "Tech College",
                "area": "CS",
                "study_type": "BSc",
                "end_date": "2021",
            }
        ],
        skills=[{"name": "Backend", "keywords": ["Python", "SQL"]}],
    )


FAT_TEMPLATES = (
    "jsonresume-classic-inspired",
    "reactive-chikorita",
    "reactive-cobalt",
    "reactive-lapras",
    "reactive-vega",
)


def test_density_profiles_group_templates():
    classic = get_density_profile("jsonresume-classic-inspired")
    flat = get_density_profile("jsonresume-flat-inspired")
    chikorita = get_density_profile("reactive-chikorita")
    cobalt = get_density_profile("reactive-cobalt")
    lapras = get_density_profile("reactive-lapras")
    onyx = get_density_profile("reactive-onyx")

    assert classic.sidebar_heavy is False
    assert onyx.sidebar_heavy is False
    assert flat.max_work_roles <= classic.max_work_roles
    assert chikorita.sidebar_heavy is True
    assert cobalt.sidebar_heavy is True
    assert lapras.sidebar_heavy is True
    assert chikorita.summary_max_chars < classic.summary_max_chars


def test_apply_density_profile_caps_fat_schema():
    schema = _fat_schema()
    profile = get_density_profile("jsonresume-classic-inspired")
    fitted, trims = apply_density_profile(schema, profile)

    assert trims
    assert len(fitted.work) <= profile.max_work_roles
    assert len(fitted.projects) <= profile.max_projects
    assert len(fitted.basics.summary or "") <= profile.summary_max_chars + 1  # ellipsis
    for role in fitted.work:
        assert len(role.highlights) <= profile.max_highlights_per_role


@pytest.mark.parametrize("template_id", FAT_TEMPLATES)
def test_fat_schema_fits_one_page(template_id: str):
    schema = _fat_schema()
    result = fit_schema_to_template(schema, template_id)
    assert result.page_count == 1
    assert result.fit_ok is True
    assert result.trims
    assert result.html_body
    assert "Alex Fat" in result.html_body


@pytest.mark.parametrize("template_id", FAT_TEMPLATES)
def test_thin_schema_no_unnecessary_trims(template_id: str):
    schema = _thin_schema()
    result = fit_schema_to_template(schema, template_id)
    assert result.page_count == 1
    assert result.fit_ok is True
    assert result.trims == []
    assert "Sam Thin" in result.html_body
    # Empty sections should not break render
    assert render_template_html(result.schema_fitted, template_id)


def test_projects_section_anchor():
    schema = _fat_schema()
    html = render_template_html(schema, "jsonresume-classic-inspired")
    assert 'data-section="projects"' in html
