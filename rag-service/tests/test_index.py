"""
Testes do endpoint de indexação.
"""

import pytest
from fastapi.testclient import TestClient
from main import app
from api.routes import index as index_routes

client = TestClient(app, backend_options={"use_uvloop": True})

# Token interno obrigatório quando configurado (auth serviço-a-serviço)
import os as _os
if _os.getenv("RAG_INTERNAL_TOKEN"):
    client.headers["X-RAG-Internal-Token"] = _os.environ["RAG_INTERNAL_TOKEN"]


class _UnitVectorStore:
    """Double determinístico: estes são testes HTTP, não integração pgvector."""

    def __init__(self):
        self._chunks = 0

    def get_stats(self):
        return {
            "documentCount": 1 if self._chunks else 0,
            "chunkCount": self._chunks,
            "indexSize": self._chunks,
        }

    def add_chunks(self, chunks, _embeddings):
        self._chunks = len(chunks)
        return self._chunks


@pytest.fixture(autouse=True)
def isolate_embedding_and_vector_store(monkeypatch):
    """Não deixa a suíte unitária depender de download de modelo ou Postgres."""
    store = _UnitVectorStore()
    monkeypatch.setattr(
        index_routes,
        "generate_embeddings_batch",
        lambda texts: [
            [1.0 if dimension == (index % 384) else 0.0 for dimension in range(384)]
            for index, _text in enumerate(texts)
        ],
    )
    monkeypatch.setattr(index_routes, "get_vector_store", lambda _tenant_id: store)


def test_index_document_success():
    """Testa indexação bem-sucedida de um documento."""
    document = {
        "id": "test-doc-001",
        "tenantId": "test-tenant",
        "domain": "OPERATIONAL",
        "classification": "PRODUCTION",
        "title": "Documento de Teste",
        "content": "Este é um documento de teste para verificar a indexação no RAG.",
        "metadata": {
            "category": "test",
            "source": "test"
        },
        "status": "active"
    }
    
    response = client.post("/rag/index", json={"document": document})
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True, data
    assert data["documentId"] == "test-doc-001"
    assert data["chunksCreated"] > 0


def test_index_document_missing_id():
    """Testa indexação sem ID do documento."""
    document = {
        "tenantId": "test-tenant",
        "domain": "OPERATIONAL",
        "classification": "PRODUCTION",
        "content": "Conteúdo sem ID"
    }
    
    response = client.post("/rag/index", json={"document": document})
    assert response.status_code == 400


def test_index_document_missing_tenant():
    """Testa indexação sem tenantId."""
    document = {
        "id": "test-doc-002",
        "content": "Conteúdo sem tenant"
    }
    
    response = client.post("/rag/index", json={"document": document})
    assert response.status_code == 400


def test_index_document_missing_content():
    """Testa indexação sem conteúdo."""
    document = {
        "id": "test-doc-003",
        "tenantId": "test-tenant"
    }
    
    response = client.post("/rag/index", json={"document": document})
    assert response.status_code == 400


def test_index_document_empty_content():
    """Testa indexação com conteúdo vazio."""
    document = {
        "id": "test-doc-004",
        "tenantId": "test-tenant",
        "domain": "OPERATIONAL",
        "classification": "PRODUCTION",
        "content": ""
    }
    
    response = client.post("/rag/index", json={"document": document})
    # Conteúdo vazio deve ser rejeitado
    assert response.status_code == 400


def test_index_document_with_permissions():
    """Testa indexação com permissões."""
    document = {
        "id": "test-doc-005",
        "tenantId": "test-tenant",
        "domain": "OPERATIONAL",
        "classification": "PRODUCTION",
        "title": "Documento com Permissões",
        "content": "Este documento tem permissões específicas.",
        "permissions": {
            "roles": ["admin", "agent"],
            "agents": ["agent-001"]
        }
    }
    
    response = client.post("/rag/index", json={"document": document})
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True, data


def test_index_document_long_content():
    """Testa indexação de documento longo (deve gerar múltiplos chunks)."""
    long_content = " ".join([f"Parágrafo {i}. " * 20 for i in range(10)])
    
    document = {
        "id": "test-doc-006",
        "tenantId": "test-tenant",
        "domain": "OPERATIONAL",
        "classification": "PRODUCTION",
        "title": "Documento Longo",
        "content": long_content
    }
    
    response = client.post("/rag/index", json={"document": document})
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True, data
    assert data["chunksCreated"] > 1  # Deve gerar múltiplos chunks
