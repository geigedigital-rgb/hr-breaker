import asyncio
import json
from datetime import datetime, timezone

from hr_breaker.services.db import optimization_snapshot_insert, optimize_session_draft_upsert


class _FakeConn:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    async def execute(self, query: str, *args: object) -> None:
        self.calls.append((query, args))

    async def fetchrow(self, query: str, *args: object) -> dict[str, str]:
        self.calls.append((query, args))
        return {"id": "snap-123"}


class _FakeAcquire:
    def __init__(self, conn: _FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> _FakeConn:
        return self._conn

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


class _FakePool:
    def __init__(self, conn: _FakeConn) -> None:
        self._conn = conn

    def acquire(self) -> _FakeAcquire:
        return _FakeAcquire(self._conn)


def test_optimize_session_draft_upsert_serializes_payload_for_jsonb() -> None:
    conn = _FakeConn()
    pool = _FakePool(conn)

    payload = {"stage": 2, "job": {"title": "Backend Engineer"}}
    asyncio.run(
        optimize_session_draft_upsert(
            pool,
            user_id="11111111-1111-1111-1111-111111111111",
            payload=payload,
            expires_at=datetime.now(timezone.utc),
        )
    )

    _, args = conn.calls[0]
    assert isinstance(args[1], str)
    assert json.loads(args[1]) == payload


def test_optimization_snapshot_insert_serializes_payload_for_jsonb() -> None:
    conn = _FakeConn()
    pool = _FakePool(conn)

    payload = {"stage": 4, "validation": {"passed": True}, "optimized_resume_text": "ok"}
    snap_id = asyncio.run(
        optimization_snapshot_insert(
            pool,
            user_id="11111111-1111-1111-1111-111111111111",
            pdf_filename="resume.pdf",
            payload=payload,
            expires_at=datetime.now(timezone.utc),
        )
    )

    _, args = conn.calls[0]
    assert snap_id == "snap-123"
    assert isinstance(args[3], str)
    assert json.loads(args[3]) == payload
