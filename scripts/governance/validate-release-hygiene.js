#!/usr/bin/env node
'use strict';

/**
 * validate-release-hygiene.js — gate de higiene do release físico final.
 *
 * Inspeciona o envelope/payload REAIS em dist/release/ e falha (exit 1) se
 * encontrar:
 *   - STALE_VERIFIER_RESULT: verify-result.json empacotado no envelope (o
 *     recibo é escrito pelo verifier QUANDO executado — nunca pré-empacotado)
 *     ou presente em dist/verifier/ sem vínculo com o payload atual;
 *   - FOREIGN_RELEASE_ARTIFACT: entradas pertencentes a outro releaseId;
 *   - FOREIGN_RUN_ARTIFACT: JSONs de dist/governance/ com runId ou
 *     sourceFingerprint divergentes do run canônico (.current-run.json);
 *   - TEMP_PATH_ARTIFACT / RUNTIME_ARTIFACT: paths temporários, logs ou
 *     arquivos de runtime empacotados;
 *   - STALE_CANDIDATE_MARKER: CANDIDATE-DEFERRED.json dentro de release GO.
 *
 * Também inspeciona a RAIZ de dist/: o canal governado entrega envelope,
 * payload e manifest em dist/release/ — qualquer `r-agent2-*.zip` ou
 * `r-agent2-*.manifest.json` solto na raiz de dist/ é artefato estrangeiro
 * (ex.: snapshot ad-hoc de `npm run zip`), pode ser confundido com o release
 * oficial por ferramentas que fazem `ls -t dist/*.zip | head -1` e viola a
 * regra de dist/ limpo (FOREIGN_RELEASE_ARTIFACT).
 *
 * Saída: reports/release-hygiene-report.json + resumo no stdout.
 * Sem envelope em dist/release/ (ambiente sem release gerado): PASS/SKIP —
 * o gate bloqueante roda no pipeline oficial (two-pass-release) e no
 * verify-payload-governance (gate release_hygiene) contra o artefato entregue.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

function readJson(absPath) {
  try { return JSON.parse(fs.readFileSync(absPath, 'utf8')); } catch (_) { return null; }
}

function listZipEntries(zipPath) {
  // maxBuffer: o pacote real traz dezenas de milhares de entradas e `unzip -Z1`
  // devolve a lista completa; o default de 1 MiB do execFileSync estoura com
  // `ENOBUFS`, reprovando por erro de LEITOR (medido no release de 2026-10-01).
  const output = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  return output.split(/\r?\n/g).map((e) => e.trim()).filter(Boolean);
}

function run(options = {}) {
  const rootDir = options.rootDir || ROOT;
  const DIST_ROOT = path.join(rootDir, 'dist');
  const DIST_RELEASE = path.join(DIST_ROOT, 'release');
  const DIST_GOVERNANCE = path.join(DIST_ROOT, 'governance');
  const DIST_VERIFIER = path.join(DIST_ROOT, 'verifier');
  const CURRENT_RUN_PATH = path.join(rootDir, 'governance', '.current-run.json');
  const reportPath = options.reportPath || path.join(rootDir, 'reports', 'release-hygiene-report.json');

  const issues = [];
  const details = {
    envelope: null,
    envelopeEntries: 0,
    payload: null,
    staleVerifierResult: 0,
    foreignRunArtifacts: 0,
    foreignReleaseArtifacts: 0,
    temporaryArtifacts: 0,
  };

  if (!fs.existsSync(DIST_RELEASE)) {
    return finish({ rootDir, reportPath }, 'SKIP', issues, details, 'dist/release/ ausente — sem release físico para inspecionar');
  }

  // ── 0. dist/ raiz: nenhum zip/manifest nomeado como release ──────────────
  // Envelope, payload e manifest governados vivem em dist/release/. Um
  // r-agent2-*.zip solto na raiz de dist/ (ex.: snapshot ad-hoc de
  // `npm run zip`) é artefato estrangeiro: tem nome de release, não passou
  // pelo pipeline two-pass e pode ser confundido com o release oficial.
  for (const f of fs.readdirSync(DIST_ROOT)) {
    if (/^r-agent2-\d{8}-\d{6}(\.payload)?\.zip$/.test(f) || /^r-agent2-\d{8}-\d{6}\.manifest\.json$/.test(f)) {
      details.foreignReleaseArtifacts += 1;
      issues.push({
        rule: 'FOREIGN_RELEASE_ARTIFACT',
        path: `dist/${f}`,
        detail: 'artefato fora do canal governado (dist/release/) — remova ou mova para fora de dist/',
      });
    }
  }

  const zips = fs.readdirSync(DIST_RELEASE).filter((f) => f.endsWith('.zip')).sort().reverse();
  const payloadName = zips.find((f) => f.endsWith('.payload.zip')) || null;
  const envelopeName = zips.find((f) => !f.endsWith('.payload.zip')) || null;
  if (!payloadName || !envelopeName) {
    return finish({ rootDir, reportPath }, 'SKIP', issues, details, 'payload/envelope não encontrados em dist/release/');
  }
  details.payload = payloadName;
  details.envelope = envelopeName;
  const currentReleaseId = payloadName.replace(/\.payload\.zip$/, '');

  // ── 1. Envelope: sem verify-result, sem artefato estrangeiro, sem runtime ──
  let entries = [];
  try {
    entries = listZipEntries(path.join(DIST_RELEASE, envelopeName));
    details.envelopeEntries = entries.length;
  } catch (error) {
    issues.push({ rule: 'ENVELOPE_UNREADABLE', path: envelopeName, detail: error.message });
  }
  for (const entry of entries) {
    if (/(^|\/)verify-result\.json$/.test(entry)) {
      details.staleVerifierResult += 1;
      issues.push({ rule: 'STALE_VERIFIER_RESULT', path: entry, detail: 'recibo de verifier não pode ser empacotado' });
    }
    if (/(^|\/)tmp\//.test(entry) || /\/tmp\//.test(entry)) {
      details.temporaryArtifacts += 1;
      issues.push({ rule: 'TEMP_PATH_ARTIFACT', path: entry });
    }
    if (/\.(log|wal|shm|tmp)$/.test(entry)) {
      details.temporaryArtifacts += 1;
      issues.push({ rule: 'RUNTIME_ARTIFACT', path: entry });
    }
    if (/CANDIDATE-DEFERRED\.json$/.test(entry)) {
      issues.push({ rule: 'STALE_CANDIDATE_MARKER', path: entry, detail: 'marcador de candidato em release GO final' });
    }
    const m = entry.match(/r-agent2-(\d{8}-\d{6})/);
    if (m && `r-agent2-${m[1]}` !== currentReleaseId) {
      details.foreignReleaseArtifacts += 1;
      issues.push({ rule: 'FOREIGN_RELEASE_ARTIFACT', path: entry, detail: `pertence a r-agent2-${m[1]}; release atual é ${currentReleaseId}` });
    }
  }

  // ── 2. verify-result.json local: só vale se vinculado ao payload atual ────
  const verifyResultPath = path.join(DIST_VERIFIER, 'verify-result.json');
  const verifyResult = fs.existsSync(verifyResultPath) ? readJson(verifyResultPath) : null;
  if (verifyResult) {
    const bound = String(verifyResult.payload || verifyResult.payloadName || verifyResult.artifact || '');
    const rel = String(verifyResult.releaseId || verifyResult.release || '');
    if (bound !== payloadName && rel !== currentReleaseId && !bound.includes(currentReleaseId)) {
      details.staleVerifierResult += 1;
      issues.push({
        rule: 'STALE_VERIFIER_RESULT',
        path: 'dist/verifier/verify-result.json',
        detail: `recibo vinculado a "${bound || rel || 'desconhecido'}", não ao payload atual ${payloadName}`,
      });
    }
  }

  // ── 3. dist/governance/*.json: runId/sourceFingerprint do run canônico ─────
  const currentRun = readJson(CURRENT_RUN_PATH);
  if (currentRun && fs.existsSync(DIST_GOVERNANCE)) {
    for (const f of fs.readdirSync(DIST_GOVERNANCE).filter((x) => x.endsWith('.json'))) {
      const doc = readJson(path.join(DIST_GOVERNANCE, f));
      if (!doc || typeof doc !== 'object') continue;
      const docRunId = doc.runId || null;
      const docFp = doc.sourceFingerprint || null;
      if (docRunId && docRunId !== currentRun.runId) {
        details.foreignRunArtifacts += 1;
        issues.push({ rule: 'FOREIGN_RUN_ARTIFACT', path: `dist/governance/${f}`, detail: `runId=${docRunId} != ${currentRun.runId}` });
      }
      if (docFp && currentRun.sourceFingerprint && docFp !== currentRun.sourceFingerprint) {
        details.foreignRunArtifacts += 1;
        issues.push({ rule: 'FOREIGN_RUN_ARTIFACT', path: `dist/governance/${f}`, detail: 'sourceFingerprint divergente do run canônico' });
      }
    }
  }

  return finish({ rootDir, reportPath }, issues.length === 0 ? 'PASS' : 'FAIL', issues, details, null);
}

function finish(ctx, status, issues, details, note) {
  const currentRun = readJson(path.join(ctx.rootDir, 'governance', '.current-run.json')) || {};
  const report = {
    artifactType: 'release-hygiene-report',
    artifactVersion: '1.1.0',
    generatedAt: new Date().toISOString(),
    runId: currentRun.runId || null,
    sourceFingerprint: currentRun.sourceFingerprint || null,
    status: status === 'FAIL' ? 'FAIL' : 'PASS',
    skipped: status === 'SKIP',
    note: note || undefined,
    issueCount: issues.length,
    issues,
    hygiene: details,
  };
  fs.mkdirSync(path.dirname(ctx.reportPath), { recursive: true });
  fs.writeFileSync(ctx.reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`[release-hygiene] status=${report.status} issues=${issues.length} envelope=${details.envelope || 'n/a'}`);
  for (const issue of issues) {
    console.log(`[release-hygiene] ISSUE [${issue.rule}] ${issue.path}${issue.detail ? ` — ${issue.detail}` : ''}`);
  }
  console.log(`[release-hygiene] relatório: ${path.relative(ctx.rootDir, ctx.reportPath)}`);
  return status === 'FAIL' ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exit(run());
  } catch (error) {
    console.error('[release-hygiene] erro ao executar validador:', error);
    process.exit(1);
  }
}

module.exports = { run };
