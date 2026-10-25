'use strict';

/**
 * Semântica do gate `ENGINEER_SUPERVISED_READY_GO` (§13).
 *
 * A decisão precisa ser DERIVADA de fatos medidos e a regra central não pode ser afrouxada:
 * **sem aprovação humana real não existe GO** — nem por "todos os checks passaram".
 */

const {
  decidirVeredito, ABERTOS, IMPEDIDOS, SECOES_OBRIGATORIAS, CHECKS_OBRIGATORIOS,
} = require('../../../scripts/governance/validate-engineer-supervised-readiness');

const ok = (id, bloqueante = true) => ({ id, ok: true, bloqueante, detalhe: `medido: ${id}` });
const fail = (id, bloqueante = true) => ({ id, ok: false, bloqueante, detalhe: `reprovado: ${id}` });

/**
 * Conjunto COMPLETO do catálogo. A partir da missão 2026-10-23 (P1-D), "todos os checks que eu
 * inventei passaram" não é cobertura: a decisão exige o catálogo canônico inteiro medido.
 */
const completo = (mutacoes = {}) => CHECKS_OBRIGATORIOS.map((id) => {
  const m = mutacoes[id];
  if (m === false) return fail(id);
  if (m === 'info-fail') return fail(id, false);
  return ok(id);
});

describe('gate de prontidão supervisionada — veredito derivado', () => {
  test('qualquer check bloqueante reprovado ⇒ NOT_READY (exit 1)', () => {
    for (const id of ['QUEUE_READABLE', 'QUEUE_CLOSURE_EVIDENCE', 'HUMAN_APPROVAL_VALID']) {
      const d = decidirVeredito({ checks: completo({ [id]: false }), aprovacaoHumana: true });
      expect(d.veredito).toBe('NOT_READY');
      expect(d.exitCode).toBe(1);
      expect(d.isGo).toBe(false);
      expect(d.falhas).toContain(id);
    }
  });

  test('todos os checks OK mas SEM aprovação humana ⇒ PENDING_HUMAN_APPROVAL (exit 2)', () => {
    const d = decidirVeredito({ checks: completo(), aprovacaoHumana: false });
    expect(d.veredito).toBe('PENDING_HUMAN_APPROVAL');
    expect(d.exitCode).toBe(2);
    expect(d.isGo).toBe(false);
  });

  test('GO exige os dois: catálogo completo medido **e** aprovação humana', () => {
    const d = decidirVeredito({ checks: completo(), aprovacaoHumana: true });
    expect(d.veredito).toBe('ENGINEER_SUPERVISED_READY_GO');
    expect(d.exitCode).toBe(0);
    expect(d.isGo).toBe(true);
  });

  test('check INFORMATIVO (bloqueante:false) reprovado não impede GO', () => {
    const d = decidirVeredito({ checks: completo({ QUEUE_EVIDENCE_READABLE: 'info-fail' }), aprovacaoHumana: true });
    expect(d.veredito).toBe('ENGINEER_SUPERVISED_READY_GO');
    expect(d.falhas).toHaveLength(0);
  });

  test('falhas são listadas por id (auditável, nunca "algum check falhou")', () => {
    const d = decidirVeredito({
      checks: completo({ QUEUE_READABLE: false, QUEUE_NO_BLOCKED: false }), aprovacaoHumana: true,
    });
    expect(d.falhas.sort()).toEqual(['QUEUE_NO_BLOCKED', 'QUEUE_READABLE']);
  });

  test('entrada degenerada (sem checks) não vira GO silencioso', () => {
    const d = decidirVeredito({ checks: [], aprovacaoHumana: false });
    // P1-D: antes devolvia PENDING_HUMAN_APPROVAL (exit 2), que ainda é "aguardando" — e com
    // `aprovacaoHumana:true` devolvia GO. Agora nada medido = NOT_READY.
    expect(d.veredito).toBe('NOT_READY');
    expect(d.isGo).toBe(false);
    expect(d.exitCode).toBe(1);
    expect(d.problemas).toContain('CHECKS_VAZIOS');
  });

  test('listas de estado espelham o validador canônico da fila', () => {
    // Se alguém mudar um lado sem o outro, o gate passaria a medir outra coisa.
    expect([...ABERTOS].sort()).toEqual(['failed', 'fixed_unverified', 'in_progress', 'pending']);
    expect([...IMPEDIDOS].sort()).toEqual(['blocked', 'blocked_external']);
    expect(SECOES_OBRIGATORIAS.length).toBeGreaterThan(0);
  });
});
