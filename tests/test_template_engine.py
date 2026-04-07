from hr_breaker.models import UnifiedResumeSchema
from hr_breaker.services.renderer import HTMLRenderer
from hr_breaker.services.template_engine import (
    list_recommended_templates,
    list_templates,
    render_template_html,
)


def _sample_schema() -> UnifiedResumeSchema:
    return UnifiedResumeSchema(
        basics={
            "name": "Jane Doe",
            "label": "Senior Backend Engineer",
            "email": "jane@example.com",
            "summary": "Builds reliable backend systems and API platforms.",
        },
        work=[
            {
                "name": "Acme",
                "position": "Senior Engineer",
                "start_date": "2021-01",
                "end_date": "Present",
                "highlights": ["Improved latency by 34%", "Led migration to event-driven architecture"],
            }
        ],
        skills=[{"name": "Backend", "keywords": ["Python", "FastAPI", "PostgreSQL"]}],
    )


def test_templates_have_recommended_whitelist():
    all_templates = list_templates()
    recommended = list_recommended_templates()
    assert len(all_templates) >= 3
    assert len(recommended) >= 1
    assert all(t.recommended for t in recommended)
    rx_ids = {t.id for t in all_templates if t.source == "reactive-resume"}
    assert rx_ids >= {
        "reactive-chikorita",
        "reactive-ditto",
        "reactive-gengar",
        "reactive-onyx",
        "reactive-lapras",
        "reactive-ditgar",
    }


def test_template_render_smoke_pdf_stability():
    schema = _sample_schema()
    renderer = HTMLRenderer()
    for template in list_recommended_templates():
        html = render_template_html(schema, template.id)
        first = renderer.render(html)
        second = renderer.render(html)
        assert first.pdf_bytes[:4] == b"%PDF"
        assert first.page_count == second.page_count
