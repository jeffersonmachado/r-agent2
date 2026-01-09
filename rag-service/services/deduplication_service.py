"""
Serviço de deduplicação RAG.

Responsabilidades:
- Verificar duplicidade estrutural (content_hash)
- Verificar duplicidade semântica (semantic_hash + cosine similarity)
- Gerenciar versionamento de documentos
- Registrar logs de auditoria

REGRAS:
- Toda deduplicação ocorre ANTES da recuperação
- Lógica determinística e reexecutável
- NÃO reindexa documentos existentes automaticamente
- NÃO remove dados históricos
"""

import hashlib
import json
import logging
from typing import Dict, List, Optional, Tuple
import numpy as np
from models.document import Chunk

logger = logging.getLogger(__name__)

# Storage em memória para metadados de chunks (em produção, usar Redis ou DB)
# Estrutura: {tenant_id: {content_hash: metadata}}
_content_hash_index: Dict[str, Dict[str, Dict]] = {}

# Estrutura: {tenant_id: {chunk_id: metadata}}
_chunk_index: Dict[str, Dict[str, Dict]] = {}

# Estrutura: {tenant_id: {source_id: {current_version: int, versions: List[int]}}}
_source_version_index: Dict[str, Dict[str, Dict]] = {}


def normalize_content(text: str) -> str:
    """
    Normaliza texto para comparação e hash.
    
    Args:
        text: Texto a normalizar
    
    Returns:
        Texto normalizado
    """
    if not text or not isinstance(text, str):
        return ''
    
    return (
        text.lower()
        .replace('\r\n', '\n')
        .replace('\r', '\n')
        .replace('\n{3,}', '\n\n')  # Máximo 2 quebras consecutivas
        .replace('[ \t]+', ' ')  # Remove espaços duplicados
        .strip()
    )


def generate_content_hash(text: str) -> str:
    """
    Gera hash SHA-256 de um texto normalizado.
    
    Args:
        text: Texto para hash
    
    Returns:
        Hash hexadecimal
    """
    normalized = normalize_content(text)
    return hashlib.sha256(normalized.encode('utf-8')).hexdigest()


def generate_chunk_id(document_id: str, section_title: str = '', chunk_index: int = 0) -> str:
    """
    Gera chunk_id determinístico.
    
    chunk_id = SHA-256(document_id + section_title + chunk_index)
    
    Args:
        document_id: ID do documento
        section_title: Título da seção (ou '' se não houver)
        chunk_index: Índice do chunk (0-based)
    
    Returns:
        chunk_id determinístico
    """
    input_str = f"{document_id}|{section_title}|{chunk_index}"
    return hashlib.sha256(input_str.encode('utf-8')).hexdigest()


def generate_semantic_hash(embedding: List[float]) -> str:
    """
    Gera hash semântico a partir de um embedding normalizado.
    
    Args:
        embedding: Vetor de embedding (já normalizado L2)
    
    Returns:
        Hash hexadecimal do embedding
    """
    if not embedding or len(embedding) == 0:
        raise ValueError('Embedding deve ser uma lista não vazia')
    
    # Converte embedding para string fixa (precisão de 6 casas decimais)
    embedding_str = ','.join(f"{v:.6f}" for v in embedding)
    return hashlib.sha256(embedding_str.encode('utf-8')).hexdigest()


def normalize_embedding(embedding: List[float]) -> List[float]:
    """
    Normaliza embedding usando L2 normalization.
    
    Args:
        embedding: Vetor de embedding
    
    Returns:
        Embedding normalizado
    """
    if not embedding or len(embedding) == 0:
        raise ValueError('Embedding deve ser uma lista não vazia')
    
    embedding_array = np.array(embedding)
    norm = np.linalg.norm(embedding_array)
    
    if norm == 0:
        raise ValueError('Embedding não pode ter norma zero')
    
    normalized = embedding_array / norm
    return normalized.tolist()


def cosine_similarity(embedding1: List[float], embedding2: List[float]) -> float:
    """
    Calcula similaridade cosseno entre dois embeddings.
    
    Args:
        embedding1: Primeiro embedding
        embedding2: Segundo embedding
    
    Returns:
        Similaridade cosseno (0 a 1)
    """
    if not embedding1 or not embedding2:
        raise ValueError('Embeddings devem ser listas não vazias')
    
    if len(embedding1) != len(embedding2):
        raise ValueError('Embeddings devem ter a mesma dimensão')
    
    vec1 = np.array(embedding1)
    vec2 = np.array(embedding2)
    
    dot_product = np.dot(vec1, vec2)
    norm1 = np.linalg.norm(vec1)
    norm2 = np.linalg.norm(vec2)
    
    if norm1 == 0 or norm2 == 0:
        return 0.0
    
    return float(dot_product / (norm1 * norm2))


def initialize_tenant_indices(tenant_id: str):
    """Inicializa índices para um tenant."""
    if tenant_id not in _content_hash_index:
        _content_hash_index[tenant_id] = {}
    if tenant_id not in _chunk_index:
        _chunk_index[tenant_id] = {}
    if tenant_id not in _source_version_index:
        _source_version_index[tenant_id] = {}


def check_structural_duplicate(tenant_id: str, content_hash: str, source_id: Optional[str] = None) -> Dict:
    """
    Verifica duplicidade estrutural (content_hash).
    
    Args:
        tenant_id: ID do tenant
        content_hash: Hash do conteúdo normalizado
        source_id: ID da fonte (opcional, para logs)
    
    Returns:
        {is_duplicate: bool, existing_chunk?: Dict, reason?: str}
    """
    initialize_tenant_indices(tenant_id)
    
    tenant_content_hash = _content_hash_index[tenant_id]
    existing = tenant_content_hash.get(content_hash)

    if existing:
        logger.info(
            f'[RAGDeduplication] Duplicidade estrutural detectada',
            extra={
                'tenant_id': tenant_id,
                'content_hash': content_hash[:16] + '...',
                'source_id': source_id,
                'existing_chunk_id': existing.get('chunk_id'),
                'existing_document_id': existing.get('document_id'),
            }
        )

        return {
            'is_duplicate': True,
            'existing_chunk': existing,
            'reason': 'content_hash_duplicate',
        }

    return {'is_duplicate': False}


def check_semantic_duplicate(
    tenant_id: str,
    embedding: List[float],
    semantic_hash: str,
    source_id: Optional[str] = None
) -> Dict:
    """
    Verifica duplicidade semântica (similaridade de embedding > 0.97).
    
    Args:
        tenant_id: ID do tenant
        embedding: Embedding normalizado
        semantic_hash: Hash do embedding
        source_id: ID da fonte (opcional, para logs)
    
    Returns:
        {is_duplicate: bool, existing_chunk?: Dict, similarity?: float, reason?: str}
    """
    initialize_tenant_indices(tenant_id)
    
    tenant_chunks = _chunk_index[tenant_id]
    normalized_embedding = normalize_embedding(embedding)

    max_similarity = 0.0
    most_similar_chunk = None

    for chunk_id, chunk_metadata in tenant_chunks.items():
        # Verifica se chunk está ativo
        if not chunk_metadata.get('active', True):
            continue

        # Se tem semantic_hash igual, é duplicata exata
        if chunk_metadata.get('semantic_hash') == semantic_hash:
            logger.info(
                f'[RAGDeduplication] Duplicidade semântica exata detectada (semantic_hash)',
                extra={
                    'tenant_id': tenant_id,
                    'semantic_hash': semantic_hash[:16] + '...',
                    'source_id': source_id,
                    'existing_chunk_id': chunk_id,
                    'existing_document_id': chunk_metadata.get('document_id'),
                }
            )

            return {
                'is_duplicate': True,
                'existing_chunk': {**chunk_metadata, 'chunk_id': chunk_id},
                'similarity': 1.0,
                'reason': 'semantic_hash_exact_duplicate',
            }

        # Se tem embedding armazenado, calcula similaridade
        stored_embedding = chunk_metadata.get('embedding')
        if stored_embedding and isinstance(stored_embedding, list):
            try:
                similarity = cosine_similarity(normalized_embedding, stored_embedding)
                
                if similarity > max_similarity:
                    max_similarity = similarity
                    most_similar_chunk = {**chunk_metadata, 'chunk_id': chunk_id}
            except Exception as err:
                logger.warn(
                    f'[RAGDeduplication] Erro ao calcular similaridade',
                    extra={
                        'tenant_id': tenant_id,
                        'chunk_id': chunk_id,
                        'error': str(err),
                    }
                )

    # Threshold de 0.97 para considerar duplicata semântica
    if max_similarity > 0.97:
        logger.info(
            f'[RAGDeduplication] Duplicidade semântica detectada (similaridade alta)',
            extra={
                'tenant_id': tenant_id,
                'semantic_hash': semantic_hash[:16] + '...',
                'source_id': source_id,
                'similarity': max_similarity,
                'existing_chunk_id': most_similar_chunk.get('chunk_id') if most_similar_chunk else None,
                'existing_document_id': most_similar_chunk.get('document_id') if most_similar_chunk else None,
            }
        )

        return {
            'is_duplicate': True,
            'existing_chunk': most_similar_chunk,
            'similarity': max_similarity,
            'reason': 'semantic_similarity_duplicate',
        }

    return {'is_duplicate': False, 'similarity': max_similarity}


def register_chunk(tenant_id: str, chunk_metadata: Dict, embedding: Optional[List[float]] = None):
    """
    Registra chunk nos índices de deduplicação.
    
    Args:
        tenant_id: ID do tenant
        chunk_metadata: Metadados do chunk
        embedding: Embedding do chunk (opcional, para similaridade futura)
    """
    initialize_tenant_indices(tenant_id)

    chunk_id = chunk_metadata.get('chunk_id')
    document_id = chunk_metadata.get('document_id')
    source_id = chunk_metadata.get('source_id')
    source_version = chunk_metadata.get('source_version', 1)
    content_hash = chunk_metadata.get('content_hash')
    semantic_hash = chunk_metadata.get('semantic_hash')
    active = chunk_metadata.get('active', True)

    # Valida metadados obrigatórios
    if not all([chunk_id, document_id, source_id, content_hash, semantic_hash]):
        raise ValueError('Metadados obrigatórios faltando: chunk_id, document_id, source_id, content_hash, semantic_hash')

    metadata = {
        'tenant_id': tenant_id,
        'chunk_id': chunk_id,
        'document_id': document_id,
        'source_id': source_id,
        'source_version': source_version,
        'content_hash': content_hash,
        'semantic_hash': semantic_hash,
        'active': active,
        'created_at': chunk_metadata.get('created_at'),
        'embedding': normalize_embedding(embedding) if embedding else None,
    }

    # Registra no índice de content_hash
    _content_hash_index[tenant_id][content_hash] = metadata

    # Registra no índice de chunk_id
    _chunk_index[tenant_id][chunk_id] = metadata

    # Atualiza versionamento de source
    if source_id not in _source_version_index[tenant_id]:
        _source_version_index[tenant_id][source_id] = {
            'current_version': source_version,
            'versions': [],
        }

    source_info = _source_version_index[tenant_id][source_id]
    if source_version > source_info['current_version']:
        # Nova versão: marca versões anteriores como inativas
        for chunk_id_key, chunk_meta in _chunk_index[tenant_id].items():
            if (chunk_meta.get('source_id') == source_id and 
                chunk_meta.get('source_version', 1) < source_version):
                chunk_meta['active'] = False
                _chunk_index[tenant_id][chunk_id_key] = chunk_meta
        source_info['current_version'] = source_version

    if source_version not in source_info['versions']:
        source_info['versions'].append(source_version)

    logger.debug(
        f'[RAGDeduplication] Chunk registrado',
        extra={
            'tenant_id': tenant_id,
            'chunk_id': chunk_id[:16] + '...',
            'document_id': document_id,
            'source_id': source_id,
            'source_version': source_version,
        }
    )


def deactivate_previous_versions(tenant_id: str, source_id: str, new_version: int):
    """
    Marca versões anteriores de um source como inativas.
    
    Args:
        tenant_id: ID do tenant
        source_id: ID da fonte
        new_version: Nova versão
    """
    initialize_tenant_indices(tenant_id)
    
    tenant_chunks = _chunk_index[tenant_id]
    deactivated_count = 0

    for chunk_id, chunk_meta in tenant_chunks.items():
        if (chunk_meta.get('source_id') == source_id and 
            chunk_meta.get('source_version', 1) < new_version and 
            chunk_meta.get('active', True)):
            chunk_meta['active'] = False
            tenant_chunks[chunk_id] = chunk_meta
            deactivated_count += 1

    if deactivated_count > 0:
        logger.info(
            f'[RAGDeduplication] Versões anteriores desativadas',
            extra={
                'tenant_id': tenant_id,
                'source_id': source_id,
                'new_version': new_version,
                'deactivated_count': deactivated_count,
            }
        )


def get_current_source_version(tenant_id: str, source_id: str) -> int:
    """
    Obtém versão atual de um source.
    
    Args:
        tenant_id: ID do tenant
        source_id: ID da fonte
    
    Returns:
        Versão atual ou 1 se não existir
    """
    initialize_tenant_indices(tenant_id)
    
    source_info = _source_version_index[tenant_id].get(source_id)
    return source_info['current_version'] if source_info else 1


def filter_chunks_for_retrieval(tenant_id: str, chunks: List[Dict]) -> List[Dict]:
    """
    Filtra chunks para recuperação (remove duplicatas e inativos).
    
    Args:
        tenant_id: ID do tenant
        chunks: Chunks recuperados
    
    Returns:
        Chunks filtrados (máximo 1 por source_id, apenas active=True)
    """
    if not chunks or len(chunks) == 0:
        return []

    # Filtra apenas chunks ativos do tenant correto
    active_chunks = [
        chunk for chunk in chunks
        if (chunk.get('metadata', {}).get('active', True) and
            chunk.get('metadata', {}).get('tenant_id') == tenant_id)
    ]

    # Agrupa por source_id e mantém apenas o melhor de cada
    source_map = {}

    for chunk in active_chunks:
        metadata = chunk.get('metadata', {})
        source_id = metadata.get('source_id')

        if not source_id:
            continue

        score = chunk.get('score') or chunk.get('similarity') or 0.0
        existing = source_map.get(source_id)

        if not existing or score > (existing.get('score') or existing.get('similarity') or 0.0):
            source_map[source_id] = chunk

    filtered = list(source_map.values())

    logger.debug(
        f'[RAGDeduplication] Chunks filtrados para recuperação',
        extra={
            'tenant_id': tenant_id,
            'original_count': len(chunks),
            'active_count': len(active_chunks),
            'filtered_count': len(filtered),
            'sources_count': len(source_map),
        }
    )

    return filtered


def get_deduplication_stats(tenant_id: str) -> Dict:
    """
    Obtém estatísticas de deduplicação para um tenant.
    
    Args:
        tenant_id: ID do tenant
    
    Returns:
        Estatísticas
    """
    initialize_tenant_indices(tenant_id)
    
    tenant_content_hash = _content_hash_index[tenant_id]
    tenant_chunks = _chunk_index[tenant_id]
    tenant_sources = _source_version_index[tenant_id]

    active_chunks = [c for c in tenant_chunks.values() if c.get('active', True)]
    inactive_chunks = [c for c in tenant_chunks.values() if not c.get('active', True)]

    return {
        'total_content_hashes': len(tenant_content_hash),
        'total_chunks': len(tenant_chunks),
        'active_chunks': len(active_chunks),
        'inactive_chunks': len(inactive_chunks),
        'total_sources': len(tenant_sources),
        'sources_with_multiple_versions': len([
            s for s in tenant_sources.values() if len(s.get('versions', [])) > 1
        ]),
    }
