'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveEvidenceCandidates, resolveWorkspacePath, getRuntimeRoot } = require('../../tools/system/lib/runtime-paths');
const { validatePackage } = require('../package-validator');
const { runCrossReportValidation, classifyPbxMaturity, THRESHOLDS } = require('../cross-report-validator');
const { computeFingerprintChain, compareFingerprintChains } = require('./fingerprint-chain');

const ROOT = path.join(__dirname, '..', '..');

// ─── Modelo de maturidade operacional estrito ────────────────────────────────
// Cada nível requer prova operacional objetiva. Não há saltos.
const STAGE_ORDER = [
  'foundation',        // artefatos básicos presentes
  'operational',       // replay coverage > 0
  'validated',         // PBX ou handoff parcialmente validados
  'prod-like',         // prod-like coverage 100%
  'enterprise-partial',// omnichannel, PBX ou handoff não totalmente validados
  'enterprise-ready',  // digital twin + governance validados, zero blockers
  'autonomous-ready',  // TODOS os gates críticos passaram sem exceção
];

// ─── Decisões granulares — nunca rótulos vagos de GO/NO_GO ───────────────────
const STAGE_DECISIONS = {
  'foundation':         'FOUNDATION_GO',
  'operational':        'OPERATIONAL_GO',
  'validated':          'VALIDATED_GO',
  'prod-like':          'PRODLIKE_GO',
  'enterprise-partial': 'ENTERPRISE_PARTIAL_GO',
  'enterprise-ready':   'ENTERPRISE_READY_GO',
  'autonomous-ready':   'AUTONOMOUS_READY_GO',
};

// ─── Artefatos obrigatórios ───────────────────────────────────────────────────
const REQUIRED_ARTIFACT_SPECS = [
  { id: 'smoke_summary',           path: 'qa/smoke-evidence.json',                                           domain: 'foundation',    packageRequired: true },
  { id: 'smoke_l01',               path: 'qa/l01-physical-queue-evidence.json',                               domain: 'foundation',    packageRequired: true },
  { id: 'smoke_l02',               path: 'qa/l02-ura-publish-rollback-evidence.json',                         domain: 'foundation',    packageRequired: true },
  { id: 'smoke_l03',               path: 'qa/l03-pbx-voice-tts-asr-evidence.json',                            domain: 'foundation',    packageRequired: true },
  { id: 'smoke_l04',               path: 'qa/l04-pbx-call-events-runtime-evidence.json',                      domain: 'foundation',    packageRequired: true },
  { id: 'smoke_l05',               path: 'qa/l05-chatpro-omnichannel-evidence.json',                          domain: 'foundation',    packageRequired: true },
  { id: 'prod_like_smoke',         path: 'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json',      domain: 'operational',   packageRequired: true },
  { id: 'human_handoff',           path: 'qa/enterprise/human-handoff-full-validation.json',                  domain: 'human_handoff', packageRequired: true, mirrorToWorkspace: true },
  { id: 'human_handoff_screenshots', path: 'qa/enterprise/human-handoff-screenshots.json',                   domain: 'human_handoff', packageRequired: true, mirrorToWorkspace: true },
  { id: 'pbx_prod_like',           path: 'qa/enterprise/pbx-voice-flow-prod-like.json',                      domain: 'pbx',           packageRequired: true, mirrorToWorkspace: true },
  { id: 'pbx_asr_transcript',      path: 'qa/enterprise/pbx-asr-transcript.json',                            domain: 'pbx',           packageRequired: true, mirrorToWorkspace: true },
  { id: 'pbx_tts_prompts',         path: 'qa/enterprise/pbx-tts-prompts.json',                               domain: 'pbx',           packageRequired: true, mirrorToWorkspace: true },
  { id: 'pbx_recordings_metadata', path: 'qa/enterprise/pbx-recordings-metadata.json',                       domain: 'pbx',           packageRequired: true, mirrorToWorkspace: true },
  { id: 'omnichannel_replay',      path: 'qa/enterprise/omnichannel-unified-replay.json',                     domain: 'omnichannel',   packageRequired: true, mirrorToWorkspace: true },
  { id: 'omnichannel_crm_mutations', path: 'qa/enterprise/omnichannel-crm-mutations.json',                   domain: 'omnichannel',   packageRequired: true, mirrorToWorkspace: true },
  { id: 'digital_twin_snapshots',  path: 'qa/enterprise/digital-twin-snapshots.json',                         domain: 'digital_twin',  packageRequired: true, mirrorToWorkspace: true },
  { id: 'qa_waves_governance',     path: 'qa/qa-waves-enterprise-governance.json',                            domain: 'governance',    packageRequired: true },
  { id: 'governance_signature',    path: 'governance/proof-signature.json',                                   domain: 'governance',    packageRequired: true },
  { id: 'cleanup_proof',           path: 'governance/cleanup-proof.json',                                     domain: 'governance',    packageRequired: true },
  { id: 'final_readiness',         path: 'governance/final-readiness-report.json',                            domain: 'governance',    packageRequired: true },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getRuntimeRootSafe() {
  try { return getRuntimeRoot(ROOT, process.env); } catch (_) { return null; }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJsonMaybe(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
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
    if (fs.existsSync(candidate)) { sourcePath = candidate; break; }
  }

  let resolvedPath = sourcePath;
  if (sourcePath && spec.mirrorToWorkspace) {
    resolvedPath = synchronizeArtifact(sourcePath, workspaceTarget);
  }

  const stats = resolvedPath && fs.existsSync(resolvedPath) ? fs.statSync(resolvedPath) : null;
  const json  = resolvedPath && resolvedPath.endsWith('.json') ? readJsonMaybe(resolvedPath) : null;

  return {
    id: spec.id, domain: spec.domain, path: spec.path,
    packageRequired: spec.packageRequired === true,
    sourcePath, resolvedPath,
    exists: Boolean(stats),
    size: stats ? stats.size : 0,
    timestamp: stats ? stats.mtime.toISOString() : null,
    sha256: stats ? sha256File(resolvedPath) : null,
    json,
  };
}

function walkFiles(startDir, collector = []) {
  if (!startDir || !fs.existsSync(startDir)) return collector;
  for (const entry of fs.readdirSync(startDir, { withFileTypes: true })) {
    const absPath = path.join(startDir, entry.name);
    if (entry.isDirectory()) walkFiles(absPath, collector);
    else collector.push(absPath);
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
      if (patterns.some((p) => p.test(relPath))) matches.push({ filePath, relPath });
    }
  }
  return matches;
}

function findArtifactById(requiredArtifacts, id) {
  return requiredArtifacts.find((a) => a.id === id) || { id, path: null, exists: false, json: null };
}

function hasArrayPayload(artifact, key) {
  return Boolean(Array.isArray(artifact?.json?.[key]) && artifact.json[key].length > 0);
}

// ─── Validade semântica — artefato presente ≠ artefato válido (FASE 16) ─────
// Flags negativas explícitas invalidam a prova mesmo quando o arquivo existe:
//   - `ok === false` ou `valid === false` no nível raiz do artefato;
//   - `status` 'failed'/'NO_GO' no nível raiz;
//   - qualquer assertion com `passed === false` (arrays `assertions`, em
//     qualquer profundidade);
//   - `valid === false` dentro de snapshots (`diff`, `snapshotDiff`,
//     `postState`, `before/after(Step)Snapshot`).
// Heurísticas de presença (arquivo existe, array não vazio) permanecem, mas
// nunca são suficientes: conteúdo semanticamente inválido derruba a avaliação.
const SNAPSHOT_CONTAINER_KEYS = new Set([
  'diff', 'snapshotDiff', 'postState',
  'beforeSnapshot', 'afterSnapshot', 'beforeStepSnapshot', 'afterStepSnapshot',
]);

const SEMANTIC_SCAN_MAX_DEPTH = 12;

function findFailedAssertions(node, acc = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > SEMANTIC_SCAN_MAX_DEPTH) return acc;
  if (Array.isArray(node)) {
    for (const item of node) findFailedAssertions(item, acc, depth + 1);
    return acc;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'assertions' && Array.isArray(value)) {
      for (const assertion of value) {
        if (assertion && typeof assertion === 'object' && assertion.passed === false) acc.push(assertion);
      }
      continue;
    }
    findFailedAssertions(value, acc, depth + 1);
  }
  return acc;
}

function findInvalidSnapshots(node, acc = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > SEMANTIC_SCAN_MAX_DEPTH) return acc;
  if (Array.isArray(node)) {
    for (const item of node) findInvalidSnapshots(item, acc, depth + 1);
    return acc;
  }
  for (const [key, value] of Object.entries(node)) {
    if (SNAPSHOT_CONTAINER_KEYS.has(key) && value && typeof value === 'object'
      && !Array.isArray(value) && value.valid === false) {
      acc.push(key);
    }
    findInvalidSnapshots(value, acc, depth + 1);
  }
  return acc;
}

/**
 * Violações semânticas de um artefato resolvido. Artefato ausente não é
 * tratado aqui (a ausência já é coberta pelas checagens de existência).
 * @returns {string[]} códigos de violação (vazio = semanticamente válido)
 */
function semanticArtifactViolations(artifact) {
  const violations = [];
  if (!artifact || !artifact.exists) return violations;
  const json = artifact.json;
  if (!json || typeof json !== 'object' || Array.isArray(json)) return violations;

  if (json.ok === false) violations.push('ok_false');
  if (json.valid === false) violations.push('valid_false');
  const status = String(json.status || '').toUpperCase();
  if (status === 'FAILED' || status === 'NO_GO') violations.push(`status_${status.toLowerCase()}`);

  const failedAssertions = findFailedAssertions(json);
  if (failedAssertions.length > 0) violations.push(`assertions_failed(${failedAssertions.length})`);

  const invalidSnapshots = findInvalidSnapshots(json);
  if (invalidSnapshots.length > 0) violations.push(`snapshot_invalid(${invalidSnapshots.length})`);

  return violations;
}

/**
 * Validação de conteúdo de um snapshot do digital twin: `diff.valid === false`,
 * assertion falha, mutação indevida (`unexpectedMutations`) e mutação esperada
 * ausente (`expectedMutations` sem correspondente em `observedMutations`)
 * invalidam o snapshot — presença do registro não conta como prova.
 */
function validateTwinSnapshotContent(snapshot, index) {
  const violations = [];
  if (!snapshot || typeof snapshot !== 'object') return violations;
  const label = snapshot.stepId || snapshot.journeyId || `snapshot[${index}]`;
  const diff = snapshot.diff && typeof snapshot.diff === 'object' ? snapshot.diff : null;

  if (diff && diff.valid === false) violations.push(`snapshot_diff_invalid:${label}`);
  if (findFailedAssertions(snapshot).length > 0) violations.push(`snapshot_assertions_failed:${label}`);

  const unexpected = Array.isArray(diff?.unexpectedMutations) ? diff.unexpectedMutations : [];
  if (unexpected.length > 0) violations.push(`snapshot_unexpected_mutations:${label}(${unexpected.length})`);

  const expected = Array.isArray(diff?.expectedMutations) ? diff.expectedMutations : [];
  const observed = Array.isArray(diff?.observedMutations) ? diff.observedMutations : [];
  const missingMutations = expected.filter((mutation) => !observed.includes(mutation));
  if (missingMutations.length > 0) {
    violations.push(`snapshot_expected_mutations_missing:${label}(${missingMutations.length})`);
  }

  return violations;
}

function collectInvalidReferences(referencePaths = []) {
  return Array.from(new Set(referencePaths.filter(Boolean))).map((refPath) => {
    const candidates = resolveEvidenceCandidates(ROOT, refPath, null, process.env);
    const existing = candidates.find((c) => fs.existsSync(c)) || null;
    return { path: refPath, exists: Boolean(existing), resolvedPath: existing };
  }).filter((item) => !item.exists);
}

// ─── Carrega inteligência do QA Mesh ─────────────────────────────────────────
function loadQaMeshIntelligence() {
  const candidates = [
    path.join(ROOT, 'qa-mesh', 'intelligence', 'latest.json'),
    path.join(ROOT, 'qa', 'mesh-intelligence-latest.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return readJsonMaybe(p) || null;
  }
  return null;
}

// ─── E. Classificação de maturidade PBX ──────────────────────────────────────
// Níveis: simulated → synthetic-assisted → hybrid-real → prod-like → enterprise-real
// Teto máximo se synthetic_insert OU selftest falhar: hybrid-real
function evaluatePbxMaturityLevel(pbxData) {
  const maturity = classifyPbxMaturity(pbxData);
  const fullyRealLevels = ['prod-like', 'enterprise-real'];
  return {
    maturityLevel: maturity,
    isFullyReal: fullyRealLevels.includes(maturity),
    maxAllowedBySelftest: ['simulated', 'synthetic-assisted', 'hybrid-real'].includes(maturity)
      ? 'hybrid-real'
      : maturity,
  };
}

// ─── F. Normalização de handoff humano ───────────────────────────────────────
function evaluateHumanHandoff(artifact, screenshotArtifact) {
  const data     = artifact.json || {};
  const signals  = data.signals   || {};
  const evidence = data.evidence  || {};
  const ticket   = data.ticket    || {};
  const replay   = Array.isArray(data.replay) ? data.replay : [];
  const screenshots = Array.isArray(screenshotArtifact?.json?.files)
    ? screenshotArtifact.json.files : [];
  const missing  = [];

  // presença do artefato
  if (!artifact.exists) missing.push('human_handoff_artifact');

  // FASE 16 — validade semântica do conteúdo (presença ≠ validade)
  missing.push(...semanticArtifactViolations(artifact).map((v) => `semantic:${v}`));

  // replay e timeline
  if (replay.length === 0) missing.push('replay');
  if (!(Number(evidence.timelineCount || 0) > 0)) missing.push('timeline');

  // sinais de ownership e transições
  if (signals.ticketOwnershipObserved !== true) missing.push('ownership_transitions');
  if (signals.routingTransferObserved !== true || signals.stateTransitionsObserved !== true) missing.push('ticket_transitions');
  if (signals.slaObserved !== true) missing.push('sla_transitions');
  if (signals.backendMutationObserved !== true) missing.push('backend_mutations');

  // screenshots
  if (!screenshotArtifact.exists) missing.push('screenshots');
  else if (screenshots.length === 0) missing.push('screenshots_manifest');

  // F. Normalização enterprise obrigatória
  const normalizationGaps = [];
  if (ticket.assignedTo == null) normalizationGaps.push('null_assignment');

  const nullTimestamps = replay.filter((r) => r.timestamp == null).length;
  if (nullTimestamps > 0) normalizationGaps.push(`null_timestamps(${nullTimestamps})`);

  if (Number(evidence.eventCount || 0) < 1) normalizationGaps.push('zero_event_count');

  if (normalizationGaps.length > 0) {
    missing.push(...normalizationGaps.map((g) => `normalization:${g}`));
  }

  return {
    status: missing.length === 0 ? 'VALIDATED' : 'NOT_VALIDATED',
    artifact: artifact.path,
    screenshotArtifact: screenshotArtifact.path,
    missing,
    normalizationGaps,
    screenshots,
  };
}

// ─── Avaliação PBX com maturidade ────────────────────────────────────────────
function evaluatePbx(artifact, asrArtifact, ttsArtifact, recordingsArtifact) {
  const data    = artifact.json || {};
  const l03     = data.sources?.l03 || {};
  const l04     = data.sources?.l04 || {};
  const missing = [];

  if (!artifact.exists) missing.push('pbx_prod_like_artifact');
  missing.push(...semanticArtifactViolations(artifact).map((v) => `semantic:${v}`));
  if (!Array.isArray(data.evidencePaths) || data.evidencePaths.length < 2) missing.push('call_replay');
  if (!l03.realCall?.cdrFound) missing.push('cdr');
  if (data.signals?.replayTimeline !== true || !l04.flow?.executionId) missing.push('ivr_timeline');
  if (!l03.runtime?.transferObserved) missing.push('queue_transitions');
  if (!asrArtifact.exists || !(asrArtifact.json?.transcript || asrArtifact.json?.text || hasArrayPayload(asrArtifact, 'segments'))) missing.push('asr_transcript');
  if (!ttsArtifact.exists || !hasArrayPayload(ttsArtifact, 'prompts')) missing.push('tts_prompts');
  if (!recordingsArtifact.exists || !hasArrayPayload(recordingsArtifact, 'recordings')) missing.push('recordings_metadata');

  // E. Classificação de maturidade real
  const pbxMaturity = evaluatePbxMaturityLevel(artifact.json);

  return {
    status: missing.length === 0 ? 'VALIDATED' : 'NOT_VALIDATED',
    artifact: artifact.path,
    asrArtifact: asrArtifact.path,
    ttsArtifact: ttsArtifact.path,
    recordingsArtifact: recordingsArtifact.path,
    missing,
    maturityLevel: pbxMaturity.maturityLevel,
    isFullyReal: pbxMaturity.isFullyReal,
  };
}

function evaluateOmnichannel(artifact, crmArtifact) {
  const data             = artifact.json || {};
  const replay           = Array.isArray(data.replay) ? data.replay : [];
  const distinctSources  = Array.from(new Set(replay.map((i) => i.source).filter(Boolean)));
  const hasWhatsAppEvents = replay.some((i) => i.kind === 'channel_message' || /whatsapp/i.test(String(i.text || '')));
  const hasTicketEvents   = replay.some((i) => i.kind === 'ticket_message');
  const hasPbxEvents      = replay.some((i) => i.source === 'pbx');
  const hasChatEvents     = replay.some((i) => i.source === 'omnichannel' || /assign=|transfer=|note=/i.test(String(i.text || '')));
  const hasCrmMutations   = crmArtifact.exists
    && hasArrayPayload(crmArtifact, 'mutations')
    && (replay.some((i) => /crm/i.test(String(i.text || ''))) || Number(crmArtifact.json?.mutations?.length || 0) > 0);
  const missing = [];

  if (!artifact.exists) missing.push('unified_replay_artifact');
  missing.push(...semanticArtifactViolations(artifact).map((v) => `semantic:${v}`));
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
  // FASE 16 — conjunção (AND) dos requisitos: TODAS as fontes precisam provar
  // o requisito; a presença de qualquer artefato isolado não satisfez mais a
  // avaliação (antes: lógica OR — qualquer artefato presente tendia a passar).
  const replayPresent     = context.omnichannel.status === 'VALIDATED' && context.humanHandoff.status === 'VALIDATED' && context.pbx.status === 'VALIDATED';
  const timelinePresent   = !context.humanHandoff.missing.includes('timeline') && !context.pbx.missing.includes('ivr_timeline');
  const assertionsPresent = !context.humanHandoff.missing.includes('ticket_transitions') && !context.omnichannel.missing.includes('ticket_events');
  const mutationsPresent  = !context.humanHandoff.missing.includes('backend_mutations') && !context.omnichannel.missing.includes('crm_mutations');
  const evidencePresent   = context.requiredArtifacts.filter((a) => a.domain === 'foundation').every((a) => a.exists);
  const snapshots         = Array.isArray(snapshotsArtifact?.json?.snapshots) ? snapshotsArtifact.json.snapshots : [];
  const snapshotViolations = snapshots.flatMap((snapshot, index) => validateTwinSnapshotContent(snapshot, index));
  const missing = [];

  if (!replayPresent)     missing.push('replay');
  if (!timelinePresent)   missing.push('timeline');
  if (!assertionsPresent) missing.push('assertions');
  if (!mutationsPresent)  missing.push('mutations');
  if (!evidencePresent)   missing.push('evidence');
  if (!snapshotsArtifact.exists || snapshots.length === 0) missing.push('snapshots');
  const baseMissingCount = missing.length;
  if (snapshotViolations.length > 0) missing.push(...snapshotViolations.map((v) => `semantic:${v}`));

  return {
    status: missing.length === 0 ? 'VALIDATED' : (baseMissingCount === 6 ? 'NOT_VALIDATED' : 'PARTIAL'),
    artifact: snapshotsArtifact.path,
    missing,
    snapshotViolations,
    snapshots,
  };
}

function evaluateGovernance(requiredArtifacts) {
  const signatureArtifact = findArtifactById(requiredArtifacts, 'governance_signature');
  const cleanupArtifact   = findArtifactById(requiredArtifacts, 'cleanup_proof');
  const missing = [];

  if (!signatureArtifact.exists) {
    missing.push('governance_signature');
  } else {
    const sd = signatureArtifact.json || {};
    if (!sd.signature || !hasArrayPayload(signatureArtifact, 'subjectHashes')) missing.push('governance_signature_payload');
    missing.push(...semanticArtifactViolations(signatureArtifact).map((v) => `semantic:signature_${v}`));
  }

  if (!cleanupArtifact.exists) {
    missing.push('cleanup_proof');
  } else {
    const cd = cleanupArtifact.json || {};
    if (cd.runtimeClean !== true || cd.workspaceClean !== true) missing.push('cleanup_status');
    missing.push(...semanticArtifactViolations(cleanupArtifact).map((v) => `semantic:cleanup_${v}`));
  }

  return {
    status: missing.length === 0 ? 'VALIDATED' : 'NOT_VALIDATED',
    signatureArtifact: signatureArtifact.path,
    cleanupArtifact: cleanupArtifact.path,
    missing,
  };
}

// ─── G. Intelligence Stability — falha ativa impede autonomous-ready ──────────
function evaluateIntelligenceStability(intelligenceData) {
  if (!intelligenceData) return { status: 'UNKNOWN', unstableDomains: [], recurringFailures: [], blocksAutonomous: false };

  const stability = Array.isArray(intelligenceData.moduleStability) ? intelligenceData.moduleStability : [];
  const recurring = Array.isArray(intelligenceData.recurringFailures) ? intelligenceData.recurringFailures : [];

  const unstable = stability.filter((m) => Number(m.stabilityScore) < THRESHOLDS.intelligenceStabilityMin);
  // Recurring failures só bloqueiam se o domínio está ATUALMENTE instável.
  // Falhas históricas de antes de um fix não penalizam domínios já estabilizados.
  const activeRecurring = recurring.filter((f) => {
    const domainMod = stability.find((m) => m.domain === f.domain);
    return !domainMod || Number(domainMod.stabilityScore) < THRESHOLDS.intelligenceStabilityMin;
  });
  const blocksAutonomous = unstable.length > 0 || activeRecurring.length > 0;

  return {
    status: blocksAutonomous ? 'UNSTABLE' : 'STABLE',
    unstableDomains: unstable.map((m) => ({ domain: m.domain, stabilityScore: m.stabilityScore, passed: m.passed, total: m.total })),
    recurringFailures: recurring.map((f) => ({ domain: f.domain, fingerprint: f.fingerprint, recurringCount: f.recurringCount })),
    blocksAutonomous,
  };
}

// ─── D. Hardening de classificação vertical ───────────────────────────────────
function evaluateVerticalCoverage(verticalSummaries, requiredCount) {
  if (!Array.isArray(verticalSummaries)) {
    return { status: 'UNKNOWN', validated: 0, required: requiredCount, percent: 0, invalidClaims: [] };
  }

  const invalidClaims = [];
  let validProdLikeCount = 0;

  for (const v of verticalSummaries) {
    const name           = v.vertical || v.id || 'unknown';
    const classification = v.classification || '';
    const isEnterprise   = ['production-like', 'enterprise-ready'].includes(classification);

    const journeyCount     = Number(v.journeyCount || v.journeys?.length || 0);
    const assertionCount   = Number(v.assertionCount || v.assertions?.length || 0);
    const integrationCount = Number(v.integrationCount || v.integrations?.length || 0);

    if (isEnterprise) {
      const gaps = [];
      if (journeyCount < THRESHOLDS.verticalJourneysMin) gaps.push(`journeys=${journeyCount}`);
      if (assertionCount < THRESHOLDS.verticalAssertionsMin) gaps.push(`assertions=${assertionCount}`);
      if (integrationCount < THRESHOLDS.verticalIntegrationsMin) gaps.push(`integrations=${integrationCount}`);

      if (gaps.length > 0) {
        invalidClaims.push({ vertical: name, classification, gaps });
      } else {
        validProdLikeCount += 1;
      }
    }
  }

  const percent = requiredCount === 0 ? 0 : Number(((validProdLikeCount / requiredCount) * 100).toFixed(2));

  return {
    status: invalidClaims.length === 0 && validProdLikeCount >= requiredCount ? 'VALIDATED' : 'PARTIAL',
    validated: validProdLikeCount,
    required: requiredCount,
    percent,
    invalidClaims,
  };
}

// ─── H. Evidence quality score ────────────────────────────────────────────────
function computeProofQualityScore(context) {
  const { requiredArtifacts, humanHandoff, pbx, omnichannel, digitalTwin, governance, intelligence } = context;

  let score = 0;
  let maxScore = 0;

  function add(points, condition, label) {
    maxScore += points;
    if (condition) score += points;
    return { label, earned: condition ? points : 0, max: points };
  }

  const breakdown = [
    // Artefatos foundation (0-20)
    add(20, requiredArtifacts.filter((a) => a.domain === 'foundation').every((a) => a.exists), 'foundation_artifacts'),

    // Replay richness (0-10)
    add(10, (context.replayCoverage?.percent || 0) >= 100, 'replay_coverage_100pct'),

    // Assertions e integrações em verticais (0-10)
    add(10, (context.verticalCoverage?.invalidClaims?.length || 0) === 0, 'vertical_assertions_valid'),

    // PBX maturity (0-15)
    add(15, pbx.isFullyReal === true, 'pbx_fully_real'),
    add(0, ['prod-like', 'hybrid-real'].includes(pbx.maturityLevel), 'pbx_partial_real'),

    // Handoff normalization (0-15)
    add(10, humanHandoff.status === 'VALIDATED', 'handoff_validated'),
    add(5, (humanHandoff.normalizationGaps?.length || 0) === 0, 'handoff_fully_normalized'),

    // Omnichannel (0-10)
    add(10, omnichannel.status === 'VALIDATED', 'omnichannel_validated'),

    // Digital twin (0-10)
    add(10, digitalTwin.status === 'VALIDATED', 'digital_twin_validated'),

    // Governance (0-10)
    add(10, governance.status === 'VALIDATED', 'governance_validated'),

    // Intelligence stability (0-10)
    add(10, intelligence.status === 'STABLE', 'intelligence_stable'),

    // Real vs synthetic ratio PBX (0-5)
    add(5, pbx.maturityLevel === 'enterprise-real', 'pbx_enterprise_real'),

    // Screenshots and cleanup (0-5)
    add(3, (humanHandoff.screenshots?.length || 0) > 0, 'handoff_screenshots'),
    add(2, !context.governanceCoverage?.missing?.includes('cleanup_status'), 'runtime_cleanup'),
  ];

  const finalScore = maxScore > 0 ? Number(((score / maxScore) * 100).toFixed(1)) : 0;

  return {
    score: finalScore,
    raw: score,
    max: maxScore,
    grade: finalScore >= 90 ? 'A' : finalScore >= 75 ? 'B' : finalScore >= 60 ? 'C' : finalScore >= 40 ? 'D' : 'F',
    breakdown,
  };
}

// ─── I. Modelo de maturidade — determinação de estágio ───────────────────────
function determineStage(params) {
  const {
    blockerCount, replayCoverage, prodLikeCoverage,
    omnichannel, pbx, humanHandoff, digitalTwin,
    governanceCoverage, foundationArtifacts,
    intelligenceStability, crossReport,
  } = params;

  // foundation: sem artefatos básicos
  if (!foundationArtifacts.every((a) => a.exists)) return 'foundation';

  // operational: sem replay
  if (replayCoverage.percent === 0) return 'operational';

  // validated: PBX e handoff ambos não validados
  if (pbx.status === 'NOT_VALIDATED' && humanHandoff.status === 'NOT_VALIDATED') return 'validated';

  // prod-like: cobertura prod-like < 100%
  if (prodLikeCoverage.percent < 100) return 'prod-like';

  // enterprise-partial: falta validação completa de omnichannel / PBX / handoff
  if (omnichannel.status !== 'VALIDATED' || pbx.status !== 'VALIDATED' || humanHandoff.status !== 'VALIDATED') {
    return 'enterprise-partial';
  }

  // enterprise-ready: digital twin, governance, blockers
  if (digitalTwin.status !== 'VALIDATED' || governanceCoverage.status !== 'VALIDATED' || blockerCount > 0) {
    return 'enterprise-ready';
  }

  // C. Autonomous-ready hard gate — TODOS os critérios obrigatórios
  const autonomousGate = {
    pbxFullyReal:             pbx.isFullyReal === true,
    omnichannelValidated:     omnichannel.status === 'VALIDATED',
    handoffFullyNormalized:   (humanHandoff.normalizationGaps?.length || 0) === 0,
    noSyntheticCriticalPaths: pbx.maturityLevel !== 'synthetic-assisted' && pbx.maturityLevel !== 'simulated',
    intelligenceStable:       intelligenceStability.status === 'STABLE',
    replayCoverageOk:         replayCoverage.percent >= THRESHOLDS.replayCoverageMin,
    prodLikeCoverageOk:       prodLikeCoverage.percent >= THRESHOLDS.prodLikeCoverageMin,
    noCrossReportBlockers:    (crossReport?.blockerCount || 0) === 0,
    noBlockerGaps:            blockerCount === 0,
  };

  const autonomousBlocked = Object.values(autonomousGate).some((v) => !v);
  if (autonomousBlocked) {
    // Qualquer gate que falhe força enterprise-ready — não há salto para autonomous
    return 'enterprise-ready';
  }

  return 'autonomous-ready';
}

// ─── Blockers de governance ───────────────────────────────────────────────────
function buildBlockingGaps(report, intelligenceResult, crossReport) {
  const gaps = [];

  if (report.missingArtifacts.length > 0) {
    gaps.push({
      id: 'gap-proof-missing-artifacts', severity: 'critical', area: 'proof-governance',
      title: 'Proof artifacts obrigatorios ausentes fisicamente',
      evidence: { count: report.missingArtifacts.length, sample: report.missingArtifacts.slice(0, 20) },
      suggestedFix: 'Materializar artifacts fisicos obrigatorios e reexecutar a validacao de provas.',
    });
  }

  if (report.invalidReferences.length > 0) {
    gaps.push({
      id: 'gap-proof-invalid-references', severity: 'critical', area: 'proof-governance',
      title: 'Readiness referencia arquivos que nao existem fisicamente',
      evidence: { count: report.invalidReferences.length, sample: report.invalidReferences.slice(0, 20) },
      suggestedFix: 'Remover referencias sem artifact ou materializar os arquivos fisicos esperados.',
    });
  }

  if (!report.packageValidation.ok) {
    gaps.push({
      id: 'gap-proof-package-validation', severity: 'critical', area: 'package',
      title: 'ZIP de release nao contem todos os proofs obrigatorios',
      evidence: { missingEntries: report.packageValidation.missingEntries },
      suggestedFix: 'Regenerar o pacote com todos os artifacts auditaveis e revalidar o ZIP fisico.',
    });
  }

  // FASE 16 — artefatos presentes mas semanticamente invalidos
  const semanticallyInvalid = (report.evidenceManifest?.artifacts || [])
    .filter((a) => a.proofStatus === 'invalid');
  if (semanticallyInvalid.length > 0) {
    gaps.push({
      id: 'gap-proof-invalid-artifact-semantics', severity: 'critical', area: 'proof-governance',
      title: 'Proof artifacts presentes mas semanticamente invalidos (presenca != validade)',
      evidence: {
        count: semanticallyInvalid.length,
        artifacts: semanticallyInvalid.map((a) => ({ id: a.id, path: a.path, violations: a.semanticViolations })),
      },
      suggestedFix: 'Corrigir o conteudo dos artifacts (ok/valid/status, assertions, snapshots) e regerar as evidencias.',
    });
  }

  // FASE 11 — fingerprint chain divergente: proof STALE nunca pode ser GO
  if (report.fingerprintChain?.status === 'STALE') {
    gaps.push({
      id: 'gap-proof-stale-fingerprints', severity: 'critical', area: 'proof-governance',
      title: 'Fingerprint chain divergente — codigo/cenarios/politicas mudaram apos o proof (STALE)',
      evidence: { diverged: report.fingerprintChain.diverged },
      suggestedFix: 'Regerar as evidencias e o proof sobre o codigo atual; proof STALE nunca conta como GO.',
    });
  }

  if (report.humanHandoffCoverage.status !== 'VALIDATED') {
    gaps.push({
      id: 'gap-proof-human-handoff', severity: 'high', area: 'human-handoff',
      title: 'Human handoff nao possui prova fisica enterprise completa',
      evidence: report.humanHandoffCoverage,
      suggestedFix: 'Normalizar timestamps, assignedTo, eventCount, replay e mutacoes de backend.',
    });
  }

  if (report.PBXCoverage.status !== 'VALIDATED') {
    gaps.push({
      id: 'gap-proof-pbx-prod-like', severity: 'high', area: 'pbx',
      title: `PBX prod-like — maturidade atual: ${report.PBXCoverage.maturityLevel}`,
      evidence: report.PBXCoverage,
      suggestedFix: 'Remover synthetic_insert e corrigir selftestStatus para upgrade para prod-like/enterprise-real.',
    });
  }

  if (report.omnichannelCoverage.status !== 'VALIDATED') {
    gaps.push({
      id: 'gap-proof-omnichannel-replay', severity: 'high', area: 'omnichannel',
      title: 'Replay omnichannel unificado nao possui prova fisica completa',
      evidence: report.omnichannelCoverage,
      suggestedFix: 'Persistir transicoes cross-channel, eventos WhatsApp/chat/PBX/ticket e mutacoes CRM.',
    });
  }

  if (report.digitalTwinCoverage.status !== 'VALIDATED') {
    gaps.push({
      id: 'gap-proof-digital-twin', severity: 'high', area: 'digital-twin',
      title: 'Operational Digital Twin nao possui prova fisica completa',
      evidence: report.digitalTwinCoverage,
      suggestedFix: 'Persistir snapshots, assertions, mutations e timeline fisica do twin operacional.',
    });
  }

  if (report.governanceCoverage.status !== 'VALIDATED') {
    gaps.push({
      id: 'gap-proof-governance-support', severity: 'critical', area: 'proof-governance',
      title: 'Governance signature ou cleanup proof nao possuem artifact fisico valido',
      evidence: report.governanceCoverage,
      suggestedFix: 'Persistir assinatura de governance com hashes e cleanup proof com limpeza validada.',
    });
  }

  // G. Intelligence instability gaps
  if (intelligenceResult.status === 'UNSTABLE') {
    for (const d of intelligenceResult.unstableDomains) {
      gaps.push({
        id: `gap-intelligence-unstable-${d.domain}`, severity: 'critical', area: 'qa-mesh',
        title: `Dominio '${d.domain}' instavel no QA Mesh (stability=${d.stabilityScore}, ${d.passed}/${d.total})`,
        evidence: d,
        suggestedFix: `Corrigir falhas recorrentes em ${d.domain} antes de qualquer claim enterprise ou autonomous.`,
      });
    }
    for (const f of intelligenceResult.recurringFailures) {
      gaps.push({
        id: `gap-intelligence-recurring-${f.domain}`, severity: 'critical', area: 'qa-mesh',
        title: `Falha recorrente em '${f.domain}': ${f.fingerprint}`,
        evidence: f,
        suggestedFix: 'Inspecionar o artefato e corrigir a causa raiz antes de reexecutar o wave.',
      });
    }
  }

  // Cross-report blockers
  if (crossReport && crossReport.blockerCount > 0) {
    for (const blocker of crossReport.blockers) {
      gaps.push({
        id: `gap-cross-report-${blocker.type}`, severity: 'critical', area: 'cross-report',
        title: `Contradição cross-report: ${blocker.type}`,
        evidence: blocker,
        suggestedFix: blocker.message,
      });
    }
  }

  return gaps;
}

// ─── J. Decisão final granular ────────────────────────────────────────────────
function determineFinalDecision(stage, blockingGaps) {
  if (blockingGaps.length > 0) {
    // Mesmo com blockers, identificamos o estágio máximo alcançado
    return `NO_GO:${STAGE_DECISIONS[stage] || 'UNKNOWN'}`;
  }
  return STAGE_DECISIONS[stage] || 'NO_GO:UNKNOWN';
}

// ─── Função principal ─────────────────────────────────────────────────────────
function buildFinalProofReport(context = {}) {
  const requiredArtifacts   = REQUIRED_ARTIFACT_SPECS.map(resolveArtifact);
  const referencePaths      = [
    ...(context.productionValidation || []).flatMap((item) => item.evidence || []),
    ...(context.enterpriseEvidencePaths || []),
    ...(context.additionalReferencePaths || []),
  ];
  const invalidReferences   = collectInvalidReferences(referencePaths);
  const missingArtifacts    = requiredArtifacts.filter((a) => !a.exists).map((a) => ({ id: a.id, domain: a.domain, path: a.path }));
  const foundationArtifacts = requiredArtifacts.filter((a) => a.domain === 'foundation');

  // Artefatos por domínio
  const humanHandoffArtifact           = findArtifactById(requiredArtifacts, 'human_handoff');
  const humanHandoffScreenshotsArtifact = findArtifactById(requiredArtifacts, 'human_handoff_screenshots');
  const pbxArtifact                    = findArtifactById(requiredArtifacts, 'pbx_prod_like');
  const pbxAsrTranscriptArtifact       = findArtifactById(requiredArtifacts, 'pbx_asr_transcript');
  const pbxTtsPromptsArtifact          = findArtifactById(requiredArtifacts, 'pbx_tts_prompts');
  const pbxRecordingsMetadataArtifact  = findArtifactById(requiredArtifacts, 'pbx_recordings_metadata');
  const omnichannelArtifact            = findArtifactById(requiredArtifacts, 'omnichannel_replay');
  const omnichannelCrmMutationsArtifact = findArtifactById(requiredArtifacts, 'omnichannel_crm_mutations');
  const digitalTwinSnapshotsArtifact   = findArtifactById(requiredArtifacts, 'digital_twin_snapshots');

  // Avaliações
  const humanHandoffCoverage = evaluateHumanHandoff(humanHandoffArtifact, humanHandoffScreenshotsArtifact);
  const PBXCoverage          = evaluatePbx(pbxArtifact, pbxAsrTranscriptArtifact, pbxTtsPromptsArtifact, pbxRecordingsMetadataArtifact);
  const omnichannelCoverage  = evaluateOmnichannel(omnichannelArtifact, omnichannelCrmMutationsArtifact);
  const digitalTwinCoverage  = evaluateDigitalTwin({ requiredArtifacts, humanHandoff: humanHandoffCoverage, pbx: PBXCoverage, omnichannel: omnichannelCoverage }, digitalTwinSnapshotsArtifact);
  const governanceCoverage   = evaluateGovernance(requiredArtifacts);

  // G. Intelligence stability
  const intelligenceData    = loadQaMeshIntelligence();
  const intelligenceResult  = evaluateIntelligenceStability(intelligenceData);

  // B. Cross-report consistency
  const crossReport = runCrossReportValidation({
    intelligenceData,
    handoffData:    humanHandoffArtifact.json,
    pbxData:        pbxArtifact.json,
    verticalSummaries: context.verticalSummaries || null,
    packageValidationReport: null, // será calculado abaixo
  });

  // Cobertura de replay
  const replayCoverage = {
    required: 6,
    found: Number(context.prodLikeSummary?.supportedJourneyIds?.length || 0),
  };
  replayCoverage.percent = replayCoverage.required === 0 ? 0 : Number(((replayCoverage.found / replayCoverage.required) * 100).toFixed(2));

  // D. Cobertura prod-like com hardening de vertical
  const requiredVerticalCount = Number(context.requiredVerticalCount || 6);
  const verticalCoverage = evaluateVerticalCoverage(context.verticalSummaries, requiredVerticalCount);

  const prodLikeCoverage = {
    required: requiredVerticalCount,
    found: verticalCoverage.validated,
  };
  prodLikeCoverage.percent = prodLikeCoverage.required === 0 ? 0 : Number(((prodLikeCoverage.found / prodLikeCoverage.required) * 100).toFixed(2));

  // Evidence manifest — proofStatus semântico: artefato presente com conteúdo
  // inválido (ok===false, assertion falha, snapshot inválido) é 'invalid'.
  const evidenceManifest = {
    generatedAt: new Date().toISOString(),
    runtimeRoot: getRuntimeRootSafe(),
    artifacts: requiredArtifacts.map((a) => {
      const semanticViolations = semanticArtifactViolations(a);
      return {
        id: a.id, domain: a.domain, path: a.path,
        sourcePath: a.sourcePath, resolvedPath: a.resolvedPath,
        exists: a.exists, packageRequired: a.packageRequired,
        hash: a.sha256, checksum: a.sha256, timestamp: a.timestamp,
        proofStatus: !a.exists ? 'missing' : (semanticViolations.length > 0 ? 'invalid' : 'valid'),
        semanticViolations,
        replayLinkage:     a.domain === 'pbx' ? ['pbx_voice_flow_prod_like'] : a.domain === 'human_handoff' ? ['human_handoff_full_validation'] : a.domain === 'omnichannel' ? ['omnichannel_unified_replay'] : [],
        journeyLinkage:    a.domain === 'human_handoff' ? ['human_handoff_full_validation'] : a.domain === 'pbx' ? ['pbx_voice_flow_prod_like'] : a.domain === 'omnichannel' ? ['omnichannel_unified_replay'] : [],
        governanceLinkage: a.domain === 'governance' ? ['proof_based_governance'] : ['final_decision'],
      };
    }),
  };

  // ─── FASE 11 — Fingerprint chain: CHANGED CODE → STALE PROOF ──────────────
  // A cadeia registrada no evidence-manifest anterior é comparada com a cadeia
  // atual (conteúdo, nunca timestamps). Divergência → proof STALE (nunca GO).
  // resolveWorkspacePath aceita UM targetPath — passar segmentos separados
  // resolveria para o diretório 'governance' e o manifest nunca seria lido
  // (registered=null → UNREGISTERED permanente, STALE jamais dispararia).
  const fingerprintChain = computeFingerprintChain(ROOT);
  const previousManifest = readJsonMaybe(resolveWorkspacePath(ROOT, 'governance/evidence-manifest.json'));
  const registeredFingerprints = previousManifest && previousManifest.fingerprints
    ? previousManifest.fingerprints
    : null;
  const fingerprintStatus = compareFingerprintChains(registeredFingerprints, fingerprintChain);
  evidenceManifest.fingerprints = fingerprintChain;

  // Package validation — A. Strict package binding
  let packageValidation;
  try {
    packageValidation = validatePackage({
      evidenceManifest,
      requiredEntries: requiredArtifacts.filter((a) => a.packageRequired).map((a) => a.path),
    });
  } catch (error) {
    packageValidation = {
      generatedAt: new Date().toISOString(),
      ok: false, zipPath: null, zipName: null,
      requiredEntries: requiredArtifacts.filter((a) => a.packageRequired).map((a) => a.path),
      missingEntries: [],
      error: error.message || String(error),
    };
  }

  // Proof coverage
  const proofCoverage = { total: requiredArtifacts.length, valid: requiredArtifacts.filter((a) => a.exists).length };
  proofCoverage.percent = proofCoverage.total === 0 ? 0 : Number(((proofCoverage.valid / proofCoverage.total) * 100).toFixed(2));

  // Blocker count inicial (antes de buildBlockingGaps)
  const blockerCount = Number(context.blockingGapCount || 0);

  // I. Estágio de maturidade
  const stage = determineStage({
    blockerCount, replayCoverage, prodLikeCoverage,
    omnichannel: omnichannelCoverage,
    pbx: PBXCoverage,
    humanHandoff: humanHandoffCoverage,
    digitalTwin: digitalTwinCoverage,
    governanceCoverage,
    foundationArtifacts,
    intelligenceStability: intelligenceResult,
    crossReport,
  });

  // H. Quality score
  const proofQualityScore = computeProofQualityScore({
    requiredArtifacts, humanHandoff: humanHandoffCoverage, pbx: PBXCoverage,
    omnichannel: omnichannelCoverage, digitalTwin: digitalTwinCoverage,
    governance: governanceCoverage, intelligence: intelligenceResult,
    replayCoverage, verticalCoverage, governanceCoverage,
  });

  // Gate checks
  const gateChecks = {
    blockersClear:           blockerCount === 0,
    proofsComplete:          missingArtifacts.length === 0 && invalidReferences.length === 0,
    replayCoverageOk:        replayCoverage.percent >= 100,
    prodLikeCoverageOk:      prodLikeCoverage.percent >= 100,
    omnichannelCoverageOk:   omnichannelCoverage.status === 'VALIDATED',
    PBXCoverageOk:           PBXCoverage.status === 'VALIDATED',
    pbxFullyReal:            PBXCoverage.isFullyReal === true,
    humanHandoffCoverageOk:  humanHandoffCoverage.status === 'VALIDATED',
    handoffFullyNormalized:  (humanHandoffCoverage.normalizationGaps?.length || 0) === 0,
    digitalTwinCoverageOk:   digitalTwinCoverage.status === 'VALIDATED',
    governanceCoverageOk:    governanceCoverage.status === 'VALIDATED',
    packageValidationOk:     packageValidation.ok,
    evidenceManifestValid:   evidenceManifest.artifacts.every((a) => a.proofStatus === 'valid'),
    fingerprintsFresh:       fingerprintStatus.status !== 'STALE',
    intelligenceStable:      intelligenceResult.status === 'STABLE',
    crossReportConsistent:   (crossReport?.blockerCount || 0) === 0,
    verticalCoverageValid:   verticalCoverage.invalidClaims.length === 0,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    proofCoverage,
    missingArtifacts,
    invalidReferences,
    blockerCount,
    replayCoverage,
    prodLikeCoverage,
    verticalCoverage,
    omnichannelCoverage,
    PBXCoverage,
    humanHandoffCoverage,
    digitalTwinCoverage,
    governanceCoverage,
    intelligenceStability: intelligenceResult,
    crossReportConsistency: crossReport,
    packageValidation,
    evidenceManifest,
    fingerprintChain: {
      status:     fingerprintStatus.status,
      diverged:   fingerprintStatus.diverged,
      registered: registeredFingerprints,
      current:    fingerprintChain,
    },
    proofStatus: fingerprintStatus.status, // 'FRESH' | 'STALE' | 'UNREGISTERED'
    proofQualityScore,
    decisionMatrix: {
      stages: STAGE_ORDER,
      stageDecisions: STAGE_DECISIONS,
      currentLevel: stage,
      blockersClear: gateChecks.blockersClear,
      gateChecks,
      // C. Autonomous-ready gate explícito
      autonomousReadyGate: {
        pbxFullyReal:           gateChecks.pbxFullyReal,
        omnichannelValidated:   gateChecks.omnichannelCoverageOk,
        handoffFullyNormalized: gateChecks.handoffFullyNormalized,
        noSyntheticCriticalPaths: PBXCoverage.maturityLevel !== 'synthetic-assisted' && PBXCoverage.maturityLevel !== 'simulated',
        intelligenceStable:     gateChecks.intelligenceStable,
        crossReportConsistent:  gateChecks.crossReportConsistent,
        verticalCoverageValid:  gateChecks.verticalCoverageValid,
        allPassed:              stage === 'autonomous-ready',
      },
    },
    finalDecision: 'PENDING', // placeholder
  };

  report.blockingGaps = buildBlockingGaps(report, intelligenceResult, crossReport);

  // J. Decisão final granular
  report.finalDecision = determineFinalDecision(stage, report.blockingGaps);

  return report;
}

module.exports = {
  buildFinalProofReport,
  STAGE_ORDER,
  STAGE_DECISIONS,
  REQUIRED_ARTIFACT_SPECS,
  evaluateIntelligenceStability,
  evaluateVerticalCoverage,
  evaluatePbxMaturityLevel,
  evaluateDigitalTwin,
  computeProofQualityScore,
  semanticArtifactViolations,
  validateTwinSnapshotContent,
};
