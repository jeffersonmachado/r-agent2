"""
Endpoint de consulta RAG.
"""

from fastapi import APIRouter, HTTPException
from models.query import QueryRequest, QueryResponse, Source, QueryMetadata
from services.embedding_service import generate_embedding
from services.vector_store import get_vector_store
from services.llm_service import generate_response
from services.nlp_service import process_nlp, improve_query_for_rag
from config.settings import get_settings
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


def build_rag_prompt(query: str, chunks: list) -> str:
    """
    Constrói prompt RAG com contexto.
    
    Args:
        query: Query do usuário
        chunks: Lista de chunks relevantes
    
    Returns:
        Prompt completo
    """
    # Concatena contexto dos chunks
    context_parts = []
    for i, chunk in enumerate(chunks, 1):
        context_parts.append(f"[Fonte {i}]\n{chunk.content}")
    
    context = "\n\n".join(context_parts)
    
    prompt = f"""Você é um assistente especializado em atendimento ao cliente.

Contexto relevante:
{context}

Pergunta do usuário: {query}

Instruções:
- Responda baseado APENAS no contexto fornecido
- Se o contexto não contém informação suficiente, diga "Não tenho informação suficiente sobre isso. Posso transferir você para um atendente humano?"
- Seja claro, objetivo e amigável
- Cite as fontes quando relevante (ex: "De acordo com a Fonte 1...")
"""
    
    return prompt


def calculate_confidence(chunks: list, min_score: float) -> float:
    """
    Calcula confidence baseado nos scores dos chunks.
    
    Args:
        chunks: Lista de chunks com scores
        min_score: Score mínimo
    
    Returns:
        Confidence (0.0-1.0)
    """
    if not chunks:
        return 0.0
    
    # Média dos scores
    scores = [chunk.score for chunk in chunks if chunk.score is not None]
    if not scores:
        return 0.0
    
    avg_score = sum(scores) / len(scores)
    
    # Ajusta por número de chunks (mais chunks = mais confiança)
    chunk_bonus = min(len(chunks) / 5.0, 0.2)  # Até 20% de bônus
    
    # Penaliza se scores são muito baixos
    if avg_score < min_score:
        penalty = (min_score - avg_score) * 0.5
        avg_score = max(0.0, avg_score - penalty)
    
    confidence = min(1.0, avg_score + chunk_bonus)
    return confidence


@router.post("/query", response_model=QueryResponse)
async def query_rag(request: QueryRequest):
    """
    Consulta RAG.
    
    Busca chunks relevantes e gera resposta usando LLM.
    """
    try:
        settings = get_settings()
        
        # Validações
        if not request.query or not request.query.strip():
            raise HTTPException(status_code=400, detail="Query não pode ser vazia")
        
        if not request.tenantId:
            raise HTTPException(status_code=400, detail="tenantId é obrigatório")
        
        # Processa NLP na query
        nlp_result = process_nlp(request.query, expand=True)
        improved_query = improve_query_for_rag(request.query)
        
        logger.debug(f"NLP: intent={nlp_result.intent}, sentiment={nlp_result.sentiment}, entities={len(nlp_result.entities)}")
        logger.debug(f"Query melhorada: '{request.query}' -> '{improved_query}'")
        
        # Gera embedding da query melhorada
        query_embedding = generate_embedding(improved_query)
        
        # Busca chunks similares
        vector_store = get_vector_store(request.tenantId)
        
        # Prepara filtros
        filters = {}
        if request.filters:
            if request.filters.roles:
                filters['roles'] = request.filters.roles
            if request.filters.agentId:
                filters['agentId'] = request.filters.agentId
            # productId e clientId serão filtrados no Node.js
        
        # Opções
        top_k = request.options.topK if request.options else settings.default_top_k
        min_score = request.options.minScore if request.options else settings.default_min_score
        
        # Busca
        chunks = vector_store.search(query_embedding, top_k=top_k, filters=filters)
        
        # Filtra por min_score
        chunks = [chunk for chunk in chunks if chunk.score and chunk.score >= min_score]
        
        if not chunks:
            return QueryResponse(
                success=False,
                response="Não encontrei informações relevantes para sua pergunta. Posso transferir você para um atendente humano?",
                sources=[],
                confidence=0.0,
                metadata=QueryMetadata(
                    chunksSearched=top_k,
                    chunksFound=0
                ),
                error="Nenhum chunk encontrado com score suficiente"
            )
        
        # Calcula confidence
        confidence = calculate_confidence(chunks, min_score)
        
        # Constrói prompt RAG
        prompt = build_rag_prompt(request.query, chunks)
        
        # Gera resposta usando LLM
        max_tokens = request.options.maxTokens if request.options else settings.llm_max_tokens
        response_text = generate_response(prompt, max_tokens=max_tokens, temperature=settings.llm_temperature)
        
        # Prepara sources
        sources = []
        for chunk in chunks:
            sources.append(Source(
                chunkId=chunk.id,
                documentId=chunk.documentId,
                title=f"Chunk {chunk.metadata.chunkIndex + 1}",  # Título será melhorado quando tivermos documento
                score=chunk.score or 0.0,
                excerpt=chunk.content[:200] + "..." if len(chunk.content) > 200 else chunk.content
            ))
        
        return QueryResponse(
            success=True,
            response=response_text,
            sources=sources,
            confidence=confidence,
            metadata=QueryMetadata(
                chunksSearched=top_k,
                chunksFound=len(chunks),
                tokensUsed=None  # Será preenchido se LLM retornar
            )
        )
    
    except HTTPException:
        raise
    except Exception as e:
        return QueryResponse(
            success=False,
            response="",
            sources=[],
            confidence=0.0,
            metadata=QueryMetadata(
                chunksSearched=0,
                chunksFound=0
            ),
            error=str(e)
        )

