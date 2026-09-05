'use strict';

/**
 * validate-final-status-projection.js
 *
 * Gate FINAL_STATUS_PROJECTION_STALE: garante que as projeções humanas/docs da
 * governança canônica não fiquem stale. Fontes canônicas:
 *   - governance/final-readiness-report.json   (finalDecision, runId, sourceFingerprint)
 *   - governance/final-governance-report.json  (finalDecision)
 *   - governance/rap-master-scorecard.json     (overallStatus, summary.totalDimensions,
 *                                               summary.dimensionsAt10, runId, sourceFingerprint)
 *
 * Projeções verificadas (regeneradas por generate-final-status-projections.js;
 * nunca editadas independentemente):
 *   - docs/governance/_platform-status-source.json (finalDecision, runId, sourceFingerprint)
 *   - dev/platform-readiness/latest.json            (finalDecision, runId, sourceFingerprint)
 *   - docs/governance/ENTERPRISE_READINESS.md       ("Decision: X")
 *   - docs/governance/PLATFORM_STATUS.md            ("Readiness decision: X")
 *   - docs/architecture/RAP_MASTER_SCORECARD.md     ("Overall status: **X**", linhas de
 *                                                    score, Run ID, Source fingerprint)
 *
 * Checks (além da igualdade de decisão já existente):
 *   1. SCORE CONSISTENCY: qualquer token `N/<totalDimensions>` nas projeções
 *      MD/JSON deve ter N == dimensionsAt10 canônico (76/78 com canônica 78/78
 *      → FAIL). No scorecard MD as linhas `- Dimensions:`, `- 10/10:` e
 *      `- Below 10:` devem igualar o summary canônico. Em JSON, só strings
 *      curtas (<= 200 chars) são varridas — payloads de evidência (base64)
 *      não são conteúdo decisório.
 *   2. STALE-DECISION SCAN: com decisão canônica GO, nenhuma linha/campo
 *      decisório das projeções pode declarar NO_GO/IN_PROGRESS.
 *   3. LINEAGE: quando a canônica carrega runId/sourceFingerprint, as
 *      projeções JSON e o scorecard MD (Run ID/Source fingerprint) devem
 *      carregar os mesmos valores.
 *
 * Uso: node scripts/governance/validate-final-status-projection.js
 * Exit 0 = PASS; Exit 1 = FINAL_STATUS_PROJECTION_STALE.
 */

const fs = require('fs');
const path = require('path');

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
  { file: 'docs/governance/ENTERPRISE_READINESS.md', pattern: /Decision:\s*([A-Z_:]+)/, field: 'readinessDecision' },
  { file: 'docs/governance/PLATFORM_STATUS.md', pattern: /Readiness decision:\s*([A-Z_:]+)/, field: 'readinessDecision' },
  { file: 'docs/architecture/RAP_MASTER_SCORECARD.md', pattern: /Overall status:\s*\*\*([A-Z_]+)\*\*/, field: 'scorecardStatus' },
];

const SCORECARD_MD = 'docs/architecture/RAP_MASTER_SCORECARD.md';

// Decisões que representam GO (espelha o verifier offline). Com canônica GO,
// nenhuma projeção pode declarar decisão corrente NO_GO/IN_PROGRESS.
const GO_DECISIONS = new Set(['GO', 'AUTONOMOUS_READY_GO', 'AUTONOMOUS_READY', 'PASS', 'DELIVERED_RELEASE_VERIFIED']);
const STALE_DECISION_TOKEN = /NO_GO|IN_PROGRESS/;
// Linhas decisórias em MD (o header de seção "## NO_GO reasons" NÃO casa —
// não é declaração de decisão corrente).
const MD_DECISION_LINE = /^\s*[-*]?\s*(?:Decision|Readiness decision|Overall status|Production readiness|Canonical mesh decision)\s*:/i;
const SCORE_TOKEN = /(\d+)\s*\/\s*(\d+)/g;
// Evidência embutida (base64/data URI) não é conteúdo decisório.
const MAX_JSON_SCAN_STRING = 200;

function readJson(root, rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return { error: `missing:${rel}` };
  try {
    return { data: JSON.parse(fs.readFileSync(full, 'utf8')) };
  } catch (err) {
    return { error: `invalid_json:${rel}:${err.message}` };
  }
}

function readText(root, rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return { error: `missing:${rel}` };
  return { content: fs.readFileSync(full, 'utf8') };
}

function extractMdToken(root, rel, pattern) {
  const res = readText(root, rel);
  if (res.error) return { error: res.error };
  const match = res.content.match(pattern);
  if (!match) return { error: `token_not_found:${rel}` };
  return { value: match[1].trim() };
}

// Varredura de tokens de score `N/total` em conteúdo texto (MD inteiro ou
// strings curtas de JSON). Denominador == totalDimensions canônico exige
// numerador == dimensionsAt10 canônico.
function scanScoreTokens(content, rel, expected, issues) {
  if (expected.total == null || expected.at10 == null) return;
  SCORE_TOKEN.lastIndex = 0;
  let match;
  while ((match = SCORE_TOKEN.exec(content))) {
    const numerator = Number(match[1]);
    const denominator = Number(match[2]);
    if (denominator === expected.total && numerator !== expected.at10) {
      issues.push({
        projection: rel,
        issue: `stale_score: token=${match[0]} esperado=${expected.at10}/${expected.total}`,
      });
    }
  }
}

function scanJsonScoreTokens(value, rel, expected, issues, keyPath = '') {
  if (typeof value === 'string') {
    if (value.length <= MAX_JSON_SCAN_STRING) scanScoreTokens(value, rel, expected, issues);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanJsonScoreTokens(item, rel, expected, issues, `${keyPath}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      scanJsonScoreTokens(item, rel, expected, issues, keyPath ? `${keyPath}.${key}` : key);
    }
  }
}

// Campos decisórios de uma projeção JSON (escopo estrito: o gerador controla
// exatamente estes campos — matching estrito é seguro).
function jsonDecisionFields(data) {
  const fields = [];
  if (typeof data.finalDecision === 'string') fields.push({ field: 'finalDecision', value: data.finalDecision });
  if (typeof data.status === 'string') fields.push({ field: 'status', value: data.status });
  if (typeof data.productionReadiness?.status === 'string') {
    fields.push({ field: 'productionReadiness.status', value: data.productionReadiness.status });
  }
  return fields;
}

function checkProjectionConsistency(rootDir) {
  const root = rootDir || path.resolve(__dirname, '..', '..');
  const issues = [];

  const readiness = readJson(root, CANONICAL.readiness);
  const governance = readJson(root, CANONICAL.governance);
  const scorecard = readJson(root, CANONICAL.scorecard);
  for (const [name, res] of Object.entries({ readiness, governance, scorecard })) {
    if (res.error) issues.push({ projection: CANONICAL[name], issue: `canonical_unreadable:${res.error}` });
  }
  if (issues.length) {
    return { status: 'FAIL', code: 'FINAL_STATUS_PROJECTION_STALE', issues };
  }

  const canonicalDecision = readiness.data.finalDecision;
  const governanceDecision = governance.data.finalDecision;
  const scorecardStatus = scorecard.data.overallStatus;
  if (!canonicalDecision || !governanceDecision || !scorecardStatus) {
    issues.push({ projection: 'canonical', issue: 'canonical_fields_missing' });
  }
  if (canonicalDecision && governanceDecision && canonicalDecision !== governanceDecision) {
    issues.push({
      projection: CANONICAL.governance,
      issue: `canonical_divergence: readiness=${canonicalDecision} governance=${governanceDecision}`,
    });
  }

  // Score canônico (summary preferido; derivação do array como fallback).
  const summary = scorecard.data.summary || {};
  const dimensions = Array.isArray(scorecard.data.dimensions) ? scorecard.data.dimensions : null;
  const expected = {
    total: summary.totalDimensions ?? (dimensions ? dimensions.length : null),
    at10: summary.dimensionsAt10 ?? (dimensions ? dimensions.filter((d) => Number(d.score) >= 10).length : null),
    below10: summary.dimensionsBelow10 ?? (dimensions ? dimensions.filter((d) => Number(d.score) < 10).length : null),
  };

  // Lineage canônico (runId/sourceFingerprint) — checado onde as projeções o
  // carregam; com canônica lineageada, projeção sem lineage é stale.
  const canonicalRunId = readiness.data.runId || governance.data.runId || scorecard.data.runId || null;
  const canonicalFp = readiness.data.sourceFingerprint
    || governance.data.sourceFingerprint
    || scorecard.data.sourceFingerprint
    || null;
  if (readiness.data.runId && scorecard.data.runId && readiness.data.runId !== scorecard.data.runId) {
    issues.push({
      projection: CANONICAL.scorecard,
      issue: `canonical_divergence: readiness.runId=${readiness.data.runId} scorecard.runId=${scorecard.data.runId}`,
    });
  }
  if (readiness.data.sourceFingerprint && scorecard.data.sourceFingerprint
    && readiness.data.sourceFingerprint !== scorecard.data.sourceFingerprint) {
    issues.push({
      projection: CANONICAL.scorecard,
      issue: 'canonical_divergence: readiness.sourceFingerprint != scorecard.sourceFingerprint',
    });
  }

  const canonicalIsGo = GO_DECISIONS.has(canonicalDecision);

  for (const rel of PROJECTIONS_JSON) {
    const res = readJson(root, rel);
    if (res.error) {
      issues.push({ projection: rel, issue: res.error });
      continue;
    }
    if (res.data.finalDecision !== canonicalDecision) {
      issues.push({
        projection: rel,
        issue: `stale_decision: expected=${canonicalDecision} found=${res.data.finalDecision || 'missing'}`,
      });
    }
    if (canonicalIsGo) {
      for (const { field, value } of jsonDecisionFields(res.data)) {
        if (STALE_DECISION_TOKEN.test(value)) {
          issues.push({
            projection: rel,
            issue: `stale_decision_token: ${field}=${value} com canônica ${canonicalDecision}`,
          });
        }
      }
    }
    if (canonicalRunId && res.data.runId !== canonicalRunId) {
      issues.push({
        projection: rel,
        issue: `stale_run_id: expected=${canonicalRunId} found=${res.data.runId || 'missing'}`,
      });
    }
    if (canonicalFp && res.data.sourceFingerprint !== canonicalFp) {
      issues.push({
        projection: rel,
        issue: `stale_source_fingerprint: expected=${canonicalFp.slice(0, 12)}… found=${res.data.sourceFingerprint ? `${String(res.data.sourceFingerprint).slice(0, 12)}…` : 'missing'}`,
      });
    }
    scanJsonScoreTokens(res.data, rel, expected, issues);
  }

  for (const spec of PROJECTIONS_MD) {
    const res = extractMdToken(root, spec.file, spec.pattern);
    if (res.error) {
      issues.push({ projection: spec.file, issue: res.error });
      continue;
    }
    const expectedToken = spec.field === 'scorecardStatus' ? scorecardStatus : canonicalDecision;
    if (res.value !== expectedToken) {
      issues.push({
        projection: spec.file,
        issue: `stale_${spec.field}: expected=${expectedToken} found=${res.value}`,
      });
    }
    const text = readText(root, spec.file);
    if (text.content) {
      scanScoreTokens(text.content, spec.file, expected, issues);
      if (canonicalIsGo) {
        for (const line of text.content.split(/\r?\n/)) {
          if (MD_DECISION_LINE.test(line) && STALE_DECISION_TOKEN.test(line)) {
            issues.push({
              projection: spec.file,
              issue: `stale_decision_token: "${line.trim()}" com canônica ${canonicalDecision}`,
            });
          }
        }
      }
    }
  }

  // Scorecard MD: linhas de sumário e lineage devem igualar o scorecard canônico.
  const scorecardMd = readText(root, SCORECARD_MD);
  if (scorecardMd.content) {
    const summaryLines = [
      { label: 'Dimensions', pattern: /^- Dimensions:\s*(\d+)/m, expectedValue: expected.total },
      { label: '10/10', pattern: /^- 10\/10:\s*(\d+)/m, expectedValue: expected.at10 },
      { label: 'Below 10', pattern: /^- Below 10:\s*(\d+)/m, expectedValue: expected.below10 },
    ];
    for (const { label, pattern, expectedValue } of summaryLines) {
      if (expectedValue == null) continue;
      const match = scorecardMd.content.match(pattern);
      if (!match) {
        issues.push({ projection: SCORECARD_MD, issue: `missing_score_line: "- ${label}:"` });
      } else if (Number(match[1]) !== expectedValue) {
        issues.push({
          projection: SCORECARD_MD,
          issue: `stale_score: ${label}=${match[1]} esperado=${expectedValue}`,
        });
      }
    }
    const scorecardRunId = scorecard.data.runId || canonicalRunId;
    const scorecardFp = scorecard.data.sourceFingerprint || canonicalFp;
    if (scorecardRunId) {
      const match = scorecardMd.content.match(/^- Run ID:\s*(\S+)/m);
      if (!match) {
        issues.push({ projection: SCORECARD_MD, issue: 'missing_lineage: "- Run ID:"' });
      } else if (match[1] !== scorecardRunId) {
        issues.push({ projection: SCORECARD_MD, issue: `stale_run_id: expected=${scorecardRunId} found=${match[1]}` });
      }
    }
    if (scorecardFp) {
      const match = scorecardMd.content.match(/^- Source fingerprint:\s*(\S+)/m);
      if (!match) {
        issues.push({ projection: SCORECARD_MD, issue: 'missing_lineage: "- Source fingerprint:"' });
      } else if (match[1] !== scorecardFp) {
        issues.push({
          projection: SCORECARD_MD,
          issue: `stale_source_fingerprint: expected=${scorecardFp.slice(0, 12)}… found=${match[1].slice(0, 12)}…`,
        });
      }
    }
  }

  return {
    status: issues.length ? 'FAIL' : 'PASS',
    code: issues.length ? 'FINAL_STATUS_PROJECTION_STALE' : 'FINAL_STATUS_PROJECTION_CONSISTENT',
    canonical: {
      readinessDecision: canonicalDecision,
      governanceDecision,
      scorecardStatus,
      scorecardDimensions: scorecard.data.summary?.totalDimensions ?? null,
      scorecardDimensionsAt10: expected.at10,
      runId: canonicalRunId,
      sourceFingerprint: canonicalFp,
    },
    projectionsChecked: PROJECTIONS_JSON.length + PROJECTIONS_MD.length,
    issues,
  };
}

function main() {
  const result = checkProjectionConsistency();
  const report = {
    artifactType: 'final-status-projection-report',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    ...result,
  };
  const reportPath = path.resolve(__dirname, '..', '..', 'reports', 'final-status-projection-report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`[final-status-projection] status=${result.status} issues=${result.issues.length}`);
  for (const issue of result.issues) {
    console.log(`[final-status-projection] ISSUE [${issue.projection}] ${issue.issue}`);
  }
  console.log(`[final-status-projection] relatório: reports/final-status-projection-report.json`);
  process.exit(result.status === 'PASS' ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { checkProjectionConsistency };
