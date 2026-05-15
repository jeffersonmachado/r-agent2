'use strict';

/**
 * Replay Parser — parser canônico compartilhado por TODOS os engines de replay.
 *
 * Suporta todos os formatos de artefato de replay:
 *   1. flows[].replay        — smoke agregado (campo "replay" dentro do flow)
 *   2. flows[].replaySummary — campo alternativo ao replay
 *   3. Replay individuais    — arquivos *-replay.json
 *   4. Enterprise replays    — qa/enterprise/*.json
 *
 * REGRA: qualquer engine que analise replay DEVE usar este módulo.
 * Nenhum engine pode ter parser próprio.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

function sha256(data) {
  return crypto.createHash('sha256')
    .update(typeof data === 'string' ? data : JSON.stringify(data))
    .digest('hex');
}

function readJsonSafe(absPath) {
  if (!fs.existsSync(absPath)) return null;
  try { return JSON.parse(fs.readFileSync(absPath, 'utf8')); } catch (_) { return null; }
}

// ─── Normalização de um replay/flow individual ────────────────────────────────
// Suporta tanto flow.replay quanto flow.replaySummary, além de replays diretos.
function normalizeReplay(obj, source) {
  if (!obj || typeof obj !== 'object') return null;

  // Extrair o bloco de resumo: prioridade replaySummary > replay > próprio obj
  const summary = obj.replaySummary || obj.replay || obj;

  const journeyId = obj.journeyId || summary.journeyId || source;

  // Status: replaySummary.status → replay.status → obj.status
  const status = summary.status || obj.status || null;

  // failedStepCount: preferir summary, depois obj raiz
  const failedStepCount = summary.failedStepCount ?? obj.failedStepCount ?? 0;

  // failedStepIds: preferir summary, depois obj raiz
  const failedStepIds = summary.failedStepIds || obj.failedStepIds || [];

  // Steps: preferir summary.steps, depois obj.steps (flow-level)
  const steps = Array.isArray(summary.steps) ? summary.steps
    : Array.isArray(obj.steps) ? obj.steps : [];

  // Screenshots
  const screenshots = summary.screenshots || obj.screenshots || [];

  // Snapshots raiz
  const beforeSnapshot = obj.beforeSnapshot || summary.beforeSnapshot || null;
  const afterSnapshot  = obj.afterSnapshot  || summary.afterSnapshot  || null;

  // Audit
  const audit = obj.audit || summary.audit || null;

  // Hashes determinísticos — usados para imutabilidade entre engines
  const stepSignatures = steps.map((s) => ({
    id:         s.id || s.stepId || '?',
    status:     s.status,
    actionType: s.actionType || null,
  }));

  return {
    journeyId,
    source,
    status,
    failedStepCount,
    failedStepIds,
    steps,
    stepCount:      steps.length,
    screenshots,
    beforeSnapshot,
    afterSnapshot,
    audit,
    replayDeterministicHash: sha256({ journeyId, steps: stepSignatures }),
    replayExecutionHash:     sha256({ journeyId, status, failedStepCount }),
    replayEvidenceHash:      sha256({ journeyId, screenshots: screenshots.length }),
  };
}

// ─── Normalização de flows[] do smoke agregado ────────────────────────────────
function normalizeFlows(smokeData, sourcePath) {
  const flows = Array.isArray(smokeData.flows) ? smokeData.flows : [];
  return flows.map((flow) => normalizeReplay(flow, sourcePath));
}

// ─── Carregamento de todos os replays do repositório ─────────────────────────
function loadAllReplays(ROOT) {
  const replays = [];
  const seen    = new Set();

  // 1. Smoke agregado (flows[].replay ou flows[].replaySummary)
  const smokePath = path.join(ROOT, 'qa', 'smoke', 'prod-like', 'qa-waves-operational-prod-like-smoke.json');
  const smokeData = readJsonSafe(smokePath);
  if (smokeData) {
    for (const r of normalizeFlows(smokeData, 'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json')) {
      if (r) { replays.push(r); seen.add(r.journeyId); }
    }
  }

  // 2. Replay individuais (*-replay.json)
  const prodLikeDir = path.join(ROOT, 'qa', 'smoke', 'prod-like');
  if (fs.existsSync(prodLikeDir)) {
    for (const fname of fs.readdirSync(prodLikeDir).filter((f) => f.endsWith('-replay.json')).sort()) {
      const data = readJsonSafe(path.join(prodLikeDir, fname));
      if (!data) continue;
      const jid = data.journeyId || fname.replace(/-replay\.json$/, '');
      if (seen.has(jid)) continue;
      const r = normalizeReplay(data, `qa/smoke/prod-like/${fname}`);
      if (r) { replays.push(r); seen.add(r.journeyId); }
    }
  }

  // 3. Enterprise replays
  const enterpriseDir = path.join(ROOT, 'qa', 'enterprise');
  if (fs.existsSync(enterpriseDir)) {
    for (const fname of fs.readdirSync(enterpriseDir).filter((f) => f.endsWith('.json')).sort()) {
      const data = readJsonSafe(path.join(enterpriseDir, fname));
      if (!data) continue;
      // Suporta arquivo com lista de replays (campo "replays")
      const items = Array.isArray(data.replays) ? data.replays : [data];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const jid = item.journeyId || item.id || fname.replace(/\.json$/, '');
        if (seen.has(jid)) continue;
        const r = normalizeReplay(item, `qa/enterprise/${fname}`);
        if (r) { replays.push(r); seen.add(r.journeyId); }
      }
    }
  }

  return replays;
}

module.exports = { normalizeReplay, normalizeFlows, loadAllReplays, sha256 };
