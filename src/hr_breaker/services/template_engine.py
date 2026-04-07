"""Template engine for unified resume schema."""

from __future__ import annotations

from collections.abc import Callable
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
    # "standard" = shared jsonresume-style grid; "rx_*" = layouts inspired by Reactive Resume templates.
    layout: str = "standard"


_TEMPLATES: list[TemplateManifest] = [
    TemplateManifest(
        id="jsonresume-even-inspired",
        name="Even (inspired)",
        source="jsonresume",
        supports_photo=False,
        supports_columns=False,
        pdf_stability_score=0.95,
        default_css_vars={"accent": "#2f40df"},
        layout="standard",
    ),
    TemplateManifest(
        id="jsonresume-flat-inspired",
        name="Flat (inspired)",
        source="jsonresume",
        supports_photo=False,
        supports_columns=True,
        pdf_stability_score=0.93,
        default_css_vars={"accent": "#0f766e"},
        layout="standard",
    ),
    TemplateManifest(
        id="jsonresume-classic-inspired",
        name="Classic (inspired)",
        source="jsonresume",
        supports_photo=False,
        supports_columns=False,
        pdf_stability_score=0.97,
        default_css_vars={"accent": "#111827"},
        layout="standard",
    ),
    # Names / structure mirror https://github.com/amruthpillai/reactive-resume (MIT); HTML/CSS is our WeasyPrint port.
    TemplateManifest(
        id="reactive-chikorita",
        name="Chikorita (Reactive Resume)",
        source="reactive-resume",
        supports_photo=False,
        supports_columns=True,
        pdf_stability_score=0.9,
        default_css_vars={"accent": "#2d6a4f"},
        layout="rx_chikorita",
    ),
    TemplateManifest(
        id="reactive-ditto",
        name="Ditto (Reactive Resume)",
        source="reactive-resume",
        supports_photo=False,
        supports_columns=True,
        pdf_stability_score=0.89,
        default_css_vars={"accent": "#be185d"},
        layout="rx_ditto",
    ),
    TemplateManifest(
        id="reactive-gengar",
        name="Gengar (Reactive Resume)",
        source="reactive-resume",
        supports_photo=False,
        supports_columns=True,
        pdf_stability_score=0.88,
        default_css_vars={"accent": "#6b21a8"},
        layout="rx_gengar",
    ),
    TemplateManifest(
        id="reactive-onyx",
        name="Onyx (Reactive Resume)",
        source="reactive-resume",
        supports_photo=False,
        supports_columns=True,
        pdf_stability_score=0.92,
        default_css_vars={"accent": "#111827"},
        layout="rx_onyx",
    ),
    TemplateManifest(
        id="reactive-lapras",
        name="Lapras (Reactive Resume)",
        source="reactive-resume",
        supports_photo=False,
        supports_columns=True,
        pdf_stability_score=0.9,
        default_css_vars={"accent": "#1d4ed8"},
        layout="rx_lapras",
    ),
    TemplateManifest(
        id="reactive-ditgar",
        name="Ditgar (Reactive Resume)",
        source="reactive-resume",
        supports_photo=False,
        supports_columns=True,
        pdf_stability_score=0.87,
        default_css_vars={"accent": "#0f766e"},
        layout="rx_ditgar",
    ),
]


def list_templates() -> list[TemplateManifest]:
    return _TEMPLATES


def list_recommended_templates() -> list[TemplateManifest]:
    return [t for t in _TEMPLATES if t.recommended]


def _section(title: str, body: str, *, section_class: str | None = None) -> str:
    if not body.strip():
        return ""
    cls = f' class="{escape(section_class)}"' if section_class else ""
    return f"<section{cls}><h2>{escape(title)}</h2>{body}</section>"


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
                chips.append(f'<span class="chip">{escape(value)}</span>')
    return _section("Skills", f"<div class='chips'>{''.join(chips)}</div>", section_class="skills-section")


def _render_projects(schema: UnifiedResumeSchema) -> str:
    parts: list[str] = []
    for item in schema.projects:
        bullets = "".join(f"<li>{escape(x)}</li>" for x in item.highlights if x.strip())
        desc = f"<p>{escape(item.description)}</p>" if item.description else ""
        parts.append(f"<article><h3>{escape(item.name)}</h3>{desc}<ul>{bullets}</ul></article>")
    return _section("Projects", "".join(parts))


def _render_languages(schema: UnifiedResumeSchema) -> str:
    parts: list[str] = []
    for item in schema.languages:
        fluency = f" — {escape(item.fluency)}" if item.fluency else ""
        parts.append(f"<article><h3>{escape(item.language)}{fluency}</h3></article>")
    return _section("Languages", "".join(parts))


def _main_column(schema: UnifiedResumeSchema) -> str:
    return f"{_render_work(schema)}{_render_projects(schema)}"


def _side_column(schema: UnifiedResumeSchema) -> str:
    return f"{_render_skills(schema)}{_render_education(schema)}{_render_languages(schema)}"


def _contacts_line(schema: UnifiedResumeSchema) -> str:
    b = schema.basics
    location = b.location.compact() if b.location else ""
    bits = [x for x in [b.email, b.phone, b.url, location] if x]
    if not bits:
        return ""
    return f'<p class="contacts">{" | ".join(escape(x) for x in bits)}</p>'


def _css_base(accent: str) -> str:
    return f"""
  :root {{ --accent: {accent}; --text: #111827; --muted: #6b7280; --paper: #ffffff; }}
  * {{ box-sizing: border-box; }}
  body {{ font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: var(--text); margin: 0; font-size: 12px; }}
  h1 {{ font-size: 26px; margin: 0; line-height: 1.1; }}
  h2 {{ margin: 14px 0 8px; color: var(--accent); font-size: 13px; letter-spacing: .04em; text-transform: uppercase; }}
  h3 {{ margin: 6px 0 2px; font-size: 13px; }}
  p {{ margin: 4px 0; line-height: 1.35; }}
  .label {{ font-weight: 600; }}
  .summary {{ margin-top: 8px; }}
  .contacts, .muted {{ color: var(--muted); }}
  ul {{ margin: 4px 0 8px 18px; padding: 0; }}
  li {{ margin: 2px 0; line-height: 1.3; }}
  .chips {{ display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }}
  /* inline-block only: inline-flex on <span> made WeasyPrint paint an inner flex item like a second pill */
  .chips .chip {{
    display: inline-block; vertical-align: middle; box-sizing: border-box;
    line-height: 1.3; margin: 0; outline: none;
    border: 1px solid #d1d5db; border-radius: 999px; padding: 4px 11px;
  }}
""".strip()


def _render_standard(schema: UnifiedResumeSchema, accent: str, two_col: bool) -> str:
    body_class = "two-col" if two_col else "one-col"
    return f"""
<style>
{_css_base(accent)}
  .resume {{ padding: 20px 24px; }}
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


def _render_rx_chikorita(schema: UnifiedResumeSchema, accent: str) -> str:
    return f"""
<style>
{_css_base(accent)}
  .rx-chikorita .rx-row {{ display: flex; align-items: stretch; width: 100%; }}
  .rx-chikorita .rx-main {{ flex: 1; padding: 20px 24px; min-width: 0; }}
  .rx-chikorita .rx-side {{
    width: 34%; max-width: 220px; min-width: 160px;
    background: var(--accent); color: var(--paper); padding: 20px 18px;
  }}
  .rx-chikorita .rx-side h2 {{
    color: var(--paper); border-bottom: 1px solid rgba(255,255,255,.45); padding-bottom: 4px;
  }}
  .rx-chikorita .rx-side .muted, .rx-chikorita .rx-side .contacts, .rx-chikorita .rx-side p, .rx-chikorita .rx-side li {{
    color: rgba(255,255,255,.92);
  }}
  /* One visual layer: no pill border on colored sidebar (avoids double frame with section heading rule). */
  .rx-chikorita .rx-side section.skills-section .chips .chip {{
    border: none; background: rgba(255,255,255,.2); color: var(--paper);
  }}
</style>
<div class="resume rx-chikorita">
  <div class="rx-row">
    <div class="rx-main">{_render_basics(schema)}{_main_column(schema)}</div>
    <div class="rx-side">{_side_column(schema)}</div>
  </div>
</div>
""".strip()


def _render_rx_ditto(schema: UnifiedResumeSchema, accent: str) -> str:
    b = schema.basics
    name = escape(b.name or "Candidate")
    label = f'<p class="label">{escape(b.label)}</p>' if b.label else ""
    summary = f'<p class="summary">{escape(b.summary)}</p>' if b.summary else ""
    contacts = _contacts_line(schema)
    return f"""
<style>
{_css_base(accent)}
  .rx-ditto .rx-hero {{ display: flex; background: var(--accent); color: var(--paper); }}
  .rx-ditto .rx-hero-slot {{ width: 30%; max-width: 140px; min-width: 72px; flex-shrink: 0; }}
  .rx-ditto .rx-hero-text {{ flex: 1; padding: 18px 24px 16px 12px; }}
  .rx-ditto .rx-hero-text h1 {{ color: var(--paper); }}
  .rx-ditto .rx-hero-text .label {{ color: rgba(255,255,255,.9); }}
  .rx-ditto .rx-hero-text .summary {{ color: rgba(255,255,255,.88); }}
  .rx-ditto .rx-below-contacts {{ padding: 10px 24px 0 24px; }}
  .rx-ditto .rx-row {{ display: flex; align-items: flex-start; width: 100%; padding: 16px 0 20px 0; }}
  .rx-ditto .rx-side {{ width: 30%; max-width: 200px; min-width: 140px; padding: 0 16px 0 24px; flex-shrink: 0; }}
  .rx-ditto .rx-main {{ flex: 1; padding: 0 24px 0 8px; min-width: 0; }}
</style>
<div class="resume rx-ditto">
  <div class="rx-hero">
    <div class="rx-hero-slot" aria-hidden="true"></div>
    <div class="rx-hero-text"><h1>{name}</h1>{label}{summary}</div>
  </div>
  <div class="rx-below-contacts">{contacts}</div>
  <div class="rx-row">
    <div class="rx-side">{_side_column(schema)}</div>
    <div class="rx-main">{_main_column(schema)}</div>
  </div>
</div>
""".strip()


def _render_rx_gengar(schema: UnifiedResumeSchema, accent: str) -> str:
    b = schema.basics
    name = escape(b.name or "Candidate")
    label = f'<p class="label">{escape(b.label)}</p>' if b.label else ""
    contacts = _contacts_line(schema)
    summary_band = (
        f'<div class="rx-sum"><p>{escape(b.summary)}</p></div>' if b.summary else ""
    )
    return f"""
<style>
{_css_base(accent)}
  .rx-gengar .rx-row {{ display: flex; align-items: stretch; width: 100%; position: relative; }}
  .rx-gengar .rx-strip {{
    position: absolute; left: 0; top: 0; bottom: 0; width: 32%; max-width: 210px;
    background: color-mix(in srgb, var(--accent) 18%, var(--paper)); z-index: 0;
  }}
  .rx-gengar .rx-side {{
    width: 32%; max-width: 210px; min-width: 150px; padding: 0 16px 20px 20px; position: relative; z-index: 1;
  }}
  .rx-gengar .rx-sidehead {{
    background: var(--accent); color: var(--paper); padding: 18px 16px; margin: 0 -16px 14px -20px;
  }}
  .rx-gengar .rx-sidehead h1 {{ color: var(--paper); font-size: 22px; }}
  .rx-gengar .rx-sidehead .label {{ color: rgba(255,255,255,.9); }}
  .rx-gengar .rx-sidehead .contacts {{ color: rgba(255,255,255,.88); }}
  .rx-gengar .rx-main {{ flex: 1; min-width: 0; padding: 20px 24px 20px 12px; position: relative; z-index: 1; }}
  .rx-gengar .rx-sum {{
    background: color-mix(in srgb, var(--accent) 22%, var(--paper));
    padding: 14px 16px; margin-bottom: 14px; border-radius: 4px;
  }}
  .rx-gengar .rx-sum p {{ margin: 0; }}
</style>
<div class="resume rx-gengar">
  <div class="rx-row">
    <div class="rx-strip" aria-hidden="true"></div>
    <div class="rx-side">
      <div class="rx-sidehead"><h1>{name}</h1>{label}{contacts}</div>
      {_side_column(schema)}
    </div>
    <div class="rx-main">{summary_band}{_main_column(schema)}</div>
  </div>
</div>
""".strip()


def _render_rx_onyx(schema: UnifiedResumeSchema, accent: str) -> str:
    b = schema.basics
    name = escape(b.name or "Candidate")
    label = f'<p class="label">{escape(b.label)}</p>' if b.label else ""
    summary = f'<p class="summary">{escape(b.summary)}</p>' if b.summary else ""
    contacts = _contacts_line(schema)
    return f"""
<style>
{_css_base(accent)}
  .rx-onyx {{ padding: 20px 24px; }}
  .rx-onyx .rx-head {{
    display: flex; align-items: flex-start; gap: 16px;
    border-bottom: 2px solid var(--accent); padding-bottom: 14px; margin-bottom: 16px;
  }}
  .rx-onyx .rx-stack {{ display: block; }}
  .rx-onyx .rx-stack main, .rx-onyx .rx-stack aside {{ display: block; width: 100%; }}
  .rx-onyx aside {{ margin-top: 8px; padding-top: 8px; }}
</style>
<div class="resume rx-onyx">
  <header class="rx-head">
    <div><h1>{name}</h1>{label}{contacts}{summary}</div>
  </header>
  <div class="rx-stack">
    <main>{_main_column(schema)}</main>
    <aside>{_side_column(schema)}</aside>
  </div>
</div>
""".strip()


def _render_rx_lapras(schema: UnifiedResumeSchema, accent: str) -> str:
    b = schema.basics
    name = escape(b.name or "Candidate")
    label = f'<p class="label">{escape(b.label)}</p>' if b.label else ""
    summary = f'<p class="summary">{escape(b.summary)}</p>' if b.summary else ""
    contacts = _contacts_line(schema)
    return f"""
<style>
{_css_base(accent)}
  .rx-lapras {{ padding: 20px 24px; }}
  .rx-lapras .rx-head {{
    border: 1px solid #d1d5db; border-radius: 10px; padding: 16px 18px; margin-bottom: 16px;
  }}
  .rx-lapras section {{
    border: 1px solid #d1d5db; border-radius: 10px; padding: 12px 14px; margin-bottom: 12px;
  }}
  .rx-lapras section h2 {{
    margin-top: 0; background: var(--paper); display: inline-block; padding: 0 6px;
    position: relative; top: -22px; margin-bottom: -10px;
  }}
  /* Card already has a border — chips use fill only (no nested outline / uneven padding). */
  .rx-lapras section.skills-section .chips .chip {{
    border: none; background: #f1f5f9; color: var(--text);
  }}
</style>
<div class="resume rx-lapras">
  <header class="rx-head"><h1>{name}</h1>{label}{contacts}{summary}</header>
  {_main_column(schema)}
  {_side_column(schema)}
</div>
""".strip()


def _render_rx_ditgar(schema: UnifiedResumeSchema, accent: str) -> str:
    b = schema.basics
    name = escape(b.name or "Candidate")
    label = f'<p class="label">{escape(b.label)}</p>' if b.label else ""
    contacts = _contacts_line(schema)
    summary = f'<p class="summary">{escape(b.summary)}</p>' if b.summary else ""
    return f"""
<style>
{_css_base(accent)}
  .rx-ditgar .rx-row {{ display: flex; align-items: stretch; width: 100%; position: relative; }}
  .rx-ditgar .rx-strip {{
    position: absolute; left: 0; top: 0; bottom: 0; width: 34%; max-width: 220px;
    background: color-mix(in srgb, var(--accent) 20%, var(--paper)); z-index: 0;
  }}
  .rx-ditgar .rx-side {{
    width: 34%; max-width: 220px; min-width: 150px; position: relative; z-index: 1;
  }}
  .rx-ditgar .rx-sidehead {{
    background: var(--accent); color: var(--paper); padding: 18px 16px;
  }}
  .rx-ditgar .rx-sidehead h1 {{ color: var(--paper); font-size: 22px; }}
  .rx-ditgar .rx-sidehead .label {{ color: rgba(255,255,255,.9); }}
  .rx-ditgar .rx-sidehead .contacts {{ color: rgba(255,255,255,.88); }}
  .rx-ditgar .rx-sidebody {{ padding: 14px 16px 20px 16px; }}
  .rx-ditgar .rx-main {{
    flex: 1; min-width: 0; padding: 20px 20px 20px 16px; position: relative; z-index: 1;
  }}
  .rx-ditgar .rx-main article {{
    border-left: 3px solid var(--accent); padding-left: 10px; margin-left: 2px;
  }}
</style>
<div class="resume rx-ditgar">
  <div class="rx-row">
    <div class="rx-strip" aria-hidden="true"></div>
    <div class="rx-side">
      <div class="rx-sidehead"><h1>{name}</h1>{label}{contacts}</div>
      <div class="rx-sidebody">{_side_column(schema)}</div>
    </div>
    <div class="rx-main">{summary}{_main_column(schema)}</div>
  </div>
</div>
""".strip()


_RX_DISPATCH: dict[str, Callable[[UnifiedResumeSchema, str], str]] = {
    "rx_chikorita": _render_rx_chikorita,
    "rx_ditto": _render_rx_ditto,
    "rx_gengar": _render_rx_gengar,
    "rx_onyx": _render_rx_onyx,
    "rx_lapras": _render_rx_lapras,
    "rx_ditgar": _render_rx_ditgar,
}


def render_template_html(schema: UnifiedResumeSchema, template_id: str) -> str:
    theme = next((t for t in _TEMPLATES if t.id == template_id), None)
    if theme is None:
        raise ValueError(f"Unknown template: {template_id}")
    accent = theme.default_css_vars.get("accent", "#2f40df")
    if theme.layout == "standard":
        return _render_standard(schema, accent, theme.supports_columns)
    renderer = _RX_DISPATCH.get(theme.layout)
    if renderer is None:
        raise ValueError(f"Unknown layout: {theme.layout}")
    return renderer(schema, accent)


def wrap_full_html(html_body: str) -> str:
    wrapper = (
        files("hr_breaker.templates")
        .joinpath("resume_wrapper.html")
        .read_text(encoding="utf-8")
    )
    return wrapper.replace("{{BODY}}", html_body)
