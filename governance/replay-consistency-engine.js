#!/usr/bin/env node
'use strict';

/**
 * Replay Consistency Engine v2 — valida coerência entre TODOS os artefatos de replay.
 *
 * Usa os módulos compartilhados:
 *   - governance/shared/replay-parser.js           — parser canônico
 *   - governance/shared/replay-semantic-validator.js — validação semântica
 *   - governance/shared/replay-decision-engine.js  — fonte única de decisão
 *
 * Detecta:
 *   - divergência entre replay-hardening-engine e artefatos brutos
 *   - falso positivo (GO + evidências contraditórias)
 *   - replay parcial (steps incompletos)
 *   - contaminação UI (ui.available=false em jornada crítica)
 *   - replay drift (decisão muda entre fontes)
 *   - divergência entre flows[] do smoke e replays individuais
 *   - suporte a flows[].replay E flows[].replaySummary
 */

const fs   = require('fs');
const path = require('path');

const ROOT        = path.join(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'governance', 'replay-consistency-report.json');

const { loadAllReplays }                   = require('./shared/replay-parser');
const { validateAllReplays }               = require('./shared/replay-semantic-validator');
const { checkReplayDecisionConsistency,
        decideFromHardeningReport }        = require('./shared/replay-decision-engine');
const { loadVisualCriticalJourneys }       = require('./replay-hardening-engine');

function readJsonSafe(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

// ─── Verificar divergência entre smoke-aggregate e replays individuais ────────
function checkSmokevsSeparateConsistency(VISUAL_CRITICAL) {
  const smokeData   = readJsonSafe('qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json') || {};
  const smokeFlows  = smokeData.flows || [];
  const violations  = [];

  for (const flow of smokeFlows) {
    const jid = flow.journeyId;
    if (!jid) continue;

    // Status do smoke-aggregate (suporta ambos replay e replaySummary)
    const summary      = flow.replaySummary || flow.replay || {};
    const smokeStatus  = summary.status || flow.status;

    // Tentar replay individual correspondente
    const relPath  = `qa/smoke/prod-like/${jid}-replay.json`;
    const indivData = readJsonSafe(relPath);
    if (!indivData) continue;
    const indivStatus = indivData.replaySummary?.status || indivData.replay?.status || indivData.status;

    if (smokeStatus && indivStatus && smokeStatus !== indivStatus) {
      violations.push({
        type:        'STATUS_DRIFT_SMOKE_VS_INDIVIDUAL',
        severity:    'HIGH',
        journeyId:   jid,
        smokeStatus,
        indivStatus,
        message:     `${jid}: smoke-aggregate diz ${smokeStatus} mas individual diz ${indivStatus}`,
      });
    }
  }

  return violations;
}

// ─── Verificar alinhamento entre hardening-report e consistency-engine ────────
function checkHardeningAlignment() {
  const consistency = checkReplayDecisionConsistency();

  if (consistency.consistent) return [];

  const violations = [];

  if (consistency.globalDivergence) {
    violations.push({
      type:    'GLOBAL_DECISION_DRIFT',
      severity: 'CRITICAL',
      message: `Divergência global: hardening-report=${consistency.globalReport} mas artefatos=${consistency.globalArtifacts}`,
    });
  }

  for (const div of (consistency.divergences || [])) {
    violations.push({
      type:    'JOURNEY_DECISION_DRIFT',
      severity: div.severity || 'HIGH',
      journeyId: div.journeyId,
      message: div.message,
    });
  }

  return violations;
}

// ─── Verificação de falsos positivos semânticos nos artefatos brutos ──────────
function checkSemanticFalsePositives(VISUAL_CRITICAL) {
  const replays = loadAllReplays(ROOT);
  const result  = validateAllReplays(replays, VISUAL_CRITICAL);
  return result.violations;
}

// ─── Motor principal ──────────────────────────────────────────────────────────
function runReplayConsistencyEngine() {
  const VISUAL_CRITICAL = loadVisualCriticalJourneys();

  // 1. Verificações semânticas nos artefatos brutos
  const semanticViolations = checkSemanticFalsePositives(VISUAL_CRITICAL);

  // 2. Divergência smoke-aggregate vs réplicas individuais
  const smokeVsIndiv = checkSmokevsSeparateConsistency(VISUAL_CRITICAL);

  // 3. Divergência entre hardening-report e artefatos brutos
  const hardeningAlignment = checkHardeningAlignment();

  // 4. Ler decisão do hardening (autoridade máxima de replay)
  const hardeningReport = decideFromHardeningReport();
  const hardeningDecision = hardeningReport?.decision || 'REPLAY_HARDENING_UNKNOWN';

  const allViolations = [
    ...semanticViolations,
    ...smokeVsIndiv,
    ...hardeningAlignment,
  ];

  const criticals = allViolations.filter((v) => v.severity === 'CRITICAL');
  const highs     = allViolations.filter((v) => v.severity === 'HIGH');

  // SE o hardening-engine diz NO_GO, este engine DEVE dizer NO_GO também
  // (inegociável — um GO aqui contradizendo hardening é proibido)
  const hardeningBlocks = hardeningDecision === 'REPLAY_NO_GO';
  const ownPass         = allViolations.length === 0;
  const pass            = ownPass && !hardeningBlocks;

  // Carregar replays para stats
  const replays = loadAllReplays(ROOT);

  const report = {
    generatedAt:             new Date().toISOString(),
    engine:                  'replay-consistency-engine/v2',
    pass,
    decision:                pass ? 'REPLAY_CONSISTENCY_GO' : 'REPLAY_CONSISTENCY_NO_GO',
    hardeningDecision,
    hardeningBlocks,
    replaysAnalyzed:         replays.length,
    semanticViolations:      semanticViolations.length,
    smokeVsIndivViolations:  smokeVsIndiv.length,
    hardeningAlignmentViolations: hardeningAlignment.length,
    violations:              allViolations.length,
    criticalViolations:      criticals.length,
    highViolations:          highs.length,
    allViolations,
    summary: pass
      ? `Todos os ${replays.length} replays são consistentes. Hardening: ${hardeningDecision}.`
      : `${allViolations.length} inconsistência(s): ${criticals.length} crítica(s), ${highs.length} alta(s). Hardening: ${hardeningDecision}`,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

module.exports = { runReplayConsistencyEngine };

if (require.main === module) {
  const report = runReplayConsistencyEngine();
  // eslint-disable-next-line no-console
  console.log(`[replay-consistency/v2] decision=${report.decision} violations=${report.violations} hardening=${report.hardeningDecision}`);
  process.exit(report.pass ? 0 : 1);
}
