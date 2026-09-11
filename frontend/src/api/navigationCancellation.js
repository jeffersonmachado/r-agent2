'use strict';

/**
 * Cancelamento por navegação (pagehide / beforeunload).
 *
 * Quando o documento é descartado — navegação full-page, fechamento de aba,
 * reload — o browser aborta silenciosamente as requisições em voo
 * (`net::ERR_ABORTED`) e o `fetch` rejeita com "Failed to fetch". Isso é
 * cancelamento intencional, não indisponibilidade da API: o cliente HTTP não
 * deve classificar como falha, não deve emitir `console.error` e não deve
 * entregar erro ao chamador (a tela que o originou já está sendo destruída).
 *
 * Este módulo centraliza a única fonte de verdade sobre "estamos saindo da
 * página" para que a classificação de erro do cliente HTTP não dependa de
 * heurística por URL.
 */

export const NAVIGATION_CANCEL_REASON = 'navigation-cancelled';

const NAVIGATION_CANCEL_MESSAGE =
  'Requisição cancelada: o documento está sendo descartado (navegação).';

let navigatingAway = false;

const abortHandlers = new Set();

/**
 * @returns {boolean} true quando o documento está sendo descartado.
 */
export function isNavigatingAway() {
  return navigatingAway;
}

function tagNavigationCancellation(reason) {
  try {
    // DOMException é extensível no browser; em ambientes sem DOMException o
    // fallback é um Error comum.
    reason.isNavigationCancellation = true;
  } catch {
    // Reason não extensível: a detecção continua funcionando via isNavigatingAway().
  }
  return reason;
}

/**
 * Marcador (motivo de abort) que identifica cancelamento por navegação,
 * distinguindo-o do abort por timeout (`Request timed out after ...`).
 *
 * @returns {Error|DOMException}
 */
export function createNavigationCancelReason() {
  const reason = (() => {
    try {
      // eslint-disable-next-line no-undef
      return new DOMException(NAVIGATION_CANCEL_MESSAGE, 'AbortError');
    } catch {
      const error = new Error(NAVIGATION_CANCEL_MESSAGE);
      error.name = 'AbortError';
      return error;
    }
  })();

  return tagNavigationCancellation(reason);
}

/**
 * @param {unknown} reason
 * @returns {boolean}
 */
export function isNavigationCancellationReason(reason) {
  return Boolean(reason && reason.isNavigationCancellation === true);
}

/**
 * Registra um handler chamado quando a navegação começa, para que os recursos
 * em voo sejam abortados explicitamente (determinístico) em vez de depender do
 * abort implícito do browser.
 *
 * @param {() => void} handler
 * @returns {() => void} unsubscribe
 */
export function registerNavigationAbortHandler(handler) {
  if (typeof handler !== 'function') return () => {};
  abortHandlers.add(handler);
  return () => abortHandlers.delete(handler);
}

/**
 * Marca o início do descarte do documento e aborta o que estiver em voo.
 */
export function markNavigatingAway() {
  if (navigatingAway) return;
  navigatingAway = true;

  for (const handler of Array.from(abortHandlers)) {
    try {
      handler();
    } catch {
      // Um handler com falha não pode impedir o descarte do documento.
    }
  }
}

/**
 * Volta ao estado normal (uso em bfcache e em testes).
 */
export function resetNavigatingAway() {
  navigatingAway = false;
}

/**
 * Instala as guardas de ciclo de vida do documento.
 *
 * @param {Window|EventTarget|null} [target]
 * @returns {boolean} true quando as guardas foram instaladas nesta chamada.
 */
export function installNavigationCancellationGuards(target) {
  const resolvedTarget =
    target !== undefined
      ? target
      : typeof window !== 'undefined'
        ? window
        : null;

  if (!resolvedTarget || typeof resolvedTarget.addEventListener !== 'function') {
    return false;
  }

  if (resolvedTarget.__navigationCancellationGuardsInstalled) {
    return false;
  }

  resolvedTarget.__navigationCancellationGuardsInstalled = true;

  // pagehide é disparado sempre que o documento é descartado (navegação
  // full-page, reload, fechamento de aba, entrada em bfcache) e não é
  // cancelável. beforeunload NÃO é usado de propósito: ele é cancelável
  // ("sair do site?"), e marcar navegação ali silenciaria falhas de rede reais
  // caso o usuário cancelasse a saída.
  resolvedTarget.addEventListener('pagehide', () => markNavigatingAway());
  resolvedTarget.addEventListener('pageshow', (event) => {
    // Retorno do bfcache: o documento continua vivo, então volta ao normal.
    if (event && event.persisted) resetNavigatingAway();
  });

  return true;
}
