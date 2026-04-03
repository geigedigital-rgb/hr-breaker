"""Template engine for unified resume schema."""

from __future__ import annotations

from dataclasses import dataclass
from html import escape
from importlib.resources import files

from hr_breaker.models import UnifiedResumeSchema


@dataclass(frozen=True)
class TemplateManifest:
    id: str
    name: str
    source: str
    supports_photo: bool
    supports_columns: bool
    pdf_stability_score: float
    default_css_vars: dict[str, str]
    recommended: bool = True


_TEMPLATES: list[TemplateManifest] = [
    TemplateManifest(
        id="jsonresume-even-inspired",
        name="Even (inspired)",
        source="jsonresume",
        supports_photo=False,
        supports_columns=False,
        pdf_stability_score=0.95,
        default_css_vars={"accent": "#2f40df"},
    ),
    TemplateManifest(
        id="jsonresume-flat-inspired",
        name="Flat (inspired)",
        source="jsonresume",
        supports_photo=False,
        supports_columns=True,
        pdf_stability_score=0.93,
        default_css_vars={"accent": "#0f766e"},
    ),
    TemplateManifest(
        id="jsonresume-classic-inspired",
        name="Classic (inspired)",
        source="jsonresume",
        supports_photo=False,
        supports_columns=False,
        pdf_stability_score=0.97,
        default_css_vars={"accent": "#111827"},
    ),
]


def list_templates() -> list[TemplateManifest]:
    return _TEMPLATES


def list_recommended_templates() -> list[TemplateManifest]:
    return [t for t in _TEMPLATES if t.recommended]


def _section(title: str, body: str) -> str:
    if not body.strip():
        return ""
    return f'<section><h2>{escape(title)}</h2>{body}</section>'


def _render_basics(schema: UnifiedResumeSchema) -> str:
    b = schema.basics
    name = escape(b.name or "Candidate")
    label = f'<p class="label">{escape(b.label)}</p>' if b.label else ""
    summary = f'<p class="summary">{escape(b.summary)}</p>' if b.summary else ""
    location = b.location.compact() if b.location else ""
    contacts = [b.email, b.phone, b.url, location]
    contact_line = " | ".join(escape(x) for x in contacts if x)
    contacts_html = f'<p class="contacts">{contact_line}</p>' if contact_line else ""
    return f"<header><h1>{name}</h1>{label}{contacts_html}{summary}</header>"


def _render_work(schema: UnifiedResumeSchema) -> str:
    parts: list[str] = []
    for item in schema.work:
        title = f"{escape(item.position)} - {escape(item.name)}"
        dates = " - ".join(x for x in [item.start_date, item.end_date] if x)
        date_html = f'<p class="muted">{escape(dates)}</p>' if dates else ""
        bullets = "".join(f"<li>{escape(x)}</li>" for x in item.highlights if x.strip())
        parts.append(f"<article><h3>{title}</h3>{date_html}<ul>{bullets}</ul></article>")
    return _section("Experience", "".join(parts))


def _render_education(schema: UnifiedResumeSchema) -> str:
    parts: list[str] = []
    for item in schema.education:
        degree = " ".join(x for x in [item.study_type, item.area] if x)
        line = " - ".join(x for x in [item.institution, degree] if x)
        dates = " - ".join(x for x in [item.start_date, item.end_date] if x)
        parts.append(f"<article><h3>{escape(line)}</h3><p class='muted'>{escape(dates)}</p></article>")
    return _section("Education", "".join(parts))


def _render_skills(schema: UnifiedResumeSchema) -> str:
    chips: list[str] = []
    for group in schema.skills:
        values = [group.name] + group.keywords
        for value in values:
            if value.strip():
                chips.append(f"<span>{escape(value)}</span>")
    return _section("Skills", f"<div class='chips'>{''.join(chips)}</div>")


def _render_projects(schema: UnifiedResumeSchema) -> str:
    parts: list[str] = []
    for item in schema.projects:
        bullets = "".join(f"<li>{escape(x)}</li>" for x in item.highlights if x.strip())
        desc = f"<p>{escape(item.description)}</p>" if item.description else ""
        parts.append(f"<article><h3>{escape(item.name)}</h3>{desc}<ul>{bullets}</ul></article>")
    return _section("Projects", "".join(parts))


def render_template_html(schema: UnifiedResumeSchema, template_id: str) -> str:
    theme = next((t for t in _TEMPLATES if t.id == template_id), None)
    if theme is None:
        raise ValueError(f"Unknown template: {template_id}")
    accent = theme.default_css_vars.get("accent", "#2f40df")
    body_class = "two-col" if theme.supports_columns else "one-col"
    return f"""
<style>
  :root {{ --accent: {accent}; --text: #111827; --muted: #6b7280; }}
  * {{ box-sizing: border-box; }}
  body {{ font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: var(--text); margin: 0; font-size: 12px; }}
  .resume {{ padding: 20px 24px; }}
  h1 {{ font-size: 26px; margin: 0; line-height: 1.1; }}
  h2 {{ margin: 14px 0 8px; color: var(--accent); font-size: 13px; letter-spacing: .04em; text-transform: uppercase; }}
  h3 {{ margin: 6px 0 2px; font-size: 13px; }}
  p {{ margin: 4px 0; line-height: 1.35; }}
  .label {{ font-weight: 600; }}
  .summary {{ margin-top: 8px; }}
  .contacts, .muted {{ color: var(--muted); }}
  ul {{ margin: 4px 0 8px 18px; padding: 0; }}
  li {{ margin: 2px 0; line-height: 1.3; }}
  .chips {{ display: flex; flex-wrap: wrap; gap: 6px; }}
  .chips span {{ border: 1px solid #d1d5db; border-radius: 999px; padding: 2px 8px; }}
  .two-col .grid {{ display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }}
</style>
<div class="resume {body_class}">
  {_render_basics(schema)}
  <div class="grid">
    <div>
      {_render_work(schema)}
      {_render_projects(schema)}
    </div>
    <div>
      {_render_skills(schema)}
      {_render_education(schema)}
    </div>
  </div>
</div>
""".strip()


def wrap_full_html(html_body: str) -> str:
    wrapper = (
        files("hr_breaker.templates")
        .joinpath("resume_wrapper.html")
        .read_text(encoding="utf-8")
    )
    return wrapper.replace("{{BODY}}", html_body)
