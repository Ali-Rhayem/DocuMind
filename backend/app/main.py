from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi import HTTPException
from pathlib import Path
from pydantic import BaseModel, Field

from app.src.ingestion.loader import load_documents
from app.src.ocr.service import extract_text_from_image
from app.src.rag.pipeline import run_pipeline

app = FastAPI(title="DocuMind API", version="0.1.0")


class QueryRequest(BaseModel):
    query: str = Field(min_length=1)
    k: int = Field(default=3, ge=1, le=20)
    chunk_size: int = Field(default=500, ge=100, le=2000)


class OCRRequest(BaseModel):
    file_name: str = Field(min_length=1)

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
    return run_pipeline(
        query=request.query,
        data_dir=data_dir,
        k=request.k,
        chunk_size=request.chunk_size,
    )


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
