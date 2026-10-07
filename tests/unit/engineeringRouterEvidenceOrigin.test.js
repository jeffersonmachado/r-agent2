'use strict';

/**
 * Origem da evidência do ranking: tasks criadas por ROTINA DE TESTE não podem alimentar a
 * evidência empírica do roteador (achado medido em 2026-10-07).
 */

const assert = require('node:assert');
const {
  isTestRoutineOrigin,
  selectProductionTasks,
} = require('../../engine/engineeringRouter/evidenceOrigin');

describe('engineeringRouter/evidenceOrigin', () => {
  describe('isTestRoutineOrigin', () => {
    it('reconhece os criadores medidos na auditoria de 2026-10-07', () => {
      const measured = [
        'jest-review',
        'jest-regression-governance-test',
        'jest-task-fencing',
        'jest-natural-worker',
        'jest-natural',
        'TEST',
        'verify-real-task-recovery',
      ];
      for (const createdBy of measured) {
        assert.strictEqual(isTestRoutineOrigin(createdBy), true, `${createdBy} deveria ser sintético`);
      }
    });

    it('NÃO classifica como sintético trabalho real de missão/worker', () => {
      const real = [
        'cc1fbca6-d8cb-4ac8-a858-2d221244a8b3',
        'SYSTEM:BUG_LOOP_WORKER',
        'real-pilot-erv1-close',
        'recovery-jmachado-Precision-5530-9aad024b',
      ];
      for (const createdBy of real) {
        assert.strictEqual(isTestRoutineOrigin(createdBy), false, `${createdBy} deveria ser produção`);
      }
    });

    it('não confunde prefixo parecido com rotina de teste', () => {
      // "jest" sem hífen não é uma rotina conhecida; e TESTE != TEST (match é exato).
      assert.strictEqual(isTestRoutineOrigin('jester-user'), false);
      assert.strictEqual(isTestRoutineOrigin('TESTE'), false);
      assert.strictEqual(isTestRoutineOrigin('user-TEST'), false);
    });

    it('tolera ausência de criador sem lançar', () => {
      assert.strictEqual(isTestRoutineOrigin(null), false);
      assert.strictEqual(isTestRoutineOrigin(undefined), false);
      assert.strictEqual(isTestRoutineOrigin(''), false);
    });
  });

  describe('selectProductionTasks', () => {
    const task = (id, createdBy) => ({ id, status: 'GREEN', created_by: createdBy });

    it('descarta tasks sintéticas e preserva a ordem das de produção', () => {
      const rows = [
        task('t1', 'jest-review'),
        task('t2', 'cc1fbca6-d8cb-4ac8-a858-2d221244a8b3'),
        task('t3', 'TEST'),
        task('t4', 'SYSTEM:BUG_LOOP_WORKER'),
      ];
      const selected = selectProductionTasks(rows, 10);
      assert.deepStrictEqual(selected.map((t) => t.id), ['t2', 't4']);
    });

    it('respeita o teto pedido depois do filtro', () => {
      const rows = Array.from({ length: 10 }, (_, i) => task(`p${i}`, 'cc1fbca6-x'));
      assert.strictEqual(selectProductionTasks(rows, 3).length, 3);
      assert.deepStrictEqual(selectProductionTasks(rows, 3).map((t) => t.id), ['p0', 'p1', 'p2']);
    });

    it('devolve vazio quando só existe evidência sintética', () => {
      const rows = [task('s1', 'jest-review'), task('s2', 'TEST')];
      assert.deepStrictEqual(selectProductionTasks(rows, 10), []);
    });

    it('sem teto válido devolve todas as de produção', () => {
      const rows = [task('a', 'cc1fbca6-x'), task('b', 'jest-review')];
      assert.strictEqual(selectProductionTasks(rows, null).length, 1);
      assert.strictEqual(selectProductionTasks(rows, 0).length, 1);
    });

    it('entrada inválida não lança e linhas nulas são descartadas', () => {
      assert.deepStrictEqual(selectProductionTasks(null, 5), []);
      assert.deepStrictEqual(selectProductionTasks(undefined, 5), []);
      assert.deepStrictEqual(selectProductionTasks([null, undefined, task('ok', 'cc1fbca6-x')], 5).map((t) => t.id), ['ok']);
    });
  });
});
