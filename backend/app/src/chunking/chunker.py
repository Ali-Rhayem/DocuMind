from app.src.models.document import Document


def fixed_size_chunk(document: Document, chunk_size: int = 500) -> list[str]:
    """Split text into fixed-size chunks for initial Phase 1 testing."""
    text = document.text
    if not text:
        return []
    return [text[i : i + chunk_size] for i in range(0, len(text), chunk_size)]
