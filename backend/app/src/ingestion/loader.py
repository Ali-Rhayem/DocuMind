from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.src.models.document import Document

SUPPORTED_EXTENSIONS = {".txt", ".md"}


def read_file(path: Path) -> str:
    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported extension '{path.suffix}' for file '{path.name}'. "
            f"Supported: {sorted(SUPPORTED_EXTENSIONS)}"
        )
    return path.read_text(encoding="utf-8")


def clean_text(text: str) -> str:
    lines = [line.strip() for line in text.splitlines()]
    return "\n".join(lines).strip()


def load_documents(folder_path: Path) -> list[Document]:
    if not folder_path.exists():
        return []

    documents: list[Document] = []

    for path in sorted(folder_path.glob("**/*")):
        if not path.is_file():
            continue

        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue

        raw_text = read_file(path)
        cleaned = clean_text(raw_text)

        if not cleaned:
            continue

        stat = path.stat()
        doc = Document(
            id=str(uuid4()),
            source=str(path),
            text=cleaned,
            metadata={
                "filename": path.name,
                "extension": path.suffix.lower(),
                "size_bytes": stat.st_size,
                "loaded_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        documents.append(doc)

    return documents
