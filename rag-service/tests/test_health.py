"""
Testes do endpoint de health check.
"""

import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_health_check():
    """Testa se o health check retorna status healthy."""
    response = client.get("/rag/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "vectorStore" in data
    assert "embeddingModel" in data


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

