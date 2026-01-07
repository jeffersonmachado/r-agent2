"""
Endpoint de manutenção do vector store.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List
from pydantic import BaseModel
import logging

from services.vector_store import get_vector_store

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
            chunks_before = len(vector_store.chunks)
            vector_store.remove_document(doc_id)
            chunks_after = len(vector_store.chunks)
            chunks_removed = chunks_before - chunks_after
            
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
