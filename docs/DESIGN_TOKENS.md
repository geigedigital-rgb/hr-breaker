# Design tokens (app-wide)

Tokens live in [`frontend/src/index.css`](../frontend/src/index.css). Plus Jakarta Sans is the app font (`body` + `.ds-sandbox` / `.ds-sandbox-shell`).

## Portable (use everywhere)

| Role | Class / token | Use |
|------|----------------|-----|
| Title | `.ds-title` | Section headings (tight tracking) |
| Subtitle | `.ds-subtitle` | Support under title |
| Body | `.ds-body` | Paragraphs |
| Label | `.ds-label` | Sentence-case secondary labels (not uppercase kits) |
| Hint | `.ds-hint` | Secondary help |
| Card | `.ds-card` / `--accent` / `--success` | Soft gradient surfaces |
| Card variants | `.ds-card--accent` / `.ds-card--success` | Tinted section cards |
| Chip | `.ds-chip` | Neutral pill tags |
| Soft pill | `.ds-soft-pill` + `--success\|accent\|warning\|danger\|muted` | Status only (impact, scores, Improved) — **not** section titles |
| Icon well | `.ds-icon-well` + tone | Gradient icon wells |
| Primary CTA | `.ds-btn-primary` | Blue gradient button |
| Progress | `.ds-progress-track` / `.ds-progress-fill` | Bars |

### Soft-pill rules

**Use for:** High/Medium impact, Your match score, Top %, Improved, N improvements applied, preview % / Strong match.

**Do not use for:** Recommendations, Overall match, Current/Potential match, Add photo, Choose template, ATS-friendly, boost % labels — plain text / `.ds-label`.

## Chrome (shells)

| Class | Role |
|-------|------|
| `.ds-sandbox-shell` | Root font/color for app/admin chrome |
| `.ds-sandbox-aside` | Light glass sidebar (user app: primary chrome; progress / notifications live here). Auto-compacts to icon rail on `/improve`, `/optimize`, `/vacancies`. |
| `.ds-sandbox-header` | Optional blurred top bar (admin tools; user app has no header) |
| `.ds-sandbox-main` | Page wash + padding |
| `.ds-page-stage` / `.ds-page-stage-body` | Short pages: vertically center content; tall pages stay top-aligned |
| `.ds-nav-item` / `.ds-nav-item-active` | Sidebar nav pills |

User [`Layout`](../frontend/src/Layout.tsx) and admin [`AdminLayout`](../frontend/src/AdminLayout.tsx) both use this chrome. Studio focus (hide sidebar) remains only on `/admin/visual` Result/Both via [`AdminSandboxShellContext`](../frontend/src/AdminSandboxShellContext.tsx). `PostResultResumeStudio` defaults to sandbox visual (`sandboxVariant=true`).

## Atmosphere

Soft radial washes (`--grad-page`) and light card gradients (`--grad-card`, `--grad-accent-soft`, `--grad-success-soft`) — blue/sky/mint, not purple AI-kit rainbows.

## Brand

- Accent: `--accent` `#4578FC`
- Page: `--bg-page` with `--grad-page` overlay on main content areas

## Smoke checklist

- User: login → home → optimize (analyze → improve → result → download) → history → upgrade
- Admin: dashboard → users → `/admin/visual`
