'use strict';

const {
  belongsToPreviousDocument,
  shouldIgnoreRequestFailure,
} = require('../../scripts/governance/lib/route-event-attribution');

/**
 * Contexto: `validate:runtime` navega com `page.goto` (reload completo) e fatia
 * eventos por tempo. Requisições do documento anterior abortadas pelo browser
 * caíam na fatia da rota alvo e reprovavam o gate (`route_network_failures`).
 * A regra passa a ser por documento.
 */
describe('route-event-attribution - atribuição por documento', () => {
  const navStartedAt = 1_000_000;

  describe('belongsToPreviousDocument', () => {
    it('é true quando a requisição começou antes da navegação da rota alvo', () => {
      expect(belongsToPreviousDocument(navStartedAt - 1, navStartedAt)).toBe(true);
    });

    it('é false quando a requisição começou depois da navegação (documento alvo)', () => {
      expect(belongsToPreviousDocument(navStartedAt + 1, navStartedAt)).toBe(false);
    });

    it('é false no mesmo instante da navegação (fail-closed: continua contado)', () => {
      expect(belongsToPreviousDocument(navStartedAt, navStartedAt)).toBe(false);
    });

    it('é false sem timestamps conhecidos', () => {
      expect(belongsToPreviousDocument(undefined, navStartedAt)).toBe(false);
      expect(belongsToPreviousDocument(navStartedAt - 1, undefined)).toBe(false);
      expect(belongsToPreviousDocument(0, 0)).toBe(false);
      expect(belongsToPreviousDocument(NaN, navStartedAt)).toBe(false);
    });
  });

  describe('shouldIgnoreRequestFailure', () => {
    it('ignora ERR_ABORTED do documento anterior (ruído de navegação)', () => {
      expect(
        shouldIgnoreRequestFailure({
          failureText: 'net::ERR_ABORTED',
          requestStartedAt: navStartedAt - 500,
          routeNavigationStartedAt: navStartedAt,
        }),
      ).toBe(true);
    });

    it('não ignora ERR_ABORTED iniciado dentro do documento alvo', () => {
      expect(
        shouldIgnoreRequestFailure({
          failureText: 'net::ERR_ABORTED',
          requestStartedAt: navStartedAt + 500,
          routeNavigationStartedAt: navStartedAt,
        }),
      ).toBe(false);
    });

    it('não ignora falhas que não são abort (recusa de conexão, erro de rede)', () => {
      for (const failureText of [
        'net::ERR_CONNECTION_REFUSED',
        'net::ERR_FAILED',
        'net::ERR_EMPTY_RESPONSE',
        'net::ERR_NAME_NOT_RESOLVED',
      ]) {
        expect(
          shouldIgnoreRequestFailure({
            failureText,
            requestStartedAt: navStartedAt - 500,
            routeNavigationStartedAt: navStartedAt,
          }),
        ).toBe(false);
      }
    });

    it('não ignora nada sem contexto (fail-closed)', () => {
      expect(shouldIgnoreRequestFailure()).toBe(false);
      expect(shouldIgnoreRequestFailure({ failureText: 'net::ERR_ABORTED' })).toBe(false);
      expect(
        shouldIgnoreRequestFailure({ failureText: undefined, requestStartedAt: 1, routeNavigationStartedAt: 2 }),
      ).toBe(false);
    });
  });
});
