'use strict';

/**
 * Atribuição de eventos de rede à rota correta no `validate:runtime`.
 *
 * O validador navega com `page.goto` (reload completo) e fatia os eventos por
 * tempo. Requisições iniciadas pelo documento ANTERIOR que ainda estavam em voo
 * são abortadas pelo browser (net::ERR_ABORTED) já dentro da janela da rota
 * alvo e, por isso, eram contadas como falha da rota alvo — falso positivo.
 *
 * A regra aqui é por documento, não por fatia de tempo: um ERR_ABORTED cuja
 * requisição começou ANTES da navegação da rota alvo pertence ao documento
 * anterior e não é falha da rota alvo. Qualquer outra falha (recusa de conexão,
 * ERR_FAILED, timeout) continua contada, inclusive aborts cuja requisição
 * começou já dentro do documento alvo.
 */

/**
 * @param {number} requestStartedAt epoch ms em que a requisição foi iniciada
 * @param {number} routeNavigationStartedAt epoch ms em que a navegação da rota alvo começou
 * @returns {boolean}
 */
function belongsToPreviousDocument(requestStartedAt, routeNavigationStartedAt) {
  if (!Number.isFinite(requestStartedAt) || requestStartedAt <= 0) return false;
  if (!Number.isFinite(routeNavigationStartedAt) || routeNavigationStartedAt <= 0) return false;
  return requestStartedAt < routeNavigationStartedAt;
}

/**
 * @param {{ failureText?: string, requestStartedAt?: number, routeNavigationStartedAt?: number }} params
 * @returns {boolean} true quando a falha deve ser ignorada por pertencer ao documento anterior
 */
function shouldIgnoreRequestFailure({
  failureText,
  requestStartedAt,
  routeNavigationStartedAt,
} = {}) {
  if (!/ERR_ABORTED/i.test(String(failureText || ''))) {
    return false;
  }

  return belongsToPreviousDocument(requestStartedAt, routeNavigationStartedAt);
}

module.exports = {
  belongsToPreviousDocument,
  shouldIgnoreRequestFailure,
};
