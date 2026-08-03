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
- Estado de deduplicação é persistido no Postgres (`rag_chunks.metadata`);
  NÃO há índices em memória (eram perdidos a cada restart e não escalavam).
- Falha de DB durante a deduplicação propaga erro explícito
  (persistence_required): nunca tratar falha como "não duplicado".
"""

import hashlib
import json
import logging
from typing import Dict, List, Optional
import numpy as np

from services.vector_store import _get_conn, _pgvector_literal

logger = logging.getLogger(__name__)

# Threshold de similaridade cosseno para considerar duplicata semântica
SEMANTIC_DUPLICATE_THRESHOLD = 0.97


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


# ---------------------------------------------------------------------------
# Camada de acesso ao Postgres (rag_chunks)
# ---------------------------------------------------------------------------
# Os metadados de dedup (source_id, source_version, content_hash,
# semantic_hash, active, tenant_id, chunk_id) são gravados pelo fluxo de
# indexação dentro do JSONB `metadata` de rag_chunks. As consultas abaixo
# filtram sempre por tenant_key; linhas antigas sem as chaves no metadata
# simplesmente não casam (degradação graciosa, equivalente ao comportamento
# pós-restart da versão em memória).

def _row_to_existing_chunk(row) -> Dict:
    """
    Converte row (id, document_id, metadata) do Postgres para o formato
    `existing_chunk` (chunk_id/document_id da linha + campos do metadata).
    """
    chunk_id, document_id, metadata = row
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except Exception:
            metadata = {}
    metadata = metadata if isinstance(metadata, dict) else {}
    return {**metadata, 'chunk_id': str(chunk_id), 'document_id': str(document_id)}


def _fetch_chunk_by_content_hash(tenant_id: str, content_hash: str) -> Optional[Dict]:
    """Busca chunk pelo content_hash do documento (dedup estrutural)."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, document_id, metadata
                FROM rag_chunks
                WHERE tenant_key = %s
                  AND metadata->>'content_hash' = %s
                LIMIT 1
                """,
                (tenant_id, content_hash),
            )
            row = cur.fetchone()
    return _row_to_existing_chunk(row) if row else None


def _fetch_chunk_by_semantic_hash(tenant_id: str, semantic_hash: str) -> Optional[Dict]:
    """Busca chunk ativo pelo semantic_hash (dedup semântica exata)."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, document_id, metadata
                FROM rag_chunks
                WHERE tenant_key = %s
                  AND metadata->>'semantic_hash' = %s
                  AND COALESCE((metadata->>'active')::boolean, true)
                LIMIT 1
                """,
                (tenant_id, semantic_hash),
            )
            row = cur.fetchone()
    return _row_to_existing_chunk(row) if row else None


def _fetch_most_similar_chunk(tenant_id: str, embedding: List[float]) -> Optional[Dict]:
    """
    Busca o chunk ativo mais similar no Postgres via pgvector (cosseno).
    Substitui o varredura O(N) em memória com numpy.
    """
    qv = _pgvector_literal(embedding)
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, document_id, metadata,
                       1 - (embedding <=> %s::vector) AS similarity
                FROM rag_chunks
                WHERE tenant_key = %s
                  AND COALESCE((metadata->>'active')::boolean, true)
                ORDER BY embedding <=> %s::vector
                LIMIT 1
                """,
                (qv, tenant_id, qv),
            )
            row = cur.fetchone()
    if not row:
        return None
    chunk_id, document_id, metadata, similarity = row
    return {
        'chunk': _row_to_existing_chunk((chunk_id, document_id, metadata)),
        'similarity': float(similarity) if similarity is not None else 0.0,
    }


def _update_deactivate_previous_versions(tenant_id: str, source_id: str, new_version: int) -> int:
    """Marca versões anteriores de um source como inativas (metadata.active=false)."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE rag_chunks
                SET metadata = jsonb_set(metadata, '{active}', 'false'::jsonb)
                WHERE tenant_key = %s
                  AND metadata->>'source_id' = %s
                  AND COALESCE((metadata->>'source_version')::int, 1) < %s
                  AND COALESCE((metadata->>'active')::boolean, true)
                """,
                (tenant_id, source_id, int(new_version)),
            )
            return cur.rowcount or 0


def _fetch_max_source_version(tenant_id: str, source_id: str) -> Optional[int]:
    """Retorna a maior source_version persistida para o source (None se não houver)."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT MAX(COALESCE((metadata->>'source_version')::int, 1))
                FROM rag_chunks
                WHERE tenant_key = %s
                  AND metadata->>'source_id' = %s
                """,
                (tenant_id, source_id),
            )
            row = cur.fetchone()
    if row and row[0] is not None:
        return int(row[0])
    return None


def check_structural_duplicate(tenant_id: str, content_hash: str, source_id: Optional[str] = None) -> Dict:
    """
    Verifica duplicidade estrutural (content_hash) consultando o Postgres.
    
    Args:
        tenant_id: ID do tenant
        content_hash: Hash do conteúdo normalizado
        source_id: ID da fonte (opcional, para logs)
    
    Returns:
        {is_duplicate: bool, existing_chunk?: Dict, reason?: str}
    """
    existing = _fetch_chunk_by_content_hash(tenant_id, content_hash)

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
    source_id: Optional[str] = None,
    batch_accepted: Optional[List[Dict]] = None
) -> Dict:
    """
    Verifica duplicidade semântica (similaridade de embedding > 0.97).

    A verificação ocorre em duas frentes:
    1. Batch corrente (`batch_accepted`): chunks já aceitos do MESMO documento
       ainda não foram commitados no Postgres, então são comparados em memória
       (batches são pequenos — dezenas de chunks — O(batch²) local é aceitável).
       Cada entrada: {embedding: List[float], chunk_metadata: Dict}.
    2. Postgres: semantic_hash exato e vizinho mais próximo via pgvector.
    
    Args:
        tenant_id: ID do tenant
        embedding: Embedding normalizado
        semantic_hash: Hash do embedding
        source_id: ID da fonte (opcional, para logs)
        batch_accepted: Chunks já aceitos no batch corrente (opcional)
    
    Returns:
        {is_duplicate: bool, existing_chunk?: Dict, similarity?: float, reason?: str}
    """
    normalized_embedding = normalize_embedding(embedding)

    max_similarity = 0.0
    most_similar_chunk = None

    # 1) Dedup intra-documento contra o batch corrente (não commitado ainda)
    for accepted in (batch_accepted or []):
        accepted_metadata = accepted.get('chunk_metadata') or {}

        # Se tem semantic_hash igual, é duplicata exata
        if accepted_metadata.get('semantic_hash') == semantic_hash:
            logger.info(
                f'[RAGDeduplication] Duplicidade semântica exata detectada no batch corrente (semantic_hash)',
                extra={
                    'tenant_id': tenant_id,
                    'semantic_hash': semantic_hash[:16] + '...',
                    'source_id': source_id,
                    'existing_chunk_id': accepted_metadata.get('chunk_id'),
                    'existing_document_id': accepted_metadata.get('document_id'),
                }
            )

            return {
                'is_duplicate': True,
                'existing_chunk': accepted_metadata,
                'similarity': 1.0,
                'reason': 'semantic_hash_exact_duplicate',
            }

        accepted_embedding = accepted.get('embedding')
        if accepted_embedding and isinstance(accepted_embedding, list):
            try:
                similarity = cosine_similarity(normalized_embedding, accepted_embedding)
                if similarity > max_similarity:
                    max_similarity = similarity
                    most_similar_chunk = dict(accepted_metadata)
            except Exception as err:
                logger.warning(
                    f'[RAGDeduplication] Erro ao calcular similaridade no batch corrente',
                    extra={
                        'tenant_id': tenant_id,
                        'chunk_id': accepted_metadata.get('chunk_id'),
                        'error': str(err),
                    }
                )

    # 2) Duplicata exata no Postgres (semantic_hash)
    exact = _fetch_chunk_by_semantic_hash(tenant_id, semantic_hash)
    if exact:
        logger.info(
            f'[RAGDeduplication] Duplicidade semântica exata detectada (semantic_hash)',
            extra={
                'tenant_id': tenant_id,
                'semantic_hash': semantic_hash[:16] + '...',
                'source_id': source_id,
                'existing_chunk_id': exact.get('chunk_id'),
                'existing_document_id': exact.get('document_id'),
            }
        )

        return {
            'is_duplicate': True,
            'existing_chunk': exact,
            'similarity': 1.0,
            'reason': 'semantic_hash_exact_duplicate',
        }

    # 3) Vizinho mais próximo no Postgres (pgvector, cosseno)
    nearest = _fetch_most_similar_chunk(tenant_id, normalized_embedding)
    if nearest and nearest['similarity'] > max_similarity:
        max_similarity = nearest['similarity']
        most_similar_chunk = nearest['chunk']

    # Threshold de 0.97 para considerar duplicata semântica
    if max_similarity > SEMANTIC_DUPLICATE_THRESHOLD:
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
    No-op de compatibilidade: a deduplicação agora é persistida no Postgres
    (via VectorStore.add_chunks); não existem mais índices em memória nem
    embeddings retidos em RAM.

    Mantida para não quebrar imports/callers; preserva apenas a validação
    dos metadados obrigatórios do contrato anterior.
    
    Args:
        tenant_id: ID do tenant
        chunk_metadata: Metadados do chunk
        embedding: Embedding do chunk (ignorado; persistência é via add_chunks)
    """
    # Valida metadados obrigatórios (contrato preservado)
    if not all([
        chunk_metadata.get('chunk_id'),
        chunk_metadata.get('document_id'),
        chunk_metadata.get('source_id'),
        chunk_metadata.get('content_hash'),
        chunk_metadata.get('semantic_hash'),
    ]):
        raise ValueError('Metadados obrigatórios faltando: chunk_id, document_id, source_id, content_hash, semantic_hash')

    logger.debug(
        f'[RAGDeduplication] Chunk aceito (persistência via add_chunks)',
        extra={
            'tenant_id': tenant_id,
            'chunk_id': chunk_metadata['chunk_id'][:16] + '...',
            'document_id': chunk_metadata['document_id'],
            'source_id': chunk_metadata['source_id'],
            'source_version': chunk_metadata.get('source_version', 1),
        }
    )


def deactivate_previous_versions(tenant_id: str, source_id: str, new_version: int):
    """
    Marca versões anteriores de um source como inativas no Postgres
    (metadata.active=false), preservando o histórico.
    
    Args:
        tenant_id: ID do tenant
        source_id: ID da fonte
        new_version: Nova versão
    """
    deactivated_count = _update_deactivate_previous_versions(tenant_id, source_id, new_version)

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
    Obtém versão atual de um source a partir do Postgres.
    
    Args:
        tenant_id: ID do tenant
        source_id: ID da fonte
    
    Returns:
        Versão atual ou 1 se não existir
    """
    max_version = _fetch_max_source_version(tenant_id, source_id)
    return max_version if max_version is not None else 1


def filter_chunks_for_retrieval(tenant_id: str, chunks: List[Dict]) -> List[Dict]:
    """
    Filtra chunks para recuperação (remove duplicatas e inativos).

    Opera apenas sobre a lista recebida (não consulta índices nem DB).
    
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
    Obtém estatísticas de deduplicação para um tenant a partir do Postgres.
    
    Args:
        tenant_id: ID do tenant
    
    Returns:
        Estatísticas (mesmas chaves da versão em memória)
    """
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  COUNT(*)::int AS total_chunks,
                  COUNT(*) FILTER (WHERE COALESCE((metadata->>'active')::boolean, true))::int AS active_chunks,
                  COUNT(*) FILTER (WHERE NOT COALESCE((metadata->>'active')::boolean, true))::int AS inactive_chunks,
                  COUNT(DISTINCT metadata->>'content_hash')::int AS total_content_hashes,
                  COUNT(DISTINCT metadata->>'source_id')::int AS total_sources
                FROM rag_chunks
                WHERE tenant_key = %s
                """,
                (tenant_id,),
            )
            row = cur.fetchone()
            cur.execute(
                """
                SELECT COUNT(*)::int
                FROM (
                  SELECT metadata->>'source_id' AS source_id
                  FROM rag_chunks
                  WHERE tenant_key = %s
                    AND metadata->>'source_id' IS NOT NULL
                  GROUP BY metadata->>'source_id'
                  HAVING COUNT(DISTINCT COALESCE((metadata->>'source_version')::int, 1)) > 1
                ) multi_version_sources
                """,
                (tenant_id,),
            )
            multi_version_row = cur.fetchone()

    total_chunks, active_chunks, inactive_chunks, total_content_hashes, total_sources = row

    return {
        'total_content_hashes': int(total_content_hashes or 0),
        'total_chunks': int(total_chunks or 0),
        'active_chunks': int(active_chunks or 0),
        'inactive_chunks': int(inactive_chunks or 0),
        'total_sources': int(total_sources or 0),
        'sources_with_multiple_versions': int(multi_version_row[0] if multi_version_row else 0),
    }
