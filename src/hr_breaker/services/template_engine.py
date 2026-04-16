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


@dataclass(frozen=True)
class SkillLayoutConfig:
    max_groups: int
    max_items_per_group: int
    dense: bool = False


_TEMPLATES: list[TemplateManifest] = [
    TemplateManifest(
        id="jsonresume-flat-inspired",
        name="Flat",
        source="jsonresume",
        supports_photo=False,
        supports_columns=True,
        pdf_stability_score=0.93,
        default_css_vars={"accent": "#0f766e"},
        layout="standard",
    ),
    TemplateManifest(
        id="jsonresume-classic-inspired",
        name="Classic",
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
        name="Chikorita",
        source="reactive-resume",
        supports_photo=False,
        supports_columns=True,
        pdf_stability_score=0.9,
        default_css_vars={"accent": "#2d6a4f"},
        layout="rx_chikorita",
    ),
    TemplateManifest(
        id="reactive-ditto",
        name="Ditto",
        source="reactive-resume",
        supports_photo=True,
        supports_columns=True,
        pdf_stability_score=0.89,
        default_css_vars={"accent": "#be185d"},
        layout="rx_ditto",
    ),
    TemplateManifest(
        id="reactive-onyx",
        name="Onyx",
        source="reactive-resume",
        supports_photo=False,
        supports_columns=True,
        pdf_stability_score=0.92,
        default_css_vars={"accent": "#111827"},
        layout="rx_onyx",
    ),
    TemplateManifest(
        id="reactive-lapras",
        name="Lapras",
        source="reactive-resume",
        supports_photo=False,
        supports_columns=True,
        pdf_stability_score=0.9,
        default_css_vars={"accent": "#1d4ed8"},
        layout="rx_lapras",
    ),
    TemplateManifest(
        id="reactive-ditgar",
        name="Ditgar",
        source="reactive-resume",
        supports_photo=True,
        supports_columns=True,
        pdf_stability_score=0.87,
        default_css_vars={"accent": "#0f766e"},
        layout="rx_ditgar",
    ),
    TemplateManifest(
        id="reactive-vega",
        name="Vega",
        source="reactive-resume",
        supports_photo=True,
        supports_columns=True,
        pdf_stability_score=0.88,
        default_css_vars={"accent": "#006a80"},
        layout="rx_vega",
    ),
    TemplateManifest(
        id="reactive-cobalt",
        name="Cobalt",
        source="reactive-resume",
        supports_photo=True,
        supports_columns=True,
        pdf_stability_score=0.87,
        default_css_vars={"accent": "#005ebd"},
        layout="rx_cobalt",
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


def _get_skill_layout(layout_key: str) -> SkillLayoutConfig:
    presets = {
        "standard-single": SkillLayoutConfig(max_groups=4, max_items_per_group=5),
        "standard-two": SkillLayoutConfig(max_groups=5, max_items_per_group=5),
        "rx_chikorita": SkillLayoutConfig(max_groups=4, max_items_per_group=4, dense=True),
        "rx_ditto": SkillLayoutConfig(max_groups=4, max_items_per_group=4, dense=True),
        "rx_onyx": SkillLayoutConfig(max_groups=5, max_items_per_group=5),
        "rx_lapras": SkillLayoutConfig(max_groups=4, max_items_per_group=4),
        "rx_ditgar": SkillLayoutConfig(max_groups=4, max_items_per_group=4, dense=True),
        "rx_vega": SkillLayoutConfig(max_groups=5, max_items_per_group=6, dense=True),
        "rx_cobalt": SkillLayoutConfig(max_groups=6, max_items_per_group=8, dense=True),
    }
    return presets.get(layout_key, SkillLayoutConfig(max_groups=4, max_items_per_group=5))


def _render_skills(schema: UnifiedResumeSchema, layout_key: str) -> str:
    config = _get_skill_layout(layout_key)
    parts: list[str] = []
    for group in schema.skills[:config.max_groups]:
        items = [item for item in group.keywords[:config.max_items_per_group] if item.strip()]
        if not items:
            continue
        items_html = ", ".join(escape(item) for item in items)
        parts.append(
            "<div class='skill-group'>"
            f"<p class='skill-group-title'>{escape(group.name)}</p>"
            f"<p class='skill-group-items'>{items_html}</p>"
            "</div>"
        )
    if not parts:
        return ""
    dense_class = " skill-groups-dense" if config.dense else ""
    return _section("Skills", f"<div class='skill-groups{dense_class}'>{''.join(parts)}</div>", section_class="skills-section")


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
    return f"{_render_work(schema)}{_render_projects(schema)}{_render_education(schema)}"


def _side_column(schema: UnifiedResumeSchema, layout_key: str) -> str:
    return f"{_render_skills(schema, layout_key)}{_render_languages(schema)}"


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
  .skill-groups {{ display: grid; gap: 8px; }}
  .skill-groups-dense {{ gap: 6px; }}
  .skill-group {{ break-inside: avoid; }}
  .skill-group-title {{
    margin: 0 0 2px; font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .06em; color: var(--accent);
  }}
  .skill-group-items {{ margin: 0; line-height: 1.35; }}
""".strip()


def _render_standard(schema: UnifiedResumeSchema, accent: str, two_col: bool) -> str:
    body_class = "two-col" if two_col else "one-col"
    skill_layout = "standard-two" if two_col else "standard-single"
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
      {_render_skills(schema, skill_layout)}
      {_render_education(schema)}
    </div>
  </div>
</div>
""".strip()


def _render_rx_chikorita(schema: UnifiedResumeSchema, accent: str) -> str:
    return f"""
<style>
@page {{ margin: 0; }}
{_css_base(accent)}
  html, body {{ height: 100%; }}
  .rx-chikorita {{ display: flex; flex-direction: column; min-height: 100vh; background: linear-gradient(to right, var(--paper) 66%, var(--accent) 66%); }}
  .rx-chikorita .rx-row {{ display: flex; width: 100%; flex: 1; }}
  .rx-chikorita .rx-main {{ width: 66%; padding: 36px 40px; }}
  .rx-chikorita .rx-side {{
    width: 34%;
    background: transparent; color: var(--paper); padding: 36px 24px;
  }}
  .rx-chikorita .rx-side h2 {{
    color: var(--paper); border-bottom: 1px solid rgba(255,255,255,.45); padding-bottom: 4px;
  }}
  .rx-chikorita .rx-side .muted, .rx-chikorita .rx-side .contacts, .rx-chikorita .rx-side p, .rx-chikorita .rx-side li {{
    color: rgba(255,255,255,.92);
  }}
  .rx-chikorita .rx-side section.skills-section .skill-group-title {{
    color: rgba(255,255,255,.85);
  }}
</style>
<div class="resume rx-chikorita">
  <div class="rx-row">
    <div class="rx-main">{_render_basics(schema)}{_main_column(schema)}</div>
    <div class="rx-side">{_side_column(schema, "rx_chikorita")}</div>
  </div>
</div>
""".strip()


def _render_rx_ditto(schema: UnifiedResumeSchema, accent: str) -> str:
    b = schema.basics
    name = escape(b.name or "Candidate")
    label = f'<p class="label">{escape(b.label)}</p>' if b.label else ""
    summary = f'<p class="summary">{escape(b.summary)}</p>' if b.summary else ""
    contacts = _contacts_line(schema)
    
    photo_html = ""
    if getattr(b, "image", None):
        photo_html = f'<img src="{b.image}" class="rx-photo" alt="Photo" />'

    return f"""
<style>
@page {{ margin: 0; }}
{_css_base(accent)}
  html, body {{ height: 100%; }}
  .rx-ditto {{ display: flex; flex-direction: column; min-height: 100vh; }}
  .rx-ditto .rx-hero {{ display: flex; background: var(--accent); color: var(--paper); }}
  .rx-ditto .rx-hero-slot {{ width: 30%; max-width: 140px; min-width: 72px; flex-shrink: 0; position: relative; }}
  .rx-ditto .rx-hero-slot .rx-photo {{ position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; display: block; }}
  .rx-ditto .rx-hero-text {{ flex: 1; padding: 32px 36px 24px 12px; }}
  .rx-ditto .rx-hero-text h1 {{ color: var(--paper); }}
  .rx-ditto .rx-hero-text .label {{ color: rgba(255,255,255,.9); }}
  .rx-ditto .rx-hero-text .summary {{ color: rgba(255,255,255,.88); }}
  .rx-ditto .rx-hero-text .contacts {{ color: rgba(255,255,255,.88); margin-top: 8px; }}
  .rx-ditto .rx-row {{ display: flex; align-items: flex-start; width: 100%; padding: 16px 0 36px 0; flex: 1; }}
  .rx-ditto .rx-side {{ width: 30%; max-width: 200px; min-width: 140px; padding: 0 16px 0 36px; flex-shrink: 0; }}
  .rx-ditto .rx-main {{ flex: 1; padding: 0 36px 0 8px; min-width: 0; }}
</style>
<div class="resume rx-ditto">
  <div class="rx-hero">
    <div class="rx-hero-slot" aria-hidden="true">{photo_html}</div>
    <div class="rx-hero-text"><h1>{name}</h1>{label}{summary}{contacts}</div>
  </div>
  <div class="rx-row">
    <div class="rx-side">{_side_column(schema, "rx_ditto")}</div>
    <div class="rx-main">{_main_column(schema)}</div>
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
    <aside>{_side_column(schema, "rx_onyx")}</aside>
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
  .rx-lapras section.skills-section .skill-group {{
    padding-top: 2px;
  }}
</style>
<div class="resume rx-lapras">
  <header class="rx-head"><h1>{name}</h1>{label}{contacts}{summary}</header>
  {_main_column(schema)}
  {_side_column(schema, "rx_lapras")}
</div>
""".strip()


def _render_rx_ditgar(schema: UnifiedResumeSchema, accent: str) -> str:
    b = schema.basics
    name = escape(b.name or "Candidate")
    label = f'<p class="label">{escape(b.label)}</p>' if b.label else ""
    contacts = _contacts_line(schema)
    summary = f'<p class="summary">{escape(b.summary)}</p>' if b.summary else ""
    
    photo_html = ""
    if getattr(b, "image", None):
        photo_html = f'<div class="rx-photo-container"><img src="{b.image}" class="rx-photo" alt="Photo" /></div>'

    return f"""
<style>
{_css_base(accent)}
  .rx-ditgar .rx-row {{ display: flex; align-items: flex-start; width: 100%; }}
  .rx-ditgar .rx-side {{
    width: 34%; max-width: 220px; min-width: 150px; flex-shrink: 0;
    background: color-mix(in srgb, var(--accent) 20%, var(--paper));
  }}
  .rx-ditgar .rx-sidehead {{
    background: var(--accent); color: var(--paper); padding: 18px 16px;
    display: flex; flex-direction: column;
  }}
  .rx-ditgar .rx-photo-container {{ width: 80px; height: 80px; margin-bottom: 12px; border-radius: 4px; overflow: hidden; flex-shrink: 0; align-self: flex-start; }}
  .rx-ditgar .rx-photo {{ width: 100%; height: 100%; object-fit: cover; aspect-ratio: 1/1; }}
  .rx-ditgar .rx-sidehead h1 {{ color: var(--paper); font-size: 22px; }}
  .rx-ditgar .rx-sidehead .label {{ color: rgba(255,255,255,.9); }}
  .rx-ditgar .rx-sidehead .contacts {{ color: rgba(255,255,255,.88); }}
  .rx-ditgar .rx-sidebody {{ padding: 14px 16px 20px 16px; }}
  .rx-ditgar .rx-main {{ flex: 1; min-width: 0; padding: 20px 20px 20px 16px; }}
  .rx-ditgar .rx-main article {{
    border-left: 3px solid var(--accent); padding-left: 10px; margin-left: 2px;
  }}
</style>
<div class="resume rx-ditgar">
  <div class="rx-row">
    <div class="rx-side">
      <div class="rx-sidehead">{photo_html}<h1>{name}</h1>{label}{contacts}</div>
      <div class="rx-sidebody">{_side_column(schema, "rx_ditgar")}</div>
    </div>
    <div class="rx-main">{summary}{_main_column(schema)}</div>
  </div>
</div>
""".strip()


def _render_vega_contacts(schema: UnifiedResumeSchema) -> str:
    """Contacts line with simple icon prefixes, WeasyPrint-safe inline layout."""
    b = schema.basics
    location = b.location.compact() if b.location else ""
    items: list[str] = []
    if b.email:
        items.append(f'<span class="rx-ci">@ {escape(b.email)}</span>')
    if b.phone:
        items.append(f'<span class="rx-ci">&#x2706; {escape(b.phone)}</span>')
    if b.url:
        items.append(f'<span class="rx-ci">&#x2192; {escape(b.url)}</span>')
    if location:
        items.append(f'<span class="rx-ci">&#x25AA; {escape(location)}</span>')
    separator = ' <span class="rx-sep">&#x2022;</span> '
    return f'<p class="rx-contacts">{separator.join(items)}</p>' if items else ""


def _render_vega_work(schema: UnifiedResumeSchema) -> str:
    """Work entries with accent-colored company name and entry separators."""
    parts: list[str] = []
    for item in schema.work:
        dates = " \u2013 ".join(x for x in [item.start_date, item.end_date] if x)
        date_html = f'<span class="rx-date">{escape(dates)}</span>' if dates else ""
        company = f'<p class="rx-org">{escape(item.name)}</p>' if item.name else ""
        loc = getattr(item, "location", "") or ""
        loc_html = f' <span class="rx-loc">{escape(loc)}</span>' if loc else ""
        bullets = "".join(f"<li>{escape(x)}</li>" for x in item.highlights if x.strip())
        ul = f"<ul>{bullets}</ul>" if bullets else ""
        parts.append(
            f'<article>'
            f'<div class="rx-entry-head"><h3>{escape(item.position)}{loc_html}</h3>{date_html}</div>'
            f'{company}{ul}'
            f'</article>'
        )
    if not parts:
        return ""
    return f"<section><h2>Experience</h2>{''.join(parts)}</section>"


def _render_vega_education(schema: UnifiedResumeSchema) -> str:
    """Education entries with accent-colored institution name."""
    parts: list[str] = []
    for item in schema.education:
        degree = " ".join(x for x in [item.study_type, item.area] if x)
        dates = " \u2013 ".join(x for x in [item.start_date, item.end_date] if x)
        date_html = f'<span class="rx-date">{escape(dates)}</span>' if dates else ""
        institution = f'<p class="rx-org">{escape(item.institution)}</p>' if item.institution else ""
        loc = getattr(item, "location", "") or ""
        loc_html = f' <span class="rx-loc">{escape(loc)}</span>' if loc else ""
        parts.append(
            f'<article>'
            f'<div class="rx-entry-head"><h3>{escape(degree)}{loc_html}</h3>{date_html}</div>'
            f'{institution}'
            f'</article>'
        )
    if not parts:
        return ""
    return f"<section><h2>Education</h2>{''.join(parts)}</section>"


def _render_vega_projects(schema: UnifiedResumeSchema) -> str:
    parts: list[str] = []
    for item in schema.projects:
        bullets = "".join(f"<li>{escape(x)}</li>" for x in item.highlights if x.strip())
        desc = f"<p>{escape(item.description)}</p>" if item.description else ""
        parts.append(f"<article><h3>{escape(item.name)}</h3>{desc}<ul>{bullets}</ul></article>")
    if not parts:
        return ""
    return f"<section><h2>Projects</h2>{''.join(parts)}</section>"


def _render_skills_pills(schema: UnifiedResumeSchema) -> str:
    """Render skills as tinted pill badges."""
    all_items: list[str] = []
    for group in schema.skills[:6]:
        for kw in group.keywords[:6]:
            if kw.strip():
                all_items.append(kw.strip())
    if not all_items:
        return ""
    pills = "".join(f'<span class="rx-pill">{escape(item)}</span>' for item in all_items)
    return f"<section class='rx-skills'><h2>Skills</h2><div class='rx-pills'>{pills}</div></section>"


def _render_rx_vega(schema: UnifiedResumeSchema, accent: str) -> str:
    """Full-width colored header with photo top-right; Experience left, sidebar right.
    Serif corporate font, icons in contacts, accent-colored org names, section separators."""
    b = schema.basics
    name = escape(b.name or "Candidate")
    label = f'<p class="rx-label">{escape(b.label)}</p>' if b.label else ""
    summary_html = (
        f'<div class="rx-summary"><p>{escape(b.summary)}</p></div>' if b.summary else ""
    )

    contacts_html = _render_vega_contacts(schema)

    photo_html = ""
    if getattr(b, "image", None):
        photo_html = f'<img src="{b.image}" class="rx-photo" alt="Photo" />'

    # Languages with level text
    lang_parts: list[str] = []
    for item in schema.languages:
        fluency = (
            f'<span class="rx-lang-level">{escape(item.fluency)}</span>' if item.fluency else ""
        )
        lang_parts.append(
            f'<div class="rx-lang-row"><span>{escape(item.language)}</span>{fluency}</div>'
        )
    langs_html = (
        f"<section class='rx-langs'><h2>Languages</h2>"
        f"<div class='rx-lang-list'>{''.join(lang_parts)}</div></section>"
        if lang_parts else ""
    )

    side = f"{summary_html}{_render_skills_pills(schema)}{langs_html}"
    main = (
        f"{_render_vega_work(schema)}"
        f"{_render_vega_projects(schema)}"
        f"{_render_vega_education(schema)}"
    )

    return f"""
<style>
@page {{ margin: 0; }}
  :root {{ --accent: {accent}; --text: #1a1a2e; --muted: #5f6880; --paper: #ffffff; }}
  * {{ box-sizing: border-box; }}
  /* Serif corporate font — Georgia available on all platforms */
  body {{
    font-family: 'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif;
    color: var(--text); margin: 0; font-size: 13px; line-height: 1.4;
  }}
  h1 {{ font-size: 26px; margin: 0; line-height: 1.1; font-family: 'Georgia', serif; }}
  h2 {{
    font-family: 'Georgia', serif;
    font-size: 10px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
    color: var(--accent);
    border-bottom: 1.5px solid color-mix(in srgb, var(--accent) 22%, transparent);
    padding-bottom: 4px; margin: 16px 0 10px;
  }}
  h3 {{ margin: 0 0 2px; font-size: 13px; font-weight: 700; }}
  p {{ margin: 3px 0; line-height: 1.4; }}
  ul {{ margin: 5px 0 0 16px; padding: 0; }}
  li {{ margin: 2px 0; line-height: 1.35; font-size: 11.5px; }}
  .rx-vega {{ display: flex; flex-direction: column; min-height: 100vh; }}
  /* ── Header ── */
  .rx-vega .rx-head {{
    display: flex; align-items: center; justify-content: space-between;
    background: var(--accent); color: var(--paper);
    padding: 24px 32px 22px 32px; gap: 24px;
  }}
  .rx-vega .rx-head-text {{ flex: 1; min-width: 0; }}
  .rx-vega .rx-head-text h1 {{ color: var(--paper); font-size: 24px; margin-bottom: 4px; }}
  .rx-vega .rx-label {{
    color: rgba(255,255,255,.88); font-size: 12.5px; font-style: italic; margin: 2px 0 0;
  }}
  .rx-vega .rx-contacts {{
    color: rgba(255,255,255,.80); font-size: 11.5px; margin-top: 10px; line-height: 1.6;
  }}
  .rx-vega .rx-ci {{ display: inline; white-space: nowrap; }}
  .rx-vega .rx-sep {{ color: rgba(255,255,255,.45); margin: 0 2px; }}
  .rx-vega .rx-photo {{
    width: 84px; height: 84px; object-fit: cover; border-radius: 7px;
    flex-shrink: 0; display: block;
    border: 2px solid rgba(255,255,255,.35);
  }}
  /* ── Body ── */
  .rx-vega .rx-body {{ display: flex; align-items: flex-start; flex: 1; }}
  .rx-vega .rx-main {{ flex: 1; min-width: 0; padding: 18px 16px 22px 26px; }}
  .rx-vega .rx-side {{ width: 270px; flex-shrink: 0; padding: 18px 26px 22px 18px; }}
  .rx-vega .rx-main h2:first-child, .rx-vega .rx-side > *:first-child h2 {{ margin-top: 0; }}
  /* ── Entry layout ── */
  .rx-vega .rx-entry-head {{
    display: flex; justify-content: space-between; align-items: baseline; gap: 8px;
  }}
  .rx-vega .rx-date {{
    font-size: 10px; color: var(--muted); white-space: nowrap; flex-shrink: 0;
  }}
  .rx-vega .rx-org {{ color: var(--accent); font-size: 12px; font-weight: 600; margin: 1px 0 3px; }}
  .rx-vega .rx-loc {{ font-size: 11px; color: var(--muted); font-weight: 400; }}
  /* ── Article separators ── */
  .rx-vega article {{
    padding-bottom: 9px; margin-bottom: 9px;
    border-bottom: 1px solid rgba(0,0,0,.07);
  }}
  .rx-vega section > article:last-child {{ border-bottom: none; margin-bottom: 0; padding-bottom: 0; }}
  /* ── Summary ── */
  .rx-vega .rx-summary p {{ font-size: 11.5px; line-height: 1.5; color: var(--text); margin: 0; }}
  .rx-vega .rx-summary {{ margin-bottom: 4px; }}
  /* ── Skills pills ── */
  .rx-vega .rx-skills {{ }}
  .rx-vega .rx-pills {{ display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }}
  .rx-vega .rx-pill {{
    display: inline-block; font-size: 10px; padding: 2px 9px; border-radius: 20px;
    background: color-mix(in srgb, var(--accent) 9%, var(--paper));
    color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
    white-space: nowrap; font-family: 'Georgia', serif;
  }}
  /* ── Languages ── */
  .rx-vega .rx-langs {{ margin-top: 14px; }}
  .rx-vega .rx-lang-list {{ display: flex; flex-direction: column; gap: 5px; margin-top: 6px; }}
  .rx-vega .rx-lang-row {{
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 11.5px;
    padding-bottom: 5px; border-bottom: 1px solid rgba(0,0,0,.07);
  }}
  .rx-vega .rx-lang-list .rx-lang-row:last-child {{ border-bottom: none; padding-bottom: 0; }}
  .rx-vega .rx-lang-level {{ color: var(--muted); font-size: 10px; font-style: italic; }}
</style>
<div class="resume rx-vega">
  <div class="rx-head">
    <div class="rx-head-text">
      <h1>{name}</h1>
      {label}
      {contacts_html}
    </div>
    {photo_html}
  </div>
  <div class="rx-body">
    <div class="rx-main">{main}</div>
    <div class="rx-side">{side}</div>
  </div>
</div>
""".strip()


def _render_cobalt_skills(schema: UnifiedResumeSchema) -> str:
    """Plain text skills only: one line per keyword, bold bullet — no invented proficiency bars."""
    cfg = _get_skill_layout("rx_cobalt")
    items: list[str] = []
    for group in schema.skills[: cfg.max_groups]:
        for kw in group.keywords[: cfg.max_items_per_group]:
            t = kw.strip()
            if not t:
                continue
            items.append(f"<li>{escape(t)}</li>")
    if not items:
        return ""
    return (
        "<section class='rx-c-side-sec rx-c-skills'>"
        "<h2>Skills</h2>"
        f"<ul class='rx-c-side-bullets'>{''.join(items)}</ul>"
        "</section>"
    )


def _render_cobalt_languages(schema: UnifiedResumeSchema) -> str:
    """Language + optional fluency text from schema — no dot scale (we do not infer levels)."""
    items: list[str] = []
    for item in schema.languages:
        lang = escape(item.language)
        flu = (item.fluency or "").strip()
        if flu:
            items.append(
                "<li>"
                f"{lang}<span class='rx-c-lang-sep'> — </span>"
                f"<span class='rx-c-lang-fl'>{escape(flu)}</span>"
                "</li>"
            )
        else:
            items.append(f"<li>{lang}</li>")
    if not items:
        return ""
    return (
        "<section class='rx-c-side-sec rx-c-langs'>"
        "<h2>Languages</h2>"
        f"<ul class='rx-c-side-bullets'>{''.join(items)}</ul>"
        "</section>"
    )


def _render_cobalt_contacts_block(schema: UnifiedResumeSchema) -> str:
    """Stacked contact lines with simple symbols (WeasyPrint-safe)."""
    b = schema.basics
    location = b.location.compact() if b.location else ""
    lines: list[str] = []
    if b.phone:
        lines.append(
            f'<div class="rx-c-contact-line">'
            f'<span class="rx-c-cicon" aria-hidden="true">&#x260E;</span> {escape(b.phone)}</div>'
        )
    if b.email:
        lines.append(
            f'<div class="rx-c-contact-line">'
            f'<span class="rx-c-cicon" aria-hidden="true">@</span> {escape(b.email)}</div>'
        )
    if location:
        lines.append(
            f'<div class="rx-c-contact-line">'
            f'<span class="rx-c-cicon" aria-hidden="true">&#x25AA;</span> {escape(location)}</div>'
        )
    if b.url:
        lines.append(
            f'<div class="rx-c-contact-line">'
            f'<span class="rx-c-cicon" aria-hidden="true">&#x2192;</span> {escape(b.url)}</div>'
        )
    if not lines:
        return ""
    return (
        "<section class='rx-c-side-sec rx-c-contact'>"
        "<h2>Contact</h2>"
        f"<div class='rx-c-contact-stack'>{''.join(lines)}</div>"
        "</section>"
    )


def _render_rx_cobalt(schema: UnifiedResumeSchema, accent: str) -> str:
    """Right blue band (~280px), main column for experience/education, sidebar for photo,
    summary, contacts, bullet-list skills and languages (text only — no inferred rating bars).
    System UI sans stack only (no remote @font-face — avoids WeasyPrint SSL / fetch failures)."""
    b = schema.basics
    name = escape(b.name or "Candidate")
    label = f'<p class="rx-c-title">{escape(b.label)}</p>' if b.label else ""
    summary_block = (
        "<section class='rx-c-side-sec rx-c-summary-sec'><h2>Summary</h2>"
        f"<div class='rx-c-summary'><p>{escape(b.summary)}</p></div></section>"
        if b.summary
        else ""
    )
    if getattr(b, "image", None):
        photo_html = (
            '<div class="rx-c-photo-wrap">'
            f'<img src="{b.image}" class="rx-c-photo" alt="Photo" />'
            "</div>"
        )
    else:
        photo_html = '<div class="rx-c-photo-wrap rx-c-photo-empty" aria-hidden="true"></div>'
    side_inner = (
        f'<div class="rx-c-photo-outer">{photo_html}</div>'
        f"{summary_block}"
        f"{_render_cobalt_contacts_block(schema)}"
        f"{_render_cobalt_skills(schema)}"
        f"{_render_cobalt_languages(schema)}"
    )
    main = (
        f'<header class="rx-c-header"><h1>{name}</h1>{label}</header>'
        f"{_render_vega_work(schema)}"
        f"{_render_vega_projects(schema)}"
        f"{_render_vega_education(schema)}"
    )
    return f"""
<style>
@page {{ margin: 0; }}
  :root {{
    --accent: {accent};
    --rx-ink: rgba(0, 6, 38, 0.92);
    --rx-ink-soft: rgba(0, 6, 38, 0.72);
    --rx-rule: rgba(0, 17, 102, 0.1);
    --rx-side-text: rgba(255, 255, 255, 0.92);
    --rx-side-muted: rgba(255, 255, 255, 0.78);
    --rx-paper: #ffffff;
  }}
  * {{ box-sizing: border-box; }}
  .rx-cobalt {{
    position: relative;
    font-family: system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 12.5px;
    line-height: 1.4;
    color: var(--rx-ink);
    background: var(--rx-paper);
  }}
  .rx-cobalt .rx-c-band {{
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 280px;
    background: var(--accent);
    z-index: 0;
  }}
  .rx-cobalt .rx-c-inner {{
    position: relative;
    z-index: 1;
    display: flex;
    align-items: flex-start;
    gap: 40px;
    padding: 26px 22px 28px 26px;
  }}
  .rx-cobalt .rx-c-main {{
    flex: 1;
    min-width: 0;
    padding-right: 4px;
  }}
  /* min-width:0 — иначе min-content дочерних строк (навык + точки) раздувает колонку за 240px */
  .rx-cobalt .rx-c-side {{
    flex: 0 0 240px;
    width: 240px;
    max-width: 240px;
    min-width: 0;
    box-sizing: border-box;
    overflow-wrap: anywhere;
    color: var(--rx-side-text);
    padding-top: 2px;
  }}
  .rx-cobalt .rx-c-side-sec {{
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  }}
  .rx-cobalt .rx-c-header h1 {{
    margin: 0 0 4px;
    font-size: 1.55em;
    font-weight: 700;
    line-height: 1.15;
    color: var(--rx-ink);
    letter-spacing: -0.01em;
  }}
  .rx-cobalt .rx-c-title {{
    margin: 0 0 10px;
    font-size: 0.95em;
    font-weight: 600;
    color: var(--accent);
  }}
  /* Main column sections (shared Vega article markup) */
  .rx-cobalt .rx-c-main section > h2 {{
    margin: 18px 0 10px;
    padding-bottom: 6px;
    font-size: 1.12em;
    font-weight: 700;
    color: var(--rx-ink);
    border-bottom: 2px solid var(--rx-rule);
    text-transform: none;
    letter-spacing: 0;
  }}
  .rx-cobalt .rx-c-main section:first-of-type > h2 {{ margin-top: 0; }}
  .rx-cobalt .rx-c-main .rx-entry-head {{
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 2px;
  }}
  .rx-cobalt .rx-c-main h3 {{
    margin: 0;
    font-size: 0.95em;
    font-weight: 700;
    color: var(--rx-ink);
  }}
  .rx-cobalt .rx-c-main .rx-date {{
    font-size: 0.72em;
    color: var(--rx-ink-soft);
    white-space: nowrap;
    flex-shrink: 0;
  }}
  .rx-cobalt .rx-c-main .rx-org {{
    margin: 2px 0 4px;
    font-size: 0.88em;
    font-weight: 600;
    color: var(--accent);
  }}
  .rx-cobalt .rx-c-main .rx-loc {{ font-size: 0.78em; color: var(--rx-ink-soft); font-weight: 400; }}
  .rx-cobalt .rx-c-main ul {{ margin: 4px 0 12px 16px; padding: 0; }}
  .rx-cobalt .rx-c-main li {{ margin: 2px 0; font-size: 0.78em; line-height: 1.38; color: var(--rx-ink-soft); }}
  .rx-cobalt .rx-c-main article {{
    padding-bottom: 8px;
    margin-bottom: 8px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  }}
  .rx-cobalt .rx-c-main section > article:last-child {{
    border-bottom: none;
    margin-bottom: 0;
    padding-bottom: 0;
  }}
  /* Sidebar */
  .rx-cobalt .rx-c-photo-outer {{ display: flex; justify-content: center; margin-bottom: 10px; }}
  .rx-cobalt .rx-c-photo-wrap {{
    width: 118px;
    height: 118px;
    border-radius: 8px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.12);
  }}
  .rx-cobalt .rx-c-photo-empty {{
    border: 2px dashed rgba(255, 255, 255, 0.35);
    min-height: 118px;
    box-sizing: border-box;
  }}
  .rx-cobalt .rx-c-photo {{ width: 100%; height: 100%; object-fit: cover; display: block; }}
  .rx-cobalt .rx-c-side-sec h2 {{
    margin: 14px 0 8px;
    padding-bottom: 6px;
    font-size: 1.08em;
    font-weight: 700;
    color: #fff;
    border-bottom: 2px solid rgba(255, 255, 255, 0.14);
    text-transform: none;
    letter-spacing: 0;
  }}
  .rx-cobalt .rx-c-side-sec:first-child h2,
  .rx-cobalt .rx-c-photo-outer + .rx-c-side-sec h2 {{ margin-top: 0; }}
  .rx-cobalt .rx-c-summary p {{
    margin: 0;
    font-size: 0.78em;
    line-height: 1.45;
    color: var(--rx-side-muted);
  }}
  .rx-cobalt .rx-c-contact-stack {{ display: flex; flex-direction: column; gap: 7px; }}
  .rx-cobalt .rx-c-contact-line {{
    font-size: 0.76em;
    line-height: 1.35;
    color: var(--rx-side-muted);
    overflow-wrap: anywhere;
  }}
  .rx-cobalt .rx-c-cicon {{
    display: inline-block;
    width: 1.1em;
    margin-right: 2px;
    color: rgba(255, 255, 255, 0.95);
    font-weight: 600;
  }}
  .rx-cobalt .rx-c-side-bullets {{
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    width: 100%;
    max-width: 100%;
  }}
  .rx-cobalt .rx-c-side-bullets li {{
    position: relative;
    padding-left: 14px;
    margin: 0 0 8px;
    font-size: 0.76em;
    line-height: 1.42;
    color: var(--rx-side-muted);
    overflow-wrap: anywhere;
  }}
  .rx-cobalt .rx-c-side-bullets li:last-child {{ margin-bottom: 0; }}
  .rx-cobalt .rx-c-side-bullets li::before {{
    content: "\\2022";
    position: absolute;
    left: 0;
    top: -0.02em;
    font-weight: 900;
    font-size: 1.25em;
    line-height: 1.2;
    color: #fff;
  }}
  .rx-cobalt .rx-c-lang-sep {{ font-weight: 400; color: rgba(255, 255, 255, 0.45); }}
  .rx-cobalt .rx-c-lang-fl {{ font-weight: 500; color: rgba(255, 255, 255, 0.62); }}
</style>
<div class="resume rx-cobalt">
  <div class="rx-c-band" aria-hidden="true"></div>
  <div class="rx-c-inner">
    <div class="rx-c-main">{main}</div>
    <aside class="rx-c-side">{side_inner}</aside>
  </div>
</div>
""".strip()


_RX_DISPATCH: dict[str, Callable[[UnifiedResumeSchema, str], str]] = {
    "rx_chikorita": _render_rx_chikorita,
    "rx_ditto": _render_rx_ditto,
    "rx_onyx": _render_rx_onyx,
    "rx_lapras": _render_rx_lapras,
    "rx_ditgar": _render_rx_ditgar,
    "rx_vega": _render_rx_vega,
    "rx_cobalt": _render_rx_cobalt,
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
