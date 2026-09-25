"""
Busca vetorial pura (retrieve-only) — `POST /rag/search`.

ACHADO REAL (2026-09-25): só existia `POST /rag/query`, que busca chunks E GERA resposta com LLM.
Consumidores que precisam de CONTEÚDO (enriquecimento de engenharia, análise) ficavam reféns do
provedor de IA: com ~5954 chunks SYSTEM indexados, o retrieval devolvia indisponibilidade porque o
circuit breaker abria por falha de GERAÇÃO — mesmo com o dado presente e a busca vetorial não
precisando de LLM.

Este teste fixa o que importa:
  1. `/rag/search` devolve chunks com score e proveniência, SEM geração;
  2. `llm_service.generate_response` NUNCA é chamado (prova da separação retrieve × geração);
  3. o escopo de segregação é o MESMO de `/query` (aplicado antes da busca vetorial);
  4. falha de embedding/busca vira erro explícito, nunca lista vazia silenciosa.
"""

import os

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app, backend_options={"use_uvloop": True})

# O conftest da suíte define um token de teste válido (>=32 bytes) ANTES de importar o app; usar
# esse mesmo valor evita "service_misconfigured" por token curto.
INTERNAL_TOKEN = os.environ["RAG_INTERNAL_TOKEN"]
client.headers["X-RAG-Internal-Token"] = INTERNAL_TOKEN

AUTH_HEADERS = {"x-rag-internal-token": INTERNAL_TOKEN}


class FakeMetadata:
    """Réplica EXATA de `ChunkMetadata` (models/document.py), não uma suposição.

    A primeira versão deste teste usava um dict com nomes inventados; como o fake tinha a forma
    que eu supunha, ele passava enquanto o serviço real devolvia proveniência toda nula.
    """

    def __init__(self, chunk_index=0, content_hash="h1", semantic_hash="sh1", source_id="src-1", source_version=1):
        self.chunkIndex = chunk_index
        self.startChar = 0
        self.endChar = 0
        self.tokenCount = 0
        self.content_hash = content_hash
        self.semantic_hash = semantic_hash
        self.source_id = source_id
        self.source_version = source_version


class FakeChunk:
    """Réplica EXATA de `Chunk`: `documentId` em camelCase e segregação como atributo próprio."""

    def __init__(self, content, score, document_id="doc-1", domain="SYSTEM", classification="DEVELOPMENT", sensitivity="INTERNAL", chunk_id="chunk-1", metadata=None):
        self.id = chunk_id
        self.documentId = document_id
        self.tenantId = "system"
        self.content = content
        self.score = score
        self.metadata = metadata or FakeMetadata()
        self.domain = domain
        self.classification = classification
        self.sensitivity = sensitivity


@pytest.fixture()
def search_env(monkeypatch):
    """Isola a rota: embedding e vector store são substituídos, LLM é ESPIONADO."""
    import api.routes.search as search_route
    import services.llm_service as llm_service

    calls = {"llm": 0, "search": 0, "scope": None, "embedding": 0}

    def fail_if_llm_called(*args, **kwargs):
        calls["llm"] += 1
        raise AssertionError("generate_response foi chamado: retrieval NÃO pode depender de geração")

    monkeypatch.setattr(llm_service, "generate_response", fail_if_llm_called, raising=False)

    def fake_embedding(text):
        calls["embedding"] += 1
        return [0.1] * 384

    monkeypatch.setattr(search_route, "generate_embedding", fake_embedding)

    chunks = [
        FakeChunk("conteúdo relevante sobre lease e fence", 0.91, document_id="doc-a", metadata=FakeMetadata(content_hash="h1")),
        FakeChunk("conteúdo irrelevante", 0.10, document_id="doc-b", metadata=FakeMetadata(content_hash="h2")),
    ]

    class FakeVectorStore:
        def search(self, query_embedding, top_k=5, filters=None, scope=None):
            calls["search"] += 1
            calls["scope"] = scope
            return list(chunks)

    monkeypatch.setattr(search_route, "get_vector_store", lambda tenant_id: FakeVectorStore())
    return calls


def test_search_retorna_chunks_sem_geracao(search_env):
    response = client.post(
        "/rag/search",
        headers=AUTH_HEADERS,
        json={"query": "como funciona o lease da task?", "tenantId": "system", "topK": 5, "minScore": 0.3},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["success"] is True
    assert body["metadata"]["generationUsed"] is False
    assert search_env["llm"] == 0
    # minScore aplicado: só o chunk acima do piso volta.
    assert body["metadata"]["chunksFound"] == 2
    assert body["metadata"]["chunksReturned"] == 1
    chunk = body["chunks"][0]
    assert chunk["score"] == 0.91
    assert chunk["text"].startswith("conteúdo relevante")
    # Proveniência preservada (sem ela o consumidor não consegue citar a fonte).
    assert chunk["documentId"] == "doc-a"
    assert chunk["hash"] == "h1"
    assert chunk["domain"] == "SYSTEM"
    assert chunk["classification"] == "DEVELOPMENT"
    assert chunk["sensitivity"] == "INTERNAL"
    assert chunk["tenantId"] == "system"
    assert chunk["sourceId"] == "src-1"
    # Campos que NÃO existem no modelo não podem ser inventados na resposta.
    assert "knowledgeType" not in chunk
    assert "title" not in chunk


def test_search_aplica_escopo_de_segregacao_igual_ao_query(search_env):
    """O consumidor de engenharia precisa informar SYSTEM/DEVELOPMENT — e o escopo chega ao SQL."""
    response = client.post(
        "/rag/search",
        headers=AUTH_HEADERS,
        json={
            "query": "pergunta de teste",
            "tenantId": "system",
            "scope": {"domain": "SYSTEM", "classifications": ["DEVELOPMENT"]},
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    # O escopo chega ao vector store (aplicado no SQL antes da busca vetorial).
    assert search_env["scope"] is not None
    assert search_env["scope"]["domain"] == "SYSTEM"
    assert "DEVELOPMENT" in search_env["scope"]["classifications"]
    # E é ecoado na resposta, para auditoria de qual escopo foi aplicado.
    assert body["metadata"]["domain"] == "SYSTEM"
    assert "DEVELOPMENT" in body["metadata"]["classificationsApplied"]


def test_search_sem_escopo_cai_no_mais_restritivo(search_env):
    """Sem escopo informado o resultado é o MAIS RESTRITIVO, nunca "todos os domínios".

    Semântica real do Domain Policy (`resolve_query_scope` → `DEFAULT_SCOPE`):
    `OPERATIONAL` + `PRODUCTION`. Um consumidor do domínio SYSTEM (engenharia) precisa informar o
    escopo EXPLICITAMENTE — o default não o atende por design.
    """
    response = client.post(
        "/rag/search",
        headers=AUTH_HEADERS,
        json={"query": "pergunta sem escopo explícito", "tenantId": "system"},
    )
    assert response.status_code == 200, response.text
    assert search_env["scope"] is not None
    assert search_env["scope"]["domain"] == "OPERATIONAL"
    assert "DEVELOPMENT" not in search_env["scope"]["classifications"]


def test_search_query_vazia_e_rejeitada(search_env):
    response = client.post("/rag/search", headers=AUTH_HEADERS, json={"query": "   ", "tenantId": "system"})
    assert response.status_code in (400, 422)


def test_search_sem_tenant_e_rejeitado(search_env):
    response = client.post("/rag/search", headers=AUTH_HEADERS, json={"query": "pergunta válida"})
    assert response.status_code in (400, 422)


def test_search_falha_de_busca_e_erro_explicito(monkeypatch, search_env):
    """Falha real não pode virar lista vazia: o consumidor precisa distinguir
    'não há conhecimento' de 'o serviço falhou'."""
    import api.routes.search as search_route

    def explode(query_embedding, top_k=5, filters=None, scope=None):
        raise RuntimeError("conexão com o vector store caiu")

    class ExplodingStore:
        search = staticmethod(explode)

    monkeypatch.setattr(search_route, "get_vector_store", lambda tenant_id: ExplodingStore())

    response = client.post("/rag/search", headers=AUTH_HEADERS, json={"query": "pergunta", "tenantId": "system"})
    assert response.status_code == 500
    assert "vector store" in response.json()["detail"]
