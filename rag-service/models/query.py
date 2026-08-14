"""
Modelos de dados para consultas RAG.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


class QueryFilters(BaseModel):
    """Filtros para consulta RAG."""
    roles: Optional[List[str]] = Field(default=None, max_length=32)
    agentId: Optional[str] = Field(default=None, max_length=128)
    productId: Optional[str] = None
    clientId: Optional[str] = None
    category: Optional[str] = None


class QueryOptions(BaseModel):
    """Opções para consulta RAG."""
    topK: int = Field(default=5, ge=1, le=50)
    minScore: float = Field(default=0.5, ge=0.0, le=1.0)
    maxTokens: int = Field(default=1000, ge=1, le=2000)


class TenantContext(BaseModel):
    """Contexto cognitivo do tenant."""
    ramo_atividade: Optional[str] = None
    objetivo: Optional[str] = None
    site_oficial: Optional[str] = None
    prioridade: Optional[str] = "HIGH"
    escopo: Optional[List[str]] = None


class QueryScope(BaseModel):
    """
    Escopo obrigatório de recuperação, resolvido no backend (Domain Router).
    O serviço nunca amplia escopo: valores ausentes/inválidos caem no mais
    restritivo (OPERATIONAL/PRODUCTION).
    """
    domain: Optional[str] = None  # OPERATIONAL | SYSTEM
    classifications: Optional[List[str]] = None  # subconjunto de PRODUCTION | SUPPORT | DEVELOPMENT


class QueryRequest(BaseModel):
    """Request de consulta RAG."""
    query: str = Field(min_length=1, max_length=2000)
    tenantId: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$",
    )
    tenantContext: Optional[TenantContext] = None
    filters: Optional[QueryFilters] = None
    options: Optional[QueryOptions] = None
    scope: Optional[QueryScope] = None


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
    # Escopo efetivamente aplicado (evidência de segregação)
    domain: Optional[str] = None
    classificationsApplied: Optional[List[str]] = None
    sensitivitiesApplied: Optional[List[str]] = None


class QueryResponse(BaseModel):
    """Resposta de consulta RAG."""
    success: bool
    response: str
    sources: List[Source]
    confidence: float
    metadata: QueryMetadata
    error: Optional[str] = None
