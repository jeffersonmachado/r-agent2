'use strict';

/**
 * Modelo PURO do estado de release e da disponibilidade das AÇÕES.
 *
 * Por que existe: a tela de release precisa dizer, sem enfeite, (a) qual artefato
 * foi selado, (b) se ele ainda corresponde ao código atual e (c) quais ações
 * estão REALMENTE disponíveis — e por que as demais não estão. A decisão é uma
 * função dos fatos observados, não do que a UI gostaria de oferecer.
 *
 * Regras fixadas:
 *   - o artefato entregue é válido NO COMMIT DELE. Se o HEAD atual difere do
 *     commit do run, o estado é `SUPERSEDED` — nunca "verificado";
 *   - `publish-tag` NÃO é oferecida quando um guard local recusa push de tag.
 *     A UI informa o motivo do guard em vez de contorná-lo (contornar guard de
 *     governança é exatamente o que a Constituição proíbe);
 *   - `seal` exige worktree limpo: o pipeline de selagem recusa árvore suja, e
 *     oferecer uma ação que já sabe que vai falhar é mentir para o operador.
 */

const VERDICTS = Object.freeze({
  DELIVERED_VERIFIED: 'DELIVERED_VERIFIED',
  // L-1 (2026-10-20): existe artefato entregue e o HEAD corresponde a ele, mas a
  // entrega NÃO está verificada (veredito ausente/negativo, bloqueio canônico
  // ativo, evidência indisponível ou identidade do run incompleta).
  DELIVERED_UNVERIFIED: 'DELIVERED_UNVERIFIED',
  SUPERSEDED: 'SUPERSEDED',
  SEALED_ONLY: 'SEALED_ONLY',
  NOT_SEALED: 'NOT_SEALED',
});

/**
 * Lacunas que IMPEDEM `DELIVERED_VERIFIED`.
 *
 * Defeito corrigido (L-1): o veredito era atribuído apenas por "existe artefato
 * entregue e o HEAD casa com o commit do run" — `blockers`, `evidenceUnavailable`
 * e `deliveredVerdict` eram RECEBIDOS e devolvidos, mas nunca consultados. Um
 * release com gate canônico vermelho (ou sem relatório de verificação nenhum)
 * aparecia como "Entregue verificada". Receber o fato e não o usar é a forma mais
 * silenciosa de falso GO.
 */
const VERIFICATION_GAPS = Object.freeze({
  DELIVERED_VERDICT_NOT_POSITIVE: 'DELIVERED_VERDICT_NOT_POSITIVE',
  RELEASE_BLOCKERS_PRESENT: 'RELEASE_BLOCKERS_PRESENT',
  EVIDENCE_UNAVAILABLE: 'EVIDENCE_UNAVAILABLE',
  RUN_IDENTITY_INCOMPLETE: 'RUN_IDENTITY_INCOMPLETE',
});

const ACTIONS = Object.freeze({
  VERIFY: 'verify',
  SEAL: 'seal',
  PUBLISH_TAG: 'publish-tag',
});

function toText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

/** Curto para exibição sem perder a identidade (prefixo de hash). */
function shortHash(value) {
  const text = toText(value);
  return text ? text.slice(0, 12) : null;
}

/**
 * @param {object} input
 * @param {object|null} input.run            contexto do run (`governance/.current-run.json`)
 * @param {object|null} input.head           `{ commit, tree, dirty, clean }` do worktree
 * @param {object} [input.artifacts]         `{ delivered: [], candidate: [], archive: [] }`
 * @param {object|null} [input.guard]        `{ blocksTagPush, reason, path }`
 * @param {Array}  [input.blockers]           bloqueios (gates/decisões) já classificados
 * @param {Array}  [input.evidenceUnavailable] relatórios que NÃO puderam ser lidos
 * @param {string|null} [input.releaseName]  nome do release selado (envelope)
 * @param {string|null} [input.deliveredVerdict] veredito gravado pela última verificação
 * @param {boolean|null} [input.deliveredOk]  resultado do predicado CANÔNICO do relatório de
 *   entrega (`DECISION_REPORTS.delivered_release.isOk`) — a positividade é decidida por UMA
 *   autoridade (o próprio relatório), não por casamento de token neste modelo
 */
function deriveReleaseState({
  run = null,
  head = null,
  artifacts = {},
  guard = null,
  blockers = [],
  evidenceUnavailable = [],
  releaseName = null,
  deliveredVerdict = null,
  deliveredOk = null,
} = {}) {
  const runCommit = toText(run && run.sourceCommit);
  const headCommit = toText(head && head.commit);
  const superseded = Boolean(runCommit && headCommit && runCommit !== headCommit);

  const delivered = Array.isArray(artifacts.delivered) ? artifacts.delivered : [];
  const candidate = Array.isArray(artifacts.candidate) ? artifacts.candidate : [];
  const hasDelivered = delivered.length > 0;
  const blockerList = Array.isArray(blockers) ? blockers : [];
  const unavailableList = Array.isArray(evidenceUnavailable) ? evidenceUnavailable : [];

  // L-1: `DELIVERED_VERIFIED` é uma AFIRMAÇÃO, não um sinônimo de "existe arquivo em
  // dist/release". Cada lacuna abaixo é um fato medido; qualquer uma delas derruba a
  // afirmação para `DELIVERED_UNVERIFIED` (nunca para um veredito positivo mais fraco).
  const verificationGaps = [];
  if (deliveredOk !== true) {
    verificationGaps.push({
      code: VERIFICATION_GAPS.DELIVERED_VERDICT_NOT_POSITIVE,
      detail: deliveredVerdict
        ? `veredito da entrega não é positivo (${deliveredVerdict})`
        : 'nenhum veredito de verificação da entrega foi produzido',
    });
  }
  if (blockerList.length > 0) {
    verificationGaps.push({
      code: VERIFICATION_GAPS.RELEASE_BLOCKERS_PRESENT,
      detail: `bloqueio(s) canônico(s): ${blockerList.map((b) => toText(b && b.code) || '?').join(', ')}`,
      blockers: blockerList,
    });
  }
  if (unavailableList.length > 0) {
    verificationGaps.push({
      code: VERIFICATION_GAPS.EVIDENCE_UNAVAILABLE,
      detail: `evidência indisponível: ${unavailableList.map((u) => toText(u && u.code) || '?').join(', ')}`,
      evidence: unavailableList,
    });
  }
  if (!runCommit) {
    verificationGaps.push({
      code: VERIFICATION_GAPS.RUN_IDENTITY_INCOMPLETE,
      detail: 'run corrente sem `sourceCommit`: a entrega não pode ser atribuída a um commit',
    });
  }

  let verdict;
  if (!hasDelivered && candidate.length === 0 && !releaseName) {
    verdict = VERDICTS.NOT_SEALED;
  } else if (!hasDelivered) {
    verdict = VERDICTS.SEALED_ONLY;
  } else if (superseded) {
    verdict = VERDICTS.SUPERSEDED;
  } else if (verificationGaps.length > 0) {
    verdict = VERDICTS.DELIVERED_UNVERIFIED;
  } else {
    verdict = VERDICTS.DELIVERED_VERIFIED;
  }

  const worktreeClean = head ? head.clean !== false : null;
  const guardBlocksTag = Boolean(guard && guard.blocksTagPush);

  const actions = [
    {
      id: ACTIONS.VERIFY,
      label: 'Verificar o entregue',
      description: 'Confere se a árvore atual corresponde ao artefato entregue (não altera nada).',
      enabled: true,
      blockedReason: null,
    },
    {
      id: ACTIONS.SEAL,
      label: 'Novo ciclo de selagem',
      description: 'Roda o ciclo completo (prepare → candidate → final → publish → consolidate).',
      enabled: worktreeClean === true,
      blockedReason: worktreeClean === false
        ? 'worktree sujo: o pipeline de selagem exige árvore limpa'
        : (worktreeClean === null ? 'não foi possível verificar o estado do worktree' : null),
    },
    {
      id: ACTIONS.PUBLISH_TAG,
      label: 'Publicar a tag do release',
      description: 'Cria e publica a tag anotada do release selado.',
      // L-1 (2026-10-20): publicar TAG é ato de release. Estar selado não é estar verificado —
      // a ação só é oferecida quando o veredito corrente é `DELIVERED_VERIFIED`. Antes bastava
      // existir `releaseName` e nenhum guard local, então um release com gate canônico vermelho
      // (ou sem relatório de entrega) oferecia o botão que publica a tag.
      enabled: Boolean(releaseName) && !guardBlocksTag && verdict === VERDICTS.DELIVERED_VERIFIED,
      blockedReason: !releaseName
        ? 'não há release selado para taguear'
        : (guardBlocksTag
          ? `guard local recusa push de tag (${toText(guard && guard.path) || '.git/hooks/pre-push'}): ${toText(guard && guard.reason) || 'sem motivo registrado'}`
          : (verdict !== VERDICTS.DELIVERED_VERIFIED
            ? `entrega NÃO verificada (${verdict}) — publicar tag exige \`DELIVERED_VERIFIED\`: ${verificationGaps.map((g) => g.code).join(', ') || 'sem verificação'}`
            : null)),
    },
  ];

  return {
    verdict,
    superseded,
    releaseName: toText(releaseName),
    deliveredVerdict: toText(deliveredVerdict),
    deliveredOk: deliveredOk === true,
    // Por que NÃO é "entregue verificada" (vazio quando o veredito é positivo). Sem artefato
    // entregue não há afirmação de entrega a desmentir: a lista fica vazia em vez de carregar
    // ruído sobre um entregue que não existe.
    verificationGaps: hasDelivered ? verificationGaps : [],
    // Compatibilidade: o campo segue exposto no formato anterior.
    blockers: blockerList.slice(),
    evidenceUnavailable: unavailableList.slice(),
    run: run
      ? {
        runId: toText(run.runId),
        sourceCommit: runCommit,
        sourceCommitShort: shortHash(runCommit),
        sourceFingerprint: toText(run.sourceFingerprint),
        startedAt: toText(run.startedAt),
        generatedAt: toText(run.generatedAt),
        status: toText(run.status),
      }
      : null,
    head: head
      ? {
        commit: headCommit,
        commitShort: shortHash(headCommit),
        tree: toText(head.tree),
        clean: head.clean === true,
        dirtyFiles: Number(head.dirtyCount) || 0,
      }
      : null,
    artifacts: {
      delivered,
      candidate,
      archive: Array.isArray(artifacts.archive) ? artifacts.archive : [],
    },
    guard: guard
      ? { blocksTagPush: guardBlocksTag, reason: toText(guard.reason), path: toText(guard.path) }
      : null,
    actions,
    explanation: verdict === VERDICTS.SUPERSEDED
      ? 'o artefato entregue é válido NO COMMIT DELE; o código atual mudou depois dele, então é necessário um novo ciclo de selagem'
      : (verdict === VERDICTS.DELIVERED_VERIFIED
        ? 'a árvore atual corresponde ao artefato entregue e a entrega está verificada'
        : (verdict === VERDICTS.DELIVERED_UNVERIFIED
          ? `a árvore atual corresponde ao artefato entregue, mas a entrega NÃO está verificada: ${verificationGaps.map((g) => g.detail).join('; ')}`
          : (verdict === VERDICTS.SEALED_ONLY
            ? 'há candidato/selagem em andamento, mas nenhum artefato entregue'
            : 'nenhum ciclo de selagem em andamento'))),
  };
}

module.exports = { VERDICTS, VERIFICATION_GAPS, ACTIONS, deriveReleaseState, shortHash };
