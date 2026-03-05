"""PDF text extraction using PyMuPDF."""

from pathlib import Path

import fitz  # pymupdf


def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    """Extract text from PDF bytes (e.g. in-memory generated PDF)."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        return "\n".join(page.get_text() for page in doc)
    finally:
        doc.close()


def extract_text_from_pdf(pdf_path: Path) -> str:
    """Extract text from PDF file.

    Args:
        pdf_path: Path to PDF file

    Returns:
        Extracted text content
    """
    doc = fitz.open(pdf_path)
    text_parts = []

    for page in doc:
        text_parts.append(page.get_text())

    doc.close()
    return "\n".join(text_parts)
