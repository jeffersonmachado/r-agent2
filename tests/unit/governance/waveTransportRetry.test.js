/**
 * waveTransportRetry.test.js — classificação de falha de TRANSPORTE nas ondas
 * de superfície: só repete o probe quando o sinal é exclusivamente de rede, e
 * nunca promove falha de aplicação a "tentativa de novo".
 */
'use strict';

const {
  countTransportSignals,
  isTransportOnlyFailure,
  isInconclusiveProbe,
  shouldRetryProbe,
} = require('../../../scripts/governance/lib/wave-transport-retry');

describe('WaveTransportRetry — classificação de transporte', () => {
  test('ERR_NETWORK_CHANGED é sinal de transporte', () => {
    const probe = {
      errorSamples: [
        'Failed to load resource: net::ERR_NETWORK_CHANGED',
        'Failed to load resource: net::ERR_NETWORK_CHANGED',
      ],
    };
    expect(countTransportSignals(probe)).toBe(2);
    expect(isTransportOnlyFailure(probe)).toBe(true);
    expect(shouldRetryProbe(probe, 1, 2)).toBe(true);
  });

  test('módulo dinâmico não carregado por queda de rede é transporte', () => {
    const probe = {
      errorSamples: ['Failed to fetch dynamically imported module: http://localhost:5173/src/pages/DemoPage.jsx'],
    };
    expect(isTransportOnlyFailure(probe)).toBe(true);
  });

  test('erro de aplicação NÃO é transporte', () => {
    const probe = {
      errorSamples: ['TypeError: Cannot read properties of undefined (reading \'map\')'],
    };
    expect(countTransportSignals(probe)).toBe(0);
    expect(isTransportOnlyFailure(probe)).toBe(false);
    expect(shouldRetryProbe(probe, 1, 2)).toBe(false);
  });

  /**
   * Evidência real (2026-10-05, run rap-governed-20261005155912964-90b91404): a
   * onda reprovou `/developer-keys` (P2) com estes TRÊS samples do MESMO aborto
   * de rede. O padrão antigo reconhecia só o primeiro, então
   * `isTransportOnlyFailure` dava `false` e o probe NÃO era repetido.
   */
  test('aborto de rede do fetch é transporte mesmo sem o prefixo net::ERR_', () => {
    const probe = {
      rendered: true,
      consoleErrors: 3,
      errorSamples: [
        'Failed to load resource: net::ERR_NETWORK_CHANGED',
        '[ERROR] [HTTP Client] Erro capturado no catch { "name": "TypeError", "message": "Failed to fetch", "path": "/developer/usage" }',
        '[ERROR] API não acessível - verifique se o servidor está rodando { "method": "GET", "url": "/developer/usage" }',
      ],
    };
    expect(countTransportSignals(probe)).toBe(3);
    expect(isTransportOnlyFailure(probe)).toBe(true);
    expect(shouldRetryProbe(probe, 1, 2)).toBe(true);
  });

  /**
   * Mesma evidência: `/dev/qa-gaps` e `/dev/qa-waves/operational-health` (P3)
   * estouraram o timeout de 30s do cliente HTTP em `/auth/me` — que responde
   * 200 em 1,5 ms fora da onda. O probe terminou sem veredito (`rendered=false`,
   * `login=false`, `denied=false`) + 2 console.error de transporte.
   */
  test('timeout do cliente HTTP do app é transporte', () => {
    const probe = {
      rendered: false,
      loginSurface: false,
      denied: false,
      docStatus: 200,
      consoleErrors: 2,
      errorSamples: [
        '[ERROR] [HTTP Client] Erro capturado no catch { "name": "AbortError", "message": "Request timed out after 30000ms", "path": "/auth/me" }',
        '[ERROR] Request timeout { "method": "GET", "url": "/auth/me", "path": "/auth/me", "timeout": 30000 }',
      ],
    };
    expect(countTransportSignals(probe)).toBe(2);
    expect(isTransportOnlyFailure(probe)).toBe(true);
    expect(shouldRetryProbe(probe, 1, 2)).toBe(true);
    expect(shouldRetryProbe(probe, 2, 2)).toBe(false);
  });

  test('transporte + falha de aplicação no MESMO probe continua reprovando', () => {
    const probe = {
      rendered: false,
      consoleErrors: 2,
      errorSamples: [
        'Request timed out after 30000ms',
        'TypeError: Cannot read properties of null (reading \'rows\')',
      ],
    };
    expect(countTransportSignals(probe)).toBe(1);
    expect(isTransportOnlyFailure(probe)).toBe(false);
    expect(shouldRetryProbe(probe, 1, 2)).toBe(false);
  });

  test('mix de transporte e aplicação não é "somente transporte"', () => {
    const probe = {
      errorSamples: [
        'Failed to load resource: net::ERR_NETWORK_CHANGED',
        'Uncaught Error: falha ao carregar alunos',
      ],
    };
    expect(countTransportSignals(probe)).toBe(1);
    expect(isTransportOnlyFailure(probe)).toBe(false);
  });

  test('erro de navegação (sem veredito) é repetível', () => {
    expect(isTransportOnlyFailure({ error: true })).toBe(true);
  });

  test('o limite de tentativas é respeitado', () => {
    const transport = { errorSamples: ['net::ERR_CONNECTION_RESET'] };
    expect(shouldRetryProbe(transport, 1, 2)).toBe(true);
    expect(shouldRetryProbe(transport, 2, 2)).toBe(false);
  });

  test('probe vazio/ausente não é classificado como transporte', () => {
    expect(isTransportOnlyFailure(null)).toBe(false);
    expect(isTransportOnlyFailure({})).toBe(false);
    expect(countTransportSignals({})).toBe(0);
  });
});

describe('WaveTransportRetry — probe inconclusivo (sem veredito e sem erro)', () => {
  test('página que não renderizou e não registrou erro é inconclusiva e repetível', () => {
    const probe = {
      docStatus: 200,
      rendered: false,
      loginSurface: false,
      denied: false,
      consoleErrors: 0,
      pageErrors: 0,
      errorSamples: [],
    };
    expect(isInconclusiveProbe(probe)).toBe(true);
    expect(shouldRetryProbe(probe, 1, 2)).toBe(true);
    expect(shouldRetryProbe(probe, 2, 2)).toBe(false);
  });

  test('página que renderizou NÃO é inconclusiva', () => {
    expect(isInconclusiveProbe({ rendered: true, consoleErrors: 0, pageErrors: 0 })).toBe(false);
  });

  test('superfície de login / acesso negado são vereditos, não inconclusivos', () => {
    expect(isInconclusiveProbe({ loginSurface: true })).toBe(false);
    expect(isInconclusiveProbe({ denied: true })).toBe(false);
  });

  test('probe com erro de console NÃO é inconclusivo (não pode mascarar app)', () => {
    expect(isInconclusiveProbe({ consoleErrors: 2, pageErrors: 0 })).toBe(false);
    expect(shouldRetryProbe({ consoleErrors: 2, errorSamples: ['Erro real do app'] }, 1, 2)).toBe(false);
  });

  test('erro de navegação também é repetível', () => {
    expect(isInconclusiveProbe({ error: true })).toBe(false);
    expect(shouldRetryProbe({ error: true }, 1, 2)).toBe(true);
  });
});
