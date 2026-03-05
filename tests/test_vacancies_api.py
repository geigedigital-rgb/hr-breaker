"""Tests for /api/vacancies/search endpoint."""

import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

from hr_breaker.api import app


@pytest.fixture
def client():
    return TestClient(app)


def test_vacancies_search_requires_q(client):
    """Without q parameter returns 422."""
    r = client.get("/api/vacancies/search")
    assert r.status_code == 422


def test_vacancies_search_returns_503_when_adzuna_not_configured(client):
    """When ADZUNA_APP_ID/ADZUNA_APP_KEY are not set, returns 503."""
    with patch("hr_breaker.api.get_settings") as m:
        m.return_value.adzuna_app_id = ""
        m.return_value.adzuna_app_key = ""
        r = client.get("/api/vacancies/search", params={"q": "developer"})
    assert r.status_code == 503
    assert "поиск" in r.json().get("detail", "").lower() or "не настроен" in r.json().get("detail", "").lower()
