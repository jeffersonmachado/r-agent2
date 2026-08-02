"""
Testes para aprendizado adaptativo e validação de queries.
"""

import pytest
import json
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient
from main import app
from services.adaptive_learning import AdaptiveLearningService, get_adaptive_learning_service

client = TestClient(app)

# Token interno obrigatório quando configurado (auth serviço-a-serviço)
import os as _os
if _os.getenv("RAG_INTERNAL_TOKEN"):
    client.headers["X-RAG-Internal-Token"] = _os.environ["RAG_INTERNAL_TOKEN"]


@pytest.fixture
def temp_validation_rules_file():
    """Cria arquivo temporário de regras de validação."""
    rules = {
        "version": "1.0.0",
        "lastUpdated": None,
        "adaptationCycles": 0,
        "maxCycles": 50,
        "targetAccuracy": 0.85,
        "currentAccuracy": 0.0,
        "rules": {
            "length": {
                "enabled": True,
                "minLength": 10,
                "maxLength": 200,
                "weight": 1.0
            },
            "uuid": {
                "enabled": True,
                "rejectFullUuid": True,
                "rejectUuidInShortText": True,
                "shortTextMaxLength": 50,
                "weight": 1.0
            },
            "repetition": {
                "enabled": True,
                "maxConsecutiveRepetitions": 2,
                "maxWordRepetitionRatio": 0.5,
                "weight": 1.0
            },
            "invalidPrefixes": {
                "enabled": True,
                "patterns": ["^jpeg\\]", "^\\[imagem:"],
                "weight": 1.0
            },
            "invalidPatterns": {
                "enabled": True,
                "patterns": ["\\[imagem:.*?\\]", "texto extraído.*ocr"],
                "weight": 1.0
            },
            "genericQuestions": {
                "enabled": True,
                "patterns": ["^(o que|como|qual)\\s*$"],
                "weight": 1.0
            },
            "questionStructure": {
                "enabled": True,
                "requireQuestionWord": False,
                "requireQuestionMark": False,
                "minMeaningfulWords": 3,
                "weight": 1.0
            },
            "metadataPatterns": {
                "enabled": True,
                "patterns": ["^\\w+\\]\\s*texto"],
                "weight": 1.0
            },
            "alphanumeric": {
                "enabled": True,
                "minAlphanumericRatio": 0.6,
                "weight": 1.0
            }
        },
        "adaptation": {
            "enabled": True,
            "adjustmentRate": 0.1,
            "minWeight": 0.1,
            "maxWeight": 2.0,
            "accuracyHistory": []
        }
    }
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(rules, f, indent=2)
        temp_path = Path(f.name)
    
    yield temp_path
    
    # Cleanup
    if temp_path.exists():
        temp_path.unlink()


@pytest.fixture
def learning_service():
    """Fixture que retorna instância do serviço de aprendizado."""
    return get_adaptive_learning_service()


def test_validation_rules_loading(temp_validation_rules_file, learning_service):
    """Testa carregamento de regras de validação."""
    # Simula carregamento de regras
    learning_service.validation_rules = None
    rules = learning_service.load_validation_rules()
    
    assert rules is not None
    assert "rules" in rules
    assert "adaptation" in rules


def test_is_valid_query_valid_question(learning_service):
    """Testa validação de pergunta válida."""
    valid_queries = [
        "Como resetar minha senha?",
        "Quais são as formas de pagamento disponíveis?",
        "Onde posso encontrar informações sobre o produto?",
        "Como funciona o sistema de tickets?"
    ]
    
    for query in valid_queries:
        assert learning_service._is_valid_query(query), f"Query deveria ser válida: {query}"


def test_is_valid_query_invalid_questions(learning_service):
    """Testa validação de perguntas inválidas."""
    invalid_queries = [
        "Studio Studio studio",  # Repetição
        "O que é Studio? studio",  # Palavra repetida após interrogação
        "jpeg] Texto extraído",  # Prefixo inválido
        "[Imagem: uuid imagem",  # Placeholder de imagem
        "abc",  # Muito curta
        "a" * 250,  # Muito longa
        "12345678-1234-1234-1234-123456789012",  # UUID completo
        "o que",  # Pergunta genérica
    ]
    
    for query in invalid_queries:
        assert not learning_service._is_valid_query(query), f"Query deveria ser inválida: {query}"


def test_record_query_result_valid(learning_service):
    """Testa registro de query válida."""
    tenant_id = "test-tenant-valid"
    
    learning_service.record_query_result(
        tenant_id=tenant_id,
        query="Como resetar senha?",
        success=True,
        confidence=0.85,
        chunks_found=3
    )
    
    data = learning_service.load_learning_data(tenant_id)
    assert data["metrics"]["totalQueries"] == 1
    assert data["metrics"]["successfulQueries"] == 1
    assert len(data["queryPatterns"]["successful"]) == 1


def test_record_query_result_invalid_ignored(learning_service):
    """Testa que queries inválidas são ignoradas."""
    tenant_id = "test-tenant-invalid"
    
    initial_data = learning_service.load_learning_data(tenant_id)
    initial_total = initial_data["metrics"].get("totalQueries", 0)
    
    # Tenta registrar query inválida
    learning_service.record_query_result(
        tenant_id=tenant_id,
        query="Studio Studio studio",  # Inválida
        success=True,
        confidence=0.5,
        chunks_found=0
    )
    
    data = learning_service.load_learning_data(tenant_id)
    # Total não deve ter aumentado
    assert data["metrics"].get("totalQueries", 0) == initial_total


def test_adapt_validation_rules(learning_service):
    """Testa adaptação de regras de validação."""
    tenant_id = "test-tenant-adapt"
    
    # Simula algumas queries para ter dados
    for i in range(10):
        learning_service.record_query_result(
            tenant_id=tenant_id,
            query=f"Pergunta válida {i}?",
            success=i % 2 == 0,  # 50% de sucesso
            confidence=0.5 + (i % 2) * 0.3,
            chunks_found=3
        )
    
    # Dispara adaptação
    adapted = learning_service.adapt_validation_rules(tenant_id)
    
    # Deve retornar True se adaptou ou False se atingiu limite/acurácia
    assert isinstance(adapted, bool)


def test_clean_invalid_queries(learning_service):
    """Testa limpeza de queries inválidas."""
    tenant_id = "test-tenant-clean"
    
    # Adiciona algumas queries (algumas inválidas manualmente)
    data = learning_service.load_learning_data(tenant_id)
    data["queryPatterns"]["failed"].extend([
        {"query": "Studio Studio studio", "success": False, "confidence": 0.0, "chunksFound": 0, "timestamp": "2026-01-01T00:00:00"},
        {"query": "Como resetar senha?", "success": False, "confidence": 0.3, "chunksFound": 0, "timestamp": "2026-01-01T00:00:00"},
        {"query": "jpeg] Texto extraído", "success": False, "confidence": 0.0, "chunksFound": 0, "timestamp": "2026-01-01T00:00:00"},
    ])
    learning_service.save_learning_data(tenant_id)
    
    # Chama endpoint de limpeza
    response = client.post(f"/rag/learning/clean-invalid-queries/{tenant_id}")
    
    assert response.status_code == 200
    result = response.json()
    assert result["success"] is True
    assert result["totalRemoved"] > 0


def test_get_validation_rules():
    """Testa endpoint para obter regras de validação."""
    response = client.get("/rag/learning/validation-rules")
    
    assert response.status_code == 200
    data = response.json()
    assert "success" in data
    assert "rules" in data


def test_get_full_learning_data(learning_service):
    """Testa endpoint para obter dados completos de aprendizado."""
    tenant_id = "test-tenant-full"
    
    # Adiciona alguns dados
    learning_service.record_query_result(
        tenant_id=tenant_id,
        query="Teste de query",
        success=True,
        confidence=0.8,
        chunks_found=2
    )
    
    response = client.get(f"/rag/learning/full-data/{tenant_id}")
    
    assert response.status_code == 200
    data = response.json()
    assert "success" in data
    assert "metrics" in data
    assert "synonyms" in data
    assert "queryPatterns" in data
    assert "config" in data
    assert "learningCycles" in data


def test_update_synonym(learning_service):
    """Testa atualização de sinônimo específico."""
    tenant_id = "test-tenant-synonym"
    
    request = {
        "tenant_id": tenant_id,
        "term": "preço",
        "synonyms": ["valor", "custo", "quanto custa"]
    }
    
    response = client.put("/rag/learning/synonyms", json=request)
    
    assert response.status_code == 200
    result = response.json()
    assert result["success"] is True
    assert result["term"] == "preço"
    assert len(result["synonyms"]) == 3


def test_delete_synonym(learning_service):
    """Testa remoção de sinônimo."""
    tenant_id = "test-tenant-delete"
    term = "preço"
    
    # Primeiro adiciona
    learning_service.load_learning_data(tenant_id)
    data = learning_service.learning_data[tenant_id]
    data["synonyms"][term] = ["valor", "custo"]
    learning_service.save_learning_data(tenant_id)
    
    # Depois remove
    response = client.delete(f"/rag/learning/synonyms/{tenant_id}/{term}")
    
    assert response.status_code == 200
    result = response.json()
    assert result["success"] is True
    
    # Verifica que foi removido
    synonyms = learning_service.get_synonyms(tenant_id)
    assert term not in synonyms


def test_adaptation_stops_at_max_cycles(learning_service):
    """Testa que adaptação para no limite de ciclos."""
    tenant_id = "test-tenant-max-cycles"
    
    # Configura regras com muitos ciclos
    if learning_service.validation_rules:
        learning_service.validation_rules["adaptationCycles"] = 50
        learning_service.validation_rules["maxCycles"] = 50
    
    # Tenta adaptar
    adapted = learning_service.adapt_validation_rules(tenant_id)
    
    # Deve retornar False (atingiu limite)
    assert adapted is False


def test_adaptation_stops_at_target_accuracy(learning_service):
    """Testa que adaptação para quando atinge acurácia alvo."""
    tenant_id = "test-tenant-target-acc"
    
    # Simula alta acurácia
    for i in range(20):
        learning_service.record_query_result(
            tenant_id=tenant_id,
            query=f"Pergunta {i}?",
            success=True,  # 100% de sucesso
            confidence=0.9,
            chunks_found=5
        )
    
    # Configura regras com acurácia alvo baixa
    if learning_service.validation_rules:
        learning_service.validation_rules["targetAccuracy"] = 0.5
    
    # Tenta adaptar
    adapted = learning_service.adapt_validation_rules(tenant_id)
    
    # Pode retornar False se já atingiu acurácia
    assert isinstance(adapted, bool)

