'use strict';

/**
 * validate-final-status-projection.js
 *
 * Gate FINAL_STATUS_PROJECTION_STALE: garante que as projeções humanas/docs da
 * governança canônica não fiquem stale. Fontes canônicas:
 *   - governance/final-readiness-report.json   (finalDecision)
 *   - governance/final-governance-report.json  (finalDecision)
 *   - governance/rap-master-scorecard.json     (overallStatus, summary.totalDimensions)
 *
 * Projeções verificadas:
 *   - docs/governance/_platform-status-source.json (finalDecision)
 *   - dev/platform-readiness/latest.json            (finalDecision)
 *   - docs/governance/ENTERPRISE_READINESS.md       ("Decision: X")
 *   - docs/governance/PLATFORM_STATUS.md            ("Readiness decision: X")
 *   - docs/architecture/RAP_MASTER_SCORECARD.md     ("Overall status: **X**")
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

function readJson(root, rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return { error: `missing:${rel}` };
  try {
    return { data: JSON.parse(fs.readFileSync(full, 'utf8')) };
  } catch (err) {
    return { error: `invalid_json:${rel}:${err.message}` };
  }
}

function extractMdToken(root, rel, pattern) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return { error: `missing:${rel}` };
  const content = fs.readFileSync(full, 'utf8');
  const match = content.match(pattern);
  if (!match) return { error: `token_not_found:${rel}` };
  return { value: match[1].trim() };
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
  }

  for (const spec of PROJECTIONS_MD) {
    const res = extractMdToken(root, spec.file, spec.pattern);
    if (res.error) {
      issues.push({ projection: spec.file, issue: res.error });
      continue;
    }
    const expected = spec.field === 'scorecardStatus' ? scorecardStatus : canonicalDecision;
    if (res.value !== expected) {
      issues.push({
        projection: spec.file,
        issue: `stale_${spec.field}: expected=${expected} found=${res.value}`,
      });
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
