'use strict';

/**
 * Regressão: falha de rede transitória RECUPERADA não pode derrubar uma
 * execução RPA de tela.
 *
 * Falha observada (QA Mesh 2026-07-27, execução mesh-2026-07-27T19-25-46):
 * os 6 cenários fitness-matricula-* falharam com "N erro(s) críticos
 * detectados na página" (request_failed + toast "API temporariamente
 * indisponível") numa janela de contenção de máquina. Os logs do proxy do
 * Vite provam que as MESMAS URLs responderam 200 segundos depois — a página
 * recuperou via retry transparente. Tratar blip recuperado como erro crítico
 * é falso positivo; falha NÃO recuperada (API realmente fora) deve continuar
 * reprovando a execução.
 */

const {
  computeRecoveredFailedUrls,
  partitionPageErrors,
  partitionConsoleErrors,
  createNetworkRecoveryTracker,
} = require('../../api/utils/transientNetworkRecovery');

const URL_SCENARIOS = 'http://localhost:5173/api/qa-waves/scenarios';
const URL_EXECUTIONS = 'http://localhost:5173/api/qa-waves/executions?limit=50';

describe('computeRecoveredFailedUrls', () => {
  test('URL que falhou e depois respondeu com sucesso conta como recuperada', () => {
    const events = [
      { type: 'request_failed', url: URL_SCENARIOS, timestamp: 1000 },
      { type: 'response', url: URL_SCENARIOS, status: 200, timestamp: 3000 },
    ];
    const recovered = computeRecoveredFailedUrls(events);
    expect(recovered.has(URL_SCENARIOS)).toBe(true);
  });

  test('falha sem sucesso posterior NÃO é recuperada', () => {
    const events = [
      { type: 'request_failed', url: URL_SCENARIOS, timestamp: 1000 },
      { type: 'response', url: URL_SCENARIOS, status: 200, timestamp: 500 }, // antes da falha
      { type: 'request_failed', url: URL_EXECUTIONS, timestamp: 2000 },
    ];
    const recovered = computeRecoveredFailedUrls(events);
    expect(recovered.has(URL_SCENARIOS)).toBe(false);
    expect(recovered.has(URL_EXECUTIONS)).toBe(false);
  });

  test('resposta 5xx posterior não conta como recuperação', () => {
    const events = [
      { type: 'request_failed', url: URL_SCENARIOS, timestamp: 1000 },
      { type: 'response', url: URL_SCENARIOS, status: 500, timestamp: 3000 },
    ];
    expect(computeRecoveredFailedUrls(events).has(URL_SCENARIOS)).toBe(false);
  });
});

describe('partitionPageErrors', () => {
  test('request_failed recuperado sai da lista crítica e vira evidência', () => {
    const pageErrors = [
      { type: 'request_failed', url: URL_SCENARIOS, method: 'GET', timestamp: '2026-07-27T20:17:19.088Z' },
      { type: 'request_failed', url: URL_EXECUTIONS, method: 'GET', timestamp: '2026-07-27T20:17:21.498Z' },
    ];
    const recovered = new Set([URL_SCENARIOS]);
    const { relevant, recoveredTransient } = partitionPageErrors(pageErrors, recovered);
    expect(relevant).toHaveLength(1);
    expect(relevant[0].url).toBe(URL_EXECUTIONS);
    expect(recoveredTransient).toHaveLength(1);
    expect(recoveredTransient[0].url).toBe(URL_SCENARIOS);
  });

  test('page_error (exceção JS) nunca é descartado, mesmo com URL recuperada', () => {
    const pageErrors = [
      { type: 'page_error', message: 'TypeError: x is not a function', url: URL_SCENARIOS },
    ];
    const { relevant, recoveredTransient } = partitionPageErrors(pageErrors, new Set([URL_SCENARIOS]));
    expect(relevant).toHaveLength(1);
    expect(recoveredTransient).toHaveLength(0);
  });
});

describe('partitionConsoleErrors', () => {
  const transientToast = {
    level: 'error',
    text: '[2026-07-27T20:17:19.087Z] [ERROR] Toast [error]: API temporariamente indisponível. Tentando reconectar...',
  };
  const httpClientFailure = {
    level: 'error',
    text: '[HTTP Client] 💥 Erro capturado no catch: {name: TypeError, message: Failed to fetch, path: /api/qa-waves/scenarios}',
  };
  const functionalError = {
    level: 'error',
    text: '[ERROR] Validate reprovou fluxo válido: {"valid":false}',
  };

  test('assinaturas transitórias são suprimidas SOMENTE quando houve falha recuperada', () => {
    const withRecovery = partitionConsoleErrors([transientToast, httpClientFailure], true);
    expect(withRecovery.relevant).toHaveLength(0);
    expect(withRecovery.suppressed).toHaveLength(2);

    const withoutRecovery = partitionConsoleErrors([transientToast, httpClientFailure], false);
    expect(withoutRecovery.relevant).toHaveLength(2);
    expect(withoutRecovery.suppressed).toHaveLength(0);
  });

  test('erro funcional nunca é suprimido, mesmo com recuperação de rede', () => {
    const { relevant, suppressed } = partitionConsoleErrors([functionalError, transientToast], true);
    expect(relevant).toHaveLength(1);
    expect(relevant[0]).toBe(functionalError);
    expect(suppressed).toHaveLength(1);
  });
});

describe('createNetworkRecoveryTracker', () => {
  test('marca URL recuperada quando sucesso chega DEPOIS da falha (ordem real dos eventos)', async () => {
    const tracker = createNetworkRecoveryTracker();
    tracker.onRequestFailed({ url: URL_SCENARIOS, method: 'GET', failure: 'net::ERR_ABORTED' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    tracker.onResponse({ url: URL_SCENARIOS, status: 200 });
    expect(tracker.recoveredUrls().has(URL_SCENARIOS)).toBe(true);
  });

  test('NÃO marca quando o sucesso chega ANTES da falha', async () => {
    const tracker = createNetworkRecoveryTracker();
    tracker.onResponse({ url: URL_SCENARIOS, status: 200 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    tracker.onRequestFailed({ url: URL_SCENARIOS, method: 'GET', failure: 'net::ERR_ABORTED' });
    expect(tracker.recoveredUrls().has(URL_SCENARIOS)).toBe(false);
  });

  test('resposta 500 não conta como recuperação; falhas ficam limitadas ao cap', () => {
    const tracker = createNetworkRecoveryTracker({ maxFailed: 2 });
    tracker.onRequestFailed({ url: 'u1', method: 'GET' });
    tracker.onRequestFailed({ url: 'u2', method: 'GET' });
    tracker.onRequestFailed({ url: 'u3', method: 'GET' });
    expect(tracker.failedCount()).toBe(2);
    tracker.onResponse({ url: 'u3', status: 500 });
    expect(tracker.recoveredUrls().has('u3')).toBe(false);
  });
});
