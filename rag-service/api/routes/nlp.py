"""
Endpoint de análise NLP.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, List
from services.nlp_service import process_nlp, NLPResult
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


class NLPRequest(BaseModel):
    """Request de análise NLP."""
    text: str
    expand: bool = True


class NLPResponse(BaseModel):
    """Resposta de análise NLP."""
    original_text: str
    normalized_text: str
    entities: Dict[str, List[str]]
    intent: Optional[str] = None
    sentiment: Optional[str] = None
    keywords: List[str] = []
    expanded_query: str = ""
    confidence: float = 0.0


@router.post("/analyze", response_model=NLPResponse)
async def analyze_text(request: NLPRequest):
    """
    Analisa texto com NLP.
    
    Retorna:
    - Texto normalizado
    - Entidades extraídas
    - Intenção detectada
    - Sentimento
    - Query expandida
    """
    try:
        if not request.text or not request.text.strip():
            raise HTTPException(status_code=400, detail="Texto não pode ser vazio")
        
        result = process_nlp(request.text, expand=request.expand)
        
        return NLPResponse(
            original_text=result.original_text,
            normalized_text=result.normalized_text,
            entities=result.entities,
            intent=result.intent,
            sentiment=result.sentiment,
            keywords=result.entities.get('keywords', []),
            expanded_query=result.expanded_query,
            confidence=result.confidence
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao processar NLP: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao processar NLP: {str(e)}")

