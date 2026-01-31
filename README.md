# HR-Breaker

Resume optimization tool that transforms any resume into a job-specific, ATS-friendly PDF.

![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)

## Features

- **Any format in** - LaTeX, plain text, markdown, HTML, PDF
- **Optimized PDF out** - Single-page, professionally formatted
- **LLM-powered optimization** - Tailors content to job requirements
- **Minimal changes** - Preserves your content, only restructures for fit
- **No fabrication** - Hallucination detection prevents made-up claims
- **Opinionated formatting** - Follows proven resume guidelines (one page, no fluff, etc.)
- **Multi-filter validation** - ATS simulation, keyword matching, structure checks
- **Web UI + CLI** - Streamlit dashboard or command-line
- **Debug mode** - Inspect optimization iterations

## How It Works

1. Upload resume in any text format (content source only)
2. Provide job posting URL or text description
3. LLM extracts content and generates optimized HTML resume
4. System runs internal filters (ATS simulation, keyword matching, hallucination detection)
5. If filters reject, regenerates using feedback
6. When all checks pass, renders HTML→PDF via WeasyPrint

## Quick Start

```bash
# Install
uv sync

# Configure — API key for AI (Gemini)
cp .env.example .env
# Open .env and replace your-api-key-here with your real key:
#   GOOGLE_API_KEY=AIza...your-key-from-Google-AI-Studio

# Run web UI (Streamlit)
uv run streamlit run src/hr_breaker/main.py

# Or run React UI (API + frontend)
uv run hr-breaker-api          # Backend on http://127.0.0.1:8000
cd frontend && npm install && npm run dev   # Frontend on http://localhost:5173
```

## Usage

### Web UI (React + Headless UI)

1. Start API: `uv run hr-breaker-api` (port 8000)  
   Или с автоперезагрузкой при изменении кода (следит только за `src`):
   ```bash
   uvicorn hr_breaker.api:app --reload --port 8000 --reload-dir src
   ```
2. Start frontend: `cd frontend && npm run dev` (port 5173)
3. Open http://localhost:5173 — Оптимизация, История, Настройки. Цвета: #F9F9F9, #2E9FFF, #FFFFFF.

### Web UI (Streamlit)

Launch with `uv run streamlit run src/hr_breaker/main.py`

1. Paste or upload resume
2. Enter job URL or description
3. Click optimize
4. Download PDF

### CLI

```bash
# From URL
uv run hr-breaker optimize resume.txt https://example.com/job

# From job description file
uv run hr-breaker optimize resume.txt job.txt

# Debug mode (saves iterations)
uv run hr-breaker optimize resume.txt job.txt -d

# List generated PDFs
uv run hr-breaker list
```

## Output

- Final PDFs: `output/<name>_<company>_<role>.pdf`
- Debug iterations: `output/debug_<company>_<role>/`
- Records: `output/index.json`

## Configuration

**Где вписать API-ключ (GOOGLE_API_KEY):**

1. В корне проекта создайте файл `.env` (или скопируйте: `cp .env.example .env`).
2. Откройте `.env` и пропишите ключ в одну строку:
   ```bash
   GOOGLE_API_KEY=AIza...ваш-ключ-из-Google-AI-Studio
   ```
3. Перезапустите бэкенд (API). Файл `.env` не коммитится в git.

Ключ берётся в [Google AI Studio](https://aistudio.google.com/apikey). Остальные переменные опциональны.

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_API_KEY` | Yes | Google Gemini API key |
| `GEMINI_PRO_MODEL` | No | Model for complex tasks (default: `gemini-3-pro-preview`) |
| `GEMINI_FLASH_MODEL` | No | Model for simple tasks (default: `gemini-3-flash-preview`) |
| `GEMINI_THINKING_BUDGET` | No | Thinking tokens budget (default: 8192) |
| `MAX_ITERATIONS` | No | Optimization loop limit (default: 5) |

See `.env.example` for all available options (filter thresholds, scraper settings, etc.)

---

## Architecture

```
src/hr_breaker/
├── agents/          # Pydantic-AI agents (optimizer, reviewer, etc.)
├── filters/         # Validation plugins (ATS, keywords, hallucination)
├── services/        # Rendering, scraping, caching
│   └── scrapers/    # Job scraper implementations
├── models/          # Pydantic data models
├── orchestration.py # Core optimization loop
├── main.py          # Streamlit UI
└── cli.py           # Click CLI
```

**Agents**: job_parser, optimizer, combined_reviewer, name_extractor, hallucination_detector, ai_generated_detector

**Filters** (run by priority):
0. ContentLengthChecker - Pre-render size check
1. DataValidator - HTML structure validation
3. HallucinationChecker - Detect fabrications
4. KeywordMatcher - TF-IDF matching
5. LLMChecker - ATS simulation
6. VectorSimilarityMatcher - Semantic similarity
7. AIGeneratedChecker - Detect AI-sounding text

## Deployment

### Docker

```bash
docker build -t hr-breaker .
docker run -p 8501:8501 -e GOOGLE_API_KEY=your-key hr-breaker
```

- **Порты**: приложение слушает `PORT` (по умолчанию 8501). Платформы вроде Heroku/Cloud Run задают `PORT` сами.
- **Данные**: `output/` и `.cache/` создаются в рабочей директории контейнера. Для сохранения PDF и кэша резюме смонтируйте том, например:  
  `-v $(pwd)/output:/app/output -v $(pwd)/.cache:/app/.cache`

### Переменные окружения в продакшене

Обязательно задайте `GOOGLE_API_KEY`. Остальное опционально (см. `.env.example`).

## Development

```bash
# Run tests
uv run pytest tests/

# Install dev dependencies
uv sync --group dev
```
