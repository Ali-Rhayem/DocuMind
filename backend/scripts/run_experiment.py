from __future__ import annotations

from pathlib import Path

from app.src.evaluation.runner import run_experiment_grid


def main() -> None:
    data_dir = Path(__file__).resolve().parents[1] / "data"

    # Replace relevant_ids with real chunk IDs from your dataset.
    queries = [
        {
            "query": "what is documind",
            "relevant_ids": [],
        }
    ]

    report = run_experiment_grid(
        data_dir=data_dir,
        queries=queries,
        chunk_sizes=[300, 500],
        chunk_strategies=["fixed", "sliding", "semantic", "heading"],
        k=5,
        collection_name="documents",
    )

    print(report)


if __name__ == "__main__":
    main()
