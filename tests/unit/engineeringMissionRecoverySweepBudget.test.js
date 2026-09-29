/**
 * engineeringMissionRecoverySweepBudget.test.js — a VARREDURA de retomada tem ORÇAMENTO.
 *
 * DEFEITO MEDIDO (2026-09-28, banco real): `resumeInterruptedMissions` processa TODOS os itens da
 * página, um a um, sem orçamento de operação. Com 26 missões resumíveis no banco cada varredura
 * levou **31,5 s** (≈1,2 s por missão) e a suíte de integração — que chama a varredura duas vezes —
 * estourou o próprio timeout de 60 s. O mesmo caminho roda no BOOT: um backlog grande atrasa a
 * subida sem limite declarado.
 *
 * Contrato provado aqui:
 *   1. o orçamento vem do REGISTRY (`config/timeout-policy.json`, política `RECOVERY_SWEEP`) —
 *      nunca de um número solto no código;
 *   2. ao esgotar, a varredura PARA e DECLARA o truncamento (`truncated`, `processed`, `remaining`)
 *      em vez de continuar por tempo indefinido ou fingir que terminou;
 *   3. esgotar orçamento NÃO é erro: o trabalho já feito é válido e o chamador continua no próximo
 *      ciclo (nada é perdido — a missão continua resumível);
 *   4. sem orçamento declarado, o comportamento anterior (processar a página) é preservado.
 */
'use strict';

jest.mock('../../api/services/engineeringMission/missionStoreService', () => ({
  findResumableMissions: jest.fn(),
  mergeMissionJson: jest.fn(),
  getMissionLease: jest.fn(),
}));
jest.mock('../../api/services/engineeringMission/missionCompilerService', () => ({ enrichMission: jest.fn() }));
jest.mock('../../api/services/engineeringMission/missionApprovalService', () => ({}));
jest.mock('../../api/services/engineeringMission/missionReviewService', () => ({}));
jest.mock('../../api/services/engineeringMission/taskSpecBindingService', () => ({}));
jest.mock('../../api/services/engineeringMission/missionEvents', () => ({ emitMissionStage: jest.fn(async () => ({})) }));
jest.mock('../../api/services/engineeringRouter/engineeringTaskService', () => ({}));
jest.mock('../../api/services/engineeringRouter/engineeringRouterService', () => ({ runTask: jest.fn(async () => ({})) }));

const store = require('../../api/services/engineeringMission/missionStoreService');
const compiler = require('../../api/services/engineeringMission/missionCompilerService');
const orchestrator = require('../../api/services/engineeringMission/missionOrchestratorService');
const { resolvePolicy, policyMs } = require('../../api/utils/operationDeadline');

/** N missões ENRICHING; cada enriquecimento custa `costMs`. */
function pendingMissions(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `mission-${index}`,
    status: 'ENRICHING',
    updated_at: new Date().toISOString(),
  }));
}

function slowEnrich(costMs) {
  return jest.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, costMs));
    return { ok: true };
  });
}

describe('revary sweep — orçamento de operação (missão 2026-09-28)', () => {
  jest.setTimeout(60000);

  // `jest.config.cjs` tem `resetMocks: true`: as implementações declaradas na factory do mock são
  // APAGADAS antes de cada teste. Reinstalar aqui é obrigatório — sem isso o teste media o mock, não
  // o serviço.
  beforeEach(() => {
    store.mergeMissionJson.mockImplementation(async () => ({}));
    store.getMissionLease.mockResolvedValue(null);
  });

  test('a política RECOVERY_SWEEP existe no REGISTRY (não é número solto no código)', () => {
    const policy = resolvePolicy('RECOVERY_SWEEP');
    expect(policy).toBeDefined();
    expect(policy.category).toBe('OPERATION_DEADLINE');
    // Valor FINITO e positivo — nunca `undefined`, que passaria despercebido em comparações
    // (`undefined >= undefined` é false) e faria o orçamento nunca disparar.
    expect(policyMs('RECOVERY_SWEEP')).toBe(20000);
    expect(resolvePolicy('RECOVERY_SWEEP').onExpiry).toBe('TRUNCATE_AND_CONTINUE');
  });

  test('sem orçamento declarado: processa a página inteira (comportamento preservado)', async () => {
    store.findResumableMissions.mockResolvedValue(pendingMissions(4));
    compiler.enrichMission.mockImplementation(slowEnrich(5));

    const summary = await orchestrator.resumeInterruptedMissions({ tenantId: 'system', autoStart: false, budgetMs: null });
    expect(summary.enriched).toBe(4);
    expect(summary.truncated).toBeFalsy();
  });

  test('com orçamento: PARA no meio, DECLARA o truncamento e preserva o trabalho feito', async () => {
    const total = 20;
    store.findResumableMissions.mockResolvedValue(pendingMissions(total));
    compiler.enrichMission.mockImplementation(slowEnrich(25));

    const started = Date.now();
    const summary = await orchestrator.resumeInterruptedMissions({ tenantId: 'system', autoStart: false, budgetMs: 150 });
    const elapsed = Date.now() - started;

    expect(summary.truncated).toBe(true);
    expect(summary.budgetMs).toBe(150);
    expect(summary.processed).toBeGreaterThan(0);
    expect(summary.processed).toBeLessThan(total);
    expect(summary.remaining).toBe(total - summary.processed);
    // NÃO varreu a página inteira (20 × 25 ms = 500 ms): o orçamento foi o que mandou.
    expect(elapsed).toBeLessThan(400);
    // O trabalho já feito NÃO é descartado nem vira erro.
    expect(summary.enriched).toBe(summary.processed);
    expect(summary.failed).toBe(0);
  });

  test('orçamento padrão vem da política, e é declarado no resumo (rastreável)', async () => {
    store.findResumableMissions.mockResolvedValue(pendingMissions(3));
    compiler.enrichMission.mockImplementation(slowEnrich(5));

    const summary = await orchestrator.resumeInterruptedMissions({ tenantId: 'system', autoStart: false });
    // Ancorado no REGISTRY (número finito), não em si mesmo: comparar com `undefined` esconderia
    // um orçamento que nunca dispara.
    expect(summary.budgetMs).toBe(policyMs('RECOVERY_SWEEP'));
    expect(Number.isFinite(summary.budgetMs)).toBe(true);
    expect(summary.truncated).toBe(false);
  });

  test('orçamento esgotado com falhas anteriores NÃO esconde as falhas contabilizadas', async () => {
    store.findResumableMissions.mockResolvedValue(pendingMissions(10));
    compiler.enrichMission
      .mockRejectedValueOnce(Object.assign(new Error('policy escalation'), { code: 'POLICY_ESCALATION_DENIED' }))
      .mockImplementation(slowEnrich(30));

    const summary = await orchestrator.resumeInterruptedMissions({ tenantId: 'system', autoStart: false, budgetMs: 100 });
    expect(summary.failed).toBe(1);
    expect(summary.truncated).toBe(true);
    expect(summary.items.some((item) => item.action === 'FAILED')).toBe(true);
  });
});
