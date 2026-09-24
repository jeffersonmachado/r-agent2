'use strict';

/**
 * Mission Recovery Coordinator — planejamento puro (§7, §8, §22).
 *
 * O requisito é recovery AUTOMÁTICO: crash → processo morre → aplicação reinicia → missões
 * incompletas descobertas → lease adquirido → execução continua do ponto seguro. Estes testes
 * provam o PLANO (o que é retomado, o que não é e por quê) sem depender de banco — a execução real
 * contra Postgres está em tests/integration/engineeringMissionBootRecovery.test.js.
 */

const coordinator = require('../../api/services/engineeringMission/missionRecoveryCoordinator');
const { RESUMABLE_MISSION_STATES, TERMINAL_MISSION_STATES, isTerminalMissionState } = require('../../engine/engineeringMission/constants');

describe('planRecovery — descoberta de trabalho abandonado', () => {
  test('CREATED/ENRICHING ⇒ re-enriquecer (a fase de enriquecimento não terminou)', () => {
    const plan = coordinator.planRecovery([
      { id: 'm1', status: 'CREATED' },
      { id: 'm2', status: 'ENRICHING' },
    ]);
    expect(plan).toEqual([
      { missionId: 'm1', status: 'CREATED', action: 'RE_ENRICH', reason: 'ENRICHMENT_INCOMPLETE' },
      { missionId: 'm2', status: 'ENRICHING', action: 'RE_ENRICH', reason: 'ENRICHMENT_INCOMPLETE' },
    ]);
  });

  test('APPROVED sem task ⇒ iniciar execução (aprovação humana foi perdida no crash)', () => {
    const plan = coordinator.planRecovery([{ id: 'm3', status: 'APPROVED', linked_task_id: null }]);
    expect(plan[0]).toMatchObject({ action: 'START_EXECUTION', reason: 'APPROVED_WITHOUT_TASK' });
  });

  test('EXECUTING ⇒ retomar a TASK existente, nunca só o status da missão (§8)', () => {
    const plan = coordinator.planRecovery([{ id: 'm4', status: 'EXECUTING', linked_task_id: 'task-9' }]);
    expect(plan[0]).toMatchObject({ action: 'RESUME_TASK', reason: 'EXECUTION_INTERRUPTED' });
    expect(plan[0].action).not.toBe('SKIP');
  });

  test('AWAITING_APPROVAL NÃO é retomada: espera decisão humana, não do coordenador', () => {
    const plan = coordinator.planRecovery([{ id: 'm5', status: 'AWAITING_APPROVAL' }]);
    expect(plan[0]).toMatchObject({ action: 'SKIP', reason: 'STATUS_NOT_RESUMABLE' });
  });

  test('BLOCKED e DEGRADED também não são retomadas automaticamente', () => {
    const plan = coordinator.planRecovery([
      { id: 'm6', status: 'BLOCKED' },
      { id: 'm7', status: 'DEGRADED' },
    ]);
    expect(plan.every((step) => step.action === 'SKIP')).toBe(true);
  });

  test('estados terminais nunca entram no plano de retomada', () => {
    const plan = coordinator.planRecovery(TERMINAL_MISSION_STATES.map((status, idx) => ({ id: `t${idx}`, status })));
    expect(plan.every((step) => step.action === 'SKIP')).toBe(true);
  });

  test('o plano cobre EXATAMENTE os estados retomáveis (nenhum a mais, nenhum a menos)', () => {
    const resumable = RESUMABLE_MISSION_STATES.map((status, idx) => ({ id: `r${idx}`, status, linked_task_id: status === 'EXECUTING' ? 'task-1' : null }));
    const plan = coordinator.planRecovery(resumable);
    expect(plan.filter((s) => s.action !== 'SKIP')).toHaveLength(RESUMABLE_MISSION_STATES.length);
    // E o complemento: todo estado terminal é não-retomável por definição.
    for (const status of TERMINAL_MISSION_STATES) expect(isTerminalMissionState(status)).toBe(true);
  });

  test('TODA decisão carrega motivo — nada é descartado em silêncio', () => {
    const plan = coordinator.planRecovery([
      { id: 'a', status: 'CREATED' },
      { id: 'b', status: 'AWAITING_APPROVAL' },
      { id: 'c', status: 'GREEN' },
    ]);
    for (const step of plan) expect(typeof step.reason).toBe('string');
    expect(plan.every((step) => step.reason.length > 0)).toBe(true);
  });
});

describe('recovery — configuração e ciclo', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env.ENGINEERING_MISSION_RECOVERY_ENABLED = original.ENGINEERING_MISSION_RECOVERY_ENABLED;
    process.env.NODE_ENV = original.NODE_ENV;
  });

  test('desligado explicitamente ⇒ nenhuma varredura (e o motivo é dito)', async () => {
    process.env.ENGINEERING_MISSION_RECOVERY_ENABLED = '0';
    expect(coordinator.recoveryEnabled()).toBe(false);
    const result = await coordinator.runBootRecovery();
    expect(result).toEqual({ skipped: true, reason: 'RECOVERY_DISABLED' });
  });

  test('default: ligado fora de teste, desligado em NODE_ENV=test (sem timer surpresa no Jest)', () => {
    delete process.env.ENGINEERING_MISSION_RECOVERY_ENABLED;
    process.env.NODE_ENV = 'test';
    expect(coordinator.recoveryEnabled()).toBe(false);
    process.env.NODE_ENV = 'development';
    expect(coordinator.recoveryEnabled()).toBe(true);
    process.env.ENGINEERING_MISSION_RECOVERY_ENABLED = '1';
    process.env.NODE_ENV = 'test';
    expect(coordinator.recoveryEnabled()).toBe(true);
  });

  test('identidade do worker é de INSTÂNCIA (nunca a identidade antiga baseada em PID)', () => {
    expect(coordinator.INSTANCE_ID).toMatch(/^recovery-/);
    expect(coordinator.INSTANCE_ID).toContain(require('os').hostname());
    // A identidade antiga era `mission-compiler-<pid>` — exatamente o que não pode ser autoridade.
    expect(coordinator.INSTANCE_ID).not.toMatch(/^mission-compiler-\d+$/);
  });

  test('WORKER_INSTANCE_ID explícito é honrado (identidade estável por container/orquestrador)', () => {
    const previous = process.env.ENGINEERING_MISSION_WORKER_INSTANCE_ID;
    process.env.ENGINEERING_MISSION_WORKER_INSTANCE_ID = 'container-id-fixo-123';
    jest.resetModules();
    const reloaded = require('../../api/services/engineeringMission/missionRecoveryCoordinator');
    if (previous === undefined) delete process.env.ENGINEERING_MISSION_WORKER_INSTANCE_ID;
    else process.env.ENGINEERING_MISSION_WORKER_INSTANCE_ID = previous;
    jest.resetModules();
    expect(reloaded.INSTANCE_ID).toBe('container-id-fixo-123');
  });
});
