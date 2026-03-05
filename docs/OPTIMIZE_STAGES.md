# Этапы улучшения резюме (от кнопки до PDF)

Полный путь от нажатия «Улучшить резюме» до выдачи PDF на экран.

## 1. Фронтенд

- Пользователь нажимает **«Улучшить резюме»** → вызывается `handleImprove()`.
- Отправляется **POST /api/optimize** с телом: `resume_content`, `job_url` или `job_text`, `parallel: true`.
- До ответа показывается экран «Улучшаем резюме…» с прогрессом (реальным по SSE или симулированным).

## 2. Бэкенд: `api_optimize` (api.py)

### 2.1 Парсинг вакансии (если передан URL)

- **Код:** `scrape_job_posting(url)` — синхронно в `asyncio.to_thread`.
- **Что происходит:** скачивание страницы (httpx → при необходимости wayback → при необходимости playwright), извлечение текста.
- **Время:** от секунд до десятков секунд при Cloudflare/JS.

### 2.2 Извлечение имени из резюме

- **Код:** `extract_name(req.resume_content)` — LLM (Gemini).
- **Что происходит:** агент `name_extractor` читает текст резюме и возвращает `first_name`, `last_name`.
- **Время:** несколько секунд.

### 2.3 Основной цикл: `optimize_for_job(source, job_text=..., max_iterations=..., parallel=...)`

Выполняется в **orchestration.py**.

#### 2.3.1 Парсинг текста вакансии (LLM)

- **Код:** `parse_job_posting(job_text)` в `optimize_for_job` (если `job` не передан).
- **Что происходит:** агент `job_parser` превращает сырой текст вакансии в структуру: title, company, requirements, keywords, description.
- **Время:** несколько секунд.

#### 2.3.2 Цикл итераций (до `max_iterations`, по умолчанию 5)

На каждой итерации:

1. **Генерация резюме (LLM)**  
   - **Код:** `optimize_resume(source, job, ctx)` — агент `optimizer`.  
   - **Что происходит:** Gemini генерирует HTML тела резюме под вакансию, с учётом предыдущей попытки и фидбека фильтров.  
   - **Время:** основная задержка (десятки секунд).

2. **Рендер PDF**  
   - **Код:** `_render_and_extract(optimized, renderer)` → `renderer.render(optimized.html)` (WeasyPrint).  
   - **Что происходит:** HTML → PDF, запись во временный файл.  
   - **Время:** 1–5 секунд.

3. **Извлечение текста из PDF**  
   - **Код:** `extract_text_from_pdf(pdf_path)`.  
   - **Что происходит:** для передачи текста фильтрам (как в ATS).  
   - **Время:** доли секунды.

4. **Запуск фильтров**  
   - **Код:** `run_filters(optimized, job, source, parallel=True)`.  
   - **Что происходит:**  
     - ContentLengthChecker, DataValidator, HallucinationChecker, KeywordMatcher, **LLMChecker** (ATS), VectorSimilarityMatcher, AIGeneratedChecker и др.  
     - При `parallel=True` все фильтры запускаются через `asyncio.gather`; часть из них снова вызывает LLM (LLMChecker, HallucinationChecker, AIGeneratedChecker и т.д.).  
   - **Время:** несколько секунд (параллельно), но с учётом LLM — может быть десятки секунд.

5. **Проверка результата**  
   - Если `validation.passed` — выход из цикла.  
   - Иначе следующая итерация с фидбеком (issues/suggestions) в контексте.

### 2.4 Сохранение PDF и формирование ответа

- **Код:** после `optimize_for_job`: `pdf_storage.generate_path(...)`, `write_bytes`, `save_record`, `base64.b64encode(pdf_bytes)`.
- **Что происходит:** запись PDF в `output/`, запись записи в индекс, кодирование PDF в base64 для ответа.
- **Время:** доли секунды.

### 2.5 Ответ клиенту

- **Код:** `return OptimizeResponse(success=..., pdf_base64=..., pdf_filename=..., validation=..., job=...)`.
- Фронтенд получает JSON, декодирует PDF, показывает «Готово» и кнопку «Скачать PDF».

---

## Почему процесс долгий

- **Несколько вызовов LLM:** парсинг вакансии, извлечение имени, генерация резюме на каждой итерации, плюс LLM-фильтры (LLMChecker, HallucinationChecker, AIGeneratedChecker). Каждый вызов — секунды.
- **Итерации:** до 5 попыток (генерация → рендер → фильтры); при неудаче — повтор с учётом замечаний.
- **Рендер PDF:** WeasyPrint стабильно занимает 1–5 секунд.

Ускорение: в `.env` поставить `MAX_ITERATIONS=2`, использовать быстрые модели (например `gemini-2.5-flash`), см. README.

---

## Реальный прогресс (SSE)

Чтобы показывать реальные проценты, бэкенд при запросе с `?stream=1` отдаёт поток Server-Sent Events:

- События вида `{"percent": 0, "message": "Парсинг вакансии…"}`, …, `{"percent": 100, "message": "Готово", "result": {...}}`.
- Проценты соответствуют завершению этапов: парсинг вакансии, извлечение имени, парсинг вакансии (LLM), итерация 1 (генерация → рендер → фильтры), итерация 2, …, сохранение PDF.

Фронтенд подписывается на поток и обновляет полоску и подпись по приходящим `percent` и `message`.
