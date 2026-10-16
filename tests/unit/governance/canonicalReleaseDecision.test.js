'use strict';

/**
 * AUTORIDADE ÚNICA da decisão de release (P0-4).
 *
 * Defeito medido na auditoria: havia oito vocabulários independentes de "o que é GO",
 * e três consumidores tratavam estado PRÉ-pacote como aprovado
 * (`validate-self-proving.js` só rejeitava /NO_GO/i; `go-no-go.js` idem;
 * `validate-engineering-router-v2-audit-items.js` aceitava toda a família GO;
 * `releaseClosureService.js` aceitava `startsWith('PASS')`).
 *
 * Este teste fixa o contrato: estados fechados, versão declarada, literal
 * desconhecido NUNCA final, gate obrigatório DIFERIDO ⇒ NO_GO e identidade
 * incompatível invalidando o GO.
 */

const {
  DECISION_VERSION,
  STATES,
  GATE_STATUS,
  FINAL_GO_STATES,
  RELEASE_DECISION_LITERALS,
  isReleaseDecisionLiteral,
  classifyReleaseDecision,
  isFinalGo,
  exigirGoFinal,
  clasificar,
  identidadeCoerente,
} = require('../../../governance/canonical-release-decision');

describe('vocabulário canônico — fechado e versionado', () => {
  it('declara versão e exatamente 7 estados', () => {
    expect(DECISION_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.values(STATES)).toEqual([
      'NOT_STARTED',
      'RUNNING',
      'PRE_PACKAGE_PASS',
      'BLOCKED',
      'NO_GO',
      'CERTIFIED_GO',
      'PUBLISHED_VERIFIED',
    ]);
  });

  it('só CERTIFIED_GO e PUBLISHED_VERIFIED são GO definitivo', () => {
    expect(FINAL_GO_STATES).toEqual([STATES.CERTIFIED_GO, STATES.PUBLISHED_VERIFIED]);
    expect(isFinalGo(STATES.PRE_PACKAGE_PASS)).toBe(false);
    expect(isFinalGo(STATES.RUNNING)).toBe(false);
    expect(isFinalGo(STATES.NOT_STARTED)).toBe(false);
    expect(isFinalGo(STATES.BLOCKED)).toBe(false);
    expect(isFinalGo(STATES.NO_GO)).toBe(false);
  });

  it('NENHUM literal não-final é classificado como final (varredura de todo o mapa)', () => {
    const finais = Object.entries(RELEASE_DECISION_LITERALS)
      .filter(([, estado]) => isFinalGo(estado))
      .map(([literal]) => literal);
    // Exatamente os quatro literais finais declarados.
    expect(finais.sort()).toEqual([
      'AUTONOMOUS_READY_GO',
      'DELIVERED_RELEASE_VERIFIED',
      'ENTERPRISE_READY_GO',
      'PUBLISHED_VERIFIED',
    ].sort());
  });
});

describe('classifyReleaseDecision — fail-closed', () => {
  it('os estados PRÉ-pacote NÃO são finais (o falso verde medido)', () => {
    for (const literal of [
      'PASS_WITH_DEFERRED_PACKAGE_GATE',
      'DELIVERED_PENDING_SCORECARD',
      'AUTONOMOUS_READY',
      'PRODUCTION_READY',
      'CONTROLLED_PILOT',
    ]) {
      const r = classifyReleaseDecision(literal);
      expect(r.state).toBe(STATES.PRE_PACKAGE_PASS);
      expect(isFinalGo(r.state)).toBe(false);
    }
  });

  it('os literais finais são reconhecidos como finais', () => {
    expect(classifyReleaseDecision('AUTONOMOUS_READY_GO').state).toBe(STATES.CERTIFIED_GO);
    expect(classifyReleaseDecision('PUBLISHED_VERIFIED').state).toBe(STATES.PUBLISHED_VERIFIED);
    expect(classifyReleaseDecision('DELIVERED_RELEASE_VERIFIED').state).toBe(STATES.PUBLISHED_VERIFIED);
  });

  it('NO_GO com sufixo continua NO_GO (prefixo, não igualdade)', () => {
    expect(classifyReleaseDecision('NO_GO:BLOCKING_GAPS').state).toBe(STATES.NO_GO);
    expect(classifyReleaseDecision('NO_GO:MESH_BLOCKED').state).toBe(STATES.NO_GO);
  });

  it('literal DESCONHECIDO não é final (nunca aprovar por não reconhecer)', () => {
    const r = classifyReleaseDecision('QUALQUER_COISA_NOVA_GO');
    expect(r.state).toBe(STATES.PRE_PACKAGE_PASS);
    expect(r.reason).toBe('LITERAL_DESCONHECIDO_NAO_E_FINAL');
    expect(isFinalGo(r.state)).toBe(false);
  });

  it('ausente/vazio ⇒ NOT_STARTED', () => {
    expect(classifyReleaseDecision('').state).toBe(STATES.NOT_STARTED);
    expect(classifyReleaseDecision(null).state).toBe(STATES.NOT_STARTED);
    expect(classifyReleaseDecision(undefined).state).toBe(STATES.NOT_STARTED);
  });

  it('isReleaseDecisionLiteral distingue o vocabulário de RELEASE do de gate', () => {
    expect(isReleaseDecisionLiteral('AUTONOMOUS_READY_GO')).toBe(true);
    // `FINAL_CONSISTENCY_GO` é decisão de GATE — não pertence a este vocabulário.
    expect(isReleaseDecisionLiteral('FINAL_CONSISTENCY_GO')).toBe(false);
  });
});

describe('exigirGoFinal — o predicado que os consumidores devem usar', () => {
  it('recusa tudo que não é final (inclui os que passavam antes)', () => {
    for (const valor of [
      'PASS_WITH_DEFERRED_PACKAGE_GATE',
      'DELIVERED_PENDING_SCORECARD',
      'AUTONOMOUS_READY',
      'CONTROLLED_PILOT',
      'IN_PROGRESS',
      'PENDING',
      'NO_GO:BLOCKING_GAPS',
      '',
      'DESCONHECIDO',
    ]) {
      const r = exigirGoFinal(valor, { consumidor: 'teste' });
      expect(r.ok).toBe(false);
      expect(r.consumidor).toBe('teste');
    }
  });

  it('aceita os finais', () => {
    for (const valor of ['AUTONOMOUS_READY_GO', 'ENTERPRISE_READY_GO', 'PUBLISHED_VERIFIED', 'DELIVERED_RELEASE_VERIFIED']) {
      expect(exigirGoFinal(valor).ok).toBe(true);
    }
  });

  it('aceita estado canônico diretamente (não só literal)', () => {
    expect(exigirGoFinal(STATES.CERTIFIED_GO).ok).toBe(true);
    expect(exigirGoFinal(STATES.PRE_PACKAGE_PASS).ok).toBe(false);
  });
});

describe('clasificar — precedência fail-closed a partir dos fatos', () => {
  const gatesOk = [{ id: 'g1', status: GATE_STATUS.PASS }];

  it('sem gates ⇒ NOT_STARTED', () => {
    expect(clasificar({}).state).toBe(STATES.NOT_STARTED);
  });

  it('gate obrigatório FALHO ⇒ NO_GO', () => {
    const r = clasificar({ gates: [{ id: 'g1', status: GATE_STATUS.PASS }, { id: 'g2', status: GATE_STATUS.FAIL }] });
    expect(r.state).toBe(STATES.NO_GO);
    expect(r.reason).toContain('g2');
  });

  it('gate obrigatório DIFERIDO ⇒ NO_GO (bloqueio não resolvido é bloqueio)', () => {
    const r = clasificar({ gates: [{ id: 'gk', status: GATE_STATUS.DEFERRED }], selado: true, certificado: true });
    expect(r.state).toBe(STATES.NO_GO);
    expect(r.reason).toContain('DIFERIDO');
  });

  it('gate obrigatório BLOQUEADO ⇒ BLOCKED (distinto de NO_GO)', () => {
    expect(clasificar({ gates: [{ id: 'gx', status: GATE_STATUS.BLOCKED }] }).state).toBe(STATES.BLOCKED);
  });

  it('gate PENDENTE ⇒ RUNNING', () => {
    expect(clasificar({ gates: [{ id: 'gp', status: GATE_STATUS.PENDING }] }).state).toBe(STATES.RUNNING);
  });

  it('gate opcional falho NÃO bloqueia (obrigatorio:false)', () => {
    const r = clasificar({ gates: [{ id: 'g1', status: GATE_STATUS.PASS }, { id: 'op', status: GATE_STATUS.FAIL, obrigatorio: false }] });
    expect(r.state).toBe(STATES.PRE_PACKAGE_PASS);
  });

  it('todos passam mas o pacote não está selado ⇒ PRE_PACKAGE_PASS (não é GO)', () => {
    const r = clasificar({ gates: gatesOk });
    expect(r.state).toBe(STATES.PRE_PACKAGE_PASS);
    expect(r.reason).toBe('PACOTE_NAO_SELADO');
    expect(isFinalGo(r.state)).toBe(false);
  });

  it('selado mas não certificado ⇒ PRE_PACKAGE_PASS', () => {
    expect(clasificar({ gates: gatesOk, selado: true }).state).toBe(STATES.PRE_PACKAGE_PASS);
  });

  it('selado + certificado ⇒ CERTIFIED_GO', () => {
    expect(clasificar({ gates: gatesOk, selado: true, certificado: true }).state).toBe(STATES.CERTIFIED_GO);
  });

  it('publicado sem entrega verificada ⇒ ainda CERTIFIED_GO (não é entrega confirmada)', () => {
    const r = clasificar({ gates: gatesOk, selado: true, certificado: true, publicado: true });
    expect(r.state).toBe(STATES.CERTIFIED_GO);
    expect(r.reason).toBe('PUBLICADO_SEM_ENTREGA_VERIFICADA');
  });

  it('publicado + entrega verificada ⇒ PUBLISHED_VERIFIED', () => {
    const r = clasificar({ gates: gatesOk, selado: true, certificado: true, publicado: true, entregaVerificada: true });
    expect(r.state).toBe(STATES.PUBLISHED_VERIFIED);
  });

  it('a decisão carrega a versão do vocabulário e a identidade', () => {
    const r = clasificar({ gates: gatesOk, identidade: { runId: 'R1' } });
    expect(r.version).toBe(DECISION_VERSION);
    expect(r.identity).toEqual({ runId: 'R1' });
  });
});

describe('identidadeCoerente — GO de outro candidato não vale', () => {
  const atual = { runId: 'R1', sourceCommit: 'C1', sourceFingerprint: 'F1', releaseId: 'REL1' };

  it('identidade idêntica é coerente', () => {
    expect(identidadeCoerente({ identity: atual }, atual)).toEqual({ ok: true, divergentes: [] });
  });

  it('cada campo divergente é nomeado', () => {
    for (const campo of ['runId', 'sourceCommit', 'sourceFingerprint', 'releaseId']) {
      const outra = { ...atual, [campo]: 'OUTRO' };
      const r = identidadeCoerente({ identity: outra }, atual);
      expect(r.ok).toBe(false);
      expect(r.divergentes).toContain(campo);
    }
  });

  it('campo ausente de um dos lados não gera divergência falsa (não é comparação de undefined)', () => {
    expect(identidadeCoerente({ identity: { runId: 'R1' } }, atual).ok).toBe(true);
    expect(identidadeCoerente({ identity: {} }, atual).ok).toBe(true);
  });
});
