#!/usr/bin/env node
'use strict';

/**
 * verify-v2-seal-freshness.js — O SELO V2 É PASSO OBRIGATÓRIO E FRESCO DO PIPELINE DE ZIP.
 *
 * DEFEITO REAL (medido em 2026-09-30): o pacote de release era gerado por `scripts/release-package.sh`
 * SEM nenhuma checagem do selo do Engineering Router V2 — o selo existia, era GO ou NO_GO, e o ZIP
 * saía igual. Um selo de OUTRA fonte (ou de dias antes, ou NO_GO) autorizava o pacote por omissão.
 *
 * Este verificador fecha isso: lê o selo do disco, resolve o fingerprint do source ATUAL pela
 * autoridade única (`governance/proof-engine/fingerprint-chain`) e o lineage do run governado
 * (`scripts/governance/lib/resolve-run-lineage`), e reprova com código nomeado quando o selo não é
 * deste código/run ou está vencido (`scripts/governance/lib/v2SealFreshness`).
 *
 * Saída: reports/v2-seal-freshness-report.json
 * Uso:   node scripts/governance/verify-v2-seal-freshness.js [--print]
 * Bypass: `V2_SEAL_MAX_AGE_MS` ajusta a janela. NÃO existe bypass de conteúdo.
 */

const fs = require('fs');
const path = require('path');

const { computeSourceFingerprint } = require('../../governance/proof-engine/fingerprint-chain');
const { resolveRunLineage } = require('./lib/resolve-run-lineage');
const { evaluateSealFreshness, DEFAULT_MAX_AGE_MS } = require('./lib/v2SealFreshness');

const ROOT = path.join(__dirname, '..', '..');
const SEAL_EXECUTION = path.join(ROOT, 'reports', 'engineering-router-v2-seal-execution.json');
const SEAL_DECISION = path.join(ROOT, 'reports', 'engineering-router-v2-seal-report.json');
const REPORT = path.join(ROOT, 'reports', 'v2-seal-freshness-report.json');

function readJson(abs) {
  try {
    return fs.existsSync(abs) ? JSON.parse(fs.readFileSync(abs, 'utf8')) : null;
  } catch (_) {
    return null;
  }
}

function main() {
  const maxAgeRaw = Number(process.env.V2_SEAL_MAX_AGE_MS);
  const maxAgeMs = Number.isFinite(maxAgeRaw) && maxAgeRaw > 0 ? maxAgeRaw : DEFAULT_MAX_AGE_MS;

  const seal = readJson(SEAL_EXECUTION);
  const decision = readJson(SEAL_DECISION);
  const lineage = resolveRunLineage({ rootDir: ROOT });
  const sourceFingerprint = computeSourceFingerprint(ROOT);

  const evaluation = evaluateSealFreshness({ seal, sourceFingerprint, lineage, maxAgeMs });

  // A DECISÃO do selo (`validate-engineering-router-v2`) precisa estar coerente com a execução: uma
  // execução GO com decisão NO_GO (ou ausente) não autoriza nada — as duas são o mesmo veredito.
  const decisionStatus = decision ? (decision.status || decision.decision || null) : null;
  const decisionOk = decisionStatus === 'GO';
  const decisionViolation = decisionOk ? null : {
    code: 'SEAL_DECISION_NOT_GO',
    detail: decision
      ? `decisão do selo V2 = ${decisionStatus || '(ausente)'}`
      : 'decisão do selo V2 ausente (reports/engineering-router-v2-seal-report.json)',
  };

  const violations = [...evaluation.violations, ...(decisionViolation ? [decisionViolation] : [])];
  const ok = evaluation.ok && decisionOk;

  const report = {
    artifactType: 'v2-seal-freshness',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    runId: lineage.runId,
    sourceFingerprint: lineage.sourceFingerprint,
    sourceCommit: lineage.sourceCommit,
    currentSourceFingerprint: sourceFingerprint,
    maxAgeMs,
    sealExecution: {
      path: path.relative(ROOT, SEAL_EXECUTION),
      present: Boolean(seal),
      status: evaluation.status,
      generatedAt: evaluation.generatedAt,
      sourceFingerprint: evaluation.sealFingerprint,
      runId: evaluation.sealRunId,
      ageMs: evaluation.ageMs,
    },
    sealDecision: { path: path.relative(ROOT, SEAL_DECISION), present: Boolean(decision), status: decisionStatus },
    codes: [...evaluation.codes, ...(decisionViolation ? [decisionViolation.code] : [])],
    violations,
    status: ok ? 'PASS' : 'FAIL',
    note: 'O selo V2 é pré-condição de packaging: um selo de outro source/run ou vencido não autoriza este pacote.',
  };

  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--print')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    if (ok) {
      console.log(`[v2-seal-freshness] PASS — selo GO de ${evaluation.generatedAt} para o source corrente (${String(evaluation.sealFingerprint).slice(0, 12)}…)`);
    } else {
      for (const violation of violations) console.error(`  - ${violation.code} :: ${violation.detail}`);
      console.error(`[v2-seal-freshness] FAIL — ${violations.length} violação(ões); o pacote NÃO pode ser gerado sem selo GO fresco deste source`);
    }
  }
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = { SEAL_EXECUTION, SEAL_DECISION, REPORT };
