#!/usr/bin/env node
'use strict';

/**
 * validate-security-release-gate.js
 *
 * Release Security Gate: decide GO/NO_GO do release sob a ótica de segurança de
 * versões (vulnerabilidades abertas, KEV, SBOM, idade da base de advisories,
 * integridade do índice vetorial e cobertura do inventário).
 *
 * DUAS LIÇÕES DE PROJETO DESTE REPO, APLICADAS AQUI:
 *
 *  1. "Validador que não consegue falhar é regra sem enforcement"
 *     (medido em `validate-layer-conventions`): este gate tem exit code REAL —
 *     `NO_GO` ⇒ exit 1 — e `tests/unit/securityIntel/releaseSecurityGate.test.js`
 *     tem controles negativos provando que ele reprova. O relatório e o exit
 *     code concordam por construção.
 *
 *  2. "Gate cuja entrada outro gate regenera" (medido em `journey-projections`):
 *     um gate executável NÃO pode instruir o operador a rodar comando manual.
 *     Por isso este gate PRODUZ a própria entrada: executa a correlação
 *     (offline, contra o banco) antes de avaliar. Não existe pré-condição
 *     manual escondida.
 *
 * Modos:
 *   padrão      → decidir e sair 1 quando NO_GO
 *   --informative / SECURITY_GATE_MODE=advisory → sempre exit 0, mas o relatório
 *   mantém a decisão REAL (advisory ≠ aprovado).
 *
 * Relatório: reports/security-release-gate-report.json (com lineage).
 */

const path = require('path');

const {
  writeReport,
  readText,
} = require('./common');

const ROOT = path.join(__dirname, '..', '..');

function loadPolicy() {
  const raw = readText(path.join('config', 'security-intel-policy.json'));
  if (!raw) throw new Error('security_intel_policy_missing');
  return JSON.parse(raw);
}

function loadDotEnv() {
  const fs = require('fs');
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/** Coleta os FATOS do release. Nada aqui decide — a decisão é do módulo puro. */
async function collectFacts({ tenantKey, policy }) {
  const { scanComponents, loadPolicy: loadScanPolicy } = require('../../api/services/securityIntel/vulnerabilityScanService');
  const { getLatestSbomSnapshot } = require('../../api/services/securityIntel/sbomService');
  const { getLatestDiscoveryRun } = require('../../api/services/securityIntel/inventoryStoreService');
  const { checkVectorIndexHealth } = require('../../api/services/securityIntel/vectorIndexProbe');
  const getSecurityFinding = require('../../api/db/models/SecurityFinding');
  const getSecurityAdvisorySync = require('../../api/db/models/SecurityAdvisorySync');
  const { connect, getSequelize } = require('../../api/db/sequelize');

  // Produz a própria entrada: correlação offline (idempotente) contra o banco.
  const scan = await scanComponents({ tenantKey, scope: 'installed', actor: 'security-release-gate' });

  if (!getSequelize()) await connect(3, 500);
  const Finding = getSecurityFinding();
  const findings = await Finding.findAll({ where: { tenant_key: tenantKey }, raw: true });

  const snapshot = await getLatestSbomSnapshot({ tenantKey });
  const latestRun = await getLatestDiscoveryRun({ tenantKey });
  const Sync = getSecurityAdvisorySync();
  const latestSync = await Sync.findOne({ where: { source: 'osv' }, order: [['started_at', 'DESC']], raw: true });

  const vectorPolicy = loadScanPolicy({ reload: true }).vectorIndex || {};
  let vectorIndex = null;
  try {
    const check = await checkVectorIndexHealth({ policy: { vectorIndex: vectorPolicy } });
    vectorIndex = { verdict: check.evaluation.verdict, findings: check.evaluation.findings, essentialUnmeasured: check.evaluation.essentialUnmeasured };
  } catch (error) {
    vectorIndex = null;
  }

  const advisoryPolicy = policy.advisorySources?.osv || {};
  const ageHours = latestSync
    ? (Date.now() - new Date(latestSync.finished_at || latestSync.started_at).getTime()) / 3600000
    : null;

  return {
    scan,
    findings: {
      available: true,
      source: 'security_findings',
      items: findings.map((row) => ({
        findingKey: row.finding_key,
        advisoryId: row.advisory_id,
        severity: row.severity,
        status: row.status,
        packageName: row.package_name,
        installedVersion: row.installed_version,
        service: row.service,
        kev: row.kev,
        fixAvailable: Array.isArray(row.fixed_versions) && row.fixed_versions.length > 0,
        resolvedAt: row.resolved_at,
        priority: row.priority,
      })),
    },
    sbom: snapshot
      ? {
        available: true,
        valid: snapshot.validation?.valid === true,
        sha256: snapshot.sha256,
        componentCount: snapshot.component_count,
        generatedAt: snapshot.generated_at,
      }
      : { available: false },
    advisoryBase: latestSync
      ? {
        available: true,
        syncId: latestSync.id,
        status: latestSync.status,
        ageHours,
        maxAgeHoursBeforeStale: advisoryPolicy.maxAgeHoursBeforeStale,
        maxAgeHoursBeforeBlocking: advisoryPolicy.maxAgeHoursBeforeBlocking,
      }
      : { available: false },
    vectorIndex,
    coveragePercent: latestRun?.coverage?.coveragePercent ?? null,
  };
}

async function main() {
  const informative = process.argv.includes('--informative')
    || String(process.env.SECURITY_GATE_MODE || '').toLowerCase() === 'advisory';
  loadDotEnv();

  const { evaluateReleaseSecurity } = require('../../engine/securityIntel/releaseSecurityGate');
  const { withLineage } = require('../../governance/report-lineage');

  const policy = loadPolicy();
  const tenantKey = process.env.SECURITY_GATE_TENANT || 'system';
  let facts = null;
  let collectError = null;
  try {
    facts = await collectFacts({ tenantKey, policy });
  } catch (error) {
    collectError = error.message;
  }

  const evaluation = evaluateReleaseSecurity({
    policy: policy.releaseGate || {},
    findings: facts ? facts.findings : null,
    sbom: facts ? facts.sbom : null,
    advisoryBase: facts ? facts.advisoryBase : null,
    vectorIndex: facts ? facts.vectorIndex : null,
    coveragePercent: facts ? facts.coveragePercent : null,
    waivers: [],
    now: new Date(),
  });

  const report = withLineage({
    status: evaluation.decision,
    decision: evaluation.decision,
    mode: informative ? 'advisory' : 'blocking',
    tenantKey,
    summary: evaluation.summary,
    blocking: evaluation.blocking,
    warnings: evaluation.warnings,
    checks: evaluation.checks,
    evidence: facts
      ? {
        scanRunId: facts.scan.scanRunId,
        componentsScanned: facts.scan.componentsScanned,
        findingsTotal: facts.scan.evaluations,
        findingsAtRisk: facts.scan.findings,
        notAffected: facts.scan.notAffected,
        sbom: facts.sbom,
        advisoryBase: facts.advisoryBase,
        vectorIndex: facts.vectorIndex ? { verdict: facts.vectorIndex.verdict } : null,
        coveragePercent: facts.coveragePercent,
      }
      : null,
    collectionError: collectError,
    waiversImplemented: false,
  }, 'security-release-gate-report');

  writeReport('security-release-gate-report.json', report);

  console.log(`[security-release-gate] mode=${report.mode} decision=${evaluation.decision}`);
  for (const item of evaluation.blocking) console.log(`  ✗ ${item.code}: ${item.message}`);
  for (const item of evaluation.warnings) console.log(`  ! ${item.code}: ${item.message}`);
  if (collectError) console.log(`  ! coleta falhou: ${collectError}`);
  console.log(`[security-release-gate] ${evaluation.summary}`);

  if (evaluation.decision === 'GO') return 0;
  if (informative) {
    console.log('[security-release-gate] modo advisory: exit 0, mas a decisão real é NO_GO');
    return 0;
  }
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`[security-release-gate] erro fatal: ${error.message}`);
    if (process.env.SECURITY_GATE_DEBUG === '1') console.error(error.stack);
    process.exit(1);
  });
