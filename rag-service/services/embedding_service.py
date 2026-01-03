"""
Serviço de geração de embeddings.
"""

from typing import List, Optional
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


def generate_embedding(text: str) -> List[float]:
    """
    Gera embedding para um texto.
    
    Args:
        text: Texto para gerar embedding
    
    Returns:
        Lista de floats representando o embedding
    """
    model = get_embedding_model()
    embedding = model.encode(text, convert_to_numpy=True)
    return embedding.tolist()


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

