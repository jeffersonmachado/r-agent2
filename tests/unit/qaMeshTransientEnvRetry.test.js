'use strict';

/**
 * Regressão: falhas transientes de ambiente devem ser detectadas para retry
 * único no mesh; falhas funcionais NÃO podem ser classificadas como
 * transitórias (isso esconderia regressão real).
 */

const {
  isTransientEnvFailure,
  waitForApiStable,
} = require('../../qa-mesh/transientEnvRetry');

describe('isTransientEnvFailure', () => {
  test('detecta assinatura de API indisponível em erros estruturados', () => {
    // Evidência real: fitness-matricula-* / business-core-biz-mfa (2026-07-27)
    expect(isTransientEnvFailure({
      status: 'failed',
      errors: [
        { step: 'page_error', error: '1 erro(s) críticos detectados na página', details: [{ type: 'request_failed', url: 'http://localhost:5173/api/qa-waves/scenarios' }] },
        { step: 'console', error: 'Toast [error]: API temporariamente indisponível. Tentando reconectar...' },
      ],
    })).toBe(true);
  });

  test('detecta fetch failed com causa de socket', () => {
    // Evidência real: business-b1 (2026-07-27)
    expect(isTransientEnvFailure({
      status: 'infra_error',
      errorMessage: 'fetch failed (cause: UND_ERR_SOCKET)',
    })).toBe(true);
  });

  test('detecta Failed to fetch em log de console', () => {
    expect(isTransientEnvFailure({
      status: 'failed',
      logs: [{ level: 'error', message: '[HTTP Client] Erro: Failed to fetch /tickets' }],
    })).toBe(true);
  });

  test('detecta assinatura em log stdout (adapter de subprocesso)', () => {
    // O adapter de negócio roda o runner como subprocesso: a evidência chega
    // em logs stdout, não em logs de nível error.
    expect(isTransientEnvFailure({
      status: 'failed',
      logs: [{ level: 'stdout', message: 'Error: fetch failed (cause: UND_ERR_SOCKET)' }],
    })).toBe(true);
  });

  test('detecta assinatura na causaRaiz do relatório business-qa referenciado nos logs', () => {
    // Falha observada (QA Mesh 2026-07-27, business-b1): o adapter retornou
    // errors=[] e logs stdout; a assinatura "fetch failed (UND_ERR_SOCKET)"
    // só existia no resumo.causaRaiz do relatório business-qa-*.json — o retry
    // transitório não disparou (transientEnvRetry: null na evidência).
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-retry-'));
    const reportPath = path.join(dir, 'business-qa-2026-07-27T00-00-00-000Z.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      scenarios: [{
        status: 'FAIL',
        resumo: { causaRaiz: 'fetch failed (cause: UND_ERR_SOCKET)' },
        etapas: [{ nome: 'journey-validation', status: 'FAIL', detalhe: 'fetch failed (cause: UND_ERR_SOCKET)' }],
      }],
    }));
    try {
      expect(isTransientEnvFailure({
        status: 'infra_error',
        errors: [],
        logs: [{ level: 'stdout', message: `- JSON: ${reportPath}` }],
      })).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('relatório business-qa com falha funcional NÃO é transitório', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-retry-'));
    const reportPath = path.join(dir, 'business-qa-2026-07-27T00-00-00-000Z.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      scenarios: [{
        status: 'FAIL',
        resumo: { causaRaiz: 'Validate reprovou fluxo válido: {"valid":false}' },
        etapas: [{ nome: 'flow-validation', status: 'FAIL', detalhe: 'Validate reprovou fluxo válido' }],
      }],
    }));
    try {
      expect(isTransientEnvFailure({
        status: 'failed',
        errors: [],
        logs: [{ level: 'stdout', message: `- JSON: ${reportPath}` }],
      })).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('NÃO classifica falha funcional como transitória', () => {
    expect(isTransientEnvFailure({
      status: 'failed',
      errorMessage: 'Validate reprovou fluxo válido: {"valid":false}',
    })).toBe(false);
    expect(isTransientEnvFailure({
      status: 'failed',
      errorMessage: 'Pagina /agenda apresentou Acesso Negado',
    })).toBe(false);
    expect(isTransientEnvFailure({
      status: 'failed',
      errorMessage: '500 Internal Server Error: Existem nós não alcançáveis a partir do start.',
    })).toBe(false);
  });

  test('passed nunca é transitório; ausência de evidência não é transitório', () => {
    expect(isTransientEnvFailure({ status: 'passed' })).toBe(false);
    expect(isTransientEnvFailure({ status: 'failed' })).toBe(false);
    expect(isTransientEnvFailure(null)).toBe(false);
  });
});

describe('waitForApiStable', () => {
  test('exige estabilidade contínua (settle) antes de retornar', async () => {
    // Sequência: down, down, up, up, up — com settleMs curto deve retornar
    // somente após janela estável contínua.
    const responses = [false, false, true, true, true, true];
    const fetchImpl = async () => ({ ok: responses.shift() !== false });
    const startedAt = Date.now();
    await waitForApiStable({ fetchImpl, intervalMs: 5, settleMs: 20, timeoutMs: 2000 });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15);
  });

  test('falha se a API não estabiliza dentro do timeout', async () => {
    const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
    await expect(
      waitForApiStable({ fetchImpl, intervalMs: 5, settleMs: 10, timeoutMs: 50 }),
    ).rejects.toThrow('não estabilizou');
  });
});
