from app.src.models.document import Document
import re


def fixed_size_chunk(document: Document, chunk_size: int = 500) -> list[str]:
    """Split text into fixed-size chunks for initial Phase 1 testing."""
    text = document.text
    if not text:
        return []
    return [text[i : i + chunk_size] for i in range(0, len(text), chunk_size)]


def sliding_window_chunk(document: Document, chunk_size: int = 500, overlap: int = 100) -> list[str]:
    text = document.text
    if not text:
        return []

    step = max(1, chunk_size - max(0, overlap))
    chunks: list[str] = []
    for start in range(0, len(text), step):
        piece = text[start : start + chunk_size].strip()
        if piece:
            chunks.append(piece)
        if start + chunk_size >= len(text):
            break
    return chunks


def heading_based_chunk(document: Document, chunk_size: int = 500) -> list[str]:
    text = document.text
    if not text:
        return []

    lines = text.splitlines()
    sections: list[str] = []
    current: list[str] = []

    for line in lines:
        stripped = line.strip()
        is_heading = stripped.startswith("#") or bool(re.match(r"^[A-Z][A-Za-z0-9\s\-:]{2,}$", stripped))
        if is_heading and current:
            sections.append("\n".join(current).strip())
            current = [stripped]
        else:
            current.append(stripped)

    if current:
        sections.append("\n".join(current).strip())

    # Re-split very long sections so retrieval still works predictably.
    chunks: list[str] = []
    for section in sections:
        if len(section) <= chunk_size:
            if section:
                chunks.append(section)
            continue
        chunks.extend([section[i : i + chunk_size] for i in range(0, len(section), chunk_size)])
    return chunks


def semantic_chunk(document: Document, chunk_size: int = 500) -> list[str]:
    text = document.text
    if not text:
        return []

    # Lightweight semantic grouping by sentence boundaries.
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    chunks: list[str] = []
    current = ""

    for sentence in sentences:
        candidate = f"{current} {sentence}".strip() if current else sentence
        if len(candidate) <= chunk_size:
            current = candidate
        else:
            if current:
                chunks.append(current)
            if len(sentence) <= chunk_size:
                current = sentence
            else:
                # If a single sentence is huge, split defensively.
                pieces = [sentence[i : i + chunk_size] for i in range(0, len(sentence), chunk_size)]
                chunks.extend(pieces[:-1])
                current = pieces[-1]

    if current:
        chunks.append(current)

    return chunks


def chunk_document(
    document: Document,
    chunk_size: int = 500,
    strategy: str = "fixed",
    overlap: int = 100,
) -> list[str]:
    if strategy == "fixed":
        return fixed_size_chunk(document=document, chunk_size=chunk_size)
    if strategy == "sliding":
        return sliding_window_chunk(document=document, chunk_size=chunk_size, overlap=overlap)
    if strategy == "heading":
        return heading_based_chunk(document=document, chunk_size=chunk_size)
    if strategy == "semantic":
        return semantic_chunk(document=document, chunk_size=chunk_size)
    raise ValueError(f"Unsupported chunking strategy: {strategy}")
