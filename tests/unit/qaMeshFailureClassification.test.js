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

  test('TUTOR_SEM_IA: ai_unavailable (cold start do RAG/embeddings) é ambiente, não falha funcional', () => {
    // Caso real do CORE-BIZ-ACADEMY: o cenário recebia `reason: ai_unavailable` e descartava o
    // motivo na mensagem. Agora o motivo é preservado e classificado como dependência indisponível.
    const out = classify({ success: false, errors: [{ message: 'Tutor não respondeu com conteúdo disponível (reason=ai_unavailable, available=false)' }] });
    expect(out.failureType).toBe('environment_missing');
    expect(out.status).not.toBe('failed');
  });

  test('RAG_CIRCUIT_BREAKER: indisponibilidade do serviço de RAG é ambiente (causa REAL medida no mesh)', () => {
    // Causa determinada pela instrumentação do cenário (2026-09-25), depois de QUATRO hipóteses
    // refutadas por medição: `RAG_INDEX_FAILED::Serviço RAG indisponível no momento (circuit
    // breaker aberto)`. A regra anterior não pegava porque exigia menção literal a 'provider'.
    const out = classify({
      success: false,
      errors: [{ message: 'Documento não foi indexado dentro do tempo esperado (estado final: indexStatus=failed chunks=0 indexed=false erro=RAG_INDEX_FAILED::Serviço RAG indisponível no momento (circuit breaker aberto). Tente novamente em instantes.)' }],
    });
    expect(out.failureType).toBe('environment_missing');
    expect(out.status).not.toBe('failed');
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
