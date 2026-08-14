# Stack Versions

Versões **declaradas** da stack RAP/r-agent2. É a referência canônica do
que a página "Versões da Stack" (`/dev/stack-versions`) espelha no frontend.

## Como manter atualizada

1. Quando a stack mudar (Node, npm, versão do pacote, pins do RAG, modelo de
   embeddings, imagens do `docker-compose.prod.yml`), rode:
   `npm run stack:versions:sync`
2. O script regenera o bloco abaixo e `reports/stack-versions-report.json`.
3. Valide antes de concluir: `npm run validate:stack-versions`.
4. Commit o doc (`AI_MEMORY/stack-versions.md`) junto com a mudança.

> As versões de **runtime** (processo Node, servidor PostgreSQL, Redis, RAG
> em execução) são exibidas em tempo real pela página a partir dos endpoints
> `/version` e `/system/status` — não precisam ser atualizadas aqui.

## Versões declaradas (auto)

<!-- STACK_VERSIONS_AUTO_START -->

> Gerado automaticamente por `npm run stack:versions:sync`. Não edite este bloco:
> atualize a fonte declarada (package.json, requirements.txt, settings.py,
> docker-compose.prod.yml) e rode o sync.

| Componente | Versão declarada | Fonte |
| --- | --- | --- |
| API (RAP) | `1.0.0` | package.json |
| Runtime Node.js | `>=20.19.0 || >=22.12.0` | package.json → engines |
| npm | `>=10.0.0` | package.json → engines |
| RAG — FastAPI | `0.141.1` | rag-service/requirements.txt |
| RAG — Uvicorn | `0.52.1` | rag-service/requirements.txt |
| RAG — sentence-transformers | `5.6.1` | rag-service/requirements.txt |
| RAG — transformers | `4.57.6` | rag-service/requirements.txt |
| RAG — torch (CPU) | `2.9.1+cpu` | rag-service/requirements.txt |
| RAG — numpy | `2.5.1` | rag-service/requirements.txt |
| RAG — onnxruntime | `1.28.0` | rag-service/requirements.txt |
| RAG — modelo de embeddings | `sentence-transformers/all-MiniLM-L6-v2` | rag-service/config/settings.py |
| PostgreSQL (imagem) | `pgvector/pgvector:pg16` | docker-compose.prod.yml |
| Redis (imagem) | `r-agent2-redis:latest` | docker-compose.prod.yml |
| Imagem API | `r-agent2-api:latest` | docker-compose.prod.yml |
| Imagem Frontend | `r-agent2-frontend:latest` | docker-compose.prod.yml |
| Imagem RAG Service | `r-agent2-rag-service:latest` | docker-compose.prod.yml |

Fingerprint: `f95c4d53563be6737e44f5f5aa14aa674af6d07c703893d9cf6b288c15bf3a25`

<!-- STACK_VERSIONS_AUTO_END -->
