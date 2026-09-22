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
const { materializeWorktree, destroyWorkspace, applyPatch } = require('./patchApplyService');
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
 * ER-V1-FINAL-002 — Exact Promotion.
 *
 * Achado real reproduzido (ver ENGINEERING_ROUTER_V1_FINAL_CLOSURE.md): `git add -A` no
 * workspace da TENTATIVA (onde CODER/TESTE/REVIEW/REGRESSION/GOVERNANCE já rodaram de verdade)
 * captura QUALQUER COISA fisicamente presente ali — inclusive arquivos gerados como
 * side-effect de um testCommand (cache, artefato, log, ou pior: qualquer escrita fora do diff
 * original). Reproduzido ao vivo: um arquivo `INJECTED_BY_TEST_SIDE_EFFECT.txt`, escrito no
 * workspace DEPOIS do patch aplicado (simulando o efeito colateral de rodar um teste), era
 * promovido silenciosamente junto com o patch real — `diff --stat` sozinho não pega isso
 * porque só prova "não está vazio", nunca "é EXATAMENTE o patch".
 *
 * Prova matemática real: aplica o MESMO diff validado sobre o MESMO baseline, mas num
 * workspace LIMPO e descartável (nunca tocado por CODER/TESTE/REVIEW — nasce e morre só para
 * este cálculo), produzindo `expectedTreeHash`. Compara com a árvore do workspace REAL onde os
 * testes de fato rodaram (`validatedTreeHash`) — só promove se forem BIT-A-BIT idênticas.
 * Isso prova ao mesmo tempo (1) que nada além do patch está no que será promovido e (2) que o
 * que será promovido é EXATAMENTE o que foi testado (não uma árvore "limpa" nunca exercitada).
 *
 * ER-V1-SEAL-001 (Immutable Promotion Baseline) — achado real, reproduzido ao vivo, que
 * substitui e corrige a abordagem anterior (ER-V1-FINAL-009): "MESMO baseline" (acima) precisa
 * ser o commit HEAD REAL e IMUTÁVEL do branch de trabalho (`patchApplyService.createWorkspace`
 * materializa o workspace diretamente dele), NUNCA um "snapshot" fabricado a partir do estado
 * mutável do ROOT compartilhado. A versão anterior deste sistema usava um snapshot que capturava
 * TUDO fisicamente presente no ROOT no instante da criação do workspace (staged + unstaged +
 * untracked, via `git add -A`) — inclusive trabalho em andamento não commitado do próprio branch
 * main direto, ou um arquivo temporário real de outro teste rodando em paralelo. Como o
 * "expected" também derivava desse MESMO snapshot, ambas as árvores concordavam em incluir a
 * contaminação, e a comparação `expectedTree == validatedTree` PASSAVA mesmo com um arquivo
 * estranho sendo promovido. Reproduzido ao vivo: um arquivo `dirty-local-a.txt` criado no ROOT
 * antes de `createWorkspace` aparecia commitado na branch candidata real junto com o patch
 * legítimo, com `promoted: true`. Corrigido na raiz (não só neste cálculo, mas na origem do
 * workspace): `expectedBaseCommit` agora é sempre o HEAD real do branch de trabalho — o mesmo
 * commit, já existente e imutável, de onde o workspace da tentativa foi materializado. Isso
 * continua provando exatamente o que side-effects de teste (ex.: `INJECTED_BY_TEST_SIDE_EFFECT.txt`
 * acontecendo DEPOIS da materialização) ainda divergem do "expected" recalculado a partir do
 * mesmo commit+patch — mas agora sem NUNCA herdar estado local não commitado em nenhum dos lados.
 *
 * @returns {Promise<{ok:boolean, expectedTreeHash?:string, code?:string, error?:string}>}
 */
async function computeExpectedTreeHash({ expectedBaseCommit, diff, taskId }) {
  let cleanWorkspace = null;
  try {
    cleanWorkspace = await materializeWorktree(expectedBaseCommit, `promotion-${taskId}-expected`);
  } catch (err) {
    return { ok: false, code: 'PROMOTION_EXPECTED_TREE_WORKSPACE_FAILED', error: err.message };
  }
  try {
    const applyResult = await applyPatch(cleanWorkspace, diff);
    if (!applyResult.ok) {
      return { ok: false, code: 'PROMOTION_EXPECTED_TREE_APPLY_FAILED', error: applyResult.stderr };
    }
    const addResult = await runGit(['add', '-A'], { cwd: cleanWorkspace });
    if (!addResult.ok) {
      return { ok: false, code: 'PROMOTION_EXPECTED_TREE_UNRESOLVABLE', error: addResult.stderr };
    }
    const treeResult = await runGit(['write-tree'], { cwd: cleanWorkspace });
    if (!treeResult.ok) {
      return { ok: false, code: 'PROMOTION_EXPECTED_TREE_UNRESOLVABLE', error: treeResult.stderr };
    }
    return { ok: true, expectedTreeHash: treeResult.stdout };
  } finally {
    await destroyWorkspace(cleanWorkspace);
  }
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

  // 1. Baseline real: ER-V1-SEAL-001 — o workspace foi materializado DIRETAMENTE do HEAD real
  //    (imutável) de quando esta tentativa começou (`patchApplyService.createWorkspace`, nunca
  //    mais um snapshot fabricado a partir do estado mutável do ROOT). O HEAD do workspace É o
  //    próprio `targetCommit` — sem indireção de "snapshot com pai real". Comparar com o HEAD
  //    real ATUAL do branch de trabalho prova se algo mudou em main enquanto a tentativa rodava
  //    — nunca promove sobre um alvo que já divergiu (TARGET_BASELINE_DIVERGED).
  const targetHeadResult = await runGit(['rev-parse', 'HEAD']);
  if (!targetHeadResult.ok) {
    return { promoted: false, code: 'PROMOTION_HEAD_UNRESOLVABLE', evidence: { promotionAttemptedAt, error: targetHeadResult.stderr, validatedPatchHash } };
  }
  const targetHead = targetHeadResult.stdout;

  const baselineHeadResult = await runGit(['rev-parse', 'HEAD'], { cwd: workspacePath });
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

  // 2.5. ER-V1-FINAL-002 — Exact Promotion: prova independente de que validatedTreeHash é
  //      EXATAMENTE "baseline + diff validado", nunca "baseline + diff + side-effect de teste".
  //      Ver computeExpectedTreeHash para o achado real reproduzido.
  const expectedTreeResult = await computeExpectedTreeHash({ expectedBaseCommit: baselineHead, diff, taskId });
  if (!expectedTreeResult.ok) {
    return {
      promoted: false,
      code: expectedTreeResult.code,
      evidence: { promotionAttemptedAt, error: expectedTreeResult.error, validatedPatchHash, validatedTreeHash },
    };
  }
  const { expectedTreeHash } = expectedTreeResult;

  // ER-V1-SEAL-001: changed paths do lado VALIDADO — camada de prova adicional e independente
  // do tree-hash (a spec exige comparar explicitamente os PATHS alterados, não só o hash da
  // árvore agregada), calculada ANTES de saber se expected==validated (para aparecer também no
  // evidence de PROMOTION_TREE_CONTAMINATED, útil no diagnóstico).
  const validatedChangedPathsResult = await runGit(['diff', '--name-only', baselineHead, validatedTreeHash]);
  const validatedChangedPaths = (validatedChangedPathsResult.stdout || '').split('\n').filter(Boolean).sort();

  if (expectedTreeHash !== validatedTreeHash) {
    // Diagnóstico preciso do que divergiu — nunca só "não bate": lista os arquivos exatos.
    const diffNameStatus = await runGit(['diff', '--name-status', expectedTreeHash, validatedTreeHash]);
    // ER-V1-FINAL-009: log real (não só no evidence persistido) — achado real ao investigar
    // flakiness sob paralelismo: PROMOTION_TREE_CONTAMINATED pode ser tanto um bloqueio de
    // segurança CORRETO (side-effect real de um testCommand vazando pro workspace) quanto um
    // efeito colateral do próprio Test Runner (ex.: cache do Jest/transform) — só os arquivos
    // exatos listados aqui provam qual dos dois é o caso real em cada ocorrência.
    logger.warn('[promotionService] PROMOTION_TREE_CONTAMINATED — expectedTreeHash != validatedTreeHash', {
      taskId,
      expectedTreeHash,
      candidateTreeHash: validatedTreeHash,
      contaminatingFiles: diffNameStatus.ok ? diffNameStatus.stdout : diffNameStatus.stderr,
    });
    return {
      promoted: false,
      code: 'PROMOTION_TREE_CONTAMINATED',
      evidence: {
        promotionAttemptedAt,
        validatedPatchHash,
        expectedTreeHash,
        candidateTreeHash: validatedTreeHash,
        validatedChangedPaths,
        contaminatingFiles: diffNameStatus.ok ? diffNameStatus.stdout : diffNameStatus.stderr,
      },
    };
  }

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

  // ER-V1-SEAL-001: prova adicional e independente do tree-hash — o CONJUNTO DE PATHS alterados
  // no candidato real precisa ser EXATAMENTE o mesmo conjunto já provado do lado validado. Como
  // `expectedTreeHash === validatedTreeHash === candidateTreeHash` (candidateTreeHash é
  // literalmente `validatedTreeHash`, ver commit-tree acima), esta comparação é logicamente
  // implicada, mas a spec exige a prova explícita por paths — nunca confiar só no hash agregado.
  const promotedChangedPathsResult = await runGit(['diff', '--name-only', targetHead, candidateCommit]);
  const promotedChangedPaths = (promotedChangedPathsResult.stdout || '').split('\n').filter(Boolean).sort();
  const changedPathsMatch = JSON.stringify(validatedChangedPaths) === JSON.stringify(promotedChangedPaths);
  if (!changedPathsMatch) {
    return {
      promoted: false,
      code: 'PROMOTION_CHANGED_PATHS_MISMATCH',
      evidence: { promotionAttemptedAt, validatedPatchHash, candidateCommit, validatedChangedPaths, promotedChangedPaths },
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
  let postPromotionTreeHash = null;
  try {
    smokeWorkspace = await materializeWorktree(candidateCommit, `promotion-${taskId}-smoke`);
    // ER-V1-SEAL-001: prova empírica adicional — a árvore do worktree recém-materializado a
    // partir do candidateCommit precisa bater bit-a-bit com a árvore já provada
    // (candidateTreeHash/validatedTreeHash). Nunca assume que "materializar de novo" reproduz o
    // mesmo conteúdo sem checar.
    const postPromotionTreeResult = await runGit(['rev-parse', 'HEAD^{tree}'], { cwd: smokeWorkspace });
    postPromotionTreeHash = postPromotionTreeResult.ok ? postPromotionTreeResult.stdout : null;
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

  if (postPromotionTreeHash !== null && postPromotionTreeHash !== validatedTreeHash) {
    return {
      promoted: false,
      code: 'POST_PROMOTION_TREE_MISMATCH',
      evidence: { promotionAttemptedAt, validatedPatchHash, candidateCommit, candidateTreeHash: validatedTreeHash, postPromotionTreeHash },
    };
  }

  // ER-V1-FINAL-002: fileSetHash — hash do conjunto exato de arquivos tocados (ordenado,
  // conteúdo-endereçado), calculado do diff real entre baseline e candidato (agora provado
  // idêntico ao expectedTreeHash) — qualquer arquivo adicionado/removido/renomeado fora do
  // patch validado muda este hash.
  const fileSetResult = await runGit(['diff', '--name-status', targetHead, candidateCommit]);
  const fileSetHash = sha256((fileSetResult.stdout || '').split('\n').filter(Boolean).sort().join('\n'));
  const baselineTreeResult = await runGit(['rev-parse', `${baselineHead}^{tree}`]);

  const createdAt = new Date().toISOString();
  const promotionEvidence = {
    // Campos exatos exigidos por ER-V1-SEAL-001 (Immutable Promotion Baseline):
    targetCommit: targetHead,
    targetTreeHash: baselineTreeResult.ok ? baselineTreeResult.stdout : null,
    validatedPatchHash,
    validatedChangedPaths,
    expectedTreeHash,
    validatedTreeHash,
    candidateTreeHash: validatedTreeHash,
    candidateCommit,
    promotedChangedPaths,
    postPromotionTreeHash,
    createdAt,
    // Campos herdados (ER-V1-FINAL-002/ERV1-CLOSE-005), mantidos para compatibilidade com
    // consumidores existentes (UI, testes, relatórios) — nunca removidos, só complementados.
    promotionAttemptedAt,
    promotedAt: createdAt,
    baselineTreeHash: baselineTreeResult.ok ? baselineTreeResult.stdout : null,
    promotedTreeHash: validatedTreeHash,
    fileSetHash,
    baselineHead,
    targetHead,
    candidateBranch: branchName,
    promotionStatus: 'PROMOTED',
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
