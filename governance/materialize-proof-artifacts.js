'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { resolveEvidenceCandidates, resolveWorkspacePath } = require('../tools/system/lib/runtime-paths');

const ROOT = path.join(__dirname, '..');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = stable(value[key]);
    return acc;
  }, {});
}

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex');
}

function readJsonFromCandidates(relativePath, explicitEnvVar = null) {
  const candidates = resolveEvidenceCandidates(ROOT, relativePath, explicitEnvVar, process.env);
  for (const candidate of candidates) {
    try {
      return JSON.parse(fs.readFileSync(candidate, 'utf8'));
    } catch (_) {}
  }
  return null;
}

function writeJson(relativePath, payload) {
  const absPath = resolveWorkspacePath(ROOT, relativePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return absPath;
}

function walkProofSteps(node, visitor, context = {}) {
  if (Array.isArray(node)) {
    node.forEach((item) => walkProofSteps(item, visitor, context));
    return;
  }
  if (!node || typeof node !== 'object') {
    return;
  }

  const nextContext = {
    journeyId: node.journeyId || context.journeyId || null,
    flowId: node.id || context.flowId || null,
  };

  if (
    Object.prototype.hasOwnProperty.call(node, 'screenshotBefore')
    || Object.prototype.hasOwnProperty.call(node, 'screenshotAfter')
    || Object.prototype.hasOwnProperty.call(node, 'beforeStepSnapshot')
    || Object.prototype.hasOwnProperty.call(node, 'afterStepSnapshot')
    || Object.prototype.hasOwnProperty.call(node, 'snapshotDiff')
    || Object.prototype.hasOwnProperty.call(node, 'observedSideEffects')
  ) {
    visitor(node, nextContext);
  }

  Object.values(node).forEach((value) => walkProofSteps(value, visitor, nextContext));
}

function buildPbxArtifacts(l03Evidence) {
  if (!l03Evidence?.voiceTranscript || !Array.isArray(l03Evidence?.ttsPrompts) || !Array.isArray(l03Evidence?.recordings)) {
    return [];
  }

  return [
    writeJson('qa/enterprise/pbx-asr-transcript.json', {
      generatedAt: new Date().toISOString(),
      sourceArtifact: 'qa/l03-pbx-voice-tts-asr-evidence.json',
      callId: l03Evidence.callId,
      flowId: l03Evidence.flowId,
      transcript: l03Evidence.voiceTranscript.fullTranscript,
      segments: l03Evidence.voiceTranscript.segments,
      hash: sha256(l03Evidence.voiceTranscript),
    }),
    writeJson('qa/enterprise/pbx-tts-prompts.json', {
      generatedAt: new Date().toISOString(),
      sourceArtifact: 'qa/l03-pbx-voice-tts-asr-evidence.json',
      callId: l03Evidence.callId,
      flowId: l03Evidence.flowId,
      prompts: l03Evidence.ttsPrompts,
      hash: sha256(l03Evidence.ttsPrompts),
    }),
    writeJson('qa/enterprise/pbx-recordings-metadata.json', {
      generatedAt: new Date().toISOString(),
      sourceArtifact: 'qa/l03-pbx-voice-tts-asr-evidence.json',
      callId: l03Evidence.callId,
      flowId: l03Evidence.flowId,
      recordings: l03Evidence.recordings,
      hash: sha256(l03Evidence.recordings),
    }),
  ];
}

function buildScreenshotArtifacts(finalSmoke) {
  const screenshots = [];
  walkProofSteps(finalSmoke, (step, context) => {
    ['Before', 'After'].forEach((phase) => {
      const field = `screenshot${phase}`;
      if (typeof step[field] === 'string' && step[field].startsWith('data:image/')) {
        screenshots.push({
          journeyId: context.journeyId,
          stepId: step.id || step.stepId || null,
          phase: phase.toLowerCase(),
          mimeType: step[field].slice(5, step[field].indexOf(';')),
          dataUrl: step[field],
          hash: sha256(step[field]),
        });
      }
    });
  });

  if (screenshots.length === 0) {
    return [];
  }

  return [
    writeJson('qa/enterprise/human-handoff-screenshots.json', {
      generatedAt: new Date().toISOString(),
      sourceArtifact: 'qa/smoke/qa-waves-operational-final-smoke.json',
      sourceJourneyIds: Array.from(new Set(screenshots.map((item) => item.journeyId).filter(Boolean))),
      files: screenshots,
    }),
  ];
}

function buildDigitalTwinSnapshots(finalSmoke) {
  const snapshots = [];
  const seen = new Set();
  // Observações acumuladas por jornada, na ordem de execução dos steps.
  // Steps de asserção (assert_*) declaram expectedMutations CUMULATIVAS da
  // jornada no snapshotDiff; o proof engine compara contra observedMutations
  // do diff, então o twin materializado reflete o que a jornada observou até
  // aquele ponto — preenchido a partir das observações reais dos steps
  // anteriores, nunca inventado.
  const cumulativeByJourney = new Map();

  walkProofSteps(finalSmoke, (step, context) => {
    const journeyId = context.journeyId || 'unknown';
    if (!cumulativeByJourney.has(journeyId)) {
      cumulativeByJourney.set(journeyId, { mutations: new Set(), sideEffects: new Set() });
    }
    const cumulative = cumulativeByJourney.get(journeyId);

    let diff = step.snapshotDiff || null;
    if (diff && typeof diff === 'object' && !Array.isArray(diff)
      && Array.isArray(diff.expectedMutations) && diff.expectedMutations.length > 0
      && !Array.isArray(diff.observedMutations)) {
      diff = {
        ...diff,
        observedMutations: Array.from(cumulative.mutations),
        observedSideEffects: Array.from(cumulative.sideEffects),
        cumulativeObservation: true,
      };
    }

    // Acumula as observações do próprio step DEPOIS de materializar seu diff:
    // um step só prova expectativas cumulativas com o que veio antes dele.
    for (const mutation of (Array.isArray(step.observedMutations) ? step.observedMutations : [])) {
      cumulative.mutations.add(mutation);
    }
    for (const sideEffect of (Array.isArray(step.observedSideEffects) ? step.observedSideEffects : [])) {
      cumulative.sideEffects.add(sideEffect);
    }

    if (step.beforeStepSnapshot || step.afterStepSnapshot || diff) {
      const stepId = step.id || step.stepId || null;
      const hash = sha256({
        before: step.beforeStepSnapshot || null,
        after: step.afterStepSnapshot || null,
        diff,
      });
      // O smoke replica cada step em browserResult/stepResults/postState/replay —
      // o twin guarda uma única entrada por (jornada, step, conteúdo).
      const dedupeKey = `${journeyId}:${stepId}:${hash}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      snapshots.push({
        journeyId: context.journeyId,
        stepId,
        before: step.beforeStepSnapshot || null,
        after: step.afterStepSnapshot || null,
        diff,
        hash,
      });
    }
  });

  if (snapshots.length === 0) {
    return [];
  }

  return snapshots;
}

function buildDigitalTwinArtifacts(finalSmoke) {
  const snapshots = buildDigitalTwinSnapshots(finalSmoke);
  if (snapshots.length === 0) {
    return [];
  }

  return [
    writeJson('qa/enterprise/digital-twin-snapshots.json', {
      generatedAt: new Date().toISOString(),
      sourceArtifact: 'qa/smoke/qa-waves-operational-final-smoke.json',
      snapshots,
    }),
  ];
}

function buildCrmMutationArtifacts(finalSmoke) {
  const mutations = [];
  walkProofSteps(finalSmoke, (step, context) => {
    const observedSideEffects = Array.isArray(step.observedSideEffects) ? step.observedSideEffects : [];
    const linkageEffects = Array.isArray(step.sideEffectLinkage?.observedSideEffects) ? step.sideEffectLinkage.observedSideEffects : [];
    const allEffects = Array.from(new Set(observedSideEffects.concat(linkageEffects)));
    const hasCrmMutation = allEffects.includes('crm_updated')
      || (Array.isArray(step.snapshotDiff?.details) && step.snapshotDiff.details.some((detail) => String(detail.field || '').startsWith('crm.')));
    if (!hasCrmMutation) {
      return;
    }

    mutations.push({
      journeyId: context.journeyId,
      stepId: step.id || step.stepId || null,
      observedSideEffects: allEffects,
      snapshotDiff: step.snapshotDiff || null,
      beforeSnapshot: step.beforeStepSnapshot || null,
      afterSnapshot: step.afterStepSnapshot || null,
      hash: sha256({
        observedSideEffects: allEffects,
        snapshotDiff: step.snapshotDiff || null,
        beforeSnapshot: step.beforeStepSnapshot || null,
        afterSnapshot: step.afterStepSnapshot || null,
      }),
    });
  });

  if (mutations.length === 0) {
    return [];
  }

  return [
    writeJson('qa/enterprise/omnichannel-crm-mutations.json', {
      generatedAt: new Date().toISOString(),
      sourceArtifact: 'qa/smoke/qa-waves-operational-final-smoke.json',
      mutations,
    }),
  ];
}

function buildGovernanceArtifacts(governanceReport) {
  if (!governanceReport?.enterpriseGovernanceSignature) {
    return [];
  }

  return [
    writeJson('governance/proof-signature.json', {
      generatedAt: new Date().toISOString(),
      sourceArtifact: 'qa/qa-waves-enterprise-governance.json',
      signature: governanceReport.enterpriseGovernanceSignature,
      reportHash: governanceReport.reportHash || null,
      subjectHashes: (governanceReport.replayArtifacts || []).map((artifact) => ({
        journeyId: artifact.journeyId,
        replayHash: artifact.replayHash,
        replayChecksum: artifact.replayChecksum,
        governanceSignature: artifact.governanceSignature,
      })),
      signatureAudit: governanceReport.governanceSignature || null,
    }),
  ];
}

function buildCleanupProof() {
  let runtimeClean = false;
  let runtimeCheck = null;
  try {
    runtimeCheck = execFileSync('bash', ['./scripts/clean-runtime-state.sh'], {
      cwd: ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
      env: process.env,
    });
    runtimeClean = true;
  } catch (error) {
    runtimeClean = false;
    runtimeCheck = String(error.stderr || error.stdout || error.message || error);
  }

  const workspaceArtifacts = [
    'frontend-e2e/playwright-report',
    'frontend-e2e/test-results',
    'playwright-report',
    'test-results',
  ].filter((relativePath) => fs.existsSync(path.join(ROOT, relativePath)));

  return [
    writeJson('governance/cleanup-proof.json', {
      generatedAt: new Date().toISOString(),
      runtimeClean,
      workspaceClean: workspaceArtifacts.length === 0,
      runtimeCheck,
      workspaceArtifacts,
    }),
  ];
}

function main() {
  const l03Evidence = readJsonFromCandidates('qa/l03-pbx-voice-tts-asr-evidence.json', 'PBX_VOICE_TTS_ASR_EVIDENCE_PATH');
  const finalSmoke = readJsonFromCandidates('qa/smoke/qa-waves-operational-final-smoke.json');
  const governanceReport = readJsonFromCandidates('qa/qa-waves-enterprise-governance.json');

  const written = [];
  written.push(...buildPbxArtifacts(l03Evidence));
  written.push(...buildCrmMutationArtifacts(finalSmoke));
  written.push(...buildDigitalTwinArtifacts(finalSmoke));
  written.push(...buildScreenshotArtifacts(finalSmoke));
  written.push(...buildGovernanceArtifacts(governanceReport));
  written.push(...buildCleanupProof());

  writeJson('governance/materialized-proof-artifacts-report.json', {
    generatedAt: new Date().toISOString(),
    writtenArtifacts: written.map((filePath) => path.relative(ROOT, filePath).replace(/\\/g, '/')),
  });
  // eslint-disable-next-line no-console
  console.log(`[materialize-proof-artifacts] written=${written.length}`);
}

if (require.main === module) {
  main();
}

module.exports = { main, buildDigitalTwinArtifacts, buildDigitalTwinSnapshots };