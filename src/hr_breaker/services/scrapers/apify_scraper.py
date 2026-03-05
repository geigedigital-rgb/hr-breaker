"""
Apify-based scraper for job boards (e.g. StepStone) that accept startUrls.

Requires: pip install 'hr-breaker[apify]' and APIFY_TOKEN in env.
Actor stepstone-scraper-fast-reliable-4-1k treats startUrls as listing pages and may
return many jobs; we limit to one page and pick the item matching the requested URL.
"""

import logging
import re
from urllib.parse import urlparse

from .base import ScrapingError

logger = logging.getLogger(__name__)

try:
    from apify_client import ApifyClient as _ApifyClient

    ApifyClient = _ApifyClient
    APIFY_AVAILABLE = True
except ImportError:
    ApifyClient = None
    APIFY_AVAILABLE = False


# Common field names in StepStone-style actor output (different actors use different keys)
JOB_TITLE_KEYS = ("title", "jobTitle", "name")
JOB_COMPANY_KEYS = ("company", "companyName", "employer")
JOB_DESC_KEYS = ("description", "jobDescription", "content", "body")
JOB_LOCATION_KEYS = ("location", "locations", "city", "address")
JOB_URL_KEYS = ("url", "link", "jobUrl")

# StepStone detail URL often ends with --<id>-inline.html (e.g. ...--13451585-inline.html)
_STEPSTONE_ID_RE = re.compile(r"--(\d+)(?:-inline)?\.html", re.I)


def _job_id_from_url(url: str) -> str | None:
    """Extract job id from StepStone-style path (e.g. 13451585 from ...--13451585-inline.html)."""
    if not url:
        return None
    path = urlparse(url).path or url
    m = _STEPSTONE_ID_RE.search(path)
    return m.group(1) if m else None


def _normalize_url_for_match(u: str) -> str:
    """Lowercase, strip, remove trivial query params for comparison."""
    if not u or not isinstance(u, str):
        return ""
    u = u.strip().lower()
    try:
        parsed = urlparse(u)
        return (parsed.scheme or "") + "://" + (parsed.netloc or "") + (parsed.path or "")
    except Exception:
        return u


def _item_url(item: dict) -> str:
    """Get first non-empty url/link/jobUrl from item."""
    for key in JOB_URL_KEYS:
        v = item.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, list) and v and isinstance(v[0], str):
            return v[0].strip()
    return ""


def _pick_item_for_requested_url(items: list[dict], requested_url: str) -> dict:
    """
    From actor output (often many jobs from a listing), pick the item that matches
    the single URL we requested. Actor may paginate and return 40+ jobs; we want
    the one for requested_url.
    """
    requested_normalized = _normalize_url_for_match(requested_url)
    requested_id = _job_id_from_url(requested_url)

    # 1) Exact or path match
    for it in items:
        iu = _item_url(it)
        if not iu:
            continue
        if requested_normalized and _normalize_url_for_match(iu) == requested_normalized:
            return it
        if requested_normalized and requested_normalized in _normalize_url_for_match(iu):
            return it
        if requested_normalized and _normalize_url_for_match(iu) in requested_normalized:
            return it

    # 2) Match by job id in path (e.g. 13451585)
    if requested_id:
        for it in items:
            iu = _item_url(it)
            if requested_id in (iu or ""):
                return it

    # 3) Prefer item with longest description (likely the full job we asked for)
    def _desc_len(it: dict) -> int:
        for k in JOB_DESC_KEYS:
            v = it.get(k)
            if isinstance(v, str):
                return len(v)
            if isinstance(v, list) and v:
                return sum(len(str(x)) for x in v)
        return 0

    return max(items, key=_desc_len)


def _job_item_to_text(item: dict) -> str:
    """Build plain text from one job dataset item for our job_parser."""
    parts = []

    def _first(*keys: str) -> str:
        for k in keys:
            v = item.get(k)
            if v is None:
                continue
            if isinstance(v, list):
                v = " ".join(str(x) for x in v) if v else ""
            if isinstance(v, str) and v.strip():
                return v.strip()
            if isinstance(v, (int, float)):
                return str(v)
        return ""

    title = _first(*JOB_TITLE_KEYS)
    if title:
        parts.append(f"Title: {title}")

    company = _first(*JOB_COMPANY_KEYS)
    if company:
        parts.append(f"Company: {company}")

    location = _first(*JOB_LOCATION_KEYS)
    if location:
        parts.append(f"Location: {location}")

    desc = _first(*JOB_DESC_KEYS)
    if desc:
        parts.append("\nDescription:\n" + desc)

    if not parts:
        # Fallback: concatenate all string values
        parts.append(
            "\n".join(
                f"{k}: {v}"
                for k, v in sorted(item.items())
                if v is not None and isinstance(v, (str, int, float)) and str(v).strip()
            )
        )

    return "\n\n".join(parts) if parts else ""


class ApifyScraper:
    """
    Scraper that runs an Apify Actor with startUrls (single job URL) and builds
    job text from the actor's dataset items.
    """

    name = "apify"

    def __init__(
        self,
        token: str,
        actor_id: str = "fatihtahta/stepstone-scraper-fast-reliable-4-1k",
        timeout_secs: int = 120,
    ):
        self.token = token.strip()
        self.actor_id = actor_id
        self.timeout_secs = timeout_secs

    def scrape(self, url: str) -> str:
        if not APIFY_AVAILABLE or ApifyClient is None:
            raise ScrapingError(
                "Apify client not installed. Install with: uv pip install 'hr-breaker[apify]'"
            )
        if not self.token:
            raise ScrapingError("APIFY_TOKEN is not set")

        client = ApifyClient(self.token)
        actor = client.actor(self.actor_id)

        # Limit to one page so we get the job from the start URL, not 4+ pages of listing
        run_input: dict = {"startUrls": [url], "maxPages": 1}
        try:
            run = actor.call(run_input=run_input, timeout_secs=self.timeout_secs)
        except Exception as e:
            err_msg = str(e).lower()
            if "maxpages" in err_msg or "input" in err_msg or "schema" in err_msg:
                run_input = {"startUrls": [url]}
                run = actor.call(run_input=run_input, timeout_secs=self.timeout_secs)
            else:
                raise ScrapingError(f"Apify actor run failed: {e}") from e

        default_dataset_id = run.get("defaultDatasetId")
        if not default_dataset_id:
            raise ScrapingError("Apify run did not return defaultDatasetId")

        dataset = client.dataset(default_dataset_id)
        items = list(dataset.iterate_items())

        if not items:
            raise ScrapingError("Apify actor returned no dataset items")

        chosen = _pick_item_for_requested_url(items, url)
        logger.debug(
            "Apify: picked 1 item from %d for URL (id=%s)",
            len(items),
            _job_id_from_url(url),
        )

        text = _job_item_to_text(chosen)
        if not text or len(text) < 100:
            raise ScrapingError(
                "Apify actor returned too little text (check actor output schema)"
            )
        return text


def url_domain_in_list(url: str, domains_comma: str) -> bool:
    """Return True if url's host equals or is a subdomain of an allowed domain (e.g. stepstone.de)."""
    if not url or not domains_comma:
        return False
    host = urlparse(url).netloc.lower()
    if ":" in host:
        host = host.split(":")[0]
    allowed = [d.strip().lower() for d in domains_comma.split(",") if d.strip()]
    return host in allowed or any(
        host == d or host.endswith("." + d) for d in allowed
    )
