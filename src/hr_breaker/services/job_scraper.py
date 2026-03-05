import logging
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from ..config import get_settings
from .scrapers.base import CloudflareBlockedError, ScrapingError
from .scrapers.httpx_scraper import HttpxScraper
from .scrapers.wayback_scraper import WaybackScraper
from .scrapers.apify_scraper import ApifyScraper, url_domain_in_list
from .scrapers.playwright_scraper import PlaywrightScraper, PLAYWRIGHT_AVAILABLE

logger = logging.getLogger(__name__)

# Re-export for backwards compatibility
__all__ = ["scrape_job_posting", "ScrapingError", "CloudflareBlockedError", "extract_company_logo_url"]


def extract_company_logo_url(job_page_url: str, timeout: float = 8.0) -> str | None:
    """
    Try to extract company/logo image URL from a job page.
    Many sites use og:image, twitter:image, or img with logo in class/id.
    Returns absolute URL or None on failure/timeout.
    """
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.9",
        }
        with httpx.Client(follow_redirects=True, timeout=timeout) as client:
            r = client.get(job_page_url, headers=headers)
            r.raise_for_status()
            html = r.text
            base = r.url
    except Exception as e:
        logger.debug("Logo fetch failed for %s: %s", job_page_url, e)
        return None

    soup = BeautifulSoup(html, "html.parser")

    def make_absolute(href: str | None) -> str | None:
        if not href or not href.strip():
            return None
        href = href.strip()
        if href.startswith("//"):
            href = "https:" + href
        elif href.startswith("/"):
            parsed = urlparse(base)
            href = f"{parsed.scheme}://{parsed.netloc}{href}"
        else:
            href = urljoin(base, href)
        if not href.lower().startswith("http"):
            return None
        return href

    # 1. Open Graph / Twitter (often company or job image)
    for meta in soup.find_all("meta", property="og:image") or []:
        content = meta.get("content")
        if content:
            return make_absolute(content)
    for meta in soup.find_all("meta", attrs={"name": "twitter:image"}) or []:
        content = meta.get("content")
        if content:
            return make_absolute(content)

    # 2. img with logo in class/id (common on job boards)
    for img in soup.find_all("img", src=True):
        src = img.get("src")
        if not src:
            continue
        cls = " ".join(img.get("class") or [])
        aid = img.get("id") or ""
        alt = (img.get("alt") or "").lower()
        if "logo" in cls.lower() or "logo" in aid.lower() or "logo" in alt:
            abs_url = make_absolute(src)
            if abs_url and any(ext in abs_url.lower().split("?")[0] for ext in (".png", ".jpg", ".jpeg", ".webp", ".svg")):
                return abs_url

    # 3. Common data attributes
    for el in soup.find_all(attrs={"data-company-logo": True}) or soup.find_all(attrs={"data-logo": True}):
        href = el.get("data-company-logo") or el.get("data-logo")
        if href:
            return make_absolute(href)

    return None


def _ensure_scheme(url: str) -> str:
    """Prepend https:// if URL has no scheme (e.g. stepstone.de/...)."""
    u = (url or "").strip()
    if u and not (u.startswith("http://") or u.startswith("https://")):
        return "https://" + u
    return u


def scrape_job_posting(
    url: str,
    max_retries: int = 3,
    use_wayback: bool = True,
    use_apify: bool | None = None,
    use_playwright: bool = True,
) -> str:
    """
    Scrape job posting text from URL with fallback chain.

    For StepStone etc. (domain in SCRAPER_APIFY_DOMAINS): Apify (if configured) or Playwright
    is used first — skip httpx/wayback to avoid timeouts. Other sites: httpx -> wayback -> apify -> playwright.
    """
    url = _ensure_scheme(url)
    settings = get_settings()
    errors: list[tuple[str, str]] = []
    cloudflare_blocked = False
    apify_enabled = (use_apify if use_apify is not None else settings.scraper_use_apify) and bool(
        settings.apify_token
    )
    apify_domain = url_domain_in_list(url, settings.scraper_apify_domains)
    apify_tried_first = False
    playwright_tried_early = False

    # StepStone etc.: Playwright first (one page, fast), then Apify; skip httpx/wayback
    if apify_domain:
        logger.info(
            "StepStone-like URL detected (%s), trying Playwright first (one page), then Apify",
            settings.scraper_apify_domains,
        )
        if use_playwright and PLAYWRIGHT_AVAILABLE:
            playwright_scraper = PlaywrightScraper(
                timeout=settings.scraper_playwright_timeout,
                use_stealth=settings.scraper_use_stealth,
                locale=settings.scraper_playwright_locale,
            )
            try:
                result = playwright_scraper.scrape(url)
                logger.info("Scraped %s with Playwright (StepStone)", url)
                return result
            except (ScrapingError, CloudflareBlockedError) as e:
                errors.append((playwright_scraper.name, str(e)))
                playwright_tried_early = True
                logger.warning("Playwright failed for %s: %s", url, e)
        if apify_enabled:
            apify_scraper = ApifyScraper(
                token=settings.apify_token,
                actor_id=settings.scraper_apify_actor_id,
                timeout_secs=settings.scraper_apify_timeout,
            )
            try:
                result = apify_scraper.scrape(url)
                logger.info("Scraped %s via Apify (StepStone) %s", url, settings.scraper_apify_actor_id)
                return result
            except ScrapingError as e:
                apify_tried_first = True
                errors.append((apify_scraper.name, str(e)))
                logger.warning("Apify failed for %s: %s", url, e)
        if apify_domain and (playwright_tried_early or apify_tried_first):
            methods_tried = ", ".join(f"{name}: {err}" for name, err in errors)
            raise ScrapingError(
                f"Failed to scrape {url}. Methods tried: [{methods_tried}]. "
                "Try pasting the job description text directly."
            )

    # 1. Try httpx (direct fetch)
    httpx_scraper = HttpxScraper(
        max_retries=max_retries,
        timeout=settings.scraper_httpx_timeout,
    )
    try:
        result = httpx_scraper.scrape(url)
        logger.info(f"Scraped {url} with httpx")
        return result
    except CloudflareBlockedError as e:
        cloudflare_blocked = True
        errors.append((httpx_scraper.name, str(e)))
        logger.warning(f"httpx blocked by Cloudflare for {url}")
    except ScrapingError as e:
        errors.append((httpx_scraper.name, str(e)))
        logger.warning(f"httpx failed for {url}: {e}")

    # 2. Try Wayback Machine (skip if Cloudflare blocked - unlikely to have snapshot)
    if use_wayback and not cloudflare_blocked:
        wayback_scraper = WaybackScraper(timeout=settings.scraper_wayback_timeout)
        try:
            result = wayback_scraper.scrape(url)
            logger.info(f"Scraped {url} via Wayback Machine")
            return result
        except ScrapingError as e:
            errors.append((wayback_scraper.name, str(e)))
            logger.warning(f"Wayback failed for {url}: {e}")
    elif use_wayback and cloudflare_blocked:
        logger.info("Skipping Wayback (Cloudflare site unlikely to have snapshot)")

    # 3. Try Apify (if not already tried first for this URL)
    if apify_enabled and not apify_tried_first and apify_domain:
        apify_scraper = ApifyScraper(
            token=settings.apify_token,
            actor_id=settings.scraper_apify_actor_id,
            timeout_secs=settings.scraper_apify_timeout,
        )
        try:
            result = apify_scraper.scrape(url)
            logger.info(f"Scraped {url} via Apify ({settings.scraper_apify_actor_id})")
            return result
        except ScrapingError as e:
            errors.append((apify_scraper.name, str(e)))
            logger.warning(f"Apify failed for {url}: {e}")

    # 4. Try Playwright (browser)
    if use_playwright and PLAYWRIGHT_AVAILABLE:
        logger.warning(f"Trying Playwright browser for {url}...")
        playwright_scraper = PlaywrightScraper(
            timeout=settings.scraper_playwright_timeout,
            use_stealth=settings.scraper_use_stealth,
            locale=settings.scraper_playwright_locale,
        )
        try:
            result = playwright_scraper.scrape(url)
            logger.warning(f"Scraped {url} with Playwright")
            return result
        except (ScrapingError, CloudflareBlockedError) as e:
            errors.append((playwright_scraper.name, str(e)))
            logger.warning(f"Playwright failed for {url}: {e}")
    elif use_playwright and not PLAYWRIGHT_AVAILABLE:
        errors.append(("playwright", "not installed"))

    # All methods failed
    methods_tried = ", ".join(f"{name}: {err}" for name, err in errors)
    raise ScrapingError(
        f"Failed to scrape {url}. Methods tried: [{methods_tried}]. "
        "Try pasting the job description text directly."
    )
