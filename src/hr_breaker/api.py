"""
FastAPI backend for HR-Breaker (React frontend).
"""

import asyncio
import base64
import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi import FastAPI
from pydantic import BaseModel

from hr_breaker.agents import extract_name, parse_job_posting
from hr_breaker.config import get_settings
from hr_breaker.services.pdf_parser import extract_text_from_pdf
from hr_breaker.models import GeneratedPDF, JobPosting, ResumeSource, ValidationResult
from hr_breaker.orchestration import optimize_for_job
from hr_breaker.services import PDFStorage, scrape_job_posting, CloudflareBlockedError

logger = logging.getLogger(__name__)

app = FastAPI(title="HR-Breaker API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

router = APIRouter(prefix="/api", tags=["api"])
pdf_storage = PDFStorage()


# --- Request/Response schemas ---


class ExtractNameRequest(BaseModel):
    content: str


class ExtractNameResponse(BaseModel):
    first_name: str | None
    last_name: str | None


class ParsePdfResponse(BaseModel):
    content: str


class JobParseRequest(BaseModel):
    url: str | None = None
    text: str | None = None


class OptimizeRequest(BaseModel):
    resume_content: str
    job_text: str | None = None
    job_url: str | None = None
    max_iterations: int | None = None
    parallel: bool = True


class FilterResultOut(BaseModel):
    filter_name: str
    passed: bool
    score: float
    threshold: float
    issues: list[str]
    suggestions: list[str]


class ValidationResultOut(BaseModel):
    passed: bool
    results: list[FilterResultOut]


class JobPostingOut(BaseModel):
    title: str
    company: str
    requirements: list[str]
    keywords: list[str]
    description: str


class OptimizeResponse(BaseModel):
    success: bool
    pdf_base64: str | None = None
    pdf_filename: str | None = None
    validation: ValidationResultOut
    job: JobPostingOut
    error: str | None = None


class HistoryItem(BaseModel):
    filename: str
    company: str
    job_title: str
    timestamp: str
    first_name: str | None
    last_name: str | None


class HistoryResponse(BaseModel):
    items: list[HistoryItem]


class SettingsResponse(BaseModel):
    has_api_key: bool
    max_iterations: int
    output_dir: str


# --- Endpoints ---


@router.post("/resume/extract-name", response_model=ExtractNameResponse)
async def api_extract_name(req: ExtractNameRequest) -> ExtractNameResponse:
    """Extract first/last name from resume content."""
    first_name, last_name = await extract_name(req.content)
    return ExtractNameResponse(first_name=first_name, last_name=last_name)


@router.post("/resume/parse-pdf", response_model=ParsePdfResponse)
async def api_parse_resume_pdf(file: UploadFile = File(...)) -> ParsePdfResponse:
    """Extract text from uploaded PDF resume."""
    tmp_path: Path | None = None
    try:
        if not file.filename or not file.filename.lower().endswith(".pdf"):
            raise HTTPException(400, "Expected a PDF file")
        body = await file.read()
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(body)
            tmp_path = Path(tmp.name)
        content = await asyncio.to_thread(extract_text_from_pdf, tmp_path)
        return ParsePdfResponse(content=content)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("parse-pdf failed: %s", e)
        raise HTTPException(500, detail=f"PDF error: {e!s}")
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass


@router.post("/job/parse", response_model=JobPostingOut)
async def api_parse_job(req: JobParseRequest) -> JobPostingOut:
    """Parse job from URL (scrape first) or raw text."""
    settings = get_settings()
    if not settings.google_api_key:
        raise HTTPException(503, "GOOGLE_API_KEY not set. Add it to .env and restart the backend.")

    if req.url and req.text:
        raise HTTPException(400, "Provide either url or text, not both")
    if req.url:
        try:
            job_text = await asyncio.to_thread(
                scrape_job_posting, req.url
            )
        except CloudflareBlockedError:
            raise HTTPException(422, "Job URL blocked by bot protection. Paste text instead.")
        except Exception as e:
            raise HTTPException(422, str(e))
    elif req.text:
        job_text = req.text
    else:
        raise HTTPException(400, "Provide url or text")

    try:
        job = await parse_job_posting(job_text)
    except Exception as e:
        logger.exception("job/parse failed: %s", e)
        if _is_api_key_invalid(e):
            raise HTTPException(401, _API_KEY_INVALID_MSG)
        raise HTTPException(500, f"Job parse failed: {e!s}")

    return JobPostingOut(
        title=job.title,
        company=job.company,
        requirements=job.requirements,
        keywords=job.keywords,
        description=job.description,
    )


@router.post("/optimize", response_model=OptimizeResponse)
async def api_optimize(req: OptimizeRequest) -> OptimizeResponse:
    """Run full optimization: parse job (if needed), optimize, save PDF, return result."""
    settings = get_settings()
    if not settings.google_api_key:
        raise HTTPException(503, "GOOGLE_API_KEY not set. Add it to .env and restart the backend.")

    job_text = req.job_text
    if req.job_url and not job_text:
        try:
            job_text = await asyncio.to_thread(scrape_job_posting, req.job_url)
        except CloudflareBlockedError:
            return OptimizeResponse(
                success=False,
                validation=ValidationResultOut(passed=False, results=[]),
                job=JobPostingOut(title="", company="", requirements=[], keywords=[], description=""),
                error="Job URL blocked by bot protection. Paste job text instead.",
            )
        except Exception as e:
            return OptimizeResponse(
                success=False,
                validation=ValidationResultOut(passed=False, results=[]),
                job=JobPostingOut(title="", company="", requirements=[], keywords=[], description=""),
                error=str(e),
            )
    if not job_text:
        raise HTTPException(400, "Provide job_text or job_url")

    source = ResumeSource(content=req.resume_content)
    first_name, last_name = await extract_name(req.resume_content)
    source.first_name = first_name
    source.last_name = last_name

    try:
        optimized, validation, job = await optimize_for_job(
            source,
            job_text=job_text,
            max_iterations=req.max_iterations or settings.max_iterations,
            parallel=req.parallel,
        )
    except Exception as e:
        logger.exception("Optimize failed")
        err_msg = _API_KEY_INVALID_MSG if _is_api_key_invalid(e) else str(e)
        return OptimizeResponse(
            success=False,
            validation=ValidationResultOut(passed=False, results=[]),
            job=JobPostingOut(title="", company="", requirements=[], keywords=[], description=""),
            error=err_msg,
        )

    validation_out = ValidationResultOut(
        passed=validation.passed,
        results=[
            FilterResultOut(
                filter_name=r.filter_name,
                passed=r.passed,
                score=r.score,
                threshold=r.threshold,
                issues=r.issues,
                suggestions=r.suggestions,
            )
            for r in validation.results
        ],
    )
    job_out = JobPostingOut(
        title=job.title,
        company=job.company,
        requirements=job.requirements,
        keywords=job.keywords,
        description=job.description,
    )

    pdf_filename = None
    pdf_b64 = None
    if optimized and optimized.pdf_bytes:
        pdf_path = pdf_storage.generate_path(
            source.first_name, source.last_name, job.company, job.title
        )
        pdf_path.parent.mkdir(parents=True, exist_ok=True)
        pdf_path.write_bytes(optimized.pdf_bytes)
        pdf_storage.save_record(GeneratedPDF(
            path=pdf_path,
            source_checksum=source.checksum,
            company=job.company,
            job_title=job.title,
            first_name=source.first_name,
            last_name=source.last_name,
        ))
        pdf_filename = pdf_path.name
        pdf_b64 = base64.b64encode(optimized.pdf_bytes).decode()

    return OptimizeResponse(
        success=validation.passed and bool(optimized and optimized.pdf_bytes),
        pdf_base64=pdf_b64,
        pdf_filename=pdf_filename,
        validation=validation_out,
        job=job_out,
    )


@router.get("/history", response_model=HistoryResponse)
async def api_history() -> HistoryResponse:
    """List generated PDFs."""
    records = pdf_storage.list_all()
    items = [
        HistoryItem(
            filename=r.path.name,
            company=r.company,
            job_title=r.job_title,
            timestamp=r.timestamp.isoformat(),
            first_name=r.first_name,
            last_name=r.last_name,
        )
        for r in records
    ]
    return HistoryResponse(items=items)


@router.get("/history/download/{filename}")
async def api_download(filename: str):
    """Download a generated PDF by filename (safe: no path traversal)."""
    if "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid filename")
    settings = get_settings()
    path = settings.output_dir / filename
    if not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(path, filename=filename, media_type="application/pdf")


@router.get("/settings", response_model=SettingsResponse)
async def api_settings() -> SettingsResponse:
    """Return public settings for UI."""
    settings = get_settings()
    return SettingsResponse(
        has_api_key=bool(settings.google_api_key),
        max_iterations=settings.max_iterations,
        output_dir=str(settings.output_dir.resolve()),
    )


app.include_router(router)


def run_api(host: str = "0.0.0.0", port: int = 8000, reload: bool = False) -> None:
    import uvicorn
    uvicorn.run(
        "hr_breaker.api:app",
        host=host,
        port=port,
        reload=reload,
        reload_dirs=["src"] if reload else None,
    )
