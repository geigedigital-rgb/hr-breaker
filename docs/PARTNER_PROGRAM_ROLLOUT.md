# Partner Program Rollout

## Feature flag

- Enable/disable with `PARTNER_PROGRAM_ENABLED=true|false`.
- Disabled mode returns `404` for partner and admin-referral endpoints.

## Launch checklist

- Set `PARTNER_PROGRAM_ENABLED=true` in production.
- Confirm Stripe webhook receives `invoice.payment_succeeded`.
- Verify referral link opens `/r/{code}` (short URL; legacy `/api/r/{code}` still works) and redirects to login with `ref`.
- After signup/login (password or Google), attribution uses `referral_code` from the JSON body **or**, if missing, from httpOnly cookies set by `/r/{code}`; cookies are cleared on successful JWT so old codes are not reused.
- Optional **invite signup** (internal link): set `PARTNER_INVITE_SIGNUP_TOKEN` to a long random secret; share `{FRONTEND_URL}/login?pvc_pi=<token>`. First-time registration (email/password or new Google user) with matching token gets `partner_program_access` without opening admin. Leave token empty to disable.
- Verify the first **post-trial** paid monthly subscription invoice creates exactly one commission row (not trialing / not $2.99-only trial checkout).
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
