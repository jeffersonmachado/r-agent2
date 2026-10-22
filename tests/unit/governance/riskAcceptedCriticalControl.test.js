'use strict';

/**
 * P0 (auditoria 2026-10-19) — `RISK_ACCEPTED` NÃO PODE DISPENSAR CONTROLES CRÍTICOS.
 *
 * Defeito reproduzido contra a baseline `9758f828f` em
 * `governance/bug-closure/eligibility.js`: o status `RISK_ACCEPTED` era
 * descartado ANTES da classificação de severidade (`continue`), então um P0 de
 * integridade criptográfica marcado como risco aceito liberava operações
 * certificantes (QA Waves, selo, publicação).
 *
 * Regra nova: aceitação ADMINISTRATIVA não neutraliza bloqueio TÉCNICO.
 *  - P0 nunca é dispensável (nem com aceitação completa);
 *  - P1 só é dispensável com aceitação válida (responsável + justificativa +
 *    validade futura) e fora de controle crítico;
 *  - aceitação vencida/sem responsável/sem justificativa é ineficaz.
 */

const {
  evaluateExecutionEligibility,
  avaliarAceitacaoDeRisco,
  classificarDefeitos,
  controlesCriticosDoDefeito,
  OPERACOES,
  CODIGOS,
  DECISOES,
} = require('../../../governance/bug-closure/eligibility.js');

const SHA = '9758f828f3fdd0fb07c08ebe591de1ace8df2ebe';
const FUTURO = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
const PASSADO = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

// A âncora externa do inventário (2ª passada do revisor) é exigida para operação
// certificante. Estes testes medem a mecânica de ACEITAÇÃO DE RISCO, então fornecem a
// âncora do próprio fixture — sem ela o veredito seria DENIED por INVENTARIO_NAO_ANCORADO
// e o que se quer medir aqui (risco aceito) ficaria mascarado.
const { digestDoInventario } = require('../../../governance/bug-closure/trusted-authorities');

function ancorarInventario(defeitos) {
  process.env.RAP_CLOSURE_INVENTORY_SHA256 = digestDoInventario(defeitos);
}

function contexto(defeitos) {
  return {
    commit: SHA,
    actor: { id: 'teste' },
    defects: defeitos,
    certification: 'CERTIFIED_GO:teste',
  };
}

function avaliar(defeitos, operacao = OPERACOES.QA_WAVES_COMPLETA) {
  ancorarInventario(defeitos);
  return evaluateExecutionEligibility(contexto(defeitos), operacao);
}

afterEach(() => { delete process.env.RAP_CLOSURE_INVENTORY_SHA256; });

const ACEITACAO_VALIDA = {
  riskAcceptedBy: 'security@results',
  riskAcceptedReason: 'controlado por WAF e monitorado',
  riskAcceptedExpiresAt: FUTURO,
};

describe('P0 RISK_ACCEPTED — P0 continua bloqueando mesmo com risco aceito', () => {
  test('P0 com RISK_ACCEPTED e aceitação completa AINDA bloqueia QA Waves', () => {
    const r = avaliar([{ id: 'P0-X', severity: 'P0', state: 'RISK_ACCEPTED', ...ACEITACAO_VALIDA }]);
    expect(r.allowed).toBe(false);
    expect(r.decision).toBe(DECISOES.DENIED);
    expect(r.reasonCodes).toContain(CODIGOS.P0_ABERTO);
  });

  test('P0 de integridade criptográfica com RISK_ACCEPTED bloqueia e marca controle crítico', () => {
    const r = avaliar([{
      id: 'P0-CRIPTO', severity: 'P0', state: 'RISK_ACCEPTED',
      control: 'CRYPTOGRAPHIC_INTEGRITY', ...ACEITACAO_VALIDA,
    }]);
    expect(r.allowed).toBe(false);
    expect(r.reasonCodes).toContain(CODIGOS.CONTROLE_CRITICO_NAO_DISPENSAVEL);
  });

  test('P1 de segurança (controle crítico) com RISK_ACCEPTED NÃO é dispensado', () => {
    const r = avaliar([{ id: 'P1-SEC', severity: 'P1', state: 'RISK_ACCEPTED', control: 'AUTHORIZATION', ...ACEITACAO_VALIDA }]);
    expect(r.allowed).toBe(false);
    expect(r.reasonCodes).toContain(CODIGOS.P1_BLOQUEANTE_ABERTO);
  });

  test('P0 de isolamento de tenant com RISK_ACCEPTED bloqueia', () => {
    const r = avaliar([{ id: 'P0-TENANT', severity: 'P0', state: 'RISK_ACCEPTED', control: 'TENANT_ISOLATION', ...ACEITACAO_VALIDA }]);
    expect(r.allowed).toBe(false);
  });

  test('P0 de perda de dados com RISK_ACCEPTED bloqueia', () => {
    const r = avaliar([{ id: 'P0-DADOS', severity: 'P0', state: 'RISK_ACCEPTED', controls: ['DATA_LOSS'], ...ACEITACAO_VALIDA }]);
    expect(r.allowed).toBe(false);
  });

  test('P0 de evidência de certificação com RISK_ACCEPTED bloqueia', () => {
    const r = avaliar([{ id: 'P0-EVID', severity: 'P0', state: 'RISK_ACCEPTED', category: 'CERTIFICATION_EVIDENCE', ...ACEITACAO_VALIDA }]);
    expect(r.allowed).toBe(false);
  });
});

describe('P0 RISK_ACCEPTED — aceitação inválida não dispensa nem P1 comum', () => {
  const casos = [
    { nome: 'sem responsável', item: { riskAcceptedReason: 'x', riskAcceptedExpiresAt: FUTURO }, motivo: 'ACEITACAO_SEM_RESPONSAVEL' },
    { nome: 'vencida', item: { riskAcceptedBy: 'a', riskAcceptedReason: 'x', riskAcceptedExpiresAt: PASSADO }, motivo: 'ACEITACAO_VENCIDA' },
    { nome: 'sem justificativa', item: { riskAcceptedBy: 'a', riskAcceptedExpiresAt: FUTURO }, motivo: 'ACEITACAO_SEM_JUSTIFICATIVA' },
    { nome: 'sem validade', item: { riskAcceptedBy: 'a', riskAcceptedReason: 'x' }, motivo: 'ACEITACAO_SEM_VALIDADE' },
  ];

  it.each(casos)('$nome ⇒ aceitação ineficaz e P1 bloqueia', ({ item, motivo }) => {
    const defeito = { id: 'P1-COMUM', severity: 'P1', state: 'RISK_ACCEPTED', ...item };
    const avaliacao = avaliarAceitacaoDeRisco(defeito);
    expect(avaliacao.valida).toBe(false);
    expect(avaliacao.motivo).toBe(motivo);

    const r = avaliar([defeito], OPERACOES.L2_L3_EXTENSIVO);
    expect(r.allowed).toBe(false);
    expect(r.reasonCodes).toContain(CODIGOS.RISCO_ACEITO_INEFICAZ);
  });

  test('aceitação válida de P1 comum é registrada e não bloqueia QA Waves', () => {
    const r = avaliar([{ id: 'P1-OK', severity: 'P1', state: 'RISK_ACCEPTED', ...ACEITACAO_VALIDA }]);
    expect(r.allowed).toBe(true);
    expect(r.reasonCodes).toContain(CODIGOS.RISCO_ACEITO_REGISTRADO);
    expect(r.reasonCodes).not.toContain(CODIGOS.RISCO_ACEITO_INEFICAZ);
  });
});

describe('P0 RISK_ACCEPTED — classificação e testes direcionados', () => {
  test('classificarDefeitos mantém P0 de risco aceito na lista de P0', () => {
    const { p0, riscoAceito, riscoAceitoIneficaz } = classificarDefeitos([
      { id: 'P0-X', severity: 'P0', state: 'RISK_ACCEPTED', ...ACEITACAO_VALIDA },
    ]);
    expect(p0.map((d) => d.id)).toEqual(['P0-X']);
    expect(riscoAceito.map((d) => d.id)).toEqual(['P0-X']);
    expect(riscoAceitoIneficaz[0].motivo).toBe('P0_NAO_DISPENSAVEL');
  });

  test('P1 com aceitação válida sai da classificação bloqueante', () => {
    const { p1 } = classificarDefeitos([{ id: 'P1-OK', severity: 'P1', state: 'RISK_ACCEPTED', ...ACEITACAO_VALIDA }]);
    expect(p1).toHaveLength(0);
  });

  test('detecta controles críticos por campo, lista e categoria', () => {
    expect(controlesCriticosDoDefeito({ control: 'AUTHORIZATION' })).toEqual(['AUTHORIZATION']);
    expect(controlesCriticosDoDefeito({ controls: ['DATA_LOSS', 'x'] })).toEqual(['DATA_LOSS']);
    expect(controlesCriticosDoDefeito({ category: 'TENANT_ISOLATION' })).toEqual(['TENANT_ISOLATION']);
    expect(controlesCriticosDoDefeito({ severity: 'P0' })).toEqual([]);
  });

  test('P0 RISK_ACCEPTED bloqueia também o selo final e a publicação', () => {
    const defeito = { id: 'P0-SELO', severity: 'P0', state: 'RISK_ACCEPTED', ...ACEITACAO_VALIDA };
    expect(avaliar([defeito], OPERACOES.SELO_FINAL).allowed).toBe(false);
    expect(avaliar([defeito], OPERACOES.PUBLICACAO_RELEASE).allowed).toBe(false);
  });
});
