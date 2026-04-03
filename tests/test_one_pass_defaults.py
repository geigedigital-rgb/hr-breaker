from hr_breaker.agents import job_parser
from hr_breaker.config import Settings, get_settings


def test_settings_default_max_iterations_is_one():
    assert Settings().max_iterations == 1


def test_max_iterations_env_override_is_ignored(monkeypatch):
    monkeypatch.setenv("MAX_ITERATIONS", "3")
    settings = get_settings()
    assert settings.max_iterations == 1


def test_job_parser_keeps_legacy_prompt_and_uses_new_prompt():
    assert job_parser.LEGACY_SYSTEM_PROMPT != job_parser.SYSTEM_PROMPT
    assert "Goal: maximize downstream resume-to-job matching quality in one pass" in job_parser.SYSTEM_PROMPT
