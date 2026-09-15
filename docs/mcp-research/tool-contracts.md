# MCP Research — contratos das tools

Contrato real das 5 tools expostas em `POST /mcp`. Fonte da verdade:
`services/mcp-research/src/researchTools.js` (`TOOL_DEFINITIONS`,
validação em `normalize*Input`, handlers em `createToolHandlers`) e o engine
reusado `api/services/research/nativeResearchProvider.js`.

Regras transversais (todas as tools):

- **Classificação**: DEVELOPMENT (visibilidade registrada no Canonical Tool
  Registry; teto da conexão auto-registrada). Nunca PRODUCTION.
- **Read-only**: `sideEffects: false`, `riskLevel: 'low'`,
  `confirmationPolicy: 'autonomous'`, `idempotencyPolicy: 'none'`. Nenhum dado
  de tenant sai na requisição; egress é sempre GET.
- **Validação fail-closed**: o SDK MCP não valida `inputSchema` — a validação
  real é a do container (`research_invalid_input`, campos desconhecidos
  recusados, `additionalProperties: false`).
- **Erros tipados**: falhas saem como `{ error, code }` com `isError: true` no
  envelope MCP — nunca stack, nunca segredo, nunca silêncio.
- **Conteúdo é DADO**: todo `content` devolvido passa por
  `sanitizeUntrustedContent` (`api/services/askAi/injectionGuard.js`) e o
  `contentHash` é recomputado sobre o conteúdo **efetivamente devolvido** —
  a cadeia fetch → inspect → evidence permanece ligada pelo mesmo hash.
- **Timeout/timeout de fetch**: `MCP_RESEARCH_TIMEOUT_MS` por salto (default
  15000 ms, faixa 100–60000); teto de resposta `MCP_RESEARCH_MAX_BYTES`
  (default 2 MiB); teto de redirects `MCP_RESEARCH_MAX_REDIRECTS` (default 3).
  A conexão registrada na API usa `timeoutMs: 30000` e `retryPolicy:
  { attempts: 2 }`.
- **OFFLINE**: `research_search`/`research_fetch` saem do snapshot local;
  ausência é `research_offline_snapshot_miss`; inspeções e evidência são
  funções puras e funcionam igual nos dois modos.

## 1. `research_search` → `research.search`

Busca candidatos de fonte oficial (título, URL, snippet, domínio) para um termo.

**Input** (`required: ['query']`):

| Campo | Tipo | Restrição |
|---|---|---|
| `query` | string | 1–500 chars, obrigatório |
| `allowedDomains` | string[] | máx 50 entradas; match por host ou subdomínio |
| `blockedDomains` | string[] | máx 50 entradas; tem precedência sobre allowed |
| `officialOnly` | boolean | exige `allowedDomains` declarando os domínios oficiais — sem lista, recusa HONESTA (`research_search_official_only_unverifiable`): "oficial" não é verificável sem fonte declarada |
| `language` | string | 2–12 chars; declarado mas **não enforced** (`languageEnforced: false` — os backends não aceitam filtro de idioma governado) |
| `maxResults` | integer | 1–25 (default 10) |
| `freshness` | enum | `any\|day\|week\|month\|year` (default `any`) |

**Output**: `{ query, candidates: [{ title, url, snippet, domain, sourceType, retrievedAt, providerMetadata }], retrievedAt, providerMetadata }`.

- ONLINE: backend DuckDuckGo HTML com fallback Bing (`nativeResearchProvider`);
  `snippet` é `null` (os backends HTML não expõem snippet confiável — nunca
  inventado); `freshness` **não é aplicável** online (sem data de publicação)
  e isso é declarado em `providerMetadata.freshnessEnforced: false`.
- OFFLINE: busca local no índice do snapshot (conjunção de termos sobre
  título/snippet/url/queryTerms); `freshness` é exeqüível via `retrievedAt` do
  snapshot (`freshnessEnforced: true`).
- `providerMetadata` inclui `provider: 'mcp-research'`, `mode`, `backend`,
  `resultCount`.

**Erros**: `research_invalid_input`, `research_search_official_only_unverifiable`,
`research_search_query_required` (provider), erros tipados de fetch do backend.

**Exemplo**:

```json
{ "query": "gym management software billing", "allowedDomains": ["vendor.example"], "officialOnly": true, "maxResults": 10, "freshness": "year" }
```

## 2. `research_fetch` → `research.fetch`

Obtém um documento sob política de endpoint (SSRF guard, DNS revalidado, TLS
verificado, tetos de tamanho/timeout/redirect).

**Input** (`required: ['url']`):

| Campo | Tipo | Restrição |
|---|---|---|
| `url` | string | 1–2048 chars, obrigatório |
| `allowedDomains` | string[] | máx 50; fora da lista → `research_domain_not_allowed` |
| `blockedDomains` | string[] | match → `research_domain_blocked` |

**Output**: `{ url, canonicalUrl, status, contentType, retrievedAt, content, contentHash, sizeBytes, title, sanitization, providerMetadata }`.

- `content` é o corpo **sanitizado** (injeção neutralizada, PII/credenciais
  redigidas); `contentHash` = `sha256:` do conteúdo sanitizado devolvido;
  `sizeBytes` é do conteúdo devolvido; `providerMetadata.sourceBytes` registra
  o tamanho original upstream.
- `sanitization`: `{ injectionDetected, neutralizedLines, redactions, treatedAs: 'DATA_ONLY' }`.
- `title`: extraído de `<title>` quando presente (máx 200 chars), senão `null`.
- Redirects são caminhados salto a salto; cada destino é reavaliado pela
  política de endpoint antes de conectar (`redirect: 'manual'` no transporte).

**Erros**: `research_invalid_input`, `research_fetch_invalid_url`,
`research_domain_blocked`, `research_domain_not_allowed`,
`research_fetch_blocked` (política de endpoint), `research_fetch_timeout`,
`research_fetch_too_large`, `research_fetch_redirect_blocked`,
`research_fetch_failed`, `research_offline_snapshot_miss` (OFFLINE).

**Exemplo**:

```json
{ "url": "https://vendor.example/docs/pricing", "allowedDomains": ["vendor.example"] }
```

## 3. `research_inspect_documentation` → `research.inspectDocumentation`

Extrai estrutura de documentação oficial (seções, capacidades, jornadas,
regras) **do conteúdo recebido**, com locator por item. Função **pura** (sem
rede nem relógio): mesma entrada → mesma saída.

**Input** (`required: ['content']`): `content` (string, o documento analisado),
`url` (≤2048, contexto), `contentHash` (≤96, opcional).

- Quando `contentHash` é informado, ele é **verificado** contra o conteúdo —
  divergência é recusa (`research_content_hash_mismatch`). É isso que liga a
  inspeção ao documento obtido pelo fetch, nunca a uma versão posterior da URL.

**Erros**: `research_invalid_input`, `research_content_hash_mismatch`.

## 4. `research_inspect_api_docs` → `research.inspectApiDocs`

Extrai contrato de API oficial (OpenAPI/Swagger real ou menções de endpoint)
**do conteúdo recebido**. Função pura. Quando não há superfície de API no
conteúdo, o resultado é **NOT_APPLICABLE — nunca inventado**.

**Input** (`required: ['content']`): igual à tool anterior (`content`, `url`,
`contentHash` verificado quando presente).

**Erros**: `research_invalid_input`, `research_content_hash_mismatch`.

## 5. `research_capture_evidence` → `research.captureEvidence`

Registra evidência de fonte com hash de conteúdo e referência determinística.
A validação/normalização acontece no provider; a **persistência** fica no store
do chamador (a API) — o container não grava nada.

**Input** (`required: ['url', 'contentHash']`):

| Campo | Restrição |
|---|---|
| `url` | 1–2048, obrigatório |
| `contentHash` | 7–96, obrigatório (formato `sha256:<hex>` normalizado pelo provider) |
| `contentType` | ≤200 |
| `canonicalUrl` | ≤2048 |
| `documentRef` | ≤2048 |
| `fragmentHash` | ≤96 |
| `locator` | ≤500 |
| `sourceType` | ≤64 (default na saída: `web`) |

**Output**: `{ evidenceId, sourceUrl, canonicalUrl, contentHash, fragmentHash, locator, capturedAt, sourceType, providerMetadata }`.

**Erros**: `research_invalid_input`, `research_evidence_invalid`.

**Exemplo**:

```json
{ "url": "https://vendor.example/docs/pricing", "contentHash": "sha256:…", "locator": "section#billing", "sourceType": "official_docs" }
```

## Segurança por tool (resumo)

| Tool | Rede | Superfície principal | Controle |
|---|---|---|---|
| `research_search` | ONLINE: egress de busca | query vazando contexto | query é o único campo livre; sem dado de tenant |
| `research_fetch` | ONLINE: egress de documento | SSRF/redirect/TLS/conteúdo hostil | política de endpoint + DNS revalidado + sanitização + tetos |
| `research_inspect_*` | nenhuma | documento hostil como instrução | função pura; conteúdo já sanitizado no fetch; hash verificado |
| `research_capture_evidence` | nenhuma | evidência forjada | hash obrigatório e validado; persistência fora do container |

Detalhes do modelo de ameaças em `security-model.md`.
