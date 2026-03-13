import logging

from .base import BaseScraper, CloudflareBlockedError, ScrapingError

logger = logging.getLogger(__name__)

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False
    sync_playwright = None
    PlaywrightTimeout = None

STEALTH_AVAILABLE = False
Stealth = None
if PLAYWRIGHT_AVAILABLE:
    try:
        from playwright_stealth import Stealth

        STEALTH_AVAILABLE = True
    except ImportError:
        pass


def _locale_to_languages(locale: str) -> tuple[str, str]:
    """Convert locale like 'de-DE' to (primary, short) for Accept-Language."""
    if "-" in locale:
        primary, region = locale.split("-", 1)
        return (locale, primary)
    return (locale, locale)


class PlaywrightScraper(BaseScraper):
    """Browser-based scraper using Playwright. Optional stealth reduces bot detection."""

    name = "playwright"

    def __init__(
        self,
        timeout: float = 60000,
        use_stealth: bool = True,
        locale: str = "en-US",
    ):
        self.timeout = timeout
        self.use_stealth = use_stealth and STEALTH_AVAILABLE
        self.locale = locale

    def scrape(self, url: str) -> str:
        """Scrape job posting using headless browser."""
        if not PLAYWRIGHT_AVAILABLE:
            raise ScrapingError(
                "Playwright not installed. Install with: "
                "uv pip install -e . && python -m playwright install chromium"
            )

        playwright_ctx = sync_playwright()
        if self.use_stealth and Stealth is not None:
            stealth = Stealth(
                navigator_languages_override=_locale_to_languages(self.locale),
                navigator_platform_override="Win32",
            )
            playwright_ctx = stealth.use_sync(playwright_ctx)
            logger.debug("Using playwright-stealth for this request")

        try:
            with playwright_ctx as p:
                browser = p.chromium.launch(headless=True)
                try:
                    context = browser.new_context(
                        viewport={"width": 1920, "height": 1080},
                        locale=self.locale,
                        user_agent=(
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                            "AppleWebKit/537.36 (KHTML, like Gecko) "
                            "Chrome/120.0.0.0 Safari/537.36"
                        ),
                    )
                    page = context.new_page()

                    page.goto(url, wait_until="load", timeout=self.timeout)

                    # Wait for main content on SPAs (e.g. StepStone); ignore timeout and use current DOM
                    try:
                        page.wait_for_selector("main, [role=main], article", timeout=15_000)
                    except Exception:
                        pass

                    html = page.content()

                    if self.is_cloudflare_blocked(html):
                        raise CloudflareBlockedError(
                            f"Cloudflare blocked even with browser: {url}"
                        )

                    return self.extract_job_text(html)
                finally:
                    browser.close()
        except PlaywrightTimeout:
            raise ScrapingError(f"Playwright timeout loading {url}")
        except Exception as e:
            if isinstance(e, (ScrapingError, CloudflareBlockedError)):
                raise
            raise ScrapingError(f"Playwright error: {e}")
