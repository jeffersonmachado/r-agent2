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


def _get_openai_client(api_key: str, base_url: Optional[str] = None) -> "OpenAI":
    """
    Retorna cliente OpenAI singleton, recriando se chave OU base_url mudarem.

    `base_url` permite usar endpoints OpenAI-compatible (deepseek, kimi, qwen,
    mistral, groq) com o mesmo SDK, sem fixar a OpenAI global.
    """
    global _openai_client, _openai_client_key
    cache_key = f"{base_url or ''}|{api_key}"
    if _openai_client is None or _openai_client_key != cache_key:
        client_kwargs = {"api_key": api_key, "timeout": _OPENAI_TIMEOUT}
        if base_url:
            client_kwargs["base_url"] = base_url
        _openai_client = OpenAI(**client_kwargs)
        _openai_client_key = cache_key
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
    base_url_override: Optional[str] = None,
    model_override: Optional[str] = None,
) -> str:
    """
    Gera resposta usando LLM.
    
    Args:
        prompt: Prompt completo
        max_tokens: Máximo de tokens
        temperature: Temperatura (0.0-1.0)
        base_url_override: endpoint OpenAI-compatible do provider do tenant
        model_override: modelo do provider do tenant
    
    Returns:
        Resposta do LLM
    """
    settings = get_settings()
    base_url = base_url_override or settings.llm_base_url or None
    model = model_override or settings.llm_model
    
    # O SDK usado é o da OpenAI. Endpoints OpenAI-compatible do tenant só podem
    # ser usados quando o provider declara `base_url`; sem override, mantém o
    # comportamento anterior (provider global do serviço).
    can_use_openai_sdk = OPENAI_AVAILABLE and (
        settings.llm_provider == "openai" or bool(base_url)
    )
    if can_use_openai_sdk:
        api_key = api_key_override or settings.openai_api_key
        if not api_key:
            logger.error("OpenAI API key não configurada. Verifique a variável de ambiente OPENAI_API_KEY ou llm_api_key nas configurações.")
            raise ValueError("OpenAI API key não configurada. Configure OPENAI_API_KEY ou llm_api_key.")
        
        try:
            logger.debug(f"Chamando LLM: model={model}, base_url={base_url or 'default'}, max_tokens={max_tokens}, temperature={temperature}")
            client = _get_openai_client(api_key, base_url)
            
            response = client.chat.completions.create(
                model=model,
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
        error_msg = (
            f"LLM provider '{settings.llm_provider}' não está disponível ou não foi configurado corretamente. "
            "Endpoints OpenAI-compatible exigem base_url (header X-RAG-LLM-Base-URL ou llm.baseUrl)."
        )
        if not OPENAI_AVAILABLE:
            error_msg += " Biblioteca 'openai' não está instalada."
        logger.error(error_msg)
        raise ValueError(error_msg)
