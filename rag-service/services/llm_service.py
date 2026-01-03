"""
Serviço de chamada ao LLM.
"""

from typing import Optional
import os
import logging
from config.settings import get_settings

logger = logging.getLogger(__name__)

# Tenta importar OpenAI
try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False


def generate_response(prompt: str, max_tokens: int = 1000, temperature: float = 0.7) -> str:
    """
    Gera resposta usando LLM.
    
    Args:
        prompt: Prompt completo
        max_tokens: Máximo de tokens
        temperature: Temperatura (0.0-1.0)
    
    Returns:
        Resposta do LLM
    """
    settings = get_settings()
    
    if settings.llm_provider == "openai" and OPENAI_AVAILABLE:
        api_key = settings.openai_api_key
        if not api_key:
            raise ValueError("OpenAI API key não configurada")
        
        client = OpenAI(api_key=api_key)
        
        response = client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": "Você é um assistente especializado em atendimento ao cliente."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=max_tokens,
            temperature=temperature
        )
        
        return response.choices[0].message.content
    else:
        # Fallback: retorna mensagem indicando que LLM não está configurado
        return "[LLM não configurado. Configure OPENAI_API_KEY ou ajuste llm_provider nas configurações.]"

