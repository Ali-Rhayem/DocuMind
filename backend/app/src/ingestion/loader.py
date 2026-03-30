from datetime import datetime, timezone
import hashlib
import logging
import os
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from app.src.models.document import Document
from app.src.ocr.service import extract_text_from_image, extract_text_with_ocr, is_supported_image

_ENABLE_OCR = os.environ.get("DOCUMIND_ENABLE_OCR", "1").strip().lower() in {"1", "true", "yes", "on"}
logger = logging.getLogger(__name__)

SUPPORTED_TEXT_EXTENSIONS = {".txt", ".md"}
SUPPORTED_PDF_EXTENSIONS = {".pdf"}
SUPPORTED_EXTENSIONS = SUPPORTED_TEXT_EXTENSIONS | SUPPORTED_PDF_EXTENSIONS
_PDFMINER_LOGGER = logging.getLogger("pdfminer")


def read_file(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported extension '{path.suffix}' for file '{path.name}'. "
            f"Supported: {sorted(SUPPORTED_EXTENSIONS)}"
        )

    if suffix in SUPPORTED_TEXT_EXTENSIONS:
        logger.debug(f"Reading text file: {path.name}")
        return path.read_text(encoding="utf-8")

    if suffix in SUPPORTED_PDF_EXTENSIONS:
        import pdfplumber

        logger.debug(f"Opening PDF: {path.name}")
        start_time = perf_counter()
        pages: list[str] = []
        previous_level = _PDFMINER_LOGGER.level
        _PDFMINER_LOGGER.setLevel(logging.ERROR)
        try:
            with pdfplumber.open(path) as pdf:
                page_count = len(pdf.pages)
                logger.debug(f"PDF has {page_count} pages")
                for idx, page in enumerate(pdf.pages, 1):
                    extracted = page.extract_text() or ""
                    pages.append(extracted)
                    logger.debug(f"Extracted page {idx}/{page_count}: {len(extracted)} chars")
        finally:
            _PDFMINER_LOGGER.setLevel(previous_level)
        elapsed = perf_counter() - start_time
        logger.info(f"PDF extraction took {elapsed:.2f}s for {page_count} pages")
        return "\n".join(pages)

    return ""


def clean_text(text: str) -> str:
    lines = [line.strip() for line in text.splitlines()]
    return "\n".join(lines).strip()


def _file_signature(path: Path) -> str:
    """Create a stable content signature for dedupe and incremental indexing."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def collect_file_signatures(folder_path: Path) -> dict[str, str]:
    """Return signatures for supported files without parsing document contents."""
    if not folder_path.exists():
        return {}

    signatures: dict[str, str] = {}
    for path in sorted(folder_path.glob("**/*")):
        if not path.is_file():
            continue

        suffix = path.suffix.lower()
        if suffix in SUPPORTED_TEXT_EXTENSIONS or suffix in SUPPORTED_PDF_EXTENSIONS or is_supported_image(path):
            signatures[path.name] = _file_signature(path)

    return signatures


def _load_pdf_with_ocr_fallback(path: Path) -> tuple[str, dict[str, object]]:
    extracted = read_file(path)
    cleaned = clean_text(extracted)
    if cleaned:
        logger.info(f"PDF {path.name}: extracted {len(cleaned)} chars from digital text layer")
        return cleaned, {"source_kind": "file", "ocr_used": False}

    # Scanned PDFs often have no extractable text layer; fallback to OCR if enabled.
    if not _ENABLE_OCR:
        logger.info(f"PDF {path.name}: no digital text and OCR disabled, skipping")
        return "", {"source_kind": "file", "ocr_used": False, "ocr_skipped": True}

    try:
        logger.info(f"PDF {path.name}: no digital text, running OCR...")
        start_ocr = perf_counter()
        ocr_result = extract_text_with_ocr(path)
        elapsed_ocr = perf_counter() - start_ocr
        ocr_text = clean_text(str(ocr_result.get("text", "")))
        logger.info(f"PDF {path.name}: OCR completed in {elapsed_ocr:.2f}s, extracted {len(ocr_text)} chars, confidence: {ocr_result.get('avg_confidence', 0.0):.2f}")
        return ocr_text, {
            "source_kind": "ocr",
            "ocr_used": True,
            "ocr_avg_confidence": float(ocr_result.get("avg_confidence", 0.0)),
            "ocr_line_count": int(ocr_result.get("line_count", 0)),
        }
    except Exception as e:
        logger.error(f"PDF {path.name}: OCR failed - {str(e)}")
        return "", {"source_kind": "file", "ocr_used": False}


def load_documents(folder_path: Path, include_files: set[str] | None = None) -> list[Document]:
    if not folder_path.exists():
        logger.warning(f"Data folder does not exist: {folder_path}")
        return []

    logger.info(f"Loading documents from {folder_path}")
    start_load = perf_counter()
    documents: list[Document] = []

    for path in sorted(folder_path.glob("**/*")):
        if not path.is_file():
            continue

        if include_files is not None and path.name not in include_files:
            continue

        suffix = path.suffix.lower()
        raw_text = ""
        extra_meta: dict[str, object] = {}

        if suffix in SUPPORTED_TEXT_EXTENSIONS:
            raw_text = read_file(path)
            extra_meta = {"source_kind": "file", "ocr_used": False}
        elif suffix in SUPPORTED_PDF_EXTENSIONS:
            raw_text, extra_meta = _load_pdf_with_ocr_fallback(path)
        elif is_supported_image(path):
            try:
                ocr_result = extract_text_from_image(path)
                raw_text = str(ocr_result.get("text", ""))
                extra_meta = {
                    "source_kind": "ocr",
                    "ocr_used": True,
                    "ocr_avg_confidence": float(ocr_result.get("avg_confidence", 0.0)),
                    "ocr_line_count": int(ocr_result.get("line_count", 0)),
                }
            except Exception:
                continue
        else:
            continue

        cleaned = clean_text(raw_text)
        if not cleaned:
            continue

        stat = path.stat()
        metadata: dict[str, object] = {
            "filename": path.name,
            "extension": suffix,
            "size_bytes": stat.st_size,
            "file_signature": _file_signature(path),
            "loaded_at": datetime.now(timezone.utc).isoformat(),
        }
        metadata.update(extra_meta)

        doc = Document(
            id=str(uuid4()),
            source=str(path),
            text=cleaned,
            metadata=metadata,
        )
        documents.append(doc)
        logger.debug(f"Loaded {path.name}: {len(cleaned)} chars")

    elapsed_load = perf_counter() - start_load
    logger.info(f"Loaded {len(documents)} document(s) in {elapsed_load:.2f}s")
    return documents
