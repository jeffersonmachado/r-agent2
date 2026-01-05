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
import re

logger = logging.getLogger(__name__)

router = APIRouter()


def is_uuid_or_meaningless_query(query: str) -> bool:
    """
    Verifica se a query é um UUID ou uma pergunta sem sentido semântico.
    
    Args:
        query: Query do usuário
    
    Returns:
        True se for UUID ou sem sentido
    """
    if not query or not query.strip():
        return True
    
    query_clean = query.strip()
    
    # Padrão UUID (com ou sem hífens)
    uuid_pattern = r'^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$'
    if re.match(uuid_pattern, query_clean, re.IGNORECASE):
        logger.warning(f"Query rejeitada: é um UUID - {query_clean[:50]}")
        return True
    
    # Verifica se é apenas um UUID com prefixo "O que é" ou "Como funciona"
    # Remove pontuação final (?, !, .) para melhor matching
    query_for_uuid_check = re.sub(r'[?!.]$', '', query_clean)
    uuid_with_prefix = re.match(r'^(o que é|como funciona|o que|quem é|onde está)\s+([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})', query_for_uuid_check, re.IGNORECASE)
    if uuid_with_prefix:
        logger.warning(f"Query rejeitada: pergunta sobre UUID - {query_clean[:50]}")
        return True
    
    # Verifica se tem menos de 3 caracteres alfanuméricos (muito curta)
    alphanumeric_chars = re.findall(r'[a-z0-9]', query_clean.lower())
    if len(alphanumeric_chars) < 3:
        logger.warning(f"Query rejeitada: muito curta - {query_clean[:50]}")
        return True
    
    # Verifica se é apenas números ou caracteres especiais
    if re.match(r'^[^a-záàâãéêíóôõúç]+$', query_clean, re.IGNORECASE):
        logger.warning(f"Query rejeitada: sem letras - {query_clean[:50]}")
        return True
    
    return False


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
    
    prompt = f"""Você é um assistente especializado em atendimento ao cliente, prestativo e informativo.

Contexto relevante extraído da base de conhecimento:
{context}

Pergunta do usuário: {query}

Instruções:
- Analise cuidadosamente o contexto fornecido e responda baseado nele
- Se encontrar informação relevante no contexto, forneça uma resposta útil e completa
- Use as informações das fontes para construir uma resposta coerente
- Se o contexto contém informação parcial mas útil, forneça o que puder e mencione que pode haver mais detalhes disponíveis
- Apenas se o contexto realmente não contiver NENHUMA informação relevante sobre a pergunta, então diga: "Não tenho informação suficiente sobre isso. Posso transferir você para um atendente humano?"
- Seja claro, objetivo, amigável e prestativo
- Cite as fontes quando relevante (ex: "De acordo com a Fonte 1...")
- Evite respostas genéricas quando houver informação útil no contexto
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
    
    # Penaliza menos se scores estão próximos do min_score
    # Se avg_score >= min_score, não penaliza
    if avg_score < min_score:
        # Penalização mais suave para scores próximos do mínimo
        distance = min_score - avg_score
        if distance < 0.1:  # Muito próximo do mínimo
            penalty = distance * 0.3  # Penalização menor
        else:
            penalty = distance * 0.5  # Penalização normal
        avg_score = max(0.0, avg_score - penalty)
    
    confidence = min(1.0, avg_score + chunk_bonus)
    
    # Bônus adicional se o melhor score é alto
    if scores:
        max_score = max(scores)
        if max_score > 0.7:
            confidence = min(1.0, confidence + 0.1)  # Bônus de 10% se há chunk muito relevante
    
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
        
        # Valida se a query não é um UUID ou sem sentido
        if is_uuid_or_meaningless_query(request.query):
            return QueryResponse(
                success=False,
                response="Desculpe, não consigo responder perguntas sobre códigos de identificação ou perguntas muito curtas. Por favor, reformule sua pergunta de forma mais descritiva.",
                sources=[],
                confidence=0.0,
                metadata=QueryMetadata(
                    chunksSearched=0,
                    chunksFound=0
                ),
                error="Query inválida: UUID ou sem sentido semântico"
            )
        
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
        logger.debug(f"Buscando chunks: top_k={top_k}, min_score={min_score}, filters={filters}")
        chunks = vector_store.search(query_embedding, top_k=top_k, filters=filters)
        logger.debug(f"Chunks encontrados antes do filtro: {len(chunks)}")
        
        # Filtra por min_score
        chunks_before_filter = len(chunks)
        chunks = [chunk for chunk in chunks if chunk.score and chunk.score >= min_score]
        chunks_filtered = chunks_before_filter - len(chunks)
        
        if chunks_filtered > 0:
            logger.debug(f"Chunks filtrados por min_score: {chunks_filtered} removidos")
        
        # FALLBACK INTELIGENTE: Se não encontrou chunks, tenta com minScore reduzido
        if not chunks and min_score > 0.3:
            fallback_min_score = max(0.3, min_score * 0.8)  # Reduz 20% mas não abaixo de 0.3
            logger.info(f"Tentando fallback com minScore reduzido: {min_score} -> {fallback_min_score}")
            
            # Busca novamente com score reduzido
            fallback_chunks = vector_store.search(query_embedding, top_k=top_k, filters=filters)
            fallback_chunks = [chunk for chunk in fallback_chunks 
                             if chunk.score and chunk.score >= fallback_min_score]
            
            if fallback_chunks:
                logger.info(f"Fallback encontrou {len(fallback_chunks)} chunks com minScore {fallback_min_score}")
                chunks = fallback_chunks
                # Ajusta min_score para o cálculo de confidence
                min_score = fallback_min_score
        
        # Log de documentos únicos encontrados
        unique_documents = set(chunk.documentId for chunk in chunks)
        logger.info(f"Query: '{request.query[:100]}' - Encontrados {len(chunks)} chunks de {len(unique_documents)} documento(s) único(s)")
        
        # Prepara sources (mesmo se não houver chunks suficientes, pode retornar os encontrados)
        sources = []
        for chunk in chunks:
            sources.append(Source(
                chunkId=chunk.id,
                documentId=chunk.documentId,
                title=f"Chunk {chunk.metadata.chunkIndex + 1}",  # Título será melhorado quando tivermos documento
                score=chunk.score or 0.0,
                excerpt=chunk.content[:200] + "..." if len(chunk.content) > 200 else chunk.content
            ))
        
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
        try:
            logger.debug(f"Gerando resposta com LLM: chunks={len(chunks)}, confidence={confidence:.2f}, max_tokens={max_tokens}")
            response_text = generate_response(prompt, max_tokens=max_tokens, temperature=settings.llm_temperature)
            
            # Valida se a resposta não é muito curta ou genérica
            if not response_text or len(response_text.strip()) < 20:
                logger.warning("Resposta do LLM muito curta, pode ser erro")
                response_text = "Não tenho informação suficiente sobre isso. Posso transferir você para um atendente humano?"
            else:
                logger.debug(f"Resposta gerada com sucesso: {len(response_text)} caracteres")
                
        except Exception as e:
            logger.error(f"Erro ao gerar resposta com LLM: {e}", exc_info=True)
            # Tenta fornecer informação dos chunks mesmo sem LLM
            if chunks and len(chunks) > 0:
                # Fallback inteligente: usa o primeiro chunk como resposta base
                first_chunk = chunks[0]
                response_text = f"Com base nas informações disponíveis: {first_chunk.content[:300]}..."
                if len(chunks) > 1:
                    response_text += f"\n\nHá {len(chunks)} fontes de informação relacionadas disponíveis."
            else:
                response_text = "Não tenho informação suficiente sobre isso. Posso transferir você para um atendente humano?"
        
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
        logger.error(f"Erro inesperado na query RAG: {e}", exc_info=True)
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

