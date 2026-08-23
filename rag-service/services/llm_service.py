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

# Cliente OpenAI reutilizável (lazy singleton). Evita recriar conexão a cada
# request e aplica timeout explícito (o SDK usa 600s por padrão) para que o
# Python desista antes do timeout do cliente Node (30s).
_OPENAI_TIMEOUT = 25.0
_openai_client: Optional["OpenAI"] = None
_openai_client_key: Optional[str] = None


def _get_openai_client(api_key: str) -> "OpenAI":
    """Retorna cliente OpenAI singleton, recriando se a chave mudar."""
    global _openai_client, _openai_client_key
    if _openai_client is None or _openai_client_key != api_key:
        _openai_client = OpenAI(api_key=api_key, timeout=_OPENAI_TIMEOUT)
        _openai_client_key = api_key
    return _openai_client


def reset_openai_client():
    """Invalida o cliente singleton (chamado no reload de configuração)."""
    global _openai_client, _openai_client_key
    _openai_client = None
    _openai_client_key = None


def generate_response(
    prompt: str,
    max_tokens: int = 1000,
    temperature: float = 0.7,
    system_prompt: Optional[str] = None,
    api_key_override: Optional[str] = None,
) -> str:
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
        api_key = api_key_override or settings.openai_api_key
        if not api_key:
            logger.error("OpenAI API key não configurada. Verifique a variável de ambiente OPENAI_API_KEY ou llm_api_key nas configurações.")
            raise ValueError("OpenAI API key não configurada. Configure OPENAI_API_KEY ou llm_api_key.")
        
        try:
            logger.debug(f"Chamando OpenAI: model={settings.llm_model}, max_tokens={max_tokens}, temperature={temperature}")
            client = _get_openai_client(api_key)
            
            response = client.chat.completions.create(
                model=settings.llm_model,
                messages=[
                    {
                        "role": "system",
                        "content": system_prompt or "Você é um assistente especializado em atendimento ao cliente.",
                    },
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
