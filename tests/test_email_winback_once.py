import asyncio
from types import SimpleNamespace

from hr_breaker.services import email_winback as ew


def test_maybe_schedule_winback_skips_if_template_already_sent(monkeypatch) -> None:
    scheduled: list[tuple[str, object, str]] = []

    monkeypatch.setattr(ew, "get_settings", lambda: SimpleNamespace(database_url="postgres://ok"))
    monkeypatch.setattr(
        ew,
        "admin_email_settings_get",
        lambda pool: _awaitable(
            {
                "winback_auto_enabled": True,
                "winback_delay_min_minutes": 25,
                "winback_delay_max_minutes": 25,
                "automation_states": {},
            }
        ),
    )
    monkeypatch.setattr(ew, "is_post_optimize_winback_paused", lambda cfg: False)
    monkeypatch.setattr(ew, "user_get_subscription", lambda pool, uid: _awaitable({"plan": "free", "status": "free"}))
    monkeypatch.setattr(ew, "email_winback_has_sent", lambda pool, uid, tid: _awaitable(True))
    monkeypatch.setattr(ew, "user_get_by_id", lambda pool, uid: _awaitable({"id": uid, "marketing_emails_opt_in": True}))
    monkeypatch.setattr(
        ew,
        "email_winback_replace_pending",
        lambda pool, uid, run_at, template_id: _record_schedule(scheduled, uid, run_at, template_id),
    )

    asyncio.run(
        ew.maybe_schedule_winback_after_optimize(
            object(),
            {"id": "11111111-1111-1111-1111-111111111111"},
            optimize_succeeded=True,
            is_admin_user_fn=lambda user: False,
        )
    )

    assert scheduled == []


def test_process_winback_due_batch_skips_duplicate_rows(monkeypatch) -> None:
    skipped_duplicate: list[str] = []

    monkeypatch.setattr(
        ew,
        "get_settings",
        lambda: SimpleNamespace(
            resend_api_key="rk_test",
            resend_from="PitchCV <test@example.com>",
            resend_winback_subject="Your resume is ready",
            email_public_base_url="https://my.pitchcv.app",
            frontend_url="https://my.pitchcv.app",
        ),
    )
    monkeypatch.setattr(ew, "admin_email_settings_get", lambda pool: _awaitable({"winback_auto_enabled": True}))
    monkeypatch.setattr(ew, "is_post_optimize_winback_paused", lambda cfg: False)
    monkeypatch.setattr(
        ew,
        "email_winback_claim_due_batch",
        lambda pool, limit: _awaitable(
            [{"id": "sched-1", "user_id": "11111111-1111-1111-1111-111111111111", "template_id": "reminder-no-download"}]
        ),
    )
    monkeypatch.setattr(
        ew,
        "user_get_by_id",
        lambda pool, uid: _awaitable({"id": uid, "email": "vladmarichak@gmail.com", "marketing_emails_opt_in": True}),
    )
    monkeypatch.setattr(ew, "user_get_subscription", lambda pool, uid: _awaitable({"plan": "free", "status": "free"}))
    monkeypatch.setattr(
        ew,
        "email_winback_has_sent",
        lambda pool, uid, tid, exclude_schedule_id=None: _awaitable(exclude_schedule_id == "sched-1"),
    )
    monkeypatch.setattr(
        ew,
        "email_winback_mark_skipped_duplicate",
        lambda pool, schedule_id: _record_skip(skipped_duplicate, schedule_id),
    )
    monkeypatch.setattr(ew, "deliver_winback_email", _unexpected_deliver)

    result = asyncio.run(ew.process_winback_due_batch(object(), limit=25))

    assert skipped_duplicate == ["sched-1"]
    assert result["sent"] == 0
    assert result["skipped_duplicate"] == 1


async def _awaitable(value):
    return value


async def _record_schedule(scheduled: list[tuple[str, object, str]], uid: str, run_at, template_id: str) -> None:
    scheduled.append((uid, run_at, template_id))


async def _record_skip(skipped_duplicate: list[str], schedule_id: str) -> None:
    skipped_duplicate.append(schedule_id)


async def _unexpected_deliver(**kwargs) -> None:
    raise AssertionError("deliver_winback_email should not run for a duplicate auto win-back")
