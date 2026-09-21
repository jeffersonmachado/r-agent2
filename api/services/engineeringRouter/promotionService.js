'use strict';

/**
 * api/services/engineeringRouter/promotionService.js
 *
 * ERV1-CLOSE-005: antes desta correção, GREEN não significava que a mudança validada chegava a
 * lugar nenhum além do workspace temporário — o `git worktree` da tentativa era sempre
 * destruído ao final. "Validado" e "existe no source" eram coisas diferentes, e nada
 * distinguia isso.
 *
 * Promotion V1: NUNCA `git push`, NUNCA publica release, NUNCA faz merge remoto automático, e
 * NUNCA toca `HEAD`/branch atual/working tree do repositório principal (mesma garantia que
 * `patchApplyService` já dá para aplicação de patch). Em vez disso, cria um COMMIT REAL (objeto
 * git) representando "baseline + patch exato validado" e aponta uma branch local dedicada
 * (`engineering-router/candidates/<taskId>`) para ele — inspecionável com `git log`/`git diff`
 * normalmente, sem nenhum efeito no branch de trabalho de ninguém. Integração ao branch
 * principal segue o fluxo oficial do time (fora do escopo do Router V1, documentado desde a
 * missão original).
 */

const { execFile } = require('child_process');
const util = require('util');
const crypto = require('crypto');
const { ROOT } = require('./contextBuilderService');
const { materializeWorktree, destroyWorkspace } = require('./patchApplyService');
const { runTestCommands } = require('./testRunnerService');
const logger = require('../../utils/logger');

const execFileAsync = util.promisify(execFile);
const CANDIDATE_BRANCH_PREFIX = 'engineering-router/candidates/';

function sha256(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

async function runGit(args, { cwd, env } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd: cwd || ROOT, env: env || process.env, maxBuffer: 20 * 1024 * 1024 });
    return { ok: true, stdout: stdout.trim(), stderr };
  } catch (err) {
    return { ok: false, stdout: (err.stdout || '').trim(), stderr: err.stderr || err.message || String(err) };
  }
}

function candidateBranchName(taskId) {
  return `${CANDIDATE_BRANCH_PREFIX}${taskId}`;
}

/**
 * Promove o patch EXATO validado de uma tentativa GREEN para o repositório real, como um commit
 * + branch local dedicada. Nunca lança — sempre retorna `{promoted, code, evidence}` para o
 * chamador decidir o que fazer (V1: reprovação de promoção não derruba a task para RED, ela já
 * passou por CODER/TESTE/REVIEW/REGRESSION/GOVERNANCE reais — fica registrada como
 * `READY_FOR_PROMOTION` com o motivo exato).
 *
 * @param {Object} params
 * @param {string} params.taskId
 * @param {string} params.attemptId
 * @param {number} params.attemptNumber
 * @param {string} params.workspacePath - workspace da tentativa GREEN, AINDA NÃO destruído,
 *   com o patch já aplicado (`patchApplyService.applyPatch` já rodou nele).
 * @param {string} params.diff - diff exato validado (o mesmo texto usado em `applyPatch`).
 * @param {string[]} params.testCommands - mesmos comandos já validados, para o smoke pós-promoção.
 * @param {string} params.taskTitle
 * @returns {Promise<{promoted:boolean, code?:string, evidence:Object}>}
 */
async function promoteValidatedPatch({ taskId, attemptId, attemptNumber, workspacePath, diff, testCommands, taskTitle }) {
  const validatedPatchHash = sha256(diff);
  const promotionAttemptedAt = new Date().toISOString();

  // 1. Baseline real: o workspace foi criado a partir de um snapshot cujo PAI é o HEAD real de
  //    quando esta tentativa começou. Comparar com o HEAD real ATUAL prova se algo mudou em
  //    main enquanto a tentativa rodava — nunca promove sobre um alvo que já divergiu.
  const targetHeadResult = await runGit(['rev-parse', 'HEAD']);
  if (!targetHeadResult.ok) {
    return { promoted: false, code: 'PROMOTION_HEAD_UNRESOLVABLE', evidence: { promotionAttemptedAt, error: targetHeadResult.stderr, validatedPatchHash } };
  }
  const targetHead = targetHeadResult.stdout;

  const baselineHeadResult = await runGit(['rev-parse', 'HEAD^'], { cwd: workspacePath });
  if (!baselineHeadResult.ok) {
    return { promoted: false, code: 'PROMOTION_BASELINE_UNRESOLVABLE', evidence: { promotionAttemptedAt, error: baselineHeadResult.stderr, validatedPatchHash } };
  }
  const baselineHead = baselineHeadResult.stdout;

  if (baselineHead !== targetHead) {
    return {
      promoted: false,
      code: 'PROMOTION_TARGET_DIVERGED',
      evidence: { promotionAttemptedAt, baselineHead, targetHead, validatedPatchHash },
    };
  }

  // 2. Tree do workspace COM o patch já aplicado = exatamente "baseline + patch validado".
  //    Achado real: `git apply` (patchApplyService.applyPatch) só toca o WORKING TREE, nunca o
  //    índice — `HEAD^{tree}` continua apontando para a árvore do commit-snapshot original
  //    (pré-patch). É preciso `add -A` (stage do que o apply mudou de verdade, respeitando
  //    .gitignore) + `write-tree` para obter o hash da árvore REALMENTE patcheada — mesma
  //    técnica de `createSnapshotCommit` em patchApplyService.js.
  const addResult = await runGit(['add', '-A'], { cwd: workspacePath });
  if (!addResult.ok) {
    return { promoted: false, code: 'PROMOTION_TREE_UNRESOLVABLE', evidence: { promotionAttemptedAt, error: addResult.stderr, validatedPatchHash } };
  }
  const treeResult = await runGit(['write-tree'], { cwd: workspacePath });
  if (!treeResult.ok) {
    return { promoted: false, code: 'PROMOTION_TREE_UNRESOLVABLE', evidence: { promotionAttemptedAt, error: treeResult.stderr, validatedPatchHash } };
  }
  const validatedTreeHash = treeResult.stdout;

  // 3. Commit real, NÃO referenciado ainda — não afeta HEAD/branch atual/working tree.
  const commitMessage = [
    `Engineering Router: ${taskTitle}`,
    '',
    `task=${taskId} attempt=${attemptNumber}`,
    `validatedPatchHash=${validatedPatchHash}`,
    `validatedTreeHash=${validatedTreeHash}`,
    'Patch real: CODER gerou, teste determinístico passou, review independente aprovou,',
    'regressão e governança reais passaram (ver EngineeringAttempt/EngineeringReview).',
  ].join('\n');

  const commitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Engineering Model Router',
    GIT_AUTHOR_EMAIL: 'engineering-router@local',
    GIT_COMMITTER_NAME: 'Engineering Model Router',
    GIT_COMMITTER_EMAIL: 'engineering-router@local',
  };
  const commitResult = await runGit(['commit-tree', validatedTreeHash, '-p', targetHead, '-m', commitMessage], { env: commitEnv });
  if (!commitResult.ok) {
    return { promoted: false, code: 'PROMOTION_COMMIT_FAILED', evidence: { promotionAttemptedAt, error: commitResult.stderr, validatedPatchHash } };
  }
  const candidateCommit = commitResult.stdout;

  // 4. Diff promovido == diff validado — verificação real (não assumida): o candidato precisa
  //    diferir do baseline exatamente pelos arquivos do patch, nunca vazio, nunca outra coisa.
  const diffStatResult = await runGit(['diff', '--stat', targetHead, candidateCommit]);
  if (!diffStatResult.ok || !diffStatResult.stdout.trim()) {
    return {
      promoted: false,
      code: 'PROMOTION_DIFF_MISMATCH',
      evidence: { promotionAttemptedAt, validatedPatchHash, candidateCommit, diffStatOutput: diffStatResult.stdout, diffStatError: diffStatResult.stderr },
    };
  }

  // 5. Branch local dedicada — único efeito visível fora de objetos soltos do git. Nunca push,
  //    nunca merge em main/branch atual.
  const branchName = candidateBranchName(taskId);
  const branchResult = await runGit(['branch', '-f', branchName, candidateCommit]);
  if (!branchResult.ok) {
    return { promoted: false, code: 'PROMOTION_BRANCH_FAILED', evidence: { promotionAttemptedAt, error: branchResult.stderr, validatedPatchHash, candidateCommit } };
  }

  // 6. Post-promotion smoke: worktree NOVO a partir do commit candidato (não do workspace da
  //    tentativa, que pode ter side effects de execução anterior) — prova empírica de que o
  //    que foi promovido produz o MESMO resultado real já validado.
  let smokeWorkspace = null;
  let postPromotionTestResult = null;
  try {
    smokeWorkspace = await materializeWorktree(candidateCommit, `promotion-${taskId}-smoke`);
    postPromotionTestResult = await runTestCommands({
      taskId: `${taskId}-post-promotion`,
      attemptNumber: attemptNumber,
      commands: testCommands,
      cwd: smokeWorkspace,
    });
  } catch (err) {
    logger.error('[promotionService] smoke pós-promoção falhou ao executar', { taskId, error: err.message });
    postPromotionTestResult = { allPass: false, results: [], error: err.message };
  } finally {
    if (smokeWorkspace) await destroyWorkspace(smokeWorkspace);
  }

  const promotionEvidence = {
    promotionAttemptedAt,
    promotedAt: new Date().toISOString(),
    validatedPatchHash,
    validatedTreeHash,
    baselineHead,
    targetHead,
    candidateCommit,
    candidateBranch: branchName,
    postPromotionTestPass: Boolean(postPromotionTestResult?.allPass),
    postPromotionResults: (postPromotionTestResult?.results || []).map((r) => ({ command: r.command, status: r.status, exitCode: r.exitCode })),
  };

  if (!postPromotionTestResult?.allPass) {
    return { promoted: false, code: 'POST_PROMOTION_VERIFY_FAILED', evidence: promotionEvidence };
  }

  return { promoted: true, evidence: promotionEvidence };
}

module.exports = {
  candidateBranchName,
  promoteValidatedPatch,
};
