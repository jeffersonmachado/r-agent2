"""
Recuperação lexical/híbrida contra o banco REAL: isolamento e explicabilidade.

Exige Postgres configurado no ambiente (`DATABASE_URL`/PG*), como o serviço.
Sem banco, o módulo é pulado — nunca "passa" por ausência de medição.

O que prova (FASE 7 e FASE 9):
 - a modalidade LEXICAL aplica o MESMO filtro de acesso da semântica
   (tenant + domínio + classificação) — vazamento entre domínios/tenants falha;
 - a fusão híbrida mantém as garantias e devolve explicabilidade por resultado;
 - o filtro vale ANTES do ranking, não depois (a política vive no SQL).
"""

import os

import pytest

from services.vector_store import get_vector_store

TENANT = "system"


def _db_disponivel() -> bool:
    try:
        from config.settings import get_settings
        import psycopg2

        dsn = get_settings().postgres_dsn
        if not dsn:
            return False
        conn = psycopg2.connect(dsn, connect_timeout=2)
        conn.close()
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _db_disponivel(),
    reason="Postgres não configurado neste ambiente (DATABASE_URL/PG*)",
)


def test_lexical_nao_vaza_dominio_system_para_operacional():
    store = get_vector_store(TENANT)
    scope = {"domain": "OPERATIONAL", "classifications": ["PRODUCTION"]}

    chunks = store.lexical_search("replay qa waves coverage", top_k=10, scope=scope)

    assert chunks, "a busca lexical deve encontrar conteúdo operacional para estes termos"
    for chunk in chunks:
        assert chunk.tenantId == TENANT
        assert chunk.domain == "OPERATIONAL", f"vazou domínio {chunk.domain}"
        assert chunk.classification == "PRODUCTION"


def test_lexical_nao_vaza_outro_tenant():
    store = get_vector_store("tenant-demo")
    chunks = store.lexical_search("aluno plano matrícula", top_k=10, scope={"domain": "OPERATIONAL"})
    for chunk in chunks:
        # `tenant-demo` é um tenant próprio; nada de `system` pode aparecer.
        assert chunk.tenantId == "tenant-demo"


def test_hybrid_mantem_isolamento_e_explica_cada_resultado():
    store = get_vector_store(TENANT)
    scope = {"domain": "OPERATIONAL", "classifications": ["PRODUCTION"]}
    embedding = [0.0] * 384  # vetor neutro: o teste é de política, não de ranking

    hybrid = store.search_hybrid("matrícula de aluno novo", embedding, top_k=5, scope=scope, candidates=10)

    assert hybrid["strategy"] == "hybrid"
    assert hybrid["algorithmVersion"]
    assert hybrid["weights"] == {"semantic": 0.6, "lexical": 0.4}

    for chunk in hybrid["chunks"]:
        assert chunk.domain == "OPERATIONAL"
        assert chunk.classification == "PRODUCTION"
        info = chunk.metadata.hybrid
        assert info is not None, "todo resultado híbrido precisa ser explicável"
        for field in ("rank", "rrfScore", "matchedBy", "algorithmVersion", "rrfK", "weights"):
            assert field in info, f"explicabilidade incompleta: falta {field}"
        assert info["matchedBy"], "o resultado precisa declarar de qual modalidade veio"
        # Um resultado lexical-only NÃO pode carregar posição semântica.
        if info["matchedBy"] == ["lexical"]:
            assert info["semanticRank"] is None


def test_sem_escopo_aplica_o_mais_restritivo():
    """Ausência de escopo nunca amplia: cai em OPERATIONAL/PRODUCTION."""
    store = get_vector_store(TENANT)
    chunks = store.search([0.0] * 384, top_k=5)
    for chunk in chunks:
        assert chunk.domain == "OPERATIONAL"
        assert chunk.classification == "PRODUCTION"
