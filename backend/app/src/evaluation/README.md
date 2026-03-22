# Evaluation Module

This module compares retrieval quality across chunking configurations.

## Metrics

- `precision@k`
- `recall@k`
- `mrr`
- `ndcg@k`

## Quick Run

From `backend/`:

```powershell
..\venv\Scripts\python.exe scripts\run_experiment.py
```

Or use API endpoint:

`POST /evaluation/run`
