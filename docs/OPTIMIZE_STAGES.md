# Этапы улучшения резюме (от кнопки до PDF)

Полный путь от нажатия «Улучшить резюме» до выдачи PDF. Подробнее про промпты и метрики: [PROMPTS_AND_FLOW.md](PROMPTS_AND_FLOW.md).

## 1. Фронтенд

Стадии в `Optimize.tsx`: `landing` → `idle` → `scanning` → `assessment` → `loading` → `result`.

1. **Анализ:** `POST /api/analyze` → `preScores` (ATS + keywords).
2. **Улучшение:** `handleImprove()` → **`POST /api/optimize/stream`** (fallback `POST /api/optimize`) с `max_iterations: 1`, `pre_ats_score` / `pre_keyword_score`.
3. **Результат:** шаблоны (`PostResultResumeStudio`), скачивание через `POST /api/templates/render-pdf` (после оплаты для free).

## 2. Бэкенд: `_run_optimize` (api.py)

### 2.1 Парсинг вакансии (если URL)

`scrape_job_posting` — httpx → wayback → Playwright. Improve mode: без вакансии.

### 2.2 Имя

`extract_name` (LLM Flash).

### 2.3 Один проход: `optimize_for_job(..., max_iterations=1)`

В `orchestration.py` **всегда одна итерация** (продуктовая политика; env `MAX_ITERATIONS` игнорируется).

1. **Генерация HTML** — `optimize_resume` (один вызов Pro LLM + tools: length, keywords ≤2).
2. **Рендер PDF** — WeasyPrint; текст для фильтров.
3. **Фильтры** — parallel по умолчанию (ContentLength, DataValidator, Hallucination, KeywordMatcher, LLMChecker, Vector, AIGenerated). **Повторной генерации при fail нет.**
4. **Post scores** — `score_resume_vs_job` + KeywordMatcher → поля `post_*` в `OptimizeResponse`.
5. **Schema** — `extract_resume_schema_strict` → `schema_json` для шаблонов.

### 2.4 PDF и ответ

- **Paid / trial / admin:** PDF в history + `pdf_base64`.
- **Free:** PDF удерживается (`pending_export_token` для checkout); UI после оплаты качает **template PDF**, не redeem WeasyPrint.
- Ответ: `OptimizeResponse` с `pre_*` / `post_*` / `improvement_*_pp`, `schema_json`, `validation`, `key_changes`.

## 3. Шаблон и оплата

Шаблон выбирается **после** optimize. Download:

- paid → `POST /templates/render-pdf`
- free → `/checkout/download-resume` → Stripe → template render-pdf

## Почему процесс долгий

Один длинный вызов optimizer + параллельные LLM-фильтры + schema extract. Ускорение: Flash-модели, `GEMINI_THINKING_BUDGET=1024`. Итераций больше одной **нет**.

## Прогресс (SSE)

`POST /api/optimize/stream` — события `percent` / `message`, финал с `result`.
