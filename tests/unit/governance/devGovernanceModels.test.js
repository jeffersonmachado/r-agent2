'use strict';

/**
 * Regressão dos modelos puros de pendências e de estado de release.
 *
 * Cobre os dois sentidos de cada regra (positivo e negativo) — incluindo os
 * defeitos MEDIDOS que motivaram cada uma:
 *   - falso bloqueio por token de decisão (`AUTONOMOUS_READY_GO` não é `GO`);
 *   - item concluído NÃO pode ser pendência (senão a tela vira ruído e o
 *     operador deixa de olhar);
 *   - fonte ilegível é DECLARADA, nunca vira lista vazia silenciosa.
 */

const {
  buildPendencies,
  filterPendencies,
  classifyQueueItem,
  classifyPendingWaiver,
  classifyReleaseBlocker,
} = require('../../../engine/governance/pendenciesModel');
const {
  deriveReleaseState,
  VERDICTS,
} = require('../../../engine/governance/releaseStateModel');

describe('pendenciesModel', () => {
  const queueItems = [
    { id: 'P1-11', title: 'Publicar tag', status: 'blocked', blocked_reason: 'guard local recusa push de tag', commit: null, evidence: 'x' },
    { id: 'P0-1', title: 'Feito', status: 'done', commit: 'abc', evidence: 'y' },
    { id: 'P1-9', title: 'Em execução', status: 'in_progress' },
  ];

  it('blocked exige ação humana e transporta a razão VERBATIM', () => {
    const item = classifyQueueItem(queueItems[0]);
    expect(item.requiresHumanAction).toBe(true);
    expect(item.why).toBe('guard local recusa push de tag');
    expect(item.severity).toBe('high');
  });

  it('done NÃO é pendência (e não ganha motivo inventado)', () => {
    const item = classifyQueueItem(queueItems[1]);
    expect(item.requiresHumanAction).toBe(false);
    expect(item.why).toBeNull();
  });

  it('blocked sem razão escrita é denunciado, não escondido', () => {
    const item = classifyQueueItem({ id: 'P9', title: 'x', status: 'blocked' });
    expect(item.requiresHumanAction).toBe(true);
    expect(item.why).toMatch(/sem razão registrada/);
  });

  it('waiver em PENDING_APPROVAL exige ação humana; aprovado não', () => {
    const pendente = classifyPendingWaiver({ waiver_key: 'w1', finding_key: 'k', state: 'PENDING_APPROVAL', reason: 'pin' });
    expect(pendente.requiresHumanAction).toBe(true);
    expect(pendente.why).toMatch(/NÃO vigente/);
    const aprovado = classifyPendingWaiver({ waiver_key: 'w2', finding_key: 'k', state: 'ACTIVE' });
    expect(aprovado.requiresHumanAction).toBe(false);
    expect(aprovado.why).toBeNull();
  });

  it('bloqueio de release só conta com declaração EXPLÍCITA (desconhecido não é bloqueio)', () => {
    // Regressão do defeito medido em 2026-10-11: `final-consistency-report.json`
    // tem pass=true e finalDecision=AUTONOMOUS_READY_GO; inferir bloqueio pelo
    // token da decisão criava pendência FALSA.
    const semDeclaracao = classifyReleaseBlocker({ code: 'x', title: 't', decision: 'AUTONOMOUS_READY_GO' });
    expect(semDeclaracao.requiresHumanAction).toBe(false);
    const declarado = classifyReleaseBlocker({ code: 'y', title: 't', decision: 'NO_GO', blocked: true, why: 'gate falhou' });
    expect(declarado.requiresHumanAction).toBe(true);
    expect(declarado.why).toBe('gate falhou');
    const declaradoOk = classifyReleaseBlocker({ code: 'z', title: 't', decision: 'NO_GO', blocked: false });
    expect(declaradoOk.requiresHumanAction).toBe(false);
  });

  it('monta o resumo e ordena por severidade e ação humana', () => {
    const result = buildPendencies({
      queueItems,
      waivers: [{ waiver_key: 'w1', finding_key: 'k', state: 'PENDING_APPROVAL' }],
      releaseBlockers: [{ code: 'r', title: 'gate', decision: 'NO_GO', blocked: true, why: 'z' }],
    });
    expect(result.summary.total).toBe(5);
    expect(result.summary.requiresHumanAction).toBe(4);
    expect(result.summary.blocked).toBe(1);
    expect(result.summary.awaitingApproval).toBe(1);
    expect(result.summary.done).toBe(1);
    expect(result.items[0].severity).toBe('high');
  });

  it('fonte indisponível é declarada e não vira item', () => {
    const result = buildPendencies({ queueItems: [], sourceUnavailable: ['AI_MEMORY/hardening-queue.json ausente'] });
    expect(result.items).toHaveLength(0);
    expect(result.sourceUnavailable).toEqual(['AI_MEMORY/hardening-queue.json ausente']);
  });

  it('onlyPending devolve SÓ o que exige ação humana', () => {
    const full = buildPendencies({ queueItems });
    expect(filterPendencies(full, { onlyPending: true }).items.map((i) => i.id)).toEqual(['P1-11', 'P1-9']);
    expect(filterPendencies(full, { onlyPending: false }).items).toHaveLength(3);
  });
});

describe('releaseStateModel', () => {
  const artifacts = { delivered: [{ name: 'r-agent2-20261011-083027.zip' }], candidate: [] };

  it('HEAD diferente do commit do run ⇒ SUPERSEDED (nunca "verificado")', () => {
    const state = deriveReleaseState({
      run: { sourceCommit: 'a'.repeat(40) },
      head: { commit: 'b'.repeat(40), clean: true },
      artifacts,
      releaseName: 'r-agent2-20261011-083027',
    });
    expect(state.verdict).toBe(VERDICTS.SUPERSEDED);
    expect(state.superseded).toBe(true);
    expect(state.explanation).toMatch(/válido NO COMMIT DELE/);
  });

  it('HEAD igual ao commit do run com entregue presente ⇒ DELIVERED_VERIFIED', () => {
    const sha = 'a'.repeat(40);
    const state = deriveReleaseState({
      run: { sourceCommit: sha },
      head: { commit: sha, clean: true },
      artifacts,
    });
    expect(state.verdict).toBe(VERDICTS.DELIVERED_VERIFIED);
  });

  it('guard local que recusa tag DESABILITA publish-tag e mostra o motivo', () => {
    const sha = 'a'.repeat(40);
    const state = deriveReleaseState({
      run: { sourceCommit: sha },
      head: { commit: sha, clean: true },
      artifacts,
      releaseName: 'r-agent2-20261011-083027',
      guard: { blocksTagPush: true, reason: 'push de TAG bloqueado', path: '.git/hooks/pre-push' },
    });
    const publish = state.actions.find((a) => a.id === 'publish-tag');
    expect(publish.enabled).toBe(false);
    expect(publish.blockedReason).toMatch(/push de TAG bloqueado/);
  });

  it('worktree sujo desabilita o selo (ofertar ação que já sabe que falha é mentir)', () => {
    const state = deriveReleaseState({
      run: { sourceCommit: 'a'.repeat(40) },
      head: { commit: 'a'.repeat(40), clean: false, dirtyCount: 3 },
      artifacts,
    });
    const seal = state.actions.find((a) => a.id === 'seal');
    expect(seal.enabled).toBe(false);
    expect(seal.blockedReason).toMatch(/worktree sujo/);
  });

  it('sem artefato nem candidato ⇒ NOT_SEALED; evidência faltante é declarada', () => {
    const state = deriveReleaseState({
      run: null,
      head: { commit: 'a'.repeat(40), clean: true },
      artifacts: { delivered: [], candidate: [] },
      evidenceUnavailable: [{ code: 'delivered_release', path: 'reports/x.json', reason: 'ausente' }],
    });
    expect(state.verdict).toBe(VERDICTS.NOT_SEALED);
    expect(state.evidenceUnavailable).toHaveLength(1);
    expect(state.blockers).toHaveLength(0);
  });

  it('verify continua disponível mesmo com tudo bloqueado (é leitura)', () => {
    const state = deriveReleaseState({ run: null, head: null, artifacts: {}, guard: { blocksTagPush: true } });
    expect(state.actions.find((a) => a.id === 'verify').enabled).toBe(true);
  });
});
