'use strict';

const fs = require('fs');
const path = require('path');
const { getAllReplayReadDirs } = require('../../../../lib/rpaPathResolver');

const CAPABILITY_HINTS = [
  { id: 'support_ticket_flow', tags: ['/support', 'ticket'] },
  { id: 'support_ticket_reply', tags: ['ticket-reply-input', 'ticket-send-button', 'mensagem'] },
  { id: 'turnstile_release', tags: ['turnstile', 'catraca', 'access-release'] },
  { id: 'customer_identification', tags: ['face', 'rfid', 'identification'] },
  { id: 'attendance_record', tags: ['attendance', 'checkin', 'presenca'] },
  { id: 'crm_update', tags: ['crm', 'contact', 'lead'] },
  { id: 'billing_validation', tags: ['billing', 'payment', 'charge', 'membership'] },
  { id: 'omnichannel_pbx', tags: ['qa-pbx', 'pbx', 'voip', 'call-events', 'tts-asr'] },
  { id: 'omnichannel_whatsapp', tags: ['whatsapp', 'delivery', 'message'] },
  { id: 'omnichannel_email', tags: ['omnichannel_email', 'email provider check', 'smtp'] },
  { id: 'omnichannel_webchat', tags: ['qa-chatpro-omnichannel-smoke', 'chatpro_omnichannel', 'inbox-smoke'] },
  // Capabilities exigidas pelos contratos de jornada de negocio
  // (config/journey-contracts.json, gerado por generate-business-contracts.js).
  // Tags ancoradas no conteudo real dos replays prod-like
  // (qa/smoke/prod-like/*-replay.json: LeadsPage, OnboardingPage, schedule etc.).
  { id: 'scheduling', tags: ['booking', 'schedule', 'agenda'] },
  { id: 'payment', tags: ['payment', 'charge'] },
  { id: 'crm_updates', tags: ['crm', 'contact'] },
  { id: 'notifications', tags: ['notification', 'welcome_sent'] },
  { id: 'lead_capture', tags: ['lead', 'capture'] },
  { id: 'onboarding', tags: ['onboarding', 'onboard'] },
];

const JOURNEY_CAPABILITY_MAP = {
  support_ticket_flow: ['support_ticket_flow', 'support_ticket_reply', 'omnichannel_whatsapp', 'crm_update'],
  fitness_customer_checkin: ['customer_identification', 'membership_validation', 'access_decision', 'turnstile_release', 'attendance_record', 'crm_update'],
  payment_charge_flow: ['billing_validation', 'payment', 'notifications'],
  booking_flow: ['scheduling', 'notifications', 'crm_updates'],
  // O smoke de email dispara uma notificacao real via notificationService.dispatchNotification.
  omnichannel_email: ['omnichannel_email', 'notifications'],
};

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function scoreText(text, tags) {
  const normalized = String(text || '').toLowerCase();
  let score = 0;
  for (const tag of tags) {
    if (normalized.includes(String(tag).toLowerCase())) score += 1;
  }
  return score;
}

function collectReplayFiles(options = {}) {
  let dirs = [];
  if (Array.isArray(options.replayDirs) && options.replayDirs.length > 0) {
    // Injecao explicita de diretorios (testes hermeticos).
    dirs = options.replayDirs.slice();
  } else {
    try {
      dirs = getAllReplayReadDirs();
    } catch (_) {
      const rootDir = path.join(__dirname, '..', '..', '..', '..');
      dirs = [
        path.join(rootDir, 'rpa', 'replay'),
        path.join(rootDir, 'qa-mesh', 'meshEvidence'),
        path.join(rootDir, 'qa-mesh', 'meshHistory'),
        path.join(rootDir, 'replays'),
      ];
    }
    dirs = dirs.concat(path.join(__dirname, '..', '..', '..', '..', 'qa', 'smoke', 'prod-like'));
  }
  dirs = dirs.filter((dir) => fs.existsSync(dir));
  const files = [];
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

function analyzeReplayOperationality(payload) {
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  const screenshots = Array.isArray(payload?.screenshots) ? payload.screenshots : [];
  const timeline = Array.isArray(payload?.timeline) ? payload.timeline : [];
  const logs = Array.isArray(payload?.logs) ? payload.logs : [];
  const tracePath = payload?.browserSession?.tracePath || payload?.tracePath || null;
  const evidenceLog = logs.find((entry) => /evidence=\S+/i.test(String(entry?.message || '')));
  const evidencePathMatch = String(evidenceLog?.message || '').match(/evidence=(\S+)/i);
  const evidencePath = evidencePathMatch?.[1] || payload?.evidencePath || null;
  const hasEvidenceArtifact = Boolean(evidencePath && fs.existsSync(evidencePath));
  const hasStructuredProof = Boolean(
    payload?.proofChain
    || payload?.stepExecutionProof
    || steps.some((step) => step?.proofChain || step?.stepExecutionProof)
    || hasEvidenceArtifact
  );

  const hasScreenshots = screenshots.length > 0 || steps.some((step) => (
    step?.screenshot
    || step?.screenshotPath
    || step?.screenshotBefore
    || step?.screenshotAfter
  )) || hasEvidenceArtifact;
  const hasUiSteps = steps.length > 0;
  const hasTimeline = timeline.length > 0;
  const hasLogs = logs.length > 0;
  const hasTrace = !!tracePath || hasStructuredProof;

  return {
    hasScreenshots,
    hasUiSteps,
    hasTimeline,
    hasLogs,
    hasTrace,
    operationalEvidence: (hasUiSteps && hasScreenshots) || hasEvidenceArtifact,
  };
}

function collectReplayCandidates(filePath, payload) {
  if (Array.isArray(payload?.flows) && payload.flows.length > 0) {
    return payload.flows
      .map((flow) => {
        const replay = flow?.replay;
        if (!replay || typeof replay !== 'object') return null;
        return {
          filePath,
          payload: {
            ...replay,
            journeyId: replay.journeyId || flow.journeyId || null,
            waveId: replay.waveId || payload.waveId || null,
            finishedAt: replay.finishedAt || replay.generatedAt || payload.generatedAt || null,
          },
        };
      })
      .filter(Boolean);
  }

  return [{ filePath, payload }];
}

function scan(options = {}) {
  const replayFiles = collectReplayFiles(options);
  const inferred = new Map();
  const replayStatusByCapability = new Map();
  const replayFreshnessDays = Number(options.replayFreshnessDays || 7);
  const freshnessMs = replayFreshnessDays > 0 ? replayFreshnessDays * 24 * 60 * 60 * 1000 : 0;

  for (const filePath of replayFiles) {
    const rootPayload = readJsonSafe(filePath);
    if (!rootPayload) continue;

    for (const candidate of collectReplayCandidates(filePath, rootPayload)) {
      const payload = candidate.payload;
      const textBlob = JSON.stringify({
        scenarioId: payload.scenarioId,
        recordingId: payload.recordingId,
        logs: payload.logs,
        steps: payload.steps,
        semanticSteps: payload.semanticSteps,
        journeyId: payload.journeyId,
        waveId: payload.waveId,
      }).toLowerCase();

      const evidence = analyzeReplayOperationality(payload);
      const finishedAt = payload?.finishedAt || payload?.endTime || payload?.generatedAt || null;
      const finishedMs = finishedAt ? new Date(finishedAt).getTime() : 0;
      // Replay sem timestamp confiavel nao conta como fresco: sem data fim,
      // nao ha como provar que a evidencia pertence a versao atual do sistema.
      const hasFreshReplay = freshnessMs > 0
        ? (finishedMs > 0 && (Date.now() - finishedMs) <= freshnessMs)
        : true;
      const matchedCapabilities = new Set(JOURNEY_CAPABILITY_MAP[payload?.journeyId] || []);

      for (const hint of CAPABILITY_HINTS) {
        const score = scoreText(textBlob, hint.tags);
        if (score >= 2) {
          matchedCapabilities.add(hint.id);
          const rec = inferred.get(hint.id) || { score: 0, evidence: [] };
          rec.score += score;
          rec.evidence.push(path.basename(filePath));
          inferred.set(hint.id, rec);
        }
      }

      for (const capabilityId of matchedCapabilities) {
        const coverage = replayStatusByCapability.get(capabilityId) || {
          replayed: false,
          hasScreenshots: false,
          hasTrace: false,
          operationalEvidence: false,
          replayCount: 0,
          latestFinishedAt: null,
          hasFreshReplay: false,
        };
        coverage.replayed = true;
        coverage.hasScreenshots = coverage.hasScreenshots || evidence.hasScreenshots;
        coverage.hasTrace = coverage.hasTrace || evidence.hasTrace;
        coverage.operationalEvidence = coverage.operationalEvidence || evidence.operationalEvidence;
        coverage.replayCount += 1;
        if (!coverage.latestFinishedAt || (finishedMs > 0 && finishedMs > new Date(coverage.latestFinishedAt).getTime())) {
          coverage.latestFinishedAt = finishedAt || coverage.latestFinishedAt;
        }
        coverage.hasFreshReplay = coverage.hasFreshReplay || hasFreshReplay;
        replayStatusByCapability.set(capabilityId, coverage);
      }
    }
  }

  return {
    kind: 'replay',
    replayFiles: replayFiles.length,
    replayFreshnessDays,
    inferredCapabilities: Array.from(inferred.entries()).map(([id, value]) => ({
      id,
      source: 'replay',
      confidence: Math.min(1, value.score / 10),
      evidence: Array.from(new Set(value.evidence)).slice(0, 10),
    })),
    replayStatusByCapability: Object.fromEntries(Array.from(replayStatusByCapability.entries())),
  };
}

module.exports = {
  scan,
};
