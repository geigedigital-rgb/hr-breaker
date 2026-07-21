# Prompts, agents, and product userflow

Single-pass product policy: **one optimizer LLM generation** (`max_iterations=1`). No filter-feedback rewrite loop (unlike upstream [btseytlin/hr-breaker](https://github.com/btseytlin/hr-breaker)).

## Official match metrics (before / after)

Same methodology for analyze and post-optimize:

| Metric | Source | Scale |
|--------|--------|-------|
| ATS | `score_resume_vs_job` (LLM) | 0–100 |
| Keywords | TF-IDF `check_keywords` | 0–1 → % |
| Overall | average of ATS% and Keywords% | 0–100 |
| Improvement | `post − pre` (percentage points) | signed |

`LLMChecker` / other filters validate the PDF; they are **not** the primary UI match dial.

## When each LLM prompt runs

| When | Agent (file) | Condition |
|------|----------------|-----------|
| Analyze | `job_parser` | Job URL/text (skipped in improve mode → synthetic job) |
| Analyze | `resume_scorer` | Always — pre ATS |
| Analyze | insights (`resume_scorer.INSIGHTS_*`) | Always — risk / tips |
| Optimize start | `name_extractor` | Start of optimize |
| Optimize | `optimizer` | **Exactly one** generation pass |
| Filters | `hallucination_detector` | After render |
| Filters | `combined_reviewer` | Vision + ATS filter (not UI dial) |
| Filters | `ai_generated_detector` | After render (skipped in improve mode for some job filters) |
| Post | `resume_scorer` again | Post ATS for response / history |
| Templates | `resume_schema_extractor` (+ verifier) | After optimize — `schema_json` for template PDF |

Refinement wording in `optimizer.py` (last attempt + filter feedback) exists for legacy multi-iter but is **unreachable** when `max_iterations=1`.

### Optimizer tool budget (one pass)

- `check_content_length` — required; may retry until one page
- `check_keywords_tool` — at most **2** calls
- `preview_resume` — avoid (costly); optional only if layout is doubtful
- `validate_structure` — optional after major structure changes

### Section-aware keywords

Place source-backed terms in the matching section only:

- **Skills** — skills / stack
- **Experience / Projects** — tools and domain terms in bullets with evidence
- **Education / Certifications** — degrees, courses, certs
- Never dump vacancy keywords into Skills as a bare list

## Product userflow (React)

```text
RequireAuth → upload → (Improve | Tailor)
  → scanning POST /api/analyze
  → assessment (preScores)
  → loading POST /api/optimize/stream  (max_iterations=1)
  → result (schema_json + PostResultResumeStudio)
  → template pick AFTER optimize
  → download:
       paid/trial/admin → POST /api/templates/render-pdf
       free → /checkout/download-resume → Stripe → same template render-pdf
```

### Gates

| Action | Free (under quota) | Free (quota used) | Trial / monthly | Admin |
|--------|--------------------|-------------------|-----------------|-------|
| Analyze | ≤10 / month | 402 + upsell | OK | OK |
| Optimize | ≤10 / month; PDF not in history | 402 + upsell | PDF + history | OK |
| Download PDF | Checkout required | Checkout | Template PDF | Template PDF |

### Download path (product decision)

Canonical download is **always** `POST /api/templates/render-pdf` from `schema_json` (+ optional photo).

`pending_export_token` is still issued for free users so checkout can gate the flow; the WeasyPrint hold file is **not** redeemed by the UI (legacy API `GET /api/optimize/pending-export/{token}` remains for admin/debug). After payment, UI re-renders the chosen template.

Fallback if `schema_json` is missing and the user is paid: download `pdf_base64` from the optimize response when present.
