# Stripe — чеклист настройки

## Секреты в Replit (или .env)

| Переменная | Описание |
|------------|----------|
| `STRIPE_SECRET_KEY` | Секретный ключ (Dashboard → API keys) |
| `STRIPE_WEBHOOK_SECRET` | Подпись вебхука (после создания endpoint в Webhooks) |
| `STRIPE_PRICE_MONTHLY_ID` | ID цены $29/мес (Products → ваш продукт → Price → ID вида `price_...`) |
| `STRIPE_PUBLISHABLE_KEY` | По желанию, для фронта |

**Trial и Monthly** используют одну и ту же цену (`STRIPE_PRICE_MONTHLY_ID`). Trial = подписка с `trial_period_days: 7` + при успешном checkout списывается $2.99.

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
- **400 Invalid signature** — неверный `STRIPE_WEBHOOK_SECRET` или webhook вызывается не с того endpoint (другой URL в Dashboard).
- Подписка не обновляется после оплаты — проверить, что webhook URL доступен из интернета и что в логах бэкенда нет 503 (нет БД) при вызове webhook.
