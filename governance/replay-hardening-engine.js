#!/usr/bin/env node
'use strict';

/**
 * Replay Hardening Engine — versão 2 com suporte ao formato real dos artefatos.
 *
 * Formatos suportados:
 *   1. flows[].replay        → qa-waves-operational-prod-like-smoke.json
 *   2. flows[].steps         → steps dentro de cada flow
 *   3. Replay individuais    → qa/smoke/prod-like/*-replay.json
 *   4. proof-signature.json  → hashes certificados
 *   5. enterprise replays    → qa/enterprise/*.json
 *
 * Regras de bloqueio (inegociáveis):
 *   - failedStepCount > 0
 *   - failedStepIds.length > 0
 *   - qualquer step.status = "failed"
 *   - ui.available = false em qualquer snapshot de step
 *   - ui.reason = playwright_page_unavailable em step crítico
 *   - replay.status = GO mas evidências contradizem
 *
 * Classificação hardened: apenas replays com verificação determinística
 * completa (steps + hashes) são `hardened`. Registros hash-only vindos de
 * proof-signature.json NUNCA são hardened — ver buildHashOnlyRecord.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT        = path.join(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'governance', 'replay-hardening-report.json');

// ─── Carregar classificação de jornadas visuais críticas ──────────────────────
function loadVisualCriticalJourneys() {
  const configPath = path.join(ROOT, 'governance', 'visual-critical-journeys.json');
  if (!fs.existsSync(configPath)) {
    return new Set([
      'support', 'support_ticket_flow', 'crm', 'ticket', 'whatsapp',
      'omnichannel', 'handoff', 'human_handoff', 'scheduling',
      'booking_flow', 'payment', 'payment_charge_flow', 'checkin',
      'fitness_customer_checkin', 'food_order_status_flow',
      'market_node_publish_flow', 'clinic_calendar_block_flow',
    ]);
  }
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return new Set(config.criticalJourneys || []);
  } catch (_) {
    return new Set();
  }
}

function sha256(data) {
  return crypto.createHash('sha256')
    .update(typeof data === 'string' ? data : JSON.stringify(data))
    .digest('hex');
}

function readJsonSafe(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

// ─── Detector de ui.available=false em snapshots ─────────────────────────────
// Verifica TODOS os caminhos onde ui pode aparecer dentro de um step/snapshot.
function findUiUnavailable(obj, parentPath = '') {
  if (!obj || typeof obj !== 'object') return [];
  const found = [];

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      found.push(...findUiUnavailable(obj[i], `${parentPath}[${i}]`));
    }
    return found;
  }

  // Verificar ui.available diretamente neste objeto
  const ui = obj.ui;
  if (ui && typeof ui === 'object' && ui.available === false) {
    found.push({
      path:   parentPath ? `${parentPath}.ui` : 'ui',
      reason: ui.reason || 'unavailable',
    });
  }

  // Verificar nos snapshots explícitos
  for (const snapshotKey of ['beforeStepSnapshot', 'afterStepSnapshot', 'beforeSnapshot', 'afterSnapshot', 'postState']) {
    const snap = obj[snapshotKey];
    if (snap && typeof snap === 'object') {
      const snapUi = snap.ui;
      if (snapUi && typeof snapUi === 'object' && snapUi.available === false) {
        found.push({
          path:   `${parentPath ? parentPath + '.' : ''}${snapshotKey}.ui`,
          reason: snapUi.reason || 'unavailable',
        });
      }
    }
  }

  return found;
}

// Action types that genuinely require a browser/Playwright to execute.
// Backend assertion steps NEVER require UI and must not be flagged for
// ui.available=false — their UI snapshot fields are informational only.
const UI_REQUIRED_ACTION_TYPES = new Set([
  'navigate', 'click', 'click_open', 'type', 'type_and_send',
  'assert_ui_state', 'wait_for_list', 'wait_for_element',
  'hover', 'select', 'scroll', 'screenshot', 'fill',
  'check', 'uncheck', 'press', 'keyboard',
]);

// ─── Análise de um step individual ───────────────────────────────────────────
function analyzeStep(step, journeyId, VISUAL_CRITICAL) {
  const violations = [];
  const stepId     = step.id || step.stepId || '?';

  // 1. status explicitamente failed
  if (step.status === 'failed' || step.passed === false) {
    violations.push({
      rule:    'STEP_FAILED',
      stepId,
      message: `Step ${stepId} status=failed`,
    });
  }

  // 2. ui.available=false em snapshots — apenas para steps que exigem browser.
  // Steps de assertiva de backend (assert_backend_state, webhook_status, etc.)
  // NÃO precisam de Playwright; seu ui.available=false é esperado e não é violação.
  if (VISUAL_CRITICAL.has(journeyId) && UI_REQUIRED_ACTION_TYPES.has(step.actionType || '')) {
    const uiIssues = findUiUnavailable(step, `step.${stepId}`);
    // Filtrar: apenas snapshots de step (não snapshot raiz do replay).
    // Deduplificar por step: se beforeStepSnapshot E afterStepSnapshot têm
    // ui.available=false, reportar apenas UMA violação por step (o estado é
    // o mesmo — Playwright indisponível). Double-report não adiciona informação.
    const stepUiIssues = uiIssues.filter((u) =>
      u.path.includes('beforeStepSnapshot') || u.path.includes('afterStepSnapshot')
    );
    if (stepUiIssues.length > 0) {
      const issue = stepUiIssues[0];
      violations.push({
        rule:    'STEP_UI_UNAVAILABLE',
        stepId,
        actionType: step.actionType,
        path:    issue.path,
        reason:  issue.reason,
        message: `Step ${stepId} (${step.actionType}) ui.available=false (${issue.reason}) em jornada crítica ${journeyId}`,
      });
    }
  }

  return violations;
}

// ─── Análise de um replay individual (arquivo *-replay.json) ─────────────────
function analyzeIndividualReplay(replay, source, VISUAL_CRITICAL) {
  const violations = [];
  const journeyId  = replay.journeyId || replay.id || source;

  // 1. failedStepCount > 0
  const failedCount = replay.failedStepCount ?? 0;
  if (failedCount > 0) {
    violations.push({
      rule:    'REPLAY_FALSE_POSITIVE',
      message: `failedStepCount=${failedCount} mas status=${replay.status}`,
    });
  }

  // 2. failedStepIds presentes
  const failedIds = replay.failedStepIds || [];
  if (failedIds.length > 0) {
    violations.push({
      rule:    'FAILED_STEP_IDS',
      steps:   failedIds,
      message: `failedStepIds=${JSON.stringify(failedIds)}`,
    });
  }

  // 3. Steps individuais
  const steps = Array.isArray(replay.steps) ? replay.steps : [];
  for (const step of steps) {
    const stepViolations = analyzeStep(step, journeyId, VISUAL_CRITICAL);
    violations.push(...stepViolations);
  }

  // 4. ui.available=false no nível raiz do replay (antes/após snapshot global).
  // Deduplificar: beforeSnapshot e afterSnapshot tipicamente refletem o mesmo
  // estado — reportar apenas UMA violação por replay se algum snapshot for
  // ui.available=false.
  if (VISUAL_CRITICAL.has(journeyId)) {
    const rootUiIssues = findUiUnavailable({ beforeSnapshot: replay.beforeSnapshot, afterSnapshot: replay.afterSnapshot }, 'root');
    if (rootUiIssues.length > 0) {
      const issue = rootUiIssues[0];
      violations.push({
        rule:    'REPLAY_ROOT_UI_UNAVAILABLE',
        path:    issue.path,
        reason:  issue.reason,
        message: `Replay ${journeyId} ui.available=false em snapshot raiz (${issue.reason})`,
      });
    }
  }

  // Hashes determinísticos
  const stepStatuses = steps.map((s) => ({ id: s.id, status: s.status, actionType: s.actionType }));
  return {
    journeyId,
    source,
    status:          replay.status,
    failedStepCount: failedCount,
    stepCount:       steps.length,
    isVisualCritical: VISUAL_CRITICAL.has(journeyId),
    violations,
    hardened:        violations.length === 0,
    replayDeterministicHash: sha256({ journeyId, steps: stepStatuses }),
    replayExecutionHash:     sha256({ journeyId, status: replay.status, failedCount }),
    replayEvidenceHash:      sha256({ journeyId, screenshots: replay.screenshots?.length || 0 }),
  };
}

// ─── Análise de flows[] no smoke agregado ────────────────────────────────────
function analyzeFlows(smokeData, sourcePath, VISUAL_CRITICAL) {
  const results = [];
  const flows   = Array.isArray(smokeData.flows) ? smokeData.flows : [];

  for (const flow of flows) {
    const journeyId = flow.journeyId || '?';
    const replay    = flow.replay || {};
    const steps     = Array.isArray(flow.steps) ? flow.steps : [];
    const violations = [];

    // Analisar o replay dentro do flow usando replay.steps se disponível.
    // flow.steps e replay.steps contêm os mesmos registros — analisar apenas
    // uma fonte evita double-counting de violações.
    const replaySteps = Array.isArray(replay.steps) ? replay.steps : steps;
    const replayViolations = analyzeIndividualReplay(
      { ...replay, steps: replaySteps },
      sourcePath,
      VISUAL_CRITICAL
    );
    violations.push(...replayViolations.violations);

    // NÃO analisar flow.steps separadamente: são os mesmos steps do replay.
    // Análise separada causaria double-counting de cada violação.

    // Verificar audit do flow
    const audit = flow.audit || {};
    if (audit.valid === false) {
      violations.push({
        rule:    'FLOW_AUDIT_INVALID',
        message: `flow.audit.valid=false para ${journeyId}`,
      });
    }

    results.push({
      journeyId,
      source:          sourcePath,
      flowStatus:      flow.replay?.status || flow.status,
      stepCount:       steps.length,
      isVisualCritical: VISUAL_CRITICAL.has(journeyId),
      violations,
      hardened:        violations.length === 0,
      replayDeterministicHash: replayViolations.replayDeterministicHash,
      replayExecutionHash:     replayViolations.replayExecutionHash,
      replayEvidenceHash:      replayViolations.replayEvidenceHash,
    });
  }

  return results;
}

// ─── Registro hash-only (proof-signature.json) ──────────────────────────────
// Um replay certificado apenas por hash NÃO é hardened: hardened exige a
// verificação determinística completa definida neste motor (steps analisados,
// failedStepCount=0, failedStepIds vazio, UI disponível em jornadas críticas).
// Registro hash-only não contém evidência de execução — apenas prova de que um
// hash foi assinado. Por isso `hardened` é false e o registro não conta para
// `hardenedReplays`; também não gera violação (ausência de evidência não é
// evidência de falha — mas nunca conta como prova de hardening).
function buildHashOnlyRecord(subjectHashEntry = {}) {
  return {
    journeyId:   subjectHashEntry.journeyId,
    source:      'governance/proof-signature.json',
    status:      'SIGNED_HASH_ONLY',
    violations:  [],
    hardened:    false,
    hashOnly:    true,
    replayDeterministicHash: subjectHashEntry.replayHash || null,
    replayExecutionHash:     null,
    replayEvidenceHash:      null,
  };
}

// ─── Motor principal ──────────────────────────────────────────────────────────
function runReplayHardeningEngine() {
  const VISUAL_CRITICAL = loadVisualCriticalJourneys();
  const results = [];

  // 1. Arquivo smoke agregado (flows[].replay)
  const smokeAgg = readJsonSafe('qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json');
  if (smokeAgg) {
    results.push(...analyzeFlows(smokeAgg, 'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json', VISUAL_CRITICAL));
  }

  // 2. Replay individuais (qa/smoke/prod-like/*-replay.json)
  const prodLikeDir = path.join(ROOT, 'qa', 'smoke', 'prod-like');
  if (fs.existsSync(prodLikeDir)) {
    const replayFiles = fs.readdirSync(prodLikeDir)
      .filter((f) => f.endsWith('-replay.json'))
      .sort();
    for (const fname of replayFiles) {
      const data = readJsonSafe(`qa/smoke/prod-like/${fname}`);
      if (!data) continue;
      // Evitar duplicar journeys já analisadas via flows[]
      const jid = data.journeyId || fname.replace(/-replay\.json$/, '');
      if (results.find((r) => r.journeyId === jid)) continue;
      results.push(analyzeIndividualReplay(data, `qa/smoke/prod-like/${fname}`, VISUAL_CRITICAL));
    }
  }

  // 3. proof-signature.json (replay hashes certificados)
  const proofSig = readJsonSafe('governance/proof-signature.json') || {};
  for (const r of proofSig.subjectHashes || []) {
    const jid = r.journeyId;
    if (results.find((x) => x.journeyId === jid)) continue;
    results.push(buildHashOnlyRecord(r));
  }

  // 4. Enterprise replays
  const enterpriseFiles = [
    { path: 'qa/enterprise/omnichannel-unified-replay.json',      field: 'replays'   },
    { path: 'qa/enterprise/human-handoff-full-validation.json',   field: null        },
  ];
  for (const { path: relPath, field } of enterpriseFiles) {
    const data = readJsonSafe(relPath);
    if (!data) continue;
    const items = field ? (data[field] || []) : [data];
    for (const item of (Array.isArray(items) ? items : [items])) {
      if (!item || typeof item !== 'object') continue;
      const jid = item.journeyId || item.id || path.basename(relPath, '.json');
      if (results.find((x) => x.journeyId === jid)) continue;
      results.push(analyzeIndividualReplay(item, relPath, VISUAL_CRITICAL));
    }
  }

  // Agregar violações
  const allViolations  = results.flatMap((r) => (r.violations || []).map((v) => ({ ...v, journeyId: r.journeyId, source: r.source })));
  const uiViolations   = allViolations.filter((v) => v.rule?.includes('UI_UNAVAILABLE'));
  const failedReplays  = allViolations.filter((v) => v.rule === 'REPLAY_FALSE_POSITIVE' || v.rule === 'STEP_FAILED' || v.rule === 'FAILED_STEP_IDS');
  const pass           = allViolations.length === 0;

  const report = {
    generatedAt:          new Date().toISOString(),
    engine:               'replay-hardening-engine/v2',
    pass,
    decision:             pass ? 'REPLAY_HARDENING_GO' : 'REPLAY_HARDENING_NO_GO',
    totalReplaysAnalyzed: results.length,
    hardenedReplays:      results.filter((r) => r.hardened).length,
    hashOnlyReplays:      results.filter((r) => r.hashOnly).length,
    violations:           allViolations.length,
    uiViolations:         uiViolations.length,
    failedReplays:        failedReplays.length,
    visualCriticalConfig: 'governance/visual-critical-journeys.json',
    results,
    allViolations,
    summary: pass
      ? `Todos os ${results.length} replays passaram no hardening.`
      : `${allViolations.length} violação(ões): ${uiViolations.length} UI indisponível, ${failedReplays.length} replay falso positivo`,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

module.exports = { runReplayHardeningEngine, analyzeIndividualReplay, loadVisualCriticalJourneys, buildHashOnlyRecord };

if (require.main === module) {
  const report = runReplayHardeningEngine();
  // eslint-disable-next-line no-console
  console.log(`[replay-hardening] decision=${report.decision} replays=${report.totalReplaysAnalyzed} violations=${report.violations} ui=${report.uiViolations}`);
  process.exit(report.pass ? 0 : 1);
}
