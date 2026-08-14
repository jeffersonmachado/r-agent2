"""
Testes do endpoint de consulta RAG.
"""

import pytest
from fastapi.testclient import TestClient
from main import app
from api.routes import index as index_routes
from api.routes import query as query_routes

client = TestClient(app, backend_options={"use_uvloop": True})

# Token interno obrigatório quando configurado (auth serviço-a-serviço)
import os as _os
if _os.getenv("RAG_INTERNAL_TOKEN"):
    client.headers["X-RAG-Internal-Token"] = _os.environ["RAG_INTERNAL_TOKEN"]


class _UnitVectorStore:
    """Double sem corpus: suficiente para validar o contrato HTTP da query."""

    def get_stats(self):
        return {"documentCount": 0, "chunkCount": 0, "indexSize": 0}

    def add_chunks(self, chunks, _embeddings):
        return len(chunks)

    def search(self, _embedding, **_kwargs):
        return []


@pytest.fixture(autouse=True)
def isolate_embedding_and_vector_store(monkeypatch):
    """Separa testes HTTP de modelo externo e de integração pgvector."""
    store = _UnitVectorStore()
    monkeypatch.setattr(query_routes, "generate_embedding", lambda _text: [0.0] * 384)
    monkeypatch.setattr(query_routes, "get_vector_store", lambda _tenant_id: store)
    monkeypatch.setattr(
        index_routes,
        "generate_embeddings_batch",
        lambda texts: [
            [1.0 if dimension == (index % 384) else 0.0 for dimension in range(384)]
            for index, _text in enumerate(texts)
        ],
    )
    monkeypatch.setattr(index_routes, "get_vector_store", lambda _tenant_id: store)


@pytest.fixture
def indexed_document():
    """Fixture que indexa um documento antes dos testes de query."""
    document = {
        "id": "query-test-doc",
        "tenantId": "query-test-tenant",
        "domain": "OPERATIONAL",
        "classification": "PRODUCTION",
        "title": "Documento para Query",
        "content": "Para resetar sua senha, acesse o menu Configurações > Segurança > Redefinir Senha. Você receberá um email com instruções detalhadas."
    }
    
    response = client.post("/rag/index", json={"document": document})
    assert response.status_code == 200
    yield document
    # Cleanup pode ser adicionado aqui se necessário


def test_query_success(indexed_document):
    """Testa consulta bem-sucedida."""
    request = {
        "query": "Como resetar minha senha?",
        "tenantId": "query-test-tenant",
        "options": {
            "topK": 5,
            "minScore": 0.5
        }
    }
    
    response = client.post("/rag/query", json=request)
    assert response.status_code == 200
    data = response.json()
    
    assert "success" in data
    assert "response" in data
    assert "sources" in data
    assert "confidence" in data
    assert "metadata" in data


def test_query_empty_query():
    """Testa consulta com query vazia."""
    request = {
        "query": "",
        "tenantId": "test-tenant"
    }
    
    response = client.post("/rag/query", json=request)
    # O contrato Pydantic rejeita min_length antes do handler.
    assert response.status_code == 422


def test_query_missing_tenant():
    """Testa consulta sem tenantId."""
    request = {
        "query": "Qual é a resposta?"
    }
    
    response = client.post("/rag/query", json=request)
    # FastAPI retorna 422 para erros de validação do Pydantic
    assert response.status_code == 422


def test_query_no_results(indexed_document):
    """Testa consulta que não encontra resultados."""
    request = {
        "query": "Como fazer um bolo de chocolate?",
        "tenantId": "query-test-tenant",
        "options": {
            "minScore": 0.9  # Score muito alto
        }
    }
    
    response = client.post("/rag/query", json=request)
    assert response.status_code == 200
    data = response.json()
    
    # Pode retornar success=False ou success=True com resposta genérica
    assert "success" in data
    assert "sources" in data
    assert len(data["sources"]) == 0 or data["success"] is False


def test_query_with_filters(indexed_document):
    """Testa consulta com filtros."""
    request = {
        "query": "Como resetar senha?",
        "tenantId": "query-test-tenant",
        "filters": {
            "roles": ["admin", "agent"],
            "agentId": "agent-001"
        }
    }
    
    response = client.post("/rag/query", json=request)
    assert response.status_code == 200
    data = response.json()
    assert "sources" in data


def test_query_custom_options(indexed_document):
    """Testa consulta com opções customizadas."""
    request = {
        "query": "resetar senha",
        "tenantId": "query-test-tenant",
        "options": {
            "topK": 10,
            "minScore": 0.3,
            "maxTokens": 500
        }
    }
    
    response = client.post("/rag/query", json=request)
    assert response.status_code == 200
    data = response.json()
    assert "metadata" in data
    assert data["metadata"]["chunksSearched"] <= 10


def test_query_confidence_score(indexed_document):
    """Testa se o confidence score está no range correto."""
    request = {
        "query": "resetar senha",
        "tenantId": "query-test-tenant"
    }
    
    response = client.post("/rag/query", json=request)
    assert response.status_code == 200
    data = response.json()
    
    assert "confidence" in data
    confidence = data["confidence"]
    assert 0.0 <= confidence <= 1.0


def test_query_sources_structure(indexed_document):
    """Testa se a estrutura das sources está correta."""
    request = {
        "query": "resetar senha",
        "tenantId": "query-test-tenant"
    }
    
    response = client.post("/rag/query", json=request)
    assert response.status_code == 200
    data = response.json()
    
    if data["sources"]:
        source = data["sources"][0]
        assert "chunkId" in source
        assert "documentId" in source
        assert "title" in source
        assert "score" in source
        assert "excerpt" in source
        assert isinstance(source["score"], (int, float))
        assert 0.0 <= source["score"] <= 1.0
