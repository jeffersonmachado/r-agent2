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
    minScore: float = 0.6
    maxTokens: int = 1000


class QueryRequest(BaseModel):
    """Request de consulta RAG."""
    query: str
    tenantId: str
    filters: Optional[QueryFilters] = None
    options: Optional[QueryOptions] = None


class Source(BaseModel):
    """Fonte (chunk) usado na resposta."""
    chunkId: str
    documentId: str
    title: str
    score: float
    excerpt: str


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

