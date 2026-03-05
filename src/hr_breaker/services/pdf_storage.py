import asyncio
import json
import re
from datetime import datetime
from pathlib import Path

from hr_breaker.config import get_settings
from hr_breaker.models import GeneratedPDF

INDEX_FILENAME = "index.json"
SOURCES_DIR = "sources"


def sanitize_filename(name: str) -> str:
    """Convert name to safe filename component."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def _record_to_dict(r: GeneratedPDF) -> dict:
    return {
        "filename": r.path.name,
        "source_checksum": r.source_checksum,
        "company": r.company,
        "job_title": r.job_title,
        "timestamp": r.timestamp.isoformat(),
        "first_name": r.first_name,
        "last_name": r.last_name,
        "pre_ats_score": r.pre_ats_score,
        "post_ats_score": r.post_ats_score,
        "pre_keyword_score": r.pre_keyword_score,
        "post_keyword_score": r.post_keyword_score,
        "company_logo_url": r.company_logo_url,
        "job_url": r.job_url,
        "source_was_pdf": r.source_was_pdf,
    }


def _dict_to_record(d: dict, output_dir: Path) -> GeneratedPDF:
    ts = d.get("timestamp")
    if isinstance(ts, str):
        try:
            timestamp = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            timestamp = datetime.now()
    else:
        timestamp = datetime.now()
    return GeneratedPDF(
        path=output_dir / d["filename"],
        source_checksum=d.get("source_checksum", ""),
        company=d.get("company", ""),
        job_title=d.get("job_title", ""),
        timestamp=timestamp,
        first_name=d.get("first_name"),
        last_name=d.get("last_name"),
        pre_ats_score=d.get("pre_ats_score"),
        post_ats_score=d.get("post_ats_score"),
        pre_keyword_score=d.get("pre_keyword_score"),
        post_keyword_score=d.get("post_keyword_score"),
        company_logo_url=d.get("company_logo_url"),
        job_url=d.get("job_url"),
        source_was_pdf=d.get("source_was_pdf", False),
    )


class PDFStorage:
    """Storage for generated PDFs with index.json for rich metadata."""

    def __init__(self):
        self.output_dir = get_settings().output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.sources_dir = self.output_dir / SOURCES_DIR
        self.sources_dir.mkdir(parents=True, exist_ok=True)
        self._index_path = self.output_dir / INDEX_FILENAME

    def generate_path(
        self,
        first_name: str | None,
        last_name: str | None,
        company: str,
        role: str | None = None,
        unique_suffix: str | None = None,
    ) -> Path:
        """Generate PDF path: {first}_{last}_{company}_{role}[_{suffix}].pdf.
        Pass unique_suffix (e.g. timestamp) so each run gets a unique file.
        """
        parts = []
        if first_name:
            parts.append(sanitize_filename(first_name))
        if last_name:
            parts.append(sanitize_filename(last_name))
        parts.append(sanitize_filename(company))
        if role:
            parts.append(sanitize_filename(role))
        if unique_suffix:
            parts.append(sanitize_filename(unique_suffix))

        filename = "_".join(parts) + ".pdf"
        return self.output_dir / filename

    def generate_debug_dir(self, company: str, role: str | None = None) -> Path:
        """Generate debug directory: output/debug_{company}_{role}/"""
        parts = ["debug", sanitize_filename(company)]
        if role:
            parts.append(sanitize_filename(role))
        debug_dir = self.output_dir / "_".join(parts)
        debug_dir.mkdir(parents=True, exist_ok=True)
        return debug_dir

    def _load_index(self) -> list[dict]:
        if not self._index_path.is_file():
            return []
        try:
            data = json.loads(self._index_path.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except (json.JSONDecodeError, OSError):
            return []

    def _save_index(self, records: list[dict]) -> None:
        self._index_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")

    def list_all(self) -> list[GeneratedPDF]:
        """List all records from index; add any PDFs on disk not in index (legacy)."""
        index = self._load_index()
        by_name = {d["filename"]: _dict_to_record(d, self.output_dir) for d in index if d.get("filename")}
        for pdf_path in self.output_dir.glob("*.pdf"):
            if pdf_path.name not in by_name:
                by_name[pdf_path.name] = GeneratedPDF(
                    path=pdf_path,
                    source_checksum="",
                    company=pdf_path.stem.replace("_", " ").title(),
                    job_title="",
                    timestamp=datetime.fromtimestamp(pdf_path.stat().st_mtime),
                    source_was_pdf=False,
                )
        records = [r for r in by_name.values() if r.path.is_file()]
        records.sort(key=lambda r: r.timestamp, reverse=True)
        return records

    def save_record(self, pdf: GeneratedPDF) -> None:
        """Append or update record in index.json."""
        index = self._load_index()
        new_d = _record_to_dict(pdf)
        index = [d for d in index if d.get("filename") != pdf.path.name]
        index.append(new_d)
        self._save_index(index)

    def save_source_content(self, checksum: str, content: str) -> None:
        """Save original resume content for later download (e.g. as .txt)."""
        path = self.sources_dir / f"{checksum}.txt"
        path.write_text(content, encoding="utf-8")

    def get_source_path(self, checksum: str) -> Path | None:
        """Path to stored original content, or None if not found."""
        p = self.sources_dir / f"{checksum}.txt"
        return p if p.is_file() else None

    def get_record_by_filename(self, filename: str) -> GeneratedPDF | None:
        """Get record by PDF filename."""
        for r in self.list_all():
            if r.path.name == filename:
                return r
        return None

    def delete_record(self, filename: str) -> bool:
        """Remove record from index and delete PDF file. Returns True if deleted."""
        if "/" in filename or "\\" in filename:
            return False
        path = self.output_dir / filename
        index = self._load_index()
        index = [d for d in index if d.get("filename") != filename]
        self._save_index(index)
        if path.is_file():
            path.unlink()
            return True
        return True

    # --- Async methods: use Postgres when DATABASE_URL is set (API only) ---

    async def list_all_async(self, user_id: str | None = None) -> list[GeneratedPDF]:
        """List records; from Postgres when DATABASE_URL set (filter by user_id if given), else from index.json."""
        from hr_breaker.services.db import get_pool, db_list_all

        pool = await get_pool()
        if pool is not None:
            return await db_list_all(pool, self.output_dir, user_id=user_id)
        return await asyncio.to_thread(self.list_all)

    async def save_record_async(self, pdf: GeneratedPDF, user_id: str | None = None) -> None:
        """Save record; to Postgres when DATABASE_URL set (user_id required), else to index.json."""
        from hr_breaker.services.db import get_pool, db_insert

        pool = await get_pool()
        if pool is not None:
            if not user_id:
                raise ValueError("user_id required when using database storage")
            await db_insert(pool, self.output_dir, pdf, user_id)
            return
        await asyncio.to_thread(self.save_record, pdf)

    async def get_record_by_filename_async(self, filename: str, user_id: str | None = None) -> GeneratedPDF | None:
        """Get record by filename; from Postgres when DATABASE_URL set (optionally filter by user_id)."""
        from hr_breaker.services.db import get_pool, db_get_by_filename

        pool = await get_pool()
        if pool is not None:
            return await db_get_by_filename(pool, self.output_dir, filename, user_id=user_id)
        return await asyncio.to_thread(self.get_record_by_filename, filename)

    async def delete_record_async(self, filename: str, user_id: str | None = None) -> bool:
        """Delete record; from Postgres when DATABASE_URL set (optionally require user_id); always delete PDF on disk."""
        from hr_breaker.services.db import get_pool, db_delete

        pool = await get_pool()
        if pool is not None:
            deleted = await db_delete(pool, filename, user_id=user_id)
        else:
            deleted = await asyncio.to_thread(self.delete_record, filename)
        path = self.output_dir / filename
        if path.is_file():
            path.unlink()
        return deleted
