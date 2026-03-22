from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi import HTTPException
import os
from pathlib import Path
from pydantic import BaseModel, Field
from typing import Literal, Any

from app.src.evaluation.runner import run_experiment_grid
from app.src.ingestion.loader import load_documents
from app.src.ocr.service import extract_text_from_image
from app.src.rag.pipeline import build_index, query_index
from app.src.vector_store.store import QdrantVectorStore

app = FastAPI(title="DocuMind API", version="0.1.0")
_ENABLE_EVALUATION = os.environ.get("DOCUMIND_ENABLE_EVALUATION", "0").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


ChunkStrategy = Literal["fixed", "sliding", "heading", "semantic"]


class QueryRequest(BaseModel):
    query: str = Field(min_length=1)
    k: int = Field(default=3, ge=1, le=20)
    chunk_size: int = Field(default=500, ge=100, le=2000)
    chunk_strategy: ChunkStrategy = "fixed"
    overlap: int = Field(default=100, ge=0, le=1500)
    build_if_empty: bool = True


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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
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


@app.get("/ingestion/preview")
def ingestion_preview() -> dict[str, object]:
    data_dir = Path(__file__).resolve().parents[1] / "data"
    documents = load_documents(data_dir)
    return {
        "count": len(documents),
        "documents": [doc.model_dump(exclude={"text"}) for doc in documents],
    }


@app.post("/rag/query")
def rag_query(request: QueryRequest) -> dict[str, object]:
    data_dir = Path(__file__).resolve().parents[1] / "data"
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
        return query_index(query=request.query, k=request.k, collection_name="documents")
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/index/rebuild")
def rebuild_index(request: IndexRequest) -> dict[str, object]:
    data_dir = Path(__file__).resolve().parents[1] / "data"
    try:
        return build_index(
            data_dir=data_dir,
            chunk_size=request.chunk_size,
            collection_name="documents",
            chunk_strategy=request.chunk_strategy,
            overlap=request.overlap,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/index/stats")
def index_stats() -> dict[str, object]:
    try:
        store = QdrantVectorStore(collection_name="documents", vector_size=1)
        return {
            "collection": "documents",
            "indexed_chunks": store.count(),
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
