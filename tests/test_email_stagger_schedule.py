"""Unit tests for stagger campaign schedule (no DB)."""

from datetime import datetime, timedelta, timezone

from hr_breaker.services import email_stagger_campaign as esc


def test_build_run_schedule_monotonic_gaps() -> None:
    t0 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    times = esc._build_run_schedule(first_send_at=t0, n=5)
    assert times[0] == t0
    for i in range(1, len(times)):
        delta = (times[i] - times[i - 1]).total_seconds()
        assert 180 <= delta <= 480
