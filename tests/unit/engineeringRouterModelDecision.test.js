'use strict';

/**
 * HUMAN_EXTERNAL_BOOTSTRAP (2026-10-07) — DECISÃO POR EVIDÊNCIA EMPÍRICA.
 *
 * A função objetivo é `expected_cost_per_GREEN` (custo efetivo por sucesso esperado), não
 * "menor preço de token". A ordem de prevalência é Safety/Governance > Capability > Reliability >
 * Cost. Nenhum modelo é fixado no código: a evidência é HISTÓRICA, agregada de attempts reais.
 *
 * Estes testes provam os critérios exigidos pela autorização, com dados sintéticos controlados
 * (a agregação é pura; o I/O de leitura fica no serviço):
 *   - sucesso/falha anterior por classe, latência, timeout rate, reasoning exhaustion, quota,
 *     validade estrutural e desfecho final entram no score;
 *   - falha determinística NA EXECUÇÃO ATUAL reduz prioridade;
 *   - candidato comprovado ultrapassa candidato mais barato degradado;
 *   - capacidade continua sendo filtro (não é possível "comprar" prioridade ignorando requisito);
 *   - Safety (sem credencial / modelo indisponível / provider unhealthy) vence tudo;
 *   - teto de tempo e orçamento restante são respeitados.
 */

const {
  aggregateEvidenceFromAttempts,
  scoreModel,
  classifyAttemptOutcome,
  probabilityOfApplied,
  currentExecutionPenalty,
  modelKey,
  RELIABILITY_TIER,
} = require('../../engine/engineeringRouter/modelDecision');
const { selectForRole, selectCoderAndReviewer } = require('../../engine/engineeringRouter/modelSelector');
const { createProviderBudget } = require('../../api/services/engineeringRouter/engineeringRouterService');
const { REASON_CODES } = require('../../engine/engineeringRouter/constants');

const MODEL = (providerId, modelId, costClass, overrides = {}) => ({
  providerId, modelId, costClass, contextClass: 'LONG',
  roles: ['CODER'], capabilities: ['CODE_GENERATION'], enabled: true, healthy: true, hasCredential: true, ...overrides,
});

const attempt = (provider, model, status, error = null, latencyMs = 1000) => ({
  task_id: `task-${provider}-${model}-${Math.random()}`,
  status,
  coder_provider: provider,
  coder_model: model,
  error,
  started_at: new Date(1000000).toISOString(),
  completed_at: new Date(1000000 + latencyMs).toISOString(),
});

describe('HUMAN_EXTERNAL_BOOTSTRAP — decisão por evidência (expected_cost_per_GREEN)', () => {
  describe('agregação de evidência (fatores exigidos)', () => {
    test('classifica cada desfecho real nos fatores da política', () => {
      expect(classifyAttemptOutcome({ status: 'DONE' }).kind).toBe('applied');
      expect(classifyAttemptOutcome({ status: 'PATCH_REJECTED', error: { code: 'PATCH_BODY_MISSING_PREFIX' } }).kind).toBe('invalidFormat');
      expect(classifyAttemptOutcome({ status: 'FAILED', error: { code: 'PATCH_APPLY_FAILED' } }).kind).toBe('invalidFormat');
      expect(classifyAttemptOutcome({ status: 'FAILED', error: { failureClass: 'PROVIDER_TIMEOUT' } }).kind).toBe('timeout');
      expect(classifyAttemptOutcome({ status: 'FAILED', error: { failureClass: 'PROVIDER_EMPTY_RESPONSE' } }).kind).toBe('reasoningExhausted');
      expect(classifyAttemptOutcome({ status: 'FAILED', error: { failureClass: 'credit_balance_exhausted' } }).kind).toBe('quota');
    });

    test('agrega sucesso, formato inválido, timeout, reasoning, quota, latência e desfecho final', () => {
      const tasks = [
        { id: 't1', status: 'GREEN' },
        { id: 't2', status: 'BLOCKED' },
      ];
      const attempts = [
        { ...attempt('qwen', 'coder-plus', 'DONE'), task_id: 't1', started_at: new Date(0).toISOString(), completed_at: new Date(20000).toISOString() },
        { ...attempt('kimi', 'k2.7-code', 'FAILED', { failureClass: 'PROVIDER_TIMEOUT' }), task_id: 't2' },
        { ...attempt('kimi', 'k2.7-code', 'FAILED', { failureClass: 'PROVIDER_TIMEOUT' }), task_id: 't2' },
        { ...attempt('deepseek', 'flash', 'FAILED', { failureClass: 'PROVIDER_EMPTY_RESPONSE' }), task_id: 't2' },
        { ...attempt('qwen', 'coder-flash', 'PATCH_REJECTED', { code: 'PATCH_BODY_MISSING_PREFIX' }), task_id: 't2' },
        { ...attempt('qwen', 'coder-flash', 'PATCH_REJECTED', { code: 'PATCH_APPLY_FAILED' }), task_id: 't2' },
        { ...attempt('openai', 'gpt-4o', 'FAILED', { failureClass: 'credit_balance_exhausted' }), task_id: 't2' },
      ];
      const evidence = aggregateEvidenceFromAttempts({ tasks, attempts });

      const plus = evidence.get(modelKey('qwen', 'coder-plus'));
      expect(plus.applied).toBe(1);
      expect(plus.greenFinal).toBe(1);          // desfecho final GREEN atribuído a quem fez a última tentativa
      expect(plus.latencySumMs).toBe(20000);

      const kimi = evidence.get(modelKey('kimi', 'k2.7-code'));
      expect(kimi.timeouts).toBe(2);
      expect(kimi.blockedFinal).toBe(0);        // a última tentativa da t2 foi do openai
      expect(evidence.get(modelKey('deepseek', 'flash')).reasoningExhausted).toBe(1);
      expect(evidence.get(modelKey('qwen', 'coder-flash')).invalidFormat).toBe(2);
      expect(evidence.get(modelKey('openai', 'gpt-4o')).quotaFailures).toBe(1);
      expect(evidence.get(modelKey('openai', 'gpt-4o')).blockedFinal).toBe(1);
    });

    test('probabilidade suavizada nunca é 0 nem 1 com amostra pequena', () => {
      expect(probabilityOfApplied({ attempts: 0, applied: 0 })).toBeCloseTo(0.5, 5);
      expect(probabilityOfApplied({ attempts: 10, applied: 0 })).toBeGreaterThan(0);
      expect(probabilityOfApplied({ attempts: 10, applied: 10 })).toBeLessThan(1);
    });
  });

  describe('score: Reliability antes de Cost', () => {
    test('candidato COMPROVADO (já aplicou patch) bate candidato mais barato com histórico degradado', () => {
      const cheaperDegraded = MODEL('kimi', 'k2.7-code', 'LOW');
      const provenPricier = MODEL('qwen', 'qwen3-coder-plus', 'HIGH');
      const evidence = new Map([
        [modelKey('kimi', 'k2.7-code'), { attempts: 4, timeouts: 4 }],
        [modelKey('qwen', 'qwen3-coder-plus'), { attempts: 1, applied: 1 }],
      ]);

      const selected = selectForRole([cheaperDegraded, provenPricier], {
        role: 'CODER', requiredCapabilities: ['CODE_GENERATION'], modelEvidence: evidence,
      });
      expect(selected.selected.modelId).toBe('qwen3-coder-plus');
      expect(selected.reasonCodes).toContain(REASON_CODES.RELIABILITY_PROVEN);

      // O custo por GREEN esperado explica a decisão de forma auditável: a FAIXA de confiabilidade
      // (Reliability) precede o custo, e dentro da mesma faixa o ECG decide.
      const factors = selected.decisionFactors;
      const kimiScore = factors.find((f) => f.key === 'kimi:k2.7-code');
      const qwenScore = factors.find((f) => f.key === 'qwen:qwen3-coder-plus');
      expect(qwenScore.reliabilityTier).toBe(RELIABILITY_TIER.PROVEN);
      expect(kimiScore.reliabilityTier).toBe(RELIABILITY_TIER.DEGRADED);
      expect(qwenScore.reliabilityTier).toBeLessThan(kimiScore.reliabilityTier);
      expect(kimiScore.tierReason).toContain('timeout');
      expect(qwenScore.tierReason).toContain('aplicado');
      // Por GREEN esperado o comprovado é MUITO mais barato que o degradado (9/HIGH com 67% de
      // sucesso custa 13,5 unidades por sucesso, contra 1/LOW com 17% de sucesso custando 6 — mas
      // o degradado consome ~6 tentativas da cadeia para 1 sucesso, recurso que é escasso).
      expect(qwenScore.probabilityOfApplied).toBeGreaterThan(kimiScore.probabilityOfApplied);
      expect(kimiScore.timeoutRate).toBe(1);
      expect(qwenScore.sampleSize).toBe(1);
      expect(qwenScore.reliabilityTier).toBe(0);
    });

    test('dentro da MESMA faixa, o custo efetivo decide (latência e desperdício contam)', () => {
      const evidence = new Map([
        [modelKey('lento', 'unknown-lento'), { attempts: 3, latencySumMs: 600000, latencySamples: 3 }],
        [modelKey('rapido', 'unknown-rapido'), { attempts: 3, latencySumMs: 30000, latencySamples: 3 }],
      ]);
      const selected = selectForRole([
        MODEL('lento', 'unknown-lento', 'LOW'),
        MODEL('rapido', 'unknown-rapido', 'LOW'),
      ], { role: 'CODER', requiredCapabilities: ['CODE_GENERATION'], modelEvidence: evidence });
      expect(selected.selected.modelId).toBe('unknown-rapido');
      const rapido = selected.decisionFactors.find((f) => f.key === 'rapido:unknown-rapido');
      const lento = selected.decisionFactors.find((f) => f.key === 'lento:unknown-lento');
      expect(rapido.expectedCostPerGreen).toBeLessThan(lento.expectedCostPerGreen);
    });

    test('sem evidência, o desempate continua sendo custo determinístico', () => {
      const models = [MODEL('a', 'caro', 'HIGH'), MODEL('b', 'barato', 'LOW')];
      const selected = selectForRole(models, { role: 'CODER', requiredCapabilities: ['CODE_GENERATION'] });
      expect(selected.selected.modelId).toBe('barato');
    });

    test('saída estruturalmente inválida recorrente sem sucesso é a pior faixa', () => {
      const evidence = new Map([[modelKey('qwen', 'coder-flash'), { attempts: 5, invalidFormat: 5 }]]);
      const score = scoreModel(MODEL('qwen', 'coder-flash', 'LOW'), evidence.get(modelKey('qwen', 'coder-flash')));
      expect(score.reliabilityTier).toBe(RELIABILITY_TIER.INVALID_OUTPUT);
      expect(score.invalidRate).toBe(1);
    });

    test('falha determinística NA EXECUÇÃO ATUAL reduz a prioridade daquele candidato', () => {
      const models = [MODEL('x', 'modelo-a', 'LOW'), MODEL('y', 'modelo-b', 'MEDIUM')];
      const clean = selectForRole(models, { role: 'CODER', requiredCapabilities: ['CODE_GENERATION'] });
      expect(clean.selected.modelId).toBe('modelo-a'); // mais barato, sem evidência

      const currentExecutionFailures = new Map([[modelKey('x', 'modelo-a'), { count: 1, kind: 'invalidFormat' }]]);
      const penalized = selectForRole(models, {
        role: 'CODER', requiredCapabilities: ['CODE_GENERATION'], currentExecutionFailures,
      });
      expect(penalized.selected.modelId).toBe('modelo-b');
      expect(currentExecutionPenalty({ providerId: 'x', modelId: 'modelo-a' }, currentExecutionFailures)).toBe(3);
    });
  });

  describe('Safety/Governance > Capability > Reliability > Cost', () => {
    test('capacidade é FILTRO: candidato comprovado sem a capability exigida não é selecionado', () => {
      const evidence = new Map([[modelKey('qwen', 'sem-capacidade'), { attempts: 3, applied: 3 }]]);
      const selected = selectForRole([
        MODEL('qwen', 'sem-capacidade', 'LOW', { capabilities: ['CHAT_ONLY'] }),
        MODEL('other', 'com-capacidade', 'HIGH'),
      ], { role: 'CODER', requiredCapabilities: ['CODE_GENERATION'], modelEvidence: evidence });
      expect(selected.selected.modelId).toBe('com-capacidade');
    });

    test('Safety vence confiabilidade: sem credencial, unhealthy ou modelo indisponível ficam de fora', () => {
      const evidence = new Map([
        [modelKey('proven', 'no-credential'), { attempts: 9, applied: 9 }],
        [modelKey('proven', 'unhealthy'), { attempts: 9, applied: 9 }],
        [modelKey('proven', 'unavailable'), { attempts: 9, applied: 9 }],
      ]);
      const selected = selectForRole([
        MODEL('proven', 'no-credential', 'LOW', { hasCredential: false }),
        MODEL('proven', 'unhealthy', 'LOW', { healthy: false }),
        MODEL('proven', 'unavailable', 'LOW', { available: false }),
        MODEL('safe', 'eligible', 'HIGH'),
      ], { role: 'CODER', requiredCapabilities: ['CODE_GENERATION'], modelEvidence: evidence });
      expect(selected.selected.modelId).toBe('eligible');
    });

    test('excluído na execução corrente continua excluído, mesmo comprovado', () => {
      const decision = selectCoderAndReviewer([MODEL('qwen', 'plus', 'LOW')], {
        coderCapabilities: ['CODE_GENERATION'],
        reviewerCapabilities: ['CODE_GENERATION'],
        excludedModelKeys: new Set(['qwen:plus']),
      });
      expect(decision.coder.selected).toBeNull();
      expect(decision.coder.reasonCodes).toContain(REASON_CODES.NO_QUALIFIED_CANDIDATE);
    });
  });

  describe('orçamento e anti-livelock (teto de tempo e orçamento restante)', () => {
    test('o teto de tempo da cadeia é 1800 s e nunca pode ser ultrapassado', () => {
      const budget = createProviderBudget();
      expect(budget.maxElapsedMs).toBe(1800000);
      budget.register({ providerElapsedMs: budget.maxElapsedMs, failureClass: 'PROVIDER_TIMEOUT' });
      expect(budget.exhausted()).toMatch(/orçamento de tempo de provider esgotado/);
      expect(budget.maxElapsedMs).toBeLessThanOrEqual(1800000);
    });

    test('nenhuma chamada individual pode ultrapassar o orçamento RESTANTE da cadeia', () => {
      const budget = createProviderBudget();
      const atStart = budget.remainingMs(Date.now(), { reserveMs: 0 });
      expect(atStart).toBeLessThanOrEqual(1800000);
      // Consumir quase todo o orçamento reduz o teto da próxima chamada.
      budget.register({ providerElapsedMs: budget.maxElapsedMs - 60000, failureClass: 'PROVIDER_ERROR' });
      const afterSpend = budget.remainingMs(Date.now(), { reserveMs: 0 });
      expect(afterSpend).toBeLessThanOrEqual(60000 + 1000);
      // Nunca negativo: orçamento esgotado ⇒ zero, e a cadeia encerra em estado terminal.
      budget.register({ providerElapsedMs: budget.maxElapsedMs * 2, failureClass: 'PROVIDER_ERROR' });
      expect(budget.remainingMs(Date.now(), { reserveMs: 0 })).toBe(0);
      expect(budget.exhausted()).not.toBeNull();
    });

    test('nenhum laço infinito: a cadeia termina em no máximo maxAttempts mesmo com candidatos comprovados', () => {
      const budget = createProviderBudget();
      let iterations = 0;
      while (iterations < 500) {
        if (budget.exhausted()) break;
        budget.register({ providerElapsedMs: 1, failureClass: 'PROVIDER_ERROR' });
        iterations += 1;
      }
      expect(iterations).toBe(budget.maxAttempts);
      expect(iterations).toBeLessThanOrEqual(12);
    });
  });
});
