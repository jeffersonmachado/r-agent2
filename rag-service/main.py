"""
Serviço RAG (Retrieval-Augmented Generation) usando FastAPI.

Responsabilidades:
- Indexação de documentos
- Geração de embeddings
- Busca vetorial
- Consulta RAG com contexto
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import uvicorn
import logging

from api.routes import query, index, health, nlp, learning, maintenance
from config.settings import get_settings

# Configura logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="RAG Service",
    description="Serviço de Retrieval-Augmented Generation",
    version="1.0.0"
)

# CORS para permitir chamadas do Node.js
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Em produção, especificar origens
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Incluir rotas
app.include_router(health.router, prefix="/rag", tags=["health"])
app.include_router(query.router, prefix="/rag", tags=["query"])
app.include_router(index.router, prefix="/rag", tags=["index"])
app.include_router(nlp.router, prefix="/rag", tags=["nlp"])
app.include_router(learning.router, prefix="/rag/learning", tags=["learning"])
app.include_router(maintenance.router, prefix="/rag", tags=["maintenance"])


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

