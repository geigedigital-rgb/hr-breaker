from hr_breaker.models import UnifiedResumeSchema


def test_schema_normalizes_and_categorizes_skills():
    schema = UnifiedResumeSchema(
        skills=[
            {"name": "skills", "keywords": ["Python", "SQL", "R", "Tableau", "Looker", "SQL"]},
            {"name": "Marketing Analytics", "keywords": ["A/B Testing", "Campaign Performance", "Marketing Metrics"]},
            {"name": "BigQuery"},
            {"name": "tools", "keywords": ["Docker", "AWS", "  ", "technologies"]},
        ]
    )

    groups = {group.name: group.keywords for group in schema.skills}

    assert "R" not in {item for items in groups.values() for item in items}
    assert groups["Languages"] == ["Python", "SQL"]
    assert groups["Databases"] == ["BigQuery"]
    assert groups["BI & Visualization"] == ["Tableau", "Looker"]
    assert groups["Marketing & Experimentation"] == [
        "A/B Testing",
        "Campaign Performance",
        "Marketing Metrics",
    ]
    assert groups["Cloud & Infrastructure"] == ["Docker", "AWS"]
