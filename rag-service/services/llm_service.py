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
            logger.error("OpenAI API key não configurada. Verifique a variável de ambiente OPENAI_API_KEY ou llm_api_key nas configurações.")
            raise ValueError("OpenAI API key não configurada. Configure OPENAI_API_KEY ou llm_api_key.")
        
        try:
            logger.debug(f"Chamando OpenAI: model={settings.llm_model}, max_tokens={max_tokens}, temperature={temperature}")
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
            
            response_text = response.choices[0].message.content
            logger.debug(f"Resposta OpenAI recebida: {len(response_text)} caracteres")
            
            # Log de uso de tokens se disponível
            if hasattr(response, 'usage'):
                logger.debug(f"Tokens usados: {response.usage.total_tokens} (prompt: {response.usage.prompt_tokens}, completion: {response.usage.completion_tokens})")
            
            return response_text
            
        except Exception as e:
            logger.error(f"Erro ao chamar OpenAI: {e}", exc_info=True)
            # Re-lança a exceção para que o chamador possa tratar
            raise
    else:
        error_msg = f"LLM provider '{settings.llm_provider}' não está disponível ou não foi configurado corretamente."
        if not OPENAI_AVAILABLE:
            error_msg += " Biblioteca 'openai' não está instalada."
        logger.error(error_msg)
        raise ValueError(error_msg)

