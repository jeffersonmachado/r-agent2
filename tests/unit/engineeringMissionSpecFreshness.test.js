'use strict';

/**
 * STALE_MISSION_SPEC — motor puro de frescor do vínculo task↔MissionSpec.
 *
 * Achado real (medido em 2026-09-25): `EngineeringTask` não tinha vínculo algum com a versão da
 * MissionSpec. A cobertura existente (TEST 40) valida que a APROVAÇÃO de v1 não autoriza v2 — ou
 * seja, o gating de ENTRADA da missão. O que não existia era defesa para a task que JÁ está em
 * execução: ela seguia em CODING→TESTING→REVIEWING→REGRESSION→GOVERNANCE→PROMOTING (efeito real no
 * git) sobre contrato obsoleto.
 *
 * Este teste fixa a decisão: estado + ESTRATÉGIA explícita, nunca abandono silencioso.
 */

const {
  assessSpecFreshness,
  canRunMaterialPhase,
  SPEC_STATES,
  SPEC_STRATEGIES,
} = require('../../engine/engineeringMission/missionSpecFreshness');

const SPEC_V1 = Object.freeze({ version: 1, specHash: 'hash-v1' });
const SPEC_V2 = Object.freeze({ version: 2, specHash: 'hash-v2' });
const BINDING_V1 = Object.freeze({ missionId: 'm-1', taskId: 't-1', missionVersion: 1, specHash: 'hash-v1' });

describe('assessSpecFreshness — vínculo task↔MissionSpec', () => {
  describe('CURRENT', () => {
    it('vínculo confere com a versão corrente ⇒ PROCEED', () => {
      const a = assessSpecFreshness({ binding: BINDING_V1, currentSpec: SPEC_V1, taskStatus: 'CODING', activeTaskId: 't-1' });
      expect(a.state).toBe(SPEC_STATES.CURRENT);
      expect(a.strategy).toBe(SPEC_STRATEGIES.PROCEED);
      expect(canRunMaterialPhase(a)).toBe(true);
    });

    it('PROCEED não depende de estar em fase material', () => {
      const a = assessSpecFreshness({ binding: BINDING_V1, currentSpec: SPEC_V1, taskStatus: 'ROUTED', activeTaskId: 't-1' });
      expect(a.strategy).toBe(SPEC_STRATEGIES.PROCEED);
    });
  });

  describe('SUPERSEDED por versão mais nova', () => {
    it('task não-material ⇒ SUPERSEDE (substituir, não abandonar)', () => {
      const a = assessSpecFreshness({ binding: BINDING_V1, currentSpec: SPEC_V2, taskStatus: 'ROUTED', activeTaskId: 't-1' });
      expect(a.state).toBe(SPEC_STATES.SUPERSEDED);
      expect(a.strategy).toBe(SPEC_STRATEGIES.SUPERSEDE);
      expect(a.material).toBe(false);
      expect(canRunMaterialPhase(a)).toBe(false);
      expect(a.reason).toMatch(/v1/);
      expect(a.reason).toMatch(/v2/);
    });

    it.each(['CODING', 'TESTING', 'REVIEWING', 'REGRESSION', 'GOVERNANCE', 'PROMOTING', 'POST_PROMOTION_VERIFY', 'READY_FOR_PROMOTION'])(
      'task material em %s ⇒ RECONCILE (nunca destrói trabalho real em silêncio)',
      (status) => {
        const a = assessSpecFreshness({ binding: BINDING_V1, currentSpec: SPEC_V2, taskStatus: status, activeTaskId: 't-1' });
        expect(a.state).toBe(SPEC_STATES.SUPERSEDED);
        expect(a.strategy).toBe(SPEC_STRATEGIES.RECONCILE);
        expect(a.material).toBe(true);
        expect(canRunMaterialPhase(a)).toBe(false);
      },
    );

    it('task já terminal não exige estratégia (resultado é histórico)', () => {
      const a = assessSpecFreshness({ binding: BINDING_V1, currentSpec: SPEC_V2, taskStatus: 'GREEN', activeTaskId: 't-1' });
      expect(a.state).toBe(SPEC_STATES.SUPERSEDED);
      expect(a.strategy).toBe(SPEC_STRATEGIES.PROCEED);
    });
  });

  describe('SUPERSEDED por substituição da task', () => {
    it('a missão aponta para OUTRA task ⇒ CANCEL', () => {
      const a = assessSpecFreshness({ binding: BINDING_V1, currentSpec: SPEC_V1, taskStatus: 'CODING', activeTaskId: 't-2' });
      expect(a.state).toBe(SPEC_STATES.SUPERSEDED);
      expect(a.strategy).toBe(SPEC_STRATEGIES.CANCEL);
      expect(a.evidence.activeTaskId).toBe('t-2');
    });

    it('task substituída mas já terminal ⇒ PROCEED (nada a executar)', () => {
      const a = assessSpecFreshness({ binding: BINDING_V1, currentSpec: SPEC_V1, taskStatus: 'CANCELLED', activeTaskId: 't-2' });
      expect(a.strategy).toBe(SPEC_STRATEGIES.PROCEED);
    });
  });

  describe('STALE — mesma versão com hash diferente (versão mutada)', () => {
    it('não-material ⇒ CANCEL (o contrato executado não existe mais)', () => {
      const a = assessSpecFreshness({
        binding: BINDING_V1,
        currentSpec: { version: 1, specHash: 'hash-v1-ALTERADO' },
        taskStatus: 'CLASSIFIED',
        activeTaskId: 't-1',
      });
      expect(a.state).toBe(SPEC_STATES.STALE);
      expect(a.strategy).toBe(SPEC_STRATEGIES.CANCEL);
      expect(a.reason).toMatch(/diverge/);
    });

    it('material ⇒ RECONCILE', () => {
      const a = assessSpecFreshness({
        binding: BINDING_V1,
        currentSpec: { version: 1, specHash: 'hash-v1-ALTERADO' },
        taskStatus: 'TESTING',
        activeTaskId: 't-1',
      });
      expect(a.strategy).toBe(SPEC_STRATEGIES.RECONCILE);
    });
  });

  describe('UNBOUND — vínculo ausente ou não verificável', () => {
    it('sem vínculo e sem trabalho material ⇒ REPLAN', () => {
      const a = assessSpecFreshness({ binding: null, currentSpec: SPEC_V1, taskStatus: 'CREATED' });
      expect(a.state).toBe(SPEC_STATES.UNBOUND);
      expect(a.strategy).toBe(SPEC_STRATEGIES.REPLAN);
      expect(canRunMaterialPhase(a)).toBe(false);
    });

    it('sem vínculo mas COM trabalho material ⇒ RECONCILE', () => {
      const a = assessSpecFreshness({ binding: null, currentSpec: SPEC_V1, taskStatus: 'REGRESSION' });
      expect(a.strategy).toBe(SPEC_STRATEGIES.RECONCILE);
    });

    it('spec corrente indisponível ⇒ RECONCILE (frescor não verificável ≠ frescor OK)', () => {
      const a = assessSpecFreshness({ binding: BINDING_V1, currentSpec: null, taskStatus: 'CODING', activeTaskId: 't-1' });
      expect(a.state).toBe(SPEC_STATES.UNBOUND);
      expect(a.strategy).toBe(SPEC_STRATEGIES.RECONCILE);
      expect(canRunMaterialPhase(a)).toBe(false);
    });

    it('vínculo sem versão é tratado como NÃO vinculado', () => {
      const a = assessSpecFreshness({
        binding: { missionId: 'm-1', taskId: 't-1', missionVersion: null, specHash: 'hash-v1' },
        currentSpec: SPEC_V1,
        taskStatus: 'ROUTED',
      });
      expect(a.state).toBe(SPEC_STATES.UNBOUND);
    });
  });

  describe('ordem de verificação (substituição vence versão)', () => {
    it('task substituída E com versão antiga é CANCEL, não SUPERSEDE/RECONCILE', () => {
      const a = assessSpecFreshness({ binding: BINDING_V1, currentSpec: SPEC_V2, taskStatus: 'CODING', activeTaskId: 't-2' });
      expect(a.strategy).toBe(SPEC_STRATEGIES.CANCEL);
    });
  });

  describe('invariante global', () => {
    const STATUSES = ['CREATED', 'CLASSIFIED', 'ROUTED', 'CODING', 'TESTING', 'REVIEWING', 'REGRESSION', 'GOVERNANCE', 'PROMOTING', 'POST_PROMOTION_VERIFY', 'GREEN', 'READY_FOR_PROMOTION', 'RED', 'BLOCKED', 'CANCELLED'];
    const BINDINGS = [null, BINDING_V1, { missionId: 'm-1', taskId: 't-1', missionVersion: 9, specHash: 'hash-v9' }];
    const SPECS = [null, SPEC_V1, SPEC_V2, { version: 1, specHash: 'outro' }];
    const ACTIVE = [null, 't-1', 't-2'];

    it('nenhuma combinação produz estado/estratégia indefinidos ou PROCEED indevido', () => {
      for (const taskStatus of STATUSES) {
        for (const binding of BINDINGS) {
          for (const currentSpec of SPECS) {
            for (const activeTaskId of ACTIVE) {
              const a = assessSpecFreshness({ binding, currentSpec, taskStatus, activeTaskId });
              expect(Object.values(SPEC_STATES)).toContain(a.state);
              expect(Object.values(SPEC_STRATEGIES)).toContain(a.strategy);
              expect(typeof a.reason).toBe('string');
              expect(a.reason.length).toBeGreaterThan(0);
              // PROCEED só é legítimo quando o vínculo confere OU quando não há nada mais a fazer.
              if (a.strategy === SPEC_STRATEGIES.PROCEED) {
                const sameSpec = binding && currentSpec
                  && Number(binding.missionVersion) === Number(currentSpec.version)
                  && binding.specHash === currentSpec.specHash;
                const terminal = ['GREEN', 'RED', 'BLOCKED', 'CANCELLED'].includes(taskStatus);
                const replacedTerminal = activeTaskId && binding && binding.taskId && activeTaskId !== binding.taskId && terminal;
                expect(Boolean(sameSpec) || terminal || Boolean(replacedTerminal)).toBe(true);
              }
            }
          }
        }
      }
    });

    it('o motor é PURO — não lê relógio nem aleatoriedade', () => {
      const source = require('fs').readFileSync(
        require('path').join(__dirname, '..', '..', 'engine', 'engineeringMission', 'missionSpecFreshness.js'),
        'utf8',
      );
      expect(source).not.toMatch(/new Date\(/);
      expect(source).not.toMatch(/Date\.now\(/);
      expect(source).not.toMatch(/Math\.random\(/);
    });
  });
});
