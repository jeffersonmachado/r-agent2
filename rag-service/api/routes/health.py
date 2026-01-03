"""
Endpoint de health check.
"""

from fastapi import APIRouter
from config.settings import get_settings

router = APIRouter()


@router.get("/health")
async def health_check():
    """
    Health check do serviço RAG.
    
    Retorna status do serviço, vector store e modelo de embeddings.
    """
    try:
        settings = get_settings()
        
        # Tenta obter stats do vector store (pode falhar se não houver índice)
        try:
            from services.vector_store import get_vector_store
            vector_store = get_vector_store()
            stats = vector_store.get_stats()
            indexed_docs = stats.get("documentCount", 0)
            indexed_chunks = stats.get("chunkCount", 0)
        except Exception:
            indexed_docs = 0
            indexed_chunks = 0
        
        return {
            "status": "healthy",
            "vectorStore": settings.vector_store_type,
            "embeddingModel": settings.embedding_model,
            "indexedDocuments": indexed_docs,
            "indexedChunks": indexed_chunks
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }

