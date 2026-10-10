"""
`/rag/query` escolhe a estratégia de recuperação pela configuração.

Não-vacuidade do wiring da FASE 5: ligar `RAG_HYBRID_ENABLED` precisa mudar o
CAMINHO executado (fusão) e a explicação devolvida; desligado, o caminho
histórico (vetorial) tem de ser preservado. Sem este teste, o flag poderia ser
decorativo — e um benchmark que só roda em `/rag/search` não provaria que a
geração usa a fusão.
"""

import os

import pytest
from fastapi.testclient import TestClient

from main import app
from api.routes import query as query_routes
from models.document import Chunk, ChunkMetadata, DocumentPermissions

client = TestClient(app)
if os.getenv("RAG_INTERNAL_TOKEN"):
    client.headers["X-RAG-Internal-Token"] = os.environ["RAG_INTERNAL_TOKEN"]

TENANT = "system"


def _chunk(chunk_id: str, score: float, hybrid=None) -> Chunk:
    return Chunk(
        id=chunk_id,
        documentId=f"doc-{chunk_id}",
        tenantId=TENANT,
        content="Conteúdo de teste sobre matrícula e plano do aluno.",
        metadata=ChunkMetadata(
            chunkIndex=0, startChar=0, endChar=0, tokenCount=10,
            source_id=f"doc-{chunk_id}", active=True, hybrid=hybrid,
        ),
        permissions=DocumentPermissions(),
        score=score,
        domain="OPERATIONAL",
        classification="PRODUCTION",
        sensitivity="INTERNAL",
    )


class _StoreEspiao:
    """Registra qual modalidade foi chamada e devolve resultados controlados."""

    def __init__(self):
        self.calls = []

    def search(self, *_args, **_kwargs):
        self.calls.append("search")
        return [_chunk("sem-1", 0.9, None)]

    def lexical_search(self, *_args, **_kwargs):
        self.calls.append("lexical_search")
        return [_chunk("lex-1", 0.42, None)]

    def search_hybrid(self, *_args, **_kwargs):
        self.calls.append("search_hybrid")
        return {
            "chunks": [
                _chunk("fus-1", 0.88, {"rank": 1, "rrfScore": 0.0163, "semanticRank": 1, "semanticScore": 0.88,
                                       "lexicalRank": 2, "lexicalScore": 1.2, "matchedBy": ["lexical", "semantic"],
                                       "strategy": "hybrid", "algorithmVersion": "rrf-1", "rrfK": 60,
                                       "weights": {"semantic": 0.6, "lexical": 0.4}}),
                _chunk("fus-lex", 1.5, {"rank": 2, "rrfScore": 0.0065, "semanticRank": None, "semanticScore": None,
                                        "lexicalRank": 1, "lexicalScore": 3.1, "matchedBy": ["lexical"],
                                        "strategy": "hybrid", "algorithmVersion": "rrf-1", "rrfK": 60,
                                        "weights": {"semantic": 0.6, "lexical": 0.4}}),
            ],
            "strategy": "hybrid",
            "algorithmVersion": "rrf-1",
            "rrfK": 60,
            "weights": {"semantic": 0.6, "lexical": 0.4},
            "candidatesPerModality": 30,
            "semanticFound": 30,
            "lexicalFound": 12,
            "degraded": False,
            "degradationReasons": [],
        }


@pytest.fixture
def rota_isolada(monkeypatch):
    store = _StoreEspiao()
    monkeypatch.setattr(query_routes, "generate_embedding", lambda _text: [0.0] * 384)
    monkeypatch.setattr(query_routes, "get_vector_store", lambda _tenant: store)
    monkeypatch.setattr(
        query_routes, "generate_response",
        lambda *_a, **_k: "Resposta sintetizada de teste com tamanho suficiente para passar do mínimo.",
    )
    return store


def _pergunta():
    return {"query": "Como faço uma matrícula?", "tenantId": TENANT, "options": {"topK": 5, "minScore": 0.45}}


def test_sem_flag_usa_busca_vetorial_historica(rota_isolada, monkeypatch):
    monkeypatch.setattr(query_routes.get_settings(), "hybrid_enabled", False, raising=False)

    body = client.post("/rag/query", json=_pergunta()).json()

    assert rota_isolada.calls == ["search"]
    assert body["metadata"]["strategy"] == "semantic"
    assert body["metadata"]["retrieval"] is None


def test_com_flag_usa_fusao_e_explica_a_estrategia(rota_isolada, monkeypatch):
    monkeypatch.setattr(query_routes.get_settings(), "hybrid_enabled", True, raising=False)

    body = client.post("/rag/query", json=_pergunta()).json()

    assert rota_isolada.calls == ["search_hybrid"]
    meta = body["metadata"]
    assert meta["strategy"] == "hybrid"
    assert meta["retrieval"]["algorithmVersion"] == "rrf-1"
    assert meta["retrieval"]["weights"] == {"semantic": 0.6, "lexical": 0.4}
    assert meta["retrieval"]["lexicalFound"] == 12
    assert meta["retrieval"]["degraded"] is False


def test_match_lexical_puro_sobrevive_ao_corte_de_cosseno(rota_isolada, monkeypatch):
    """O corte de minScore é de cosseno: não pode matar o ganho da busca lexical."""
    monkeypatch.setattr(query_routes.get_settings(), "hybrid_enabled", True, raising=False)

    body = client.post("/rag/query", json=_pergunta()).json()

    devolvidos = {chunk["chunkId"] for chunk in body["sources"]}
    assert "fus-lex" in devolvidos, "match lexical puro foi descartado pelo corte de cosseno"
