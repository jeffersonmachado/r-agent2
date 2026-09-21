'use strict';

/**
 * api/services/engineeringRouter/patchApplyService.js
 *
 * Aplicação controlada de patch: NUNCA aplica sobre o working tree principal. Cria um
 * `git worktree` isolado a partir de um snapshot do estado atual do repositório (staged +
 * unstaged + untracked, respeitando .gitignore — ver `createSnapshotCommit`), valida o patch
 * com `git apply --check` antes de aplicar de verdade, e remove o worktree ao final
 * (rollback/cleanup garantido mesmo em caminho de erro, via `finally` no chamador).
 */

const { execFile } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { ROOT } = require('./contextBuilderService');
const { FAILURE_CODES } = require('../../../engine/engineeringRouter/constants');
const { normalizeHunkHeaders } = require('../../../engine/engineeringRouter/hunkNormalizer');
const logger = require('../../utils/logger');

const execFileAsync = util.promisify(execFile);

const WORKSPACE_ROOT = process.env.ENGINEERING_ROUTER_WORKSPACE_ROOT
  || path.join(os.tmpdir(), 'engineering-router-workspaces');

async function runGit(args, { cwd } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: cwd || ROOT,
      maxBuffer: 20 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr };
  } catch (err) {
    return { ok: false, stdout: err.stdout || '', stderr: err.stderr || err.message || String(err) };
  }
}

/**
 * Cria um objeto de commit "snapshot" representando EXATAMENTE o estado atual do working tree
 * (staged + unstaged + arquivos novos ainda não commitados, respeitando .gitignore) — sem
 * mutar o HEAD, a branch, o índice ou o working tree reais. Necessário porque este projeto
 * roda em "branch main direto" (sprint de finalização), quase sempre com mudanças pendentes
 * não commitadas; um worktree criado a partir de `HEAD` não veria esse trabalho em andamento
 * nem os próprios arquivos do Task Contract se ainda não commitados.
 *
 * Técnica padrão do git (sem side effects): índice temporário via `GIT_INDEX_FILE`, `add -A`
 * nesse índice isolado, `write-tree` + `commit-tree` apontando HEAD como pai. O commit gerado
 * fica sem nenhuma referência (branch/tag) — nunca aparece em `git log`/`git status` — e é
 * apenas o ponto de partida do `git worktree add`.
 *
 * @returns {Promise<string>} hash do commit snapshot
 */
async function createSnapshotCommit() {
  const tmpIndex = path.join(os.tmpdir(), `engineering-router-index-${crypto.randomBytes(6).toString('hex')}`);
  const env = {
    ...process.env,
    GIT_INDEX_FILE: tmpIndex,
    GIT_AUTHOR_NAME: 'Engineering Model Router',
    GIT_AUTHOR_EMAIL: 'engineering-router@local',
    GIT_COMMITTER_NAME: 'Engineering Model Router',
    GIT_COMMITTER_EMAIL: 'engineering-router@local',
  };
  try {
    await execFileAsync('git', ['read-tree', 'HEAD'], { cwd: ROOT, env });
    await execFileAsync('git', ['add', '-A'], { cwd: ROOT, env, maxBuffer: 50 * 1024 * 1024 });
    const { stdout: treeHash } = await execFileAsync('git', ['write-tree'], { cwd: ROOT, env });
    const { stdout: commitHash } = await execFileAsync('git', ['commit-tree', treeHash.trim(), '-p', 'HEAD', '-m', 'engineering-router-snapshot (unreferenced)'], { cwd: ROOT, env });
    return commitHash.trim();
  } finally {
    try { fs.unlinkSync(tmpIndex); } catch (_) { /* best-effort */ }
  }
}

/**
 * Cria um workspace isolado (git worktree, detached em um snapshot do estado atual) para uma
 * tentativa.
 * @returns {Promise<string>} caminho absoluto do workspace
 */
async function createWorkspace(taskId, attemptNumber) {
  const dirName = `task-${taskId}-attempt-${attemptNumber}-${crypto.randomBytes(4).toString('hex')}`;
  const dir = path.join(WORKSPACE_ROOT, dirName);
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });

  let snapshotCommit;
  try {
    snapshotCommit = await createSnapshotCommit();
  } catch (err) {
    const wrapped = new Error(`Falha ao criar snapshot do working tree: ${err.message}`);
    wrapped.code = FAILURE_CODES.PATCH_APPLY_FAILED;
    throw wrapped;
  }

  const result = await runGit(['worktree', 'add', '--detach', dir, snapshotCommit], { cwd: ROOT });
  if (!result.ok) {
    const err = new Error(`Falha ao criar workspace isolado (git worktree add): ${result.stderr}`);
    err.code = FAILURE_CODES.PATCH_APPLY_FAILED;
    throw err;
  }

  // `git worktree` só materializa arquivos versionados — `node_modules` é gitignored e não
  // existe no novo diretório. Sem isso, nenhum comando de teste real (`npm test`, `npx jest`)
  // conseguiria rodar no workspace isolado. Link simbólico (não cópia: evita duplicar
  // centenas de MB por tentativa) para as dependências já instaladas no repositório principal.
  const rootNodeModules = path.join(ROOT, 'node_modules');
  const workspaceNodeModules = path.join(dir, 'node_modules');
  try {
    if (fs.existsSync(rootNodeModules) && !fs.existsSync(workspaceNodeModules)) {
      fs.symlinkSync(rootNodeModules, workspaceNodeModules, 'dir');
    }
  } catch (err) {
    logger.warn('[patchApplyService] falha ao linkar node_modules no workspace isolado', { dir, error: err.message });
  }

  return dir;
}

/**
 * Aplica um unified diff dentro de um workspace isolado. Valida com `--check` primeiro
 * (dry-run); só aplica de verdade se a checagem passar. Nunca aplica parcialmente.
 * @returns {Promise<{ok:boolean, code?:string, stderr?:string}>}
 */
async function applyPatch(workspacePath, diffText) {
  const patchFile = path.join(workspacePath, `.engineering-router-${Date.now()}.diff`);
  // Achado real do pilot V1: LLMs frequentemente acertam o CONTEÚDO do hunk mas erram a
  // CONTAGEM declarada no header (`@@ -a,b +c,d @@`) — `git apply` rejeita o patch inteiro
  // como "corrompido" mesmo quando o conteúdo é perfeitamente aplicável. Recalcular a
  // contagem a partir do corpo real do hunk antes de tentar aplicar é seguro (não toca uma
  // linha de conteúdo) e evita descartar patches semanticamente corretos por esse motivo.
  let normalized = diffText;
  try {
    normalized = normalizeHunkHeaders(diffText);
  } catch (_) {
    normalized = diffText; // normalização é best-effort; nunca bloqueia a tentativa de apply.
  }
  const content = normalized.endsWith('\n') ? normalized : `${normalized}\n`;
  fs.writeFileSync(patchFile, content, 'utf8');

  try {
    const check = await runGit(['apply', '--check', patchFile], { cwd: workspacePath });
    if (!check.ok) {
      return { ok: false, code: FAILURE_CODES.PATCH_APPLY_FAILED, stderr: check.stderr };
    }
    const apply = await runGit(['apply', patchFile], { cwd: workspacePath });
    if (!apply.ok) {
      return { ok: false, code: FAILURE_CODES.PATCH_APPLY_FAILED, stderr: apply.stderr };
    }
    return { ok: true };
  } finally {
    try { fs.unlinkSync(patchFile); } catch (_) { /* best-effort */ }
  }
}

/** Lista os caminhos realmente modificados no workspace (para telemetria/auditoria pós-apply). */
async function listChangedFiles(workspacePath) {
  const result = await runGit(['status', '--porcelain'], { cwd: workspacePath });
  if (!result.ok) return [];
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[A-Z?]{1,2}\s+/, ''));
}

/** Remove o worktree isolado. Nunca lança — é chamado em `finally`/cleanup. */
async function destroyWorkspace(workspacePath) {
  if (!workspacePath) return;
  const remove = await runGit(['worktree', 'remove', '--force', workspacePath], { cwd: ROOT });
  if (!remove.ok) {
    logger.warn('[patchApplyService] git worktree remove falhou, tentando limpeza manual', { workspacePath, stderr: remove.stderr });
    try { fs.rmSync(workspacePath, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  }
  await runGit(['worktree', 'prune'], { cwd: ROOT });
}

module.exports = {
  WORKSPACE_ROOT,
  createSnapshotCommit,
  createWorkspace,
  applyPatch,
  listChangedFiles,
  destroyWorkspace,
};
