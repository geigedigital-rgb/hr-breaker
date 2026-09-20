from .job_scraper import scrape_job_posting, ScrapingError, CloudflareBlockedError
from .cache import ResumeCache
from .pdf_storage import PDFStorage
from .renderer import get_renderer, BaseRenderer, HTMLRenderer, RenderError
from .template_engine import (
    TemplateManifest,
    TemplateDensityProfile,
    list_templates,
    list_recommended_templates,
    get_density_profile,
    render_template_html,
    wrap_full_html,
)
from .template_fit import TemplateFitResult, fit_schema_to_template

__all__ = [
    "scrape_job_posting",
    "ScrapingError",
    "CloudflareBlockedError",
    "ResumeCache",
    "PDFStorage",
    "get_renderer",
    "BaseRenderer",
    "HTMLRenderer",
    "RenderError",
    "TemplateManifest",
    "TemplateDensityProfile",
    "list_templates",
    "list_recommended_templates",
    "get_density_profile",
    "render_template_html",
    "wrap_full_html",
    "TemplateFitResult",
    "fit_schema_to_template",
]
