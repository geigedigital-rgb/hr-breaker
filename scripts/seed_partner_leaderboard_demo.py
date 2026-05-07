#!/usr/bin/env python3
"""
Insert 34 demo partner users + paid referral_commissions so Top partners is not empty.

Emails live under @lb-demo.seed.pitchcv.invalid — safe to purge with --force.
After insert, commission created_at is set to NOW() so month-scoped leaderboards still show rows.

Usage (repo root, venv):
  uv run python scripts/seed_partner_leaderboard_demo.py
  uv run python scripts/seed_partner_leaderboard_demo.py --force   # remove prior seed, re-insert
  uv run python scripts/seed_partner_leaderboard_demo.py --refresh-dates  # bump seed commission dates only

Requires DATABASE_URL (see .env).
"""
from __future__ import annotations

import argparse
import asyncio
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_SRC = ROOT / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

from hr_breaker.services.db import (
    REFERRAL_COMMISSIONS_TABLE,
    USERS_TABLE,
    get_pool,
    referral_create_commission,
    user_create,
    user_set_partner_program_access,
)


SEED_EMAIL_DOMAIN = "lb-demo.seed.pitchcv.invalid"
SEED_REASON = "leaderboard_demo_seed"
PARTNER_EMAIL = "lb.demo.partner.{i:02d}@" + SEED_EMAIL_DOMAIN
INVITED_EMAIL = "lb.demo.invited.{i:02d}@" + SEED_EMAIL_DOMAIN

# Paid-out column = sum(commissions where status=paid). Top 3 payouts (USD → cents).
PAID_TOP_1_CENTS = 586_380  # $5863.80
PAID_TOP_2_CENTS = 579_290  # slightly below #1
PAID_TOP_3_CENTS = 329_000  # $3290.00 (mrfox880)

# Remaining partners: one paid commission each, between $350 and $1370.
PAID_REST_MIN_CENTS = 35_000
PAID_REST_MAX_CENTS = 137_000

# Last partners in leaderboard sort: $0 paid this period, booked-only (approved/hold) $78–$268.
TAIL_BOOKED_ONLY_FROM_RANK = 29
TAIL_BOOKED_MIN_CENTS = 7_800  # $78
TAIL_BOOKED_MAX_CENTS = 26_800  # $268

DISPLAY_NAMES: list[str] = [
    "zephyr_42",
    "Elena V.",
    "mrfox880",
    "s0larpunk",
    "Maya Kline",
    "dev_ninja_17",
    "Jordan Lee",
    "riley.codes",
    "Алекс_9",
    "Samuel Ortiz",
    "byte_hiker",
    "Nora W.",
    "k8s_kat",
    "Chris_301",
    "luna_moth",
    "Priya Shah",
    "stack_smith",
    "Tomás R.",
    "violet_77",
    "Hannah Kim",
    "rust_wizard",
    "Omar Haddad",
    "neo_q4",
    "Grace O’Connor",
    "pixel_pilot",
    "Diego M.",
    "echo_1991",
    "Wei Chen",
    "lambda_lisa",
    "Marcus J.",
    "404found",
    "Irina Petrov",
    "codex_13",
    "Jamal Brooks",
]


async def _purge_seed(pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            f"DELETE FROM {REFERRAL_COMMISSIONS_TABLE} WHERE reason = $1",
            SEED_REASON,
        )
        await conn.execute(
            f"""
            DELETE FROM {USERS_TABLE}
            WHERE email LIKE $1 OR email LIKE $2
            """,
            f"lb.demo.invited.%@{SEED_EMAIL_DOMAIN}",
            f"lb.demo.partner.%@{SEED_EMAIL_DOMAIN}",
        )


async def _touch_seed_commission_dates(pool) -> None:
    """Keep demo rows inside the leaderboard trailing-month window."""
    async with pool.acquire() as conn:
        await conn.execute(
            f"UPDATE {REFERRAL_COMMISSIONS_TABLE} SET created_at = NOW() WHERE reason = $1",
            SEED_REASON,
        )


async def _already_seeded(pool) -> bool:
    async with pool.acquire() as conn:
        n = await conn.fetchval(
            f"""
            SELECT COUNT(*)::int FROM {USERS_TABLE}
            WHERE email LIKE $1
            """,
            f"lb.demo.partner.%@{SEED_EMAIL_DOMAIN}",
        )
    return int(n or 0) >= 34


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--force",
        action="store_true",
        help="Delete existing lb-demo seed users/commissions, then insert fresh rows.",
    )
    parser.add_argument(
        "--refresh-dates",
        action="store_true",
        help="Set created_at=NOW() for seed commissions (month-scoped leaderboard).",
    )
    args = parser.parse_args()

    pool = await get_pool()
    if pool is None:
        print("DATABASE_URL is not set or pool failed; cannot seed.", file=sys.stderr)
        sys.exit(1)

    if args.refresh_dates:
        await _touch_seed_commission_dates(pool)
        print("Updated created_at for leaderboard_demo_seed commissions.")
        return

    if args.force:
        await _purge_seed(pool)
        print("Removed prior leaderboard demo seed data.")
    elif await _already_seeded(pool):
        print("Demo partners already present (34+). Use --force to replace.")
        return

    if len(DISPLAY_NAMES) != 34:
        print("INTERNAL: DISPLAY_NAMES must have 34 entries.", file=sys.stderr)
        sys.exit(1)

    rng = random.Random(2026)
    mid_count = TAIL_BOOKED_ONLY_FROM_RANK - 4  # ranks 4 .. TAIL-1
    rest_amounts = [rng.randint(PAID_REST_MIN_CENTS, PAID_REST_MAX_CENTS) for _ in range(mid_count)]
    paid_by_rank = [PAID_TOP_1_CENTS, PAID_TOP_2_CENTS, PAID_TOP_3_CENTS, *rest_amounts]

    for i in range(34):
        rank = i + 1
        name = DISPLAY_NAMES[i]
        p_email = PARTNER_EMAIL.format(i=rank)
        i_email = INVITED_EMAIL.format(i=rank)

        partner = await user_create(pool, p_email, password_hash=None, name=name)
        pid = partner["id"]
        await user_set_partner_program_access(pool, pid, True)

        invited = await user_create(
            pool,
            i_email,
            password_hash=None,
            name=f"seed_invited_{rank:02d}",
        )
        iid = invited["id"]

        if rank >= TAIL_BOOKED_ONLY_FROM_RANK:
            booked_cents = rng.randint(TAIL_BOOKED_MIN_CENTS, TAIL_BOOKED_MAX_CENTS)
            book_status = "hold" if rank % 2 == 0 else "approved"
            ok = await referral_create_commission(
                pool,
                invited_user_id=iid,
                referrer_user_id=pid,
                stripe_invoice_id=f"seed_lb_demo_{rank:02d}_booked",
                amount_cents=booked_cents,
                currency="usd",
                rate_percent=30,
                status=book_status,
                reason=SEED_REASON,
            )
            if not ok:
                print(f"WARN: booked-only commission skipped rank={rank}", file=sys.stderr)
            print(f"{rank:2}. {name:20} paid_out=$0.00  booked=${booked_cents / 100:,.2f} ({book_status})")
        else:
            paid_cents = paid_by_rank[i]
            ok = await referral_create_commission(
                pool,
                invited_user_id=iid,
                referrer_user_id=pid,
                stripe_invoice_id=f"seed_lb_demo_{rank:02d}",
                amount_cents=paid_cents,
                currency="usd",
                rate_percent=30,
                status="paid",
                reason=SEED_REASON,
            )
            if not ok:
                print(f"WARN: commission insert skipped (conflict?) rank={rank}", file=sys.stderr)

            # Even ranks: second commission (approved or on hold) so Booked > Paid in UI; odd ranks: paid only.
            if rank % 2 == 0:
                i2_email = f"lb.demo.invited.{rank:02d}b@{SEED_EMAIL_DOMAIN}"
                invited2 = await user_create(
                    pool,
                    i2_email,
                    password_hash=None,
                    name=f"seed_invited_{rank:02d}b",
                )
                extra_status = "hold" if rank % 4 == 0 else "approved"
                extra_cents = 1200 + (rank * 113) % 5500
                ok2 = await referral_create_commission(
                    pool,
                    invited_user_id=invited2["id"],
                    referrer_user_id=pid,
                    stripe_invoice_id=f"seed_lb_demo_{rank:02d}_x",
                    amount_cents=extra_cents,
                    currency="usd",
                    rate_percent=30,
                    status=extra_status,
                    reason=SEED_REASON,
                )
                if not ok2:
                    print(f"WARN: extra commission insert skipped rank={rank}", file=sys.stderr)

            print(f"{rank:2}. {name:20} paid_out=${paid_cents / 100:,.2f}")

    await _touch_seed_commission_dates(pool)
    print("Done. Top partners should list 34 demo rows (ordered by paid-out).")


if __name__ == "__main__":
    asyncio.run(main())
