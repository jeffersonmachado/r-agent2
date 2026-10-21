'use strict';

/**
 * Semântica do gate `ENGINEER_SUPERVISED_READY_GO` (§13).
 *
 * A decisão precisa ser DERIVADA de fatos medidos e a regra central não pode ser afrouxada:
 * **sem aprovação humana real não existe GO** — nem por "todos os checks passaram".
 */

const { decidirVeredito, ABERTOS, IMPEDIDOS, SECOES_OBRIGATORIAS } = require('../../../scripts/governance/validate-engineer-supervised-readiness');

const ok = (id, bloqueante = true) => ({ id, ok: true, bloqueante });
const fail = (id, bloqueante = true) => ({ id, ok: false, bloqueante });

describe('gate de prontidão supervisionada — veredito derivado', () => {
  test('qualquer check bloqueante reprovado ⇒ NOT_READY (exit 1)', () => {
    for (const checks of [
      [fail('A'), ok('B')],
      [ok('A'), fail('B')],
      [fail('A'), fail('B')],
    ]) {
      const d = decidirVeredito({ checks, aprovacaoHumana: true });
      expect(d.veredito).toBe('NOT_READY');
      expect(d.exitCode).toBe(1);
      expect(d.isGo).toBe(false);
    }
  });

  test('todos os checks OK mas SEM aprovação humana ⇒ PENDING_HUMAN_APPROVAL (exit 2)', () => {
    const d = decidirVeredito({ checks: [ok('A'), ok('B')], aprovacaoHumana: false });
    expect(d.veredito).toBe('PENDING_HUMAN_APPROVAL');
    expect(d.exitCode).toBe(2);
    expect(d.isGo).toBe(false);
  });

  test('GO exige os dois: checks OK **e** aprovação humana', () => {
    const d = decidirVeredito({ checks: [ok('A'), ok('B')], aprovacaoHumana: true });
    expect(d.veredito).toBe('ENGINEER_SUPERVISED_READY_GO');
    expect(d.exitCode).toBe(0);
    expect(d.isGo).toBe(true);
  });

  test('check INFORMATIVO (bloqueante:false) reprovado não impede GO', () => {
    const d = decidirVeredito({ checks: [ok('A'), fail('INFO', false)], aprovacaoHumana: true });
    expect(d.veredito).toBe('ENGINEER_SUPERVISED_READY_GO');
    expect(d.falhas).toHaveLength(0);
  });

  test('falhas são listadas por id (auditável, nunca "algum check falhou")', () => {
    const d = decidirVeredito({ checks: [fail('X'), fail('Y'), ok('Z')], aprovacaoHumana: true });
    expect(d.falhas).toEqual(['X', 'Y']);
  });

  test('entrada degenerada (sem checks) não vira GO silencioso', () => {
    const d = decidirVeredito({ checks: [], aprovacaoHumana: false });
    expect(d.veredito).toBe('PENDING_HUMAN_APPROVAL');
    expect(d.isGo).toBe(false);
  });

  test('listas de estado espelham o validador canônico da fila', () => {
    // Se alguém mudar um lado sem o outro, o gate passaria a medir outra coisa.
    expect([...ABERTOS].sort()).toEqual(['failed', 'fixed_unverified', 'in_progress', 'pending']);
    expect([...IMPEDIDOS].sort()).toEqual(['blocked', 'blocked_external']);
    expect(SECOES_OBRIGATORIAS.length).toBeGreaterThan(0);
  });
});
