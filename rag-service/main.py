"""
Serviço RAG (Retrieval-Augmented Generation) usando FastAPI.

Responsabilidades:
- Indexação de documentos
- Geração de embeddings
- Busca vetorial
- Consulta RAG com contexto
"""

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager
import uvicorn
import logging

from api.routes import query, index, health, nlp, learning, maintenance, embeddings
from config.settings import get_settings
from services.internal_auth import get_internal_token, has_valid_internal_token

# Configura logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Warm-up de startup: carrega o modelo de embeddings (singleton) e aquece
    o backend efetivo (torch ou onnx, via get_embedding_model) com um encode
    antes de aceitar tráfego. Sem warm-up, o primeiro request pagaria
    download/load do modelo (~90MB) dentro do handler.
    Falha explícita: se o modelo não carrega, o startup falha (healthcheck
    do Docker barra o deploy) — nunca fallback silencioso.
    """
    from starlette.concurrency import run_in_threadpool
    from services.embedding_service import get_embedding_model, generate_embedding

    logger.info('[STARTUP] Carregando modelo de embeddings (warm-up)...')
    await run_in_threadpool(get_embedding_model)
    await run_in_threadpool(generate_embedding, 'warm-up')
    logger.info('[STARTUP] Modelo de embeddings pronto')
    yield


app = FastAPI(
    title="RAG Service",
    description="Serviço de Retrieval-Augmented Generation",
    version="1.0.0",
    lifespan=lifespan
)

# CORS para permitir chamadas do Node.js
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Em produção, especificar origens
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if not get_internal_token():
    logger.error(
        "[SECURITY] RAG_INTERNAL_TOKEN não configurado: todas as chamadas /rag "
        "permanecerão bloqueadas até a configuração ser corrigida."
    )


@app.middleware("http")
async def require_internal_token(request: Request, call_next):
    """
    Autenticação serviço-a-serviço obrigatória: toda rota /rag/* exige que
    RAG_INTERNAL_TOKEN esteja configurado e que o header correspondente confira.
    O backend Node é o único chamador autorizado — clientes finais nunca
    falam diretamente com este serviço.
    """
    if request.url.path.startswith("/rag"):
        configured_token = get_internal_token()
        if not configured_token:
            logger.error(
                "[SECURITY] RAG bloqueado: RAG_INTERNAL_TOKEN ausente",
                extra={"path": request.url.path},
            )
            return JSONResponse(
                status_code=503,
                content={"error": "service_misconfigured", "message": "Autenticação interna do RAG não configurada"},
            )
        if not has_valid_internal_token(request.headers):
            logger.warning(
                "[SECURITY] Chamada rejeitada sem token interno válido",
                extra={"path": request.url.path, "client": request.client.host if request.client else None},
            )
            return JSONResponse(status_code=401, content={"error": "unauthorized", "message": "Token interno ausente ou inválido"})
    return await call_next(request)

# Incluir rotas
# Compatibilidade/ops: expõe health também em /health (sem prefixo),
# além de manter /rag/health para clientes existentes.
app.include_router(health.router, tags=["health"])
app.include_router(health.router, prefix="/rag", tags=["health"])
app.include_router(query.router, prefix="/rag", tags=["query"])
app.include_router(index.router, prefix="/rag", tags=["index"])
app.include_router(nlp.router, prefix="/rag", tags=["nlp"])
app.include_router(learning.router, prefix="/rag/learning", tags=["learning"])
app.include_router(maintenance.router, prefix="/rag", tags=["maintenance"])
app.include_router(embeddings.router, prefix="/rag", tags=["embeddings"])


@app.get("/")
async def root():
    """Endpoint raiz."""
    return {
        "service": "RAG Service",
        "version": "1.0.0",
        "status": "running"
    }


if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
