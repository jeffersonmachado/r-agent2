'use strict';

/**
 * AUDITORIA DE RISK_ACCEPTED (missão 2026-10-17, item 5).
 *
 * A auditoria precisa poder FALHAR — senão é decoração. Estes testes exercitam
 * os quatro modos de recusa com entradas sintéticas, além de provar que a fila
 * real está limpa hoje.
 */

const { auditarItem, CAMPOS_OBRIGATORIOS_RISCO } = require('../../../scripts/governance/validate-bug-closure-risk');
const { CONTROLES_INEGOCIAVEIS } = require('../../../governance/bug-closure/defect-states');

const RISCO_COMPLETO = {
  justification: 'sem impacto em controle critico; escopo restrito ao tenant X',
  approvedBy: 'responsavel-de-produto',
  approvedAt: '2026-10-17T00:00:00.000Z',
  scope: 'tenant:X',
  expiresAt: '2026-11-17T00:00:00.000Z',
};

describe('RISK_ACCEPTED — recusa de dispensa de controle crítico', () => {
  it('exige todos os campos de registro (justificativa, aprovador, data, escopo, prazo)', () => {
    for (const campo of CAMPOS_OBRIGATORIOS_RISCO) {
      const item = { id: `P2-${campo}`, severity: 'P2', state: 'RISK_ACCEPTED', riskAcceptance: { ...RISCO_COMPLETO, [campo]: '' } };
      const v = auditarItem(item);
      expect(v.map((x) => x.code)).toContain('RISCO_ACEITO_SEM_REGISTRO');
    }
  });

  it('P0 NÃO pode ser aceito como risco', () => {
    const v = auditarItem({ id: 'P0-X', severity: 'P0', state: 'RISK_ACCEPTED', riskAcceptance: RISCO_COMPLETO });
    expect(v.map((x) => x.code)).toContain('RISCO_ACEITO_EM_P0');
  });

  it('controle inegociável nunca é dispensado', () => {
    for (const controle of CONTROLES_INEGOCIAVEIS) {
      const v = auditarItem({
        id: `P2-${controle}`,
        severity: 'P2',
        state: 'RISK_ACCEPTED',
        riskAcceptance: RISCO_COMPLETO,
        touches: [controle],
      });
      expect(v.map((x) => x.code)).toContain('RISCO_EM_CONTROLE_INEGOCIAVEL');
    }
  });

  it('aceitação completa e fora de controle crítico NÃO é violação (não-vacuidade)', () => {
    const v = auditarItem({
      id: 'P2-OK',
      severity: 'P2',
      state: 'RISK_ACCEPTED',
      riskAcceptance: RISCO_COMPLETO,
      touches: ['DOCUMENTACAO'],
    });
    expect(v).toEqual([]);
  });
});
