"""
Endpoint de indexação de documentos.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime
import logging

from models.document import Document, DocumentMetadata, DocumentPermissions
from services.chunking_service import chunk_document
from services.embedding_service import generate_embeddings_batch
from services.vector_store import get_vector_store

logger = logging.getLogger(__name__)

router = APIRouter()


class IndexRequest(BaseModel):
    """Request de indexação."""
    document: Dict[str, Any]


class IndexResponse(BaseModel):
    """Resposta de indexação."""
    success: bool
    documentId: str
    chunksCreated: int
    error: Optional[str] = None


@router.post("/index", response_model=IndexResponse)
async def index_document(request: IndexRequest):
    """
    Indexa um documento.
    
    Chunking, geração de embeddings e adição ao índice vetorial.
    """
    try:
        # Valida e cria documento
        doc_data = request.document
        
        if not doc_data.get('id'):
            raise HTTPException(status_code=400, detail="Documento deve ter 'id'")
        if not doc_data.get('tenantId'):
            raise HTTPException(status_code=400, detail="Documento deve ter 'tenantId'")
        if not doc_data.get('content'):
            raise HTTPException(status_code=400, detail="Documento deve ter 'content'")
        
        # Cria metadados
        now = datetime.utcnow().isoformat()
        metadata = DocumentMetadata(
            source=doc_data.get('metadata', {}).get('source'),
            category=doc_data.get('metadata', {}).get('category'),
            productId=doc_data.get('metadata', {}).get('productId'),
            clientId=doc_data.get('metadata', {}).get('clientId'),
            tags=doc_data.get('metadata', {}).get('tags'),
            author=doc_data.get('metadata', {}).get('author'),
            createdAt=doc_data.get('metadata', {}).get('createdAt', now),
            updatedAt=doc_data.get('metadata', {}).get('updatedAt', now),
            version=doc_data.get('metadata', {}).get('version', 1)
        )
        
        # Cria permissões
        permissions = DocumentPermissions(
            roles=doc_data.get('permissions', {}).get('roles'),
            agents=doc_data.get('permissions', {}).get('agents')
        )
        
        # Cria documento
        document = Document(
            id=doc_data['id'],
            tenantId=doc_data['tenantId'],
            title=doc_data.get('title', 'Sem título'),
            content=doc_data['content'],
            metadata=metadata,
            permissions=permissions,
            status=doc_data.get('status', 'active')
        )
        
        # Chunking
        chunks = chunk_document(document)
        
        if not chunks:
            return IndexResponse(
                success=False,
                documentId=document.id,
                chunksCreated=0,
                error="Nenhum chunk criado (documento vazio?)"
            )
        
        # Gera embeddings em batch
        chunk_texts = [chunk.content for chunk in chunks]
        embeddings = generate_embeddings_batch(chunk_texts)
        
        # Adiciona ao vector store
        vector_store = get_vector_store(document.tenantId)
        vector_store.add_chunks(chunks, embeddings)
        
        # Validação: verifica se os chunks foram realmente adicionados
        chunks_added = 0
        for chunk in chunks:
            if chunk.id in vector_store.chunks:
                chunks_added += 1
        
        if chunks_added < len(chunks):
            logger.warning(f"Alguns chunks não foram adicionados: {chunks_added}/{len(chunks)} para documento {document.id}")
        
        logger.info(f"Documento indexado: {document.id}, chunks criados: {len(chunks)}, chunks adicionados: {chunks_added}")
        
        return IndexResponse(
            success=True,
            documentId=document.id,
            chunksCreated=len(chunks)
        )
    
    except HTTPException:
        raise
    except Exception as e:
        return IndexResponse(
            success=False,
            documentId=request.document.get('id', 'unknown'),
            chunksCreated=0,
            error=str(e)
        )

