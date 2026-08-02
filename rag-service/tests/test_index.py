"""
Testes do endpoint de indexação.
"""

import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

# Token interno obrigatório quando configurado (auth serviço-a-serviço)
import os as _os
if _os.getenv("RAG_INTERNAL_TOKEN"):
    client.headers["X-RAG-Internal-Token"] = _os.environ["RAG_INTERNAL_TOKEN"]


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
    assert data["success"] is True
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
    assert data["success"] is True


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
    assert data["success"] is True
    assert data["chunksCreated"] > 1  # Deve gerar múltiplos chunks

