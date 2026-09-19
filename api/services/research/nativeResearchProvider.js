'use strict';

/**
 * Native Research Provider — implementação NATIVA das capabilities governadas
 * `research.*` (contrato em `api/services/benchmark/researchCapabilities.js`).
 *
 * Até 2026-09-14 a plataforma NÃO tinha provider nativo: sem uma conexão MCP
 * externa atendendo `research.*`, todo run de pesquisa terminava em
 * `RESEARCH_BLOCKED_NO_EXTERNAL_ACCESS`. Este módulo é a implementação real:
 *
 *   search               → DuckDuckGo HTML (sem chave de API) com FALLBACK
 *                          para Bing (`b_algo` + redirect `u=a1<base64url>`)
 *   fetch                → HTTPS GET sob a política de endpoint do MCP
 *                          (SSRF guard, DNS rebinding, redirect por salto)
 *   inspectDocumentation → extração DETERMINÍSTICA de seções/recursos/
 *                          jornadas/regras do conteúdo recebido, com locator
 *   inspectApiDocs       → OpenAPI/Swagger real ou menções de endpoint; quando
 *                          não há superfície de API o resultado é NOT_APPLICABLE
 *   captureEvidence      → valida + normaliza o registro de evidência (a
 *                          persistência continua no store do chamador)
 *
 * Regras duras:
 *  - READ-ONLY: apenas GET; nenhum dado do tenant sai na requisição;
 *  - rede passa SEMPRE pela política de endpoint de `src/core/mcp/endpoint-policy`
 *    (a mesma fronteira do MCP Client): https-only por padrão, sem credencial
 *    em URL, sem loopback/privado/link-local/metadata, DNS resolvido é
 *    revalidado ANTES de conectar, e cada salto de redirect é reavaliado;
 *  - erros são TIPADOS (`RESEARCH_PROVIDER_ERROR_CODES`) — nunca silenciosos;
 *  - inspeções são PURAS sobre o conteúdo recebido (mesma entrada → mesma
 *    saída, sem relógio nem rede);
 *  - o transporte e a resolução DNS são INJETÁVEIS (teste sem rede); o default
 *    é `fetch` global + `dns.lookup`;
 *  - polidez: intervalo mínimo por host via relógio/sono injetados.
 */

const crypto = require('crypto');
const dns = require('dns').promises;

const endpointPolicy = require('../../../src/core/mcp/endpoint-policy');

// Logger default é PREGUIÇOSO (mesmo padrão de src/core/mcp/client-hub.js):
// o módulo pode ser carregado por runtimes fora da API (ex.: o container
// services/mcp-research) sem arrastar a cadeia api/utils/logger → config.
function defaultLogger() {
  return require('../../utils/logger');
}

const RESEARCH_PROVIDER_ERROR_CODES = Object.freeze({
  INVALID_URL: 'research_fetch_invalid_url',
  BLOCKED: 'research_fetch_blocked',
  TIMEOUT: 'research_fetch_timeout',
  TOO_LARGE: 'research_fetch_too_large',
  REDIRECT_BLOCKED: 'research_fetch_redirect_blocked',
  FAILED: 'research_fetch_failed',
  SEARCH_QUERY_REQUIRED: 'research_search_query_required',
  HASH_MISMATCH: 'research_content_hash_mismatch',
  EVIDENCE_INVALID: 'research_evidence_invalid',
});

const DEFAULTS = Object.freeze({
  timeoutMs: 15000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 3,
  minIntervalMsPerHost: 1000,
  maxSearchResults: 10,
  maxItemsPerKind: 50,
  maxOperations: 100,
  userAgent: 'RAP-Research/1.0 (Results Autonomous Platform; governed research.fetch; read-only)',
  searchEndpoint: 'https://html.duckduckgo.com/html/',
  // Backend de FALLBACK da busca: o DuckDuckGo responde 202 (bot-check) a
  // datacenters; o Bing atende com resultados reais em `<li class="b_algo">`.
  bingSearchEndpoint: 'https://www.bing.com/search',
});

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const HTTP_METHODS = Object.freeze(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function normalizeSha256(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  const hex = raw.startsWith('sha256:') ? raw.slice('sha256:'.length) : raw;
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function researchError(code, message, detail = null) {
  const error = new Error(message);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

// ---------------------------------------------------------------------------
// Transporte default (uma única requisição, SEM seguir redirect — os saltos
// são caminhados pelo provider para que cada destino seja reavaliado pela
// política de endpoint antes de conectar).
// ---------------------------------------------------------------------------

async function defaultTransport({ url, headers, signal }) {
  const response = await fetch(url, {
    method: 'GET',
    headers,
    redirect: 'manual',
    signal,
  });
  const arrayBuffer = await response.arrayBuffer();
  const flat = {};
  response.headers.forEach((value, key) => { flat[String(key).toLowerCase()] = value; });
  return { status: response.status, headers: flat, body: Buffer.from(arrayBuffer) };
}

async function defaultResolveAddresses(hostname) {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return (Array.isArray(records) ? records : []).map((record) => record.address);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// HTML helpers (determinísticos, sem dependência externa)
// ---------------------------------------------------------------------------

const HTML_ENTITIES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
});

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&#(\d+);/g, (_, code) => {
      const codePoint = Number(code);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const codePoint = parseInt(code, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
    })
    .replace(/&([a-z]+);/gi, (match, name) => HTML_ENTITIES[name.toLowerCase()] ?? match);
}

/** HTML → texto: scripts/styles fora, tags de bloco viram quebra de linha. */
function htmlToText(html) {
  return decodeHtmlEntities(
    String(html ?? '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '\n')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '\n')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|ul|ol|section|article|header|footer|tr|table|h[1-6])\s*>/gi, '\n')
      .replace(/<(br|hr)\b[^>]*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  );
}

function collapseWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Padrões de extração (pt-BR + en) — documentação de produto de gestão
// ---------------------------------------------------------------------------

const KIND_PATTERNS = Object.freeze({
  capabilities: /\b(billing|cobranças?|financeiro|payments?|pagamentos?|invoices?|faturas?|mensalidades?|memberships?|matrículas?|planos?|plans?|subscriptions?|assinaturas?|check[- ]?ins?|catracas?|access control|controle de acesso|agendamentos?|scheduling|bookings?|reservas?|aulas coletivas|crm|aplicativo|mobile app|app do aluno|relatórios?|dashboards?|workouts?|treinos?|avaliação física|waitlist|lista de espera|automação|marketing automation|e-?mail marketing|retenção|retention|member portal|portal do aluno|gestão de alunos|personal trainer)\b/i,
  journeys: /\b(onboarding|jornadas?|fluxo de|processo de|passo a passo|step[- ]by[- ]step|como funciona|getting started|primeiros passos)\b/i,
  rules: /\b(congelamento|freez(e|ing)|cancelamento|cancellation|política de cancelamento|cancel policy|multas?|penalt\w*|reembolsos?|refunds?|fidelidade|minimum term|vigência|renovação automática|auto[- ]?renew\w*|carência|no[- ]?show|late cancel\w*)\b/i,
});

const HEADING_RE = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
const ENDPOINT_MENTION_RE = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9_\-./{}:]+)/g;
const MAX_ITEM_NAME = 120;
const MIN_LINE_LENGTH = 4;
const MAX_LINE_LENGTH = 400;

/**
 * createNativeResearchProvider(deps) → runners das capabilities `research.*`.
 *
 * @param {object} [deps]
 * @param {Function} [deps.transport]         um GET de um salto:
 *   `async ({ url, headers, timeoutMs, signal }) → { status, headers, body(Buffer) }`
 * @param {Function} [deps.resolveAddresses]  `async (hostname) → string[]`
 * @param {Function} [deps.now]               relógio em ms (default `Date.now`)
 * @param {Function} [deps.sleep]             `async (ms)` (default setTimeout)
 * @param {object} [deps.logger]
 * @param {object} [deps.options]             sobrescreve DEFAULTS
 * @param {object} [deps.options.endpointPolicy]  exceções EXPLÍCITAS da política
 *   de endpoint (`allowPrivateNetwork`, `allowPlaintextHttp`) repassadas a
 *   `evaluateEndpoint`/`evaluateResolvedAddresses`. Default: NENHUMA exceção
 *   (loopback/privado/metadata bloqueados, https obrigatório). Reservado a
 *   harnesses de teste — produção nunca o define.
 */
/**
 * Termos que aparecem em quase toda query de mercado e por isso não provam que o
 * buscador RESPONDEU à pergunta. "software" casando com "software house" não diz
 * nada; "bakery" casando com "bakery" diz.
 */
const QUERY_STOPWORDS = new Set([
  'software', 'system', 'systems', 'sistema', 'sistemas', 'app', 'apps', 'application',
  'platform', 'plataforma', 'tool', 'tools', 'ferramenta', 'ferramentas',
  'management', 'manager', 'gestao', 'gestion', 'manage', 'managing',
  'solution', 'solutions', 'solucao', 'servico', 'servicos',
  'service', 'services', 'online', 'web', 'best', 'top', 'melhor', 'melhores',
  'free', 'gratis', 'para', 'com', 'the', 'and', 'for', 'with', 'your', 'you',
  'de', 'da', 'do', 'dos', 'das', 'uma', 'como', 'que', 'por',
]);

/** Radical curto: casa "bakery" com "bakeries" sem casar "bakery" com "electrician". */
function stemOf(token) {
  return token.slice(0, Math.min(5, token.length));
}

function tokenizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4);
}

/**
 * O conjunto de resultados RESPONDE à query? Puro e determinístico.
 *
 * Um backend que devolve HTTP 200 com conteúdo alheio à query não é um
 * resultado vazio: é um backend quebrado. Aceitá-lo faz o lixo entrar como
 * candidato e a falha só aparecer muito depois — foi exatamente o defeito que
 * travou a vertical `bakery`: 23 candidatos, todos sem um único termo de
 * categoria, causa real = página sem relação com a busca (medido 2026-09-19).
 *
 * Regra deliberadamente CONSERVADORA: só recusa quando NENHUM candidato
 * compartilha radical com NENHUM termo significativo da query. Um único acerto
 * basta para aceitar o backend (o veredito de relevância de mercado é de outra
 * camada, não desta). Se a query não tem termo significativo, não há como
 * decidir e o backend é aceito — recusar por ambiguidade seria forçar verde.
 *
 * @param {string} query
 * @param {Array<{title?: string, url?: string, snippet?: string}>} candidates
 * @returns {{unrelated: boolean, decidable: boolean, matched: number, evaluated: number, terms: string[], sample: string[]}}
 */
function assessSearchResultRelevance(query, candidates = []) {
  const evaluated = candidates.length;
  const terms = [...new Set(tokenizeText(query))].filter((t) => !QUERY_STOPWORDS.has(t));
  const stems = [...new Set(terms.map(stemOf))];

  if (stems.length === 0 || evaluated === 0) {
    return { unrelated: false, decidable: false, matched: 0, evaluated, terms, sample: [] };
  }

  const sample = [];
  let matched = 0;
  for (const candidate of candidates) {
    const hayTokens = [candidate.title, candidate.url, candidate.snippet]
      .map(tokenizeText)
      .flat();
    const hit = hayTokens.some((t) => stems.includes(stemOf(t)));
    if (hit) {
      matched += 1;
      if (sample.length < 3) sample.push(candidate.url || candidate.title || null);
    }
  }

  return { unrelated: matched === 0, decidable: true, matched, evaluated, terms, sample };
}

function createNativeResearchProvider(deps = {}) {
  const options = { ...DEFAULTS, ...(deps.options || {}) };
  const endpointPolicyOverrides = options.endpointPolicy && typeof options.endpointPolicy === 'object'
    ? options.endpointPolicy
    : {};
  const transport = typeof deps.transport === 'function' ? deps.transport : defaultTransport;
  const resolveAddresses = typeof deps.resolveAddresses === 'function'
    ? deps.resolveAddresses
    : defaultResolveAddresses;
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const sleep = typeof deps.sleep === 'function' ? deps.sleep : defaultSleep;
  const log = deps.logger || defaultLogger();

  const lastRequestAtByHost = new Map();

  function isoNow() {
    return new Date(now()).toISOString();
  }

  /** Polidez: intervalo mínimo por host, medido pelo relógio injetado. */
  async function waitForTurn(hostname) {
    const key = String(hostname || '').toLowerCase();
    const last = lastRequestAtByHost.get(key);
    const current = now();
    if (Number.isFinite(last) && current - last < options.minIntervalMsPerHost) {
      await sleep(options.minIntervalMsPerHost - (current - last));
    }
    lastRequestAtByHost.set(key, now());
  }

  /**
   * Política de endpoint + DNS ANTES de conectar. Reuso da fronteira do MCP
   * Client: qualquer destino (declarado ou redirecionado) passa por aqui.
   */
  async function assertEndpointAllowed(url, classification) {
    const policy = { ...endpointPolicyOverrides, maxRedirects: options.maxRedirects };
    const evaluated = endpointPolicy.evaluateEndpoint({
      endpoint: url,
      classification,
      policy,
    });
    if (!evaluated.allowed) {
      throw researchError(
        RESEARCH_PROVIDER_ERROR_CODES.BLOCKED,
        `${RESEARCH_PROVIDER_ERROR_CODES.BLOCKED}: ${url} (${evaluated.code})`,
        { url, policyCode: evaluated.code },
      );
    }

    const hostname = new URL(url).hostname.toLowerCase();
    let addresses;
    if (endpointPolicy.isIpLiteral(hostname)) {
      addresses = [hostname.replace(/^\[|\]$/g, '')];
    } else {
      try {
        addresses = await resolveAddresses(hostname);
      } catch (error) {
        throw researchError(
          RESEARCH_PROVIDER_ERROR_CODES.FAILED,
          `${RESEARCH_PROVIDER_ERROR_CODES.FAILED}: DNS resolution failed for ${hostname} (${error.code || error.message})`,
          { url, hostname, cause: error.code || error.message },
        );
      }
    }

    const resolved = endpointPolicy.evaluateResolvedAddresses({
      hostname,
      addresses,
      classification,
      policy,
    });
    if (!resolved.allowed) {
      throw researchError(
        RESEARCH_PROVIDER_ERROR_CODES.BLOCKED,
        `${RESEARCH_PROVIDER_ERROR_CODES.BLOCKED}: ${url} (${resolved.code})`,
        { url, policyCode: resolved.code },
      );
    }
  }

  /** Um GET de um salto com timeout real (o relógio da rede não é injetado). */
  async function requestOnce(url, headers) {
    const controller = new AbortController();
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(researchError(
          RESEARCH_PROVIDER_ERROR_CODES.TIMEOUT,
          `${RESEARCH_PROVIDER_ERROR_CODES.TIMEOUT}: ${url} (${options.timeoutMs}ms)`,
          { url, timeoutMs: options.timeoutMs },
        ));
      }, options.timeoutMs);
    });
    try {
      return await Promise.race([
        Promise.resolve().then(() => transport({
          url,
          headers,
          timeoutMs: options.timeoutMs,
          signal: controller.signal,
        })),
        timeout,
      ]);
    } catch (error) {
      if (error?.code === RESEARCH_PROVIDER_ERROR_CODES.TIMEOUT) throw error;
      throw researchError(
        RESEARCH_PROVIDER_ERROR_CODES.FAILED,
        `${RESEARCH_PROVIDER_ERROR_CODES.FAILED}: ${url} (${error?.message || 'transport error'})`,
        { url, cause: error?.message || String(error) },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * GET completo sob política: endpoint + DNS + polidez por host, com redirects
   * caminhados salto a salto (cada destino reavaliado) e teto de bytes.
   *
   * @returns {Promise<{httpStatus, content, contentType, url}>}
   */
  async function guardedGet(url, { classification = 'DEVELOPMENT' } = {}) {
    const headers = {
      'user-agent': options.userAgent,
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9,pt-BR;q=0.8',
    };

    let current = url;
    for (let hop = 0; ; hop += 1) {
      if (hop > options.maxRedirects) {
        throw researchError(
          RESEARCH_PROVIDER_ERROR_CODES.REDIRECT_BLOCKED,
          `${RESEARCH_PROVIDER_ERROR_CODES.REDIRECT_BLOCKED}: ${url} (mais de ${options.maxRedirects} saltos)`,
          { url, maxRedirects: options.maxRedirects },
        );
      }

      await assertEndpointAllowed(current, classification);
      const hostname = new URL(current).hostname.toLowerCase();
      await waitForTurn(hostname);

      const response = await requestOnce(current, headers);
      const status = Number(response?.status);
      const responseHeaders = response?.headers || {};

      if (REDIRECT_STATUSES.has(status) && isNonEmptyString(responseHeaders.location)) {
        let next;
        try {
          next = new URL(responseHeaders.location, current).toString();
        } catch (_) {
          throw researchError(
            RESEARCH_PROVIDER_ERROR_CODES.REDIRECT_BLOCKED,
            `${RESEARCH_PROVIDER_ERROR_CODES.REDIRECT_BLOCKED}: ${current} (location inválida)`,
            { url: current },
          );
        }
        current = next;
        continue;
      }

      const declaredLength = Number(responseHeaders['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
        throw researchError(
          RESEARCH_PROVIDER_ERROR_CODES.TOO_LARGE,
          `${RESEARCH_PROVIDER_ERROR_CODES.TOO_LARGE}: ${current} (content-length ${declaredLength} > ${options.maxBytes})`,
          { url: current, bytes: declaredLength, maxBytes: options.maxBytes },
        );
      }

      const body = Buffer.isBuffer(response?.body)
        ? response.body
        : Buffer.from(typeof response?.body === 'string' ? response.body : '', 'utf8');
      if (body.byteLength > options.maxBytes) {
        throw researchError(
          RESEARCH_PROVIDER_ERROR_CODES.TOO_LARGE,
          `${RESEARCH_PROVIDER_ERROR_CODES.TOO_LARGE}: ${current} (${body.byteLength} > ${options.maxBytes} bytes)`,
          { url: current, bytes: body.byteLength, maxBytes: options.maxBytes },
        );
      }

      return {
        httpStatus: status,
        content: body.toString('utf8'),
        contentType: isNonEmptyString(responseHeaders['content-type'])
          ? String(responseHeaders['content-type'])
          : null,
        url: current,
        sizeBytes: body.byteLength,
      };
    }
  }

  function classificationOf(context) {
    const declared = context?.actor?.classification || context?.classification;
    return isNonEmptyString(declared) ? String(declared).toUpperCase() : 'DEVELOPMENT';
  }

  // -------------------------------------------------------------------------
  // research.fetch
  // -------------------------------------------------------------------------

  async function fetchRunner(input = {}, context = {}) {
    const url = String(input.url ?? '').trim();
    if (!isNonEmptyString(url)) {
      throw researchError(RESEARCH_PROVIDER_ERROR_CODES.INVALID_URL, `${RESEARCH_PROVIDER_ERROR_CODES.INVALID_URL}: url é obrigatória`);
    }
    const result = await guardedGet(url, { classification: classificationOf(context) });
    // Contrato: o hash é do conteúdo EFETIVAMENTE devolvido (utf8), e é ele que
    // liga a evidência ao documento analisado. `url` é a URL FINAL (após os
    // redirects caminhados e reavaliados) — a forma canônica do documento.
    return {
      httpStatus: result.httpStatus,
      url: result.url,
      content: result.content,
      contentType: result.contentType,
      sizeBytes: result.sizeBytes,
      retrievedAt: isoNow(),
      contentHash: `sha256:${sha256Hex(result.content)}`,
    };
  }

  // -------------------------------------------------------------------------
  // research.search — DuckDuckGo HTML primeiro, Bing como FALLBACK.
  //
  // O DuckDuckGo responde 202 (anomaly check) a IPs de datacenter; o Bing
  // atende com resultados em blocos `<li class="b_algo">` cujos links são
  // redirects `bing.com/ck/a?...&u=a1<base64url(destino)>`. Ambos passam pelo
  // MESMO guarded fetch (política de endpoint, timeout, teto de bytes). Se os
  // dois falham, o resultado é vazio HONESTO com o motivo dos dois backends.
  //
  // MEDIDO EM 2026-09-19 (não repetir a suposição): o Bing devolvia HTTP 200
  // com conteúdo ALHEIO à query — "bakery management software" retornou
  // eletricistas de Summerville/SC em uma chamada e "When I Work" em outra, e
  // um fetch CRU (sem esta camada) do mesmo URL trouxe uma tela de login do
  // Google. HTTP 200 com página sem resultados é o pior modo de falha: parece
  // sucesso, então o lixo entra como candidato. Por isso `searchRunner` valida
  // a relevância do conjunto antes de aceitar um backend (ver
  // `assessSearchResultRelevance`). O DuckDuckGo, por sua vez, falhava no
  // transporte (`research_fetch_failed`) desta rede.
  // -------------------------------------------------------------------------

  function decodeResultUrl(href) {
    const decoded = decodeHtmlEntities(href);
    try {
      const absolute = new URL(decoded, options.searchEndpoint);
      const wrapped = absolute.searchParams.get('uddg');
      if (wrapped && /^https?:\/\//i.test(wrapped)) return wrapped;
      if (/(^|\.)duckduckgo\.com$/i.test(absolute.hostname)) return null;
      if (!/^https?:$/i.test(absolute.protocol)) return null;
      return absolute.toString();
    } catch (_) {
      return null;
    }
  }

  function parseSearchResults(html) {
    const candidates = [];
    const seen = new Set();
    const anchorRe = /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = anchorRe.exec(String(html ?? ''))) !== null) {
      const url = decodeResultUrl(match[1]);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      candidates.push({
        title: collapseWhitespace(htmlToText(match[2])) || url,
        url,
        source: 'duckduckgo',
      });
      if (candidates.length >= options.maxSearchResults) break;
    }
    return candidates;
  }

  /**
   * Destino real de um link de resultado do Bing: `u=a1<base64url(url)>` no
   * redirect `bing.com/ck/a`. Link interno do Bing (sem destino http(s)
   * decodificável) é rejeitado — nunca devolvido como candidato.
   */
  function decodeBingResultUrl(href) {
    const decoded = decodeHtmlEntities(href);
    try {
      const absolute = new URL(decoded, options.bingSearchEndpoint);
      if (/(^|\.)bing\.com$/i.test(absolute.hostname)) {
        const wrapped = absolute.searchParams.get('u');
        if (!wrapped || !wrapped.startsWith('a1')) return null;
        let destination;
        try {
          destination = Buffer.from(wrapped.slice(2), 'base64url').toString('utf8');
        } catch (_) {
          return null;
        }
        return /^https?:\/\//i.test(destination) ? destination : null;
      }
      if (!/^https?:$/i.test(absolute.protocol)) return null;
      return absolute.toString();
    } catch (_) {
      return null;
    }
  }

  function parseBingResults(html) {
    const candidates = [];
    const seen = new Set();
    // Split por bloco (nunca regex cruzando fronteiras de <li>): cada b_algo
    // contribui no máximo um candidato — o <h2><a> principal.
    const blocks = String(html ?? '').split('<li class="b_algo"');
    for (const block of blocks.slice(1)) {
      const match = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!match) continue;
      const url = decodeBingResultUrl(match[1]);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      candidates.push({
        title: collapseWhitespace(htmlToText(match[2])) || url,
        url,
        source: 'bing',
      });
      if (candidates.length >= options.maxSearchResults) break;
    }
    return candidates;
  }

  /**
   * Um backend de busca: GET guardado → candidatos parseados, ou motivo
   * HONESTO da falha (status não-200, zero resultados parseáveis, erro tipado
   * do transporte/política). Nunca lança: a falha de um backend não pode
   * impedir a tentativa do próximo.
   */
  async function trySearchBackend({ name, url, parse, classification }) {
    try {
      const result = await guardedGet(url, { classification });
      if (result.httpStatus !== 200) {
        return {
          candidates: [],
          reason: `${name}: search_endpoint_http_${Number.isFinite(result.httpStatus) ? result.httpStatus : 'unknown'}`,
        };
      }
      const candidates = parse(result.content);
      return candidates.length > 0
        ? { candidates, reason: null }
        : { candidates: [], reason: `${name}: search_no_results_parsed` };
    } catch (error) {
      return { candidates: [], reason: `${name}: ${error?.code || 'search_failed'}` };
    }
  }

  async function searchRunner(input = {}, context = {}) {
    const query = String(input.query ?? '').trim();
    if (!isNonEmptyString(query)) {
      throw researchError(RESEARCH_PROVIDER_ERROR_CODES.SEARCH_QUERY_REQUIRED, `${RESEARCH_PROVIDER_ERROR_CODES.SEARCH_QUERY_REQUIRED}: query é obrigatória`);
    }
    const classification = classificationOf(context);

    const backends = [
      {
        name: 'duckduckgo',
        url: `${options.searchEndpoint}?q=${encodeURIComponent(query)}`,
        parse: parseSearchResults,
      },
      {
        name: 'bing',
        url: `${options.bingSearchEndpoint}?q=${encodeURIComponent(query)}`,
        parse: parseBingResults,
      },
    ];

    const reasons = [];
    for (const backend of backends) {
      const attempt = await trySearchBackend({ ...backend, classification });
      if (attempt.candidates.length > 0) {
        // HTTP 200 com página alheia à query NÃO é sucesso (medido 2026-09-19).
        const relevance = assessSearchResultRelevance(query, attempt.candidates);
        if (relevance.unrelated) {
          reasons.push(
            `${backend.name}: search_results_unrelated_to_query ` +
            `(0/${relevance.evaluated} casam ${relevance.terms.join('|')})`
          );
          continue;
        }
        return {
          query,
          candidates: attempt.candidates,
          backend: backend.name,
          retrievedAt: isoNow(),
          queryRelevance: { matched: relevance.matched, evaluated: relevance.evaluated, terms: relevance.terms },
        };
      }
      reasons.push(attempt.reason);
    }

    // Os DOIS backends falharam: vazio honesto com o motivo nominal de cada um.
    return { query, candidates: [], reason: reasons.join('; '), retrievedAt: isoNow() };
  }

  // -------------------------------------------------------------------------
  // Verificação de hash (inspeções) — a inspeção só pode operar sobre o
  // conteúdo CUJO HASH viaja junto; divergência é recusa, nunca análise de
  // outro documento.
  // -------------------------------------------------------------------------

  function assertContentHash({ content, contentHash, url }) {
    if (!isNonEmptyString(contentHash)) return null;
    if (typeof content !== 'string') {
      throw researchError(
        RESEARCH_PROVIDER_ERROR_CODES.HASH_MISMATCH,
        `${RESEARCH_PROVIDER_ERROR_CODES.HASH_MISMATCH}: hash declarado sem conteúdo verificável (${url || 'sem url'})`,
        { url: url || null },
      );
    }
    const expected = normalizeSha256(contentHash);
    const actual = sha256Hex(content);
    if (!expected || expected !== actual) {
      throw researchError(
        RESEARCH_PROVIDER_ERROR_CODES.HASH_MISMATCH,
        `${RESEARCH_PROVIDER_ERROR_CODES.HASH_MISMATCH}: declared=${contentHash} actual=sha256:${actual}`,
        { url: url || null, declared: String(contentHash), actual: `sha256:${actual}` },
      );
    }
    return `sha256:${actual}`;
  }

  // -------------------------------------------------------------------------
  // research.inspectDocumentation — PURO e determinístico sobre o conteúdo
  // -------------------------------------------------------------------------

  /**
   * Segmenta o documento pelos headings: cada trecho de corpo pertence ao
   * heading que o antecede (locator `section:<heading>`); o preâmbulo usa
   * locator de linha (`line:<n>`).
   */
  function segmentByHeadings(content) {
    const segments = [];
    const headings = [];
    let cursor = 0;
    let currentHeading = null;
    HEADING_RE.lastIndex = 0;
    let match;
    while ((match = HEADING_RE.exec(content)) !== null) {
      segments.push({ heading: currentHeading, body: content.slice(cursor, match.index) });
      currentHeading = collapseWhitespace(htmlToText(match[2]));
      if (currentHeading) headings.push({ level: Number(match[1]), title: currentHeading });
      cursor = HEADING_RE.lastIndex;
    }
    segments.push({ heading: currentHeading, body: content.slice(cursor) });
    return { segments, headings };
  }

  function extractDocumentation(content, url) {
    const { segments, headings } = segmentByHeadings(content);
    const sections = headings.map((heading) => heading.title);

    const items = { capabilities: [], journeys: [], rules: [] };
    const seen = { capabilities: new Set(), journeys: new Set(), rules: new Set() };
    let lineNumber = 0;

    const consider = (rawLine, locator) => {
      const line = collapseWhitespace(rawLine);
      if (line.length < MIN_LINE_LENGTH || line.length > MAX_LINE_LENGTH) return;
      for (const kind of Object.keys(KIND_PATTERNS)) {
        if (items[kind].length >= options.maxItemsPerKind) continue;
        KIND_PATTERNS[kind].lastIndex = 0;
        if (!KIND_PATTERNS[kind].test(line)) continue;
        const name = line.length > MAX_ITEM_NAME ? `${line.slice(0, MAX_ITEM_NAME).trimEnd()}…` : line;
        const dedupeKey = name.toLowerCase();
        if (seen[kind].has(dedupeKey)) continue;
        seen[kind].add(dedupeKey);
        items[kind].push({
          name,
          description: null,
          locator,
          fragmentHash: `sha256:${sha256Hex(line)}`,
        });
      }
    };

    for (const segment of segments) {
      if (isNonEmptyString(segment.heading)) {
        consider(segment.heading, `section:${segment.heading}`);
      }
      const text = htmlToText(segment.body);
      for (const rawLine of text.split('\n')) {
        lineNumber += 1;
        consider(rawLine, isNonEmptyString(segment.heading)
          ? `section:${segment.heading}`
          : `line:${lineNumber}`);
      }
    }

    return {
      url: url || null,
      sections,
      ...items,
      stats: { headings: headings.length, lines: lineNumber },
    };
  }

  async function inspectDocumentationRunner(input = {}) {
    const content = typeof input.content === 'string' ? input.content : '';
    const verifiedHash = assertContentHash({
      content: typeof input.content === 'string' ? input.content : undefined,
      contentHash: input.contentHash,
      url: input.url,
    });
    const result = extractDocumentation(content, input.url || null);
    return {
      ...result,
      contentHash: verifiedHash || (typeof input.content === 'string' ? `sha256:${sha256Hex(content)}` : null),
    };
  }

  // -------------------------------------------------------------------------
  // research.inspectApiDocs — OpenAPI/Swagger real ou menções; nunca inventa
  // -------------------------------------------------------------------------

  function extractOpenApi(document) {
    const paths = document?.paths && typeof document.paths === 'object' ? document.paths : null;
    if (!paths) return null;
    const operations = [];
    const capabilities = [];
    const seenOperations = new Set();
    const seenCapabilities = new Set();

    for (const [path, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue;
      for (const method of HTTP_METHODS) {
        const operation = pathItem[method];
        if (!operation || typeof operation !== 'object') continue;
        const operationLabel = `${method.toUpperCase()} ${path}`;
        if (seenOperations.has(operationLabel)) continue;
        seenOperations.add(operationLabel);
        operations.push(operationLabel);
        const name = collapseWhitespace(operation.summary || operation.operationId || '');
        if (name && !seenCapabilities.has(name.toLowerCase())
          && capabilities.length < options.maxItemsPerKind) {
          seenCapabilities.add(name.toLowerCase());
          capabilities.push({
            name: name.length > MAX_ITEM_NAME ? `${name.slice(0, MAX_ITEM_NAME).trimEnd()}…` : name,
            description: isNonEmptyString(operation.description)
              ? collapseWhitespace(operation.description).slice(0, MAX_LINE_LENGTH)
              : null,
            locator: `operation:${operationLabel}`,
            fragmentHash: `sha256:${sha256Hex(operationLabel)}`,
          });
        }
        if (operations.length >= options.maxOperations) break;
      }
      if (operations.length >= options.maxOperations) break;
    }

    return { operations, capabilities };
  }

  function extractEndpointMentions(content) {
    const text = htmlToText(content);
    const operations = [];
    const seen = new Set();
    ENDPOINT_MENTION_RE.lastIndex = 0;
    let match;
    while ((match = ENDPOINT_MENTION_RE.exec(text)) !== null) {
      const label = `${match[1]} ${match[2]}`;
      if (seen.has(label)) continue;
      seen.add(label);
      operations.push(label);
      if (operations.length >= options.maxOperations) break;
    }
    const apiDocsLinks = [];
    const linkRe = /<a\b[^>]*href="([^"]*(?:developer|api[-_]?reference|openapi|swagger)[^"]*)"[^>]*>/gi;
    while ((match = linkRe.exec(String(content ?? ''))) !== null) {
      const href = decodeHtmlEntities(match[1]);
      if (!apiDocsLinks.includes(href)) apiDocsLinks.push(href);
      if (apiDocsLinks.length >= 20) break;
    }
    return { operations, apiDocsLinks };
  }

  async function inspectApiDocsRunner(input = {}) {
    const content = typeof input.content === 'string' ? input.content : '';
    const verifiedHash = assertContentHash({
      content: typeof input.content === 'string' ? input.content : undefined,
      contentHash: input.contentHash,
      url: input.url,
    });
    const base = {
      url: input.url || null,
      contentHash: verifiedHash || (typeof input.content === 'string' ? `sha256:${sha256Hex(content)}` : null),
      journeys: [],
      rules: [],
    };

    const trimmed = content.trim();
    if (trimmed.startsWith('{')) {
      try {
        const document = JSON.parse(trimmed);
        if (document && (document.openapi || document.swagger)) {
          const extracted = extractOpenApi(document) || { operations: [], capabilities: [] };
          return {
            ...base,
            format: 'openapi',
            specVersion: String(document.openapi || document.swagger),
            ...extracted,
          };
        }
      } catch (_) {
        // JSON malformado: cai na detecção de menções — nunca inventa contrato.
      }
    }

    const mentions = extractEndpointMentions(content);
    if (mentions.operations.length === 0 && mentions.apiDocsLinks.length === 0) {
      return {
        ...base,
        format: null,
        status: 'NOT_APPLICABLE',
        reason: 'no_api_surface_detected',
        operations: [],
        capabilities: [],
        apiDocsLinks: [],
      };
    }
    return {
      ...base,
      format: 'html-endpoint-mentions',
      operations: mentions.operations,
      capabilities: [],
      apiDocsLinks: mentions.apiDocsLinks,
    };
  }

  // -------------------------------------------------------------------------
  // research.captureEvidence — valida + normaliza; persistir é do chamador
  // -------------------------------------------------------------------------

  async function captureEvidenceRunner(input = {}) {
    const url = String(input.url ?? input.documentRef ?? '').trim();
    if (!isNonEmptyString(url)) {
      throw researchError(RESEARCH_PROVIDER_ERROR_CODES.EVIDENCE_INVALID, `${RESEARCH_PROVIDER_ERROR_CODES.EVIDENCE_INVALID}: url é obrigatória`);
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      throw researchError(RESEARCH_PROVIDER_ERROR_CODES.EVIDENCE_INVALID, `${RESEARCH_PROVIDER_ERROR_CODES.EVIDENCE_INVALID}: url inválida (${url})`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw researchError(RESEARCH_PROVIDER_ERROR_CODES.EVIDENCE_INVALID, `${RESEARCH_PROVIDER_ERROR_CODES.EVIDENCE_INVALID}: protocolo não suportado (${parsed.protocol})`);
    }

    const hashHex = normalizeSha256(input.contentHash);
    if (!hashHex) {
      throw researchError(RESEARCH_PROVIDER_ERROR_CODES.EVIDENCE_INVALID, `${RESEARCH_PROVIDER_ERROR_CODES.EVIDENCE_INVALID}: contentHash sha256 é obrigatório`);
    }
    const contentHash = `sha256:${hashHex}`;
    // Referência DETERMINÍSTICA: a mesma (url, hash) sempre produz a mesma
    // evidência — re-capturas idempotentes, divergência impossível de esconder.
    const evidenceRef = `ev-${sha256Hex(`${url}\u0000${contentHash}`).slice(0, 40)}`;

    return {
      evidenceRef,
      url,
      documentRef: isNonEmptyString(input.documentRef) ? String(input.documentRef) : url,
      contentHash,
      contentType: isNonEmptyString(input.contentType) ? String(input.contentType) : null,
      capturedAt: isoNow(),
    };
  }

  log.debug?.('[research] provider nativo de pesquisa inicializado', {
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes,
    maxRedirects: options.maxRedirects,
  });

  return Object.freeze({
    search: searchRunner,
    fetch: fetchRunner,
    inspectDocumentation: inspectDocumentationRunner,
    inspectApiDocs: inspectApiDocsRunner,
    captureEvidence: captureEvidenceRunner,
  });
}

module.exports = {
  RESEARCH_PROVIDER_ERROR_CODES,
  assessSearchResultRelevance,
  createNativeResearchProvider,
};
