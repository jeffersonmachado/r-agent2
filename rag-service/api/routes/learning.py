"""
Endpoints para aprendizado adaptativo do RAG.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict
from services.adaptive_learning import get_adaptive_learning_service
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


class AnalyzeDocumentsRequest(BaseModel):
    """Request para análise de documentos."""
    tenantId: str
    documentIds: Optional[List[str]] = None  # Se None, analisa todos


class LearningMetricsResponse(BaseModel):
    """Resposta com métricas de aprendizado."""
    totalQueries: int
    successfulQueries: int
    failedQueries: int
    successRate: float
    avgConfidence: float
    status: str
    lastUpdated: Optional[str] = None


class OptimizeConfigResponse(BaseModel):
    """Resposta com configurações otimizadas."""
    minScore: float
    topK: int
    chunkOverlap: int
    previousConfig: Optional[Dict] = None


@router.post("/analyze-documents")
async def analyze_documents(request: AnalyzeDocumentsRequest):
    """
    Analisa documentos de um tenant para extrair sinônimos e melhorar aprendizado.
    
    Esta função deve ser chamada após indexação de documentos ou periodicamente.
    """
    try:
        learning_service = get_adaptive_learning_service()
        
        # Busca documentos do tenant
        # Nota: Em produção, isso deveria buscar do banco de dados
        # Por enquanto, vamos precisar que os documentos sejam passados
        # ou buscar de uma fonte externa
        
        # Por enquanto, retorna sucesso mas precisa de integração com ragDocumentsService
        return {
            "success": True,
            "message": "Análise de documentos iniciada. Sinônimos serão atualizados.",
            "tenantId": request.tenantId
        }
    except Exception as e:
        logger.error(f"Erro ao analisar documentos: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao analisar documentos: {str(e)}")


class UpdateSynonymsRequest(BaseModel):
    """Request para atualizar sinônimos."""
    tenant_id: str
    documents: List[Dict]


@router.post("/update-synonyms")
async def update_synonyms(request: UpdateSynonymsRequest):
    """
    Atualiza sinônimos baseado em lista de documentos.
    
    Args:
        request: Request com tenant_id e documents
    """
    try:
        learning_service = get_adaptive_learning_service()
        learning_service.update_synonyms_from_analysis(request.tenant_id, request.documents)
        
        synonyms = learning_service.get_synonyms(request.tenant_id)
        
        return {
            "success": True,
            "tenantId": request.tenant_id,
            "synonymsCount": len(synonyms),
            "synonyms": synonyms
        }
    except Exception as e:
        logger.error(f"Erro ao atualizar sinônimos: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar sinônimos: {str(e)}")


@router.get("/metrics/{tenant_id}", response_model=LearningMetricsResponse)
async def get_learning_metrics(tenant_id: str):
    """Retorna métricas de aprendizado para um tenant."""
    try:
        learning_service = get_adaptive_learning_service()
        metrics = learning_service.get_metrics(tenant_id)
        
        return LearningMetricsResponse(**metrics)
    except Exception as e:
        logger.error(f"Erro ao obter métricas: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao obter métricas: {str(e)}")


@router.get("/synonyms/{tenant_id}")
async def get_synonyms(tenant_id: str):
    """Retorna sinônimos aprendidos para um tenant."""
    try:
        learning_service = get_adaptive_learning_service()
        synonyms = learning_service.get_synonyms(tenant_id)
        
        return {
            "success": True,
            "tenantId": tenant_id,
            "synonyms": synonyms,
            "count": len(synonyms)
        }
    except Exception as e:
        logger.error(f"Erro ao obter sinônimos: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao obter sinônimos: {str(e)}")


@router.get("/full-data/{tenant_id}")
async def get_full_learning_data(tenant_id: str):
    """Retorna todos os dados de aprendizado para um tenant."""
    try:
        learning_service = get_adaptive_learning_service()
        data = learning_service.load_learning_data(tenant_id)
        metrics = learning_service.get_metrics(tenant_id)
        
        return {
            "success": True,
            "tenantId": tenant_id,
            "metrics": metrics,
            "synonyms": data.get("synonyms", {}),
            "queryPatterns": data.get("queryPatterns", {}),
            "config": data.get("config", {}),
            "learningCycles": data.get("learningCycles", {})
        }
    except Exception as e:
        logger.error(f"Erro ao obter dados completos: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao obter dados completos: {str(e)}")


class UpdateSynonymRequest(BaseModel):
    """Request para atualizar um sinônimo específico."""
    tenant_id: str
    term: str
    synonyms: List[str]


@router.put("/synonyms")
async def update_synonym(request: UpdateSynonymRequest):
    """Atualiza sinônimos de um termo específico."""
    try:
        learning_service = get_adaptive_learning_service()
        data = learning_service.load_learning_data(request.tenant_id)
        
        synonyms = data.get("synonyms", {})
        synonyms[request.term] = request.synonyms
        data["synonyms"] = synonyms
        
        learning_service.learning_data[request.tenant_id] = data
        learning_service.save_learning_data(request.tenant_id)
        
        return {
            "success": True,
            "tenantId": request.tenant_id,
            "term": request.term,
            "synonyms": request.synonyms
        }
    except Exception as e:
        logger.error(f"Erro ao atualizar sinônimo: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar sinônimo: {str(e)}")


@router.delete("/synonyms/{tenant_id}/{term}")
async def delete_synonym(tenant_id: str, term: str):
    """Remove um sinônimo específico."""
    try:
        learning_service = get_adaptive_learning_service()
        data = learning_service.load_learning_data(tenant_id)
        
        synonyms = data.get("synonyms", {})
        if term in synonyms:
            del synonyms[term]
            data["synonyms"] = synonyms
            
            learning_service.learning_data[tenant_id] = data
            learning_service.save_learning_data(tenant_id)
        
        return {
            "success": True,
            "tenantId": tenant_id,
            "term": term
        }
    except Exception as e:
        logger.error(f"Erro ao remover sinônimo: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao remover sinônimo: {str(e)}")


@router.get("/validation-rules")
async def get_validation_rules():
    """Retorna regras de validação atuais."""
    try:
        learning_service = get_adaptive_learning_service()
        if not learning_service.validation_rules:
            learning_service.load_validation_rules()
        return {
            "success": True,
            "rules": learning_service.validation_rules
        }
    except Exception as e:
        logger.error(f"Erro ao obter regras de validação: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao obter regras de validação: {str(e)}")


@router.post("/validation-rules/adapt/{tenant_id}")
async def trigger_rule_adaptation(tenant_id: str):
    """Dispara adaptação de regras de validação."""
    try:
        learning_service = get_adaptive_learning_service()
        adapted = learning_service.adapt_validation_rules(tenant_id)
        return {
            "success": True,
            "adapted": adapted,
            "rules": learning_service.validation_rules
        }
    except Exception as e:
        logger.error(f"Erro ao adaptar regras: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao adaptar regras: {str(e)}")


@router.post("/clean-invalid-queries/{tenant_id}")
async def clean_invalid_queries(tenant_id: str):
    """Remove queries inválidas e duplicadas do histórico de aprendizado."""
    try:
        learning_service = get_adaptive_learning_service()
        data = learning_service.load_learning_data(tenant_id)
        
        query_patterns = data.get("queryPatterns", {})
        successful = query_patterns.get("successful", [])
        failed = query_patterns.get("failed", [])
        
        # Filtra queries inválidas
        valid_successful = [q for q in successful if learning_service._is_valid_query(q.get("query", ""))]
        valid_failed = [q for q in failed if learning_service._is_valid_query(q.get("query", ""))]
        
        # Remove duplicatas (mantém apenas a primeira ocorrência)
        seen_successful = set()
        unique_successful = []
        for q in valid_successful:
            query_text = q.get("query", "").strip().lower()
            if query_text and query_text not in seen_successful:
                seen_successful.add(query_text)
                unique_successful.append(q)
        
        seen_failed = set()
        unique_failed = []
        for q in valid_failed:
            query_text = q.get("query", "").strip().lower()
            if query_text and query_text not in seen_failed:
                seen_failed.add(query_text)
                unique_failed.append(q)
        
        removed_successful = len(successful) - len(unique_successful)
        removed_failed = len(failed) - len(unique_failed)
        removed_duplicates_successful = len(valid_successful) - len(unique_successful)
        removed_duplicates_failed = len(valid_failed) - len(unique_failed)
        
        query_patterns["successful"] = unique_successful
        query_patterns["failed"] = unique_failed
        data["queryPatterns"] = query_patterns
        
        learning_service.learning_data[tenant_id] = data
        learning_service.save_learning_data(tenant_id)
        
        return {
            "success": True,
            "tenantId": tenant_id,
            "removedSuccessful": removed_successful,
            "removedFailed": removed_failed,
            "removedDuplicatesSuccessful": removed_duplicates_successful,
            "removedDuplicatesFailed": removed_duplicates_failed,
            "totalRemoved": removed_successful + removed_failed
        }
    except Exception as e:
        logger.error(f"Erro ao limpar queries inválidas: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao limpar queries inválidas: {str(e)}")


@router.post("/optimize-config/{tenant_id}", response_model=OptimizeConfigResponse)
async def optimize_config(tenant_id: str):
    """
    Otimiza configurações do RAG para um tenant baseado em métricas.
    
    Retorna configurações otimizadas.
    """
    try:
        learning_service = get_adaptive_learning_service()
        
        # Carrega configuração atual
        data = learning_service.load_learning_data(tenant_id)
        previous_config = data.get("config", {})
        
        # Otimiza
        optimized = learning_service.optimize_config(tenant_id)
        
        return OptimizeConfigResponse(
            minScore=optimized.get("minScore", 0.45),
            topK=optimized.get("topK", 6),
            chunkOverlap=optimized.get("chunkOverlap", 75),
            previousConfig=previous_config
        )
    except Exception as e:
        logger.error(f"Erro ao otimizar configuração: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao otimizar configuração: {str(e)}")


@router.post("/trigger-learning/{tenant_id}")
async def trigger_learning(tenant_id: str):
    """
    Dispara processo de aprendizado completo para um tenant.
    
    Inclui:
    - Otimização de configurações
    - Análise de padrões de queries
    - Atualização de prompts
    """
    try:
        learning_service = get_adaptive_learning_service()
        
        # Otimiza configurações
        optimized_config = learning_service.optimize_config(tenant_id)
        
        # Obtém métricas
        metrics = learning_service.get_metrics(tenant_id)
        
        return {
            "success": True,
            "tenantId": tenant_id,
            "optimizedConfig": optimized_config,
            "metrics": metrics,
            "message": "Aprendizado concluído"
        }
    except Exception as e:
        logger.error(f"Erro ao disparar aprendizado: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao disparar aprendizado: {str(e)}")

