"""
Rota de BUSCA VETORIAL PURA (retrieve-only) — sem geração.

ACHADO REAL (2026-09-25): o serviço expunha apenas `POST /query`, cuja própria docstring diz
"Busca chunks relevantes E GERA RESPOSTA USANDO LLM". Consequência medida no enriquecimento de
engenharia: o Knowledge Plane pedia conhecimento para um tenant com ~5954 chunks SYSTEM indexados
e recebia `VECTOR_RAG_UNAVAILABLE` (circuit breaker aberto por indisponibilidade de geração) —
apesar de o dado estar lá e a busca vetorial não precisar de LLM nenhum para acontecer.

RETRIEVAL não é GERAÇÃO. Esta rota reusa EXATAMENTE o mesmo caminho da consulta completa
(`resolve_query_scope` → `generate_embedding` → `vector_store.search`), pulando apenas os passos
de NLP/LLM. Não é um segundo motor de busca: é o mesmo `VectorStore.search`, com o mesmo escopo de
segregação obrigatório, sem a etapa que exige provedor de IA.

Escopo de segregação: idêntico ao de `/query` — resolvido no SQL ANTES da busca vetorial. Ausente
ou inválido cai no mais restritivo. Não existe retrieval sem escopo nem fallback entre domínios.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request

from pydantic import BaseModel, Field

from models.query import QueryFilters, QueryScope
from services.embedding_service import generate_embedding
from services.vector_store import get_vector_store, normalize_tenant_id
from services.domain_policy import resolve_query_scope
from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter()


class SearchRequest(BaseModel):
    """Pedido de busca vetorial pura."""

    query: str = Field(min_length=1, max_length=2000)
    tenantId: str = Field(min_length=1, max_length=128)
    filters: Optional[QueryFilters] = None
    scope: Optional[QueryScope] = None
    topK: Optional[int] = Field(default=None, ge=1, le=50)
    minScore: Optional[float] = Field(default=None, ge=0.0, le=1.0)


def _serialize_chunk(chunk) -> dict:
    """
    Chunk no formato consumido pelo Knowledge Plane, com proveniência preservada.

    DEFEITO REAL corrigido em 2026-09-25: a primeira versão lia nomes INVENTADOS
    (`document_id`, `chunk_index`, `hash`) e procurava `domain`/`classification`/`sensitivity`
    dentro de `metadata` — quando, no modelo real (`models/document.py`), eles são atributos do
    próprio `Chunk` e `metadata` é um OBJETO `ChunkMetadata`, não um dict. Medido contra o serviço
    vivo: os chunks vinham com texto correto e proveniência TODA nula.

    O teste com `FakeChunk` não pegou porque o fake tinha exatamente a forma que eu supunha —
    só dados reais revelaram. Os campos abaixo são os que EXISTEM no modelo; nenhum é inventado.
    """
    metadata = getattr(chunk, "metadata", None)
    if isinstance(metadata, dict):
        meta_get = lambda key, default=None: metadata.get(key, default)  # noqa: E731
    elif metadata is not None:
        meta_get = lambda key, default=None: getattr(metadata, key, default)  # noqa: E731
    else:
        meta_get = lambda key, default=None: default  # noqa: E731

    return {
        "id": getattr(chunk, "id", None),
        "text": getattr(chunk, "content", None) or "",
        "score": getattr(chunk, "score", None),
        "documentId": getattr(chunk, "documentId", None),
        "tenantId": getattr(chunk, "tenantId", None),
        "chunkIndex": meta_get("chunkIndex"),
        "hash": meta_get("content_hash"),
        "semanticHash": meta_get("semantic_hash"),
        "sourceId": meta_get("source_id"),
        "sourceVersion": meta_get("source_version"),
        # Segregação: atributos do CHUNK (não do metadata).
        "domain": getattr(chunk, "domain", None),
        "classification": getattr(chunk, "classification", None),
        "sensitivity": getattr(chunk, "sensitivity", None),
    }


@router.post("/search")
def search_chunks(request: SearchRequest, http_request: Request):
    """
    Busca vetorial pura: devolve chunks com score e proveniência. NUNCA chama LLM.

    É o caminho correto para consumidores que precisam de CONTEÚDO (enriquecimento, RAG de
    engenharia, análise), não de uma resposta redigida.
    """
    try:
        settings = get_settings()

        if not request.query or not request.query.strip():
            raise HTTPException(status_code=400, detail="Query não pode ser vazia")
        if not request.tenantId:
            raise HTTPException(status_code=400, detail="tenantId é obrigatório")

        tenant_id = normalize_tenant_id(request.tenantId)

        # MESMO escopo obrigatório da consulta completa (aplicado no SQL antes da busca vetorial).
        scope = resolve_query_scope(request.scope.model_dump() if request.scope else None)

        top_k = request.topK or settings.default_top_k
        min_score = request.minScore if request.minScore is not None else settings.default_min_score

        # Mesmo caminho de embedding e de busca do /query — sem NLP e sem geração.
        query_embedding = generate_embedding(request.query)
        vector_store = get_vector_store(tenant_id)

        filters = {}
        if request.filters:
            if request.filters.roles:
                filters["roles"] = request.filters.roles
            if request.filters.agentId:
                filters["agentId"] = request.filters.agentId

        chunks = vector_store.search(query_embedding, top_k=top_k, filters=filters, scope=scope)
        found_before_filter = len(chunks)
        chunks = [chunk for chunk in chunks if chunk.score and chunk.score >= min_score]

        logger.info(
            "RAG search (retrieve-only)",
            extra={
                "tenant_id": tenant_id,
                "domain": scope["domain"],
                "classifications": scope["classifications"],
                "found": found_before_filter,
                "after_min_score": len(chunks),
            },
        )

        return {
            "success": True,
            "chunks": [_serialize_chunk(chunk) for chunk in chunks],
            "metadata": {
                "chunksFound": found_before_filter,
                "chunksReturned": len(chunks),
                "domain": scope["domain"],
                "classificationsApplied": scope["classifications"],
                "sensitivitiesApplied": scope["sensitivities"],
                "minScore": min_score,
                "topK": top_k,
                "generationUsed": False,
            },
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.error(f"Erro na busca vetorial: {error}")
        raise HTTPException(status_code=500, detail=f"Erro na busca vetorial: {error}")
