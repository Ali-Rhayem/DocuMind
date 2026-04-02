from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi import File, HTTPException, UploadFile
from fastapi.responses import FileResponse
import hashlib
import logging
import os
from pathlib import Path
from time import perf_counter
from pydantic import BaseModel, Field
from typing import Literal, Any
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from app.src.evaluation.runner import run_experiment_grid
from app.src.ingestion.loader import SUPPORTED_PDF_EXTENSIONS, SUPPORTED_TEXT_EXTENSIONS
from app.src.ocr.service import extract_text_from_image
from app.src.ocr.service import is_supported_image
from app.src.rag.pipeline import build_index, query_index
from app.src.vector_store.store import QdrantVectorStore

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logging.getLogger("pdfminer").setLevel(logging.ERROR)  # Suppress pdfminer debug logs

app = FastAPI(title="DocuMind API", version="0.1.0")
_ENABLE_EVALUATION = os.environ.get("DOCUMIND_ENABLE_EVALUATION", "0").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
_DEFAULT_CORS_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")
_DEFAULT_CORS_ORIGIN_REGEX = (
    r"^https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|"
    r"172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$"
)


def _parse_cors_origins(raw_value: str | None) -> list[str]:
    if not raw_value:
        return list(_DEFAULT_CORS_ORIGINS)

    origins: list[str] = []
    for origin in raw_value.split(","):
        cleaned = origin.strip().rstrip("/")
        if cleaned:
            origins.append(cleaned)

    return origins or list(_DEFAULT_CORS_ORIGINS)


def _resolve_cors_origin_regex() -> str:
    raw_value = os.environ.get("DOCUMIND_CORS_ORIGIN_REGEX")
    if raw_value and raw_value.strip():
        return raw_value.strip()
    return _DEFAULT_CORS_ORIGIN_REGEX


ChunkStrategy = Literal["fixed", "sliding", "heading", "semantic"]


class QueryRequest(BaseModel):
    query: str = Field(min_length=1)
    k: int = Field(default=3, ge=1, le=20)
    chunk_size: int = Field(default=500, ge=100, le=2000)
    chunk_strategy: ChunkStrategy = "fixed"
    overlap: int = Field(default=100, ge=0, le=1500)
    build_if_empty: bool = False


class IndexRequest(BaseModel):
    chunk_size: int = Field(default=500, ge=100, le=2000)
    chunk_strategy: ChunkStrategy = "fixed"
    overlap: int = Field(default=100, ge=0, le=1500)


class OCRRequest(BaseModel):
    file_name: str = Field(min_length=1)


class EvaluationQuery(BaseModel):
    query: str = Field(min_length=1)
    relevant_ids: list[str] = Field(default_factory=list)


class EvaluationRequest(BaseModel):
    chunk_sizes: list[int] = Field(default_factory=lambda: [300, 500])
    chunk_strategies: list[ChunkStrategy] = Field(default_factory=lambda: ["fixed", "semantic", "sliding"])
    k: int = Field(default=5, ge=1, le=50)
    queries: list[EvaluationQuery]


def _is_supported_upload(filename: str) -> bool:
    suffix = Path(filename).suffix.lower()
    return suffix in SUPPORTED_TEXT_EXTENSIONS or suffix in SUPPORTED_PDF_EXTENSIONS or is_supported_image(Path(filename))


def _sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _indexed_file_stats() -> tuple[set[str], dict[str, int]]:
    try:
        store = QdrantVectorStore(collection_name="documents", vector_size=1)
        payloads = store.all_payloads()
    except RuntimeError:
        return set(), {}

    indexed_names: set[str] = set()
    indexed_chunks: dict[str, int] = {}

    for payload in payloads:
        metadata = payload.get("metadata") or {}
        source_file = str(
            payload.get("source_file")
            or metadata.get("filename")
            or Path(str(payload.get("source", ""))).name
        )
        if not source_file:
            continue
        indexed_names.add(source_file)
        indexed_chunks[source_file] = indexed_chunks.get(source_file, 0) + 1

    return indexed_names, indexed_chunks

app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins(os.environ.get("DOCUMIND_CORS_ORIGINS")),
    allow_origin_regex=_resolve_cors_origin_regex(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "DocuMind backend is running"}


@app.get("/files/{file_name}")
def get_file(file_name: str) -> FileResponse:
    """
    Serve a file from the data directory.
    file_name should be URL-safe. Supports PDFs, images, and text files.
    """
    # Prevent directory traversal attacks
    if ".." in file_name or file_name.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid file name")
    
    data_dir = Path(__file__).resolve().parent.parent / "data"
    file_path = data_dir / file_name
    
    # Ensure the file is within the data directory
    try:
        file_path = file_path.resolve()
        if not file_path.is_relative_to(data_dir.resolve()):
            raise HTTPException(status_code=403, detail="Access denied")
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    if not file_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")
    
    return FileResponse(file_path)


@app.get("/ingestion/preview")
def ingestion_preview() -> dict[str, object]:
    """List files in data directory without parsing them (fast, no disk I/O)."""
    data_dir = Path(__file__).resolve().parents[1] / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    indexed_names, indexed_chunks = _indexed_file_stats()

    files = []
    for file_path in sorted(data_dir.iterdir()):
        if file_path.is_file():
            size_mb = file_path.stat().st_size / (1024 ** 2)
            files.append({
                "name": file_path.name,
                "type": file_path.suffix[1:] if file_path.suffix else "unknown",
                "size_mb": round(size_mb, 2),
                "indexed": file_path.name in indexed_names,
                "indexed_chunks": indexed_chunks.get(file_path.name, 0),
            })

    return {
        "count": len(files),
        "documents": files,
    }


@app.post("/ingestion/upload")
async def ingestion_upload(files: list[UploadFile] = File(...)) -> dict[str, object]:
    logger.info(f"Upload request: {len(files)} file(s)")
    start_upload = perf_counter()
    data_dir = Path(__file__).resolve().parents[1] / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    if not files:
        raise HTTPException(status_code=400, detail="At least one file is required.")

    uploaded: list[dict[str, object]] = []
    skipped: list[dict[str, str]] = []
    rejected: list[dict[str, str]] = []

    for upload in files:
        original_name = Path(upload.filename or "").name
        if not original_name:
            rejected.append({"filename": "", "reason": "Missing filename."})
            continue

        if not _is_supported_upload(original_name):
            rejected.append({"filename": original_name, "reason": "Unsupported file type."})
            continue

        destination = data_dir / original_name
        content = await upload.read()
        incoming_hash = _sha256_bytes(content)

        action = "created"
        if destination.exists():
            current_hash = _sha256_file(destination)
            if current_hash == incoming_hash:
                skipped.append({"filename": original_name, "reason": "Duplicate file already exists."})
                continue
            action = "replaced"

        destination.write_bytes(content)
        size_mb = len(content) / (1024 * 1024)
        logger.info(f"Saved {original_name}: {size_mb:.2f} MB ({action})")

        uploaded.append(
            {
                "filename": destination.name,
                "size_bytes": len(content),
                "path": str(destination),
                "action": action,
            }
        )

    if not uploaded and not skipped:
        raise HTTPException(
            status_code=400,
            detail="No supported files were uploaded. Use txt, md, pdf, or supported image formats.",
        )

    elapsed = perf_counter() - start_upload
    logger.info(f"Upload complete: {len(uploaded)} file(s), {elapsed:.2f}s total")
    return {
        "status": "ok",
        "uploaded_count": len(uploaded),
        "uploaded": uploaded,
        "skipped": skipped,
        "rejected": rejected,
    }


@app.delete("/ingestion/files/{file_name}")
def delete_ingested_file(file_name: str) -> dict[str, object]:
    data_dir = Path(__file__).resolve().parents[1] / "data"
    target = (data_dir / file_name).resolve()

    if target.parent != data_dir.resolve():
        raise HTTPException(status_code=400, detail="Invalid file path.")

    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found.")

    removed_chunks = 0
    try:
        store = QdrantVectorStore(collection_name="documents", vector_size=1)
        payloads = store.all_payloads()
        chunk_ids = [
            str(payload.get("id"))
            for payload in payloads
            if (
                str(payload.get("source_file") or (payload.get("metadata") or {}).get("filename") or "") == file_name
                or Path(str(payload.get("source", ""))).name == file_name
            )
            and payload.get("id")
        ]
        if chunk_ids:
            removed_chunks = store.delete_ids(chunk_ids)
    except RuntimeError:
        removed_chunks = 0

    target.unlink(missing_ok=False)
    logger.info(f"Deleted file {file_name} and removed {removed_chunks} indexed chunks")
    return {
        "status": "ok",
        "deleted_file": file_name,
        "removed_chunks": removed_chunks,
    }


@app.post("/rag/query")
def rag_query(request: QueryRequest) -> dict[str, object]:
    data_dir = Path(__file__).resolve().parents[1] / "data"
    started_at = perf_counter()
    try:
        store_probe = QdrantVectorStore(collection_name="documents", vector_size=1)
        if request.build_if_empty and store_probe.count() == 0:
            build_index(
                data_dir=data_dir,
                chunk_size=request.chunk_size,
                collection_name="documents",
                chunk_strategy=request.chunk_strategy,
                overlap=request.overlap,
            )
        response = query_index(query=request.query, k=request.k, collection_name="documents")
        response["latency_ms"] = round((perf_counter() - started_at) * 1000, 2)
        return response
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/index/rebuild")
def rebuild_index(request: IndexRequest) -> dict[str, object]:
    logger.info(f"Rebuild request: strategy={request.chunk_strategy}, chunk_size={request.chunk_size}")
    data_dir = Path(__file__).resolve().parents[1] / "data"
    try:
        result = build_index(
            data_dir=data_dir,
            chunk_size=request.chunk_size,
            collection_name="documents",
            chunk_strategy=request.chunk_strategy,
            overlap=request.overlap,
        )
        logger.info(f"Rebuild result: {result.get('indexed_chunks')} chunks indexed")
        return result
    except RuntimeError as exc:
        logger.error(f"Rebuild failed: {str(exc)}")
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/index/stats")
def index_stats() -> dict[str, object]:
    try:
        store = QdrantVectorStore(collection_name="documents", vector_size=1)
        payloads = store.all_payloads()
        source_count = len({str(item.get("source", "")) for item in payloads if item.get("source")})
        indexed_chunks = store.count()
        return {
            "collection": "documents",
            "indexed_chunks": indexed_chunks,
            "source_count": source_count,
            "status": "ready" if indexed_chunks > 0 else "empty",
        }
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/evaluation/run")
def run_evaluation(request: EvaluationRequest) -> dict[str, Any]:
    if not _ENABLE_EVALUATION:
        raise HTTPException(
            status_code=403,
            detail="Evaluation endpoint is disabled. Set DOCUMIND_ENABLE_EVALUATION=1 to enable.",
        )

    data_dir = Path(__file__).resolve().parents[1] / "data"
    if not request.queries:
        raise HTTPException(status_code=400, detail="At least one evaluation query is required.")

    queries = [
        {
            "query": item.query,
            "relevant_ids": item.relevant_ids,
        }
        for item in request.queries
    ]

    try:
        return run_experiment_grid(
            data_dir=data_dir,
            queries=queries,
            chunk_sizes=request.chunk_sizes,
            chunk_strategies=request.chunk_strategies,
            k=request.k,
            collection_name="documents",
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/evaluation/status")
def evaluation_status() -> dict[str, object]:
    return {
        "enabled": _ENABLE_EVALUATION,
        "status": "ready" if _ENABLE_EVALUATION else "locked",
        "message": (
            "Evaluation endpoint is enabled. Provide labeled queries with relevant_ids to generate metrics."
            if _ENABLE_EVALUATION
            else "Evaluation endpoint is disabled. Set DOCUMIND_ENABLE_EVALUATION=1 to enable."
        ),
    }


@app.post("/ocr/extract")
def ocr_extract(request: OCRRequest) -> dict[str, object]:
    data_dir = Path(__file__).resolve().parents[1] / "data"
    image_path = (data_dir / request.file_name).resolve()

    if image_path.parent != data_dir.resolve():
        raise HTTPException(status_code=400, detail="Invalid file path.")

    try:
        return extract_text_from_image(image_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
