#!/usr/bin/env node
'use strict';

/**
 * source-fingerprint-at-commit.js — fingerprint de CONTEÚDO PROVADO de um commit.
 *
 * MOTIVAÇÃO (defeito medido em 2026-11-04, ciclo do release r-agent2-20261104-000924).
 * `create-release-tag.sh` exigia que o commit tagueado fosse LITERALMENTE igual ao
 * `sourceCommit` gravado no run governado. Mas o ciclo canônico produz commits de
 * EVIDÊNCIA depois de criar o run:
 *
 *   create-governed-run (congela sourceCommit=S0)
 *     → converge (commita governance/*.json, reports/, qa/)
 *     → selo V2
 *     → zip:release (commita evidência)
 *
 * Esses commits NÃO tocam a superfície provada (SOURCE_ROOTS / FILTERED_SOURCE_ROOTS
 * de `governance/proof-engine/fingerprint-chain.js`), então o `sourceFingerprint`
 * permanece idêntico. Ainda assim a comparação por sha recusava a tag do PRÓPRIO
 * ciclo canônico — um gate que proíbe o caminho oficial está errado, não o caminho.
 *
 * O discriminador correto de "é o MESMO conteúdo que o run selou" é o fingerprint,
 * não o sha do commit: um GO de outro conteúdo tem fingerprint diferente (a
 * superfície provada inteira entra no hash). Este helper devolve esse valor usando
 * a MESMA função canônica — nunca uma segunda regra.
 *
 * Mecânica: extrai a árvore do commit para um diretório temporário
 * (`git archive | tar -x`, sem tocar no worktree corrente e sem `checkout`) e roda
 * `computeSourceFingerprint` sobre ela. Somente arquivos RASTREADOS entram, que é
 * exatamente a identidade do commit.
 *
 * Uso: node scripts/governance/source-fingerprint-at-commit.js <commit>
 * Saída: o sha256 do fingerprint em stdout (linha única). Exit != 0 em erro.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// A FUNÇÃO vem do pacote deste script; o REPOSITÓRIO é o do diretório corrente
// (permite operar sobre qualquer worktree/repo, inclusive fixtures de teste).
const SCRIPT_ROOT = path.resolve(__dirname, '..', '..');
const { computeSourceFingerprint } = require(path.join(SCRIPT_ROOT, 'governance', 'proof-engine', 'fingerprint-chain'));

function fail(message) {
  process.stderr.write(`[fingerprint-at-commit] ${message}\n`);
  process.exit(1);
}

function resolveRepoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (_) {
    return null;
  }
}

function main() {
  const REPO_ROOT = resolveRepoRoot();
  if (!REPO_ROOT) fail('diretório corrente não é um repositório git');
  const commit = String(process.argv[2] || '').trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) fail(`commit malformado (esperado sha 40-hex): '${commit}'`);

  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: REPO_ROOT, stdio: 'pipe' });
  } catch (_) {
    fail(`commit ${commit} não existe localmente`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `rap-fp-${commit.slice(0, 9)}-`));
  try {
    // `git archive` escreve o TAR do commit no stdout; `tar -x` descompacta no tmp.
    // Nenhum arquivo do worktree corrente é lido ou alterado.
    const tarPath = path.join(tmpDir, 'tree.tar');
    const out = fs.openSync(tarPath, 'w');
    try {
      execFileSync('git', ['archive', '--format=tar', commit], { cwd: REPO_ROOT, stdio: ['ignore', out, 'pipe'] });
    } finally {
      fs.closeSync(out);
    }
    execFileSync('tar', ['-xf', tarPath, '-C', tmpDir], { stdio: 'pipe' });
    fs.rmSync(tarPath, { force: true });

    const fingerprint = computeSourceFingerprint(tmpDir);
    if (!/^[0-9a-f]{64}$/.test(fingerprint)) fail(`fingerprint inválido produzido: ${fingerprint}`);
    process.stdout.write(`${fingerprint}\n`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
