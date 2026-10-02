'use strict';

/**
 * tests/unit/engineeringMission/workerHealth.test.js
 *
 * PROVA que a saúde de um worker OBRIGATÓRIO não pode ser confundida com "tem timer?".
 *
 * DEFEITO QUE ESTE TESTE TRAVA (confirmado no código em 2026-10-02): `startWorkers.js` iniciava o
 * worker do laço de bugs com `catch { logger.warn('... (ignorado)') }`. Com o Engineer Router ativo,
 * o subsistema ficava SEM o worker que processa findings e sua saúde continuava normal. Um worker
 * vivo mas travado (sem ciclos) tinha o mesmo destino: invisível.
 */

const {
  WORKER_STATES,
  deriveWorkerState,
  assessEngineeringReadiness,
} = require('../../../engine/engineeringMission/workerHealth');

describe('workerHealth — saúde de worker obrigatório', () => {
  describe('deriveWorkerState', () => {
    test('worker iniciado e produzindo ciclos é RUNNING', () => {
      const now = 1_000_000;
      const result = deriveWorkerState({
        started: true, startedAtMs: now - 5000, nowMs: now, lastCycleAtMs: now - 1000, staleAfterMs: 60000,
      });
      expect(result.health).toBe('RUNNING');
      expect(result.healthy).toBe(true);
      expect(result.stuck).toBe(false);
    });

    test('FALHA DE START é DOWN — nunca um aviso silencioso', () => {
      const result = deriveWorkerState({ started: false, startError: 'EADDRINUSE na porta do worker' });
      expect(result.health).toBe('DOWN');
      expect(result.code).toBe('WORKER_START_FAILED');
      expect(result.reason).toMatch(/seguiu como se estivesse saudável/);
      expect(result.healthy).toBe(false);
    });

    test('DOWN vence STOPPED: uma falha declarada é mais informativa que a ausência', () => {
      const result = deriveWorkerState({ started: false, startError: 'boom' });
      expect(result.health).toBe('DOWN');
      expect(result.health).not.toBe('STOPPED');
    });

    test('worker VIVO mas SEM CICLOS além da janela é DEGRADED/STUCK — processo de pé ≠ capacidade', () => {
      const now = 1_000_000;
      const result = deriveWorkerState({
        started: true, startedAtMs: now - 600000, nowMs: now, lastCycleAtMs: now - 600000, staleAfterMs: 60000,
      });
      expect(result.health).toBe('DEGRADED');
      expect(result.stuck).toBe(true);
      expect(result.code).toBe('WORKER_STUCK_NO_CYCLES');
      expect(result.silentMs).toBeGreaterThan(60000);
    });

    test('silêncio DENTRO da janela tolerada não é degradação', () => {
      const now = 1_000_000;
      const result = deriveWorkerState({
        started: true, startedAtMs: now - 10000, nowMs: now, lastCycleAtMs: now - 10000, staleAfterMs: 60000,
      });
      expect(result.health).toBe('RUNNING');
      expect(result.stuck).toBe(false);
    });

    test('erros consecutivos acima do limite degradam (roda, mas não conclui)', () => {
      const result = deriveWorkerState({ started: true, nowMs: 1_000_000, lastCycleAtMs: 999_000, consecutiveErrors: 5, staleAfterMs: 60000 });
      expect(result.health).toBe('DEGRADED');
      expect(result.code).toBe('WORKER_CONSECUTIVE_ERRORS');
    });

    test('um erro isolado NÃO degrada o worker', () => {
      const result = deriveWorkerState({ started: true, nowMs: 1_000_000, lastCycleAtMs: 999_000, consecutiveErrors: 1, staleAfterMs: 60000 });
      expect(result.health).toBe('RUNNING');
    });

    test('desabilitado por política NÃO é falha — é ausência declarada', () => {
      const result = deriveWorkerState({ enabledByPolicy: false, started: false });
      expect(result.health).toBe('DISABLED_BY_POLICY');
      expect(result.code).toBe('WORKER_DISABLED_BY_POLICY');
      expect(result.reason).toMatch(/ausência declarada, não falha/);
    });

    test('política vence a falha de start (desabilitado não é DOWN)', () => {
      const result = deriveWorkerState({ enabledByPolicy: false, started: false, startError: 'boom' });
      expect(result.health).toBe('DISABLED_BY_POLICY');
    });

    test('o vocabulário é FECHADO — todo retorno é um estado declarado', () => {
      const cases = [
        {},
        { started: true },
        { started: false, startError: 'x' },
        { enabledByPolicy: false },
        { started: true, nowMs: 1e9, startedAtMs: 0, staleAfterMs: 10 },
        { started: true, consecutiveErrors: 99 },
      ];
      for (const c of cases) {
        expect(WORKER_STATES).toContain(deriveWorkerState(c).health);
      }
    });
  });

  describe('assessEngineeringReadiness', () => {
    test('worker obrigatório DOWN torna a engenharia NO_GO', () => {
      const verdict = assessEngineeringReadiness({
        requiredWorkers: [{ type: 'BUG_LOOP', health: 'DOWN', code: 'WORKER_START_FAILED' }],
        engineerRouterEnabled: true,
      });
      expect(verdict.readiness).toBe('NO_GO');
      expect(verdict.code).toBe('ENGINEERING_REQUIRED_WORKER_DOWN');
      expect(verdict.blocking).toHaveLength(1);
      expect(verdict.reason).toMatch(/não pode aparecer saudável/);
    });

    test('worker obrigatório DEGRADED torna a engenharia DEGRADED (não NO_GO)', () => {
      const verdict = assessEngineeringReadiness({
        requiredWorkers: [{ type: 'BUG_LOOP', health: 'DEGRADED' }], engineerRouterEnabled: true,
      });
      expect(verdict.readiness).toBe('DEGRADED');
      expect(verdict.blocking).toHaveLength(0);
      expect(verdict.degraded).toHaveLength(1);
    });

    test('worker obrigatório apenas STOPPED também degrada', () => {
      const verdict = assessEngineeringReadiness({
        requiredWorkers: [{ type: 'BUG_LOOP', health: 'STOPPED' }], engineerRouterEnabled: true,
      });
      expect(verdict.readiness).toBe('DEGRADED');
    });

    test('DESLIGADO por política não torna a engenharia não-saudável', () => {
      const verdict = assessEngineeringReadiness({
        requiredWorkers: [{ type: 'BUG_LOOP', health: 'DISABLED_BY_POLICY' }], engineerRouterEnabled: true,
      });
      expect(verdict.readiness).toBe('GREEN');
    });

    test('todos saudáveis ⇒ GREEN', () => {
      const verdict = assessEngineeringReadiness({
        requiredWorkers: [{ type: 'BUG_LOOP', health: 'RUNNING' }], engineerRouterEnabled: true,
      });
      expect(verdict.readiness).toBe('GREEN');
      expect(verdict.code).toBeNull();
    });

    test('subsistema de engenharia DESABILITADO não exige worker nenhum', () => {
      const verdict = assessEngineeringReadiness({
        requiredWorkers: [{ type: 'BUG_LOOP', health: 'DOWN' }], engineerRouterEnabled: false,
      });
      expect(verdict.readiness).toBe('GREEN');
    });

    test('DOWN vence DEGRADED quando os dois coexistem', () => {
      const verdict = assessEngineeringReadiness({
        requiredWorkers: [{ type: 'A', health: 'DEGRADED' }, { type: 'B', health: 'DOWN' }],
        engineerRouterEnabled: true,
      });
      expect(verdict.readiness).toBe('NO_GO');
      expect(verdict.degraded).toHaveLength(1);
      expect(verdict.blocking).toHaveLength(1);
    });
  });
});
