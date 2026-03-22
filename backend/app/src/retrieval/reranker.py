from typing import Any
import importlib
import re


def _tokenize(text: str) -> set[str]:
    return set(re.findall(r"[a-zA-Z0-9]+", text.lower()))


class CrossEncoderReranker:
    def __init__(self, model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2") -> None:
        self.model_name = model_name
        self._model = None
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
