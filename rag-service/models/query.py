"""
Modelos de dados para consultas RAG.
"""

from pydantic import BaseModel
from typing import Optional, List, Dict, Any


class QueryFilters(BaseModel):
    """Filtros para consulta RAG."""
    roles: Optional[List[str]] = None
    agentId: Optional[str] = None
    productId: Optional[str] = None
    clientId: Optional[str] = None
    category: Optional[str] = None


class QueryOptions(BaseModel):
    """Opções para consulta RAG."""
    topK: int = 5
    minScore: float = 0.5  # Reduzido de 0.6 para 0.5 para melhor captura de chunks relevantes
    maxTokens: int = 1000


class TenantContext(BaseModel):
    """Contexto cognitivo do tenant."""
    ramo_atividade: Optional[str] = None
    objetivo: Optional[str] = None
    site_oficial: Optional[str] = None
    prioridade: Optional[str] = "HIGH"
    escopo: Optional[List[str]] = None


class QueryRequest(BaseModel):
    """Request de consulta RAG."""
    query: str
    tenantId: str
    tenantContext: Optional[TenantContext] = None
    filters: Optional[QueryFilters] = None
    options: Optional[QueryOptions] = None


class Source(BaseModel):
    """Fonte (chunk) usado na resposta."""
    chunkId: str
    documentId: str
    title: str
    score: float
    excerpt: str
    metadata: Optional[Dict[str, Any]] = None  # Metadados para deduplicação


class QueryMetadata(BaseModel):
    """Metadados da consulta."""
    chunksSearched: int
    chunksFound: int
    tokensUsed: Optional[int] = None


class QueryResponse(BaseModel):
    """Resposta de consulta RAG."""
    success: bool
    response: str
    sources: List[Source]
    confidence: float
    metadata: QueryMetadata
    error: Optional[str] = None

