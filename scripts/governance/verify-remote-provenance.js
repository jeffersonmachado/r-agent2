#!/usr/bin/env node
'use strict';

/**
 * verify-remote-provenance.js — gate de proveniência REMOTA do release.
 *
 * A proveniência git do release era apenas LOCAL (commit/tree capturados do
 * worktree e declarados no manifest). Este gate comprova, ANTES do SEAL_GO,
 * que a fonte empacotada é reproduzível a partir do remote:
 *
 *   a. commit: existe no remote — é o tip de algum branch remoto OU ancestro
 *      do tip (após `git fetch`). Ausente → NO_GO RELEASE_SOURCE_COMMIT_NOT_REMOTE.
 *   b. tree: `git rev-parse <commit>^{tree}` == tree esperada → senão NO_GO
 *      RELEASE_SOURCE_TREE_MISMATCH.
 *   c. tag (com --tag e/ou --require-tag): a tag deve existir no remote e o
 *      target (desreferenciando tag anotada via refs/tags/<tag>^{}) deve ser
 *      exatamente o commit → inexistente: NO_GO RELEASE_TAG_MISSING; target
 *      divergente: NO_GO RELEASE_TAG_CONFLICT. Sem --tag/--require-tag, os
 *      campos de tag ficam null e não reprovam (modo pré-tag).
 *   d. remote inalcançável (ls-remote/fetch falham) → NO_GO REMOTE_UNREACHABLE
 *      (fail-closed: release oficial nunca prossegue sem verificar o remote).
 *
 * O relatório NUNCA carrega credenciais: a URL do remote é sanitizada
 * (strip de userinfo, ex.: https://user:token@github.com/... → https://github.com/...).
 *
 * Relatório: reports/source-remote-provenance-report.json (compat) + cópia
 * canônica em governance/source-remote-provenance-report.json (entra no
 * PAYLOAD do release: evidence-manifest packageRequired=true → o verifier
 * offline exige a prova vinculada por hash ao pacote, no gate
 * manifest_provenance — sem consulta externa).
 *
 * Uso:
 *   node scripts/governance/verify-remote-provenance.js [--commit <sha>] [--tree <sha>]
 *     [--remote <name>] [--tag <tag>] [--manifest <path>] [--require-tag] [--out <path>]
 * Exit 0 = PASS; Exit 1 = FAIL.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { withLineage } = require('../../governance/report-lineage');

const ROOT_DIR = path.join(__dirname, '..', '..');
const ARTIFACT_TYPE = 'source-remote-provenance-report';
const DEFAULT_REPORT_PATHS = [
  path.join(ROOT_DIR, 'reports', 'source-remote-provenance-report.json'),
  // Cópia canônica para o payload: governance/ entra no ZIP do release e o
  // evidence-manifest marca esta prova como packageRequired=true.
  path.join(ROOT_DIR, 'governance', 'source-remote-provenance-report.json'),
];

function execGit(args, cwd) {
  const stripTrailingNewlines = (value) => String(value || '').replace(/\r?\n+$/, '');
  try {
    return stripTrailingNewlines(execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
  } catch (err) {
    if (err && Number(err.status) === 0 && typeof err.stdout === 'string') {
      return stripTrailingNewlines(err.stdout);
    }
    const wrapped = new Error(`git ${args.join(' ')} falhou: ${(err && err.stderr) || err.message}`);
    wrapped.code = 'GIT_COMMAND_FAILED';
    throw wrapped;
  }
}

/**
 * Remove credenciais embutidas da URL do remote (userinfo nunca vai ao relatório).
 */
function sanitizeRemoteUrl(url) {
  const value = String(url || '').trim();
  if (!value) return value;
  // Sintaxe scp-like (git@host:org/repo.git): sem userinfo sensível além do user.
  if (!value.includes('://')) return value;
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString().replace(/\/$/, '');
  } catch (_) {
    return value.replace(/^([^:/]+:\/\/)[^@/]*@/, '$1');
  }
}

/**
 * Parseia a saída de `git ls-remote <remote>` em Map(refname → sha).
 */
function parseLsRemote(output) {
  const refs = new Map();
  for (const line of String(output || '').split('\n')) {
    const match = line.match(/^([0-9a-f]{40})\t(.+)$/);
    if (match) refs.set(match[2], match[1]);
  }
  return refs;
}

/**
 * Verifica a proveniência remota. Função testável: recebe um gitRunner injetável
 * (args) => stdout (lança em falha), com o mesmo contrato de execGit.
 *
 * @param {object} options { rootDir, commit, tree, remote, tag, requireTag, manifestPath }
 * @param {function} [gitRunner]
 * @returns {object} resultado (sem campos de lineage/generatedAt).
 */
function verifyRemoteProvenance(options = {}, gitRunner) {
  const rootDir = options.rootDir || ROOT_DIR;
  const run = gitRunner || ((args) => execGit(args, rootDir));
  const remoteName = options.remote || 'origin';

  // ── Entradas: flags > manifest > git local ────────────────────────────────
  let commit = options.commit || null;
  let tree = options.tree || null;
  if (options.manifestPath) {
    try {
      const manifest = JSON.parse(fs.readFileSync(options.manifestPath, 'utf8'));
      commit = commit || manifest.git_commit || manifest.gitCommit || null;
      tree = tree || manifest.git_tree || manifest.gitTree || null;
    } catch (error) {
      return finish({
        remote: null, remoteName, commit, commitExists: false, tree, treeMatches: false,
        tag: options.tag || null, tagMatches: null, status: 'FAIL', failureCode: null,
      }, 'MANIFEST_UNREADABLE', `manifest ilegível: ${error.message}`);
    }
  }
  if (!commit) commit = run(['rev-parse', 'HEAD']);
  if (!tree) tree = run(['rev-parse', 'HEAD^{tree}']);

  const result = {
    remote: null,
    remoteName,
    commit,
    commitExists: false,
    tree,
    treeMatches: false,
    tag: options.tag || null,
    tagMatches: null,
    status: 'FAIL',
    failureCode: null,
  };

  function failWith(code, detail) {
    return finish(result, code, detail);
  }

  try {
    result.remote = sanitizeRemoteUrl(run(['remote', 'get-url', remoteName]));
  } catch (_) {
    result.remote = null;
  }

  // ── a/b. ls-remote + fetch (fail-closed se a rede/remote falhar) ──────────
  let refs;
  try {
    refs = parseLsRemote(run(['ls-remote', remoteName]));
  } catch (error) {
    return failWith('REMOTE_UNREACHABLE', `git ls-remote ${remoteName} falhou — ${error.message}`);
  }
  try {
    run(['fetch', remoteName, '--quiet']);
  } catch (error) {
    return failWith('REMOTE_UNREACHABLE', `git fetch ${remoteName} falhou — ${error.message}`);
  }

  // commit existe no remote: tip de algum ref OU ancestro do tip de algum branch.
  const branchTips = [...refs.entries()]
    .filter(([name]) => name.startsWith('refs/heads/'))
    .map(([, sha]) => sha);
  if ([...refs.values()].includes(commit)) {
    result.commitExists = true;
  } else {
    for (const tip of branchTips) {
      try {
        run(['merge-base', '--is-ancestor', commit, tip]);
        result.commitExists = true;
        break;
      } catch (_) {
        // exit 1 = não é ancestro; exit 128 = objeto ausente — ambos: seguir.
      }
    }
  }
  if (!result.commitExists) {
    return failWith('RELEASE_SOURCE_COMMIT_NOT_REMOTE',
      `commit ${commit} não é tip nem ancestro de nenhum branch remoto em ${remoteName} — push antes do release`);
  }

  // tree do commit (objetos já locais após o fetch) == tree esperada.
  let actualTree = null;
  try {
    actualTree = run(['rev-parse', `${commit}^{tree}`]);
  } catch (error) {
    return failWith('RELEASE_SOURCE_TREE_MISMATCH', `tree do commit indisponível: ${error.message}`);
  }
  result.treeMatches = actualTree === tree;
  if (!result.treeMatches) {
    return failWith('RELEASE_SOURCE_TREE_MISMATCH',
      `tree remota=${actualTree} != esperada=${tree}`);
  }

  // ── c. tag de release (somente quando --tag/--require-tag) ────────────────
  const tagName = options.tag || null;
  if (options.requireTag && !tagName) {
    return failWith('RELEASE_TAG_MISSING', '--require-tag exige --tag <tag> para verificação');
  }
  if (tagName) {
    const tagTarget = refs.get(`refs/tags/${tagName}^{}`) || refs.get(`refs/tags/${tagName}`) || null;
    if (!tagTarget) {
      return failWith('RELEASE_TAG_MISSING',
        `tag ${tagName} inexistente no remote ${remoteName} — rode scripts/create-release-tag.sh`);
    }
    result.tagMatches = tagTarget === commit;
    if (!result.tagMatches) {
      return failWith('RELEASE_TAG_CONFLICT',
        `tag ${tagName} aponta para ${tagTarget} != commit do release ${commit}`);
    }
  }

  result.status = 'PASS';
  return result;
}

function finish(result, failureCode, detail) {
  return {
    ...result,
    status: 'FAIL',
    failureCode,
    ...(detail ? { detail } : {}),
  };
}

function buildReport(result) {
  // Lineage na origem (ver governance/report-lineage.js): o relatório nasce
  // com runId/sourceFingerprint do run governado atual.
  return withLineage({
    artifactType: ARTIFACT_TYPE,
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    ...result,
  }, ARTIFACT_TYPE, { includeGit: true });
}

function writeReports(report, paths) {
  for (const reportPath of paths) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--commit') { options.commit = argv[index + 1]; index += 1; }
    else if (arg === '--tree') { options.tree = argv[index + 1]; index += 1; }
    else if (arg === '--remote') { options.remote = argv[index + 1]; index += 1; }
    else if (arg === '--tag') { options.tag = argv[index + 1]; index += 1; }
    else if (arg === '--manifest') { options.manifestPath = argv[index + 1]; index += 1; }
    else if (arg === '--out') { options.out = argv[index + 1]; index += 1; }
    else if (arg === '--require-tag') { options.requireTag = true; }
  }
  return options;
}

function main(argv) {
  const options = parseCliArgs(argv);
  let result;
  try {
    result = verifyRemoteProvenance(options);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[remote-provenance] NO_GO GIT_ERROR — ${error.message}`);
    process.exit(1);
    return;
  }
  const report = buildReport(result);
  const paths = options.out ? [path.resolve(options.out)] : DEFAULT_REPORT_PATHS;
  writeReports(report, paths);

  const summary = `status=${report.status} remote=${report.remote || report.remoteName} commit=${report.commit}`
    + ` commitExists=${report.commitExists} treeMatches=${report.treeMatches}`
    + ` tag=${report.tag || 'null'} tagMatches=${report.tagMatches}`;
  // eslint-disable-next-line no-console
  console.log(`[remote-provenance] ${summary}`);
  if (report.status !== 'PASS') {
    // eslint-disable-next-line no-console
    console.error(`[remote-provenance] NO_GO ${report.failureCode}${report.detail ? ` — ${report.detail}` : ''}`);
  }
  for (const reportPath of paths) {
    // eslint-disable-next-line no-console
    console.log(`[remote-provenance] relatório: ${path.relative(ROOT_DIR, reportPath)}`);
  }
  process.exit(report.status === 'PASS' ? 0 : 1);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  ARTIFACT_TYPE,
  DEFAULT_REPORT_PATHS,
  execGit,
  sanitizeRemoteUrl,
  parseLsRemote,
  verifyRemoteProvenance,
  buildReport,
  writeReports,
};
