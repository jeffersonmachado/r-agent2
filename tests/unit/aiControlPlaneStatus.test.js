'use strict';

/**
 * Testes do serviço de runtime do AI control plane
 * (`api/services/aiControlPlaneStatus.js`): circuit breaker central por
 * provider, status por componente e relatório agregado.
 */

const svc = require('../../api/services/aiControlPlaneStatus');
const { EVENT_PRIORITY } = require('../../engine/aiControlPlaneResilience');

// O serviço lê o limiar do AMBIENTE (`AI_CP_BREAKER_FAILURE_THRESHOLD`, default 3). Este arquivo
// exercita "N falhas abrem o circuito" e precisa DECLARAR esse N: um `.env` de máquina com valor
// maior (neste ambiente, 6) fazia 3 falhas não abrirem o circuito e a suíte falhava por
// CONFIGURAÇÃO, não por comportamento do produto — ou seja, o teste media a máquina. No CI, sem
// `.env`, ele passava; aqui, com as variáveis exportadas na sessão, falhava.
const TEST_FAILURE_THRESHOLD = 3;
const ORIGINAL_FAILURE_THRESHOLD = process.env.AI_CP_BREAKER_FAILURE_THRESHOLD;

describe('aiControlPlaneStatus — circuit breaker por provider', () => {
  beforeEach(() => {
    process.env.AI_CP_BREAKER_FAILURE_THRESHOLD = String(TEST_FAILURE_THRESHOLD);
    svc.resetAiControlPlaneState();
  });

  afterAll(() => {
    if (ORIGINAL_FAILURE_THRESHOLD === undefined) delete process.env.AI_CP_BREAKER_FAILURE_THRESHOLD;
    else process.env.AI_CP_BREAKER_FAILURE_THRESHOLD = ORIGINAL_FAILURE_THRESHOLD;
  });

  test('fail closed: circuito aberto bloqueia sem chamar o provider', async () => {
    const breaker = svc.getProviderBreaker('openai');
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState().state).toBe('open');

    const generate = jest.fn(async () => ({ text: 'ok' }));
    const wrapped = svc.wrapProviderGenerate('openai', generate);

    await expect(wrapped('prompt', { tenantId: 't' })).rejects.toMatchObject({
      code: 'provider_circuit_open',
    });
    expect(generate).not.toHaveBeenCalled();
  });

  test('sucesso registra no breaker e não bufferiza falha', async () => {
    const generate = jest.fn(async () => ({ text: 'ok' }));
    const wrapped = svc.wrapProviderGenerate('anthropic', generate);

    const result = await wrapped('prompt', { tenantId: 't' });
    expect(result.text).toBe('ok');
    expect(svc.getProviderBreaker('anthropic').getState().consecutiveFailures).toBe(0);
    expect(svc.getBufferState().size).toBe(0);
  });

  test('falha registra no breaker e bufferiza model_access_failure (prioridade alta)', async () => {
    const generate = jest.fn(async () => {
      const err = new Error('request timed out');
      err.status = 504;
      throw err;
    });
    const wrapped = svc.wrapProviderGenerate('deepseek', generate);

    await expect(wrapped('prompt', {})).rejects.toThrow('request timed out');
    expect(svc.getProviderBreaker('deepseek').getState().consecutiveFailures).toBe(1);
    expect(svc.getBufferState().size).toBe(1);

    const buffered = svc.getBufferState();
    expect(buffered.size).toBe(1);
  });

  test('buffered event de falha de modelo tem categoria e provider', async () => {
    const generate = jest.fn(async () => {
      const err = new Error('invalid api key');
      err.status = 401;
      throw err;
    });
    const wrapped = svc.wrapProviderGenerate('openai', generate);
    await expect(wrapped('p', {})).rejects.toThrow('invalid api key');

    // o buffer não expõe drain no serviço; valida apenas o estado contábil.
    expect(svc.getBufferState().size).toBe(1);
  });

  // Achado real (QA Mesh, execução canônica do pipeline oficial): um cenário sem
  // GROQ_API_KEY configurada neste ambiente falha 3x com 401 real, abre o breaker, e
  // TODA falha subsequente vira "Provider de IA 'groq' indisponível (circuit breaker
  // aberto)." — mensagem genérica, sem nenhum indício de que a causa raiz é
  // credencial ausente/inválida (uma condição de AMBIENTE, não uma falha funcional
  // real do provider). O QA Mesh classifica erros contendo "não configurad"/"missing"
  // como `environment_missing` (nunca bloqueante) — mas essa mensagem genérica não
  // contém nenhum desses termos, então cai em `functional_failure` (bloqueante),
  // mascarando uma limitação de ambiente como se fosse um bug de produto.
  test('circuito aberto por falhas de AUTH preserva o motivo real na mensagem de bloqueio (nunca genérica demais para diagnosticar)', async () => {
    const authFailure = jest.fn(async () => {
      const err = new Error('invalid api key');
      err.status = 401;
      throw err;
    });
    const wrapped = svc.wrapProviderGenerate('groq', authFailure);

    await expect(wrapped('p', {})).rejects.toThrow();
    await expect(wrapped('p', {})).rejects.toThrow();
    await expect(wrapped('p', {})).rejects.toThrow();
    expect(svc.getProviderBreaker('groq').getState().state).toBe('open');

    await expect(wrapped('p', {})).rejects.toMatchObject({
      code: 'provider_circuit_open',
      message: expect.stringMatching(/não configurad|credencial|auth/i),
    });
  });

  test('circuito aberto por falhas transitórias (5xx) mantém a mensagem genérica — nunca inventa causa de credencial sem evidência', async () => {
    const transientFailure = jest.fn(async () => {
      const err = new Error('upstream unavailable');
      err.status = 503;
      throw err;
    });
    const wrapped = svc.wrapProviderGenerate('mistral', transientFailure);

    await expect(wrapped('p', {})).rejects.toThrow();
    await expect(wrapped('p', {})).rejects.toThrow();
    await expect(wrapped('p', {})).rejects.toThrow();
    expect(svc.getProviderBreaker('mistral').getState().state).toBe('open');

    await expect(wrapped('p', {})).rejects.toMatchObject({
      code: 'provider_circuit_open',
      message: expect.not.stringMatching(/não configurad|credencial/i),
    });
  });
});

describe('aiControlPlaneStatus — status de componentes e relatório', () => {
  beforeEach(() => {
    svc.resetAiControlPlaneState();
  });

  test('setComponentStatus normaliza e getComponentStatus devolve', () => {
    expect(svc.setComponentStatus('DATABASE', 'HEALTHY')).toBe(true);
    expect(svc.getComponentStatus('DATABASE')).toBe('HEALTHY');
    expect(svc.setComponentStatus('nao-existe', 'HEALTHY')).toBe(false);
  });

  test('componentes default UNKNOWN; relatório expõe criticalOperationAllowed=false', () => {
    const report = svc.getControlPlaneReport();
    expect(report.componentHealth.POLICY_ENGINE).toBe('UNKNOWN');
    expect(report.aiControlPlaneStatus).toBe('UNKNOWN');
    // POLICY_ENGINE (SAFETY_CRITICAL) UNKNOWN → operação crítica bloqueada.
    expect(report.criticalOperationAllowed).toBe(false);
  });

  test('relatório reflete degradação e criticalOperationAllowed', () => {
    svc.setComponentStatus('DATABASE', 'HEALTHY');
    svc.setComponentStatus('POLICY_ENGINE', 'HEALTHY');
    svc.setComponentStatus('MARKET_INTELLIGENCE', 'DEGRADED');
    const report = svc.getControlPlaneReport();
    expect(report.aiControlPlaneStatus).toBe('DEGRADED');
    expect(report.degradedComponents).toContain('MARKET_INTELLIGENCE');
    // safety-critical healthy → operação crítica permitida mesmo com market degradado.
    expect(report.criticalOperationAllowed).toBe(true);
  });

  test('safety-critical BLOCKED domina o status agregado', () => {
    svc.setComponentStatus('DATABASE', 'HEALTHY');
    svc.setComponentStatus('POLICY_ENGINE', 'BLOCKED');
    const report = svc.getControlPlaneReport();
    expect(report.aiControlPlaneStatus).toBe('BLOCKED');
    expect(report.blockedComponents).toContain('POLICY_ENGINE');
    expect(report.criticalOperationAllowed).toBe(false);
  });
});

describe('aiControlPlaneStatus — buffer de eventos', () => {
  beforeEach(() => {
    svc.resetAiControlPlaneState();
  });

  test('bufferEvent aceita eventos de auditoria com prioridade', () => {
    expect(svc.bufferEvent({ type: 'routing_decision' }, EVENT_PRIORITY.ROUTING_DECISION).accepted).toBe(true);
    expect(svc.getBufferState().size).toBe(1);
  });

  test('drainBufferedEvents devolve em ordem de prioridade e limpa', () => {
    svc.bufferEvent({ id: 'low' }, EVENT_PRIORITY.TELEMETRY);
    svc.bufferEvent({ id: 'crit' }, EVENT_PRIORITY.POLICY_VIOLATION);
    const drained = svc.drainBufferedEvents();
    expect(drained.map((e) => e.id)).toEqual(['crit', 'low']);
    expect(svc.getBufferState().size).toBe(0);
  });
});

describe('aiControlPlaneStatus — DB outage + recovery (itens 95, 102)', () => {
  beforeEach(() => {
    svc.resetAiControlPlaneState();
  });

  test('DB down → bufferiza limitado → DB volta → replay idempotente sem duplicatas', () => {
    const { replayEventsWithIdempotency } = require('../../engine/aiControlPlaneResilience');

    // PERSISTENCE_DEGRADED_MODE: decisões continuam, eventos essenciais bufferizados.
    svc.setComponentStatus('DATABASE', 'DEGRADED');
    svc.bufferEvent({ id: 'e1', type: 'routing_decision' }, EVENT_PRIORITY.ROUTING_DECISION);
    svc.bufferEvent({ id: 'e2', type: 'budget_event' }, EVENT_PRIORITY.BUDGET_EVENT);
    expect(svc.getBufferState().size).toBe(2);

    // DB RECOVERS: flush pendente.
    svc.setComponentStatus('DATABASE', 'HEALTHY');
    const drained = svc.drainBufferedEvents();
    expect(drained).toHaveLength(2);

    // Retry de flush (re-entrega) não duplica execução/custo/audit.
    const replayed = replayEventsWithIdempotency([...drained, ...drained]);
    expect(replayed.toApply).toHaveLength(2);
    expect(replayed.duplicates).toHaveLength(2);
  });
});
