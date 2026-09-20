"""Deterministic fit-to-page for schema → template rendering."""

from __future__ import annotations

from dataclasses import dataclass

from hr_breaker.models import UnifiedResumeSchema
from hr_breaker.models.unified_resume import SchemaProject, SchemaWork
from hr_breaker.services.renderer import HTMLRenderer
from hr_breaker.services.template_engine import (
    TemplateDensityProfile,
    _PROFILE_OVERFLOW,
    _PROFILE_SIDEBAR_TIGHT,
    get_density_profile,
    render_template_html,
)


@dataclass
class TemplateFitResult:
    html_body: str
    schema_fitted: UnifiedResumeSchema
    page_count: int
    trims: list[str]
    fit_ok: bool


def _clamp_text(text: str | None, max_chars: int) -> tuple[str | None, bool]:
    if not text:
        return text, False
    t = " ".join(text.split())
    if len(t) <= max_chars:
        return t, False
    cut = t[: max_chars - 1].rsplit(" ", 1)[0].rstrip(",.;:")
    if len(cut) < max(24, max_chars // 3):
        cut = t[: max_chars - 1]
    return cut.rstrip() + "…", True


def _clamp_summary_by_sentences(text: str | None, max_chars: int) -> tuple[str | None, bool]:
    if not text:
        return text, False
    t = " ".join(text.split())
    if len(t) <= max_chars:
        return t, False
    # Prefer whole sentences
    parts: list[str] = []
    buf = ""
    for ch in t:
        buf += ch
        if ch in ".!?" and len(buf.strip()) >= 20:
            parts.append(buf.strip())
            buf = ""
    if buf.strip():
        parts.append(buf.strip())
    if not parts:
        return _clamp_text(t, max_chars)
    out: list[str] = []
    total = 0
    for p in parts:
        if out and total + 1 + len(p) > max_chars:
            break
        if not out and len(p) > max_chars:
            clipped, _ = _clamp_text(p, max_chars)
            return clipped, True
        out.append(p)
        total += len(p) + (1 if out else 0)
    joined = " ".join(out)
    if joined == t:
        return _clamp_text(t, max_chars)
    return joined, True


def apply_density_profile(
    schema: UnifiedResumeSchema,
    profile: TemplateDensityProfile,
) -> tuple[UnifiedResumeSchema, list[str]]:
    """Hard caps before first render. Returns fitted schema + trim labels."""
    trims: list[str] = []
    data = schema.model_copy(deep=True)

    summary, changed = _clamp_summary_by_sentences(data.basics.summary, profile.summary_max_chars)
    if changed:
        data.basics = data.basics.model_copy(update={"summary": summary})
        trims.append("summary_length")

    if len(data.work) > profile.max_work_roles:
        data.work = data.work[: profile.max_work_roles]
        trims.append("work_roles")

    new_work: list[SchemaWork] = []
    highlights_trimmed = False
    for role in data.work:
        hl = role.highlights or []
        if len(hl) > profile.max_highlights_per_role:
            hl = hl[: profile.max_highlights_per_role]
            highlights_trimmed = True
        clamped_hl: list[str] = []
        for h in hl:
            c, did = _clamp_text(h, profile.highlight_max_chars)
            if c:
                clamped_hl.append(c)
            if did:
                highlights_trimmed = True
        new_work.append(role.model_copy(update={"highlights": clamped_hl}))
    data.work = new_work
    if highlights_trimmed:
        trims.append("work_highlights")

    if len(data.projects) > profile.max_projects:
        data.projects = data.projects[: profile.max_projects]
        trims.append("projects_count")

    new_projects: list[SchemaProject] = []
    projects_trimmed = False
    for proj in data.projects:
        desc, dchg = _clamp_text(proj.description, profile.project_desc_max_chars)
        hl = (proj.highlights or [])[: profile.max_project_highlights]
        clamped_hl = []
        for h in hl:
            c, did = _clamp_text(h, profile.highlight_max_chars)
            if c:
                clamped_hl.append(c)
            if did:
                projects_trimmed = True
        if dchg:
            projects_trimmed = True
        new_projects.append(proj.model_copy(update={"description": desc, "highlights": clamped_hl}))
    data.projects = new_projects
    if projects_trimmed:
        trims.append("projects_text")

    return data, trims


def _apply_drop_step(
    schema: UnifiedResumeSchema,
    profile: TemplateDensityProfile,
    step: str,
) -> tuple[UnifiedResumeSchema, list[str]]:
    """One prefer_drop iteration."""
    data = schema.model_copy(deep=True)
    trims: list[str] = []

    if step == "projects":
        if len(data.projects) > 1:
            data.projects = data.projects[:-1]
            trims.append("drop_project")
        elif data.projects:
            p0 = data.projects[0]
            if p0.highlights:
                data.projects = [p0.model_copy(update={"highlights": p0.highlights[:-1]})]
                trims.append("drop_project_highlight")
            elif p0.description:
                clipped, _ = _clamp_text(p0.description, max(60, profile.project_desc_max_chars // 2))
                data.projects = [p0.model_copy(update={"description": clipped})]
                trims.append("shorten_project_desc")
            else:
                data.projects = []
                trims.append("drop_project")
        return data, trims

    if step == "older_work":
        keep = max(profile.min_work_roles, 2)
        if len(data.work) > keep:
            data.work = data.work[:-1]
            trims.append("drop_older_work")
        return data, trims

    if step == "highlights":
        # Trim from oldest roles first (end of list)
        for i in range(len(data.work) - 1, -1, -1):
            role = data.work[i]
            if len(role.highlights) > 1:
                data.work[i] = role.model_copy(update={"highlights": role.highlights[:-1]})
                trims.append("drop_highlight")
                return data, trims
        return data, trims

    if step == "summary":
        if data.basics.summary:
            target = max(120, int(profile.summary_max_chars * 0.7))
            summary, changed = _clamp_summary_by_sentences(data.basics.summary, target)
            if changed or (summary and data.basics.summary and summary != data.basics.summary):
                data.basics = data.basics.model_copy(update={"summary": summary})
                trims.append("shorten_summary")
        return data, trims

    return data, trims


def _measure_page_count(html_body: str) -> int:
    renderer = HTMLRenderer()
    result = renderer.render(html_body)
    return max(1, int(result.page_count or 1))


def fit_schema_to_template(
    schema: UnifiedResumeSchema,
    template_id: str,
    *,
    max_iterations: int = 12,
    measure: bool = True,
) -> TemplateFitResult:
    """
    Cap schema to template density, render, and iteratively trim until one page
    (or max_iterations). Does not invent content.
    """
    profile = get_density_profile(template_id)
    fitted, trims = apply_density_profile(schema, profile)

    # Sidebar layouts: if still huge after caps, switch to tighter profile once
    if profile.sidebar_heavy and (
        len(fitted.work) >= profile.max_work_roles
        and len(fitted.projects) >= profile.max_projects
        and (fitted.basics.summary or "")
        and len(fitted.basics.summary or "") > 240
    ):
        fitted, extra = apply_density_profile(fitted, _PROFILE_SIDEBAR_TIGHT)
        for t in extra:
            if t not in trims:
                trims.append(t)

    drop_cycle = list(profile.prefer_drop) or ["projects", "older_work", "highlights", "summary"]
    page_count = 1
    html_body = render_template_html(fitted, template_id)
    overflow_applied = False

    if not measure:
        return TemplateFitResult(
            html_body=html_body,
            schema_fitted=fitted,
            page_count=1,
            trims=trims,
            fit_ok=True,
        )

    page_count = _measure_page_count(html_body)
    if page_count <= 1:
        return TemplateFitResult(
            html_body=html_body,
            schema_fitted=fitted,
            page_count=page_count,
            trims=trims,
            fit_ok=True,
        )

    for i in range(max_iterations):
        step = drop_cycle[i % len(drop_cycle)]
        fitted, step_trims = _apply_drop_step(fitted, profile, step)
        if not step_trims:
            # Try next step kinds in this iteration
            progressed = False
            for alt in drop_cycle:
                if alt == step:
                    continue
                fitted, step_trims = _apply_drop_step(fitted, profile, alt)
                if step_trims:
                    progressed = True
                    break
            if not progressed and not overflow_applied:
                fitted, extra = apply_density_profile(fitted, _PROFILE_OVERFLOW)
                overflow_applied = True
                step_trims = [f"overflow_{t}" for t in extra] or ["overflow_caps"]
                progressed = True
            if not progressed:
                break
        trims.extend(step_trims)
        html_body = render_template_html(fitted, template_id)
        page_count = _measure_page_count(html_body)
        if page_count <= 1:
            return TemplateFitResult(
                html_body=html_body,
                schema_fitted=fitted,
                page_count=page_count,
                trims=trims,
                fit_ok=True,
            )

    return TemplateFitResult(
        html_body=html_body,
        schema_fitted=fitted,
        page_count=page_count,
        trims=trims,
        fit_ok=page_count <= 1,
    )
