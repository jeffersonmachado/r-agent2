"""
Autenticação serviço-a-serviço do RAG (backend Node -> rag-service).

RAG_INTERNAL_TOKEN é obrigatório e toda rota /rag/* exige o header
X-RAG-Internal-Token correspondente. A ausência da configuração bloqueia o
serviço; clientes finais nunca falam diretamente com ele.
"""

import os
import logging
import hmac

logger = logging.getLogger(__name__)

INTERNAL_TOKEN_HEADER = "x-rag-internal-token"


def get_internal_token() -> str:
    token = (os.getenv("RAG_INTERNAL_TOKEN") or "").strip()
    # Placeholder curto equivale a configuração ausente.
    return token if len(token.encode("utf-8")) >= 32 else ""


def has_valid_internal_token(headers) -> bool:
    """True quando o token está configurado e o header confere."""
    token = get_internal_token()
    if not token:
        return False
    provided = headers.get(INTERNAL_TOKEN_HEADER) or ""
    return hmac.compare_digest(str(provided), str(token))
