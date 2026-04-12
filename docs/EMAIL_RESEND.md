# Почта: Resend + PitchCV (как устроено и что настроить)

Документ описывает **рекомендуемую схему**: визуал и правки макета — в **Resend Templates**, логика «кому и когда» — в **PitchCV** (Postgres + API + админка).

## Роли систем

| Что | Где |
|-----|-----|
| Домен, DNS, репутация отправителя | [Resend](https://resend.com) → Domains |
| HTML письма (продакшен) | **Вариант A:** шаблон в Resend (опубликованный) **или Вариант B:** готовый HTML из репозитория (`src/hr_breaker/email_templates/`) |
| Переменные (ссылки на сайт, картинки) | Передаёт **бэкенд** при вызове API Resend |
| Очередь «через N минут после оптимизации» | **PitchCV**: таблица `email_winback_schedule`, настройки `admin_email_settings` |
| Ручная рассылка по сегменту | **PitchCV**: админка **Email → Automation & send** |
| Фактическая доставка письма | **Resend** `POST https://api.resend.com/emails` (из кода через `httpx`) |

**Resend не знает** про оптимизации и подписки. Он только принимает запрос «отправь это письмо». Вся автоматизация по событиям — у вас в приложении; по желанию позже можно дублировать кампании в Resend Broadcasts, но это отдельный процесс.

---

## Шаг 1. Аккаунт Resend

1. Зайти на [https://resend.com](https://resend.com), создать проект.
2. **Domains** — добавить домен (например `pitchcv.app`), прописать DNS-записи, дождаться статуса Verified.
3. **API Keys** — создать ключ `re_...` с правом отправки.

---

## Шаг 2. Переменные окружения (сервер API)

В `.env` на сервере, где запущен FastAPI:

```env
RESEND_API_KEY=re_...
RESEND_FROM=PitchCV <hello@ваш-домен.com>
RESEND_WINBACK_SUBJECT=Your resume is ready

# Публичный URL фронта (OAuth, ссылки в приложении)
FRONTEND_URL=https://www.pitchcv.app

# Письма: HTTPS-оригин, с которого в письме строятся URL картинок (/logo-color.svg, /email/hero-winback.svg)
# и ссылки upgrade/settings. Для PitchCV обычно приложение на поддомене приложения:
EMAIL_PUBLIC_BASE_URL=https://my.pitchcv.app
```

Если `EMAIL_PUBLIC_BASE_URL` не задан, используется `FRONTEND_URL` (старое поведение).

**Id опубликованных шаблонов Resend** (рекомендуется): задавайте в админке **Email → Automation & send** — поля сохраняются в Postgres (`admin_email_settings`), **не нужно** пихать каждый id в Railway.

Опционально в `.env` / Railway — **fallback**, если поле в БД пусто (удобно для локалки без админки):

```env
RESEND_TEMPLATE_REMINDER_NO_DOWNLOAD=
RESEND_TEMPLATE_SHORT_NUDGE=
```

После правок `.env` **перезапустить** процесс API.

---

## Шаг 3 (рекомендуется). Шаблон в Resend Dashboard

Так вы держите **канонический макет** в Resend, а админка в приложении остаётся для **превью/копирования HTML** под тот же дизайн.

### 3.1 Создать шаблон

1. Resend → **Templates** → Create.
2. Сверстать письмо. Вместо жёстких URL вставить **переменные** с именами **ровно** такими (ограничения Resend: только `A–Z`, `0–9`, `_`, до 50 символов; зарезервированы `FIRST_NAME`, `LAST_NAME`, `EMAIL`, `UNSUBSCRIBE_URL` — их для своих полей не используйте):

| Переменная в шаблоне | Что подставит бэкенд |
|----------------------|----------------------|
| `LOGO_URL` | база из `EMAIL_PUBLIC_BASE_URL` (или `FRONTEND_URL`) + `/logo-color.svg` |
| `HERO_IMAGE_URL` | та же база + `/email/hero-winback.svg` |
| `DOWNLOAD_URL` | та же база + `/upgrade` |
| `SETTINGS_URL` | та же база + `/settings` (настройки аккаунта) |
| `UNSUBSCRIBE_LINK` | **Одноразовая ссылка отписки** для этого получателя: `GET {база}/api/email/unsubscribe?token=<JWT>` (JWT год, `purpose=email_unsub`). В Resend **нельзя** завести свою переменную с именем `UNSUBSCRIBE_URL` — оно зарезервировано у них; используйте **`UNSUBSCRIBE_LINK`**. |

База в коде: `public_base_for_email()` в `email_winback.py` — для PitchCV задайте `EMAIL_PUBLIC_BASE_URL=https://my.pitchcv.app`, чтобы ссылки в письме (в т.ч. отписка и картинки) вели на тот же хост, где доступен `/api` ([my.pitchcv.app](https://my.pitchcv.app/)).

### Отписка из письма (inline HTML)

В шаблоне из репозитория плейсхолдер **`{{unsubscribe_url}}`**: при отправке бэкенд подставляет полный URL с подписанным токеном. Ничего вручную в Resend для этого тега вводить не нужно.

После перехода по ссылке API выставляет `marketing_emails_opt_in = false` и редиректит на страницу **`/email/unsubscribed?ok=1`** (фронт).

В редакторе Resend переменные обычно пишутся как `{{LOGO_URL}}` — ориентируйтесь на их UI.

3. **Publish** шаблон. Скопировать **Template ID** или **alias** из интерфейса.

### 3.2 Привязать к приложению

1. **Прод:** админка **Email → Automation & send** — два поля «Resend template id» (win-back и short nudge). Сохраняется в БД, редеплой не нужен.

2. **Либо** в `.env` / Railway (если поле в БД пустое — подставится env; иначе приоритет у значения из БД):

```env
RESEND_TEMPLATE_REMINDER_NO_DOWNLOAD=ваш_id_или_alias
RESEND_TEMPLATE_SHORT_NUDGE=другой_id
```

Если **и** в БД, **и** в env пусто, для этого типа письма бэкенд шлёт **inline HTML** из `src/hr_breaker/email_templates/reminder_no_download.html` или `short_nudge.html` — удобно для dev без шаблона в Resend.

---

## Шаг 4. Админка PitchCV

Путь: **Email → Automation & send** (`/admin/email/send`).

1. Зелёная плашка = заданы `RESEND_API_KEY` и `RESEND_FROM`.
2. Дополнительно в интерфейсе отображается, заданы ли **Resend template id** для win-back и для nudge (флаги с API).
3. **Автоматическая очередь**: включить автоматизацию, выставить min/max минут задержки → после успешной оптимизации у неплатного пользователя создаётся запись в очереди.
4. **Обработка очереди**: Resend **не** опрашивает сам. Нужно по расписанию вызывать  
   `POST /api/admin/email/queue/process?limit=25`  
   с заголовком `Authorization: Bearer <JWT админа>`  
   (кнопка в админке или cron на Railway / GitHub Actions и т.д.).
5. **Ручная рассылка**: сегмент, дни, лимит, шаблон → Preview → при необходимости снять «Dry run» и отправить.

---

## Шаг 5. Превью в приложении vs Resend

- **Admin → Email → Templates** — локальный HTML для **визуального совпадения** с макетом; можно копировать в Resend при создании шаблона.
- **Источник правды для продакшена** при включённых `RESEND_TEMPLATE_*` — **опубликованный шаблон в Resend**. Имеет смысл после правок в Resend при желании обновить демо в репо, чтобы превью не расходилось с продом.

---

## Ошибки и проверка

- **422 / validation** от Resend — чаще всего в шаблоне есть переменная, которую бэкенд не передал, или имя не совпадает с таблицей выше.
- **403 / domain** — `RESEND_FROM` не с верифицированного домена.
- Логи API — исключения при отправке пишутся в лог; строки очереди со статусом `failed` содержат `error_message`.

---

## Краткая шпаргалка

1. Resend: домен, ключ, шаблон(ы), publish.  
2. `.env` / Railway: секреты `RESEND_API_KEY`, `RESEND_FROM`, плюс `FRONTEND_URL`, `EMAIL_PUBLIC_BASE_URL`, `JWT_SECRET`, `DATABASE_URL`. Id шаблонов — в админке (БД), не обязательно в Railway.  
3. Перезапуск API после смены env.  
4. Админка: вписать id шаблонов Resend, включить авто при необходимости, cron на `queue/process`.  
5. Прод: макет — в Resend; сценарии «после оптимизации / сегмент» — в PitchCV.
