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
  readJson,
} = require('./common');

const ROOT = path.join(__dirname, '..', '..');

function loadPolicy() {
  // `readJson` (helper de governança) resolve o caminho a partir da raiz e é
  // reconhecido pelo auditor de persistência como LEITURA — não como alvo de
  // escrita, que é o falso positivo que a junção de caminho provocava.
  const policy = readJson('config/security-intel-policy.json', null);
  if (!policy) throw new Error('security_intel_policy_missing');
  return policy;
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

  // Exposição real: o flag `dev` vive no inventário de componentes (lockfile).
  // Carregamos aqui para que a decisão distinga risco de runtime de risco de
  // cadeia de build/teste em vez de tratar os dois como iguais.
  const getSecurityComponent = require('../../api/db/models/SecurityComponent');
  const Component = getSecurityComponent();
  const components = await Component.findAll({
    where: { tenant_key: tenantKey },
    attributes: ['bom_ref', 'dev', 'direct', 'version_class', 'service'],
    raw: true,
  });
  const componentByRef = new Map(components.map((row) => [row.bom_ref, row]));

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
        dev: componentByRef.get(row.component_bom_ref)?.dev === true,
        direct: componentByRef.get(row.component_bom_ref)?.direct === true,
      })),
    },
    sbom: snapshot
      ? {
        available: true,
        valid: snapshot.validation?.valid === true,
        sha256: snapshot.sha256,
        componentCount: snapshot.component_count,
        generatedAt: snapshot.generated_at,
        // `run_id` é NULLABLE por desenho (unicidade do snapshot é (tenant_key, sha256),
        // então ele é REUSADO entre runs) — por isso a checagem de proveniência em
        // `main()` não pode depender só dele: usa também `generated_at` × startedAt do run.
        runId: snapshot.run_id || null,
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

  // Waivers VIGENTES do tenant. O motor revalida a expiração de cada um
  // (`waiverExemption`) — waiver sem expiração ou expirado NÃO isenta nada. Sem
  // banco acessível, a lista fica vazia (o gate continua fail-closed: nada é
  // isentado por indisponibilidade de leitura).
  let waivers = [];
  let waiversError = null;
  try {
    const { waiversForGate } = require('../../api/services/securityIntel/waiverService');
    waivers = await waiversForGate({ tenantKey });
  } catch (error) {
    waiversError = error.message;
  }

  const evaluation = evaluateReleaseSecurity({
    policy: policy.releaseGate || {},
    findings: facts ? facts.findings : null,
    sbom: facts ? facts.sbom : null,
    advisoryBase: facts ? facts.advisoryBase : null,
    vectorIndex: facts ? facts.vectorIndex : null,
    coveragePercent: facts ? facts.coveragePercent : null,
    waivers,
    now: new Date(),
  });

  // ── PROVENIÊNCIA DO VEREDITO (P0) ─────────────────────────────────────────────────────────────
  // A decisão vale para a FONTE que está sendo liberada. DEFEITO MEDIDO (2026-10-10): os fatos de
  // segurança vêm do banco (`SecurityFinding`, `SecuritySbomSnapshot`, sync OSV, componentes) e
  // NENHUM deles carrega vínculo com o source — então um SBOM anterior ao run podia sustentar o
  // veredito de um código que já mudou. Aplica a MESMA REGRA CENTRAL já usada por
  // `scripts/governance/lib/runtime-evidence-artifacts.js`: evidência produzida ANTES do início do
  // run NÃO sustenta o run. Fail-closed: sem run governado, ou com evidência anterior/estrangeira,
  // a decisão vira NO_GO — nunca PASS por ausência de dado.
  const { CURRENT_RUN_RELATIVE_PATH, resolveRunLineage } = require('./lib/resolve-run-lineage');
  const provenanceIssues = [];
  let currentRun = null;
  try {
    const lineage = resolveRunLineage({ rootDir: ROOT });
    currentRun = JSON.parse(fs.readFileSync(path.join(ROOT, CURRENT_RUN_RELATIVE_PATH), 'utf8'));
    if (!lineage.runId || lineage.source === 'none') {
      provenanceIssues.push({
        code: 'SECURITY_GATE_NO_GOVERNED_RUN',
        message: 'sem run governado — o veredito de segurança não pode sustentar release',
      });
    }
    const sbom = facts ? facts.sbom : null;
    const sbomGeneratedAt = sbom && sbom.generatedAt ? new Date(sbom.generatedAt) : null;
    const runStartedAt = currentRun && currentRun.startedAt ? new Date(currentRun.startedAt) : null;
    if (sbomGeneratedAt && runStartedAt && sbomGeneratedAt.getTime() < runStartedAt.getTime()) {
      provenanceIssues.push({
        code: 'SECURITY_GATE_STALE_EVIDENCE',
        message: `SBOM de ${sbomGeneratedAt.toISOString()} é ANTERIOR ao início do run ${currentRun.runId} (${runStartedAt.toISOString()}) — evidência vencida não sustenta o release`,
      });
    }
    if (sbom && sbom.runId && currentRun && sbom.runId !== currentRun.runId) {
      provenanceIssues.push({
        code: 'SECURITY_GATE_FOREIGN_RUN',
        message: `SBOM pertence ao run ${sbom.runId}, não ao run corrente ${currentRun.runId}`,
      });
    }
  } catch (error) {
    provenanceIssues.push({
      code: 'SECURITY_GATE_UNAVAILABLE',
      message: `proveniência do veredito não pôde ser verificada: ${error.message}`,
    });
  }

  const finalDecision = provenanceIssues.length > 0 ? 'NO_GO' : evaluation.decision;
  const report = withLineage({
    status: finalDecision,
    decision: finalDecision,
    mode: informative ? 'advisory' : 'blocking',
    tenantKey,
    summary: provenanceIssues.length > 0
      ? `NO_GO: ${provenanceIssues.map((item) => item.code).join(', ')} (motor: ${evaluation.summary})`
      : evaluation.summary,
    blocking: [...(evaluation.blocking || []), ...provenanceIssues],
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
    waiversImplemented: true,
    waiversActive: waivers.length,
    waiversError,
    waivers: waivers.map((waiver) => ({
      findingKey: waiver.findingKey,
      expiresAt: waiver.expiresAt,
      approvedBy: waiver.approvedBy,
    })),
  }, 'security-release-gate-report');

  writeReport('security-release-gate-report.json', report);

  console.log(`[security-release-gate] mode=${report.mode} decision=${finalDecision}`);
  console.log(`[security-release-gate] waivers vigentes=${waivers.length}${waiversError ? ` (leitura falhou: ${waiversError})` : ''}`);
  for (const item of evaluation.blocking) console.log(`  ✗ ${item.code}: ${item.message}`);
  for (const item of evaluation.warnings) console.log(`  ! ${item.code}: ${item.message}`);
  if (collectError) console.log(`  ! coleta falhou: ${collectError}`);
  console.log(`[security-release-gate] ${evaluation.summary}`);

  if (finalDecision === 'GO') return 0;
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
