# Partner Program Rollout

## Feature flag

- Enable/disable with `PARTNER_PROGRAM_ENABLED=true|false`.
- Disabled mode returns `404` for partner and admin-referral endpoints.

## Launch checklist

- Set `PARTNER_PROGRAM_ENABLED=true` in production.
- Confirm Stripe webhook receives `invoice.payment_succeeded`.
- Verify referral link opens `/api/r/{code}` and redirects to login with `ref`.
- Verify first successful paid invoice creates exactly one commission row.
- Verify trial-like and coupon invoices are skipped.
- Verify admin can review chains and update statuses (`approve/reject/hold/block`).

## Monitoring

- Track conversion funnel: referral click -> login/signup -> first paid invoice.
- Track anti-abuse counters: self-referral attempts, coupon-source rejects, high velocity flags.
- Track payout readiness: sum of approved/paid commissions and partners over $350 threshold.

## Manual payout process (MVP)

- Finance exports `approved` commissions from admin panel/API.
- Payouts are executed manually outside Stripe Connect.
- Mark paid rows with admin action to keep an audit trail.
