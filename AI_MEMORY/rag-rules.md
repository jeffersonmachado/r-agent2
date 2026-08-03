# RAG Rules

RAG is tenant-scoped governed knowledge. It includes documents, adaptive learning, chunk/vector state, question generation rules and RAG service integration.

## Canonical sources

- `docs/RAG_POR_TENANT.md`
- `docs/RAG_PARA_DEV.md`
- `docs/CONFIGURACAO_RAG_CENTRALIZADA.md`
- `docs/COMO_TESTAR_RAG.md`
- `docs/APRENDIZADO_ADAPTATIVO_RAG.md`
- `docs/TENANT_CONTEXT_RAG.md`
- `api/modules/rag-documents/routes.js`
- `frontend/src/pages/RAGDocumentsPage.impl.jsx`
- `rag/buildRagContext.js`
- `rag/ragPipelineAdapter.js`

## Runtime notes

Browser validation confirmed `/rag-documents` renders authenticated and loads document totals, but console/network events included aborted RAG/API calls during route transitions. Treat these as evidence to inspect when changing RAG UI/API behavior.

## Arquitetura de eficiência (2026-08-03)

- **Deduplicação no Postgres** (não mais Maps/dicts em memória): structural via `metadata->>'content_hash'`, semantic via hash exato + top-1 vetorial (`embedding <=> ::vector`, limiar 0.97) no HNSW; sobrevive a restart. Índices de expressão: migration `api/db/migrations/20260803000001-add-rag-chunks-dedup-indexes.js`. `registerChunk`/`register_chunk` são no-ops de compatibilidade — o JSONB `metadata` de `rag_chunks` é a fonte da verdade.
- **Circuit breaker** no Node (`fetchRagWithBreaker` em `api/services/rag/ragRuntime.js`): 3 falhas → abre 30s, fail-fast `rag_unavailable`; retry com backoff só em GETs idempotentes. Config: `RAG_CB_*`.
- **Timeout de query dedicado**: 30s default (`RAG_QUERY_TIMEOUT` / `rag.queryTimeoutMs`, por tenant); demais chamadas 5s. Python desiste da OpenAI em 25s (client singleton em `llm_service.py`) — nunca pagar token de resposta abortada.
- **Caches**: tenant context (TTL 60s, `invalidateTenantContextCache` em writes de tenant_context), resposta RAG (TTL 10min, `api/services/rag/ragResponseCache.js`), embeddings de query no Python (LRU 1024), `config.json`/learning data por mtime, contrato RAG memoizado, `ragContextCache` com TTL 1h + cap 500.
- **Gating por intent**: `queryRag` pula `/rag/query` para saudação/confirmação/despedida (config `RAG_SKIP_INTENTS`).
- **Token interno obrigatório em TODAS as chamadas** Node → rag-service (`getRagInternalHeaders()`), inclusive GETs (`/rag/health`, `/rag/documents`, `/rag/embeddings`).
- **Python**: handlers síncronos no threadpool (não `async def` bloqueante — 1 worker); warm-up do modelo no lifespan de `main.py` + pré-download no Dockerfile; índice vetorial **HNSW** (`rag_chunks_embedding_hnsw_idx`, migration `20260803000002`) com `hnsw.ef_search=40` por sessão (`RAG_HNSW_EF_SEARCH`, fallback `ivfflat.probes`); LLM default `gpt-4o-mini`.
- **Permissões no SQL**: `vector_store.search` filtra `permissions->'roles'`/`->'agents'` no SQL (jsonb `?|`/`?`); chunk sem restrição = visível a todos. Sem pós-filtro em Python.
- **Deps do rag-service** (2026-08-03): fastapi 0.141, uvicorn 0.52, pydantic 2.13, sentence-transformers 5.6 (com `transformers==4.57.6` + `huggingface-hub==0.36.2` pinados — transformers 5.x exige torch>=2.4 e quebra com o torch 2.2.2+cpu pinado), openai 2.x. `settings.py` usa `SettingsConfigDict` (pydantic-settings 2.14 ignora `class Config` legado).
- **Cache leve de documentos**: `ragDocumentsService` não carrega `content` no Map de startup; search via ILIKE no DB; content pontual via findByPk/hidratação.
- **Backend ONNX opcional de embeddings** (`RAG_EMBEDDING_BACKEND=onnx`, default `torch`): `get_embedding_model()` em `embedding_service.py` carrega `SentenceTransformer(..., backend='onnx')` com fallback explícito para torch + warning (nunca derruba o serviço). Deps: `optimum==1.27.0` (sem extra — o extra exige transformers<4.54) + `onnxruntime==1.20.1` (>=1.21 quebra com torch 2.2.2). Paridade medida torch×onnx: cosine 1.000000. Se habilitar ONNX em produção, pré-baixar a variante ONNX no `rag-service/Dockerfile` (hoje só pré-baixa pesos torch).

