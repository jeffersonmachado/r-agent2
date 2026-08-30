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

  /**
   * Regressão (QA Mesh 2026-08-28, mesh-2026-08-28T20-39-26): o http client
   * do frontend aborta requests lentos em 30s ("Request timeout" /
   * "Request timed out after 30000ms") e retenta com sucesso — as mesmas
   * URLs constam como recuperadas. A assinatura só pode ser suprimida com
   * recuperação comprovada; sem recovery continua crítica.
   */
  test('request timeout é transitório SOMENTE com recuperação comprovada', () => {
    const timeoutLog = {
      level: 'error',
      text: '[2026-08-28T21:28:48.154Z] [ERROR] Request timeout { "method": "GET", "url": "/api/qa-waves/scenarios", "timeout": 30000 }',
    };
    const timeoutToast = {
      level: 'error',
      text: '[2026-08-28T21:28:48.156Z] [ERROR] Toast [error]: Request timed out after 30000ms',
    };
    const withRecovery = partitionConsoleErrors([timeoutLog, timeoutToast], true);
    expect(withRecovery.relevant).toHaveLength(0);
    expect(withRecovery.suppressed).toHaveLength(2);

    const withoutRecovery = partitionConsoleErrors([timeoutLog, timeoutToast], false);
    expect(withoutRecovery.relevant).toHaveLength(2);
    expect(withoutRecovery.suppressed).toHaveLength(0);
  });

  /**
   * Regressão (QA Mesh 2026-08-29, mesh-2026-08-29T02-45-53): os cenários
   * fitness-matricula-* flapperam por erros de console "API não acessível" /
   * "Failed to fetch" cujos request_failed correspondentes eram TODOS
   * net::ERR_ABORTED (pageErrors=[] após o filtro de navigation-abort) — a
   * gravação navega para fora de /dev/qa-waves com fetches em voo e o catch
   * do http client loga o abort como se fosse indisponibilidade. O erro de
   * console é a superfície do mesmo cancelamento iniciado pela página:
   * suprimir quando a URL consta nos aborts; manter crítico sem essa prova.
   */
  test('console transitório é suprimido quando a URL consta nos aborts de página', () => {
    const abortedUrls = new Set(['http://localhost:5173/api/qa-waves/journeys']);
    const apiInacessivel = {
      level: 'error',
      text: '[2026-08-29T03:41:56.319Z] [ERROR] API não acessível - verifique se o servidor está rodando { "method": "GET", "url": "/api/qa-waves/journeys", "path": "/api/qa-waves/journeys" }',
    };
    const httpClientCatch = {
      level: 'error',
      text: '[HTTP Client] Erro capturado no catch { "name": "TypeError", "message": "Failed to fetch", "path": "/api/qa-waves/journeys", "url": "/api/qa-waves/journeys" }',
    };
    const { relevant, suppressed } = partitionConsoleErrors(
      [apiInacessivel, httpClientCatch],
      { hasRecoveredTransient: false, abortedUrls },
    );
    expect(relevant).toHaveLength(0);
    expect(suppressed).toHaveLength(2);
  });

  test('console transitório NÃO é suprimido quando a URL não consta nos aborts', () => {
    const abortedUrls = new Set(['http://localhost:5173/api/qa-waves/journeys']);
    const outraUrl = {
      level: 'error',
      text: '[ERROR] API não acessível { "method": "GET", "url": "/api/qa-waves/scenarios", "path": "/api/qa-waves/scenarios" }',
    };
    const { relevant } = partitionConsoleErrors([outraUrl], { hasRecoveredTransient: false, abortedUrls });
    expect(relevant).toHaveLength(1);
  });

  test('toast transitório sem URL só é suprimido quando houve abort de página na execução', () => {
    const toastGenerico = {
      level: 'error',
      text: '[2026-08-29T03:52:50.311Z] [ERROR] Toast [error]: Request timed out after 30000ms { "type": "error", "duration": 6000 }',
    };
    const comAbort = partitionConsoleErrors([toastGenerico], {
      hasRecoveredTransient: false,
      abortedUrls: new Set(['http://localhost:5173/api/qa-waves/journeys']),
    });
    expect(comAbort.relevant).toHaveLength(0);
    expect(comAbort.suppressed).toHaveLength(1);

    const semAbort = partitionConsoleErrors([toastGenerico], {
      hasRecoveredTransient: false,
      abortedUrls: new Set(),
    });
    expect(semAbort.relevant).toHaveLength(1);
    expect(semAbort.suppressed).toHaveLength(0);
  });

  test('assinatura legada (boolean) continua funcionando', () => {
    const { relevant, suppressed } = partitionConsoleErrors([transientToast], true);
    expect(relevant).toHaveLength(0);
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

  test('abortedUrls expõe somente request_failed net::ERR_ABORTED', () => {
    const tracker = createNetworkRecoveryTracker();
    tracker.onRequestFailed({ url: 'http://localhost:5173/api/qa-waves/journeys', method: 'GET', failure: 'net::ERR_ABORTED' });
    tracker.onRequestFailed({ url: 'http://localhost:5173/api/qa-waves/scenarios', method: 'GET', failure: 'net::ERR_CONNECTION_REFUSED' });
    tracker.onRequestFailed({ url: 'http://localhost:5173/api/qa-waves/executions', method: 'GET', failure: null });
    const aborted = tracker.abortedUrls();
    expect(aborted.has('http://localhost:5173/api/qa-waves/journeys')).toBe(true);
    expect(aborted.size).toBe(1);
  });

  /**
   * Regressão (QA Mesh 2026-08-29, mesh-2026-08-29T21-15-31): os cenários
   * fitness-matricula-cancelamento/checkout reprovaram com request_failed
   * net::ERR_NETWORK_CHANGED (troca de interface de rede do cliente — blip
   * do ambiente, nunca resposta da plataforma). São requests one-shot sem
   * retry na MESMA URL, então recoveredUrls() não os cobre. A regra:
   * NETWORK_CHANGED só é suprimido com prova de recuperação da pilha de
   * rede (pelo menos uma resposta < 400 posterior na mesma execução); sem
   * sucesso posterior, queda real de rede continua reprovando.
   */
  describe('networkChangedRecoveredUrls', () => {
    test('NETWORK_CHANGED com sucesso posterior na execução é suprimido', async () => {
      const tracker = createNetworkRecoveryTracker();
      tracker.onRequestFailed({ url: 'http://localhost:5173/api/test-executions/replays?x=1', method: 'GET', failure: 'net::ERR_NETWORK_CHANGED' });
      await new Promise((resolve) => setTimeout(resolve, 5));
      // Sucesso posterior em OUTRA URL já prova que a pilha de rede recuperou
      tracker.onResponse({ url: URL_SCENARIOS, status: 200 });
      const recovered = tracker.networkChangedRecoveredUrls();
      expect(recovered.has('http://localhost:5173/api/test-executions/replays?x=1')).toBe(true);
    });

    test('NETWORK_CHANGED SEM sucesso posterior continua crítico (queda real reprova)', () => {
      const tracker = createNetworkRecoveryTracker();
      tracker.onRequestFailed({ url: 'http://localhost:5173/api/test-executions/replays?x=1', method: 'GET', failure: 'net::ERR_NETWORK_CHANGED' });
      expect(tracker.networkChangedRecoveredUrls().size).toBe(0);
    });

    test('sucesso ANTES da falha não conta como recuperação', async () => {
      const tracker = createNetworkRecoveryTracker();
      tracker.onResponse({ url: URL_SCENARIOS, status: 200 });
      await new Promise((resolve) => setTimeout(resolve, 5));
      tracker.onRequestFailed({ url: 'http://localhost:5173/api/test-executions/replays?x=1', method: 'GET', failure: 'net::ERR_NETWORK_CHANGED' });
      expect(tracker.networkChangedRecoveredUrls().size).toBe(0);
    });

    test('outras assinaturas de falha nunca entram (regra estrita de ambiente)', async () => {
      const tracker = createNetworkRecoveryTracker();
      tracker.onRequestFailed({ url: 'http://localhost:5173/api/qa-waves/scenarios', method: 'GET', failure: 'net::ERR_CONNECTION_REFUSED' });
      tracker.onRequestFailed({ url: 'http://localhost:5173/api/qa-waves/executions', method: 'GET', failure: 'net::ERR_ABORTED' });
      await new Promise((resolve) => setTimeout(resolve, 5));
      tracker.onResponse({ url: URL_SCENARIOS, status: 200 });
      expect(tracker.networkChangedRecoveredUrls().size).toBe(0);
    });
  });
});
