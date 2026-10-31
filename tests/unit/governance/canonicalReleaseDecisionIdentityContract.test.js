'use strict';

/**
 * P1 — CONTRATO CENTRAL DE CERTIFICAÇÃO: IDENTIDADE E COBERTURA DE GATES (missão 2026-10-25 §4).
 *
 * DEFEITO REPRODUZIDO no HEAD anterior:
 *
 *   clasificar({ gates: [final_governance, final_readiness, final_proof] todos PASS,
 *                selado: true, certificado: true })
 *     -> { state: 'CERTIFIED_GO', reason: 'CERTIFICADO', identity: null }
 *
 * Idem com identidade PARCIAL (`{ runId }` apenas). A checagem de "gate de outro run" só disparava
 * quando AMBOS os lados tinham `runId`; sem identidade no contrato ela nunca rodava. Resultado:
 * chamada direta (sem passar pelos scripts) certificava sem vínculo com commit/run/fingerprint.
 *
 * A matriz abaixo é a do briefing (§4) e roda na AUTORIDADE ÚNICA (`governance/canonical-release-decision.js`),
 * não nos consumidores.
 */

const {
  clasificar,
  STATES,
  GATE_STATUS,
} = require('../../../governance/canonical-release-decision');

const IDENTIDADE = Object.freeze({
  runId: 'rap-governed-20261025120000000-abc12345',
  sourceCommit: '29372d7a3',
  sourceFingerprint: 'a'.repeat(64),
});

const GATES_FINAIS = () => ([
  { id: 'final_governance', status: GATE_STATUS.PASS },
  { id: 'final_readiness', status: GATE_STATUS.PASS },
  { id: 'final_proof', status: GATE_STATUS.PASS },
]);
const base = (extra = {}) => ({ gates: GATES_FINAIS(), selado: true, certificado: true, identidade: IDENTIDADE, ...extra });

describe('P1 — identidade incompleta nunca certifica (chamada direta)', () => {
  test('CONTROLE POSITIVO: com identidade completa, os três gates finais certificam', () => {
    const r = clasificar(base());
    expect(r.state).toBe(STATES.CERTIFIED_GO);
    expect(r.identity).toEqual(IDENTIDADE);
  });

  test.each([
    ['runId ausente', { runId: undefined }],
    ['sourceCommit ausente', { sourceCommit: undefined }],
    ['sourceFingerprint ausente', { sourceFingerprint: undefined }],
    ['identidade totalmente ausente', null],
  ])('%s ⇒ NO_GO nomeado, nunca CERTIFIED_GO', (_rotulo, patch) => {
    const identidade = patch === null ? undefined : { ...IDENTIDADE, ...patch };
    const r = clasificar(base({ identidade }));
    expect(r.state).toBe(STATES.NO_GO);
    expect(r.reason).toContain('IDENTIDADE_AUSENTE_NO_CONTRATO');
    expect(r.state).not.toBe(STATES.CERTIFIED_GO);
  });

  test.each([
    ['runId curto demais', { runId: 'abc' }],
    ['sourceCommit não-hex', { sourceCommit: 'zzzzzz' }],
    ['sourceFingerprint com tamanho errado', { sourceFingerprint: 'abc123' }],
  ])('%s ⇒ NO_GO nomeado (identidade presente mas inválida)', (_rotulo, patch) => {
    const r = clasificar(base({ identidade: { ...IDENTIDADE, ...patch } }));
    expect(r.state).toBe(STATES.NO_GO);
    expect(r.reason).toContain('IDENTIDADE_INVALIDA_NO_CONTRATO');
  });

  // Compatibilidade preservada só onde NÃO há certificação: sem selo/certificado a decisão continua
  // PRE_PACKAGE_PASS mesmo sem identidade (não é GO — não há o que proteger).
  test('sem selado, ausência de identidade NÃO vira GO (fica PRE_PACKAGE_PASS)', () => {
    const r = clasificar({ gates: GATES_FINAIS(), selado: false, certificado: false });
    expect(r.state).toBe(STATES.PRE_PACKAGE_PASS);
  });
});

describe('P1 — cobertura de gates: nenhum conjunto insuficiente certifica', () => {
  test('conjunto de gates VAZIO ⇒ NOT_STARTED', () => {
    expect(clasificar({})).toHaveProperty('state', STATES.NOT_STARTED);
  });

  test('um único gate PASS ⇒ não certifica', () => {
    const r = clasificar(base({ gates: [{ id: 'final_governance', status: GATE_STATUS.PASS }] }));
    expect(r.state).not.toBe(STATES.CERTIFIED_GO);
    expect(r.reason).toContain('GATES_MINIMOS_AUSENTES');
  });

  test('dois gates PASS ⇒ não certifica', () => {
    const r = clasificar(base({ gates: [
      { id: 'final_governance', status: GATE_STATUS.PASS },
      { id: 'final_readiness', status: GATE_STATUS.PASS },
    ] }));
    expect(r.state).not.toBe(STATES.CERTIFIED_GO);
    expect(r.reason).toContain('GATES_MINIMOS_AUSENTES');
  });

  test.each([
    ['NOT_EXECUTED', GATE_STATUS.NOT_EXECUTED],
    ['UNKNOWN', GATE_STATUS.UNKNOWN],
    ['SKIPPED', GATE_STATUS.SKIPPED],
    ['BLOCKED', GATE_STATUS.BLOCKED],
  ])('gate obrigatório em %s ⇒ nunca GO', (_rotulo, status) => {
    const r = clasificar(base({ gates: [{ id: 'final_governance', status, obrigatorio: true }] }));
    expect(r.state).not.toBe(STATES.CERTIFIED_GO);
  });

  test('gate obrigatório DUPLICADO não dobra cobertura: três finais + duplicata de um deles não certifica a mais', () => {
    const r = clasificar(base({ gates: [...GATES_FINAIS(), { id: 'final_proof', status: GATE_STATUS.PASS }] }));
    // Não há regra de "duplicata invalida" aqui; o que este teste fixa é que duplicar NÃO cria gate
    // mínimo novo nem permite dispensar um dos três.
    const semUm = clasificar(base({ gates: [
      { id: 'final_governance', status: GATE_STATUS.PASS },
      { id: 'final_governance', status: GATE_STATUS.PASS },
      { id: 'final_readiness', status: GATE_STATUS.PASS },
    ] }));
    expect(semUm.state).not.toBe(STATES.CERTIFIED_GO);
    expect(r.state).toBe(STATES.CERTIFIED_GO);
  });

  test('gate DESCONHECIDO com status inválido ⇒ NO_GO nomeado', () => {
    const r = clasificar(base({ gates: [...GATES_FINAIS(), { id: 'gate_inventado', status: 'TALVEZ' }] }));
    expect(r.state).toBe(STATES.NO_GO);
    expect(r.reason).toContain('GATE_STATUS_NAO_PERMITIDO');
  });

  test('gate de OUTRO run (identidade divergente) ⇒ NO_GO', () => {
    const r = clasificar(base({ gates: [
      ...GATES_FINAIS(),
      { id: 'extra', status: GATE_STATUS.PASS, runId: 'rap-governed-OUTRO-99999999' },
    ] }));
    expect(r.state).toBe(STATES.NO_GO);
    expect(r.reason).toContain('GATE_DE_OUTRO_RUN');
  });

  test('evidência de outro commit: gate com runId diferente do contrato bloqueia', () => {
    const r = clasificar(base({ identidade: { ...IDENTIDADE, runId: 'rap-governed-20260101000000000-ffff0000' } }));
    // A identidade do contrato é a autoridade; o gate declara outro run.
    const comGateDeOutroRun = clasificar(base({
      identidade: { ...IDENTIDADE, runId: 'rap-governed-20260101000000000-ffff0000' },
      gates: [...GATES_FINAIS(), { id: 'extra', status: GATE_STATUS.PASS, runId: IDENTIDADE.runId }],
    }));
    expect(r.state).toBe(STATES.CERTIFIED_GO); // sem gate divergente, a identidade nova é coerente
    expect(comGateDeOutroRun.state).toBe(STATES.NO_GO);
    expect(comGateDeOutroRun.reason).toContain('GATE_DE_OUTRO_RUN');
  });

  test('certificação declarada SEM prova (gatesEsperados ausentes do contrato) ⇒ NO_GO', () => {
    const r = clasificar(base({ gatesEsperados: ['final_governance', 'final_readiness', 'final_proof', 'gate_que_nao_existe'] }));
    expect(r.state).toBe(STATES.NO_GO);
    expect(r.reason).toContain('GATE_OBRIGATORIO_AUSENTE');
  });

  test('publicado sem entrega verificada continua CERTIFIED_GO (não é entrega confirmada) — mas exige identidade', () => {
    const semIdentidade = clasificar({ gates: GATES_FINAIS(), selado: true, certificado: true, publicado: true });
    expect(semIdentidade.state).toBe(STATES.NO_GO);
    const comIdentidade = clasificar(base({ publicado: true }));
    expect(comIdentidade.state).toBe(STATES.CERTIFIED_GO);
    expect(comIdentidade.reason).toBe('PUBLICADO_SEM_ENTREGA_VERIFICADA');
  });
});
