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

