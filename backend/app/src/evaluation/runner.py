from __future__ import annotations

from pathlib import Path
from typing import Any

from app.src.evaluation.metrics import mrr, ndcg_at_k, precision_at_k, recall_at_k
from app.src.rag.pipeline import build_index, query_index


ChunkStrategy = str


def _extract_predicted_ids(results: list[dict[str, Any]]) -> list[str]:
    return [str(item.get("id", "")) for item in results if item.get("id") is not None]


def run_experiment_grid(
    data_dir: Path,
    queries: list[dict[str, Any]],
    chunk_sizes: list[int],
    chunk_strategies: list[ChunkStrategy],
    k: int = 5,
    collection_name: str = "documents",
) -> dict[str, Any]:
    if not queries:
        return {"runs": [], "best_run": None}

    runs: list[dict[str, Any]] = []

    for chunk_size in chunk_sizes:
        for strategy in chunk_strategies:
            build_result = build_index(
                data_dir=data_dir,
                chunk_size=chunk_size,
                collection_name=collection_name,
                chunk_strategy=strategy,
            )

            aggregate_precision = 0.0
            aggregate_recall = 0.0
            aggregate_mrr = 0.0
            aggregate_ndcg = 0.0
            evaluated = 0
            per_query: list[dict[str, Any]] = []

            for item in queries:
                query_text = str(item.get("query", "")).strip()
                relevant = {str(x) for x in item.get("relevant_ids", [])}
                if not query_text:
                    continue

                response = query_index(query=query_text, k=k, collection_name=collection_name)
                predicted_ids = _extract_predicted_ids(list(response.get("results", [])))

                p_at_k = precision_at_k(relevant_ids=relevant, predicted_ids=predicted_ids, k=k)
                r_at_k = recall_at_k(relevant_ids=relevant, predicted_ids=predicted_ids, k=k)
                q_mrr = mrr(relevant_ids=relevant, predicted_ids=predicted_ids)
                q_ndcg = ndcg_at_k(relevant_ids=relevant, predicted_ids=predicted_ids, k=k)

                aggregate_precision += p_at_k
                aggregate_recall += r_at_k
                aggregate_mrr += q_mrr
                aggregate_ndcg += q_ndcg
                evaluated += 1

                per_query.append(
                    {
                        "query": query_text,
                        "precision_at_k": round(p_at_k, 6),
                        "recall_at_k": round(r_at_k, 6),
                        "mrr": round(q_mrr, 6),
                        "ndcg_at_k": round(q_ndcg, 6),
                        "predicted_ids": predicted_ids,
                    }
                )

            count = max(1, evaluated)
            run = {
                "chunk_size": chunk_size,
                "chunk_strategy": strategy,
                "k": k,
                "indexed_chunks": int(build_result.get("indexed_chunks", 0)),
                "metrics": {
                    "precision_at_k": round(aggregate_precision / count, 6),
                    "recall_at_k": round(aggregate_recall / count, 6),
                    "mrr": round(aggregate_mrr / count, 6),
                    "ndcg_at_k": round(aggregate_ndcg / count, 6),
                },
                "queries": per_query,
            }
            runs.append(run)

    best_run = None
    if runs:
        best_run = sorted(
            runs,
            key=lambda item: (
                float(item["metrics"]["mrr"]),
                float(item["metrics"]["ndcg_at_k"]),
                float(item["metrics"]["precision_at_k"]),
            ),
            reverse=True,
        )[0]

    return {
        "runs": runs,
        "best_run": best_run,
    }
