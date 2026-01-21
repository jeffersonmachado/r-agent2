## Visão geral (RAG + scraping + arquivos)

Este repositório mantém um pipeline que **indexa fontes do tenant** (site + arquivos) no RAG e usa essas fontes para **sugerir descrição**.

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
- **Imagens (png/jpg/webp)**: OCR com `tesseract.js` (timeout 15s por arquivo)

### Habilitar/Desabilitar via env

- **USE_OCR**: `true|false` (padrão: `false`)

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

