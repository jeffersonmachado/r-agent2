'use strict';

/**
 * Testes do juiz da ENTREGA — matriz negativa exigida pela missão P0.
 *
 * Defeito de origem (medido no `seal-release.sh`): exit code descartado + `grep` de
 * mensagem positiva como autoridade + `DELIVERED_PENDING_SCORECARD` (pré-pacote)
 * aceito como entrega verificada. Cada caso abaixo era um caminho de falso verde.
 */

const { avaliarEntrega, DECISOES_ENTREGA_PERMITIDAS } = require('../../../scripts/governance/lib/delivery-verification');

const IDENT = {
  runId: 'rap-governed-20261016144931085-033e1239',
  sourceCommit: '5efce7924932822c23888de97efc6243981da75e',
  sourceFingerprint: 'bc4c2cd80ca6748834e88d80fc2ec92227cb40fb30ed27968d610a7cb6e4c23f',
};

const relatorioOk = (over = {}) => ({
  decision: 'DELIVERED_RELEASE_VERIFIED',
  status: 'DELIVERED_RELEASE_VERIFIED',
  runId: IDENT.runId,
  sourceFingerprint: IDENT.sourceFingerprint,
  gates: [{ id: 'identidade', status: 'PASS' }, { id: 'cadeia', status: 'PASS' }],
  ...over,
});

const cadeiaOk = { valid: true, motivo: 'CADEIA_RECOMPUTADA_INTEGRA', failures: [] };
const cadeiaRompida = { valid: false, motivo: 'CADEIA_RECOMPUTADA_INVALIDA', failures: [{ id: 'x' }, { id: 'y' }] };

const avaliar = (over = {}) =>
  avaliarEntrega({ exitCode: 0, relatorio: relatorioOk(), identidadeAtual: IDENT, cadeia: cadeiaOk, ...over });

describe('entrega — o caso VÁLIDO só passa com todas as condições', () => {
  it('exit 0 + relatório permitido + identidade correspondente + cadeia íntegra + gates PASS ⇒ ok', () => {
    const r = avaliar();
    expect(r.ok).toBe(true);
    expect(r.code).toBe('ENTREGA_VERIFICADA');
    expect(DECISOES_ENTREGA_PERMITIDAS).toEqual(['DELIVERED_RELEASE_VERIFIED']);
  });
});

describe('entrega — matriz NEGATIVA (todo caso inválido bloqueia)', () => {
  it('exit code != 0 COM texto positivo no log ⇒ BLOQUEIA (o defeito central)', () => {
    const r = avaliar({ exitCode: 1, logText: 'DELIVERED_RELEASE_VERIFIED\nFINAL DECISION: AUTONOMOUS_READY' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('EXIT_CODE_NAO_ZERO');
    expect(r.diagnosticos).toContain('LOG_PROMETIA_SUCESSO_MAS_EXIT_NAO_ZERO');
  });

  it('exit code AUSENTE ⇒ BLOQUEIA', () => {
    expect(avaliar({ exitCode: null }).code).toBe('EXIT_CODE_AUSENTE');
    expect(avaliar({ exitCode: undefined }).code).toBe('EXIT_CODE_AUSENTE');
  });

  it('exit 0 com resultado NEGATIVO ⇒ BLOQUEIA (decisão não permitida)', () => {
    const r = avaliar({ relatorio: relatorioOk({ decision: 'NO_GO', status: 'NO_GO' }) });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('DECISAO_NAO_PERMITIDA');
  });

  it('DELIVERED_PENDING_SCORECARD ⇒ BLOQUEIA como ESTADO PRÉ-PACOTE', () => {
    const r = avaliar({ relatorio: relatorioOk({ decision: 'DELIVERED_PENDING_SCORECARD', status: 'DELIVERED_PENDING_SCORECARD' }) });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('ESTADO_PRE_PACOTE_NAO_E_ENTREGA');
  });

  it('outros estados pré-pacote ⇒ BLOQUEIA', () => {
    for (const d of ['PASS_WITH_DEFERRED_PACKAGE_GATE', 'AUTONOMOUS_READY', 'PRODUCTION_READY', 'CONTROLLED_PILOT']) {
      expect(avaliar({ relatorio: relatorioOk({ decision: d }) }).code).toBe('ESTADO_PRE_PACOTE_NAO_E_ENTREGA');
    }
  });

  it('resultado AUSENTE ⇒ BLOQUEIA', () => {
    expect(avaliar({ relatorio: null }).code).toBe('RELATORIO_AUSENTE');
  });

  it('resultado MALFORMADO ⇒ BLOQUEIA', () => {
    expect(avaliar({ relatorio: 'DELIVERED_RELEASE_VERIFIED' }).code).toBe('RELATORIO_MALFORMADO');
    expect(avaliar({ relatorio: [1, 2, 3] }).code).toBe('RELATORIO_MALFORMADO');
  });

  it('relatório sem decisão ⇒ BLOQUEIA', () => {
    expect(avaliar({ relatorio: relatorioOk({ decision: undefined, status: undefined, finalDecision: undefined }) }).code).toBe('DECISAO_AUSENTE');
  });

  it('identidade DIVERGENTE ⇒ BLOQUEIA', () => {
    const r = avaliar({ relatorio: relatorioOk({ sourceFingerprint: 'a'.repeat(64) }) });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('IDENTIDADE_DIVERGENTE');
  });

  it('identidade AUSENTE (run corrente inexistente) ⇒ BLOQUEIA', () => {
    expect(avaliar({ identidadeAtual: null }).code).toBe('IDENTIDADE_AUSENTE');
  });

  it('identidade INCOMPLETA (relatório sem runId) ⇒ BLOQUEIA', () => {
    expect(avaliar({ relatorio: relatorioOk({ runId: undefined }) }).code).toBe('IDENTIDADE_INCOMPLETA');
  });

  it('cadeia adulterada ⇒ BLOQUEIA', () => {
    const r = avaliar({ cadeia: cadeiaRompida });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('CADEIA_INVALIDA');
  });

  it('cadeia não verificada ⇒ BLOQUEIA (não aprovar sem integridade)', () => {
    expect(avaliar({ cadeia: null }).code).toBe('CADEIA_NAO_VERIFICADA');
  });

  it('gate bloqueante no relatório ⇒ BLOQUEIA (só PASS avança)', () => {
    for (const status of ['FAIL', 'DEFERRED', 'BLOCKED', 'PENDING', 'NOT_EXECUTED', 'UNKNOWN', '']) {
      const r = avaliar({ relatorio: relatorioOk({ gates: [{ id: 'g1', status: 'PASS' }, { id: 'g2', status }] }) });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('GATE_BLOQUEANTE');
    }
  });

  it('gate ilegível ⇒ BLOQUEIA', () => {
    expect(avaliar({ relatorio: relatorioOk({ gates: [null] }) }).code).toBe('GATE_BLOQUEANTE');
  });

  it('relatório sem gates declarados ⇒ BLOQUEIA', () => {
    expect(avaliar({ relatorio: relatorioOk({ gates: [] }) }).code).toBe('SEM_GATES');
  });
});
