'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveEvidenceCandidates, resolveWorkspacePath, getRuntimeRoot } = require('../../tools/system/lib/runtime-paths');
const { validatePackage } = require('../package-validator');

const ROOT = path.join(__dirname, '..', '..');
const STAGE_ORDER = [
  'foundation',
  'operational',
  'validated',
  'prod-like',
  'enterprise-partial',
  'enterprise-ready',
  'autonomous-ready',
];

const REQUIRED_ARTIFACT_SPECS = [
  { id: 'smoke_summary', path: 'qa/smoke-evidence.json', domain: 'foundation', packageRequired: true },
  { id: 'smoke_l01', path: 'qa/l01-physical-queue-evidence.json', domain: 'foundation', packageRequired: true },
  { id: 'smoke_l02', path: 'qa/l02-ura-publish-rollback-evidence.json', domain: 'foundation', packageRequired: true },
  { id: 'smoke_l03', path: 'qa/l03-pbx-voice-tts-asr-evidence.json', domain: 'foundation', packageRequired: true },
  { id: 'smoke_l04', path: 'qa/l04-pbx-call-events-runtime-evidence.json', domain: 'foundation', packageRequired: true },
  { id: 'smoke_l05', path: 'qa/l05-chatpro-omnichannel-evidence.json', domain: 'foundation', packageRequired: true },
  { id: 'prod_like_smoke', path: 'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json', domain: 'operational', packageRequired: true },
  { id: 'human_handoff', path: 'qa/enterprise/human-handoff-full-validation.json', domain: 'human_handoff', packageRequired: true, mirrorToWorkspace: true },
  { id: 'human_handoff_screenshots', path: 'qa/enterprise/human-handoff-screenshots.json', domain: 'human_handoff', packageRequired: true, mirrorToWorkspace: true },
  { id: 'pbx_prod_like', path: 'qa/enterprise/pbx-voice-flow-prod-like.json', domain: 'pbx', packageRequired: true, mirrorToWorkspace: true },
  { id: 'pbx_asr_transcript', path: 'qa/enterprise/pbx-asr-transcript.json', domain: 'pbx', packageRequired: true, mirrorToWorkspace: true },
  { id: 'pbx_tts_prompts', path: 'qa/enterprise/pbx-tts-prompts.json', domain: 'pbx', packageRequired: true, mirrorToWorkspace: true },
  { id: 'pbx_recordings_metadata', path: 'qa/enterprise/pbx-recordings-metadata.json', domain: 'pbx', packageRequired: true, mirrorToWorkspace: true },
  { id: 'omnichannel_replay', path: 'qa/enterprise/omnichannel-unified-replay.json', domain: 'omnichannel', packageRequired: true, mirrorToWorkspace: true },
  { id: 'omnichannel_crm_mutations', path: 'qa/enterprise/omnichannel-crm-mutations.json', domain: 'omnichannel', packageRequired: true, mirrorToWorkspace: true },
  { id: 'digital_twin_snapshots', path: 'qa/enterprise/digital-twin-snapshots.json', domain: 'digital_twin', packageRequired: true, mirrorToWorkspace: true },
  { id: 'qa_waves_governance', path: 'qa/qa-waves-enterprise-governance.json', domain: 'governance', packageRequired: true },
  { id: 'governance_signature', path: 'governance/proof-signature.json', domain: 'governance', packageRequired: true },
  { id: 'cleanup_proof', path: 'governance/cleanup-proof.json', domain: 'governance', packageRequired: true },
  { id: 'final_readiness', path: 'governance/final-readiness-report.json', domain: 'governance', packageRequired: true },
];

function getRuntimeRootSafe() {
  try {
    return getRuntimeRoot(ROOT, process.env);
  } catch (_) {
    return null;
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function readJsonMaybe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function synchronizeArtifact(sourcePath, targetPath) {
  if (!sourcePath || !targetPath || sourcePath === targetPath || fs.existsSync(targetPath)) {
    return targetPath || sourcePath;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
}

function resolveArtifact(spec) {
  const candidates = resolveEvidenceCandidates(ROOT, spec.path, null, process.env);
  const workspaceTarget = resolveWorkspacePath(ROOT, spec.path);
  let sourcePath = null;

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      sourcePath = candidate;
      break;
    }
  }

  let resolvedPath = sourcePath;
  if (sourcePath && spec.mirrorToWorkspace) {
    resolvedPath = synchronizeArtifact(sourcePath, workspaceTarget);
  }

  const stats = resolvedPath && fs.existsSync(resolvedPath) ? fs.statSync(resolvedPath) : null;
  const json = resolvedPath && resolvedPath.endsWith('.json') ? readJsonMaybe(resolvedPath) : null;

  return {
    id: spec.id,
    domain: spec.domain,
    path: spec.path,
    packageRequired: spec.packageRequired === true,
    sourcePath,
    resolvedPath,
    exists: Boolean(stats),
    size: stats ? stats.size : 0,
    timestamp: stats ? stats.mtime.toISOString() : null,
    sha256: stats ? sha256File(resolvedPath) : null,
    json,
  };
}

function walkFiles(startDir, collector = []) {
  if (!startDir || !fs.existsSync(startDir)) {
    return collector;
  }

  const entries = fs.readdirSync(startDir, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absPath, collector);
    } else {
      collector.push(absPath);
    }
  }

  return collector;
}

function findPhysicalMatches(patterns) {
  const runtimeRoot = getRuntimeRootSafe();
  const roots = [ROOT, runtimeRoot].filter(Boolean);
  const matches = [];

  for (const searchRoot of roots) {
    for (const filePath of walkFiles(path.join(searchRoot, 'qa'))) {
      const relPath = path.relative(searchRoot, filePath).replace(/\\/g, '/');
      if (patterns.some((pattern) => pattern.test(relPath))) {
        matches.push({ filePath, relPath });
      }
    }
  }

  return matches;
}

function findArtifactById(requiredArtifacts, id) {
  return requiredArtifacts.find((artifact) => artifact.id === id) || {
    id,
    path: null,
    exists: false,
    json: null,
  };
}

function hasArrayPayload(artifact, key) {
  return Boolean(Array.isArray(artifact?.json?.[key]) && artifact.json[key].length > 0);
}

function collectInvalidReferences(referencePaths = []) {
  return Array.from(new Set(referencePaths.filter(Boolean))).map((referencePath) => {
    const candidates = resolveEvidenceCandidates(ROOT, referencePath, null, process.env);
    const existing = candidates.find((candidate) => fs.existsSync(candidate)) || null;
    return {
      path: referencePath,
      exists: Boolean(existing),
      resolvedPath: existing,
    };
  }).filter((item) => !item.exists);
}

function evaluateHumanHandoff(artifact, screenshotArtifact) {
  const data = artifact.json || {};
  const signals = data.signals || {};
  const missing = [];
  const screenshots = Array.isArray(screenshotArtifact?.json?.files) ? screenshotArtifact.json.files : [];

  if (!artifact.exists) missing.push('human_handoff_artifact');
  if (!Array.isArray(data.replay) || data.replay.length === 0) missing.push('replay');
  if (!(Number(data.evidence?.timelineCount || 0) > 0)) missing.push('timeline');
  if (signals.ticketOwnershipObserved !== true) missing.push('ownership_transitions');
  if (signals.routingTransferObserved !== true || signals.stateTransitionsObserved !== true) missing.push('ticket_transitions');
  if (signals.slaObserved !== true) missing.push('sla_transitions');
  if (signals.backendMutationObserved !== true) missing.push('backend_mutations');
  if (!screenshotArtifact.exists) missing.push('screenshots');
  if (screenshotArtifact.exists && screenshots.length === 0) missing.push('screenshots_manifest');

  return {
    status: missing.length === 0 ? 'VALIDATED' : 'NOT_VALIDATED',
    artifact: artifact.path,
    screenshotArtifact: screenshotArtifact.path,
    missing,
    screenshots,
  };
}

function evaluatePbx(artifact, asrArtifact, ttsArtifact, recordingsArtifact) {
  const data = artifact.json || {};
  const l03 = data.sources?.l03 || {};
  const l04 = data.sources?.l04 || {};
  const missing = [];

  if (!artifact.exists) missing.push('pbx_prod_like_artifact');
  if (!Array.isArray(data.evidencePaths) || data.evidencePaths.length < 2) missing.push('call_replay');
  if (!l03.realCall?.cdrFound) missing.push('cdr');
  if (data.signals?.replayTimeline !== true || !l04.flow?.executionId) missing.push('ivr_timeline');
  if (!l03.runtime?.transferObserved) missing.push('queue_transitions');
  if (!asrArtifact.exists || !(asrArtifact.json?.transcript || asrArtifact.json?.text || hasArrayPayload(asrArtifact, 'segments'))) missing.push('asr_transcript');
  if (!ttsArtifact.exists || !hasArrayPayload(ttsArtifact, 'prompts')) missing.push('tts_prompts');
  if (!recordingsArtifact.exists || !hasArrayPayload(recordingsArtifact, 'recordings')) missing.push('recordings_metadata');

  return {
    status: missing.length === 0 ? 'VALIDATED' : 'NOT_VALIDATED',
    artifact: artifact.path,
    asrArtifact: asrArtifact.path,
    ttsArtifact: ttsArtifact.path,
    recordingsArtifact: recordingsArtifact.path,
    missing,
  };
}

function evaluateOmnichannel(artifact, crmArtifact) {
  const data = artifact.json || {};
  const replay = Array.isArray(data.replay) ? data.replay : [];
  const distinctSources = Array.from(new Set(replay.map((item) => item.source).filter(Boolean)));
  const hasWhatsAppEvents = replay.some((item) => item.kind === 'channel_message' || /whatsapp/i.test(String(item.text || '')));
  const hasTicketEvents = replay.some((item) => item.kind === 'ticket_message');
  const hasPbxEvents = replay.some((item) => item.source === 'pbx');
  const hasChatEvents = replay.some((item) => item.source === 'omnichannel' || /assign=|transfer=|note=/i.test(String(item.text || '')));
  const hasCrmMutations = crmArtifact.exists
    && hasArrayPayload(crmArtifact, 'mutations')
    && (replay.some((item) => /crm/i.test(String(item.text || ''))) || Number(crmArtifact.json?.mutations?.length || 0) > 0);
  const missing = [];

  if (!artifact.exists) missing.push('unified_replay_artifact');
  if (replay.length === 0) missing.push('replay');
  if (distinctSources.length < 3) missing.push('cross_channel_transitions');
  if (!hasWhatsAppEvents) missing.push('whatsapp_events');
  if (!hasChatEvents) missing.push('chat_events');
  if (!hasPbxEvents) missing.push('pbx_events');
  if (!hasTicketEvents) missing.push('ticket_events');
  if (!hasCrmMutations) missing.push('crm_mutations');

  return {
    status: !artifact.exists ? 'NOT_VALIDATED' : (missing.length === 0 ? 'VALIDATED' : 'PARTIAL'),
    artifact: artifact.path,
    crmArtifact: crmArtifact.path,
    missing,
    sourceCount: distinctSources.length,
  };
}

function evaluateDigitalTwin(context, snapshotsArtifact) {
  const replayPresent = context.omnichannel.status !== 'NOT_VALIDATED' || context.humanHandoff.status === 'VALIDATED' || context.pbx.status === 'VALIDATED';
  const timelinePresent = context.humanHandoff.missing.indexOf('timeline') === -1 || context.pbx.missing.indexOf('ivr_timeline') === -1;
  const assertionsPresent = context.humanHandoff.missing.indexOf('ticket_transitions') === -1 || context.omnichannel.missing.indexOf('ticket_events') === -1;
  const mutationsPresent = context.humanHandoff.missing.indexOf('backend_mutations') === -1 || context.omnichannel.missing.indexOf('crm_mutations') === -1;
  const evidencePresent = context.requiredArtifacts.filter((artifact) => artifact.domain === 'foundation').every((artifact) => artifact.exists);
  const snapshots = Array.isArray(snapshotsArtifact?.json?.snapshots) ? snapshotsArtifact.json.snapshots : [];
  const snapshotsPresent = snapshotsArtifact.exists && snapshots.length > 0;
  const missing = [];

  if (!replayPresent) missing.push('replay');
  if (!timelinePresent) missing.push('timeline');
  if (!assertionsPresent) missing.push('assertions');
  if (!mutationsPresent) missing.push('mutations');
  if (!evidencePresent) missing.push('evidence');
  if (!snapshotsPresent) missing.push('snapshots');

  return {
    status: missing.length === 0 ? 'VALIDATED' : (missing.length === 6 ? 'NOT_VALIDATED' : 'PARTIAL'),
    artifact: snapshotsArtifact.path,
    missing,
    snapshots,
  };
}

function evaluateGovernance(requiredArtifacts) {
  const signatureArtifact = findArtifactById(requiredArtifacts, 'governance_signature');
  const cleanupArtifact = findArtifactById(requiredArtifacts, 'cleanup_proof');
  const missing = [];

  if (!signatureArtifact.exists) {
    missing.push('governance_signature');
  } else {
    const signatureData = signatureArtifact.json || {};
    if (!signatureData.signature || !hasArrayPayload(signatureArtifact, 'subjectHashes')) {
      missing.push('governance_signature_payload');
    }
  }

  if (!cleanupArtifact.exists) {
    missing.push('cleanup_proof');
  } else {
    const cleanupData = cleanupArtifact.json || {};
    if (cleanupData.runtimeClean !== true || cleanupData.workspaceClean !== true) {
      missing.push('cleanup_status');
    }
  }

  return {
    status: missing.length === 0 ? 'VALIDATED' : 'NOT_VALIDATED',
    signatureArtifact: signatureArtifact.path,
    cleanupArtifact: cleanupArtifact.path,
    missing,
  };
}

function determineStage({ blockerCount, replayCoverage, prodLikeCoverage, omnichannel, pbx, humanHandoff, digitalTwin, governanceCoverage, foundationArtifacts }) {
  const foundationOk = foundationArtifacts.every((artifact) => artifact.exists);
  if (!foundationOk) return 'foundation';
  if (replayCoverage.percent === 0) return 'operational';
  if (pbx.status === 'NOT_VALIDATED' && humanHandoff.status === 'NOT_VALIDATED') return 'validated';
  if (prodLikeCoverage.percent < 100) return 'prod-like';
  if (omnichannel.status !== 'VALIDATED' || pbx.status !== 'VALIDATED' || humanHandoff.status !== 'VALIDATED') return 'enterprise-partial';
  if (digitalTwin.status !== 'VALIDATED' || governanceCoverage.status !== 'VALIDATED' || blockerCount > 0) return 'enterprise-ready';
  return 'autonomous-ready';
}

function buildBlockingGaps(report) {
  const gaps = [];

  if (report.missingArtifacts.length > 0) {
    gaps.push({
      id: 'gap-proof-missing-artifacts',
      severity: 'critical',
      area: 'proof-governance',
      title: 'Proof artifacts obrigatorios ausentes fisicamente',
      evidence: { count: report.missingArtifacts.length, sample: report.missingArtifacts.slice(0, 20) },
      suggestedFix: 'Materializar artifacts fisicos obrigatorios e reexecutar a validacao de provas.',
    });
  }

  if (report.invalidReferences.length > 0) {
    gaps.push({
      id: 'gap-proof-invalid-references',
      severity: 'critical',
      area: 'proof-governance',
      title: 'Readiness referencia arquivos que nao existem fisicamente',
      evidence: { count: report.invalidReferences.length, sample: report.invalidReferences.slice(0, 20) },
      suggestedFix: 'Remover referencias sem artifact ou materializar os arquivos fisicos esperados.',
    });
  }

  if (!report.packageValidation.ok) {
    gaps.push({
      id: 'gap-proof-package-validation',
      severity: 'critical',
      area: 'package',
      title: 'ZIP de release nao contem todos os proofs obrigatorios',
      evidence: { missingEntries: report.packageValidation.missingEntries },
      suggestedFix: 'Regenerar o pacote com todos os artifacts auditaveis e revalidar o ZIP fisico.',
    });
  }

  if (report.humanHandoffCoverage.status !== 'VALIDATED') {
    gaps.push({
      id: 'gap-proof-human-handoff',
      severity: 'high',
      area: 'human-handoff',
      title: 'Human handoff nao possui prova fisica enterprise completa',
      evidence: report.humanHandoffCoverage,
      suggestedFix: 'Gerar replay, timeline, screenshots e mutacoes de backend auditaveis para o handoff humano.',
    });
  }

  if (report.PBXCoverage.status !== 'VALIDATED') {
    gaps.push({
      id: 'gap-proof-pbx-prod-like',
      severity: 'high',
      area: 'pbx',
      title: 'PBX prod-like nao possui prova fisica enterprise completa',
      evidence: report.PBXCoverage,
      suggestedFix: 'Persistir transcript ASR, prompts TTS, timeline IVR, queue transitions e metadata de gravacoes.',
    });
  }

  if (report.omnichannelCoverage.status !== 'VALIDATED') {
    gaps.push({
      id: 'gap-proof-omnichannel-replay',
      severity: 'high',
      area: 'omnichannel',
      title: 'Replay omnichannel unificado nao possui prova fisica completa',
      evidence: report.omnichannelCoverage,
      suggestedFix: 'Persistir transicoes cross-channel, eventos WhatsApp/chat/PBX/ticket e mutacoes CRM no replay unificado.',
    });
  }

  if (report.digitalTwinCoverage.status !== 'VALIDATED') {
    gaps.push({
      id: 'gap-proof-digital-twin',
      severity: 'high',
      area: 'digital-twin',
      title: 'Operational Digital Twin nao possui prova fisica completa',
      evidence: report.digitalTwinCoverage,
      suggestedFix: 'Persistir snapshots, assertions, mutations e timeline fisica do twin operacional.',
    });
  }

  if (report.governanceCoverage.status !== 'VALIDATED') {
    gaps.push({
      id: 'gap-proof-governance-support',
      severity: 'critical',
      area: 'proof-governance',
      title: 'Governance signature ou cleanup proof nao possuem artifact fisico valido',
      evidence: report.governanceCoverage,
      suggestedFix: 'Persistir assinatura de governance com hashes dos proofs e cleanup proof com limpeza validada de runtime e workspace.',
    });
  }

  return gaps;
}

function buildFinalProofReport(context = {}) {
  const requiredArtifacts = REQUIRED_ARTIFACT_SPECS.map(resolveArtifact);
  const referencePaths = [
    ...(context.productionValidation || []).flatMap((item) => item.evidence || []),
    ...(context.enterpriseEvidencePaths || []),
    ...(context.additionalReferencePaths || []),
  ];
  const invalidReferences = collectInvalidReferences(referencePaths);
  const missingArtifacts = requiredArtifacts.filter((artifact) => !artifact.exists).map((artifact) => ({
    id: artifact.id,
    domain: artifact.domain,
    path: artifact.path,
  }));

  const foundationArtifacts = requiredArtifacts.filter((artifact) => artifact.domain === 'foundation');
  const humanHandoffArtifact = requiredArtifacts.find((artifact) => artifact.id === 'human_handoff');
  const humanHandoffScreenshotsArtifact = findArtifactById(requiredArtifacts, 'human_handoff_screenshots');
  const pbxArtifact = requiredArtifacts.find((artifact) => artifact.id === 'pbx_prod_like');
  const pbxAsrTranscriptArtifact = findArtifactById(requiredArtifacts, 'pbx_asr_transcript');
  const pbxTtsPromptsArtifact = findArtifactById(requiredArtifacts, 'pbx_tts_prompts');
  const pbxRecordingsMetadataArtifact = findArtifactById(requiredArtifacts, 'pbx_recordings_metadata');
  const omnichannelArtifact = requiredArtifacts.find((artifact) => artifact.id === 'omnichannel_replay');
  const omnichannelCrmMutationsArtifact = findArtifactById(requiredArtifacts, 'omnichannel_crm_mutations');
  const digitalTwinSnapshotsArtifact = findArtifactById(requiredArtifacts, 'digital_twin_snapshots');

  const humanHandoffCoverage = evaluateHumanHandoff(humanHandoffArtifact, humanHandoffScreenshotsArtifact);
  const PBXCoverage = evaluatePbx(pbxArtifact, pbxAsrTranscriptArtifact, pbxTtsPromptsArtifact, pbxRecordingsMetadataArtifact);
  const omnichannelCoverage = evaluateOmnichannel(omnichannelArtifact, omnichannelCrmMutationsArtifact);
  const digitalTwinCoverage = evaluateDigitalTwin({
    requiredArtifacts,
    humanHandoff: humanHandoffCoverage,
    pbx: PBXCoverage,
    omnichannel: omnichannelCoverage,
  }, digitalTwinSnapshotsArtifact);
  const governanceCoverage = evaluateGovernance(requiredArtifacts);

  const replayCoverage = {
    required: 6,
    found: Number(context.prodLikeSummary?.supportedJourneyIds?.length || 0),
  };
  replayCoverage.percent = replayCoverage.required === 0 ? 0 : Number(((replayCoverage.found / replayCoverage.required) * 100).toFixed(2));

  const prodLikeCoverage = {
    required: Number(context.requiredVerticalCount || 6),
    found: Number((context.verticalSummaries || []).filter((vertical) => vertical.classification === 'production-like').length || 0),
  };
  prodLikeCoverage.percent = prodLikeCoverage.required === 0 ? 0 : Number(((prodLikeCoverage.found / prodLikeCoverage.required) * 100).toFixed(2));

  const evidenceManifest = {
    generatedAt: new Date().toISOString(),
    runtimeRoot: getRuntimeRootSafe(),
    artifacts: requiredArtifacts.map((artifact) => ({
      id: artifact.id,
      domain: artifact.domain,
      path: artifact.path,
      sourcePath: artifact.sourcePath,
      resolvedPath: artifact.resolvedPath,
      exists: artifact.exists,
      packageRequired: artifact.packageRequired,
      hash: artifact.sha256,
      checksum: artifact.sha256,
      timestamp: artifact.timestamp,
      proofStatus: artifact.exists ? 'present' : 'missing',
      replayLinkage: artifact.domain === 'pbx' ? ['pbx_voice_flow_prod_like'] : artifact.domain === 'human_handoff' ? ['human_handoff_full_validation'] : artifact.domain === 'omnichannel' ? ['omnichannel_unified_replay'] : [],
      journeyLinkage: artifact.domain === 'human_handoff' ? ['human_handoff_full_validation'] : artifact.domain === 'pbx' ? ['pbx_voice_flow_prod_like'] : artifact.domain === 'omnichannel' ? ['omnichannel_unified_replay'] : [],
      governanceLinkage: artifact.domain === 'governance' ? ['proof_based_governance'] : ['final_decision'],
    })),
  };

  let packageValidation;
  try {
    packageValidation = validatePackage({
      evidenceManifest,
      requiredEntries: requiredArtifacts.filter((artifact) => artifact.packageRequired).map((artifact) => artifact.path),
    });
  } catch (error) {
    packageValidation = {
      generatedAt: new Date().toISOString(),
      ok: false,
      zipPath: null,
      zipName: null,
      requiredEntries: requiredArtifacts.filter((artifact) => artifact.packageRequired).map((artifact) => artifact.path),
      missingEntries: [],
      error: error.message || String(error),
    };
  }

  const proofCoverage = {
    total: requiredArtifacts.length,
    valid: requiredArtifacts.filter((artifact) => artifact.exists).length,
  };
  proofCoverage.percent = proofCoverage.total === 0 ? 0 : Number(((proofCoverage.valid / proofCoverage.total) * 100).toFixed(2));

  const blockerCount = Number(context.blockingGapCount || 0);
  const stage = determineStage({
    blockerCount,
    replayCoverage,
    prodLikeCoverage,
    omnichannel: omnichannelCoverage,
    pbx: PBXCoverage,
    humanHandoff: humanHandoffCoverage,
    digitalTwin: digitalTwinCoverage,
    governanceCoverage,
    foundationArtifacts,
  });

  const gateChecks = {
    blockersClear: blockerCount === 0,
    proofsComplete: missingArtifacts.length === 0 && invalidReferences.length === 0,
    replayCoverageOk: replayCoverage.percent >= 100,
    prodLikeCoverageOk: prodLikeCoverage.percent >= 100,
    omnichannelCoverageOk: omnichannelCoverage.status === 'VALIDATED',
    PBXCoverageOk: PBXCoverage.status === 'VALIDATED',
    humanHandoffCoverageOk: humanHandoffCoverage.status === 'VALIDATED',
    digitalTwinCoverageOk: digitalTwinCoverage.status === 'VALIDATED',
    governanceCoverageOk: governanceCoverage.status === 'VALIDATED',
    packageValidationOk: packageValidation.ok,
    evidenceManifestValid: evidenceManifest.artifacts.every((artifact) => artifact.exists === true),
  };

  const allGateChecksPass = Object.values(gateChecks).every(Boolean);

  const report = {
    generatedAt: new Date().toISOString(),
    proofCoverage,
    missingArtifacts,
    invalidReferences,
    blockerCount,
    replayCoverage,
    prodLikeCoverage,
    omnichannelCoverage,
    PBXCoverage,
    humanHandoffCoverage,
    digitalTwinCoverage,
    governanceCoverage,
    packageValidation,
    evidenceManifest,
    decisionMatrix: {
      stages: STAGE_ORDER,
      currentLevel: stage,
      blockersClear: gateChecks.blockersClear,
      gateChecks,
    },
    finalDecision: 'PARTIAL_GO',
  };

  report.blockingGaps = buildBlockingGaps(report);
  report.finalDecision = allGateChecksPass
    ? 'GO'
    : (report.blockingGaps.length > 0 ? 'NO_GO' : 'PARTIAL_GO');
  return report;
}

module.exports = {
  buildFinalProofReport,
  STAGE_ORDER,
  REQUIRED_ARTIFACT_SPECS,
};