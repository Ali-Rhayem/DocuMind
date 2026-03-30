from typing import Any
import importlib
import os
import re


def _tokenize(text: str) -> set[str]:
    return set(re.findall(r"[a-zA-Z0-9]+", text.lower()))


def _env_enabled(name: str, default: str = "1") -> bool:
    return os.environ.get(name, default).strip().lower() in {"1", "true", "yes", "on"}


class CrossEncoderReranker:
    def __init__(self, model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2") -> None:
        self.model_name = model_name
        self._model = None
        self.enabled = _env_enabled("DOCUMIND_ENABLE_RERANKER", "1")

        if not self.enabled:
            return

        try:
            module = importlib.import_module("sentence_transformers")
            cross_encoder_cls = getattr(module, "CrossEncoder")
            self._model = cross_encoder_cls(model_name)
        except Exception:
            self._model = None

    def rerank(self, query: str, candidates: list[dict[str, Any]], top_n: int = 5) -> list[dict[str, Any]]:
        if not candidates:
            return []

        if self._model is not None:
            pairs = [(query, str(item.get("payload", {}).get("text", ""))) for item in candidates]
            model_scores = self._model.predict(pairs)
            scored = []
            for item, score in zip(candidates, model_scores):
                scored.append({**item, "rerank_score": float(score)})
            scored.sort(key=lambda item: item["rerank_score"], reverse=True)
            return scored[: max(1, top_n)]

        # Fallback reranker when no cross-encoder package/model is available.
        query_tokens = _tokenize(query)
        scored = []
        for item in candidates:
            text = str(item.get("payload", {}).get("text", ""))
            tokens = _tokenize(text)
            overlap = len(query_tokens.intersection(tokens))
            rerank_score = float(overlap) + float(item.get("hybrid_score", 0.0))
            scored.append({**item, "rerank_score": rerank_score})

        scored.sort(key=lambda item: item["rerank_score"], reverse=True)
        return scored[: max(1, top_n)]
