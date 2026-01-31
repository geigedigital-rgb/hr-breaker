"""
Abstract renderer interface and HTML renderer implementation.
Production-safe version using importlib.resources.
"""

import os
import sys
from abc import ABC, abstractmethod

from importlib.resources import files
from jinja2 import Environment, PackageLoader, select_autoescape

from hr_breaker.models.resume_data import ResumeData, RenderResult


# =========================
# macOS WeasyPrint helpers
# =========================

def _setup_macos_library_path():
    """Set up library path for WeasyPrint on macOS with Homebrew."""
    if sys.platform != "darwin":
        return

    if os.environ.get("DYLD_FALLBACK_LIBRARY_PATH"):
        return

    homebrew_paths = [
        "/opt/homebrew/lib",  # Apple Silicon
        "/usr/local/lib",     # Intel
    ]

    for path in homebrew_paths:
        if os.path.exists(os.path.join(path, "libgobject-2.0.dylib")):
            os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = path
            return


# =========================
# Errors
# =========================

class RenderError(Exception):
    """Raised when rendering fails."""
    pass


# =========================
# Base renderer
# =========================

class BaseRenderer(ABC):
    """Abstract base class for resume renderers."""

    @abstractmethod
    def render(self, data: ResumeData) -> RenderResult:
        """Render resume data to PDF."""
        raise NotImplementedError


# =========================
# HTML Renderer
# =========================

class HTMLRenderer(BaseRenderer):
    """Render resume using HTML + WeasyPrint."""

    _weasyprint_imported = False

    def __init__(self):
        self._ensure_weasyprint()

        # Jinja environment (package-safe)
        self.env = Environment(
            loader=PackageLoader("hr_breaker", "templates"),
            autoescape=select_autoescape(["html", "xml"]),
        )

        from weasyprint.text.fonts import FontConfiguration
        self.font_config = FontConfiguration()

        # Load wrapper HTML via importlib.resources
        self._wrapper_html = (
            files("hr_breaker.templates")
            .joinpath("resume_wrapper.html")
            .read_text(encoding="utf-8")
        )

        # Base directory for WeasyPrint (real filesystem path)
        self._template_base = str(files("hr_breaker.templates"))

    # -------------------------
    # Lazy WeasyPrint import
    # -------------------------

    @classmethod
    def _ensure_weasyprint(cls):
        """Lazily import WeasyPrint with proper library path setup."""
        if cls._weasyprint_imported:
            return

        _setup_macos_library_path()

        try:
            import weasyprint  # noqa: F401
            cls._weasyprint_imported = True
        except OSError as e:
            if "libgobject" in str(e) or "libpango" in str(e):
                raise RenderError(
                    "WeasyPrint libraries not found.\n"
                    "On macOS, run:\n"
                    "  brew install pango gdk-pixbuf libffi\n\n"
                    "Then either:\n"
                    "  export DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib\n"
                    "or run:\n"
                    "  DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib hr-breaker ..."
                ) from e
            raise

    # -------------------------
    # Render HTML body (LLM)
    # -------------------------

    def render(self, html_body: str) -> RenderResult:
        """
        Render LLM-generated HTML body to PDF.

        Args:
            html_body: HTML content for <body> (no wrapper needed)
        """
        from weasyprint import HTML

        html_content = self._wrapper_html.replace("{{BODY}}", html_body)

        html = HTML(
            string=html_content,
            base_url=self._template_base,
        )

        doc = html.render(font_config=self.font_config)
        pdf_bytes = doc.write_pdf()
        page_count = len(doc.pages)

        warnings = []
        if page_count > 1:
            warnings.append(f"Resume is {page_count} pages, should be 1 page")

        return RenderResult(
            pdf_bytes=pdf_bytes,
            page_count=page_count,
            warnings=warnings,
        )

    # -------------------------
    # Legacy Jinja rendering
    # -------------------------

    def render_data(self, data: ResumeData) -> RenderResult:
        """Render ResumeData to PDF via Jinja template."""
        from weasyprint import HTML, CSS

        template = self.env.get_template("resume.html")
        html_content = template.render(resume=data)

        html = HTML(
            string=html_content,
            base_url=self._template_base,
        )

        stylesheets = []
        css_path = files("hr_breaker.templates").joinpath("resume.css")
        if css_path.exists():
            stylesheets.append(
                CSS(
                    filename=str(css_path),
                    font_config=self.font_config,
                )
            )

        doc = html.render(
            stylesheets=stylesheets,
            font_config=self.font_config,
        )

        pdf_bytes = doc.write_pdf()
        page_count = len(doc.pages)

        warnings = []
        if page_count > 1:
            warnings.append(f"Resume is {page_count} pages, should be 1 page")

        return RenderResult(
            pdf_bytes=pdf_bytes,
            page_count=page_count,
            warnings=warnings,
        )


# =========================
# Factory
# =========================

def get_renderer() -> HTMLRenderer:
    """Get the HTML renderer."""
    return HTMLRenderer()
