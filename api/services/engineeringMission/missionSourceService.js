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

/** Commit atual da `main` — a medida que prova que a missão não tocou a linha principal. */
async function readMainCommit(ref = 'main') {
  const result = await runGit(['rev-parse', '--verify', `${ref}^{commit}`]);
  if (!result.ok) return null;
  return result.stdout;
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
 * Materializa (ou reaproveita) a fonte isolada de uma missão.
 *
 * Idempotente por natureza: se a branch já existe, o commit dela é ADOTADO como commit corrente —
 * a missão pode ser retomada depois de um restart sem perder o que já integrou e sem criar uma
 * segunda branch. A `mission_base_commit` (M0) é gravada UMA vez e nunca muda: é a prova de qual era
 * a main quando a missão começou.
 */
async function ensureMissionSource(missionId, { actor = null, sourceRef = null } = {}) {
  if (!missionId) throw sourceError('MISSION_SOURCE_ID_REQUIRED', 'missionId é obrigatório');

  const branch = source.buildIntegrationBranchName(missionId);
  const { EngineeringMission } = models();
  const Mission = EngineeringMission();
  const mission = await Mission.findByPk(missionId);
  if (!mission) throw sourceError('MISSION_NOT_FOUND', `mission ${missionId} não encontrada`);

  const existingBranchCommit = await branchExists(branch);
  if (existingBranchCommit) {
    // A fonte já existe: adota o commit DELA. Nunca re-deriva da main — isso descartaria as
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

  const origin = sourceRef || mission.mission_source_ref || mission.branch || 'main';
  if (source.isForbiddenSourceRef(origin) === false && source.isMissionBranch(origin)) {
    throw sourceError('MISSION_SOURCE_REF_INVALID', `ref de origem "${origin}" é uma branch de missão — a origem deve ser a linha principal`);
  }

  const baseCommit = await branchExists(origin) || await readMainCommit(origin);
  if (!baseCommit) {
    throw sourceError('MISSION_SOURCE_ORIGIN_UNRESOLVABLE', `não foi possível resolver o commit de origem "${origin}"`);
  }

  const createResult = await runGit(['branch', branch, baseCommit]);
  if (!createResult.ok) {
    throw sourceError('MISSION_SOURCE_BRANCH_CREATE_FAILED', `falha ao criar a fonte da missão ${branch}: ${createResult.stderr}`);
  }

  await mission.update({
    mission_source_ref: origin,
    mission_base_commit: baseCommit,
    mission_integration_branch: branch,
    mission_current_commit: baseCommit,
    mission_source_state: 'READY',
    mission_workspace_id: mission.mission_workspace_id || `mission-ws-${String(missionId).slice(0, 8)}`,
  });

  logger.info('[missionSource] fonte da missão materializada', {
    missionId, branch, sourceRef: origin, baseCommit: baseCommit.slice(0, 12), actor,
  });

  return getMissionSource(missionId);
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
    const row = await Integration.create({
      mission_id: entry.missionId,
      task_id: entry.taskId || null,
      finding_id: entry.findingId || null,
      integration_type: entry.integrationType,
      integration_result: entry.integrationResult,
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
async function advanceMissionSource({ missionId, expectedCommit, newCommit, expectedFence, branch }) {
  const refResult = await runGit(['update-ref', `refs/heads/${branch}`, newCommit, expectedCommit]);
  if (!refResult.ok) {
    return {
      advanced: false,
      code: 'CONCURRENT_MISSION_SOURCE_UPDATE',
      reason: `update-ref atômico recusado: a fonte ${branch} não está mais em ${String(expectedCommit).slice(0, 12)}`,
      stderr: refResult.stderr,
    };
  }

  const { EngineeringMission } = models();
  const Mission = EngineeringMission();
  const { Op } = require('sequelize');

  const where = { id: missionId, mission_current_commit: expectedCommit };
  if (expectedFence !== null && expectedFence !== undefined) {
    where.mission_source_fence = expectedFence;
  }

  const [updated] = await Mission.update(
    {
      mission_current_commit: newCommit,
      mission_source_fence: Number(expectedFence || 0) + 1,
      mission_source_state: 'READY',
    },
    { where: { ...where, [Op.and]: [] } },
  );

  if (updated !== 1) {
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

  return { advanced: true, code: null };
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
        const { EngineeringMission } = models();
        const Mission = EngineeringMission();
        await Mission.update({ mission_current_commit: recordedAfter, mission_source_state: 'READY' }, { where: { id: missionIdValue } });
        logger.warn('[missionSource] reconciliação pós-crash: commit corrente alinhado com a branch', {
          missionIdValue, commit: String(recordedAfter).slice(0, 12),
        });
        return {
          integrated: true, reconciled: true, result: 'ALREADY_INTEGRATED', code: null,
          integrationKey, missionCommitAfter: recordedAfter,
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

  // ---- 5. AVANÇO CAS ----------------------------------------------------------------------
  const advance = await advanceMissionSource({
    missionId: missionIdValue,
    expectedCommit: current.currentCommit,
    newCommit: candidateCommit,
    expectedFence: expectedFence === null ? current.fence : expectedFence,
    branch: current.integrationBranch,
  });

  if (!advance.advanced) {
    // O git recusou o avanço: a fonte mudou de posição. NÃO aplicar cegamente — recusa explícita.
    // O candidato é revalidável: com o novo commit corrente, o pai do candidate deixa de bater.
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
    tests, review, regression, evidence,
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
  readMainCommit,
  readCommitParent,
  branchExists,
  commitExists,
};
