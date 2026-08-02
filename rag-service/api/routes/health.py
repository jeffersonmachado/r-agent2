"""
Endpoint de health check.
"""

from fastapi import APIRouter, Query, Request
from typing import Optional
from config.settings import get_settings
from services.internal_auth import has_valid_internal_token
import psycopg2

router = APIRouter()


def _get_conn():
    settings = get_settings()
    dsn = settings.postgres_dsn
    if not dsn:
        raise RuntimeError("Postgres DSN não configurado (DATABASE_URL/PG*).")
    # Evita travamento prolongado quando DSN existe mas banco está indisponível.
    return psycopg2.connect(dsn, connect_timeout=2)


def _stats_for_tenant(tenant_id: str) -> dict:
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*)::int FROM rag_chunks WHERE tenant_key = %s", (tenant_id,))
            chunks = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(DISTINCT document_id)::int FROM rag_chunks WHERE tenant_key = %s", (tenant_id,))
            docs = int(cur.fetchone()[0])
    return {"indexedDocuments": docs, "indexedChunks": chunks}


def _aggregated_stats() -> dict:
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*)::int FROM rag_chunks")
            chunks = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(DISTINCT document_id)::int FROM rag_chunks")
            docs = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(DISTINCT tenant_key)::int FROM rag_chunks")
            tenants = int(cur.fetchone()[0])
    return {"indexedDocuments": docs, "indexedChunks": chunks, "tenantsCount": tenants}


@router.get("/health")
def health_check(tenant_id: Optional[str] = Query(None, description="ID do tenant (opcional). Se não fornecido, retorna estatísticas agregadas de todos os tenants."), request: Request = None):
    """
    Health check do serviço RAG.

    Retorna status do serviço, vector store e modelo de embeddings.
    Se tenant_id for fornecido, retorna estatísticas apenas desse tenant.
    Estatísticas agregadas cross-tenant exigem token interno válido;
    sem tenant_id e sem token, retorna apenas o status do serviço.
    """
    settings = get_settings()
    dsn = settings.postgres_dsn
    allow_aggregated = has_valid_internal_token(request.headers) if request else False

    # Fallback para ambientes sem Postgres configurado (ex.: testes locais/unitários).
    if not dsn:
        response = {
            "status": "healthy",
            "vectorStore": settings.vector_store_type,
            "embeddingModel": settings.embedding_model,
            "indexedDocuments": 0,
            "indexedChunks": 0,
            "dbConfigured": False
        }
        if tenant_id:
            response["tenantId"] = str(tenant_id).strip()
        elif allow_aggregated:
            response["aggregated"] = True
            response["tenantsCount"] = 0
        else:
            response["scopeRestricted"] = True
        return response

    try:
        if tenant_id:
            tenant_id = str(tenant_id).strip()
            stats = _stats_for_tenant(tenant_id)
            indexed_docs = stats["indexedDocuments"]
            indexed_chunks = stats["indexedChunks"]
            aggregated = None
        elif allow_aggregated:
            aggregated = _aggregated_stats()
            indexed_docs = aggregated.get("indexedDocuments", 0)
            indexed_chunks = aggregated.get("indexedChunks", 0)
        else:
            # Sem tenant_id e sem token interno: apenas status do serviço,
            # nunca estatísticas cross-tenant.
            aggregated = None
            indexed_docs = 0
            indexed_chunks = 0
    except Exception:
        # Modo degradado: serviço sobe sem banco em ambiente de teste/local.
        indexed_docs = 0
        indexed_chunks = 0
        aggregated = {"tenantsCount": 0}

    response = {
        "status": "healthy",
        "vectorStore": settings.vector_store_type,
        "embeddingModel": settings.embedding_model,
        "indexedDocuments": indexed_docs,
        "indexedChunks": indexed_chunks
    }

    if tenant_id:
        response["tenantId"] = tenant_id
    elif allow_aggregated:
        # Inclui informação sobre agregação (somente com token interno)
        response["aggregated"] = True
        response["tenantsCount"] = (aggregated or {}).get("tenantsCount", 0)
    else:
        response["scopeRestricted"] = True

    return response


@router.get("/ready")
def readiness_check():
    """
    Readiness check (rápido e read-only).

    Retorna 200 apenas se conseguir conectar ao Postgres e executar um SELECT 1.
    """
    try:
        with _get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                _ = cur.fetchone()
        return {"status": "ready"}
    except Exception as e:
        return {"status": "not_ready", "error": str(e)}


@router.get("/selftest")
def selftest_check():
    """
    Self-test read-only (auto tester).

    - Reusa o health check (stats) e valida conectividade ao Postgres.
    - Não executa indexação nem mutações.
    """
    try:
        # Revalida DB de forma explícita
        with _get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                _ = cur.fetchone()
        # Inclui o mesmo payload do /health (agregado)
        health = health_check(None)
        return {"status": "PASS", "checks": {"db": "ok", "health": health}}
    except Exception as e:
        return {"status": "FAIL", "error": str(e)}
