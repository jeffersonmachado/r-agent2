#!/usr/bin/env node
'use strict';

/**
 * Replay Consistency Engine — valida coerência entre todos os artefatos de replay.
 *
 * Detecta:
 *   - replay falso positivo (status GO + evidências contraditórias)
 *   - replay parcial (steps incompletos)
 *   - replay contaminado (ui.available=false em jornada crítica)
 *   - replay drift (status muda entre artefatos)
 *   - inconsistência entre smoke agregado e replays individuais
 */

const fs   = require('fs');
const path = require('path');

const ROOT        = path.join(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'governance', 'replay-consistency-report.json');

function readJsonSafe(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

const { loadVisualCriticalJourneys } = require('./replay-hardening-engine');

// ─── Construção do índice de replays por journeyId ────────────────────────────
function buildReplayIndex() {
  const index = {};

  // 1. Smoke agregado
  const smoke = readJsonSafe('qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json') || {};
  for (const flow of (smoke.flows || [])) {
    const jid = flow.journeyId;
    if (!index[jid]) index[jid] = { journeyId: jid, sources: [] };
    index[jid].sources.push({
      origin:    'smoke-aggregate',
      status:    flow.replay?.status || flow.status,
      stepCount: (flow.steps || []).length,
      failedStepCount: flow.replay?.failedStepCount ?? null,
      failedStepIds:   flow.replay?.failedStepIds   ?? [],
    });
  }

  // 2. Replay individuais
  const dir = path.join(ROOT, 'qa', 'smoke', 'prod-like');
  if (fs.existsSync(dir)) {
    for (const fname of fs.readdirSync(dir).filter((f) => f.endsWith('-replay.json'))) {
      const data = readJsonSafe(`qa/smoke/prod-like/${fname}`);
      if (!data) continue;
      const jid = data.journeyId || fname.replace(/-replay\.json$/, '');
      if (!index[jid]) index[jid] = { journeyId: jid, sources: [] };
      index[jid].sources.push({
        origin:    `individual:${fname}`,
        status:    data.status,
        stepCount: (data.steps || []).length,
        failedStepCount: data.failedStepCount ?? null,
        failedStepIds:   data.failedStepIds   ?? [],
      });
    }
  }

  // 3. proof-signature
  const proofSig = readJsonSafe('governance/proof-signature.json') || {};
  for (const r of (proofSig.subjectHashes || [])) {
    const jid = r.journeyId;
    if (!index[jid]) index[jid] = { journeyId: jid, sources: [] };
    index[jid].sources.push({
      origin:    'proof-signature',
      status:    'SIGNED',
      replayHash: r.replayHash,
    });
  }

  return index;
}

// ─── Verificações por journey ─────────────────────────────────────────────────
function checkJourneyConsistency(journeyId, sources, VISUAL_CRITICAL) {
  const violations = [];

  // Status diverge entre fontes
  const statuses = sources.filter((s) => s.status && s.status !== 'SIGNED').map((s) => s.status);
  const uniqueStatuses = [...new Set(statuses)];
  if (uniqueStatuses.length > 1) {
    violations.push({
      type:     'STATUS_DRIFT',
      severity: 'HIGH',
      message:  `Status diverge entre fontes: ${JSON.stringify(uniqueStatuses)}`,
      sources:  sources.map((s) => ({ origin: s.origin, status: s.status })),
    });
  }

  // GO com failedStepCount > 0 em alguma fonte
  for (const src of sources) {
    if ((src.failedStepCount ?? 0) > 0 && src.status === 'GO') {
      violations.push({
        type:     'FALSE_POSITIVE',
        severity: 'CRITICAL',
        origin:   src.origin,
        message:  `${src.origin}: status=GO mas failedStepCount=${src.failedStepCount}`,
      });
    }
    if ((src.failedStepIds || []).length > 0 && src.status === 'GO') {
      violations.push({
        type:     'FALSE_POSITIVE_IDS',
        severity: 'CRITICAL',
        origin:   src.origin,
        message:  `${src.origin}: status=GO mas failedStepIds=${JSON.stringify(src.failedStepIds)}`,
      });
    }
  }

  return {
    journeyId,
    isVisualCritical: VISUAL_CRITICAL.has(journeyId),
    sourceCount:      sources.length,
    violations,
    consistent:       violations.length === 0,
  };
}

// ─── Verificar UI contamination nos replays ───────────────────────────────────
function checkUiContamination(VISUAL_CRITICAL) {
  const contaminations = [];
  const dir = path.join(ROOT, 'qa', 'smoke', 'prod-like');
  if (!fs.existsSync(dir)) return contaminations;

  for (const fname of fs.readdirSync(dir).filter((f) => f.endsWith('-replay.json'))) {
    const data = readJsonSafe(`qa/smoke/prod-like/${fname}`);
    if (!data) continue;
    const jid = data.journeyId || fname.replace(/-replay\.json$/, '');
    if (!VISUAL_CRITICAL.has(jid)) continue;

    // Contar ui.available=false nos steps
    let uiUnavailableCount = 0;
    for (const step of (data.steps || [])) {
      const before = step.beforeStepSnapshot?.ui;
      const after  = step.afterStepSnapshot?.ui;
      if (before?.available === false) uiUnavailableCount++;
      if (after?.available  === false) uiUnavailableCount++;
    }
    const rootBefore = data.beforeSnapshot?.ui;
    const rootAfter  = data.afterSnapshot?.ui;
    if (rootBefore?.available === false) uiUnavailableCount++;
    if (rootAfter?.available  === false) uiUnavailableCount++;

    if (uiUnavailableCount > 0) {
      contaminations.push({
        journeyId:          jid,
        file:               `qa/smoke/prod-like/${fname}`,
        status:             data.status,
        uiUnavailableCount,
        type:               'UI_CONTAMINATION',
        severity:           'CRITICAL',
        message:            `${jid}: ${uiUnavailableCount} snapshot(s) com ui.available=false em jornada visual crítica`,
      });
    }
  }

  return contaminations;
}

// ─── Motor principal ──────────────────────────────────────────────────────────
function runReplayConsistencyEngine() {
  const VISUAL_CRITICAL = loadVisualCriticalJourneys();
  const index           = buildReplayIndex();

  const journeyResults = [];
  for (const [jid, { sources }] of Object.entries(index)) {
    journeyResults.push(checkJourneyConsistency(jid, sources, VISUAL_CRITICAL));
  }

  const uiContaminations = checkUiContamination(VISUAL_CRITICAL);
  const allViolations    = [
    ...journeyResults.flatMap((r) => r.violations.map((v) => ({ ...v, journeyId: r.journeyId }))),
    ...uiContaminations,
  ];
  const criticals = allViolations.filter((v) => v.severity === 'CRITICAL');
  const pass      = allViolations.length === 0;

  const report = {
    generatedAt:       new Date().toISOString(),
    engine:            'replay-consistency-engine/v1',
    pass,
    decision:          pass ? 'REPLAY_CONSISTENCY_GO' : 'REPLAY_CONSISTENCY_NO_GO',
    journeysAnalyzed:  journeyResults.length,
    consistentJourneys: journeyResults.filter((r) => r.consistent).length,
    uiContaminations:  uiContaminations.length,
    violations:        allViolations.length,
    criticalViolations: criticals.length,
    journeyResults,
    allViolations,
    summary: pass
      ? `Todos os ${journeyResults.length} replays são consistentes.`
      : `${allViolations.length} inconsistência(s): ${uiContaminations.length} contaminação(ões) UI, ${criticals.length} crítica(s)`,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

module.exports = { runReplayConsistencyEngine };

if (require.main === module) {
  const report = runReplayConsistencyEngine();
  // eslint-disable-next-line no-console
  console.log(`[replay-consistency] decision=${report.decision} violations=${report.violations} ui=${report.uiContaminations}`);
  process.exit(report.pass ? 0 : 1);
}
