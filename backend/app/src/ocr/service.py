from pathlib import Path
from typing import Any

_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".webp"}
_OCR_EXTENSIONS = _IMAGE_EXTENSIONS | {".pdf"}
_ocr_engine: Any | None = None


def _get_engine() -> Any:
    global _ocr_engine
    if _ocr_engine is None:
        from paddleocr import PaddleOCR

        # CPU mode is the safest default for local development.
        _ocr_engine = PaddleOCR(use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False)
    return _ocr_engine


def is_supported_image(path: Path) -> bool:
    return path.suffix.lower() in _IMAGE_EXTENSIONS


def is_supported_ocr_source(path: Path) -> bool:
    return path.suffix.lower() in _OCR_EXTENSIONS


def _extract_lines_from_result(result: Any) -> tuple[list[str], list[float]]:
    lines: list[str] = []
    confidences: list[float] = []

    for page in result:
        rec_texts = page.get("rec_texts", [])
        rec_scores = page.get("rec_scores", [])
        for idx, text in enumerate(rec_texts):
            cleaned = str(text).strip()
            if cleaned:
                lines.append(cleaned)
                if idx < len(rec_scores):
                    confidences.append(float(rec_scores[idx]))

    return lines, confidences


def extract_text_with_ocr(path: Path) -> dict[str, Any]:
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"OCR source file not found: {path}")

    if not is_supported_ocr_source(path):
        raise ValueError(
            f"Unsupported OCR extension '{path.suffix}'. Supported: {sorted(_OCR_EXTENSIONS)}"
        )

    engine = _get_engine()
    result = engine.predict(str(path))
    lines, confidences = _extract_lines_from_result(result)
    average_confidence = round(sum(confidences) / len(confidences), 6) if confidences else 0.0

    return {
        "source": str(path),
        "text": "\n".join(lines).strip(),
        "line_count": len(lines),
        "avg_confidence": average_confidence,
    }


def extract_text_from_image(path: Path) -> dict[str, Any]:
    if not is_supported_image(path):
        raise ValueError(
            f"Unsupported image extension '{path.suffix}'. Supported: {sorted(_IMAGE_EXTENSIONS)}"
        )
    return extract_text_with_ocr(path)
