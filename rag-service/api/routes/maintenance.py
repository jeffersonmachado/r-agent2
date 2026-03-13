"""
Endpoint de manutenção do vector store.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List, Dict
from pydantic import BaseModel
import logging

from services.vector_store import get_vector_store, normalize_tenant_id
from config.settings import get_settings
import psycopg2

logger = logging.getLogger(__name__)

router = APIRouter()


class CleanOrphansResponse(BaseModel):
    """Resposta da limpeza de documentos órfãos."""
    success: bool
    tenantId: str
    orphanedDocuments: List[str]
    removedChunks: int
    removedDocuments: int
    error: Optional[str] = None


class CleanOrphansRequest(BaseModel):
    """Request para limpeza de documentos órfãos."""
    document_ids: List[str]

class VectorDocumentsResponse(BaseModel):
    """Lista documentos presentes no vector store de um tenant."""
    success: bool
    tenantId: str
    documentIds: List[str]
    documentCount: int
    chunkCount: int
    # Opcional: útil para reconciliar estado do BD (index_status) com o vector store
    chunkCountByDocumentId: Optional[Dict[str, int]] = None
    error: Optional[str] = None

@router.get("/documents", response_model=VectorDocumentsResponse)
async def list_vector_documents(
    tenant_id: str = Query(..., description="ID do tenant"),
    limit: int = Query(5000, ge=1, le=50000, description="Limite de IDs retornados")
):
    """
    Retorna a lista de documentIds presentes no vector store para um tenant.

    Útil para detectar e limpar dados órfãos (vector_ahead).
    """
    try:
        tenant_id = normalize_tenant_id(tenant_id)
        settings = get_settings()
        dsn = settings.postgres_dsn
        if not dsn:
            raise RuntimeError("Postgres DSN não configurado (DATABASE_URL/PG*).")

        chunk_count_by_doc: Dict[str, int] = {}
        with psycopg2.connect(dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT document_id, COUNT(*)::int AS chunks
                    FROM rag_chunks
                    WHERE tenant_key = %s
                    GROUP BY document_id
                    """,
                    (tenant_id,)
                )
                for doc_id, chunks in cur.fetchall():
                    chunk_count_by_doc[str(doc_id)] = int(chunks)

        doc_ids = sorted(list(chunk_count_by_doc.keys()))
        total_docs = len(doc_ids)
        total_chunks = sum(chunk_count_by_doc.values())

        limited_doc_ids = doc_ids[:limit]
        limited_counts = {doc_id: chunk_count_by_doc.get(doc_id, 0) for doc_id in limited_doc_ids}
        return VectorDocumentsResponse(
            success=True,
            tenantId=tenant_id,
            documentIds=limited_doc_ids,
            documentCount=total_docs,
            chunkCount=total_chunks,
            chunkCountByDocumentId=limited_counts,
        )
    except Exception as e:
        logger.error(f"[Maintenance] Erro ao listar documentos do vector store: {e}", exc_info=True)
        return VectorDocumentsResponse(
            success=False,
            tenantId=tenant_id,
            documentIds=[],
            documentCount=0,
            chunkCount=0,
            error=str(e),
        )


@router.post("/clean-orphans", response_model=CleanOrphansResponse)
async def clean_orphaned_documents(
    tenant_id: str = Query(..., description="ID do tenant"),
    request: CleanOrphansRequest = None
):
    """
    Remove documentos órfãos do vector store.
    
    Se document_ids for fornecido, remove apenas esses documentos.
    Caso contrário, precisa de uma lista de documentos válidos do BD para comparar.
    """
    try:
        if not request or not request.document_ids:
            raise HTTPException(
                status_code=400,
                detail="document_ids é obrigatório no body da requisição."
            )
        
        document_ids = request.document_ids
        vector_store = get_vector_store(tenant_id)
        
        # Remove documentos específicos
        removed_docs = []
        total_chunks = 0
        
        for doc_id in document_ids:
            chunks_removed = vector_store.remove_document(doc_id) or 0
            
            if chunks_removed > 0:
                removed_docs.append(doc_id)
                total_chunks += chunks_removed
        
        logger.info(f"[Maintenance] Removidos {len(removed_docs)} documentos e {total_chunks} chunks", {
            'tenantId': tenant_id,
            'removedDocuments': len(removed_docs),
            'removedChunks': total_chunks
        })
        
        return CleanOrphansResponse(
            success=True,
            tenantId=tenant_id,
            orphanedDocuments=removed_docs,
            removedChunks=total_chunks,
            removedDocuments=len(removed_docs)
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Maintenance] Erro ao limpar documentos órfãos: {e}", exc_info=True)
        return CleanOrphansResponse(
            success=False,
            tenantId=tenant_id,
            orphanedDocuments=[],
            removedChunks=0,
            removedDocuments=0,
            error=str(e)
        )
