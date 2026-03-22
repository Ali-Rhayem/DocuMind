from collections import defaultdict
from typing import Any


def reciprocal_rank_fusion(
    vector_hits: list[dict[str, Any]],
    bm25_hits: list[dict[str, Any]],
    top_n: int = 20,
    rrf_k: int = 60,
) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    scores = defaultdict(float)

    for rank, hit in enumerate(vector_hits, start=1):
        hit_id = str(hit.get("id"))
        scores[hit_id] += 1.0 / (rrf_k + rank)
        if hit_id not in merged:
            merged[hit_id] = dict(hit)
        merged[hit_id]["vector_score"] = float(hit.get("score", 0.0))

    for rank, hit in enumerate(bm25_hits, start=1):
        hit_id = str(hit.get("id"))
        scores[hit_id] += 1.0 / (rrf_k + rank)
        if hit_id not in merged:
            merged[hit_id] = dict(hit)
        merged[hit_id]["bm25_score"] = float(hit.get("score", 0.0))

    fused = []
    for hit_id, merged_hit in merged.items():
        fused.append({
            **merged_hit,
            "id": hit_id,
            "hybrid_score": float(scores[hit_id]),
        })

    fused.sort(key=lambda item: item["hybrid_score"], reverse=True)
    return fused[: max(1, top_n)]
