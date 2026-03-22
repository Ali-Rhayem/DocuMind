from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.src.models.document import Document
from app.src.ocr.service import extract_text_from_image, extract_text_with_ocr, is_supported_image

SUPPORTED_TEXT_EXTENSIONS = {".txt", ".md"}
SUPPORTED_PDF_EXTENSIONS = {".pdf"}
SUPPORTED_EXTENSIONS = SUPPORTED_TEXT_EXTENSIONS | SUPPORTED_PDF_EXTENSIONS


def read_file(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported extension '{path.suffix}' for file '{path.name}'. "
            f"Supported: {sorted(SUPPORTED_EXTENSIONS)}"
        )

    if suffix in SUPPORTED_TEXT_EXTENSIONS:
        return path.read_text(encoding="utf-8")

    if suffix in SUPPORTED_PDF_EXTENSIONS:
        import pdfplumber

        pages: list[str] = []
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                extracted = page.extract_text() or ""
                pages.append(extracted)
        return "\n".join(pages)

    return ""


def clean_text(text: str) -> str:
    lines = [line.strip() for line in text.splitlines()]
    return "\n".join(lines).strip()


def _load_pdf_with_ocr_fallback(path: Path) -> tuple[str, dict[str, object]]:
    extracted = read_file(path)
    cleaned = clean_text(extracted)
    if cleaned:
        return cleaned, {"source_kind": "file", "ocr_used": False}

    # Scanned PDFs often have no extractable text layer; fallback to OCR.
    try:
        ocr_result = extract_text_with_ocr(path)
        ocr_text = clean_text(str(ocr_result.get("text", "")))
        return ocr_text, {
            "source_kind": "ocr",
            "ocr_used": True,
            "ocr_avg_confidence": float(ocr_result.get("avg_confidence", 0.0)),
            "ocr_line_count": int(ocr_result.get("line_count", 0)),
        }
    except Exception:
        return "", {"source_kind": "file", "ocr_used": False}


def load_documents(folder_path: Path) -> list[Document]:
    if not folder_path.exists():
        return []

    documents: list[Document] = []

    for path in sorted(folder_path.glob("**/*")):
        if not path.is_file():
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

    return documents
