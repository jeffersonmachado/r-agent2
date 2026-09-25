'use strict';

/**
 * Classificação de falhas do mesh — o veredito de release não pode contar causa AMBIENTAL como
 * defeito funcional.
 *
 * Defeito real (medido 2026-09-24): o cenário `CORE-BIZ-FLOWS-EDITOR` falhava com
 * `500 Internal Server Error: Provider de IA 'mistral' indisponível (circuit breaker)` e o
 * classificador o mandava para `functional_failure` — porque nenhum padrão cobria "provider de IA
 * indisponível". O release então exibia como defeito de produto algo que não exercitou a
 * funcionalidade. É o mesmo vício que o gate anti-greenwashing corrigiu no Jest, agora no mesh.
 */

const { classifyScenarioResult } = require('../../qa-mesh/meshRunner');

function classify(result) {
  return classifyScenarioResult(result, [], {});
}

describe('meshRunner — classificação de falha por causa', () => {
  test('PROVIDER_DE_IA_INDISPONIVEL_NAO_E_FALHA_FUNCIONAL: circuit breaker ⇒ environment_missing', () => {
    const out = classify({
      success: false,
      errors: [{ error: "500 Internal Server Error: Provider de IA 'mistral' indisponível (circuit breaker)" }],
    });
    expect(out.failureType).toBe('environment_missing');
    expect(out.status).toBe('environment_missing');
    expect(out.status).not.toBe('failed');
    expect(out.rootCauseHint).toMatch(/não é defeito funcional/i);
  });

  test('AI_PROVIDER_FORA_DO_AR: "provider unavailable" também é ambiente', () => {
    const out = classify({ success: false, errors: [{ message: 'AI provider unavailable: no credential configured' }] });
    expect(out.failureType).toBe('environment_missing');
  });

  test('FALHA_FUNCIONAL_REAL_CONTINUA_FAILED: assert/expected não vira ambiente', () => {
    const out = classify({ success: false, errors: [{ error: 'assertion failed: expected total 3, got 5' }] });
    expect(out.failureType).toBe('functional_failure');
    expect(out.status).toBe('failed');
  });

  test('INFRA_LOCAL_NAO_REGRIDE: conexão recusada continua infra_error', () => {
    const out = classify({ success: false, errors: [{ error: 'page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/login' }] });
    expect(out.failureType).toBe('infra_error');
  });

  test('SEM_DIAGNOSTICO: não quebra e não inventa causa melhorada', () => {
    const out = classify({ success: false, errors: [] });
    expect(out.failureType).toBe('functional_failure');
    expect(out.status).toBe('failed');
  });

  test('SUCESSO_NAO_E_RECLASSIFICADO', () => {
    const out = classify({ success: true, status: 'passed' });
    expect(out.status).toBe('passed');
    expect(out.failureType).toBeNull();
  });
});
