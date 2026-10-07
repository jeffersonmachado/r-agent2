'use strict';

/**
 * HUMAN_EXTERNAL_BOOTSTRAP (2026-10-07) — POLÍTICA DE EXECUÇÃO do Roteador Engenheiro.
 *
 * Autorizado explicitamente como evolução CONTROLADA da política de execução (não é afrouxamento
 * de gate): `maxProviderAttempts` 6 → 12 e deadline de provider de 120 s → 300 s SOMENTE para
 * `purpose=engineering_*`, mais o comportamento cost-aware/failure-aware da cadeia.
 *
 * Motivação medida (runtime real): a cadeia esgotava em 6/6 tentativas com 357 s de tempo AINDA
 * disponíveis, antes de alcançar um coder viável — e `qwen3-coder-plus` produziu um diff VÁLIDO em
 * 25 s para o MESMO prompt do INC-2. Estes testes provam que: a cadeia pode passar de 6 tentativas,
 * NUNCA passa do novo teto, 429/quota não repete o mesmo modelo, timeout progride, falha estrutural
 * de patch progride, modelo comprovado por evidência pode ser priorizado e nenhum laço infinito é
 * possível.
 */

const { createProviderBudget, patchApplyRerouteAfter, failureSignature } = require('../../api/services/engineeringRouter/engineeringRouterService');
const { engineeringProviderTimeoutMs, ENGINEERING_PURPOSE_TIMEOUT_MS } = require('../../api/services/engineeringRouter/engineeringAiInvoker');
const { classifyModelFailure, UNUSABLE_STATES } = require('../../api/services/engineeringRouter/modelAvailabilityStore');
const { selectForRole, selectCoderAndReviewer } = require('../../engine/engineeringRouter/modelSelector');
const { resolvePolicy } = require('../../api/utils/operationDeadline');
const { REASON_CODES, FAILURE_CODES } = require('../../engine/engineeringRouter/constants');

const CODER_MODEL = (providerId, modelId, costClass) => ({
  providerId, modelId, costClass, contextClass: 'LONG',
  roles: ['CODER'], capabilities: ['CODE_GENERATION'], enabled: true, healthy: true, hasCredential: true,
});

describe('HUMAN_EXTERNAL_BOOTSTRAP — política de execução da cadeia de providers', () => {
  describe('orçamento da cadeia (tentativas e tempo)', () => {
    test('a cadeia pode ULTRAPASSAR 6 tentativas quando necessário', () => {
      const budget = createProviderBudget();
      // O limite antigo (6) não pode mais encerrar a cadeia: 1..6 falhas continuam dentro do teto.
      for (let i = 1; i <= 6; i += 1) {
        expect(budget.exhausted()).toBeNull();
        budget.register({ providerElapsedMs: 100, failureClass: 'PROVIDER_ERROR' });
      }
      expect(budget.failedAttempts).toBe(6);
      expect(budget.exhausted()).toBeNull();

      budget.register({ providerElapsedMs: 100, failureClass: 'PROVIDER_ERROR' });
      expect(budget.failedAttempts).toBe(7);
      expect(budget.exhausted()).toBeNull();
      budget.register({ providerElapsedMs: 100, failureClass: 'PROVIDER_ERROR' });
      expect(budget.exhausted()).toBeNull();
    });

    test('NUNCA ultrapassa o novo teto: esgota exatamente no limite do registry (12)', () => {
      const budget = createProviderBudget();
      expect(budget.maxAttempts).toBe(12);
      for (let i = 1; i < budget.maxAttempts; i += 1) {
        budget.register({ providerElapsedMs: 1, failureClass: 'PROVIDER_ERROR' });
        expect(budget.exhausted()).toBeNull();
      }
      budget.register({ providerElapsedMs: 1, failureClass: 'PROVIDER_ERROR' });
      expect(budget.failedAttempts).toBe(budget.maxAttempts);
      expect(budget.exhausted()).toMatch(/tentativas de provider esgotadas \(12\/12\)/);
    });

    test('o orçamento de TEMPO continua sendo guarda final (nada virou retry cego)', () => {
      const budget = createProviderBudget();
      budget.register({ providerElapsedMs: budget.maxElapsedMs + 1, failureClass: 'PROVIDER_TIMEOUT' });
      expect(budget.exhausted()).toMatch(/orçamento de tempo de provider esgotado/);
    });

    test('nenhum laço infinito é possível: iterar respeitando exhausted() termina em no máximo maxAttempts', () => {
      const budget = createProviderBudget();
      let iterations = 0;
      while (iterations < 1000) {
        if (budget.exhausted()) break;
        budget.register({ providerElapsedMs: 1, failureClass: 'PROVIDER_ERROR' });
        iterations += 1;
      }
      expect(iterations).toBe(budget.maxAttempts);
      expect(iterations).toBeLessThanOrEqual(12);
    });
  });

  describe('deadline de provider por propósito', () => {
    test('engineering_* recebe o deadline ampliado; outros propósitos mantêm o default', () => {
      expect(engineeringProviderTimeoutMs('engineering_coder')).toBe(ENGINEERING_PURPOSE_TIMEOUT_MS);
      expect(engineeringProviderTimeoutMs('engineering_reviewer')).toBe(ENGINEERING_PURPOSE_TIMEOUT_MS);
      expect(ENGINEERING_PURPOSE_TIMEOUT_MS).toBe(300000);
      // Fora da engenharia o override é NULO: a política global (120 s) permanece intacta.
      expect(engineeringProviderTimeoutMs('chat')).toBeNull();
      expect(engineeringProviderTimeoutMs('rag_embedding')).toBeNull();
      expect(engineeringProviderTimeoutMs(undefined)).toBeNull();
    });

    test('o override é aceito pela política real e o default global NÃO mudou', () => {
      expect(resolvePolicy('PROVIDER_REQUEST').resolved).toBe(120000);
      expect(resolvePolicy('PROVIDER_REQUEST', { override: engineeringProviderTimeoutMs('engineering_coder') }).resolved).toBe(300000);
    });

    test('o valor ampliado continua dentro do máximo declarado da política (900 s)', () => {
      const policy = resolvePolicy('PROVIDER_REQUEST');
      expect(ENGINEERING_PURPOSE_TIMEOUT_MS).toBeLessThanOrEqual(policy.max);
    });
  });

  describe('classificação failure-aware', () => {
    test('429 por FALTA DE CRÉDITO não é tratado como rate limit transitório', () => {
      const noCredit = classifyModelFailure({ httpStatus: 429, message: '429 You have no credits remaining. Add credits to continue using the API.' });
      expect(noCredit.state).toBe('NO_CREDIT');
      const exhausted = classifyModelFailure({ httpStatus: 429, message: '{"code":"credit_balance_exhausted"}' });
      expect(exhausted.state).toBe('NO_CREDIT');
    });

    test('429 de rate limit real continua transitório, e todos são inutilizáveis na janela', () => {
      const rateLimited = classifyModelFailure({ httpStatus: 429, message: '429 rate limit exceeded' });
      expect(rateLimited.state).toBe('RATE_LIMITED');
      expect(UNUSABLE_STATES.has('NO_CREDIT')).toBe(true);
      expect(UNUSABLE_STATES.has('RATE_LIMITED')).toBe(true);
    });
  });

  describe('prioridade por EVIDÊNCIA histórica (nunca por nome fixo)', () => {
    const models = [
      CODER_MODEL('qwen', 'qwen3-coder-flash', 'LOW'),
      CODER_MODEL('qwen', 'qwen3-coder-plus', 'MEDIUM'),
      CODER_MODEL('kimi', 'kimi-k3', 'HIGH'),
    ];

    test('sem evidência, a seleção determinística continua sendo a mais barata qualificada', () => {
      const result = selectForRole(models, { role: 'CODER', requiredCapabilities: ['CODE_GENERATION'] });
      expect(result.selected.modelId).toBe('qwen3-coder-flash');
      expect(result.reasonCodes).toContain(REASON_CODES.LOWER_COST_AMONG_QUALIFIED);
    });

    test('com evidência de patch aplicado, o modelo COMPROVADO passa à frente e o motivo fica registrado', () => {
      const result = selectForRole(models, {
        role: 'CODER',
        requiredCapabilities: ['CODE_GENERATION'],
        preferredModelKeys: new Set(['qwen:qwen3-coder-plus']),
      });
      expect(result.selected.modelId).toBe('qwen3-coder-plus');
      expect(result.reasonCodes).toContain(REASON_CODES.PROVEN_FOR_TASK_CLASS);
    });

    test('excluídos continuam excluídos mesmo sendo comprovados (evidência não reabre modelo excluído)', () => {
      const decision = selectCoderAndReviewer(models, {
        coderCapabilities: ['CODE_GENERATION'],
        reviewerCapabilities: ['CODE_GENERATION'],
        preferredCoderModelKeys: new Set(['qwen:qwen3-coder-plus']),
        excludedModelKeys: new Set(['qwen:qwen3-coder-plus']),
      });
      expect(decision.coder.selected.modelId).not.toBe('qwen3-coder-plus');
    });
  });

  describe('progression em falhas determinísticas (sem retry inútil)', () => {
    test('falha de FORMATO de patch progride IMEDIATAMENTE (nunca repete o mesmo coder)', () => {
      const previous = process.env.ENGINEERING_PATCH_APPLY_REROUTE_AFTER;
      try {
        delete process.env.ENGINEERING_PATCH_APPLY_REROUTE_AFTER;
        // Corpo sem prefixo: defeito ESTRUTURAL do gerador (10/10 patches do mesmo modelo) — limiar 1.
        expect(patchApplyRerouteAfter('PATCH_NOT_APPLICABLE', 'PATCH_BODY_MISSING_PREFIX')).toBe(1);
        // Conflito de contexto/contagem: ganha UMA repeticao informada (o erro entra no contexto).
        expect(patchApplyRerouteAfter('PATCH_NOT_APPLICABLE', 'PATCH_APPLY_FAILED')).toBe(2);
        // Demais falhas mantem o limiar conservador.
        expect(patchApplyRerouteAfter(null, null)).toBe(2);
        // A env continua sendo override EXPLÍCITO para operação.
        process.env.ENGINEERING_PATCH_APPLY_REROUTE_AFTER = '2';
        expect(patchApplyRerouteAfter('PATCH_NOT_APPLICABLE', 'PATCH_BODY_MISSING_PREFIX')).toBe(2);
      } finally {
        if (previous === undefined) delete process.env.ENGINEERING_PATCH_APPLY_REROUTE_AFTER;
        else process.env.ENGINEERING_PATCH_APPLY_REROUTE_AFTER = previous;
      }
    });

    test('assinatura de falha distingue LACO de progresso (mesma falha repetida vs erro diferente)', () => {
      const sameA = failureSignature({ failedCommand: 'TEST_STAGE', code: 'TEST_FAIL', stderr: 'suite mathUtils falhou: add is not a function' });
      const sameB = failureSignature({ failedCommand: 'TEST_STAGE', code: 'TEST_FAIL', stderr: 'suite mathUtils falhou: add is not a function' });
      const different = failureSignature({ failedCommand: 'TEST_STAGE', code: 'TEST_FAIL', stderr: 'suite mathUtils falhou: outra coisa totalmente diferente' });
      const otherPhase = failureSignature({ failedCommand: 'PATCH_APPLY', code: 'PATCH_APPLY_FAILED', stderr: 'x' });

      expect(sameA).toBe(sameB);            // mesma falha ⇒ mesma assinatura (laco detectavel)
      expect(different).not.toBe(sameA);    // erro diferente ⇒ assinatura diferente (progresso)
      expect(otherPhase).not.toBe(sameA);
      // Reroute NAO e falha de merito: nunca conta para o laco.
      expect(failureSignature({ failedCommand: 'CODER_REROUTE' })).toBeNull();
      expect(failureSignature(null)).toBeNull();
    });

    test('falha determinística exclui o candidato e o próximo assume; repetição só até o teto', () => {
      const models = [
        CODER_MODEL('qwen', 'a', 'LOW'),
        CODER_MODEL('qwen', 'b', 'LOW'),
        CODER_MODEL('kimi', 'c', 'LOW'),
      ];
      const excluded = new Set();
      const visited = [];
      // Simula a cadeia real: cada falha determinística exclui o modelo e reseleciona.
      for (let i = 0; i < 3; i += 1) {
        const result = selectForRole(models, { role: 'CODER', requiredCapabilities: ['CODE_GENERATION'], excludedModelKeys: excluded });
        expect(result.selected).toBeTruthy();
        const key = `${result.selected.providerId}:${result.selected.modelId}`;
        expect(visited).not.toContain(key); // NUNCA repete o mesmo modelo já falhado
        visited.push(key);
        excluded.add(key);
      }
      expect(visited).toHaveLength(3);
      expect(new Set(visited).size).toBe(3); // os três candidatos, cada um UMA vez
      expect([...visited].sort()).toEqual(['kimi:c', 'qwen:a', 'qwen:b']);
      // Esgotados os candidatos, a cadeia termina de forma terminal — nunca em laço.
      const exhausted = selectForRole(models, { role: 'CODER', requiredCapabilities: ['CODE_GENERATION'], excludedModelKeys: excluded });
      expect(exhausted.selected).toBeNull();
      expect(exhausted.reasonCodes).toContain(REASON_CODES.NO_QUALIFIED_CANDIDATE);
    });

    test('as classes de falha que a cadeia trata como progression estão nomeadas e estáveis', () => {
      // Contratos consumidos pelo laço do Router — mudar isto sem mudar o laço quebra a progression.
      expect(FAILURE_CODES.PATCH_BODY_MISSING_PREFIX).toBe('PATCH_BODY_MISSING_PREFIX');
      expect(FAILURE_CODES.PATCH_APPLY_FAILED).toBe('PATCH_APPLY_FAILED');
      expect(FAILURE_CODES.PROVIDER_UNAVAILABLE).toBe('PROVIDER_UNAVAILABLE');
      expect(FAILURE_CODES.PROVIDER_EXHAUSTED).toBe('PROVIDER_EXHAUSTED');
    });
  });
});
