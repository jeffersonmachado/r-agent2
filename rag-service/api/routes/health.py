"""
Endpoint de health check.
"""

from fastapi import APIRouter, Query
from typing import Optional
from pathlib import Path
from config.settings import get_settings

router = APIRouter()


def get_all_tenant_ids() -> list:
    """
    Lista todos os tenant IDs que têm índices criados.
    
    Returns:
        Lista de tenant IDs
    """
    try:
        from services.vector_store import get_vector_store_path
        settings = get_settings()
        base_path = Path(settings.vector_store_path)
        
        if not base_path.exists():
            return []
        
        tenant_ids = set()
        # Procura por arquivos .index ou .metadata.json
        for file_path in base_path.glob("*.index"):
            tenant_id = file_path.stem  # Remove a extensão .index
            tenant_ids.add(tenant_id)
        
        for file_path in base_path.glob("*.metadata.json"):
            tenant_id = file_path.stem.replace(".metadata", "")  # Remove .metadata.json
            tenant_ids.add(tenant_id)
        
        return sorted(list(tenant_ids))
    except Exception:
        return []


def get_aggregated_stats() -> dict:
    """
    Obtém estatísticas agregadas de todos os tenants.
    
    Returns:
        Dicionário com estatísticas agregadas
    """
    try:
        from services.vector_store import get_vector_store
        
        tenant_ids = get_all_tenant_ids()
        if not tenant_ids:
            # Se não houver tenants específicos, tenta o default
            tenant_ids = ["default"]
        
        total_docs = 0
        total_chunks = 0
        
        for tenant_id in tenant_ids:
            try:
                vector_store = get_vector_store(tenant_id)
                stats = vector_store.get_stats()
                total_docs += stats.get("documentCount", 0)
                total_chunks += stats.get("chunkCount", 0)
            except Exception:
                # Ignora erros de tenants específicos
                continue
        
        return {
            "indexedDocuments": total_docs,
            "indexedChunks": total_chunks,
            "tenantsCount": len(tenant_ids)
        }
    except Exception:
        return {
            "indexedDocuments": 0,
            "indexedChunks": 0,
            "tenantsCount": 0
        }


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
        
        # Tenta obter stats do vector store
        try:
            from services.vector_store import get_vector_store
            import logging
            logger = logging.getLogger(__name__)
            
            if tenant_id:
                # Estatísticas de um tenant específico
                logger.info(f"[Health] Obtendo vector store para tenant {tenant_id}")
                vector_store = get_vector_store(tenant_id)
                logger.info(f"[Health] Vector store obtido, chunks em memória: {len(vector_store.chunks)}")
                stats = vector_store.get_stats()
                logger.info(f"[Health] Stats retornados: {stats}")
                indexed_docs = stats.get("documentCount", 0)
                indexed_chunks = stats.get("chunkCount", 0)
                logger.info(f"[Health] Documentos: {indexed_docs}, Chunks: {indexed_chunks}")
            else:
                # Estatísticas agregadas de todos os tenants
                aggregated = get_aggregated_stats()
                indexed_docs = aggregated.get("indexedDocuments", 0)
                indexed_chunks = aggregated.get("indexedChunks", 0)
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"[Health] Erro ao obter stats do vector store: {e}", exc_info=True)
            indexed_docs = 0
            indexed_chunks = 0
        
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
            tenant_ids = get_all_tenant_ids()
            response["aggregated"] = True
            response["tenantsCount"] = len(tenant_ids) if tenant_ids else 1
        
        return response
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }

