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

- **Deduplicação no Postgres** (não mais Maps/dicts em memória): structural via `metadata->>'content_hash'`, semantic via hash exato + top-1 vetorial (`embedding <=> ::vector`, limiar 0.97) no IVFFlat; sobrevive a restart. Índices de expressão: migration `api/db/migrations/20260803000001-add-rag-chunks-dedup-indexes.js`. `registerChunk`/`register_chunk` são no-ops de compatibilidade — o JSONB `metadata` de `rag_chunks` é a fonte da verdade.
- **Circuit breaker** no Node (`fetchRagWithBreaker` em `api/services/rag/ragRuntime.js`): 3 falhas → abre 30s, fail-fast `rag_unavailable`; retry com backoff só em GETs idempotentes. Config: `RAG_CB_*`.
- **Timeout de query dedicado**: 30s default (`RAG_QUERY_TIMEOUT` / `rag.queryTimeoutMs`, por tenant); demais chamadas 5s. Python desiste da OpenAI em 25s (client singleton em `llm_service.py`) — nunca pagar token de resposta abortada.
- **Caches**: tenant context (TTL 60s, `invalidateTenantContextCache` em writes de tenant_context), resposta RAG (TTL 10min, `api/services/rag/ragResponseCache.js`), embeddings de query no Python (LRU 1024), `config.json`/learning data por mtime, contrato RAG memoizado, `ragContextCache` com TTL 1h + cap 500.
- **Gating por intent**: `queryRag` pula `/rag/query` para saudação/confirmação/despedida (config `RAG_SKIP_INTENTS`).
- **Token interno obrigatório em TODAS as chamadas** Node → rag-service (`getRagInternalHeaders()`), inclusive GETs (`/rag/health`, `/rag/documents`, `/rag/embeddings`).
- **Python**: handlers síncronos no threadpool (não `async def` bloqueante — 1 worker); warm-up do modelo no lifespan de `main.py` + pré-download no Dockerfile; `ivfflat.probes=10` por sessão (`RAG_IVFFLAT_PROBES`); LLM default `gpt-4o-mini`.
- **Cache leve de documentos**: `ragDocumentsService` não carrega `content` no Map de startup; search via ILIKE no DB; content pontual via findByPk/hidratação.

