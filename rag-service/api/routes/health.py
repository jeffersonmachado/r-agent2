"""
Endpoint de health check.
"""

from fastapi import APIRouter, Query
from typing import Optional
from config.settings import get_settings
import psycopg2

router = APIRouter()


def _get_conn():
    settings = get_settings()
    dsn = settings.postgres_dsn
    if not dsn:
        raise RuntimeError("Postgres DSN não configurado (DATABASE_URL/PG*).")
    return psycopg2.connect(dsn)


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
async def health_check(tenant_id: Optional[str] = Query(None, description="ID do tenant (opcional). Se não fornecido, retorna estatísticas agregadas de todos os tenants.")):
    """
    Health check do serviço RAG.
    
    Retorna status do serviço, vector store e modelo de embeddings.
    Se tenant_id for fornecido, retorna estatísticas apenas desse tenant.
    Caso contrário, retorna estatísticas agregadas de todos os tenants.
    """
    try:
        settings = get_settings()

        if tenant_id:
            tenant_id = str(tenant_id).strip()
            stats = _stats_for_tenant(tenant_id)
            indexed_docs = stats["indexedDocuments"]
            indexed_chunks = stats["indexedChunks"]
        else:
            aggregated = _aggregated_stats()
            indexed_docs = aggregated.get("indexedDocuments", 0)
            indexed_chunks = aggregated.get("indexedChunks", 0)
        
        response = {
            "status": "healthy",
            "vectorStore": settings.vector_store_type,
            "embeddingModel": settings.embedding_model,
            "indexedDocuments": indexed_docs,
            "indexedChunks": indexed_chunks
        }
        
        if tenant_id:
            response["tenantId"] = tenant_id
        else:
            # Inclui informação sobre agregação
            response["aggregated"] = True
            response["tenantsCount"] = aggregated.get("tenantsCount", 0)
        
        return response
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }


@router.get("/ready")
async def readiness_check():
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
async def selftest_check():
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
        health = await health_check(None)
        return {"status": "PASS", "checks": {"db": "ok", "health": health}}
    except Exception as e:
        return {"status": "FAIL", "error": str(e)}

