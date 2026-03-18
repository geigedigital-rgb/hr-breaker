# План: партнёрка по флагу + аналитика для админа

## 1. Партнёрская программа (скрыта по умолчанию)

- В БД: колонка `users.partner_program_access` (default `false`).
- API `/partner/me`, `/partner/link` — только если глобально включено (`PARTNER_PROGRAM_ENABLED`) **и** у пользователя флаг.
- Админ: **Admin → Users** — чекбокс «Partner» → `PATCH /admin/users/{id}/partner-access`.
- В сайдбаре пункт «Пригласить друзей» только при `partner_program_access`.
- Роут `/partner` редирект на `/`, если флага нет.

## 2. Аналитика (usage audit)

- Таблица `usage_audit_log`: пользователь, действие, модель, успех, текст ошибки, input/output tokens, metadata, время.
- Логируется: **analyze** (job_parse, ats_score, breakdown), **optimize** (extract_name, job_parse в цикле, optimize_generate по итерациям, ошибки scrape/pipeline, optimize_complete).
- Админ: **Admin → Usage** — таблица событий (email, action, model, tokens, OK/ошибка).

## 3. Деплой

После пуша миграции выполняются при старте API (`ensure_schema`). Убедиться, что `DATABASE_URL` задан на проде.
