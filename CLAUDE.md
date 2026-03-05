# CLAUDE.md

# HR-Breaker

Tool for optimizing resumes for job postings and passing automated filters.

## How it works

1. User uploads resume in ANY text format (LaTeX, plain text, markdown, HTML) - content source only
2. User provides job posting URL or text description
3. LLM extracts content from resume and generates NEW HTML resume that:
   - Maximally fits the job posting
   - Follows guidelines: one-page PDF, no misinformation, etc.
4. System runs internal filters (LLM-based ATS simulation, keyword matching, hallucination detection, etc.)
5. If filters reject, repeat from step 3 using feedback
6. When all checks pass, render HTML→PDF via WeasyPrint and return

## Architecture

1. Streamlit frontend
2. Pydantic-AI LLM agent framework
3. Google Gemini models (configurable via env)
4. Modular filter system - easy to add new checks
5. Resume caching - input once, apply to many jobs

Python: 3.10+
Package manager: uv
Always use venv: `source .venv/bin/activate`
Unit-tests: pytest
HTTP library: httpx

Pydantic-AI docs: https://ai.pydantic.dev/llms-full.txt

## Guidelines

When debugging use 1-2 iterations only (costs money). Use these settings:
```
GEMINI_THINKING_BUDGET=1024
GEMINI_PRO_MODEL=gemini-2.5-flash
GEMINI_FLASH_MODEL=gemini-2.5-flash
```

### Почему этап «Генерация резюме (LLM)» долгий и как ускорить

**Почему долго:** Один вызов LLM (модель `GEMINI_PRO_MODEL`, по умолчанию тяжёлая) генерирует весь HTML резюме за один раз. Прогресс в UI обновляется только до и после этого вызова, поэтому процент «зависает» на 20–30% на всё время ответа модели (30 сек – 2+ мин). У оптимизатора есть инструменты (tools): проверка длины через полный рендер PDF, превью (PDF→картинка), проверка ключевых слов — если модель их вызывает, каждый вызов добавляет задержку (особенно рендер WeasyPrint).

**Варианты ускорения:**

1. **Быстрая модель для генерации** (самый простой эффект):
   - В `.env`: `GEMINI_PRO_MODEL=gemini-2.5-flash` (или `gemini-2.0-flash`). Flash отвечает в разы быстрее Pro, качество для резюме часто достаточное.

2. **Уменьшить thinking budget** (если используется модель с «думанием»):
   - В `.env`: `GEMINI_THINKING_BUDGET=1024` или `0` — меньше «внутренних» токенов, быстрее ответ.

3. **Меньше итераций**:
   - В `.env`: `MAX_ITERATIONS=1` или `2` — меньше повторных прогонов LLM при провале фильтров.

4. **Один проход без лишних проверок**:
   - Сейчас оптимизатор может вызывать инструменты (рендер PDF для проверки длины/превью). Ускорение: в коде отключить или упростить тяжёлые tools (например, не делать полный рендер внутри агента, а только оценку по длине текста).

5. **Прогресс не «зависает»**:
   - Во время одного долгого вызова LLM бэкенд может периодически слать тот же процент (heartbeat), чтобы UI показывал, что процесс жив (см. orchestration).

## Current Implementation

### Structure
```
src/hr_breaker/
├── models/          # Pydantic data models
├── agents/          # Pydantic-AI agents
├── filters/         # Plugin-based filter system
├── services/        # Rendering, scraping, caching
│   └── scrapers/    # Job scraper implementations
├── utils/           # Helpers
├── orchestration.py # Core optimization loop
├── main.py          # Streamlit UI
├── cli.py           # Click CLI
└── config.py        # Settings
```

### Agents
- `job_parser` - Parse job posting → title, company, requirements, keywords
- `optimizer` - Generate optimized HTML resume from source + job
- `combined_reviewer` - Vision + ATS screening in single LLM call
- `name_extractor` - Extract name from any resume format
- `hallucination_detector` - Detect fabricated content
- `ai_generated_detector` - Detect AI-generated content indicators

### Filter System
Filters run by priority (lower first). Default: parallel execution. Use `--seq` for early exit on failure.

| Priority | Filter | Purpose |
|----------|--------|---------|
| 0 | ContentLengthChecker | Pre-render size check (≤1 page) |
| 1 | DataValidator | Validate HTML structure |
| 3 | HallucinationChecker | Detect fabrications |
| 4 | KeywordMatcher | TF-IDF keyword matching |
| 5 | LLMChecker | Combined vision + ATS simulation |
| 6 | VectorSimilarityMatcher | Sentence-transformer similarity |
| 7 | AIGeneratedChecker | AI content detection |

To add filter: subclass `BaseFilter`, set `name` and `priority`, use `@FilterRegistry.register`

### Services
- `renderer.py` - HTMLRenderer (WeasyPrint)
- `job_scraper.py` - Scrape job URLs (httpx → Wayback → Playwright fallback)
- **Protected sites (e.g. StepStone):** (1) Playwright uses viewport 1920×1080, locale, and optional [playwright-stealth](https://pypi.org/project/playwright-stealth/) to reduce bot detection. Install with `uv pip install 'hr-breaker[stealth]'`. Env: `SCRAPER_USE_STEALTH=true`, `SCRAPER_PLAYWRIGHT_LOCALE=de-DE`. (2) **Apify:** optional paid StepStone scrapers (e.g. [fatihtahta/stepstone-scraper-fast-reliable-4-1k](https://apify.com/fatihtahta/stepstone-scraper-fast-reliable-4-1k)). Set `APIFY_TOKEN`, `SCRAPER_USE_APIFY=true`, install `uv pip install 'hr-breaker[apify]'`. Apify is tried after wayback, before Playwright, only when URL domain is in `SCRAPER_APIFY_DOMAINS`.
- `pdf_parser.py` - Extract text from PDF
- `cache.py` - Resume caching
- `pdf_storage.py` - Save/list generated PDFs; optional Postgres (Neon) via `DATABASE_URL` and `uv pip install 'hr-breaker[db]'` — API then uses DB for history instead of index.json; PDF/source files stay on disk.
- `services/db.py` - asyncpg pool, table `generated_resumes`, insert/list/delete (used when DATABASE_URL set).
- `length_estimator.py` - Content length estimation for resume sizing

### Commands
```bash
# Web UI
uv run streamlit run src/hr_breaker/main.py

# CLI
uv run hr-breaker optimize resume.txt https://example.com/job
uv run hr-breaker optimize resume.txt job.txt -d              # debug mode
uv run hr-breaker optimize resume.txt job.txt --seq           # sequential filters (early exit)
uv run hr-breaker list                                        # list generated PDFs

# Tests
uv run pytest tests/
```

### Output
- Final PDFs: `output/<name>_<company>_<role>.pdf`
- Debug iterations: `output/debug_<company>_<role>/` (with -d flag)
- Records: `output/index.json`

### Resume Rendering
- LLM generates HTML body → WeasyPrint renders to PDF
- Templates in `templates/` (resume_wrapper.html, resume_guide.md)
- Name extraction uses LLM - handles any input format
