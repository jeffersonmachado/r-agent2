'use strict';

/**
 * relevance — GATE DE PERTENCIMENTO AO MERCADO para candidatos descobertos
 * pela varredura (market discovery).
 *
 * Por que existe (2026-09-15): a aceitação de candidato exigia apenas
 * "página obtida" (fetch com hash) — existência ≠ pertencimento ao mercado.
 * A varredura real da vertical fitness aceitou Wikipedia, lojas de roupa e
 * páginas de ajuda do Google como "candidatos a fornecedor de software de
 * gestão de academias". Dois defeitos combinados:
 *
 *   1. IDENTIDADE baseada no TÍTULO da página: o mesmo fornecedor aparecia
 *      como vários candidatos (títulos diferentes por página) e um título
 *      qualquer virava identidade estável. A identidade de um candidato de
 *      mercado é o DOMÍNIO REGISTRÁVEL do site oficial.
 *   2. RELEVÂNCIA não medida: nenhum sinal ligava o conteúdo da página à
 *      CATEGORIA de mercado declarada pela vertical (`marketContext`).
 *
 * Regras:
 *  - CONFIG-DRIVEN: os termos de categoria, o mínimo de sinais e os hosts
 *    excluídos vêm de `marketContext` do sample da vertical — este módulo
 *    nunca nomeia fornecedor nem vertical;
 *  - DETERMINÍSTICO e PURO (zero I/O): mesmo conteúdo + mesmo contexto →
 *    mesmo veredito;
 *  - FAIL-HONESTO: sem `marketContext` declarado o veredito é NOT_EVALUABLE
 *    (o chamador decide; para seeds e verticais sem contexto a aceitação
 *    permanece evidence-based). Nunca NOT_EVALUABLE disfarçado de IN_MARKET;
 *  - um candidato OUT_OF_MARKET carrega o motivo nominal (sinais insuficientes
 *    ou host excluído) — rejeição é fato auditável, não silêncio.
 */

const { normalizeTerm, tokenize } = require('../benchmark/benchmarkResearchSemantics');

const RELEVANCE_STATES = Object.freeze({
  /** Conteúdo liga o candidato à categoria de mercado declarada. */
  IN_MARKET: 'IN_MARKET',
  /** Conteúdo obtido NÃO pertence à categoria de mercado declarada. */
  OUT_OF_MARKET: 'OUT_OF_MARKET',
  /** A vertical não declarou marketContext: relevância não é mensurável. */
  NOT_EVALUABLE: 'NOT_EVALUABLE',
});

/** Stopwords pt-BR/en removidas antes de medir o casamento de um termo. */
const STOPWORDS = Object.freeze([
  'a', 'o', 'e', 'de', 'da', 'do', 'em', 'no', 'na', 'um', 'uma', 'para', 'com',
  'the', 'and', 'for', 'of', 'in', 'on', 'to', 'with',
]);

const DEFAULT_MIN_CATEGORY_SIGNALS = 1;

/**
 * Janela LOCAL do casamento de sinais (2026-09-16, falso positivo do run r4):
 * o casamento bag-of-words aceitava páginas que continham os tokens do termo
 * ESPALHADOS em seções sem relação (um relatório imobiliário com "gym",
 * "management" e "software" em parágrafos distintos virou "fornecedor de gym
 * management software"). Quem É do mercado declara a categoria junto, numa
 * mesma frase/redação natural ("Sistema completo para gestão de academias");
 * quem só cita palavras soltas em contextos diferentes não é. O termo casa
 * quando TODOS os seus tokens significativos ocorrem dentro de UMA janela de
 * `SIGNAL_WINDOW_TOKENS` tokens do conteúdo — determinístico, sem NLP.
 */
const SIGNAL_WINDOW_TOKENS = 8;

/**
 * Sufixos públicos compostos conhecidos (heurística determinística, não PSL
 * completa): quando o sufixo registrável é composto (`com.br`), o domínio
 * registrável tem TRÊS labels.
 */
const COMPOUND_SUFFIXES = Object.freeze(new Set([
  'com.br', 'org.br', 'net.br', 'gov.br', 'edu.br', 'adm.br', 'adv.br',
  'com.au', 'co.uk', 'org.uk', 'com.mx', 'com.ar', 'com.co', 'com.pt',
]));

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Domínio registrável de uma URL/host (caixa baixa, sem `www.`).
 * `app.tecnofit.com.br` → `tecnofit.com.br`; `wl.vendor.com` → `vendor.com`.
 * Retorna null quando a entrada não é URL/host parseável.
 */
function registrableDomain(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  let hostname = null;
  try {
    hostname = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch (_) {
    return null;
  }
  if (!hostname || !hostname.includes('.')) return null;
  const labels = hostname.replace(/^www\./, '').split('.').filter(Boolean);
  if (labels.length < 2) return null;
  const lastTwo = labels.slice(-2).join('.');
  if (labels.length >= 3 && COMPOUND_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join('.');
  }
  return lastTwo;
}

/**
 * Sinais de categoria presentes no conteúdo: para CADA termo declarado em
 * `marketContext.categoryTerms`, o termo é um sinal quando TODOS os seus
 * tokens significativos (sem stopwords) aparecem dentro de UMA JANELA LOCAL
 * de `SIGNAL_WINDOW_TOKENS` tokens do conteúdo (ver constante: tokens
 * espalhados pela página não são evidência de pertencimento).
 *
 * @returns {{matchedTerms: string[], signalCount: number}}
 */
function termMatchesWithinWindow(contentTokens, termTokens) {
  const windowSize = Math.max(SIGNAL_WINDOW_TOKENS, termTokens.length);
  if (contentTokens.length < termTokens.length) return false;
  for (let start = 0; start <= contentTokens.length - termTokens.length; start += 1) {
    const window = new Set(contentTokens.slice(start, start + windowSize));
    if (termTokens.every((token) => window.has(token))) return true;
  }
  return false;
}

function matchCategorySignals({ content, categoryTerms } = {}) {
  const contentTokens = tokenize(content);
  const matchedTerms = [];
  for (const term of list(categoryTerms)) {
    const tokens = tokenize(term).filter((token) => !STOPWORDS.includes(token));
    if (tokens.length === 0) continue;
    if (termMatchesWithinWindow(contentTokens, tokens)) {
      matchedTerms.push(normalizeTerm(term));
    }
  }
  return { matchedTerms, signalCount: matchedTerms.length };
}

/**
 * Veredito de pertencimento ao mercado de UM candidato descoberto.
 *
 * @param {object} args
 * @param {string} [args.content]        conteúdo da página obtida (fetch real)
 * @param {string} [args.url]            URL obtida (para host excluído e identidade)
 * @param {object} [args.marketContext]  `marketContext` do sample da vertical
 * @returns {{evaluated: boolean, state: string, accepted: boolean, reason: string,
 *            signalCount: number, minSignals: number|null, matchedTerms: string[],
 *            domain: string|null}}
 */
function evaluateMarketRelevance({ content, url, marketContext } = {}) {
  const context = marketContext && typeof marketContext === 'object' ? marketContext : null;
  const relevance = context?.relevance && typeof context.relevance === 'object' ? context.relevance : {};
  const domain = registrableDomain(url);

  const categoryTerms = list(context?.categoryTerms).filter(isNonEmptyString);
  if (!context || categoryTerms.length === 0) {
    return {
      evaluated: false,
      state: RELEVANCE_STATES.NOT_EVALUABLE,
      accepted: true, // não medido não bloqueia: a evidência continua mandando
      reason: 'market_context_not_declared',
      signalCount: 0,
      minSignals: null,
      matchedTerms: [],
      domain,
    };
  }

  const minSignals = Math.max(
    1,
    Number(relevance.minCategorySignals ?? relevance.minimumCategorySignals) || DEFAULT_MIN_CATEGORY_SIGNALS,
  );

  // Host excluído declarado pela vertical (enciclopédia, help center de
  // plataforma etc.): nunca é membro do mercado, mesmo que o conteúdo cite a
  // categoria. Comparado por DOMÍNIO REGISTRÁVEL (subdomínios herdam).
  const excludedHosts = list(relevance.excludedHosts)
    .map((host) => registrableDomain(host))
    .filter(Boolean);
  if (domain && excludedHosts.includes(domain)) {
    return {
      evaluated: true,
      state: RELEVANCE_STATES.OUT_OF_MARKET,
      accepted: false,
      reason: 'candidate_host_excluded',
      signalCount: 0,
      minSignals,
      matchedTerms: [],
      domain,
    };
  }

  const { matchedTerms, signalCount } = matchCategorySignals({ content, categoryTerms });
  if (signalCount < minSignals) {
    return {
      evaluated: true,
      state: RELEVANCE_STATES.OUT_OF_MARKET,
      accepted: false,
      reason: 'category_signals_below_minimum',
      signalCount,
      minSignals,
      matchedTerms,
      domain,
    };
  }

  return {
    evaluated: true,
    state: RELEVANCE_STATES.IN_MARKET,
    accepted: true,
    reason: 'category_signals_present',
    signalCount,
    minSignals,
    matchedTerms,
    domain,
  };
}

/**
 * URL da HOMEPAGE do domínio registrável de uma URL qualquer
 * (`https://woliba.io/blog/x/` → `https://woliba.io/`). O esquema da entrada
 * é preservado; sem domínio registrável, null.
 *
 * Por que existe (run real r8, 2026-09-16): o candidato herdava como
 * `officialSite` a URL da PÁGINA DE SINAL (blog listicle do próprio
 * fornecedor). O site oficial de um fornecedor é a raiz do domínio — a página
 * de sinal é evidência de DESCOBERTA, nunca identidade.
 */
function homepageUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const domain = registrableDomain(raw);
  if (!domain) return null;
  let protocol = 'https:';
  try {
    protocol = new URL(raw.includes('://') ? raw : `https://${raw}`).protocol || 'https:';
  } catch (_) {
    return null;
  }
  if (protocol !== 'http:' && protocol !== 'https:') return null;
  return `${protocol}//${domain}/`;
}

/** Separadores comuns entre a MARCA e o restante do <title> da homepage. */
const TITLE_SEGMENT_SEPARATOR = /\s*[:|–—·•]\s+|\s+-\s+/;

/**
 * Nome do fornecedor extraído do `<title>` da homepage: o primeiro segmento
 * antes do separador típico ("Vantage Fit: Employee Wellness Platform" →
 * "Vantage Fit"). Determinístico, extraído do documento do PRÓPRIO fornecedor
 * — nunca inventado. Sem título utilizável, null (o chamador decide o
 * fallback; o título de um listicle/blog NÃO é nome de fornecedor).
 */
function vendorNameFromHomepageTitle(html) {
  const content = String(html ?? '');
  if (!content) return null;
  const match = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  const title = match[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  if (!title) return null;
  const segment = title.split(TITLE_SEGMENT_SEPARATOR)[0].trim();
  return segment.length > 0 ? segment : null;
}

/**
 * Fallback determinístico de nome: o primeiro rótulo do domínio registrável
 * com inicial maiúscula (`vantagefit.io` → `Vantagefit`). É um rótulo
 * DERIVADO do identificador, não uma marca inventada.
 */
function nameFromDomain(domain) {
  const normalized = registrableDomain(domain);
  if (!normalized) return null;
  const label = normalized.split('.')[0];
  if (!label) return null;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Arquétipos de mercado do candidato a partir dos sinais de categoria
 * casados: `marketContext.categoryTermArchetypes` (declarado pela vertical)
 * mapeia cada termo aos arquétipos do sample que ele evidencia. Termo sem
 * mapeamento não inventa arquétipo; a união é ordenada para determinismo.
 */
function archetypesFromMatchedTerms(matchedTerms, categoryTermArchetypes) {
  const mapping = categoryTermArchetypes && typeof categoryTermArchetypes === 'object'
    ? categoryTermArchetypes
    : {};
  const found = new Set();
  for (const term of list(matchedTerms)) {
    const mapped = mapping[normalizeTerm(term)] || mapping[String(term ?? '').trim()];
    for (const id of list(mapped)) {
      const key = String(id ?? '').trim();
      if (key) found.add(key);
    }
  }
  return [...found].sort();
}

module.exports = {
  RELEVANCE_STATES,
  STOPWORDS,
  DEFAULT_MIN_CATEGORY_SIGNALS,
  SIGNAL_WINDOW_TOKENS,
  COMPOUND_SUFFIXES,
  registrableDomain,
  matchCategorySignals,
  evaluateMarketRelevance,
  homepageUrl,
  vendorNameFromHomepageTitle,
  nameFromDomain,
  archetypesFromMatchedTerms,
};
