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
  // Desde 2026-10-17 a decisão canônica exige os TRÊS gates finais presentes:
  // um único gate PASS não certifica (missão §11 #12). As fixtures positivas
  // incluem o trio; as negativas não precisam dele para recusar.
  const GATES_FINAIS = [
    { id: 'final_governance', status: GATE_STATUS.PASS },
    { id: 'final_readiness', status: GATE_STATUS.PASS },
    { id: 'final_proof', status: GATE_STATUS.PASS },
  ];
  const gatesOk = [{ id: 'g1', status: GATE_STATUS.PASS }, ...GATES_FINAIS];

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
  // Fixtures COMPLETAS e VÁLIDAS: identidade presente mas malformada é INCOMPLETA,
  // não é "coerente". (Os testes anteriores usavam 'C1'/'F1', que não têm formato
  // de commit/fingerprint e por isso legitimavam identidade inválida.)
  const atual = {
    runId: 'rap-governed-20261016144931085-033e1239',
    sourceCommit: '5efce7924932822c23888de97efc6243981da75e',
    sourceFingerprint: '1c10ffa62e169a18db1cd22e935fb41420fd5a865da58dd576b36a0f355d971e',
    releaseId: 'r-agent2-20261016-133323',
  };

  it('identidade idêntica E COMPLETA é coerente', () => {
    const r = identidadeCoerente({ identity: atual }, atual);
    expect(r.ok).toBe(true);
    expect(r.estado).toBe('COERENTE');
    expect(r.divergentes).toEqual([]);
    expect(r.faltantes).toEqual([]);
  });

  it('cada campo divergente é nomeado e o estado é DIVERGENTE', () => {
    for (const campo of ['runId', 'sourceCommit', 'sourceFingerprint', 'releaseId']) {
      const outra = { ...atual, [campo]: campo === 'sourceCommit' ? 'a'.repeat(40) : 'b'.repeat(64) };
      const r = identidadeCoerente({ identity: outra }, atual);
      expect(r.ok).toBe(false);
      expect(r.estado).toBe('DIVERGENTE');
      expect(r.divergentes).toContain(campo);
    }
  });

  // ── P0 CORRIGIDO (2026-10-16): ausência de identidade NÃO é identidade ───────
  it('decisão SEM identidade contra identidade atual completa ⇒ AUSENTE e ok=false', () => {
    const r = identidadeCoerente({ identity: {} }, atual);
    expect(r.ok).toBe(false);
    expect(r.estado).toBe('INCOMPLETA');
    expect(r.faltantes).toContain('runId');
    expect(r.faltantes).toContain('sourceCommit');
    expect(r.faltantes).toContain('sourceFingerprint');
  });

  it('identidade atual AUSENTE (ex.: .current-run.json inexistente) ⇒ ok=false', () => {
    const r = identidadeCoerente({ identity: atual }, {});
    expect(r.ok).toBe(false);
    expect(r.estado).toBe('INCOMPLETA');
  });

  it('os DOIS lados vazios ⇒ AUSENTE e ok=false (ausência nunca é coerência)', () => {
    const r = identidadeCoerente({ identity: {} }, {});
    expect(r.ok).toBe(false);
    expect(r.estado).toBe('AUSENTE');
  });

  it('identidade parcial (só runId) ⇒ INCOMPLETA e ok=false', () => {
    const r = identidadeCoerente({ identity: { runId: atual.runId } }, atual);
    expect(r.ok).toBe(false);
    expect(r.estado).toBe('INCOMPLETA');
    expect(r.faltantes).toContain('sourceCommit');
    expect(r.faltantes).toContain('sourceFingerprint');
  });

  it('campo presente mas com formato inválido ⇒ INCOMPLETA e ok=false', () => {
    const r = identidadeCoerente({ identity: { ...atual, sourceFingerprint: 'nao-e-hash' } }, atual);
    expect(r.ok).toBe(false);
    expect(r.estado).toBe('INCOMPLETA');
    expect(r.invalidos).toContain('sourceFingerprint');
  });

  it('campo ausente de um dos lados não é divergência — é ausência (não compara undefined)', () => {
    const r = identidadeCoerente({ identity: { ...atual, releaseId: undefined } }, atual);
    expect(r.divergentes).toEqual([]);
    expect(r.ok).toBe(true); // releaseId é opcional; os 3 obrigatórios batem
  });
});

describe('clasificar — POLÍTICA EXPLÍCITA de gate (P0 corrigido 2026-10-16)', () => {
  const base = { selado: true, certificado: true };
  const gate = (status, id = 'G1') => ({ id, status, obrigatorio: true });
  const GATES_FINAIS = () => [
    gate('PASS', 'final_governance'),
    gate('PASS', 'final_readiness'),
    gate('PASS', 'final_proof'),
  ];

  it('todos os gates PASS ⇒ CERTIFIED_GO (positivo)', () => {
    expect(clasificar({ ...base, gates: [gate('PASS'), gate('PASS', 'G2'), ...GATES_FINAIS()] }).state).toBe(STATES.CERTIFIED_GO);
  });

  // Matriz negativa obrigatória: NENHUM destes pode produzir GO final.
  const NAO_APROVADOS = [
    ['NOT_EXECUTED', 'GATE_STATUS_NAO_PERMITIDO'],
    ['UNKNOWN', 'GATE_STATUS_NAO_PERMITIDO'],
    ['SKIPPED', 'GATE_STATUS_NAO_PERMITIDO'],
    ['BLOCKED_EXTERNAL', 'GATE_STATUS_NAO_PERMITIDO'],
    ['WAT', 'GATE_STATUS_NAO_PERMITIDO'],
    ['not_executed', 'GATE_STATUS_NAO_PERMITIDO'],
    ['FAIL', 'GATE_OBRIGATORIO_FALHOU'],
    ['DEFERRED', 'GATE_OBRIGATORIO_DIFERIDO'],
  ];
  for (const [status, prefixoDoMotivo] of NAO_APROVADOS) {
    it(`gate obrigatório "${status}" bloqueia e não é GO final`, () => {
      const r = clasificar({ ...base, gates: [gate('PASS'), gate(status, 'G2')] });
      expect(isFinalGo(r.state)).toBe(false);
      expect(r.state).toBe(STATES.NO_GO);
      expect(r.reason.startsWith(prefixoDoMotivo)).toBe(true);
    });
  }

  it('gate BLOCKED ⇒ BLOCKED (não é GO final)', () => {
    const r = clasificar({ ...base, gates: [gate('PASS'), gate('BLOCKED', 'G2')] });
    expect(isFinalGo(r.state)).toBe(false);
    expect(r.state).toBe(STATES.BLOCKED);
  });

  it('gate PENDING e gate sem status ⇒ RUNNING (não é GO final)', () => {
    for (const status of ['PENDING', null, undefined]) {
      const r = clasificar({ ...base, gates: [gate('PASS'), gate(status, 'G2')] });
      expect(isFinalGo(r.state)).toBe(false);
      expect(r.state).toBe(STATES.RUNNING);
    }
  });

  it('lista de gates vazia ⇒ NOT_STARTED (não é GO final)', () => {
    const r = clasificar({ ...base, gates: [] });
    expect(isFinalGo(r.state)).toBe(false);
    expect(r.state).toBe(STATES.NOT_STARTED);
  });

  it('gate obrigatório SEM id ⇒ NO_GO (não existe gate anônimo)', () => {
    const r = clasificar({ ...base, gates: [{ status: 'PASS', obrigatorio: true }] });
    expect(r.state).toBe(STATES.NO_GO);
    expect(r.reason).toContain('GATE_OBRIGATORIO_SEM_ID');
  });

  it('gate obrigatório AUSENTE do conjunto esperado ⇒ NO_GO', () => {
    const r = clasificar({ ...base, gates: [gate('PASS')], gatesEsperados: ['G1', 'G9'] });
    expect(r.state).toBe(STATES.NO_GO);
    expect(r.reason).toContain('GATE_OBRIGATORIO_AUSENTE');
    expect(r.reason).toContain('G9');
  });

  it('gate pertencente a OUTRO run ⇒ NO_GO (relatório de outro ciclo não vale)', () => {
    const r = clasificar({
      ...base,
      identidade: { runId: 'rap-governed-AAA' },
      gates: [{ id: 'G1', status: 'PASS', obrigatorio: true, runId: 'rap-governed-BBB' }],
    });
    expect(r.state).toBe(STATES.NO_GO);
    expect(r.reason).toContain('GATE_DE_OUTRO_RUN');
  });

  it('gate não obrigatório em estado desconhecido não bloqueia o GO dos obrigatórios', () => {
    const r = clasificar({ ...base, gates: [gate('PASS'), ...GATES_FINAIS(), { id: 'G9', status: 'UNKNOWN', obrigatorio: false }] });
    expect(r.state).toBe(STATES.CERTIFIED_GO);
  });
});
