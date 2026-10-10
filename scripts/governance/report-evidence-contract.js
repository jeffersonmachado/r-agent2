#!/usr/bin/env node
'use strict';

/**
 * DIAGNÓSTICO do contrato único de evidência.
 *
 * Mede, contra os artefatos REAIS do run corrente, quantos carregam os campos que
 * a missão exige de uma evidência governada (run/commit/árvore/hashes de plano e
 * resultado/ambiente/configuração/produtor/resultado/bloqueios), e o que falta.
 *
 * Por que diagnóstico e não gate (ainda): o contrato foi formalizado em
 * 2026-10-10 e a medição mostra a distância real entre o vocabulário atual dos
 * artefatos e o exigido. Transformar isso em bloqueio sem medir deixaria o gate
 * vermelho por um débito que ninguém dimensionou — o endurecimento precisa ser
 * uma decisão informada (`enforced: false` no relatório).
 *
 * Uso: node scripts/governance/report-evidence-contract.js [--json]
 */

const fs = require('fs');
const path = require('path');

const { summarizeEvidenceContract, REQUIRED_FIELDS } = require('../../governance/lib/evidence-contract');
const { withLineage } = require('../../governance/report-lineage');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST_REL = 'governance/evidence-manifest.json';
const CURRENT_RUN_REL = 'governance/.current-run.json';
const REPORT_REL = 'reports/evidence-contract-report.json';

function readJson(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Constrói os records avaliados. Os artefatos do manifesto HERDAM o que é do
 * documento (run, árvore) — herdar é honesto aqui porque o manifesto declara isso
 * para todos os seus membros; o que não existe em lugar nenhum continua faltando.
 */
function collectRecords({ manifest, currentRun }) {
  const artifacts = Array.isArray(manifest && manifest.artifacts) ? manifest.artifacts : [];
  return artifacts.map((artifact) => {
    const merged = {
      runId: (artifact && artifact.runId) || (manifest && manifest.runId) || (currentRun && currentRun.runId) || null,
      sourceFingerprint: (artifact && artifact.sourceFingerprint)
        || (manifest && manifest.sourceFingerprint)
        || (currentRun && currentRun.sourceFingerprint)
        || null,
      sourceCommit: (artifact && artifact.sourceCommit) || (currentRun && currentRun.sourceCommit) || null,
      candidateCommit: (artifact && artifact.candidateCommit) || null,
      policyVersion: (artifact && artifact.policyVersion) || (currentRun && currentRun.policyVersion) || null,
      ...(artifact && typeof artifact === 'object' ? artifact : {}),
    };
    return {
      name: (artifact && (artifact.path || artifact.id)) || 'unnamed',
      record: merged,
    };
  });
}

function main(argv) {
  const json = argv.includes('--json');
  const manifest = readJson(MANIFEST_REL);
  const currentRun = readJson(CURRENT_RUN_REL);
  const records = collectRecords({ manifest, currentRun });

  const summary = summarizeEvidenceContract({ records, currentRun });

  const report = withLineage({
    generatedAt: new Date().toISOString(),
    artifactType: 'evidence-contract-report',
    contractFields: [...REQUIRED_FIELDS],
    manifestPresent: Boolean(manifest),
    currentRunPresent: Boolean(currentRun),
    ...summary,
    note: 'Diagnóstico: `enforced: false` — nenhum gate bloqueia por este relatório ainda.',
  }, 'evidence-contract-report');

  const target = path.join(ROOT, REPORT_REL);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  console.log(`[evidence-contract] artefatos avaliados=${summary.total} conformes=${summary.passed} violações=${summary.violations}`);
  const missing = Object.entries(summary.missingByField).sort((a, b) => b[1] - a[1]);
  if (missing.length > 0) {
    console.log('[evidence-contract] campos ausentes (por frequência):');
    for (const [field, count] of missing.slice(0, 12)) {
      console.log(`  ${field}: ${count}/${summary.total}`);
    }
  }
  console.log(`[evidence-contract] relatório: ${REPORT_REL}`);
  return 0;
}

module.exports = { collectRecords, readJson, MANIFEST_REL, CURRENT_RUN_REL, REPORT_REL };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
