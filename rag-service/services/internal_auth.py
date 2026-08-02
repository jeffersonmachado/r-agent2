"""
Autenticação serviço-a-serviço do RAG (backend Node -> rag-service).

Quando RAG_INTERNAL_TOKEN está configurado, toda rota /rag/* exige o header
X-RAG-Internal-Token correspondente. Clientes finais nunca falam diretamente
com este serviço; o backend Node é o único chamador autorizado.
"""

import os
import logging

logger = logging.getLogger(__name__)

INTERNAL_TOKEN_HEADER = "x-rag-internal-token"


def get_internal_token() -> str:
    return os.getenv("RAG_INTERNAL_TOKEN") or ""


def has_valid_internal_token(headers) -> bool:
    """True quando o token está configurado e o header confere."""
    token = get_internal_token()
    if not token:
        return False
    return headers.get(INTERNAL_TOKEN_HEADER) == token
