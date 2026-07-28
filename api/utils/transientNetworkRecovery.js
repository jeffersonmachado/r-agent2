'use strict';

/**
 * Filtro de recuperação de rede transitória para validação de páginas RPA.
 *
 * Princípio: uma requisição que falhou (request_failed) e cuja MESMA URL
 * respondeu com sucesso (< 400) depois é um blip transitório que a aplicação
 * tratou com retry — evidência de resiliência, não defeito da página. Uma
 * falha sem sucesso posterior continua crítica (API realmente fora).
 *
 * Os erros de console com assinatura transitória da própria aplicação
 * ("Failed to fetch", "API temporariamente indisponível", "API não acessível")
 * são consequência direta desses blips: só são suprimidos quando houve pelo
 * menos uma falha recuperada na mesma execução. Erros funcionais e exceções
 * JS (page_error) nunca são descartados.
 */

const TRANSIENT_CONSOLE_PATTERNS = [
  /failed to fetch/i,
  /api temporariamente indispon[íi]vel/i,
  /api n[ãa]o acess[íi]vel/i,
  /err_network_changed/i,
  /err_connection_refused/i,
];

function eventTimeMs(entry) {
  const value = entry && entry.timestamp;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {Array<object>} networkEvents Eventos de rede da página
 *   (type 'request_failed' | 'response', url, status, timestamp).
 * @returns {Set<string>} URLs que falharam e depois responderam < 400.
 */
function computeRecoveredFailedUrls(networkEvents = []) {
  const successesByUrl = new Map();
  for (const event of networkEvents) {
    if (!event || event.type !== 'response') continue;
    const status = Number(event.status || 0);
    if (status <= 0 || status >= 400) continue;
    const at = eventTimeMs(event);
    if (at === null) continue;
    const url = String(event.url || '');
    if (!url) continue;
    if (!successesByUrl.has(url)) successesByUrl.set(url, []);
    successesByUrl.get(url).push(at);
  }

  const recovered = new Set();
  for (const event of networkEvents) {
    if (!event || event.type !== 'request_failed') continue;
    const failedAt = eventTimeMs(event);
    const url = String(event.url || '');
    if (failedAt === null || !url) continue;
    const successes = successesByUrl.get(url) || [];
    if (successes.some((at) => at > failedAt)) recovered.add(url);
  }
  return recovered;
}

/**
 * Separa erros de página em críticos (relevant) e blips recuperados
 * (recoveredTransient). Somente entradas request_failed com URL recuperada
 * saem da lista crítica.
 */
function partitionPageErrors(pageErrors = [], recoveredUrls = new Set()) {
  const relevant = [];
  const recoveredTransient = [];
  for (const entry of pageErrors || []) {
    if (
      entry
      && String(entry.type || '').toLowerCase() === 'request_failed'
      && recoveredUrls.has(String(entry.url || ''))
    ) {
      recoveredTransient.push(entry);
    } else {
      relevant.push(entry);
    }
  }
  return { relevant, recoveredTransient };
}

/**
 * Separa erros de console críticos de assinaturas transitórias. Assinaturas
 * transitórias só são suprimidas quando hasRecoveredTransient é true (houve
 * blip de rede recuperado na mesma execução).
 */
function partitionConsoleErrors(consoleErrors = [], hasRecoveredTransient = false) {
  const relevant = [];
  const suppressed = [];
  for (const entry of consoleErrors || []) {
    const text = String(entry && (entry.text || entry.message) || '');
    const isTransientSignature = TRANSIENT_CONSOLE_PATTERNS.some((pattern) => pattern.test(text));
    if (isTransientSignature && hasRecoveredTransient) {
      suppressed.push(entry);
    } else {
      relevant.push(entry);
    }
  }
  return { relevant, suppressed };
}

/**
 * Cria um rastreador de recuperação imune a caps de arrays de eventos
 * (o buffer principal de rede do executor descarta eventos antigos em
 * execuções longas — os request_failed cedo + respostas tardias somem).
 * Mantém falhas em buffer próprio (cap generoso) e o último sucesso por URL
 * em Map sem cap.
 */
function createNetworkRecoveryTracker({ maxFailed = 500 } = {}) {
  const failedRequests = [];
  const lastSuccessByUrl = new Map();
  return {
    onResponse(event) {
      const status = Number(event && event.status || 0);
      if (status <= 0 || status >= 400) return;
      const url = String(event.url || '');
      if (!url) return;
      lastSuccessByUrl.set(url, Date.now());
    },
    onRequestFailed(event) {
      failedRequests.push({
        timestamp: Date.now(),
        type: 'request_failed',
        method: event && event.method,
        url: String((event && event.url) || ''),
        failure: (event && event.failure) || null,
      });
      if (failedRequests.length > maxFailed) failedRequests.shift();
    },
    recoveredUrls() {
      const syntheticResponses = [...lastSuccessByUrl.entries()].map(([url, timestamp]) => ({
        type: 'response',
        url,
        status: 200,
        timestamp,
      }));
      return computeRecoveredFailedUrls([...failedRequests, ...syntheticResponses]);
    },
    failedCount() {
      return failedRequests.length;
    },
  };
}

module.exports = {
  TRANSIENT_CONSOLE_PATTERNS,
  computeRecoveredFailedUrls,
  partitionPageErrors,
  partitionConsoleErrors,
  createNetworkRecoveryTracker,
};
