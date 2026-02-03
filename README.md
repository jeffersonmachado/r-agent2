## Visão geral (RAG + scraping + arquivos)

Este repositório mantém um pipeline que **indexa fontes do tenant** (site + arquivos) no RAG e usa essas fontes para **sugerir descrição**.

## Vector Store (PostgreSQL + pgvector) — fonte única

O sistema RAG usa **PostgreSQL com a extensão `pgvector`** como **única fonte de verdade** para embeddings e chunks (`rag_chunks`). Isso elimina inconsistências do tipo “BD diz indexed, mas vector store está vazio”.

### Habilitar pgvector no Postgres

As migrations já incluem:

- `CREATE EXTENSION IF NOT EXISTS vector;`
- criação da tabela `rag_chunks` com coluna `embedding vector(N)` (onde \(N\) vem de `EMBEDDING_DIM`)

Para aplicar:

```bash
npm run db:migrate
```

### Se você usa Postgres local (fora do Docker)

Você precisa instalar o pacote do pgvector no seu Postgres. Exemplo (Ubuntu/Debian, Postgres 16):

```bash
sudo apt-get update
sudo apt-get install -y postgresql-16-pgvector
```

Depois disso, rode as migrations novamente.

### Variáveis de ambiente

- **`RAG_VECTOR_STORE_TYPE`**: `postgres` (padrão recomendado)
- **`EMBEDDING_DIM`**: dimensão do embedding (padrão do projeto: `384`)
  - O `rag-service` (Python) usa `sentence-transformers/all-MiniLM-L6-v2` por padrão (384 dims).

### Reindex de tenant (zera e recria tudo)

- Endpoint: `POST /rag/reindex-all?tenantId=...`

## Scraping (fetch + fallback Playwright)

- **Rápido (padrão)**: tenta `fetch`/HTML estático.
- **Fallback (SPA/JS)**: quando o texto extraído for curto, tenta Playwright (Chromium headless).

### Habilitar/Desabilitar via env

- **USE_PLAYWRIGHT**: `true|false` (padrão: `false`)

### Instalação do Playwright (Chromium)

No host/CI (Linux):

```bash
npx playwright install --with-deps chromium
```

## Upload de arquivos (PDF + imagens com OCR)

Uploads via `POST /rag/documents/upload` (multipart) fazem extração **server-side**:

- **PDF**: `pdf-parse` (timeout 15s por arquivo)
- **Imagens (png/jpg/webp)**: OCR com `tesseract.js` (timeout 15s por arquivo), com **pré-processamento best-effort** via `sharp` para melhorar contraste/rotação/legibilidade

### Habilitar/Desabilitar via env

- **USE_OCR**: `true|false` (padrão: `false`)

### Ajustes finos do OCR (opcional)

- **OCR_PREPROCESS**: `true|false` (padrão: `true`) — habilita pré-processamento da imagem antes do OCR
- **OCR_LANG**: ex. `por+eng` (padrão: `por+eng`) — idiomas carregados pelo Tesseract
- **OCR_PSM**: ex. `6` (padrão: `6`) — Page Segmentation Mode do Tesseract (ajuda bastante dependendo do layout)

> Observação: OCR pode depender de recursos de runtime (WASM / dados de linguagem). Se falhar, o pipeline continua e indexa metadados mínimos, retornando warnings.

## Contratos de resposta (envolvidos no pipeline)

As rotas principais retornam (sem quebrar compatibilidade) campos adicionais:

- **Sucesso**: `ok: true`, `data`, `warnings?: []` (e também os campos “legados” no topo)
- **Erro**: `success: false`, `ok: false`, `error: { code, message, details, traceId, ... }`

### Códigos comuns (error/warning)

- `SCRAPE_FAILED`, `PLAYWRIGHT_FAILED`
- `PDF_PARSE_FAILED`, `OCR_FAILED`
- `RAG_INDEX_FAILED`, `FILE_UPLOAD_FAILED`, `FILE_TOO_LARGE`
- `DESCRIPTION_FAILED`

## Geração de perguntas (FAQ) baseada em contexto real (RAG/PDF/OCR/Web)

O pipeline de perguntas foi endurecido para **usar o conteúdo indexado** (chunks do RAG/Redis) em vez de depender apenas de descrição resumida:

- **Pipeline**: `RAG/Redis chunks → limpeza semântica → tópicos/entidades → businessType → perguntas por categoria → filtros/dedupe`

### O que foi reaproveitado

- **Resolução de contexto/chunks**: `api/services/contextSourceResolver.js` (inline → Redis → RAG), extraído do `faqGeneratorService`.
- **Limpeza e exclusões inferidas**: `api/services/exclusions.service.js` (`sanitizeContext`, `getFinalExclusions`, `filterQuestions`).
- **Entidades (best-effort)**: `api/services/business-entities.service.js` (quando `executionId` existe).
- **Deduplicação semântica por embeddings**: `api/services/faqGeneratorService.js` e `api/services/faq.service.js`.

### O que foi criado

- **Extração de contexto semântico**: `api/services/semanticContextService.js` (`extractSemanticContext`, `detectBusinessType`), incluindo `excludedTerms` (filenames/hashes/ocrNoise/uiTokens/technicalTokens).
- **Geração de perguntas por contexto**: `api/utils/ragQuestionGenerator.js` (`generateQuestionsFromContext`).
- **Testes**: `tests/unit/semanticContextService.test.js` e `tests/unit/generateQuestionsFromContext.test.js`.

### Onde foi integrado

- **`POST /system/generate-faq`**: `api/services/faqGeneratorService.js` (prioriza `extractSemanticContext` + `generateQuestionsFromContext`; mantém clusterização/coverage existentes).
- **`POST /system/suggest-description` → fluxo inicial**: `api/services/faq.service.js` (substitui geração via IA por geração baseada em contexto; respeita `dryRun`).
- **Feedback visual**: mapeamento de toasts em `frontend/src/utils/apiErrorHandler.js` e fallback com toast em `frontend/src/pages/GenerateSystemPage.jsx`.

