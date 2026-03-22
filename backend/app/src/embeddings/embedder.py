"""Embedding utilities with provider controls.

Provider mode is controlled by DOCUMIND_EMBED_PROVIDER:
1. "auto" (default): OpenAI when OPENAI_API_KEY is set, else local model.
2. "openai": OpenAI embeddings only (falls back on failure).
3. "local": SentenceTransformers local model only.

All modes fall back to a deterministic vector so the pipeline remains runnable.
"""

from __future__ import annotations

import hashlib
import os
from collections import OrderedDict
from typing import Any


_OPENAI_MODEL = os.environ.get("DOCUMIND_OPENAI_EMBED_MODEL", "text-embedding-3-small")
_SBERT_MODEL = os.environ.get("DOCUMIND_SBERT_MODEL", "all-MiniLM-L6-v2")
_EMBED_CACHE_SIZE = int(os.environ.get("DOCUMIND_EMBED_CACHE_SIZE", "2000"))
_EMBED_PROVIDER = os.environ.get("DOCUMIND_EMBED_PROVIDER", "auto").strip().lower()
_sbert_model: Any | None = None
_embed_cache: OrderedDict[str, list[float]] = OrderedDict()


def _cache_key(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _cache_get(text: str) -> list[float] | None:
    key = _cache_key(text)
    value = _embed_cache.get(key)
    if value is not None:
        _embed_cache.move_to_end(key)
    return value


def _cache_put(text: str, vector: list[float]) -> None:
    if not vector:
        return
    key = _cache_key(text)
    _embed_cache[key] = vector
    _embed_cache.move_to_end(key)
    while len(_embed_cache) > max(1, _EMBED_CACHE_SIZE):
        _embed_cache.popitem(last=False)


def _openai_embed(text: str) -> list[float]:
    from openai import OpenAI

    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    response = client.embeddings.create(model=_OPENAI_MODEL, input=text)
    return [float(x) for x in response.data[0].embedding]


def _get_sbert_model() -> Any:
    global _sbert_model
    if _sbert_model is None:
        from sentence_transformers import SentenceTransformer

        _sbert_model = SentenceTransformer(_SBERT_MODEL)
    return _sbert_model


def _sbert_embed(text: str) -> list[float]:
    model = _get_sbert_model()
    vector = model.encode(text)
    return [float(x) for x in vector.tolist()] if hasattr(vector, "tolist") else [float(x) for x in vector]


def _deterministic_fallback_embed(text: str) -> list[float]:
    # Keep the pipeline alive when no remote/local embedding backend is available.
    return [float(len(text)), float(len(text.split()))]


def embed_text(text: str) -> list[float]:
    if not text:
        return []

    cached = _cache_get(text)
    if cached is not None:
        return cached

    vector: list[float]
    wants_openai = _EMBED_PROVIDER == "openai" or (
        _EMBED_PROVIDER == "auto" and bool(os.environ.get("OPENAI_API_KEY"))
    )

    if wants_openai and os.environ.get("OPENAI_API_KEY"):
        try:
            vector = _openai_embed(text)
            _cache_put(text, vector)
            return vector
        except Exception:
            pass

    try:
        vector = _sbert_embed(text)
    except Exception:
        vector = _deterministic_fallback_embed(text)

    _cache_put(text, vector)
    return vector


def get_embedding_dim(sample_text: str = "dimension probe") -> int:
    return len(embed_text(sample_text))


# Backwards-compatible name used elsewhere in the repo.
def fake_embed(text: str) -> list[float]:
    return embed_text(text)
