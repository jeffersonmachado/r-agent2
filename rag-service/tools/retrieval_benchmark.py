"""
Benchmark de recuperação A/B/C no corpus REAL (FASE 10 da missão).

Compara, para as mesmas consultas rotuladas:
  A) semântica pura (pgvector/HNSW ou exato, conforme plano)
  B) lexical pura (PostgreSQL FTS, pt)
  C) híbrida (RRF semântica+lexical)

Conjunto rotulado: cada consulta aponta o documento do corpus que DEVE ser
recuperado (rótulo derivado de `config/rag-canonical-knowledge.json`, cujas
fontes são verificadas por `npm run validate:rag-ingestion-proof`). Perguntas
com identificador/sigla entram de propósito: é onde o vetorial perde.

Uso (dentro de rag-service, com o env do serviço):
    ./venv/bin/python -m tools.retrieval_benchmark [--k 6] [--json /tmp/out.json]

Somente LEITURA: nenhum documento, chunk ou índice é alterado.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.embedding_service import generate_embedding  # noqa: E402
from services.vector_store import get_vector_store  # noqa: E402

TENANT = "system"
SCOPE = {"domain": "OPERATIONAL", "classifications": ["PRODUCTION"]}

# Consultas rotuladas: (pergunta, documento esperado no top-k).
# As três últimas são de propósito "lexicais" (termo exato/identificador), o
# cenário em que a busca semântica costuma falhar.
QUERIES: List[Dict[str, str]] = [
    {"question": "O que é o RAP?", "expected": "src-docs-manual-sobre-a-plataforma-md"},
    {"question": "Qual é o índice da documentação operacional?", "expected": "src-docs-documentacao-operacional-indice-md"},
    {"question": "Como faço uma matrícula de aluno novo na academia?", "expected": "src-docs-manual-journeys-fitness-html"},
    {"question": "Como funciona o check-in diário na academia?", "expected": "src-docs-manual-verticals-fitness-html"},
    {"question": "Quais são as jornadas de beleza?", "expected": "src-docs-manual-journeys-beauty-html"},
    {"question": "Jornada de novo cliente em fitness", "expected": "src-docs-roteiros-jornada-fitness-fitness-new-customer-md"},
    {"question": "Quais são os casos de uso operacionais?", "expected": "src-docs-casos-de-uso-md"},
    {"question": "Como acessar as funcionalidades da plataforma?", "expected": "src-docs-como-acessar-funcionalidades-md"},
]


def _ids(chunks) -> List[str]:
    return [str(chunk.documentId) for chunk in chunks]


def _metrics(ranked_ids: List[str], expected: str, k: int) -> Dict[str, Any]:
    top = ranked_ids[:k]
    try:
        position = top.index(expected) + 1
    except ValueError:
        position = None
    return {
        "hit": position is not None,
        "position": position,
        # MRR usa a posição real (1-based) quando há acerto.
        "reciprocalRank": (1.0 / position) if position else 0.0,
    }


def run(k: int) -> Dict[str, Any]:
    store = get_vector_store(TENANT)
    strategies = ("semantic", "lexical", "hybrid")
    per_strategy: Dict[str, List[Dict[str, Any]]] = {s: [] for s in strategies}
    latencies: Dict[str, List[float]] = {s: [] for s in strategies}

    for item in QUERIES:
        question = item["question"]
        expected = item["expected"]
        embedding = generate_embedding(question)

        started = time.perf_counter()
        semantic = store.search(embedding, top_k=k, scope=SCOPE)
        lat_semantic = (time.perf_counter() - started) * 1000

        started = time.perf_counter()
        lexical = store.lexical_search(question, top_k=k, scope=SCOPE)
        lat_lexical = (time.perf_counter() - started) * 1000

        started = time.perf_counter()
        hybrid = store.search_hybrid(question, embedding, top_k=k, scope=SCOPE)
        lat_hybrid = (time.perf_counter() - started) * 1000

        per_strategy["semantic"].append({**item, **_metrics(_ids(semantic), expected, k)})
        per_strategy["lexical"].append({**item, **_metrics(_ids(lexical), expected, k)})
        per_strategy["hybrid"].append({**item, **_metrics(_ids(hybrid["chunks"]), expected, k)})
        latencies["semantic"].append(lat_semantic)
        latencies["lexical"].append(lat_lexical)
        latencies["hybrid"].append(lat_hybrid)

    summary: Dict[str, Any] = {}
    for strategy in strategies:
        rows = per_strategy[strategy]
        hits = sum(1 for row in rows if row["hit"])
        summary[strategy] = {
            f"recall@{k}": round(hits / len(rows), 4),
            "mrr": round(statistics.fmean(row["reciprocalRank"] for row in rows), 4),
            "latencyMsP50": round(statistics.median(latencies[strategy]), 1),
            "latencyMsMax": round(max(latencies[strategy]), 1),
            "misses": [row["question"] for row in rows if not row["hit"]],
        }

    return {
        "tenant": TENANT,
        "scope": SCOPE,
        "k": k,
        "queries": len(QUERIES),
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "summary": summary,
        "detail": per_strategy,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--k", type=int, default=6)
    parser.add_argument("--json", type=str, default=None)
    args = parser.parse_args()

    report = run(args.k)

    print(f"corpus real | tenant={report['tenant']} | consultas rotuladas={report['queries']} | k={report['k']}")
    print(f"{'estratégia':<10} {'recall@k':>9} {'MRR':>7} {'p50(ms)':>9} {'max(ms)':>8}")
    for strategy, data in report["summary"].items():
        print(
            f"{strategy:<10} {data[f'recall@{report['k']}']:>9.3f} {data['mrr']:>7.3f} "
            f"{data['latencyMsP50']:>9.1f} {data['latencyMsMax']:>8.1f}"
        )
    for strategy, data in report["summary"].items():
        if data["misses"]:
            print(f"  {strategy}: {len(data['misses'])} sem acerto -> {data['misses']}")

    if args.json:
        Path(args.json).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"relatório: {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
