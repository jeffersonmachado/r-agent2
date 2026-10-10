"""
Regressões do fail-closed de CONFIGURAÇÃO do rag-service (2026-10-08).

Contexto medido (2026-10-06): o serviço subiu SEM `--env-file .env`
(`dbConfigured: false`) e continuou respondendo `/health` como `healthy`. A
indexação falhava em silêncio e 11 documentos nasceram `failed` — o operador só
descobriu pelo gate de saúde do índice. O gate agregado ficava verde porque o
serviço "estava de pé".

Contrato fixado:
 1. `/rag/health` NUNCA mente: sem banco reporta `status=degraded`,
    `ready=false`, `dbConfigured=false`, com motivo;
 2. `/rag/ready` responde 503 quando não está pronto (probe por HTTP status);
 3. com banco configurado o status é `healthy`/`ready` (controle positivo).

NÃO existe bloqueio global de /rag/* por ausência de banco: foi implementado,
MEDIDO e revertido no mesmo dia — 33 testes que stubam o vector store passaram a
receber 503 porque no ambiente de teste o DSN não está em `os.environ`. A
necessidade de banco é por rota e já falha fechado no ponto de uso.
"""

import os

import pytest
from fastapi.testclient import TestClient

from main import app
from api.routes import health as health_routes
from services import internal_auth

client = TestClient(app)
if os.getenv("RAG_INTERNAL_TOKEN"):
    client.headers["X-RAG-Internal-Token"] = os.environ["RAG_INTERNAL_TOKEN"]

HEADERS = {"X-RAG-Internal-Token": os.getenv("RAG_INTERNAL_TOKEN", "irrelevante-para-o-teste")}


@pytest.fixture
def sem_banco(monkeypatch):
    """Simula serviço subido sem DATABASE_URL/PG*."""
    monkeypatch.setattr(internal_auth, "is_database_configured", lambda: False)
    monkeypatch.setattr(health_routes, "is_database_configured", lambda: False)


def test_health_sem_banco_reporta_degradado_sem_mentir(sem_banco):
    response = client.get("/rag/health", headers=HEADERS)
    assert response.status_code == 200  # liveness: o processo está no ar
    data = response.json()
    assert data["status"] == "degraded"
    assert data["ready"] is False
    assert data["dbConfigured"] is False
    assert data["reason"] == "database_not_configured"


def test_ready_sem_banco_responde_503(sem_banco):
    response = client.get("/rag/ready", headers=HEADERS)
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "not_ready"
    assert body["dbConfigured"] is False


def test_health_com_banco_nao_reporta_degradacao(monkeypatch):
    """Controle positivo: com banco configurado não há degradação reportada."""
    monkeypatch.setattr(internal_auth, "is_database_configured", lambda: True)
    monkeypatch.setattr(health_routes, "is_database_configured", lambda: True)
    data = client.get("/rag/health", headers=HEADERS).json()
    assert data["dbConfigured"] is True
    assert data["ready"] is True
    assert data["status"] == "healthy"
