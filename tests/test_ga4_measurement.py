from hr_breaker.services.ga4_measurement import normalize_ga_client_id


def test_normalize_ga_client_id_accepts_standard_form() -> None:
    assert normalize_ga_client_id("212434041.1634919455") == "212434041.1634919455"


def test_normalize_ga_client_id_trims() -> None:
    assert normalize_ga_client_id("  212434041.1634919455  ") == "212434041.1634919455"


def test_normalize_ga_client_id_rejects_invalid() -> None:
    assert normalize_ga_client_id("") is None
    assert normalize_ga_client_id(None) is None
    assert normalize_ga_client_id("not-a-client-id") is None
    assert normalize_ga_client_id("onlyonedot") is None
