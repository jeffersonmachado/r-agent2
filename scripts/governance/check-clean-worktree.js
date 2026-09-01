#!/usr/bin/env node
'use strict';

/**
 * check-clean-worktree.js — gate de proveniência reproduzível do release.
 *
 * RELEASE OFICIAL exige worktree limpo: `git status --porcelain` vazio no
 * INÍCIO do pipeline (antes de qualquer geração de artefato). Um release
 * empacotado sobre mudanças não commitadas não corresponde ao gitCommit
 * declarado no manifest (caso real: r-agent2-20260829-213044 registrou
 * 58b12b76 com o working tree sujo).
 *
 * O snapshot é feito uma única vez, no início: artefatos de governança
 * (governance/*.json, reports/*, qa-mesh/*) mudam DURANTE o two-pass e não
 * podem invalidar o gate — o que se exige é que o source empacotado seja
 * exatamente o commit declarado.
 *
 * NUNCA faz commit automático. Worktree sujo = NO_GO DIRTY_WORKTREE.
 *
 * Uso:
 *   node scripts/governance/check-clean-worktree.js [--root <dir>]
 * Exit 0: worktree limpo (imprime o snapshot de proveniência em JSON).
 * Exit 1: DIRTY_WORKTREE ou repositório git indisponível.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function runGit(rootDir, args) {
  // NÃO usar trim(): a primeira linha de `git status --porcelain` pode começar
  // com espaço (coluna de status "unstaged") — trim() destruiria o parsing.
  const stripTrailingNewlines = (value) => String(value || '').replace(/\r?\n+$/, '');
  try {
    return stripTrailingNewlines(execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
  } catch (err) {
    // Em alguns sandboxes, spawn pode lançar EPERM mesmo com status 0 e stdout válido.
    if (err && Number(err.status) === 0 && typeof err.stdout === 'string') {
      return stripTrailingNewlines(err.stdout);
    }
    const stderr = err && err.stderr ? String(err.stderr) : '';
    const wrapped = new Error(`git ${args.join(' ')} falhou em ${rootDir}: ${stderr || err.message}`);
    wrapped.code = 'GIT_COMMAND_FAILED';
    throw wrapped;
  }
}

/**
 * Captura a proveniência git do worktree.
 * @returns {{commit:string, tree:string, branch:string, porcelain:string}}
 */
function captureGitProvenance(rootDir) {
  if (!fs.existsSync(path.join(rootDir, '.git'))) {
    const err = new Error(`GIT_REPOSITORY_REQUIRED — .git ausente em ${rootDir}`);
    err.code = 'GIT_REPOSITORY_REQUIRED';
    throw err;
  }
  return {
    commit: runGit(rootDir, ['rev-parse', 'HEAD']),
    tree: runGit(rootDir, ['rev-parse', 'HEAD^{tree}']),
    branch: runGit(rootDir, ['rev-parse', '--abbrev-ref', 'HEAD']),
    porcelain: runGit(rootDir, ['status', '--porcelain']),
  };
}

function parsePorcelain(porcelain) {
  return String(porcelain || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({ status: line.slice(0, 2), path: line.slice(3) }));
}

/**
 * Verifica que o worktree está limpo. Retorna o resultado sem lançar.
 * @returns {{clean:boolean, code:string, changes:Array, provenance:Object}}
 */
function checkCleanWorktree(rootDir) {
  const provenance = captureGitProvenance(rootDir);
  const changes = parsePorcelain(provenance.porcelain);
  return {
    clean: changes.length === 0,
    code: changes.length === 0 ? 'CLEAN_WORKTREE' : 'DIRTY_WORKTREE',
    changes,
    provenance: {
      commit: provenance.commit,
      tree: provenance.tree,
      branch: provenance.branch,
    },
  };
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const rootDir = path.resolve(rootIdx !== -1 ? argv[rootIdx + 1] : process.cwd());

  let result;
  try {
    result = checkCleanWorktree(rootDir);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[clean-worktree] NO_GO ${err.code || 'GIT_ERROR'} — ${err.message}`);
    process.exit(1);
    return;
  }

  if (!result.clean) {
    // eslint-disable-next-line no-console
    console.error('[clean-worktree] NO_GO DIRTY_WORKTREE — release oficial exige worktree limpo.');
    // eslint-disable-next-line no-console
    console.error('[clean-worktree] Commit exigido ANTES do release (nunca commit automático). Pendências:');
    for (const change of result.changes.slice(0, 120)) {
      // eslint-disable-next-line no-console
      console.error(`  ${change.status} ${change.path}`);
    }
    if (result.changes.length > 120) {
      // eslint-disable-next-line no-console
      console.error(`  ... e mais ${result.changes.length - 120} caminho(s)`);
    }
    process.exit(1);
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`[clean-worktree] PASS CLEAN_WORKTREE commit=${result.provenance.commit} tree=${result.provenance.tree} branch=${result.provenance.branch}`);
  process.exit(0);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { checkCleanWorktree, captureGitProvenance, parsePorcelain, runGit };
