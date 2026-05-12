'use strict';

/**
 * Cross-Report Consistency Engine
 *
 * Responsável por detectar contradições entre todos os relatórios de governança e
 * bloquear autonomy claims quando evidências físicas contradizem a classificação declarada.
 *
 * Qualquer contradição identificada aqui:
 *  - Gera um blocker com severidade CRITICAL
 *  - Impede autonomous-ready
 *  - Impõe downgrade de readiness
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

// ─── Thresholds de gate enterprise ──────────────────────────────────────────
const THRESHOLDS = {
  intelligenceStabilityMin: 0.5,   // abaixo disso = instável
  replayCoverageMin: 100,           // 100 % obrigatório para enterprise-ready
  prodLikeCoverageMin: 100,         // 100 % obrigatório para prod-like stage
  verticalJourneysMin: 1,           // mínimo de journeys reais por vertical prod-like
  verticalAssertionsMin: 1,         // mínimo de assertions por vertical prod-like
  verticalIntegrationsMin: 1,       // mínimo de integrations por vertical prod-like
  handoffNullTimestampLimit: 0,     // zero nulls permitidos em audit chain
  handoffEventCountMin: 1,          // eventCount mínimo para fully normalized
  pbxSyntheticAllowed: ['simulated', 'synthetic-assisted', 'hybrid-real'], // max para synthetic
};

// ─── Utilitários ─────────────────────────────────────────────────────────────
function readJsonSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function resolveReport(relPath) {
  const abs = path.join(ROOT, relPath);
  return readJsonSafe(abs);
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function countNulls(arr, key) {
  if (!Array.isArray(arr)) return 0;
  return arr.filter((item) => item == null || item[key] == null).length;
}

// ─── Classificações PBX ──────────────────────────────────────────────────────
// L03 e L04 são smokes com propósitos distintos:
//   L03 — testa chamada de voz real (TTS/ASR/transfer). CDR é de chamada real.
//   L04 — testa o pipeline de eventos (CDR → event ledger → flow trigger).
//          Usa CDR sintético porque testa o processamento, não a chamada.
// A maturidade do PBX deve refletir a qualidade da chamada real (L03), não
// punir L04 pelo seu CDR sintético de pipeline test.
function classifyPbxMaturity(pbxData) {
  if (!pbxData) return 'simulated';
  const l03 = pbxData.sources?.l03 || {};
  const l04 = pbxData.sources?.l04 || {};

  const l03RealCall = l03.realCall?.synthetic === false && l03.realCall?.cdrFound === true;
  const l03SelfTestFail = l03.selftestStatus === 'FAIL';

  // CDR sintético do L04 é scaffold de pipeline test — não conta como evidência de chamada falsa
  // quando L03 já tem chamada real. Conta apenas se L03 também for sintético.
  const l04IsPipelineTestScaffold = String(l04.cdr?.source || '').includes('synthetic_insert') && l03RealCall;
  const hasSyntheticInsert = !l04IsPipelineTestScaffold
    && (String(l04.cdr?.source || '').includes('synthetic_insert')
    || String(l03.cdr?.source || '').includes('synthetic_insert'));

  const hasRealCdr = l03.realCall?.cdrFound === true || l04.cdr?.source === 'real';

  // L03 real + L04 pipeline scaffold + selftest fail → hybrid-real (chamada real, monitoramento com falha)
  if (l03RealCall && l03SelfTestFail && l04IsPipelineTestScaffold) return 'hybrid-real';

  if (l03SelfTestFail && hasSyntheticInsert) return 'synthetic-assisted';
  if (l03SelfTestFail && !hasSyntheticInsert) return 'hybrid-real';
  if (hasSyntheticInsert && !l03RealCall) return 'hybrid-real';
  if (hasRealCdr && l03RealCall && !l03SelfTestFail && !hasSyntheticInsert) return 'enterprise-real';
  if (hasRealCdr && !l03SelfTestFail) return 'prod-like';
  return 'hybrid-real';
}

// ─── Verificação de inteligência do QA Mesh ──────────────────────────────────
function checkIntelligenceStability(intelligenceData) {
  const contradictions = [];
  if (!intelligenceData) return contradictions;

  const stability = Array.isArray(intelligenceData.moduleStability)
    ? intelligenceData.moduleStability
    : [];

  for (const mod of stability) {
    if (Number(mod.stabilityScore) < THRESHOLDS.intelligenceStabilityMin) {
      contradictions.push({
        type: 'intelligence_instability',
        domain: mod.domain,
        stabilityScore: mod.stabilityScore,
        passed: mod.passed,
        total: mod.total,
        blocker: true,
        message: `Domínio '${mod.domain}' com estabilidade ${mod.stabilityScore} (${mod.passed}/${mod.total}) — abaixo do mínimo de ${THRESHOLDS.intelligenceStabilityMin}. autonomous-ready impossível.`,
      });
    }
  }

  const recurring = Array.isArray(intelligenceData.recurringFailures)
    ? intelligenceData.recurringFailures
    : [];
  for (const fail of recurring) {
    contradictions.push({
      type: 'recurring_intelligence_failure',
      domain: fail.domain,
      fingerprint: fail.fingerprint,
      recurringCount: fail.recurringCount,
      blocker: true,
      message: `Falha recorrente em '${fail.domain}' (count=${fail.recurringCount}): ${fail.fingerprint}`,
    });
  }

  return contradictions;
}

// ─── Verificação de handoff normalization ────────────────────────────────────
function checkHandoffNormalization(handoffData) {
  const contradictions = [];
  if (!handoffData) return contradictions;

  const ticket = handoffData.ticket || {};
  const evidence = handoffData.evidence || {};
  const replay = Array.isArray(handoffData.replay) ? handoffData.replay : [];

  if (ticket.assignedTo == null) {
    contradictions.push({
      type: 'handoff_null_assignment',
      blocker: true,
      message: 'ticket.assignedTo é null — handoff sem ownership definido. Audit chain incompleto.',
    });
  }

  const nullTimestamps = countNulls(replay, 'timestamp');
  if (nullTimestamps > THRESHOLDS.handoffNullTimestampLimit) {
    contradictions.push({
      type: 'handoff_null_timestamps',
      nullCount: nullTimestamps,
      blocker: true,
      message: `${nullTimestamps} entrada(s) de replay com timestamp null — timeline de handoff não auditável.`,
    });
  }

  if (Number(evidence.eventCount || 0) < THRESHOLDS.handoffEventCountMin) {
    contradictions.push({
      type: 'handoff_zero_events',
      eventCount: evidence.eventCount,
      blocker: true,
      message: `eventCount=${evidence.eventCount} — handoff sem eventos registrados. Não atingiu normalização enterprise.`,
    });
  }

  return contradictions;
}

// ─── Verificação de maturidade PBX ───────────────────────────────────────────
function checkPbxMaturity(pbxData) {
  const contradictions = [];
  if (!pbxData) return contradictions;

  const maturity = classifyPbxMaturity(pbxData);
  const allowedForFull = ['prod-like', 'enterprise-real'];

  if (!allowedForFull.includes(maturity)) {
    contradictions.push({
      type: 'pbx_maturity_insufficient',
      detectedMaturity: maturity,
      required: 'prod-like ou enterprise-real',
      blocker: true,
      message: `PBX classificado como '${maturity}'. Para enterprise-ready PBX deve ser prod-like ou enterprise-real. Presença de synthetic_insert ou selftestStatus=FAIL impede upgrade.`,
    });
  }

  return contradictions;
}

// ─── Verificação de vertical coverage ────────────────────────────────────────
function checkVerticalClassification(verticalSummaries) {
  const contradictions = [];
  if (!Array.isArray(verticalSummaries)) return contradictions;

  for (const vertical of verticalSummaries) {
    const name = vertical.vertical || vertical.id || 'unknown';
    const classification = vertical.classification || '';
    const isEnterpriseClaim = ['production-like', 'enterprise-ready'].includes(classification);

    if (!isEnterpriseClaim) continue;

    const journeyCount = Number(vertical.journeyCount || vertical.journeys?.length || 0);
    const assertionCount = Number(vertical.assertionCount || vertical.assertions?.length || 0);
    const integrationCount = Number(vertical.integrationCount || vertical.integrations?.length || 0);

    if (journeyCount < THRESHOLDS.verticalJourneysMin) {
      contradictions.push({
        type: 'vertical_empty_journeys',
        vertical: name,
        classification,
        journeyCount,
        blocker: true,
        message: `Vertical '${name}' classificado como '${classification}' mas journeyCount=${journeyCount}. Sem journeys reais, classificação é inválida.`,
      });
    }
    if (assertionCount < THRESHOLDS.verticalAssertionsMin) {
      contradictions.push({
        type: 'vertical_empty_assertions',
        vertical: name,
        classification,
        assertionCount,
        blocker: false,
        message: `Vertical '${name}' classificado como '${classification}' mas assertionCount=${assertionCount}. Evidência operacional insuficiente.`,
      });
    }
    if (integrationCount < THRESHOLDS.verticalIntegrationsMin) {
      contradictions.push({
        type: 'vertical_empty_integrations',
        vertical: name,
        classification,
        integrationCount,
        blocker: false,
        message: `Vertical '${name}' classificado como '${classification}' mas integrationCount=${integrationCount}. Sem integrações verificadas.`,
      });
    }
  }

  return contradictions;
}

// ─── Package binding check ────────────────────────────────────────────────────
function checkPackageBinding(packageValidationReport, expectedZipName) {
  const contradictions = [];
  if (!packageValidationReport) return contradictions;

  const reportedZip = packageValidationReport.zipName;
  if (expectedZipName && reportedZip !== expectedZipName) {
    contradictions.push({
      type: 'package_mismatch',
      reportedZip,
      expectedZip: expectedZipName,
      blocker: true,
      message: `Relatório de validação aponta para '${reportedZip}' mas o pacote atual é '${expectedZipName}'. Governance vinculada a pacote errado — relatório inválido.`,
    });
  }

  if (packageValidationReport.ok === false) {
    contradictions.push({
      type: 'package_validation_failed',
      missingEntries: packageValidationReport.missingEntries || [],
      blocker: true,
      message: `Pacote não passou na validação: ${(packageValidationReport.missingEntries || []).length} entradas ausentes.`,
    });
  }

  return contradictions;
}

// ─── Motor principal ──────────────────────────────────────────────────────────
function runCrossReportValidation(options = {}) {
  const intelligenceData = options.intelligenceData
    || resolveReport('qa-mesh/intelligence/latest.json');

  const handoffData = options.handoffData
    || resolveReport('qa/enterprise/human-handoff-full-validation.json');

  const pbxData = options.pbxData
    || resolveReport('qa/enterprise/pbx-voice-flow-prod-like.json');

  const verticalSummaries = options.verticalSummaries || null;

  const packageValidationReport = options.packageValidationReport
    || resolveReport('governance/package-validation-report.json');

  const expectedZipName = options.expectedZipName || (() => {
    const DIST_DIR = path.join(ROOT, 'dist');
    if (!fs.existsSync(DIST_DIR)) return null;
    const zips = fs.readdirSync(DIST_DIR)
      .filter((n) => n.endsWith('.zip'))
      .sort()
      .reverse();
    return zips[0] || null;
  })();

  const allContradictions = [
    ...checkIntelligenceStability(intelligenceData),
    ...checkHandoffNormalization(handoffData),
    ...checkPbxMaturity(pbxData),
    ...checkVerticalClassification(verticalSummaries),
    ...checkPackageBinding(packageValidationReport, expectedZipName),
  ];

  const blockers = allContradictions.filter((c) => c.blocker);
  const warnings = allContradictions.filter((c) => !c.blocker);

  const pbxMaturity = classifyPbxMaturity(pbxData);

  // Determina o nível máximo de readiness permitido dadas as contradições
  let maximumAllowedReadiness = 'autonomous-ready';
  if (blockers.length > 0) {
    const types = new Set(blockers.map((b) => b.type));

    // intelligence instability bloqueia qualquer claim acima de enterprise-partial
    if (types.has('intelligence_instability') || types.has('recurring_intelligence_failure')) {
      maximumAllowedReadiness = 'enterprise-partial';
    }
    // PBX insuficiente bloqueia enterprise-ready
    if (types.has('pbx_maturity_insufficient') && maximumAllowedReadiness !== 'enterprise-partial') {
      maximumAllowedReadiness = 'enterprise-partial';
    }
    // package mismatch bloqueia tudo acima de operational
    if (types.has('package_mismatch') || types.has('package_validation_failed')) {
      maximumAllowedReadiness = 'operational';
    }
    // handoff gaps bloqueiam enterprise-ready
    if (
      (types.has('handoff_null_assignment') || types.has('handoff_null_timestamps') || types.has('handoff_zero_events'))
      && !['operational', 'validated', 'prod-like'].includes(maximumAllowedReadiness)
    ) {
      maximumAllowedReadiness = 'enterprise-partial';
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    expectedZipName,
    pbxMaturity,
    contradictions: allContradictions,
    blockers,
    warnings,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    maximumAllowedReadiness,
    autonomousReadyBlocked: blockers.length > 0,
    summary: blockers.length === 0
      ? 'Nenhuma contradição crítica encontrada. Readiness claims são consistentes com evidências físicas.'
      : `${blockers.length} contradição(ões) crítica(s) detectada(s). autonomous-ready BLOQUEADO. Máximo permitido: ${maximumAllowedReadiness}.`,
  };
}

function writeValidationReport(report, reportPath) {
  const target = reportPath || path.join(ROOT, 'governance', 'cross-report-validation.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return target;
}

if (require.main === module) {
  const report = runCrossReportValidation();
  const target = writeValidationReport(report);
  // eslint-disable-next-line no-console
  console.log(`[cross-report-validator] blockers=${report.blockerCount} maxReadiness=${report.maximumAllowedReadiness} → ${target}`);
  process.exit(report.blockerCount > 0 ? 1 : 0);
}

module.exports = {
  runCrossReportValidation,
  writeValidationReport,
  classifyPbxMaturity,
  checkIntelligenceStability,
  checkHandoffNormalization,
  checkPbxMaturity,
  checkVerticalClassification,
  checkPackageBinding,
  THRESHOLDS,
};
