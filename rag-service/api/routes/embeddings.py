"""
Endpoint utilitário para geração de embeddings.

Uso principal: permitir que o backend Node.js reutilize o MESMO modelo
de embeddings do serviço RAG para tarefas auxiliares (ex.: clusterização/ranking de FAQ).
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import logging

from services.embedding_service import generate_embeddings_batch
from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter()


class EmbeddingsRequest(BaseModel):
    texts: List[str]
    tenantId: Optional[str] = None  # apenas para logging/telemetria


class EmbeddingsResponse(BaseModel):
    success: bool
    embeddings: List[List[float]]
    model: str
    dimensions: int
    error: Optional[str] = None


def _sanitize_texts(texts: List[str]) -> List[str]:
    out: List[str] = []
    for t in texts or []:
        if t is None:
            continue
        s = str(t).strip()
        if not s:
            continue
        # Proteção contra payloads gigantes
        if len(s) > 4000:
            s = s[:4000]
        out.append(s)
        if len(out) >= 128:
            break
    return out


@router.post("/embeddings", response_model=EmbeddingsResponse)
def generate_embeddings(request: EmbeddingsRequest):
    """
    Gera embeddings em batch para uma lista de textos.
    """
    try:
        texts = _sanitize_texts(request.texts)
        if not texts:
            raise HTTPException(status_code=400, detail="texts deve conter ao menos 1 texto não vazio")

        settings = get_settings()
        logger.info(
            "[EMBEDDINGS] Gerando embeddings em batch",
            extra={
                "tenantId": request.tenantId,
                "textsCount": len(texts),
                "embeddingModel": settings.embedding_model,
            },
        )

        embeddings = generate_embeddings_batch(texts)
        dims = len(embeddings[0]) if embeddings and len(embeddings) > 0 else 0

        return EmbeddingsResponse(
            success=True,
            embeddings=embeddings,
            model=settings.embedding_model,
            dimensions=dims,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[EMBEDDINGS] Erro ao gerar embeddings: {e}", exc_info=True)
        return EmbeddingsResponse(
            success=False,
            embeddings=[],
            model=get_settings().embedding_model,
            dimensions=0,
            error=str(e),
        )

