'use strict';

/**
 * api/services/engineeringRouter/patchApplyService.js
 *
 * Aplicação controlada de patch: NUNCA aplica sobre o working tree principal. Cria um
 * `git worktree` isolado a partir do commit HEAD REAL e IMUTÁVEL do branch de trabalho (ver
 * `createWorkspace`), valida o patch com `git apply --check` antes de aplicar de verdade, e
 * remove o worktree ao final (rollback/cleanup garantido mesmo em caminho de erro, via `finally`
 * no chamador).
 *
 * ER-V1-SEAL-001 (Immutable Promotion Baseline) — achado real, reproduzido ao vivo: a versão
 * anterior deste módulo materializava o workspace a partir de um "commit snapshot" que capturava
 * TUDO fisicamente presente no ROOT compartilhado no instante da criação (staged + unstaged +
 * untracked, via `git add -A`) — inclusive qualquer alteração local NÃO relacionada à task
 * (trabalho em andamento do próprio branch main direto, ou um arquivo temporário real de outro
 * teste rodando em paralelo). Como o cálculo de "expected tree" (Exact Promotion,
 * `promotionService.js`) também derivava desse MESMO snapshot, ambas as árvores concordavam em
 * incluir a contaminação — a comparação `expectedTree == validatedTree` PASSAVA mesmo com um
 * arquivo estranho sendo promovido para a branch candidata real. Reproduzido ao vivo: um arquivo
 * `dirty-local-a.txt` criado no ROOT antes de `createWorkspace` aparecia commitado na branch
 * `engineering-router/candidates/<taskId>` junto com o patch legítimo, com `promoted: true`.
 *
 * Corrigido na raiz: o workspace agora é materializado diretamente do `git rev-parse HEAD` REAL
 * do branch de trabalho — um commit JÁ EXISTENTE, imutável, nunca um snapshot fabricado a partir
 * do estado mutável do ROOT. Isso também elimina por completo o TOCTOU de `git add -A` sobre o
 * ROOT compartilhado (ER-V1-FINAL-009): não há mais nenhum scan de diretório mutável ao criar um
 * workspace, só um `git rev-parse` (leitura pontual) + `git worktree add` a partir de um commit
 * já resolvido. O contexto de "trabalho em andamento não commitado" que a CODER precisa nunca
 * dependeu deste mecanismo — `contextBuilderService.js` já lê os arquivos reais diretamente do
 * ROOT via `fs`, independente de qualquer commit/worktree.
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
 * Materializa um `git worktree` isolado (detached) a partir de um commit real já existente.
 * Compartilhado por `createWorkspace` (snapshot do estado atual) e pela verificação
 * pós-promoção (ERV1-CLOSE-005, a partir de um commit candidato real já criado).
 *
 * ER-V1-FINAL-001: NÃO cria mais o symlink gravável de `node_modules` para o `node_modules`
 * real do repositório (achado real: um `testCommand` malicioso conseguia escrever/corromper
 * fisicamente o `node_modules` real através dele — ver ENGINEERING_ROUTER_V1_FINAL_CLOSURE.md).
 * `node_modules` para os testes reais agora é responsabilidade exclusiva do sandbox de
 * execução (`executionSandbox.js`), que monta o `node_modules` real como bind READ-ONLY dentro
 * do container — nunca gravável, nunca fora do sandbox.
 * @returns {Promise<string>} caminho absoluto do workspace
 */
async function materializeWorktree(commitHash, dirLabel) {
  const dirName = `${dirLabel}-${crypto.randomBytes(4).toString('hex')}`;
  const dir = path.join(WORKSPACE_ROOT, dirName);
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });

  const result = await runGit(['worktree', 'add', '--detach', dir, commitHash], { cwd: ROOT });
  if (!result.ok) {
    const err = new Error(`Falha ao criar workspace isolado (git worktree add): ${result.stderr}`);
    err.code = FAILURE_CODES.PATCH_APPLY_FAILED;
    throw err;
  }

  return dir;
}

/**
 * Cria um workspace isolado (git worktree, detached no commit HEAD REAL e imutável do branch de
 * trabalho) para uma tentativa. ER-V1-SEAL-001: nunca um snapshot fabricado a partir do estado
 * mutável do ROOT — sempre um commit já existente, resolvido por `git rev-parse HEAD` (leitura
 * pontual, sem scan de diretório, sem TOCTOU possível).
 * @returns {Promise<string>} caminho absoluto do workspace
 */
async function createWorkspace(taskId, attemptNumber) {
  const headResult = await runGit(['rev-parse', 'HEAD']);
  if (!headResult.ok) {
    const err = new Error(`Falha ao resolver HEAD real do branch de trabalho: ${headResult.stderr}`);
    err.code = FAILURE_CODES.PATCH_APPLY_FAILED;
    throw err;
  }

  return materializeWorktree(headResult.stdout.trim(), `task-${taskId}-attempt-${attemptNumber}`);
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
    .map((line) => line.replace(/^[A-Z?]{1,2}\s+/, ''))
    // Achado real ao validar o feed de atividade ao vivo: `node_modules` é o SYMLINK de
    // infraestrutura criado por createWorkspace (não faz parte do patch). Um `.gitignore` com
    // `node_modules/` (barra final) não casa com um symlink de mesmo nome — só com um diretório
    // real — então `git status --porcelain` o lista como untracked mesmo estando ignorado para
    // conteúdo real. Nunca é uma mudança do CODER: sempre excluído aqui.
    .filter((entry) => entry !== 'node_modules' && !entry.startsWith('node_modules/'));
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

// ERV1-CLOSE-009: se o PROCESSO morre (não uma exceção JS) no meio de uma tentativa, o `finally`
// que chamaria `destroyWorkspace` nunca roda — o workspace isolado (e o registro de worktree do
// git) fica órfão em disco para sempre. `pruneOrphanedWorkspaces` varre os worktrees reais
// registrados sob `WORKSPACE_ROOT` (nunca o worktree principal do repositório) e remove os mais
// velhos que `olderThanMs`, reaproveitando `destroyWorkspace`. Chamado no boot do servidor
// (`api/server.js`) e disponível para uma varredura periódica futura, se necessário.
const DEFAULT_ORPHAN_WORKSPACE_MAX_AGE_MS = Number(process.env.ENGINEERING_ROUTER_ORPHAN_WORKSPACE_MAX_AGE_MS || 60 * 60 * 1000);

async function pruneOrphanedWorkspaces({ olderThanMs = DEFAULT_ORPHAN_WORKSPACE_MAX_AGE_MS } = {}) {
  const listResult = await runGit(['worktree', 'list', '--porcelain'], { cwd: ROOT });
  if (!listResult.ok) {
    logger.warn('[patchApplyService] falha ao listar worktrees para pruning', { stderr: listResult.stderr });
    return { pruned: [] };
  }

  const worktreePaths = listResult.stdout
    .split('\n\n')
    .map((block) => {
      const line = block.split('\n').find((l) => l.startsWith('worktree '));
      return line ? line.slice('worktree '.length).trim() : null;
    })
    .filter(Boolean);

  const normalizedRoot = path.resolve(WORKSPACE_ROOT);
  const now = Date.now();
  const pruned = [];

  for (const worktreePath of worktreePaths) {
    // Nunca mexe no worktree principal do repositório — só nos isolados sob WORKSPACE_ROOT.
    if (!path.resolve(worktreePath).startsWith(normalizedRoot)) continue;

    let mtimeMs;
    try {
      mtimeMs = fs.statSync(worktreePath).mtimeMs;
    } catch (_) {
      // Diretório já não existe no disco, mas o git ainda tem o registro — worktree prune puro
      // resolve isso.
      await runGit(['worktree', 'prune'], { cwd: ROOT });
      continue;
    }

    if (now - mtimeMs < olderThanMs) continue; // recente o bastante para ainda estar em uso.

    await destroyWorkspace(worktreePath);
    pruned.push(worktreePath);
  }

  if (pruned.length > 0) {
    logger.info('[patchApplyService] workspaces órfãos removidos no boot/varredura', { count: pruned.length, pruned });
  }

  return { pruned };
}

module.exports = {
  WORKSPACE_ROOT,
  createWorkspace,
  materializeWorktree,
  applyPatch,
  listChangedFiles,
  destroyWorkspace,
  pruneOrphanedWorkspaces,
};
