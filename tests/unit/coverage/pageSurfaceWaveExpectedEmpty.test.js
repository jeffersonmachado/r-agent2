'use strict';

/**
 * Regressão — 404 de estado vazio não é erro de console para a page-surface wave.
 *
 * Falha observada (2026-08-01, run 30706220341 do wave-reports no CI): as
 * páginas /qa-mesh, /pbx/extensions e /pbx/governance falharam a assertiva
 * pageLoads com consoleErrors > 0. Parte do ruído era o logger do frontend
 * (corrigido com expectedStatuses nos callers); o restante eram mensagens
 * "Failed to load resource" geradas pelo PRÓPRIO BROWSER para respostas 404
 * que são estado vazio legítimo por contrato da API:
 *   - GET /qa-mesh/latest → 404 "Nenhuma execução disponível";
 *   - GET /api/pbx/provisioning-token → 404 "Tenant PBX não encontrado".
 * Mensagem de browser não pode ser suprimida por JS — cabe à wave
 * classificá-la como ruído de estado vazio esperado (com allowlist
 * auditável), não como quebra da página.
 *
 * Comportamento correto esperado (classifyPageConsoleError):
 * 1. "Failed to load resource" cuja URL teve resposta 404 e está na
 *    allowlist de empty-state → 'expected-empty' (não conta como erro).
 * 2. O mesmo texto em URL fora da allowlist → 'error'.
 * 3. Falha de recurso com status >= 500 (mesmo na allowlist) → 'error'.
 * 4. Qualquer outro console.error (ex.: logger da app, exceções) → 'error'.
 */

const {
  classifyPageConsoleError,
  EXPECTED_EMPTY_STATE_ENDPOINTS,
} = require('../../../qa/coverage/pageSurfaceWave');

describe('pageSurfaceWave — classifyPageConsoleError (ruído de estado vazio)', () => {
  test('allowlist declara os dois endpoints com justificativa', () => {
    expect(EXPECTED_EMPTY_STATE_ENDPOINTS['/qa-mesh/latest']).toBeTruthy();
    expect(EXPECTED_EMPTY_STATE_ENDPOINTS['/api/pbx/provisioning-token']).toBeTruthy();
  });

  test('resource 404 em endpoint de empty-state → expected-empty', () => {
    const result = classifyPageConsoleError({
      text: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
      url: 'http://localhost:5173/qa-mesh/latest',
      failedResources: [{ url: 'http://localhost:5173/qa-mesh/latest', status: 404 }],
    });
    expect(result).toBe('expected-empty');
  });

  test('resource 404 fora da allowlist → error', () => {
    const result = classifyPageConsoleError({
      text: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
      url: 'http://localhost:5173/api/widgets/123',
      failedResources: [{ url: 'http://localhost:5173/api/widgets/123', status: 404 }],
    });
    expect(result).toBe('error');
  });

  test('resource 500 mesmo em endpoint de empty-state → error', () => {
    const result = classifyPageConsoleError({
      text: 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
      url: 'http://localhost:5173/qa-mesh/latest',
      failedResources: [{ url: 'http://localhost:5173/qa-mesh/latest', status: 500 }],
    });
    expect(result).toBe('error');
  });

  test('resource 404 na allowlist mas sem resposta 404 correspondente → error', () => {
    // Se a URL consta na allowlist mas a resposta não foi 404 (ex.: falha de
    // rede sem response), não há evidência de empty-state — permanece erro.
    const result = classifyPageConsoleError({
      text: 'Failed to load resource: net::ERR_CONNECTION_REFUSED',
      url: 'http://localhost:5173/qa-mesh/latest',
      failedResources: [],
    });
    expect(result).toBe('error');
  });

  test('console.error comum (logger da app) → error', () => {
    const result = classifyPageConsoleError({
      text: '[2026-08-01T00:00:00Z] [ERROR] HTTP Error 404 {...}',
      url: 'http://localhost:5173/src/utils/logger.js',
      failedResources: [],
    });
    expect(result).toBe('error');
  });
});
