#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function usage() {
  console.error('Uso: node scripts/compact-proof-artifact.js <input.json> <output.json>');
}

function sha256(value) {
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function summarizeLargeString(label, value, previewLength = 512, suffixLength = 128) {
  const text = String(value || '');
  return {
    compacted: true,
    label,
    sizeBytes: Buffer.byteLength(text, 'utf8'),
    sha256: sha256(text),
    preview: text.slice(0, previewLength),
    suffix: text.length > suffixLength ? text.slice(-suffixLength) : '',
  };
}

function summarizeArrayItems(items, pathLabel) {
  const head = items.slice(0, 5).map((item) => sanitizeSmall(item, `${pathLabel}[head]`));
  const tail = items.slice(-2).map((item) => sanitizeSmall(item, `${pathLabel}[tail]`));
  return {
    compacted: true,
    label: pathLabel,
    itemCount: items.length,
    sha256: sha256(items),
    head,
    tail,
  };
}

function sanitizeSmall(value, pathLabel = 'value') {
  if (Array.isArray(value)) {
    if (value.length <= 12) {
      return value.map((item, index) => sanitizeSmall(item, `${pathLabel}[${index}]`));
    }
    return summarizeArrayItems(value, pathLabel);
  }

  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = sanitizeSmall(child, `${pathLabel}.${key}`);
    }
    return out;
  }

  if (typeof value === 'string' && value.length > 4096) {
    return summarizeLargeString(pathLabel, value);
  }

  return value;
}

function summarizeStep(step, index) {
  const stepId = step?.id || step?.stepId || step?.name || step?.title || `step-${index + 1}`;
  return {
    id: stepId,
    type: step?.type || step?.kind || step?.action || null,
    status: step?.status || step?.result || step?.outcome || null,
    assertionStatus: step?.assertion?.status || step?.assertionStatus || null,
    url: step?.url || step?.request?.url || step?.targetUrl || null,
    startedAt: step?.startedAt || step?.startedAtIso || null,
    finishedAt: step?.finishedAt || step?.completedAt || null,
    durationMs: step?.durationMs || step?.elapsedMs || null,
    evidenceKeys: step && typeof step === 'object' ? Object.keys(step).sort() : [],
  };
}

function summarizeReplay(replay) {
  if (!replay || typeof replay !== 'object') {
    return replay || null;
  }

  const steps = Array.isArray(replay.steps) ? replay.steps : [];
  const stepSummaries = steps.map(summarizeStep);
  const failedSteps = stepSummaries.filter((step) => {
    const status = String(step.status || step.assertionStatus || '').toLowerCase();
    return status && !['ok', 'pass', 'passed', 'success', 'succeeded'].includes(status);
  });

  return {
    compacted: true,
    sha256: sha256(replay),
    keys: Object.keys(replay).sort(),
    startedAt: replay.startedAt || replay.startedAtIso || null,
    finishedAt: replay.finishedAt || replay.completedAt || null,
    durationMs: replay.durationMs || replay.elapsedMs || null,
    status: replay.status || replay.result || null,
    stepCount: steps.length,
    failedStepCount: failedSteps.length,
    failedStepIds: failedSteps.map((step) => step.id),
    steps: stepSummaries,
  };
}

function summarizeGovernance(governance) {
  if (!governance || typeof governance !== 'object') {
    return governance || null;
  }

  return {
    compacted: true,
    sha256: sha256(governance),
    keys: Object.keys(governance).sort(),
    status: governance.status || governance.decision || null,
    confidence: governance.operationalConfidence || governance.confidence || null,
    blockers: Array.isArray(governance.blockers) ? governance.blockers.slice(0, 20) : [],
    deploymentSafety: sanitizeSmall(governance.deploymentSafety || null, 'governance.deploymentSafety'),
    lastSmokeExecution: sanitizeSmall(governance.lastSmokeExecution || null, 'governance.lastSmokeExecution'),
    evidencePath: governance.evidencePath || null,
    replayChecksum: governance.replayChecksum || governance.replayHash || null,
  };
}

function compactFlow(flow) {
  const compacted = {};
  for (const [key, value] of Object.entries(flow || {})) {
    if (key === 'replay') {
      compacted.replaySummary = summarizeReplay(value);
      continue;
    }
    if (key === 'governance') {
      compacted.governanceSummary = summarizeGovernance(value);
      continue;
    }
    compacted[key] = sanitizeSmall(value, `flow.${key}`);
  }

  compacted._artifactFlowHashes = {
    flowSha256: sha256(flow || {}),
    replaySha256: flow?.replay ? sha256(flow.replay) : null,
    governanceSha256: flow?.governance ? sha256(flow.governance) : null,
  };

  return compacted;
}

function compactProdLikeSmoke(report, sourcePath) {
  const compacted = {
    generatedAt: report?.generatedAt || null,
    status: report?.status || null,
    environment: sanitizeSmall(report?.environment || {}, 'environment'),
    cleanupResults: sanitizeSmall(report?.cleanupResults || [], 'cleanupResults'),
    productionReadiness: sanitizeSmall(report?.productionReadiness || {}, 'productionReadiness'),
    flows: Array.isArray(report?.flows) ? report.flows.map(compactFlow) : [],
    _artifactPackaging: {
      compacted: true,
      artifactType: 'qa-waves-operational-prod-like-smoke',
      compactedAt: new Date().toISOString(),
      sourcePath,
      sourceSizeBytes: fs.statSync(sourcePath).size,
      sourceSha256: sha256(fs.readFileSync(sourcePath, 'utf8')),
      strategy: 'summarized-replay-and-governance',
    },
  };

  return compacted;
}

function main() {
  const [, , inputPathArg, outputPathArg] = process.argv;
  if (!inputPathArg || !outputPathArg) {
    usage();
    process.exit(1);
  }

  const inputPath = path.resolve(process.cwd(), inputPathArg);
  const outputPath = path.resolve(process.cwd(), outputPathArg);
  const report = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const compacted = compactProdLikeSmoke(report, inputPath);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(compacted, null, 2)}\n`, 'utf8');
}

main();