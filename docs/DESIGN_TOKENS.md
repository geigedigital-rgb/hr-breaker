# Design tokens (Visual Sandbox first)

Tokens live in [`frontend/src/index.css`](../frontend/src/index.css). Visual Sandbox wraps UI in `.ds-sandbox` (font). On `/admin/visual`, [`AdminLayout`](../frontend/src/AdminLayout.tsx) also applies chrome classes.

## Atmosphere

Soft radial washes (`--grad-page`) and light card gradients (`--grad-card`, `--grad-accent-soft`, `--grad-success-soft`) — blue/sky/mint, not purple AI-kit rainbows. Progress fills and primary CTA use short linear gradients.

## Chrome (sandbox route only)

| Class | Role |
|-------|------|
| `.ds-sandbox-shell` | Root font/color for admin chrome |
| `.ds-sandbox-aside` | Light glass sidebar |
| `.ds-sandbox-header` | Blurred header bar |
| `.ds-sandbox-main` | Page wash + wider padding |
| `.ds-nav-item` / `.ds-nav-item-active` | Sidebar nav pills |

**Focus mode:** when Result / Both is selected, sidebar hides; header shows **Menu** to reopen. Assessment keeps the sandbox sidebar visible.

## Hierarchy

| Role | Class / token | Use |
|------|----------------|-----|
| Title | `.ds-title` | Section headings (tight tracking) |
| Subtitle | `.ds-subtitle` | Support under title |
| Body | `.ds-body` | Paragraphs |
| Label | `.ds-label` | Sentence-case secondary labels (not uppercase kits) |
| Hint | `.ds-hint` | Secondary help |

## Surfaces

- `.ds-card` / `.ds-card--accent` / `.ds-card--success` — soft gradient fills
- `.ds-icon-well` + `--accent|success|warning|danger` — gradient icon wells
- `.ds-chip` — pill tags with light blur
- `.ds-btn-primary` — blue gradient CTA
- `.ds-progress-*` — gradient fills

## Brand

- Accent: `--accent` `#4578FC`
- Soft accent: light blue tint + sky wash
- Page: `--bg-page` with `--grad-page` overlay

## Scope

Applied first to Admin → Visual Sandbox (page + chrome). Soft pills: `.ds-soft-pill` (+ `--success|accent|warning|danger|muted`) — no gradient text. Other admin routes keep the classic blue sidebar. Reuse the same classes elsewhere when restyling other screens.
