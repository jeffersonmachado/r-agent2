"""
Testes do endpoint de health check.
"""

import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app, backend_options={"use_uvloop": True})

# Token interno obrigatório quando configurado (auth serviço-a-serviço)
import os as _os
if _os.getenv("RAG_INTERNAL_TOKEN"):
    client.headers["X-RAG-Internal-Token"] = _os.environ["RAG_INTERNAL_TOKEN"]


def test_health_check():
    """
    Health check responde e NUNCA mente sobre readiness.

    O status depende da configuração do ambiente (com DSN -> healthy/ready; sem
    DSN -> degraded/ready=false). O que este teste fixa é a CONSISTÊNCIA entre
    `status`, `ready` e `dbConfigured` — antes o serviço dizia `healthy` com
    `dbConfigured=false` e o operador só descobria o problema por documentos
    nascendo `failed` (2026-10-06).
    """
    response = client.get("/rag/health")
    assert response.status_code == 200  # liveness: processo no ar
    data = response.json()
    assert "vectorStore" in data
    assert "embeddingModel" in data
    assert "ready" in data
    assert "dbConfigured" in data

    if data["dbConfigured"] is False:
        assert data["status"] == "degraded"
        assert data["ready"] is False
    else:
        assert data["status"] == "healthy"
        assert data["ready"] is True


def test_health_check_structure():
    """Testa se a estrutura da resposta está correta."""
    response = client.get("/rag/health")
    assert response.status_code == 200
    data = response.json()
    
    # Verifica campos obrigatórios
    assert "status" in data
    assert "vectorStore" in data
    assert "embeddingModel" in data
    assert "indexedDocuments" in data
    assert "indexedChunks" in data
    
    # Verifica tipos
    assert isinstance(data["status"], str)
    assert isinstance(data["indexedDocuments"], int)
    assert isinstance(data["indexedChunks"], int)
