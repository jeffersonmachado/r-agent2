#!/usr/bin/env node
'use strict';

/**
 * generate-final-status-projections.js
 *
 * Produtor canônico único das PROJEÇÕES derivadas da governança final.
 * Lê SOMENTE as fontes canônicas:
 *   - governance/final-readiness-report.json   (finalDecision, runId, sourceFingerprint)
 *   - governance/final-governance-report.json  (finalDecision — deve concordar)
 *   - governance/rap-master-scorecard.json     (overallStatus, summary, dimensions)
 *
 * e regenera deterministicamente as 5 projeções:
 *   - docs/governance/_platform-status-source.json
 *   - dev/platform-readiness/latest.json
 *   - docs/governance/PLATFORM_STATUS.md
 *   - docs/governance/ENTERPRISE_READINESS.md
 *   - docs/architecture/RAP_MASTER_SCORECARD.md
 *
 * As projeções JAMAIS são editadas independentemente: todo conteúdo decisório
 * (decisão, score, runId, sourceFingerprint, datas) vem dos JSONs canônicos.
 * As seções de evidência do relatório de readiness (2,5 MB) são preservadas da
 * projeção existente — apenas os campos decisórios são sobrepostos pela
 * canônica. Se a projeção não existir, o gerador FALHA (não fabrica evidência).
 *
 * Por que existe: BLOCKER 2 do release r-agent2-20260905-163709 — a canônica
 * selou 78/78 AUTONOMOUS_READY_GO mas o payload carregou docs stale (76/78,
 * IN_PROGRESS, NO_GO) regenerados na fase DELIVERED. O two-pass-release chama
 * este gerador DEPOIS do seal-time-gate e ANTES de rebuildar o ZIP final, e em
 * seguida roda validate-final-status-projection.js como gate bloqueante.
 *
 * Idempotente: rodar 2x sobre a mesma canônica produz arquivos idênticos
 * (generatedAt vem da canônica, não do relógio).
 *
 * Uso: node scripts/governance/generate-final-status-projections.js
 * Exit 0 = projeções regeneradas; Exit 1 = canônica inconsistente/ausente.
 */

const fs = require('fs');
const path = require('path');
const { renderMasterScorecard } = require('../../governance/master-scorecard-docs');
const { toMarkdownSections } = require('../../tools/system/platform-readiness');
const { decisionsAgree } = require('../../governance/decision-family');

const ROOT = path.resolve(__dirname, '..', '..');

const CANONICAL = {
  readiness: 'governance/final-readiness-report.json',
  governance: 'governance/final-governance-report.json',
  scorecard: 'governance/rap-master-scorecard.json',
};

const PROJECTIONS_JSON = [
  'docs/governance/_platform-status-source.json',
  'dev/platform-readiness/latest.json',
];

const PROJECTIONS_MD = [
  'docs/governance/PLATFORM_STATUS.md',
  'docs/governance/ENTERPRISE_READINESS.md',
  'docs/architecture/RAP_MASTER_SCORECARD.md',
];

function readJson(root, rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return { error: `missing:${rel}` };
  try {
    return { data: JSON.parse(fs.readFileSync(full, 'utf8')) };
  } catch (err) {
    return { error: `invalid_json:${rel}:${err.message}` };
  }
}

function writeText(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function writeJson(root, rel, value) {
  writeText(root, rel, `${JSON.stringify(value, null, 2)}\n`);
}

function generateFinalStatusProjections(rootDir) {
  const root = rootDir || ROOT;
  const errors = [];

  const readiness = readJson(root, CANONICAL.readiness);
  const governance = readJson(root, CANONICAL.governance);
  const scorecard = readJson(root, CANONICAL.scorecard);
  for (const [name, res] of Object.entries({ readiness, governance, scorecard })) {
    if (res.error) errors.push(`canonical_unreadable:${CANONICAL[name]}:${res.error}`);
  }
  if (errors.length) return { status: 'FAIL', errors };

  const decision = readiness.data.finalDecision;
  const governanceDecision = governance.data.finalDecision;
  if (!decision || !governanceDecision || !scorecard.data.overallStatus) {
    errors.push('canonical_fields_missing: finalDecision/overallStatus ausentes');
  }
  // §P1 — A divergência que importa é de FAMÍLIA (bloqueado × aprovado), não de
  // string. Fonte única em `governance/decision-family.js`.
  if (decision && governanceDecision) {
    const agreement = decisionsAgree(decision, governanceDecision);
    if (!agreement.agree) {
      errors.push(`canonical_divergence: readiness=${decision} (${agreement.left}) governance=${governanceDecision} (${agreement.right}) [${agreement.reason}] — projeção recusada sobre canônica inconsistente`);
    }
  }
  if (!scorecard.data.summary || !Array.isArray(scorecard.data.dimensions)) {
    errors.push('canonical_fields_missing: scorecard sem summary/dimensions');
  }
  if (errors.length) return { status: 'FAIL', errors };

  const runId = readiness.data.runId || governance.data.runId || scorecard.data.runId || null;
  const sourceFingerprint = readiness.data.sourceFingerprint
    || governance.data.sourceFingerprint
    || scorecard.data.sourceFingerprint
    || null;
  const generatedAt = readiness.data.generatedAt || governance.data.generatedAt || scorecard.data.generatedAt;

  // Estrutura de evidência preservada da projeção existente; os campos
  // decisórios são SEMPRE sobrepostos pela canônica (nunca editados à mão).
  const existing = readJson(root, 'dev/platform-readiness/latest.json');
  if (existing.error) {
    return { status: 'FAIL', errors: [`projection_unreadable:dev/platform-readiness/latest.json:${existing.error}`] };
  }
  const report = {
    ...existing.data,
    generatedAt,
    runId,
    sourceFingerprint,
    finalDecision: decision,
    productionReadiness: {
      ...(existing.data.productionReadiness || {}),
      status: decision,
    },
  };

  const written = [];
  for (const rel of PROJECTIONS_JSON) {
    writeJson(root, rel, report);
    written.push(rel);
  }

  const markdown = toMarkdownSections(report);
  writeText(root, 'docs/governance/PLATFORM_STATUS.md', markdown.platformStatus);
  writeText(root, 'docs/governance/ENTERPRISE_READINESS.md', markdown.enterprise);
  written.push('docs/governance/PLATFORM_STATUS.md', 'docs/governance/ENTERPRISE_READINESS.md');

  writeText(root, 'docs/architecture/RAP_MASTER_SCORECARD.md', renderMasterScorecard(scorecard.data));
  written.push('docs/architecture/RAP_MASTER_SCORECARD.md');

  return {
    status: 'PASS',
    finalDecision: decision,
    runId,
    sourceFingerprint,
    generatedAt,
    scorecard: {
      overallStatus: scorecard.data.overallStatus,
      totalDimensions: scorecard.data.summary.totalDimensions,
      dimensionsAt10: scorecard.data.summary.dimensionsAt10,
    },
    written,
  };
}

function main() {
  const result = generateFinalStatusProjections();
  if (result.status !== 'PASS') {
    console.error(`[final-status-projections] FAIL — projeções NÃO regeneradas`);
    for (const error of result.errors) console.error(`  ✗ ${error}`);
    process.exit(1);
  }
  console.log(`[final-status-projections] decision=${result.finalDecision} score=${result.scorecard.dimensionsAt10}/${result.scorecard.totalDimensions} (${result.scorecard.overallStatus})`);
  for (const rel of result.written) console.log(`  ✓ ${rel}`);
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { generateFinalStatusProjections, CANONICAL, PROJECTIONS_JSON, PROJECTIONS_MD };
