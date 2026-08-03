"""
Serviço de geração de embeddings.
"""

from typing import List, Optional
from functools import lru_cache
import re
import numpy as np
import logging
from sentence_transformers import SentenceTransformer
from config.settings import get_settings

logger = logging.getLogger(__name__)

# Cache do modelo
_model: Optional[SentenceTransformer] = None


def get_embedding_model() -> SentenceTransformer:
    """
    Retorna instância do modelo de embeddings (singleton).
    
    Returns:
        Modelo SentenceTransformer
    """
    global _model
    if _model is None:
        settings = get_settings()
        _model = SentenceTransformer(settings.embedding_model)
    return _model


def _normalize_query_text(text: str) -> str:
    """Normaliza texto de query para uso como chave de cache."""
    return re.sub(r'\s+', ' ', text.strip().lower())


@lru_cache(maxsize=1024)
def _encode_query_cached(normalized_text: str) -> tuple:
    """
    Gera embedding de uma query normalizada com cache LRU.

    Retorna tupla (imutável) para proteger o cache de mutações externas.
    """
    model = get_embedding_model()
    embedding = model.encode(normalized_text, convert_to_numpy=True)
    return tuple(embedding.tolist())


def generate_embedding(text: str) -> List[float]:
    """
    Gera embedding para um texto (caminho de query, com cache LRU).

    Args:
        text: Texto para gerar embedding

    Returns:
        Lista de floats representando o embedding
    """
    return list(_encode_query_cached(_normalize_query_text(text)))


def generate_embeddings_batch(texts: List[str]) -> List[List[float]]:
    """
    Gera embeddings para múltiplos textos em batch.
    
    Args:
        texts: Lista de textos
    
    Returns:
        Lista de embeddings
    """
    model = get_embedding_model()
    embeddings = model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
    return embeddings.tolist()


def reset_embedding_model():
    """
    Invalida o modelo singleton e o cache LRU de queries.
    Chamado no reload de configuração: se embedding_model mudou, embeddings
    cacheados do modelo anterior não podem ser reutilizados.
    """
    global _model
    _model = None
    _encode_query_cached.cache_clear()

