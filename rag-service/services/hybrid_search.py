"""
Fusão híbrida de recuperação (semântica + lexical) por Reciprocal Rank Fusion.

Por que existe
--------------
O retrieval do RAG era only-vetorial: perguntas com identificador exato, sigla,
nome de função ou termo técnico ("replayHash", "checkout", "Fonte 1") têm
similaridade de embedding baixa e ficavam fora do top-k, mesmo com o termo
literal presente no corpus. O inverso também ocorre: o vetorial aproxima
assuntos, mas perde a precisão lexical.

Fusão por RRF (em vez de média de scores)
-----------------------------------------
`embedding <=> q` produz DISTÂNCIA de cosseno e `ts_rank_cd` produz um score
textual de escala completamente diferente. Somar/pesar diretamente compara
grandezas incommensuráveis. RRF usa apenas a POSIÇÃO de cada item em cada
ranking:

    RRF(d) = w_sem / (k + rank_sem(d)) + w_lex / (k + rank_lex(d))

Isso é robusto a escala, a modalidade ausente (um dos termos simplesmente não
contribui) e a empates (desempate determinístico).

Este módulo é PURO: nenhuma consulta, nenhum I/O — a decisão de ranking é
testável sem banco (`tests/test_hybrid_search.py`).
"""

from typing import Any, Dict, Iterable, List, Optional

# Versão do algoritmo de fusão: gravada em cada resultado para auditoria.
ALGORITHM_VERSION = "rrf-1"

DEFAULT_RRF_K = 60
DEFAULT_WEIGHT_SEMANTIC = 0.60
DEFAULT_WEIGHT_LEXICAL = 0.40


def _key(item: Dict[str, Any], id_key: str) -> str:
    value = item.get(id_key)
    return "" if value is None else str(value)


def reciprocal_rank_fusion(
    semantic_ranked: Optional[Iterable[Dict[str, Any]]],
    lexical_ranked: Optional[Iterable[Dict[str, Any]]],
    *,
    k: int = DEFAULT_RRF_K,
    weight_semantic: float = DEFAULT_WEIGHT_SEMANTIC,
    weight_lexical: float = DEFAULT_WEIGHT_LEXICAL,
    top_k: Optional[int] = None,
    id_key: str = "id",
) -> List[Dict[str, Any]]:
    """
    Funde dois rankings ordenados (melhor primeiro) em um ranking explicável.

    Devolve uma lista de DTOs com rastreabilidade completa (FASE 6):
      id, rrfScore, rank, semanticRank, lexicalRank, semanticScore, lexicalScore,
      matchedBy, strategy, algorithmVersion, rrfK, weights.
    O item ORIGINAL fica em `item` (o consumidor mantém content/metadados).

    Empates: ordena por (rrfScore desc, melhor rank desc, id asc) — determinístico.
    """
    if k < 1:
        raise ValueError("k do RRF deve ser >= 1")
    w_sem = max(0.0, float(weight_semantic))
    w_lex = max(0.0, float(weight_lexical))

    fused: Dict[str, Dict[str, Any]] = {}

    def register(rows: Optional[Iterable[Dict[str, Any]]], modality: str) -> None:
        if not rows:
            return
        rank_field = "semanticRank" if modality == "semantic" else "lexicalRank"
        score_field = "semanticScore" if modality == "semantic" else "lexicalScore"
        for rank, row in enumerate(rows, start=1):
            key = _key(row, id_key)
            if not key:
                continue
            entry = fused.get(key)
            if entry is None:
                entry = {
                    "id": key,
                    "item": row,
                    "semanticRank": None,
                    "lexicalRank": None,
                    "semanticScore": None,
                    "lexicalScore": None,
                    "matchedBy": [],
                }
                fused[key] = entry
            # Primeira posição vence (rankings são ordenados e sem duplicatas).
            if entry[rank_field] is None:
                entry[rank_field] = rank
                entry[score_field] = row.get("score")
            if modality not in entry["matchedBy"]:
                entry["matchedBy"].append(modality)

    register(semantic_ranked, "semantic")
    register(lexical_ranked, "lexical")

    results: List[Dict[str, Any]] = []
    for entry in fused.values():
        score = 0.0
        if entry["semanticRank"] is not None:
            score += w_sem / (k + entry["semanticRank"])
        if entry["lexicalRank"] is not None:
            score += w_lex / (k + entry["lexicalRank"])
        best_rank = min(
            r for r in (entry["semanticRank"], entry["lexicalRank"]) if r is not None
        )
        results.append({
            **entry,
            "rrfScore": score,
            "bestRank": best_rank,
            "strategy": "hybrid",
            "algorithmVersion": ALGORITHM_VERSION,
            "rrfK": k,
            "weights": {"semantic": w_sem, "lexical": w_lex},
        })

    results.sort(key=lambda row: (-row["rrfScore"], row["bestRank"], row["id"]))
    for position, row in enumerate(results, start=1):
        row["rank"] = position
        row["matchedBy"] = sorted(row["matchedBy"])

    if top_k is not None:
        limit = max(0, int(top_k))
        return results[:limit]
    return results


def fuse_with_fallback(
    semantic_ranked: Optional[Iterable[Dict[str, Any]]],
    lexical_ranked: Optional[Iterable[Dict[str, Any]]],
    *,
    semantic_error: Optional[str] = None,
    lexical_error: Optional[str] = None,
    **kwargs: Any,
) -> Dict[str, Any]:
    """
    Fusão com FALLBACK DECLARADO: se uma modalidade falhar, o resultado continua
    (a outra modalidade responde) e `degraded`/`degradationReasons` dizem qual e
    por quê. Nunca silencia a falha nem devolve lista vazia sem explicação.
    """
    semantic_rows = list(semantic_ranked or [])
    lexical_rows = list(lexical_ranked or [])
    fused = reciprocal_rank_fusion(semantic_rows, lexical_rows, **kwargs)

    reasons = []
    if semantic_error:
        reasons.append(f"semantic:{semantic_error}")
    if lexical_error:
        reasons.append(f"lexical:{lexical_error}")

    if not semantic_rows and not lexical_rows:
        # Nenhuma modalidade produziu candidato: ausência de resultado é o
        # resultado, mas precisa ser distinguível de "não houve busca".
        return {"results": [], "degraded": bool(reasons), "degradationReasons": reasons}

    return {
        "results": fused,
        "degraded": bool(lexical_error) and bool(semantic_rows),
        "degradationReasons": reasons,
    }
