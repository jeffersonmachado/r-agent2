'use strict';

/**
 * api/services/engineeringMission/missionSourceService.js
 *
 * MOTOR DE I/O DA FONTE DE CÓDIGO DE UMA ENGINEERING MISSION.
 *
 * MODELO (declarado em `engine/engineeringMission/missionSource.js` — a decisão é pura, aqui é
 * apenas o efeito):
 *
 *   main (M0 — INTOCADA por toda a missão)
 *     └── engineering/missions/<missionId>   ← fonte de execução da missão
 *           ├── task A candidate → integra → M2
 *           ├── bug fix candidate → integra → M3   (mesmo caminho, sem privilégio)
 *           └── task B nasce de M3 (enxerga o fix)
 *
 * DEFEITO QUE ESTE SERVIÇO ELIMINA (confirmado no código em 2026-10-02): o worktree de uma
 * tentativa era materializado a partir de `git rev-parse HEAD` do ROOT, e o candidate era criado
 * com pai = HEAD do ROOT. O fix do Bug Loop ficava, portanto, numa branch isolada
 * (`engineering-router/candidates/<taskId>`) cujo pai era a `main` — e a task seguinte da missão
 * voltava a nascer da `main`. O patch corrigido NUNCA entrava no caminho de execução da missão, e
 * o bug "reaparecia" na replacement task. A recorrência era artefato de o fix nunca ter entrado na
 * source usada — não de o bug ter voltado.
 *
 * COMO A INTEGRAÇÃO FICA ATÔMICA (e por que não precisa de merge na maioria dos casos):
 *
 *   O candidate é criado com `git commit-tree <tree> -p <SOURCE>` — o PAI do candidate É o commit da
 *   fonte da missão (`EngineeringTask.source_commit`). Quando a fonte ainda está nesse mesmo commit,
 *   integrar é AVANÇAR A REF para o candidate: um fast-forward, sem merge, sem resolução de
 *   conflito. O avanço usa `git update-ref <ref> <novo> <antigo>`, que é um CAS ATÔMICO do próprio
 *   git — se a fonte avançou no meio, o `update-ref` falha e o avanço é recusado, nunca aplicado em
 *   cima do trabalho alheio.
 *
 *   Só quando o pai do candidate NÃO é mais o commit corrente da fonte é que existe divergência
 *   real; aí o candidato é obsoleto (STALE_CANDIDATE) e a aplicação cega é recusada por política.
 *
 * IDEMPOTÊNCIA (crash-safe): a tríade `(missionId, taskId, candidateCommit)` é a identidade do
 * efeito. Um processo que morre entre criar o commit na fonte e persistir o novo commit corrente é
 * recuperado porque a mesma tríade é reconhecida na tabela de integrações (índice único no banco) e
 * o patch NÃO é reaplicado — o `mission_current_commit` é RECONCILIADO com o commit que já está na
 * branch da fonte, em vez de integrar de novo.
 *
 * Nada aqui escreve na `main`. A promoção continua sendo um ato SEPARADO e explícito.
 */

const { execFile } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { ROOT } = require('../engineeringRouter/contextBuilderService');
const logger = require('../../utils/logger');
const source = require('../../../engine/engineeringMission/missionSource');
const { MISSION_FAILURE_CODES } = require('../../../engine/engineeringMission/constants');

const execFileAsync = util.promisify(execFile);

const WORKSPACE_ROOT = process.env.ENGINEERING_ROUTER_WORKSPACE_ROOT
  || path.join(os.tmpdir(), 'engineering-router-workspaces');

/** Erros de fonte de missão carregam código estável — o chamador decide por código, não por texto. */
function sourceError(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

async function runGit(args, { cwd, env } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: cwd || ROOT,
      maxBuffer: 20 * 1024 * 1024,
      env: env || process.env,
    });
    return { ok: true, stdout: String(stdout).trim(), stderr: String(stderr) };
  } catch (err) {
    return {
      ok: false,
      stdout: String(err.stdout || '').trim(),
      stderr: String(err.stderr || err.message || String(err)),
    };
  }
}

function models() {
  return require('../../db/models');
}

/**
 * Resolve o commit de um ref aceitando também a forma RASTREADA (`origin/<ref>`).
 *
 * MEDIDO no CI (run 39585223390, job "Integração real do Engenheiro"): 21 de 40 suítes
 * reprovaram com `não foi possível resolver o commit de origem "main"` (44 ocorrências).
 * A causa não é o código da missão: é a suposição de que a linha principal existe como
 * branch LOCAL. Num checkout de CI (e em qualquer clone raso/worktree destacado) a linha
 * principal pode existir apenas como `refs/remotes/origin/main` — o repositório tem o
 * commit, mas `rev-parse main` falha.
 *
 * Fail-closed preservado: continua sendo obrigatório que o commit exista em algum lugar.
 * Só passa a ser aceitável que ele exista como ref rastreado do remoto canônico.
 */
async function resolveRefCommit(ref, { cwd } = {}) {
  const candidatos = [`${ref}^{commit}`, `refs/remotes/origin/${ref}^{commit}`];
  for (const candidato of candidatos) {
    const result = await runGit(['rev-parse', '--verify', candidato], { cwd });
    if (result.ok) return result.stdout;
  }
  return null;
}

/** Commit atual da `main` — a medida que prova que a missão não tocou a linha principal. */
async function readMainCommit(ref = 'main', opcoes = {}) {
  return resolveRefCommit(ref, opcoes);
}

async function readCommitParent(commit) {
  const result = await runGit(['rev-parse', '--verify', `${commit}^`]);
  if (!result.ok) return null;
  return result.stdout;
}

async function commitExists(commit) {
  if (!commit) return false;
  const result = await runGit(['cat-file', '-e', `${commit}^{commit}`]);
  return result.ok;
}

async function branchExists(ref) {
  const result = await runGit(['rev-parse', '--verify', `refs/heads/${ref}`]);
  return result.ok ? result.stdout : null;
}

/**
 * PERSISTE O INTENT QUE AUTORIZA A CRIAÇÃO DA BRANCH DE FONTE.
 *
 * Ordem obrigatória (a mesma do avanço): o registro durável da intenção existe ANTES do efeito no
 * git. Sem ele, um processo morto logo após `git branch` deixaria uma branch de missão que nenhum
 * registro explica — e o boot seguinte a trataria como tamper (ou pior, a adotaria).
 *
 * Idempotente pela chave única (`mission-source-init:<missionId>`): dois workers concorrentes
 * produzem UM único intent; o perdedor recebe o existente. Esta é a trava que impede duas
 * inicializações concorrentes para a mesma missão.
 */
async function prepareInitializationIntent({
  missionId, baseCommit, integrationBranch, sourceRef = null, workerInstanceId = null,
} = {}) {
  const { EngineeringMissionIntegration } = models();
  const Integration = EngineeringMissionIntegration();
  const integrationKey = source.buildInitializationKey({ missionId });
  const worker = workerInstanceId || process.env.ENGINEERING_WORKER_INSTANCE_ID || `pid-${process.pid}`;

  const existing = await Integration.findOne({ where: { integration_key: integrationKey } });
  if (existing) {
    const row = existing.get ? existing.get({ plain: true }) : existing;
    if (source.isTerminalIntegrationStatus(row.integration_status)) {
      return { intent: row, created: false, terminal: true, integrationKey };
    }
    return { intent: row, created: false, terminal: false, integrationKey };
  }

  try {
    const row = await Integration.create({
      mission_id: missionId,
      task_id: null,
      finding_id: null,
      integration_type: source.INITIALIZATION_INTEGRATION_TYPE,
      integration_result: null,
      integration_status: 'PREPARED',
      candidate_commit: baseCommit,
      candidate_base_commit: null,
      mission_commit_before: null,
      mission_commit_after: null,
      integration_branch: integrationBranch,
      integration_key: integrationKey,
      source_fence: 0,
      expected_mission_commit: null,
      expected_fence: null,
      worker_instance_id: worker,
      tests: [],
      review: {},
      regression: {},
      evidence: { phase: 'PREPARED', kind: 'MISSION_SOURCE_INITIALIZATION', sourceRef },
    });
    const plain = row.get ? row.get({ plain: true }) : row;
    logger.info('[missionSource] InitializationIntent PREPARED persistido antes de criar a branch da fonte', {
      missionId, branch: integrationBranch, baseCommit: String(baseCommit).slice(0, 12), worker,
    });
    return { intent: plain, created: true, terminal: false, integrationKey };
  } catch (err) {
    if (err && (err.name === 'SequelizeUniqueConstraintError' || /unique/i.test(String(err.message)))) {
      const race = await Integration.findOne({ where: { integration_key: integrationKey } });
      const row = race && race.get ? race.get({ plain: true }) : race;
      return { intent: row, created: false, terminal: row ? source.isTerminalIntegrationStatus(row.integration_status) : false, integrationKey };
    }
    logger.error('[missionSource] falha ao persistir InitializationIntent (a branch NÃO pode ser criada)', {
      missionId, errorName: err && err.name, errorMessage: err && err.message,
    });
    throw err;
  }
}

/**
 * FECHA a inicialização da fonte: grava o estado no banco e marca o intent COMMITTED.
 *
 * É o passo que a janela de crash pode ter perdido (branch criada, banco ainda sem source). Chamado
 * tanto pelo caminho normal quanto pela reconciliação — o efeito é o MESMO nos dois, e é idempotente
 * porque a branch e o `mission_current_commit` já convergem para `baseCommit`.
 */
async function finishMissionSourceInitialization({ missionId, baseCommit, branch, sourceRef = 'main', intentId = null, actor = null } = {}) {
  const { EngineeringMission } = models();
  const Mission = EngineeringMission();
  const mission = await Mission.findByPk(missionId);
  if (!mission) throw sourceError('MISSION_NOT_FOUND', `mission ${missionId} não encontrada`);

  const alreadyPersisted = mission.mission_current_commit
    && mission.mission_current_commit === baseCommit
    && mission.mission_integration_branch === branch;

  if (!alreadyPersisted) {
    await mission.update({
      mission_source_ref: mission.mission_source_ref || sourceRef,
      mission_base_commit: mission.mission_base_commit || baseCommit,
      mission_integration_branch: branch,
      mission_current_commit: baseCommit,
      mission_source_fence: Number(mission.mission_source_fence || 0),
      mission_source_state: 'READY',
      mission_workspace_id: mission.mission_workspace_id || `mission-ws-${String(missionId).slice(0, 8)}`,
    });
  }
  if (intentId) {
    await transitionIntegrationIntent(intentId, 'COMMITTED', {
      missionCommitAfter: baseCommit,
      result: 'INTEGRATED',
      extra: { phase: 'COMMITTED', kind: 'MISSION_SOURCE_INITIALIZATION', initializedAt: new Date().toISOString() },
    });
  }
  logger.info('[missionSource] fonte da missão inicializada', {
    missionId, branch, baseCommit: String(baseCommit).slice(0, 12), actor, alreadyPersisted,
  });
  return getMissionSource(missionId);
}

/**
 * Materializa (ou reaproveita) a fonte isolada de uma missão.
 *
 * ORDEM DE PRECEDÊNCIA (crash-safe, nesta ordem e por este motivo):
 *   1. RECONCILIAR os intents não-terminais da PRÓPRIA missão — antes de julgar qualquer coisa. Um
 *      intent pendente compatível com o estado real (branch=candidate, DB=esperado) NÃO é tamper:
 *      é uma operação a meio caminho que a matriz determinística sabe fechar. Julgar antes de
 *      reconciliar classificava a janela de crash como divergência.
 *   2. Se a branch EXISTE e a missão ainda não tem source no banco: só é legítimo se houver
 *      InitializationIntent; sem ele, `UNTRUSTED_MISSION_SOURCE_INITIALIZATION` (nunca adotar).
 *   3. Se a branch existe e há source: gate de ADOÇÃO (commit tem de ser explicado).
 *   4. Se a branch NÃO existe e a missão TEM commit corrente: RECRIAÇÃO no commit autoritativo
 *      (nunca na origem/main) — desde que a proveniência prove o commit; senão
 *      `MISSION_SOURCE_RECOVERY_REQUIRED`.
 *   5. Caso contrário: INICIALIZAÇÃO, com intent persistido ANTES do `git branch`.
 *
 * Idempotente por natureza em todos os caminhos: rodar duas vezes não cria uma segunda branch, não
 * move o commit e não avança o fence (o fence só avança quando o COMMIT muda).
 */
async function ensureMissionSource(missionId, { actor = null, sourceRef = null } = {}) {
  if (!missionId) throw sourceError('MISSION_SOURCE_ID_REQUIRED', 'missionId é obrigatório');

  const branch = source.buildIntegrationBranchName(missionId);
  const { EngineeringMission } = models();
  const Mission = EngineeringMission();
  let mission = await Mission.findByPk(missionId);
  if (!mission) throw sourceError('MISSION_NOT_FOUND', `mission ${missionId} não encontrada`);

  // ---- 1. RECONCILIAÇÃO ANTES DE JULGAR ------------------------------------------------------
  // Fechar o estado dos intents pendentes desta missão primeiro. Sem isto, a janela legítima de
  // crash (branch à frente do banco, intent GIT_APPLIED) seria lida como divergência e a missão
  // seria marcada DIVERGENCE por um estado que a própria matriz sabe curar.
  try {
    const reconciled = await reconcileMissionSourceIntents({ missionId });
    if (reconciled.reconciled > 0) {
      mission = await Mission.findByPk(missionId);
    }
  } catch (err) {
    logger.error('[missionSource] reconciliação prévia de intents falhou; seguindo com o estado persistido', {
      missionId, errorName: err && err.name, errorMessage: err && err.message,
    });
  }

  const existingBranchCommit = await branchExists(branch);

  // ---- 2. BRANCH EXISTE SEM SOURCE NO BANCO ⇒ inicialização a meio caminho -------------------
  if (existingBranchCommit && !mission.mission_current_commit) {
    const { EngineeringMissionIntegration } = models();
    const Integration = EngineeringMissionIntegration();
    const initIntent = await Integration.findOne({
      where: {
        mission_id: missionId,
        integration_type: source.INITIALIZATION_INTEGRATION_TYPE,
        integration_key: source.buildInitializationKey({ missionId }),
      },
    });
    const initRow = initIntent && initIntent.get ? initIntent.get({ plain: true }) : initIntent;

    if (!initRow) {
      const evidence = {
        code: 'UNTRUSTED_MISSION_SOURCE_INITIALIZATION',
        reason: 'a branch de fonte existe mas não há InitializationIntent que a autorize — adoção recusada (pode ser push/rebase/worktree externo)',
        detectedAt: new Date().toISOString(),
        branch,
        branchCommit: existingBranchCommit,
        detectedBy: 'ensureMissionSource',
        actor,
      };
      await mission.update({
        mission_source_state: 'DIVERGENCE',
        failure: { ...(mission.failure || {}), missionSourceDivergence: evidence },
      });
      logger.error('[missionSource] UNTRUSTED_MISSION_SOURCE_INITIALIZATION — branch inicial sem intent recuperável; adoção recusada', evidence);
      throw sourceError('UNTRUSTED_MISSION_SOURCE_INITIALIZATION', `
[missionSource] a branch ${branch} existe em ${String(existingBranchCommit).slice(0, 12)} sem InitializationIntent — a missão foi marcada DIVERGENCE.`, evidence);
    }

    const initializedBase = String(initRow.candidate_commit || '').trim();
    if (initializedBase === '' || String(existingBranchCommit) !== initializedBase) {
      await transitionIntegrationIntent(initRow.id, 'RECOVERY_REQUIRED', {
        extra: { phase: 'INITIALIZATION_DIVERGENCE', branchCommit: existingBranchCommit, expectedBase: initializedBase || null, at: new Date().toISOString() },
      });
      await mission.update({ mission_source_state: 'RECOVERY_REQUIRED' });
      throw sourceError('MISSION_SOURCE_RECOVERY_REQUIRED',
        `[missionSource] branch ${branch} em ${String(existingBranchCommit).slice(0, 12)} diverge da base autorizada ${initializedBase.slice(0, 12) || '(ausente)'} — recuperação controlada exigida`,
        { branch, branchCommit: existingBranchCommit, expectedBase: initializedBase || null });
    }

    // Crash entre o `git branch` e a persistência: o intent existe e a branch está na base
    // autorizada ⇒ termina a inicialização sem recriar nada e SEM avançar o fence.
    return finishMissionSourceInitialization({
      missionId, baseCommit: initializedBase, branch, sourceRef: mission.mission_source_ref || sourceRef || 'main',
      intentId: initRow.id, actor,
    });
  }

  if (existingBranchCommit) {
    // ---- 3. GATE: a branch NÃO pode ser adotada só porque existe --------------------------------
    const trail = await listIntegrations(missionId);
    const explainedCommits = [
      mission.mission_base_commit,
      ...trail.filter((row) => row.integration_result === 'INTEGRATED').map((row) => row.mission_commit_after),
    ].filter(Boolean);

    const adoption = source.classifyBranchAdoption({
      branchCommit: existingBranchCommit,
      expectedMissionCommit: mission.mission_current_commit || mission.mission_base_commit,
      explainedCommits,
    });

    if (!adoption.adopt) {
      // Não adota, não continua tasks, não promove — e a evidência fica DURÁVEL na missão.
      const evidence = {
        code: adoption.code,
        reason: adoption.reason,
        detectedAt: new Date().toISOString(),
        branch,
        branchCommit: existingBranchCommit,
        expectedMissionCommit: mission.mission_current_commit || null,
        missionBaseCommit: mission.mission_base_commit || null,
        explainedCommits,
        detectedBy: 'ensureMissionSource',
        actor: actor || null,
      };
      await mission.update({
        mission_source_state: 'DIVERGENCE',
        failure: { ...(mission.failure || {}), missionSourceDivergence: evidence },
      });
      logger.error('[missionSource] MISSION_SOURCE_DIVERGENCE — branch não explicada por intent/receipt; adoção recusada', evidence);
      throw sourceError('MISSION_SOURCE_DIVERGENCE', `
[missionSource] a branch ${branch} está em ${String(existingBranchCommit).slice(0, 12)}, commit que nenhum IntegrationIntent/receipt explica (esperado ${String(mission.mission_current_commit || mission.mission_base_commit || '').slice(0, 12)}). Adoção recusada: a missão foi marcada DIVERGENCE e exige reparo controlado.`, evidence);
    }

    // A fonte já existe e o commit é EXPLICADO: adota. Nunca re-deriva da main — isso descartaria as
    // integrações que a missão já fez.
    if (mission.mission_current_commit !== existingBranchCommit || mission.mission_source_state !== 'READY') {
      await mission.update({
        mission_integration_branch: branch,
        mission_current_commit: existingBranchCommit,
        mission_source_state: 'READY',
        mission_source_ref: mission.mission_source_ref || sourceRef || 'main',
      });
    }
    return getMissionSource(missionId);
  }

  // ---- 4. BRANCH AUSENTE COM SOURCE PERSISTIDA ⇒ RECRIAÇÃO NO COMMIT AUTORITATIVO -------------
  // DEFEITO ELIMINADO: antes, este caso caía no caminho de criação a partir da ORIGEM e a missão
  // voltava para a main (M0), perdendo todas as integrações em silêncio.
  if (mission.mission_current_commit) {
    const trail = await listIntegrations(missionId);
    const provenanceCommits = trail
      .filter((row) => row.integration_result === 'INTEGRATED')
      .map((row) => row.mission_commit_after)
      .filter(Boolean);
    const recovery = source.classifyBranchDeletionRecovery({
      missionCurrentCommit: mission.mission_current_commit,
      missionBaseCommit: mission.mission_base_commit,
      provenanceCommits,
    });

    if (!recovery.recoverable) {
      const evidence = {
        code: recovery.code,
        reason: recovery.reason,
        detectedAt: new Date().toISOString(),
        branch,
        missionCurrentCommit: mission.mission_current_commit,
        missionBaseCommit: mission.mission_base_commit || null,
        provenanceCommits,
        detectedBy: 'ensureMissionSource',
        actor: actor || null,
      };
      await mission.update({
        mission_source_state: 'RECOVERY_REQUIRED',
        failure: { ...(mission.failure || {}), missionSourceRecoveryRequired: evidence },
      });
      logger.error('[missionSource] MISSION_SOURCE_RECOVERY_REQUIRED — branch apagada sem proveniência que prove o commit corrente', evidence);
      throw sourceError('MISSION_SOURCE_RECOVERY_REQUIRED', recovery.reason, evidence);
    }

    if (!(await commitExists(recovery.commit))) {
      await mission.update({
        mission_source_state: 'RECOVERY_REQUIRED',
        failure: {
          ...(mission.failure || {}),
          missionSourceRecoveryRequired: {
            code: 'MISSION_SOURCE_COMMIT_UNRESOLVABLE', reason: recovery.reason,
            commit: recovery.commit, detectedAt: new Date().toISOString(), detectedBy: 'ensureMissionSource',
          },
        },
      });
      throw sourceError('MISSION_SOURCE_RECOVERY_REQUIRED',
        `[missionSource] o commit autoritativo ${String(recovery.commit).slice(0, 12)} não existe mais no repositório — recuperação controlada exigida`,
        { commit: recovery.commit });
    }

    const createResult = await runGit(['branch', branch, recovery.commit]);
    if (!createResult.ok) {
      throw sourceError('MISSION_SOURCE_BRANCH_RECREATE_FAILED', `falha ao recriar a fonte da missão ${branch} em ${String(recovery.commit).slice(0, 12)}: ${createResult.stderr}`);
    }
    await mission.update({ mission_integration_branch: branch, mission_source_state: 'READY' });
    logger.warn('[missionSource] branch de fonte RECRIADA no commit autoritativo (nunca na main)', {
      missionId, branch, commit: String(recovery.commit).slice(0, 12), code: recovery.code || 'PROVEN_BY_RECEIPT', actor,
    });
    return getMissionSource(missionId);
  }

  // ---- 5. INICIALIZAÇÃO (comportamento novo: intent ANTES do git) ------------------------------
  const origin = sourceRef || mission.mission_source_ref || mission.branch || 'main';
  if (source.isForbiddenSourceRef(origin) === false && source.isMissionBranch(origin)) {
    throw sourceError('MISSION_SOURCE_REF_INVALID', `ref de origem "${origin}" é uma branch de missão — a origem deve ser a linha principal`);
  }

  const baseCommit = await branchExists(origin) || await readMainCommit(origin);
  if (!baseCommit) {
    throw sourceError('MISSION_SOURCE_ORIGIN_UNRESOLVABLE', `não foi possível resolver o commit de origem "${origin}"`);
  }

  // (a) INTENT DURÁVEL — a intenção é gravada ANTES de qualquer efeito no git. Dois workers
  // concorrentes colidem aqui na chave única: apenas um cria, e ambos usam o MESMO intent.
  const init = await prepareInitializationIntent({
    missionId, baseCommit, integrationBranch: branch, sourceRef: origin,
    workerInstanceId: process.env.ENGINEERING_WORKER_INSTANCE_ID || null,
  });
  if (init.terminal) {
    // Já houve inicialização terminal: nada a criar; adota o que estiver persistido.
    return getMissionSource(missionId);
  }

  // (b) EFEITO no git. Idempotente: se outro worker já criou a branch na MESMA base, isso é
  // convergência legítima (mesmo intent), não erro.
  const createResult = await runGit(['branch', branch, baseCommit]);
  if (!createResult.ok) {
    const now = await branchExists(branch);
    if (now !== baseCommit) {
      await transitionIntegrationIntent(init.intent.id, 'RECOVERY_REQUIRED', {
        extra: { phase: 'INITIALIZATION_FAILED', branchCommit: now, expectedBase: baseCommit, stderr: createResult.stderr },
      });
      throw sourceError('MISSION_SOURCE_BRANCH_CREATE_FAILED',
        `falha ao criar a fonte da missão ${branch}: ${createResult.stderr}`,
        { branch, branchCommit: now, expectedBase: baseCommit });
    }
  }

  // (c) PERSISTÊNCIA do estado da missão + (d) COMMITTED no intent.
  return finishMissionSourceInitialization({
    missionId, baseCommit, branch, sourceRef: origin, intentId: init.intent.id, actor,
  });
}

/** Leitura da fonte persistida (sem efeito colateral). */
async function getMissionSource(missionId) {
  const { EngineeringMission } = models();
  const Mission = EngineeringMission();
  const mission = await Mission.findByPk(missionId);
  if (!mission) return null;
  return {
    missionId,
    sourceRef: mission.mission_source_ref || null,
    baseCommit: mission.mission_base_commit || null,
    integrationBranch: mission.mission_integration_branch || null,
    currentCommit: mission.mission_current_commit || null,
    state: mission.mission_source_state || 'PENDING',
    fence: Number(mission.mission_source_fence || 0),
    workspaceId: mission.mission_workspace_id || null,
  };
}

/**
 * Commit da fonte a ser usado por uma NOVA task desta missão.
 *
 * É a peça que faz a herança existir: `startExecution` grava este commit na task (`source_commit`),
 * e `patchApplyService.createWorkspace` materializa o worktree A PARTIR DELE. Sem isso, a task
 * voltaria a nascer da main — o defeito original.
 */
async function resolveTaskSource(missionId) {
  const current = await getMissionSource(missionId);
  if (!current) throw sourceError('MISSION_NOT_FOUND', `mission ${missionId} não encontrada`);
  if (!current.currentCommit) {
    throw sourceError(
      MISSION_FAILURE_CODES.MISSION_TASK_NOT_LINKED,
      `missão ${missionId} não possui fonte materializada — chame ensureMissionSource antes de criar a task`,
    );
  }
  return current;
}

/**
 * Registra UMA tentativa de integração (append-only). Serve tanto para o sucesso quanto para a
 * recusa: uma integração recusada por pré-condição é evidência de governança funcionando, não um
 * evento a ser omitido.
 */
async function recordIntegration(entry = {}) {
  const { EngineeringMissionIntegration } = models();
  const Integration = EngineeringMissionIntegration();
  const integrationKey = entry.integrationKey || source.buildIntegrationKey({
    missionId: entry.missionId,
    taskId: entry.taskId,
    candidateCommit: entry.candidateCommit,
  });

  try {
    // Se esta tríade JÁ tem um intent durável (criado antes do efeito no git), o desfecho é
    // gravado EVOLUINDO essa linha — nunca criando uma segunda. Sem isto, a `integration_key`
    // única colidiria e o desfecho se perderia em silêncio (o `duplicate:true` abaixo engoliria
    // um resultado real).
    const existing = await Integration.findOne({ where: { integration_key: integrationKey } });
    if (existing) {
      const row = existing.get ? existing.get({ plain: true }) : existing;
      if (source.isTerminalIntegrationStatus(row.integration_status)) {
        return { recorded: false, id: row.id, duplicate: true };
      }
      const terminalStatus = entry.integrationResult === 'INTEGRATED'
        ? 'COMMITTED'
        : (entry.integrationResult === 'CONFLICT' ? 'CONFLICT' : 'ABORTED');
      await Integration.update({
        finding_id: entry.findingId || row.finding_id || null,
        integration_type: entry.integrationType || row.integration_type,
        integration_result: entry.integrationResult,
        integration_status: terminalStatus,
        candidate_base_commit: entry.candidateBaseCommit || row.candidate_base_commit || null,
        mission_commit_before: entry.missionCommitBefore || row.mission_commit_before || null,
        mission_commit_after: entry.missionCommitAfter || row.mission_commit_after || null,
        integration_branch: entry.integrationBranch || row.integration_branch || null,
        source_fence: Number(entry.sourceFence || row.source_fence || 0),
        tests: entry.tests || [],
        review: entry.review || {},
        regression: entry.regression || {},
        evidence: entry.evidence || {},
        conflict: entry.conflict || null,
        error: entry.error || null,
        committed_at: terminalStatus === 'COMMITTED' ? new Date() : row.committed_at,
      }, { where: { id: row.id } });
      return { recorded: true, id: row.id, duplicate: false, evolvedIntent: true };
    }

    const row = await Integration.create({
      mission_id: entry.missionId,
      task_id: entry.taskId || null,
      finding_id: entry.findingId || null,
      integration_type: entry.integrationType,
      integration_result: entry.integrationResult,
      integration_status: entry.integrationResult === 'INTEGRATED' ? 'COMMITTED' : 'ABORTED',
      candidate_commit: entry.candidateCommit,
      candidate_base_commit: entry.candidateBaseCommit || null,
      mission_commit_before: entry.missionCommitBefore || null,
      mission_commit_after: entry.missionCommitAfter || null,
      integration_branch: entry.integrationBranch || null,
      integration_key: integrationKey,
      source_fence: Number(entry.sourceFence || 0),
      tests: entry.tests || [],
      review: entry.review || {},
      regression: entry.regression || {},
      evidence: entry.evidence || {},
      conflict: entry.conflict || null,
      error: entry.error || null,
      committed_at: entry.integrationResult === 'INTEGRATED' ? new Date() : null,
    });
    return { recorded: true, id: row.id, duplicate: false };
  } catch (err) {
    // Colisão na chave única = a MESMA tríade já foi registrada. Isso é o mecanismo de idempotência
    // funcionando, não um erro: duas tentativas concorrentes, uma venceu.
    if (err && (err.name === 'SequelizeUniqueConstraintError' || /unique/i.test(String(err.message)))) {
      logger.warn('[missionSource] integração duplicada detectada pela chave única', {
        missionId: entry.missionId, taskId: entry.taskId, candidateCommit: String(entry.candidateCommit).slice(0, 12),
      });
      return { recorded: false, id: null, duplicate: true };
    }
    // Falha que NÃO é colisão de idempotência é um defeito real de persistência: registrar a causa
    // exata antes de propagar (sem ela, o sintoma visível é só um stack de Sequelize).
    logger.error('[missionSource] falha ao registrar integração na trilha de auditoria', {
      missionId: entry.missionId,
      taskId: entry.taskId,
      result: entry.integrationResult,
      errorName: err && err.name,
      errorMessage: err && err.message,
      dbCode: err && err.parent && err.parent.code,
      dbDetail: err && err.parent && err.parent.message,
    });
    throw err;
  }
}

/** Histórico de integrações de uma missão (auditoria / idempotência de retomada). */
async function listIntegrations(missionId, { limit = 200 } = {}) {
  const { EngineeringMissionIntegration } = models();
  const Integration = EngineeringMissionIntegration();
  const rows = await Integration.findAll({
    where: { mission_id: missionId },
    order: [['created_at', 'ASC']],
    limit,
  });
  return (rows || []).map((row) => (row.get ? row.get({ plain: true }) : row));
}

/**
 * PREPARA O INTEGRATIONINTENT — o registro DURÁVEL que autoriza tocar na ref git.
 *
 * Tem de ser chamada ANTES de `advanceMissionSource`. É o que fecha a janela de crash: depois dela,
 * a intenção de avançar a branch está no banco mesmo que o processo morra no instante seguinte ao
 * `git update-ref`. Sem este registro, o avanço da ref seria um efeito sem causa auditável.
 *
 * IDEMPOTENTE pela `integration_key` (mesma tríade): duas tentativas da MESMA operação devolvem o
 * MESMO intent — nunca criam dois efeitos. A colisão na chave única é o mecanismo de idempotência
 * funcionando (vive no banco), não um erro.
 */
async function prepareIntegrationIntent({
  missionId,
  taskId,
  findingId = null,
  integrationType = 'TASK_CANDIDATE',
  candidateCommit,
  candidateBaseCommit = null,
  expectedMissionCommit = null,
  expectedFence = null,
  integrationBranch = null,
  workerInstanceId = null,
} = {}) {
  const { EngineeringMissionIntegration } = models();
  const Integration = EngineeringMissionIntegration();
  const integrationKey = source.buildIntegrationKey({ missionId, taskId, candidateCommit });
  const worker = workerInstanceId || process.env.ENGINEERING_WORKER_INSTANCE_ID || `pid-${process.pid}`;

  const existing = await Integration.findOne({ where: { integration_key: integrationKey } });
  if (existing) {
    const row = existing.get ? existing.get({ plain: true }) : existing;
    if (source.isTerminalIntegrationStatus(row.integration_status)) {
      return { intent: row, created: false, terminal: true, integrationKey };
    }
    return { intent: row, created: false, terminal: false, integrationKey };
  }

  try {
    const row = await Integration.create({
      mission_id: missionId,
      task_id: taskId || null,
      finding_id: findingId || null,
      integration_type: integrationType,
      // Sem desfecho ainda: o resultado só existe quando a operação termina. É justamente por isso
      // que `integration_result` deixou de ser NOT NULL.
      integration_result: null,
      integration_status: 'PREPARED',
      candidate_commit: candidateCommit,
      candidate_base_commit: candidateBaseCommit,
      mission_commit_before: expectedMissionCommit,
      mission_commit_after: null,
      integration_branch: integrationBranch,
      integration_key: integrationKey,
      source_fence: Number(expectedFence || 0),
      expected_mission_commit: expectedMissionCommit,
      expected_fence: expectedFence === null || expectedFence === undefined ? null : Number(expectedFence),
      worker_instance_id: worker,
      tests: [],
      review: {},
      regression: {},
      evidence: { phase: 'PREPARED' },
    });
    const plain = row.get ? row.get({ plain: true }) : row;
    logger.info('[missionSource] IntegrationIntent PREPARED persistido antes do efeito no git', {
      missionId, taskId, candidateCommit: String(candidateCommit).slice(0, 12), worker,
    });
    return { intent: plain, created: true, terminal: false, integrationKey };
  } catch (err) {
    if (err && (err.name === 'SequelizeUniqueConstraintError' || /unique/i.test(String(err.message)))) {
      const race = await Integration.findOne({ where: { integration_key: integrationKey } });
      const row = race && race.get ? race.get({ plain: true }) : race;
      return { intent: row, created: false, terminal: row ? source.isTerminalIntegrationStatus(row.integration_status) : false, integrationKey };
    }
    logger.error('[missionSource] falha ao persistir IntegrationIntent (o avanço da ref NÃO pode prosseguir)', {
      missionId, taskId, errorName: err && err.name, errorMessage: err && err.message,
    });
    throw err;
  }
}

/**
 * Transiciona a fase do intent. Só avança (PREPARED→GIT_APPLIED→DB_APPLIED→COMMITTED); uma
 * transição para fase já atingida é idempotente e não reescreve o carimbo original.
 */
async function transitionIntegrationIntent(intentId, status, { missionCommitAfter = null, result = null, extra = {} } = {}) {
  const { EngineeringMissionIntegration } = models();
  const Integration = EngineeringMissionIntegration();
  const now = new Date();
  const patch = { integration_status: status };
  if (status === 'GIT_APPLIED') patch.git_applied_at = now;
  if (status === 'DB_APPLIED') patch.db_applied_at = now;
  if (status === 'COMMITTED') patch.committed_at = now;
  if (missionCommitAfter) patch.mission_commit_after = missionCommitAfter;
  if (result) patch.integration_result = result;
  if (Object.keys(extra).length > 0) patch.evidence = extra;

  await Integration.update(patch, { where: { id: intentId } });
  return { id: intentId, status };
}

/**
 * CAS DO COMMIT CORRENTE DA FONTE + AVANÇO DO FENCE — autoridade ÚNICA da mudança de posição.
 *
 * REGRA INVIOLÁVEL (enunciada na missão de 2026-10-03): TODA mudança autoritativa de
 * `mission_current_commit` (M2 → M3) avança `mission_source_fence` (N → N+1) — no caminho normal,
 * em retry, em recovery de boot e em reconciliação. O estado final tem de ser SEMANTICAMENTE
 * IDÊNTICO nos quatro caminhos, senão o fence deixa de ser prova de posse e um worker morto com o
 * fence antigo continua autorizado a escrever.
 *
 * DEFEITO QUE ESTA FUNÇÃO ELIMINA (confirmado no código em 2026-10-03): a reconciliação pós-crash
 * gravava `mission_current_commit = candidate` SEM tocar no fence e SEM CAS. Resultado:
 *   normal  M2/N → M3/N+1
 *   recovery M2/N → M3/N          ← fence vencido continuava válido
 * A branch avançava e o fence não, então `Worker A` (fence N) voltava e a escrita protegida dele era
 * ACEITA sobre uma fonte que ele não possuía mais.
 *
 * O CAS usa `expectedCommit` + `expectedFence` (nunca só o commit): um avanço concorrente que já
 * mudou a linha — ou cujo fence avançou — perde aqui e é reportado, nunca sobrescrito.
 */
async function applySourceAdvanceCommit({
  missionId, expectedCommit = null, expectedFence = null, candidateCommit, state = 'READY',
} = {}) {
  const { EngineeringMission } = models();
  const Mission = EngineeringMission();

  // Sem fence esperado declarado não há CAS de posse: lê-se o valor corrente AGORA (nunca um valor
  // capturado antes, que ficaria obsoleto depois de outro intent aplicado).
  let fence = expectedFence;
  if (fence === null || fence === undefined) {
    const current = await Mission.findByPk(missionId);
    fence = Number(current && current.mission_source_fence ? current.mission_source_fence : 0);
  }

  const where = { id: missionId, mission_source_fence: Number(fence) };
  if (expectedCommit !== null && expectedCommit !== undefined && String(expectedCommit).trim() !== '') {
    where.mission_current_commit = expectedCommit;
  }

  const [updated] = await Mission.update(
    {
      mission_current_commit: candidateCommit,
      mission_source_fence: Number(fence) + 1,
      mission_source_state: state,
    },
    { where },
  );
  return { advanced: updated === 1, fenceBefore: Number(fence), fenceAfter: Number(fence) + 1 };
}

/**
 * Reconciliação determinística dos intents NÃO terminais de uma missão.
 *
 * É o que a retomada (boot, loop periódico e `ensureMissionSource`) chama: para cada intent que
 * ficou no meio do caminho, lê o estado REAL (ref git + commit do banco) e aplica a matriz pura —
 * nunca improvisa e nunca reaplica um efeito já aplicado.
 *
 * DUAS CORREÇÕES ESTRUTURAIS (2026-10-03, ambas confirmadas no código):
 *
 *   1. ESTADO FRESCO POR INTENT. Antes, `dbCommit` era capturado UMA vez antes do laço e reutilizado
 *      para todos os intents. Com dois intents pendentes, o segundo era avaliado contra o commit
 *      ANTERIOR ao primeiro — e a matriz, que decide por igualdade exata de commit, classificava o
 *      segundo como divergência. Agora a missão é relida (e a branch reexaminada) ANTES de cada
 *      intent: `reload → read branch → evaluate → apply → reload next`.
 *
 *   2. FENCE AVANÇA JUNTO COM O COMMIT. Antes, o caminho FINISH_DB/COMMIT_RECEIPT gravava
 *      `mission_current_commit = candidate` sem CAS e SEM tocar no fence. O commit avançava e o
 *      fence não, então um worker morto com o fence antigo continuava autorizado a escrever sobre
 *      uma fonte que não possuía. Agora o avanço passa por `applySourceAdvanceCommit`, que faz CAS
 *      em `(expectedCommit, expectedFence)` e grava `fence + 1` — o MESMO resultado do caminho
 *      normal. Recovery e caminho normal convergem para o mesmo estado.
 */
async function reconcileMissionSourceIntents({ missionId } = {}) {
  const { EngineeringMissionIntegration, EngineeringMission } = models();
  const Integration = EngineeringMissionIntegration();
  const Mission = EngineeringMission();

  const rows = await Integration.findAll({
    where: { mission_id: missionId, integration_status: ['PREPARED', 'GIT_APPLIED', 'DB_APPLIED', 'RECOVERY_REQUIRED'] },
    order: [['created_at', 'ASC']],
  });
  const intents = (rows || []).map((r) => (r.get ? r.get({ plain: true }) : r));
  if (intents.length === 0) return { reconciled: 0, outcomes: [] };

  const outcomes = [];

  for (const intent of intents) {
    // ---- ESTADO FRESCO: relê a missão e a branch a CADA intent (nunca um snapshot reutilizado) ----
    const mission = await Mission.findByPk(missionId);
    const dbCommit = mission ? mission.mission_current_commit : null;
    const dbFence = mission ? Number(mission.mission_source_fence || 0) : 0;

    // ---- INICIALIZAÇÃO da fonte (não tem task/candidate de integração) -------------------------
    if (intent.integration_type === source.INITIALIZATION_INTEGRATION_TYPE) {
      const initOutcome = await reconcileInitializationIntent({ intent, mission, branchExists });
      outcomes.push({ intentId: intent.id, kind: 'INITIALIZATION', candidateCommit: String(intent.candidate_commit).slice(0, 12), ...initOutcome });
      continue;
    }

    const branch = intent.integration_branch;
    const branchCommit = branch ? await branchExists(branch) : null;
    const decision = source.classifyIntegrationReconciliation({
      status: intent.integration_status,
      branchCommit,
      dbCommit,
      expectedMissionCommit: intent.expected_mission_commit || intent.mission_commit_before,
      candidateCommit: intent.candidate_commit,
    });

    if (decision.outcome === 'FINISH_DB' || decision.outcome === 'COMMIT_RECEIPT') {
      // O git JÁ está no candidate: o efeito foi autorizado por este intent. Completa-se o banco /
      // receita de forma determinística, SEM tocar na ref de novo — e com o MESMO avanço de fence
      // do caminho normal.
      const expectedCommit = intent.expected_mission_commit || intent.mission_commit_before || null;
      const expectedFence = intent.expected_fence === null || intent.expected_fence === undefined
        ? dbFence
        : Number(intent.expected_fence);

      // DB já no candidate (COMMIT_RECEIPT): nada a avançar; só finaliza o receipt. Caso contrário,
      // aplica o CAS que a morte do processo interrompeu.
      let applied = { advanced: true, fenceBefore: expectedFence, fenceAfter: Number(expectedFence) + 1 };
      if (decision.outcome === 'FINISH_DB') {
        applied = await applySourceAdvanceCommit({
          missionId,
          expectedCommit,
          expectedFence,
          candidateCommit: intent.candidate_commit,
        });
      }

      if (!applied.advanced) {
        // O CAS perdeu: outro dono já moveu/avançou a linha depois do git. NÃO se sobrescreve —
        // exige-se reparo controlado (e o fence NÃO é forçado para cima).
        await transitionIntegrationIntent(intent.id, 'RECOVERY_REQUIRED', {
          extra: {
            phase: 'CONCURRENT_SOURCE_UPDATE', code: 'CONCURRENT_MISSION_SOURCE_UPDATE',
            reason: `CAS do banco perdeu na reconciliação (fence esperado ${applied.fenceBefore}, corrente ${dbFence})`,
            reconciledAt: new Date().toISOString(),
          },
        });
        outcomes.push({
          intentId: intent.id, candidateCommit: String(intent.candidate_commit).slice(0, 12),
          outcome: 'CONCURRENT_SOURCE_UPDATE', code: 'CONCURRENT_MISSION_SOURCE_UPDATE', reapply: false,
        });
        continue;
      }

      await transitionIntegrationIntent(intent.id, decision.outcome === 'FINISH_DB' ? 'DB_APPLIED' : 'COMMITTED', {
        missionCommitAfter: intent.candidate_commit,
        result: 'INTEGRATED',
        extra: { phase: decision.outcome, reconciledBy: 'boot_reconciliation', reconciledAt: new Date().toISOString() },
      });
      if (decision.outcome === 'FINISH_DB') {
        await transitionIntegrationIntent(intent.id, 'COMMITTED', { result: 'INTEGRATED' });
      }
      outcomes.push({
        intentId: intent.id, candidateCommit: String(intent.candidate_commit).slice(0, 12),
        ...decision, fenceBefore: applied.fenceBefore, fenceAfter: applied.fenceAfter,
      });
      continue;
    }

    if (decision.outcome === 'DIVERGENCE' || decision.outcome === 'DB_AHEAD_OF_GIT'
      || decision.outcome === 'BLOCKED_REQUIRES_REPAIR') {
      // DEFEITO MEDIDO (2026-10-27): `BLOCKED_REQUIRES_REPAIR` NÃO era persistido. O intent voltava
      // ao scan da reconciliação em TODO boot, sem nunca sair de PREPARED/GIT_APPLIED/DB_APPLIED —
      // pílula envenenada que consumia o orçamento do lote e deixava de fora o intent recém-crashado
      // (medido: 138 missões varridas, 0 reconciliadas, backlog de 209 e o intent novo sem vez).
      // "Requer reparo" É um estado terminal para a reconciliação AUTOMÁTICA — e é o que o próprio
      // desfecho se chama.
      await transitionIntegrationIntent(intent.id, 'RECOVERY_REQUIRED', {
        extra: { phase: decision.outcome, code: decision.code, reason: decision.reason, reconciledAt: new Date().toISOString() },
      });
      // NÃO se marca o estado da MISSÃO aqui — decisão revertida por medição (revisão de 2026-10-28).
      //
      // A intenção era boa (quem opera lê a missão, não o intent), mas o RAIO DE DANO é grande demais:
      // a classificação é feita contra o repositório DESTE processo. Num boot cujo repo não enxerga as
      // refs de missão (clone novo, deploy sem as branches, processo apontando para repo sintético),
      // TODA missão com intent não-terminal vira `BLOCKED_REQUIRES_REPAIR` — e passar a escrever
      // `mission_source_state='RECOVERY_REQUIRED'` na missão marcaria como "requer reparo" missões que
      // estão sadias, sem caminho de volta. Medido: mutação/probe marcaram missão alheia READY→
      // RECOVERY_REQUIRED numa base compartilhada.
      //
      // A dívida continua VISÍVEL e sem esse risco pelo agregado do boot (`needsRepair`, contado de
      // todas as linhas em RECOVERY_REQUIRED) — sinal global, sem tocar estado de missão individual.
    }

    outcomes.push({ intentId: intent.id, candidateCommit: String(intent.candidate_commit).slice(0, 12), ...decision });
  }

  return { reconciled: outcomes.filter((o) => o.outcome === 'FINISH_DB' || o.outcome === 'COMMIT_RECEIPT').length, outcomes };
}

/**
 * Reconciliação de um InitializationIntent (a branch de fonte pode nunca ter sido criada, ou ter
 * sido criada e o banco não).
 *
 * Três estados possíveis, cada um com UM desfecho determinístico:
 *   intent + branch ausente            → recria a branch na base autorizada (retry da criação);
 *   intent + branch na base esperada   → finaliza o banco (o efeito git já estava autorizado);
 *   intent + branch em outro commit    → RECOVERY_REQUIRED (nunca adotar commit não autorizado).
 */
async function reconcileInitializationIntent({ intent, mission, branchExists: branchExistsFn }) {
  const branch = intent.integration_branch || (mission ? source.buildIntegrationBranchName(mission.id) : null);
  const baseCommit = String(intent.candidate_commit || '').trim();
  const existing = branch ? await branchExistsFn(branch) : null;

  if (mission && mission.mission_current_commit) {
    // O banco já tem source (a inicialização terminou ou foi reconciliada antes). Nada a fazer além
    // de fechar o intent; qualquer divergência real é tratada pelo gate de adoção.
    await transitionIntegrationIntent(intent.id, 'COMMITTED', {
      missionCommitAfter: mission.mission_current_commit,
      result: 'INTEGRATED',
      extra: { phase: 'COMMITTED', kind: 'MISSION_SOURCE_INITIALIZATION', reconciledBy: 'init_reconciliation' },
    });
    return { outcome: 'COMMIT_RECEIPT', code: null, reapply: false };
  }

  if (!existing) {
    if (!baseCommit) {
      await transitionIntegrationIntent(intent.id, 'RECOVERY_REQUIRED', { extra: { phase: 'INITIALIZATION_NO_BASE' } });
      return { outcome: 'BLOCKED_REQUIRES_REPAIR', code: 'MISSION_SOURCE_RECOVERY_REQUIRED', reapply: false };
    }
    const createResult = await runGit(['branch', branch, baseCommit]);
    if (!createResult.ok) {
      const now = await branchExistsFn(branch);
      if (now !== baseCommit) {
        await transitionIntegrationIntent(intent.id, 'RECOVERY_REQUIRED', {
          extra: { phase: 'INITIALIZATION_RETRY_FAILED', stderr: createResult.stderr, branchCommit: now },
        });
        return { outcome: 'BLOCKED_REQUIRES_REPAIR', code: 'MISSION_SOURCE_RECOVERY_REQUIRED', reapply: false };
      }
    }
  } else if (String(existing) !== baseCommit) {
    await transitionIntegrationIntent(intent.id, 'RECOVERY_REQUIRED', {
      extra: { phase: 'INITIALIZATION_DIVERGENCE', branchCommit: existing, expectedBase: baseCommit },
    });
    return { outcome: 'DIVERGENCE', code: 'UNTRUSTED_MISSION_SOURCE_INITIALIZATION', reapply: false };
  }

  await finishMissionSourceInitialization({
    missionId: mission.id, baseCommit, branch, sourceRef: (mission && mission.mission_source_ref) || 'main', intentId: intent.id,
  });
  return { outcome: 'FINISH_DB', code: null, reapply: false, fenceBefore: 0, fenceAfter: 0 };
}

/**
 * Avança a fonte da missão — CAS em duas camadas.
 *
 * Camada 1 (banco): `UPDATE ... WHERE mission_current_commit = <esperado> AND mission_source_fence =
 * <esperado>`. Um avanço concorrente que já mudou a linha perde aqui.
 * Camada 2 (git): `git update-ref <ref> <novo> <antigo>` — o próprio git recusa se a ref não
 * estiver mais em `<antigo>`. As duas juntas garantem que o commit persistido e o commit da branch
 * nunca divirjam em silêncio.
 *
 * A ordem importa: o git primeiro (efeito real), o banco depois. Se o processo morrer no meio, a
 * branch está à frente do banco — estado que a reconciliação (mesma tríade na trilha) detecta e
 * corrige SEM reaplicar o patch. A ordem inversa deixaria o banco mentindo sobre código que não
 * existe, que é o pior dos dois.
 */
/**
 * FAILPOINT de crash controlado.
 *
 * Existe para o E2E matar o processo EXATAMENTE na janela crítica (depois do `git update-ref` e
 * antes do CAS do banco), que é o modo de falha real encontrado. Sem um ponto de parada explícito,
 * reproduzir essa janela dependeria de sorte de timing e o teste não provaria nada.
 */
function maybeCrashAtFailpoint(name) {
  const configured = String(process.env.ENGINEERING_MISSION_FAILPOINT || '').trim();
  if (configured === '' || configured !== name) return;
  logger.error('[missionSource] FAILPOINT atingido — encerrando o processo para reproduzir a janela de crash', {
    failpoint: name, pid: process.pid,
  });
  // Saída SÍNCRONA e imediata: simula morte abrupta (o processo não completa o passo seguinte).
  process.exit(97);
}

async function advanceMissionSource({ missionId, expectedCommit, newCommit, expectedFence, branch, intentId = null }) {
  // ---- 0. GATE: ref git NÃO avança sem IntegrationIntent persistido ---------------------------------
  // Este gate é a proibição explícita do enunciado. Antes dele, `git update-ref` era um efeito sem
  // causa auditável: se o processo morresse logo depois, nada no banco explicava a branch ter andado.
  if (!intentId) {
    return {
      advanced: false,
      code: 'INTEGRATION_INTENT_REQUIRED',
      reason: 'recusado: avançar a ref da fonte exige um IntegrationIntent persistido (PREPARED) para este candidate/commit esperado',
    };
  }
  const { EngineeringMissionIntegration } = models();
  const Integration = EngineeringMissionIntegration();
  const intentRow = await Integration.findByPk(intentId);
  const intent = intentRow && intentRow.get ? intentRow.get({ plain: true }) : intentRow;
  if (!intent) {
    return { advanced: false, code: 'INTEGRATION_INTENT_REQUIRED', reason: `intent ${intentId} não encontrado — avanço recusado` };
  }
  if (intent.integration_status !== 'PREPARED') {
    return {
      advanced: false,
      code: 'INTEGRATION_INTENT_NOT_PREPARED',
      reason: `intent em fase ${intent.integration_status} não autoriza novo avanço (só PREPARED autoriza)`,
    };
  }
  if (String(intent.candidate_commit) !== String(newCommit)) {
    return { advanced: false, code: 'INTEGRATION_INTENT_MISMATCH', reason: 'o candidateCommit do intent não é o commit que se pretende aplicar' };
  }
  const intentExpected = String(intent.expected_mission_commit || '').trim();
  if (intentExpected !== '' && intentExpected !== String(expectedCommit)) {
    return { advanced: false, code: 'INTEGRATION_INTENT_MISMATCH', reason: 'o expectedMissionCommit do intent não é o commit corrente esperado — recusado' };
  }

  // ---- 0.1 GATE DE POSSE — ANTES de tocar na ref git -------------------------------------------
  // DEFEITO ELIMINADO (2026-10-03): o `git update-ref` não conhece fence. Quem recusava uma posse
  // vencida era o CAS do BANCO, que acontece DEPOIS do efeito no git. Um worker morto que voltasse
  // com o fence antigo conseguia MOVER A REF e só então perdia o CAS — deixando a branch da missão
  // avançada por uma escrita que não era dele (e o estado caía em "concorrência" em vez de
  // STALE_FENCE_REJECTED). A posse é verificada AQUI, contra o estado VIVO, antes de qualquer efeito.
  {
    const { EngineeringMission } = models();
    const MissionProbe = EngineeringMission();
    const live = await MissionProbe.findByPk(missionId);
    const liveFence = Number((live && live.mission_source_fence) || 0);
    const liveCommit = live ? live.mission_current_commit : null;

    if (expectedFence !== null && expectedFence !== undefined && Number(expectedFence) !== liveFence) {
      return {
        advanced: false,
        code: 'STALE_FENCE_REJECTED',
        fenceBefore: liveFence,
        expectedFence: Number(expectedFence),
        reason: `posse vencida (STALE_FENCE_REJECTED): o worker esperava o fence ${expectedFence} mas a missão está no fence ${liveFence} — escrita recusada ANTES de tocar na ref git (o fence aponta para uma geração de posse que não existe mais)`,
      };
    }
    if (String(liveCommit || '') !== String(expectedCommit || '')) {
      return {
        advanced: false,
        code: 'CONCURRENT_MISSION_SOURCE_UPDATE',
        currentCommit: liveCommit,
        reason: `a fonte já está em ${String(liveCommit).slice(0, 12)}, não em ${String(expectedCommit).slice(0, 12)} — avanço recusado antes do git`,
      };
    }
  }

  const refResult = await runGit(['update-ref', `refs/heads/${branch}`, newCommit, expectedCommit]);
  if (!refResult.ok) {
    return {
      advanced: false,
      code: 'CONCURRENT_MISSION_SOURCE_UPDATE',
      reason: `update-ref atômico recusado: a fonte ${branch} não está mais em ${String(expectedCommit).slice(0, 12)}`,
      stderr: refResult.stderr,
    };
  }

  // O git efetivou o avanço: a ref JÁ está no candidate. Registra-se a fase imediatamente — a
  // partir daqui qualquer morte é reconciliável (branch=candidate + db=esperado → FINISH_DB).
  await transitionIntegrationIntent(intentId, 'GIT_APPLIED');

  // JANELA CRÍTICA: entre a ref git avançada e o CAS do banco. É exatamente aqui que o
  // failpoint existe, porque era aqui que o processo podia morrer sem deixar rastro.
  maybeCrashAtFailpoint('after_git_update_ref_before_db_cas');

  const { EngineeringMission } = models();
  const Mission = EngineeringMission();

  // CAS em (expectedCommit, expectedFence) + avanço do fence — a MESMA função usada pela
  // reconciliação. Caminho normal e caminho de recovery convergem para o mesmo estado final.
  const applied = await applySourceAdvanceCommit({
    missionId,
    expectedCommit,
    expectedFence: expectedFence === null || expectedFence === undefined ? null : Number(expectedFence),
    candidateCommit: newCommit,
  });

  if (!applied.advanced) {
    // O git já avançou, mas o CAS do banco perdeu: houve concorrência. O commit está na branch (o
    // código é real), então reconcilia-se o banco para o MESMO commit em vez de reverter o git —
    // a fonte da missão é o que as tasks vão ler, e ela está correta.
    const fresh = await Mission.findByPk(missionId);
    logger.warn('[missionSource] CAS de banco perdeu após update-ref (reconciliando)', {
      missionId, expected: String(expectedCommit).slice(0, 12), actual: String(fresh && fresh.mission_current_commit).slice(0, 12),
    });
    if (fresh && fresh.mission_current_commit === newCommit) {
      return { advanced: true, reconciled: true, code: null };
    }
    return {
      advanced: false,
      code: 'CONCURRENT_MISSION_SOURCE_UPDATE',
      reason: 'a fonte avançou no git mas o registro da missão mudou de dono — reconciliação necessária',
    };
  }

  await transitionIntegrationIntent(intentId, 'DB_APPLIED', { missionCommitAfter: newCommit });

  return { advanced: true, code: null, fenceBefore: applied.fenceBefore, fenceAfter: applied.fenceAfter };
}

/**
 * INTEGRA UM CANDIDATE NA FONTE DA MISSÃO.
 *
 * Esta é a função que fecha o gap central. Ela é o ÚNICO caminho pelo qual trabalho de uma task
 * passa a valer para as próximas — e ela exige, antes de qualquer efeito:
 *
 *   1. idempotência (a tríade já entrou? então não reaplica);
 *   2. pré-condições objetivas (task GREEN, testes, review, regressão, posse, integridade);
 *   3. que o candidate derive do commit CORRENTE da fonte (senão é STALE);
 *   4. que o pai do candidate seja esse mesmo commit (garante fast-forward, sem merge cego);
 *   5. CAS no avanço.
 *
 * @returns {Promise<{integrated:boolean, code:string, result:string, ...}>}
 */
async function integrateCandidate({
  missionId,
  taskId,
  findingId = null,
  candidateCommit,
  integrationType = 'TASK_CANDIDATE',
  preconditions = {},
  tests = [],
  review = {},
  regression = {},
  evidence = {},
  expectedFence = null,
  actor = null,
} = {}) {
  const integrationTypeResolved = source.INTEGRATION_TYPES.includes(integrationType) ? integrationType : 'TASK_CANDIDATE';

  if (!missionId) throw sourceError('MISSION_SOURCE_ID_REQUIRED', 'missionId é obrigatório para integrar');
  if (!taskId) throw sourceError('MISSION_SOURCE_TASK_REQUIRED', 'taskId é obrigatório para integrar');
  if (!candidateCommit) throw sourceError('MISSION_SOURCE_CANDIDATE_REQUIRED', 'candidateCommit é obrigatório para integrar');

  // Identificadores são STRINGS. Um objeto de task passado no lugar do id produziria um erro de
  // banco (coluna uuid recebendo objeto) que não diz nada sobre a causa — falha-se aqui, com o
  // motivo explícito.
  const asId = (value, label) => (value && typeof value === 'object' ? String(value.id || '') : String(value || '')).trim();
  const missionIdValue = asId(missionId, 'missionId');
  const taskIdValue = asId(taskId, 'taskId');
  if (missionIdValue === '' || taskIdValue === '') {
    throw sourceError(
      'MISSION_SOURCE_ID_MALFORMED',
      'missionId/taskId precisam ser identificadores (string ou objeto com `id`), não valores vazios',
      { received: { missionId: typeof missionId, taskId: typeof taskId } },
    );
  }

  const current = await getMissionSource(missionIdValue);
  if (!current) throw sourceError('MISSION_NOT_FOUND', `mission ${missionIdValue} não encontrada`);

  const integrationKey = source.buildIntegrationKey({ missionId: missionIdValue, taskId: taskIdValue, candidateCommit });

  // ---- 1. IDEMPOTÊNCIA --------------------------------------------------------------------
  // Antes de qualquer efeito: esta tríade já entrou? Um processo que morreu entre o commit e a
  // persistência é retomado aqui, sem reaplicar o patch.
  const history = await listIntegrations(missionIdValue);
  const already = source.isIntegrationAlreadyRecorded({ existingRecords: history, integrationKey });
  if (already.recorded) {
    const recordedAfter = already.record && already.record.mission_commit_after;
    // RECONCILIAÇÃO: se a branch já está à frente do que a missão registra (crash entre git e
    // banco), o commit corrente é corrigido para o valor REAL da integração já efetuada.
    if (recordedAfter && current.currentCommit !== recordedAfter) {
      const branchCommit = await branchExists(current.integrationBranch);
      if (branchCommit === recordedAfter) {
        // O MESMO CAS do caminho normal: commit E fence avançam juntos. Antes, este caminho
        // gravava só o commit e o fence ficava no valor antigo — um worker morto continuava
        // autorizado a escrever sobre a fonte que ele já não possuía.
        const applied = await applySourceAdvanceCommit({
          missionId: missionIdValue,
          expectedCommit: current.currentCommit,
          expectedFence: current.fence,
          candidateCommit: recordedAfter,
        });
        logger.warn('[missionSource] reconciliação pós-crash: commit corrente alinhado com a branch', {
          missionIdValue, commit: String(recordedAfter).slice(0, 12),
          fenceBefore: applied.fenceBefore, fenceAfter: applied.fenceAfter, advanced: applied.advanced,
        });
        return {
          integrated: true, reconciled: true, result: 'ALREADY_INTEGRATED', code: null,
          integrationKey, missionCommitAfter: recordedAfter, fenceAfter: applied.fenceAfter,
          reason: 'a integração já havia sido efetuada no git; o registro da missão foi reconciliado sem reaplicar o patch',
        };
      }
    }
    return {
      integrated: true, reconciled: false, result: 'ALREADY_INTEGRATED', code: null,
      integrationKey, missionCommitAfter: recordedAfter || current.currentCommit,
      reason: 'idempotência: esta tríade (missionId, taskId, candidateCommit) já foi integrada',
    };
  }

  const baseFailure = async (code, result, reason, extra = {}) => {
    await recordIntegration({
      missionId: missionIdValue, taskId: taskIdValue, findingId, integrationType: integrationTypeResolved,
      integrationResult: result, candidateCommit,
      candidateBaseCommit: extra.candidateBaseCommit || null,
      missionCommitBefore: current.currentCommit,
      missionCommitAfter: null, integrationBranch: current.integrationBranch,
      integrationKey, sourceFence: current.fence,
      tests, review, regression, evidence: { ...evidence, reason },
      conflict: extra.conflict || null, error: extra.error || null,
    });
    return { integrated: false, result, code, reason, integrationKey, ...extra };
  };

  // ---- 2. PRÉ-CONDIÇÕES ------------------------------------------------------------------
  const pre = source.assessIntegrationPreconditions(preconditions);
  if (!pre.eligible) {
    return baseFailure(pre.code, 'PRECONDITION_FAILED', pre.reason, { missing: pre.missing });
  }

  // ---- 3. INTEGRIDADE DO CANDIDATE --------------------------------------------------------
  if (!(await commitExists(candidateCommit))) {
    return baseFailure('INTEGRITY_FAILED', 'INTEGRITY_FAILED',
      `o commit candidate ${String(candidateCommit).slice(0, 12)} não existe no repositório`);
  }

  const candidateParent = await readCommitParent(candidateCommit);

  // ---- 4. STALE ---------------------------------------------------------------------------
  const staleness = source.classifyCandidateStaleness({
    candidateBaseCommit: candidateParent,
    missionCurrentCommit: current.currentCommit,
  });
  if (staleness.stale) {
    return baseFailure('STALE_CANDIDATE', 'STALE_CANDIDATE', staleness.reason, {
      candidateBaseCommit: candidateParent,
      reason_detail: staleness.code,
    });
  }

  // ---- 5. INTENT DURÁVEL ANTES DE QUALQUER EFEITO NO GIT ----------------------------------
  // Ordem obrigatória: persistir a intenção ANTES do `git update-ref`, marcar GIT_APPLIED depois
  // dele, e só então o CAS do banco. Qualquer morte de processo passa a ser reconciliável a partir
  // do intent que já está no banco.
  const intent = await prepareIntegrationIntent({
    missionId: missionIdValue,
    taskId: taskIdValue,
    findingId,
    integrationType: integrationTypeResolved,
    candidateCommit,
    candidateBaseCommit: candidateParent,
    expectedMissionCommit: current.currentCommit,
    expectedFence: expectedFence === null ? current.fence : expectedFence,
    integrationBranch: current.integrationBranch,
    workerInstanceId: process.env.ENGINEERING_WORKER_INSTANCE_ID || null,
  });
  if (intent.terminal) {
    return {
      integrated: true, reconciled: false, result: 'ALREADY_INTEGRATED', code: null, integrationKey,
      missionCommitAfter: intent.intent.mission_commit_after || current.currentCommit,
      reason: 'idempotência: intent já terminal para esta tríade',
    };
  }

  // ---- 6. AVANÇO CAS ----------------------------------------------------------------------
  const advance = await advanceMissionSource({
    missionId: missionIdValue,
    expectedCommit: current.currentCommit,
    newCommit: candidateCommit,
    expectedFence: expectedFence === null ? current.fence : expectedFence,
    branch: current.integrationBranch,
    intentId: intent.intent.id,
  });

  if (!advance.advanced) {
    // O git recusou o avanço: a fonte mudou de posição. NÃO aplicar cegamente — recusa explícita.
    // O intent é encerrado como ABORTED (terminal) para não ser varrido como pendência eterna.
    await transitionIntegrationIntent(intent.intent.id, 'ABORTED', {
      result: 'CONCURRENT_SOURCE_UPDATE',
      extra: { phase: 'ABORTED', code: advance.code, reason: advance.reason },
    });
    return baseFailure(advance.code, 'CONCURRENT_SOURCE_UPDATE', advance.reason, {
      candidateBaseCommit: candidateParent, error: { stderr: advance.stderr || null },
    });
  }

  await recordIntegration({
    missionId: missionIdValue, taskId: taskIdValue, findingId, integrationType: integrationTypeResolved,
    integrationResult: 'INTEGRATED', candidateCommit,
    candidateBaseCommit: candidateParent,
    missionCommitBefore: current.currentCommit,
    missionCommitAfter: candidateCommit,
    integrationBranch: current.integrationBranch,
    integrationKey, sourceFence: current.fence,
    tests, review, regression, evidence: { ...evidence, phase: 'COMMITTED' },
  });

  logger.info('[missionSource] candidate integrado na fonte da missão', {
    missionId: missionIdValue, taskId: taskIdValue, findingId, integrationType: integrationTypeResolved,
    from: String(current.currentCommit).slice(0, 12), to: String(candidateCommit).slice(0, 12), actor,
  });

  return {
    integrated: true, reconciled: false, result: 'INTEGRATED', code: null,
    integrationKey,
    missionCommitBefore: current.currentCommit,
    missionCommitAfter: candidateCommit,
    integrationBranch: current.integrationBranch,
    reason: `candidate integrado: a fonte da missão avançou de ${String(current.currentCommit).slice(0, 12)} para ${String(candidateCommit).slice(0, 12)} — a próxima task nasce deste commit`,
  };
}

/**
 * Revalida o patch JÁ INTEGRADO na fonte da missão (não no worktree isolado do candidate).
 *
 * POR QUE ISSO EXISTE: um candidate pode passar isolado e ainda assim quebrar quando combinado com
 * os patches que já estão na fonte (dois patches que tocam a mesma região são o caso óbvio, mas
 * também vale para contratos: A muda a assinatura, B chama a antiga). Verificar a reprodução no
 * commit da FONTE é o que distingue "o fix funciona sozinho" de "o fix funciona no sistema que a
 * missão está construindo".
 *
 * Roda em worktree descartável a partir do commit informado — nunca toca a branch nem a main.
 */
async function verifyOnMissionSource({ missionId, commit = null, commands = [], timeoutMs = 120000 } = {}) {
  const current = await getMissionSource(missionId);
  if (!current) throw sourceError('MISSION_NOT_FOUND', `mission ${missionId} não encontrada`);
  const target = commit || current.currentCommit;
  if (!target) throw sourceError('MISSION_SOURCE_NOT_MATERIALIZED', 'sem commit na fonte da missão para revalidar');

  const workspace = path.join(WORKSPACE_ROOT, `mission-verify-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });

  const addResult = await runGit(['worktree', 'add', '--detach', workspace, target]);
  if (!addResult.ok) {
    return { ok: false, code: 'MISSION_SOURCE_VERIFY_WORKSPACE_FAILED', error: addResult.stderr, commit: target, results: [] };
  }

  const results = [];
  try {
    for (const command of (Array.isArray(commands) ? commands : [])) {
      const cmd = String(command || '').trim();
      if (cmd === '') continue;
      try {
        const { stdout } = await execFileAsync('/bin/sh', ['-lc', cmd], {
          cwd: workspace, timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024,
        });
        results.push({ command: cmd, ok: true, output: String(stdout).slice(0, 4000) });
      } catch (err) {
        results.push({
          command: cmd, ok: false,
          output: String(err.stdout || '').slice(0, 4000),
          error: String(err.stderr || err.message || err).slice(0, 4000),
        });
      }
    }
  } finally {
    await runGit(['worktree', 'remove', '--force', workspace]);
    if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  return {
    ok: failed.length === 0,
    code: failed.length === 0 ? null : 'MISSION_SOURCE_VERIFY_FAILED',
    commit: target,
    results,
    failedCommands: failed.map((f) => f.command),
  };
}

/**
 * Candidate final da missão: o commit da fonte que a missão construiu.
 *
 * Este — e NÃO a main — é o artifact que a promoção deve considerar. A main segue intocada.
 */
async function exportMissionCandidate(missionId) {
  const current = await getMissionSource(missionId);
  if (!current) throw sourceError('MISSION_NOT_FOUND', `mission ${missionId} não encontrada`);
  const verdict = source.assessMissionCandidateExport({
    sourceState: current.state,
    currentCommit: current.currentCommit,
    baseCommit: current.baseCommit,
  });
  const integrations = await listIntegrations(missionId);
  const integrated = integrations.filter((row) => row.integration_result === 'INTEGRATED');
  return {
    missionId,
    exportable: verdict.exportable,
    code: verdict.code,
    reason: verdict.reason,
    integrationBranch: current.integrationBranch,
    baseCommit: current.baseCommit,
    currentCommit: current.currentCommit,
    sourceRef: current.sourceRef,
    sourceState: current.state,
    sourceFence: current.fence,
    integrationCount: integrated.length,
    integrations,
  };
}

/**
 * COLETA AS EVIDÊNCIAS REAIS E INTEGRA O CANDIDATE DE UMA TASK NA FONTE DA MISSÃO.
 *
 * Este é o ponto de acoplamento chamado pelo Router quando um candidate chega a PROMOTED. Ele lê as
 * evidências do BANCO (testes, reviews, regressão) em vez de aceitar a palavra de quem chama: a
 * pré-condição "review aprovado" só é satisfeita por um review APROVE registrado, e "regressão PASS"
 * por uma RegressionRun com status PASS. Um chamador não pode declarar que revisou.
 *
 * Task fora de missão (`mission_id` nulo) é um no-op explícito: o comportamento legado (promoção
 * para uma branch candidate própria, sem fonte de missão) permanece intacto.
 *
 * @returns {Promise<{applicable:boolean, integrated:boolean, result:string, code:string|null, reason:string}>}
 */
async function integrateTaskCandidate({
  taskId,
  attemptId = null,
  findingId = null,
  integrationType = 'TASK_CANDIDATE',
  candidateCommit,
  ownershipValid = false,
  candidateIntegrityOk = false,
  candidateGreen = true,
  tests = [],
  review = {},
  regression = {},
  evidence = {},
  actor = null,
} = {}) {
  const { getTask, listTestRuns, listReviews, listRegressionRuns } = require('../engineeringRouter/engineeringTaskService');
  const task = await getTask(taskId);
  if (!task) throw sourceError('TASK_NOT_FOUND', `task ${taskId} não encontrada`);

  if (!task.mission_id) {
    return {
      applicable: false, integrated: false, result: 'NOT_APPLICABLE', code: null,
      reason: 'task não pertence a uma Engineering Mission — nenhuma fonte de missão a integrar',
    };
  }

  const missionId = task.mission_id;

  // Evidências lidas do BANCO e escopadas à TENTATIVA (é a tentativa que produz review/regressão),
  // não declaradas pelo chamador. O chamador não pode afirmar que revisou: só um review APROVE
  // registrado satisfaz a pré-condição de review.
  if (!attemptId) {
    const integration = await integrateCandidate({
      missionId, taskId, findingId, candidateCommit, integrationType, actor,
      preconditions: { candidateGreen, ownershipValid, candidateIntegrityOk, hasTestRun: false, reviewVerdict: null, regressionStatus: null },
      tests, review, regression, evidence,
    });
    return { applicable: true, missionId, ...integration };
  }

  const testRuns = await listTestRuns(attemptId).catch(() => []);
  const reviews = await listReviews(attemptId).catch(() => []);
  const regressions = await listRegressionRuns(attemptId).catch(() => []);

  const lastReview = (reviews || [])[(reviews || []).length - 1] || null;
  const lastRegression = (regressions || [])[(regressions || []).length - 1] || null;

  // NOMES DE CAMPO SÃO CONTRATO. O veredito da regressão vive em `result` (coluna do
  // `EngineeringRegressionRun`), NÃO em `status` — ler o nome errado devolvia `undefined` e a
  // pré-condição era recusada como NO_REGRESSION mesmo com a regressão PASS registrada. Defeito
  // real medido em 2026-10-02: a integração automática nunca passava, e o sintoma visível era
  // "task não chegou a GREEN" — longe da causa. `status` fica como alias defensivo.
  const regressionVerdict = lastRegression
    ? (lastRegression.result || lastRegression.status || null)
    : null;

  const integration = await integrateCandidate({
    missionId,
    taskId,
    findingId,
    candidateCommit,
    integrationType,
    actor,
    preconditions: {
      candidateGreen,
      hasTestRun: (testRuns || []).length > 0,
      reviewVerdict: lastReview ? (lastReview.decision || lastReview.verdict || null) : null,
      regressionStatus: regressionVerdict,
      ownershipValid,
      candidateIntegrityOk,
    },
    tests: tests.length > 0 ? tests : (testRuns || []).map((r) => ({
      id: r.id, status: r.status, commands: r.commands, exitCode: r.exit_code,
    })),
    review: Object.keys(review).length > 0 ? review : (lastReview ? {
      id: lastReview.id, decision: lastReview.decision, reviewer: lastReview.reviewer,
    } : {}),
    regression: Object.keys(regression).length > 0 ? regression : (lastRegression ? {
      id: lastRegression.id, result: regressionVerdict, planTier: lastRegression.plan_tier,
    } : {}),
    evidence,
  });

  return { applicable: true, missionId, ...integration };
}

/**
 * ATUALIZA A TASK SEGUINTE PARA A FONTE JÁ AVANÇADA.
 *
 * Uma missão que gera uma SEGUNDA task (replacement, nova versão da spec) precisa que ela nasça do
 * commit corrente da fonte — senão o ciclo se repete: a task nova volta para trás e perde os patches
 * que a missão já integrou. Reapontar `source_commit` para o commit corrente é o que faz a herança
 * valer para TODA task da missão, não só a primeira.
 */
async function reanchorTaskToCurrentSource(taskId, { actor = null } = {}) {
  const { getTask, updateTaskFields } = require('../engineeringRouter/engineeringTaskService');
  const task = await getTask(taskId);
  if (!task) throw sourceError('TASK_NOT_FOUND', `task ${taskId} não encontrada`);
  if (!task.mission_id) return { reanchored: false, code: 'NOT_APPLICABLE', reason: 'task não pertence a uma missão' };

  const current = await getMissionSource(task.mission_id);
  if (!current || !current.currentCommit) {
    return { reanchored: false, code: 'MISSION_SOURCE_NOT_MATERIALIZED', reason: 'a missão não possui fonte materializada' };
  }
  if (task.source_commit === current.currentCommit) {
    return { reanchored: false, code: null, reason: 'a task já aponta para o commit corrente da fonte', commit: current.currentCommit };
  }

  await updateTaskFields(taskId, {
    source_commit: current.currentCommit,
    source_ref: current.integrationBranch,
    source_mission_fence: current.fence,
  });

  logger.info('[missionSource] task reancorada na fonte corrente da missão', {
    taskId, missionId: task.mission_id,
    from: String(task.source_commit || '').slice(0, 12), to: String(current.currentCommit).slice(0, 12), actor,
  });
  return { reanchored: true, code: null, commit: current.currentCommit, reason: 'task reapontada para o commit corrente da fonte da missão' };
}

module.exports = {
  ensureMissionSource,
  getMissionSource,
  resolveTaskSource,
  integrateCandidate,
  integrateTaskCandidate,
  reanchorTaskToCurrentSource,
  verifyOnMissionSource,
  exportMissionCandidate,
  listIntegrations,
  recordIntegration,
  // IntegrationIntent durável (fase de crash-safety da fonte da missão).
  // EXPORTADO PARA A PROVA DE CRASH — não é API pública de negócio. O E2E precisa matar um processo
  // EXATAMENTE entre o `git update-ref` e o CAS do banco, e essa é a única função que possui essa
  // janela. Sem este seam, o ponto mais crítico da autoridade de fonte era impossível de provar por
  // processo real (o failpoint existia documentado para um E2E que não conseguia alcançá-lo).
  advanceMissionSource,
  applySourceAdvanceCommit,
  prepareIntegrationIntent,
  prepareInitializationIntent,
  finishMissionSourceInitialization,
  transitionIntegrationIntent,
  reconcileMissionSourceIntents,
  reconcileInitializationIntent,
  readMainCommit,
  readCommitParent,
  branchExists,
  commitExists,
};
