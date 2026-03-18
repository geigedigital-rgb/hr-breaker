from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from hr_breaker.services import referral_service as rs


def test_invoice_is_trial_like_with_zero_amount() -> None:
    invoice = {"amount_paid": 0}
    assert rs.invoice_is_trial_like(invoice) is True


def test_invoice_is_trial_like_with_trial_line() -> None:
    invoice = {
        "amount_paid": 299,
        "lines": {"data": [{"description": "Trial 7 days — HR-Breaker"}]},
    }
    assert rs.invoice_is_trial_like(invoice) is True


def test_invoice_uses_coupon() -> None:
    assert rs.invoice_uses_coupon({"discount": {"id": "disc_1"}}) is True
    assert rs.invoice_uses_coupon({"total_discount_amounts": [{"amount": 100}]}) is True
    assert rs.invoice_uses_coupon({"discount": None, "total_discount_amounts": []}) is False


def test_process_invoice_creates_commission(monkeypatch: pytest.MonkeyPatch) -> None:
    created = {"called": False}

    async def _user_by_customer(_pool, customer_id: str):
        assert customer_id == "cus_1"
        return "invited-uid"

    async def _commission_by_invited(_pool, invited_user_id: str):
        assert invited_user_id == "invited-uid"
        return None

    async def _attr_by_invited(_pool, invited_user_id: str):
        assert invited_user_id == "invited-uid"
        return {
            "referrer_user_id": "ref-uid",
            "expires_at": datetime.now(timezone.utc) + timedelta(days=10),
        }

    async def _create_commission(_pool, **kwargs):
        created["called"] = True
        assert kwargs["invited_user_id"] == "invited-uid"
        assert kwargs["referrer_user_id"] == "ref-uid"
        assert kwargs["amount_cents"] == 300
        return True

    async def _noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr(rs, "user_get_id_by_stripe_customer_id", _user_by_customer)
    monkeypatch.setattr(rs, "referral_get_commission_by_invited", _commission_by_invited)
    monkeypatch.setattr(rs, "referral_get_attribution_by_invited", _attr_by_invited)
    monkeypatch.setattr(rs, "referral_create_commission", _create_commission)
    monkeypatch.setattr(rs, "referral_log_event", _noop)

    result = asyncio.run(
        rs.process_first_paid_invoice_commission(
            object(),
            invoice={"id": "in_1", "customer": "cus_1", "amount_paid": 1000, "currency": "usd"},
            stripe_event_id="evt_1",
        )
    )
    assert result["created"] is True
    assert created["called"] is True


def test_process_invoice_skips_existing_commission(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _user_by_customer(_pool, _customer_id: str):
        return "invited-uid"

    async def _commission_by_invited(_pool, _invited_user_id: str):
        return {"id": "existing"}

    monkeypatch.setattr(rs, "user_get_id_by_stripe_customer_id", _user_by_customer)
    monkeypatch.setattr(rs, "referral_get_commission_by_invited", _commission_by_invited)

    result = asyncio.run(
        rs.process_first_paid_invoice_commission(
            object(),
            invoice={"id": "in_1", "customer": "cus_1", "amount_paid": 1000, "currency": "usd"},
            stripe_event_id="evt_1",
        )
    )
    assert result["created"] is False
    assert result["reason"] == "already_commissioned"
