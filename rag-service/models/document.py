"""
Modelos de dados para documentos e chunks.
"""

from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime


class DocumentMetadata(BaseModel):
    """Metadados de um documento."""
    source: Optional[str] = None
    category: Optional[str] = None
    productId: Optional[str] = None
    clientId: Optional[str] = None
    tags: Optional[List[str]] = None
    author: Optional[str] = None
    createdAt: str
    updatedAt: str
    version: int = 1


class DocumentPermissions(BaseModel):
    """Permissões de acesso a um documento."""
    roles: Optional[List[str]] = None
    agents: Optional[List[str]] = None


class Document(BaseModel):
    """Modelo de documento."""
    id: str
    tenantId: str
    title: str
    content: str
    metadata: DocumentMetadata
    permissions: DocumentPermissions
    status: str = "active"  # active | archived | deleted
    # Segregação de domínios (obrigatória na ingestão)
    domain: str = "OPERATIONAL"  # OPERATIONAL | SYSTEM
    classification: str = "PRODUCTION"  # PRODUCTION | SUPPORT | DEVELOPMENT
    sensitivity: str = "INTERNAL"  # PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED


class ChunkMetadata(BaseModel):
    """Metadados de um chunk."""
    chunkIndex: int
    startChar: int
    endChar: int
    tokenCount: int
    # Campos de deduplicação (opcionais)
    source_id: Optional[str] = None
    source_version: Optional[int] = None
    content_hash: Optional[str] = None
    semantic_hash: Optional[str] = None
    chunk_id: Optional[str] = None
    tenant_id: Optional[str] = None
    active: Optional[bool] = True


class Chunk(BaseModel):
    """Modelo de chunk."""
    id: str
    documentId: str
    tenantId: str
    content: str
    embedding: Optional[List[float]] = None
    metadata: ChunkMetadata
    permissions: DocumentPermissions
    score: Optional[float] = None  # Score de similaridade (usado em busca)
    # Segregação de domínios (propagada do documento)
    domain: str = "OPERATIONAL"
    classification: str = "PRODUCTION"
    sensitivity: str = "INTERNAL"

