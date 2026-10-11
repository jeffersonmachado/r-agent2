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
  SUPERSEDED: 'SUPERSEDED',
  SEALED_ONLY: 'SEALED_ONLY',
  NOT_SEALED: 'NOT_SEALED',
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
} = {}) {
  const runCommit = toText(run && run.sourceCommit);
  const headCommit = toText(head && head.commit);
  const superseded = Boolean(runCommit && headCommit && runCommit !== headCommit);

  const delivered = Array.isArray(artifacts.delivered) ? artifacts.delivered : [];
  const candidate = Array.isArray(artifacts.candidate) ? artifacts.candidate : [];
  const hasDelivered = delivered.length > 0;

  let verdict;
  if (!hasDelivered && candidate.length === 0 && !releaseName) {
    verdict = VERDICTS.NOT_SEALED;
  } else if (!hasDelivered) {
    verdict = VERDICTS.SEALED_ONLY;
  } else if (superseded) {
    verdict = VERDICTS.SUPERSEDED;
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
      enabled: Boolean(releaseName) && !guardBlocksTag,
      blockedReason: !releaseName
        ? 'não há release selado para taguear'
        : (guardBlocksTag
          ? `guard local recusa push de tag (${toText(guard && guard.path) || '.git/hooks/pre-push'}): ${toText(guard && guard.reason) || 'sem motivo registrado'}`
          : null),
    },
  ];

  return {
    verdict,
    superseded,
    releaseName: toText(releaseName),
    deliveredVerdict: toText(deliveredVerdict),
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
    blockers: Array.isArray(blockers) ? blockers.slice() : [],
    // Evidência FALTANTE é declarada: não vira bloqueio inventado nem silêncio.
    evidenceUnavailable: Array.isArray(evidenceUnavailable) ? evidenceUnavailable.slice() : [],
    actions,
    explanation: verdict === VERDICTS.SUPERSEDED
      ? 'o artefato entregue é válido NO COMMIT DELE; o código atual mudou depois dele, então é necessário um novo ciclo de selagem'
      : (verdict === VERDICTS.DELIVERED_VERIFIED
        ? 'a árvore atual corresponde ao artefato entregue'
        : (verdict === VERDICTS.SEALED_ONLY
          ? 'há candidato/selagem em andamento, mas nenhum artefato entregue'
          : 'nenhum ciclo de selagem em andamento')),
  };
}

module.exports = { VERDICTS, ACTIONS, deriveReleaseState, shortHash };
