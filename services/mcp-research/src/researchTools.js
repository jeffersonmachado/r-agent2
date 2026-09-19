'use strict';

/**
 * Tools MCP do container de pesquisa — contrato 1:1 com as capabilities
 * governadas `research.*` (api/services/benchmark/researchCapabilities.js).
 *
 *   research_search                → research.search
 *   research_fetch                 → research.fetch
 *   research_inspect_documentation → research.inspectDocumentation
 *   research_inspect_api_docs      → research.inspectApiDocs
 *   research_capture_evidence      → research.captureEvidence
 *
 * Os engines são REUSADOS de `api/services/research/nativeResearchProvider.js`
 * (não há fork): o container instancia o provider com os limites da config e
 * enriquece as saídas para o contrato MCP documentado no README.
 *
 * Regras duras:
 *  - conteúdo buscado é DADO, nunca instrução: todo `content` devolvido passa
 *    por `sanitizeUntrustedContent` (api/services/askAi/injectionGuard.js) e o
 *    `contentHash` é recomputado sobre o conteúdo EFETIVAMENTE devolvido —
 *    a ligação fetch → inspect → evidence permanece íntegra;
 *  - erros são TIPADOS (error.code) — nunca silenciosos;
 *  - OFFLINE: zero egress — search/fetch saem do snapshot local;
 *  - nada de dados de tenant sai na requisição (read-only, GET).
 */

const crypto = require('crypto');

const { createNativeResearchProvider } = require('../../../api/services/research/nativeResearchProvider');
const { sanitizeUntrustedContent } = require('../../../api/services/askAi/injectionGuard');

const TOOL_NAMES = Object.freeze([
  'research_search',
  'research_fetch',
  'research_inspect_documentation',
  'research_inspect_api_docs',
  'research_capture_evidence',
]);

/** Paridade tool → capability canônica (fonte do toolCapabilityMap do bootstrap). */
const TOOL_CAPABILITY_MAP = Object.freeze({
  research_search: 'research.search',
  research_fetch: 'research.fetch',
  research_inspect_documentation: 'research.inspectDocumentation',
  research_inspect_api_docs: 'research.inspectApiDocs',
  research_capture_evidence: 'research.captureEvidence',
});

const FRESHNESS_VALUES = Object.freeze(['any', 'day', 'week', 'month', 'year']);

const STRING_ARRAY_SCHEMA = Object.freeze({
  type: 'array',
  items: { type: 'string' },
  maxItems: 50,
});

/** inputSchema JSON-RPC (tools/list) — validação real em validateInput. */
const TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: 'research_search',
    capability: 'research.search',
    description: 'Busca candidatos de fonte oficial (título, URL, snippet, domínio) para um termo de pesquisa. Saída: { query, candidates: [{ title, url, snippet, domain, sourceType, retrievedAt, providerMetadata }], retrievedAt, providerMetadata }.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 500 },
        allowedDomains: STRING_ARRAY_SCHEMA,
        blockedDomains: STRING_ARRAY_SCHEMA,
        officialOnly: { type: 'boolean' },
        language: { type: 'string', minLength: 2, maxLength: 12 },
        maxResults: { type: 'integer', minimum: 1, maximum: 25 },
        freshness: { type: 'string', enum: [...FRESHNESS_VALUES] },
      },
      required: ['query'],
      additionalProperties: false,
    }),
  }),
  Object.freeze({
    name: 'research_fetch',
    capability: 'research.fetch',
    description: 'Obtém um documento sob política de endpoint (SSRF guard, DNS revalidado, TLS verificado, tetos de tamanho/timeout). Saída: { url, canonicalUrl, httpStatus, contentType, retrievedAt, content, contentHash, sizeBytes, title, sanitization, providerMetadata }.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: {
        url: { type: 'string', minLength: 1, maxLength: 2048 },
        allowedDomains: STRING_ARRAY_SCHEMA,
        blockedDomains: STRING_ARRAY_SCHEMA,
      },
      required: ['url'],
      additionalProperties: false,
    }),
  }),
  Object.freeze({
    name: 'research_inspect_documentation',
    capability: 'research.inspectDocumentation',
    description: 'Extrai estrutura de documentação oficial (seções, capacidades, jornadas, regras) DO CONTEÚDO recebido, com locator por item. contentHash, quando presente, é verificado — divergência é recusa.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: {
        content: { type: 'string' },
        url: { type: 'string', maxLength: 2048 },
        contentHash: { type: 'string', maxLength: 96 },
      },
      required: ['content'],
      additionalProperties: false,
    }),
  }),
  Object.freeze({
    name: 'research_inspect_api_docs',
    capability: 'research.inspectApiDocs',
    description: 'Extrai contrato de API oficial (OpenAPI/Swagger real ou menções de endpoint) DO CONTEÚDO recebido. Sem superfície de API o resultado é NOT_APPLICABLE — nunca inventado.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: {
        content: { type: 'string' },
        url: { type: 'string', maxLength: 2048 },
        contentHash: { type: 'string', maxLength: 96 },
      },
      required: ['content'],
      additionalProperties: false,
    }),
  }),
  Object.freeze({
    name: 'research_capture_evidence',
    capability: 'research.captureEvidence',
    description: 'Registra evidência de fonte com hash de conteúdo e referência determinística. Saída: { evidenceRef, sourceUrl, canonicalUrl, contentHash, fragmentHash, locator, capturedAt, sourceType }.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: {
        url: { type: 'string', minLength: 1, maxLength: 2048 },
        contentHash: { type: 'string', minLength: 7, maxLength: 96 },
        contentType: { type: 'string', maxLength: 200 },
        canonicalUrl: { type: 'string', maxLength: 2048 },
        documentRef: { type: 'string', maxLength: 2048 },
        fragmentHash: { type: 'string', maxLength: 96 },
        locator: { type: 'string', maxLength: 500 },
        sourceType: { type: 'string', maxLength: 64 },
      },
      required: ['url', 'contentHash'],
      additionalProperties: false,
    }),
  }),
]);

function toolError(code, message, detail = null) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

// ---------------------------------------------------------------------------
// Validação de input (fail-closed, tipada). O SDK NÃO valida inputSchema por
// conta própria — a validação real é esta.
// ---------------------------------------------------------------------------

function assertPlainObject(value, toolName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw toolError('research_invalid_input', `research_invalid_input: ${toolName} exige objeto de argumentos`);
  }
}

function assertStringField(input, field, { required = false, max = 2048, toolName }) {
  const value = input[field];
  if (value === undefined || value === null) {
    if (required) {
      throw toolError('research_invalid_input', `research_invalid_input: ${toolName}.${field} é obrigatório`);
    }
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw toolError('research_invalid_input', `research_invalid_input: ${toolName}.${field} deve ser string não-vazia até ${max} chars`);
  }
  return value;
}

function assertDomainList(input, field, { toolName }) {
  const value = input[field];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 50
    || value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0 || entry.length > 253)) {
    throw toolError('research_invalid_input', `research_invalid_input: ${toolName}.${field} deve ser array de domínios (máx 50)`);
  }
  return value.map((entry) => entry.trim().toLowerCase());
}

function assertAllowedFields(input, allowed, toolName) {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      throw toolError('research_invalid_input', `research_invalid_input: ${toolName} não aceita o campo '${key}'`);
    }
  }
}

function normalizeSearchInput(raw, toolName) {
  assertPlainObject(raw, toolName);
  assertAllowedFields(raw, ['query', 'allowedDomains', 'blockedDomains', 'officialOnly', 'language', 'maxResults', 'freshness'], toolName);
  const query = assertStringField(raw, 'query', { required: true, max: 500, toolName });
  const allowedDomains = assertDomainList(raw, 'allowedDomains', { toolName });
  const blockedDomains = assertDomainList(raw, 'blockedDomains', { toolName });
  const officialOnly = raw.officialOnly === true;
  if (raw.language !== undefined && (typeof raw.language !== 'string' || raw.language.length < 2 || raw.language.length > 12)) {
    throw toolError('research_invalid_input', 'research_invalid_input: research_search.language inválido');
  }
  let maxResults = 10;
  if (raw.maxResults !== undefined) {
    const parsed = Number(raw.maxResults);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 25) {
      throw toolError('research_invalid_input', 'research_invalid_input: research_search.maxResults deve ser inteiro entre 1 e 25');
    }
    maxResults = parsed;
  }
  const freshness = raw.freshness === undefined ? 'any' : String(raw.freshness);
  if (!FRESHNESS_VALUES.includes(freshness)) {
    throw toolError('research_invalid_input', `research_invalid_input: research_search.freshness deve ser ${FRESHNESS_VALUES.join('|')}`);
  }
  // "oficial" não é verificável sem uma lista de domínios oficiais: recusar é
  // HONESTO; aceitar e fingir seria pior.
  if (officialOnly && allowedDomains.length === 0) {
    throw toolError(
      'research_search_official_only_unverifiable',
      'research_search_official_only_unverifiable: officialOnly exige allowedDomains declarando os domínios oficiais',
    );
  }
  return { query: query.trim(), allowedDomains, blockedDomains, officialOnly, language: raw.language || null, maxResults, freshness };
}

function normalizeFetchInput(raw, toolName) {
  assertPlainObject(raw, toolName);
  assertAllowedFields(raw, ['url', 'allowedDomains', 'blockedDomains'], toolName);
  const url = assertStringField(raw, 'url', { required: true, max: 2048, toolName });
  return {
    url: url.trim(),
    allowedDomains: assertDomainList(raw, 'allowedDomains', { toolName }),
    blockedDomains: assertDomainList(raw, 'blockedDomains', { toolName }),
  };
}

function normalizeInspectInput(raw, toolName) {
  assertPlainObject(raw, toolName);
  assertAllowedFields(raw, ['content', 'url', 'contentHash'], toolName);
  if (typeof raw.content !== 'string') {
    throw toolError('research_invalid_input', `research_invalid_input: ${toolName}.content deve ser string (o documento analisado)`);
  }
  return {
    content: raw.content,
    url: assertStringField(raw, 'url', { max: 2048, toolName }),
    contentHash: assertStringField(raw, 'contentHash', { max: 96, toolName }),
  };
}

function normalizeEvidenceInput(raw, toolName) {
  assertPlainObject(raw, toolName);
  assertAllowedFields(raw, ['url', 'contentHash', 'contentType', 'canonicalUrl', 'documentRef', 'fragmentHash', 'locator', 'sourceType'], toolName);
  return {
    url: assertStringField(raw, 'url', { required: true, max: 2048, toolName }).trim(),
    contentHash: assertStringField(raw, 'contentHash', { required: true, max: 96, toolName }),
    contentType: assertStringField(raw, 'contentType', { max: 200, toolName }),
    canonicalUrl: assertStringField(raw, 'canonicalUrl', { max: 2048, toolName }),
    documentRef: assertStringField(raw, 'documentRef', { max: 2048, toolName }),
    fragmentHash: assertStringField(raw, 'fragmentHash', { max: 96, toolName }),
    locator: assertStringField(raw, 'locator', { max: 500, toolName }),
    sourceType: assertStringField(raw, 'sourceType', { max: 64, toolName }),
  };
}

// ---------------------------------------------------------------------------
// Filtros de domínio (search e fetch)
// ---------------------------------------------------------------------------

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_) {
    return null;
  }
}

function domainMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function assertUrlDomainsAllowed(url, { allowedDomains = [], blockedDomains = [] }) {
  const hostname = hostnameOf(url);
  if (!hostname) {
    throw toolError('research_fetch_invalid_url', `research_fetch_invalid_url: url sem host (${url})`);
  }
  if (blockedDomains.some((domain) => domainMatches(hostname, domain))) {
    throw toolError('research_domain_blocked', `research_domain_blocked: ${hostname} está em blockedDomains`, { hostname });
  }
  if (allowedDomains.length > 0 && !allowedDomains.some((domain) => domainMatches(hostname, domain))) {
    throw toolError('research_domain_not_allowed', `research_domain_not_allowed: ${hostname} fora de allowedDomains`, { hostname });
  }
}

function filterCandidatesByDomain(candidates, { allowedDomains = [], blockedDomains = [] }) {
  return candidates.filter((candidate) => {
    const hostname = hostnameOf(candidate.url);
    if (!hostname) return false;
    if (blockedDomains.some((domain) => domainMatches(hostname, domain))) return false;
    if (allowedDomains.length > 0 && !allowedDomains.some((domain) => domainMatches(hostname, domain))) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Sanitização: conteúdo buscado é DADO. O hash devolvido é do conteúdo
// EFETIVAMENTE devolvido (pós-neutralização) — a cadeia fetch → inspect →
// evidence continua ligada pelo MESMO hash.
// ---------------------------------------------------------------------------

function sanitizeFetchedContent(content) {
  const sanitized = sanitizeUntrustedContent(String(content ?? ''));
  return {
    content: sanitized.text,
    contentHash: `sha256:${crypto.createHash('sha256').update(sanitized.text, 'utf8').digest('hex')}`,
    sanitization: {
      injectionDetected: sanitized.injectionDetected,
      neutralizedLines: sanitized.neutralizedLines,
      redactions: sanitized.redactions,
      treatedAs: 'DATA_ONLY',
    },
  };
}

function extractHtmlTitle(content) {
  const match = String(content ?? '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  const title = match[1].replace(/\s+/g, ' ').trim();
  return title.length > 0 ? title.slice(0, 200) : null;
}

/**
 * Monta os handlers das 5 tools.
 *
 * @param {object} args
 * @param {object} args.config   resultado de loadConfig
 * @param {object} [args.snapshotStore]  obrigatório em OFFLINE
 * @param {object} [args.providerDeps]   injeção de teste para o provider ONLINE
 *   (transport/resolveAddresses/now/sleep/logger) — produção não passa nada
 * @param {object} [args.logger]
 */
function createToolHandlers({ config, snapshotStore = null, providerDeps = {}, logger } = {}) {
  if (!config) throw toolError('research_invalid_input', 'config ausente em createToolHandlers');
  const mode = config.mode;

  // Em OFFLINE o provider de REDE não é sequer instanciado: não existe caminho
  // de egress para acionar, nem por engano de chamada.
  const provider = mode === 'ONLINE'
    ? createNativeResearchProvider({
      ...providerDeps,
      logger: providerDeps.logger || logger,
      options: {
        timeoutMs: config.timeoutMs,
        maxBytes: config.maxBytes,
        maxRedirects: config.maxRedirects,
        maxSearchResults: 25,
        ...(providerDeps.options || {}),
        // Exceções TEST-ONLY (default estrito); ver config.js.
        endpointPolicy: { ...config.endpointPolicy },
      },
    })
    : null;

  if (mode === 'OFFLINE' && !snapshotStore) {
    throw toolError('research_offline_snapshot_unavailable', 'research_offline_snapshot_unavailable: modo OFFLINE exige snapshotStore');
  }

  const providerMetadata = (extra = {}) => ({
    provider: 'mcp-research',
    mode,
    ...extra,
  });

  async function researchSearch(raw) {
    const input = normalizeSearchInput(raw, 'research_search');

    let candidates;
    let backend;
    let freshnessEnforced = false;
    if (mode === 'OFFLINE') {
      const results = snapshotStore.search({ query: input.query, maxResults: 25 });
      candidates = results;
      backend = 'snapshot';
      // Freshness é EXEQÚÍVEL offline (o snapshot carrega retrievedAt).
      if (input.freshness !== 'any') {
        const windowMs = {
          day: 86400000, week: 7 * 86400000, month: 30 * 86400000, year: 365 * 86400000,
        }[input.freshness];
        const cutoff = Date.now() - windowMs;
        candidates = candidates.filter((c) => {
          const at = Date.parse(c.retrievedAt || '');
          return Number.isFinite(at) && at >= cutoff;
        });
        freshnessEnforced = true;
      }
    } else {
      const result = await provider.search({ query: input.query }, { classification: 'DEVELOPMENT' });
      candidates = (result.candidates || []).map((candidate) => ({
        title: candidate.title,
        url: candidate.url,
        snippet: null, // os backends HTML não expõem snippet confiável — nunca inventado
        retrievedAt: result.retrievedAt,
      }));
      backend = result.backend || null;
      // ONLINE: os backends não expõem data de publicação — freshness NÃO é
      // aplicável e isso é declarado no providerMetadata, nunca fingido.
    }

    const filtered = filterCandidatesByDomain(candidates, input).slice(0, input.maxResults);
    return {
      query: input.query,
      candidates: filtered.map((candidate) => ({
        title: candidate.title,
        url: candidate.url,
        snippet: candidate.snippet ?? null,
        domain: hostnameOf(candidate.url),
        sourceType: candidate.sourceType || (mode === 'OFFLINE' ? 'snapshot' : 'web'),
        retrievedAt: candidate.retrievedAt || null,
        providerMetadata: providerMetadata({ backend }),
      })),
      retrievedAt: new Date().toISOString(),
      providerMetadata: providerMetadata({
        backend,
        officialOnly: input.officialOnly,
        language: input.language,
        languageEnforced: false, // backends não aceitam filtro de idioma governado
        freshnessRequested: input.freshness,
        freshnessEnforced,
        resultCount: filtered.length,
      }),
    };
  }

  async function researchFetch(raw) {
    const input = normalizeFetchInput(raw, 'research_fetch');
    assertUrlDomainsAllowed(input.url, input);

    let upstream;
    if (mode === 'OFFLINE') {
      const document = snapshotStore.fetchDocument(input.url);
      upstream = {
        httpStatus: 200,
        url: document.url,
        content: document.content,
        contentType: document.contentType,
        sizeBytes: Buffer.byteLength(document.content, 'utf8'),
        retrievedAt: document.retrievedAt || new Date().toISOString(),
      };
    } else {
      upstream = await provider.fetch({ url: input.url }, { classification: 'DEVELOPMENT' });
    }

    const sanitized = sanitizeFetchedContent(upstream.content);
    // Nomes ALINHADOS ao contrato canônico da capability `research.fetch`
    // (api/services/benchmark/researchCapabilities.js): `httpStatus`. O serviço
    // devolvia `status` — divergência que não quebrava nada de forma visível:
    // o consumidor governado exige `Number.isFinite(httpStatus)` e descartava
    // TODO candidato em silêncio (medido 2026-09-19: 10 hits/query → 0
    // candidatos). O provider NATIVO sempre devolveu `httpStatus`.
    return {
      url: String(input.url),
      canonicalUrl: upstream.url || String(input.url),
      httpStatus: upstream.httpStatus,
      contentType: upstream.contentType || null,
      retrievedAt: upstream.retrievedAt || new Date().toISOString(),
      content: sanitized.content,
      contentHash: sanitized.contentHash,
      sizeBytes: Buffer.byteLength(sanitized.content, 'utf8'),
      title: extractHtmlTitle(sanitized.content),
      sanitization: sanitized.sanitization,
      providerMetadata: providerMetadata({
        sourceBytes: upstream.sizeBytes ?? null,
      }),
    };
  }

  async function researchInspectDocumentation(raw) {
    const input = normalizeInspectInput(raw, 'research_inspect_documentation');
    // Inspeção é PURA sobre o conteúdo recebido; o provider verifica o hash.
    return provider
      ? provider.inspectDocumentation(input)
      : createInspectOnlyProvider().inspectDocumentation(input);
  }

  async function researchInspectApiDocs(raw) {
    const input = normalizeInspectInput(raw, 'research_inspect_api_docs');
    return provider
      ? provider.inspectApiDocs(input)
      : createInspectOnlyProvider().inspectApiDocs(input);
  }

  async function researchCaptureEvidence(raw) {
    const input = normalizeEvidenceInput(raw, 'research_capture_evidence');
    const evidenceProvider = provider || createInspectOnlyProvider();
    const result = await evidenceProvider.captureEvidence({
      url: input.url,
      documentRef: input.documentRef,
      contentHash: input.contentHash,
      contentType: input.contentType,
    });
    return {
      evidenceRef: result.evidenceRef,
      sourceUrl: result.url,
      canonicalUrl: input.canonicalUrl || result.url,
      contentHash: result.contentHash,
      fragmentHash: input.fragmentHash || null,
      locator: input.locator || null,
      capturedAt: result.capturedAt,
      sourceType: input.sourceType || 'web',
      providerMetadata: providerMetadata(),
    };
  }

  // Inspeções e evidência são funções PURAS do provider (sem rede). Em OFFLINE
  // instanciamos um provider apenas para esses runners — o transporte NUNCA é
  // chamado porque search/fetch não passam por ele (snapshot acima).
  let inspectOnly = null;
  function createInspectOnlyProvider() {
    if (!inspectOnly) {
      inspectOnly = createNativeResearchProvider({
        logger,
        transport: async () => {
          throw toolError('research_offline_egress_forbidden', 'research_offline_egress_forbidden: modo OFFLINE não faz rede');
        },
        resolveAddresses: async () => {
          throw toolError('research_offline_egress_forbidden', 'research_offline_egress_forbidden: modo OFFLINE não resolve DNS');
        },
      });
    }
    return inspectOnly;
  }

  return Object.freeze({
    research_search: researchSearch,
    research_fetch: researchFetch,
    research_inspect_documentation: researchInspectDocumentation,
    research_inspect_api_docs: researchInspectApiDocs,
    research_capture_evidence: researchCaptureEvidence,
  });
}

module.exports = {
  TOOL_NAMES,
  TOOL_DEFINITIONS,
  TOOL_CAPABILITY_MAP,
  createToolHandlers,
  sanitizeFetchedContent,
};
