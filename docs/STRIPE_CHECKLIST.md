# Stripe — чеклист настройки

## Секреты в Replit (или .env)

| Переменная | Описание |
|------------|----------|
| `STRIPE_SECRET_KEY` | Секретный ключ (Dashboard → API keys) |
| `STRIPE_WEBHOOK_SECRET` | Подпись вебхука (после создания endpoint в Webhooks) |
| `STRIPE_PRICE_MONTHLY_ID` | ID **рекуррентной** цены (например $29/мес) — тип **Recurring** |
| `STRIPE_PRICE_TRIAL_ID` | ID **разовой** цены триала (например $2.99) — тип **One-off / One time**, не Recurring |
| `STRIPE_PUBLISHABLE_KEY` | По желанию, для фронта |

**Trial:** Checkout создаёт подписку на `STRIPE_PRICE_MONTHLY_ID` с `trial_period_days: 7` и добавляет на первый инвойс разовый прайс из `STRIPE_PRICE_TRIAL_ID` (чтобы «к оплате сегодня» было $2.99).

**Важно:** у **месячного** и **триалового** прайса в Stripe должна быть **одна и та же валюта** (оба USD или оба EUR). Иначе Stripe вернёт ошибку при создании сессии.

**Продакшен:** переменные в Railway / хостинге должны совпадать с теми же `price_...`, что в **Live mode** в Dashboard (не перепутать test/live ключи и ID цен).

## Webhook в Stripe Dashboard

1. **Developers → Webhooks → Add endpoint**
2. **URL:** `https://<ваш-хост>/api/payments/webhook`  
   Пример для Replit: `https://your-app.replit.app/api/payments/webhook`
3. **События:**
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. После сохранения скопировать **Signing secret** (whsec_...) в `STRIPE_WEBHOOK_SECRET`.

## Проверка

- В приложении: **Upgrade** → выбор Trial или Monthly → редирект на Stripe Checkout.
- После оплаты: редирект на `/upgrade?success=1`, в **Settings** и в сайдбаре отображается подписка.
- В Stripe Dashboard: **Webhooks** → вызовы endpoint должны возвращать **200**. При **400** смотреть логи (часто неверный `STRIPE_WEBHOOK_SECRET` или неверный URL).

## Типичные ошибки

- **503 Stripe not configured** — не задан `STRIPE_SECRET_KEY` или `STRIPE_PRICE_MONTHLY_ID`.
- **400 с текстом про currency mismatch** — пересоздайте разовый прайс триала в той же валюте, что и месячная подписка.
- **400 про one_time / recurring** — `STRIPE_PRICE_TRIAL_ID` должен быть **One time**, `STRIPE_PRICE_MONTHLY_ID` — **Recurring**.
- Ошибка при оплате только у клиентов, у вас локально ок — на сервере часто нет `STRIPE_PRICE_TRIAL_ID` или стоят **test** ID при **live** ключе (или наоборот).
- **400 Invalid signature** — неверный `STRIPE_WEBHOOK_SECRET` или webhook вызывается не с того endpoint (другой URL в Dashboard).
- Подписка не обновляется после оплаты — проверить, что webhook URL доступен из интернета и что в логах бэкенда нет 503 (нет БД) при вызове webhook.
