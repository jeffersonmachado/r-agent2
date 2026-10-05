#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { fingerprintObject } = require('../qa/coverage/fingerprints');
const { computeSourceFingerprint } = require('./proof-engine/fingerprint-chain');
// AUTORIDADE ÚNICA da classificação temporal de artefatos. O scorecard NÃO
// implementa freshness própria: a regra `generatedAt >= run.startedAt` tem de ser
// a MESMA usada pelo estampador, pelo gate CURRENT_RUN_TEMPORAL_INTEGRITY e pelo
// verificador offline — senão o score vira o ponto permissivo por onde o passado
// volta a ter autoridade.
const {
  REASONS: TEMPORAL_REASONS,
  runStartMs,
} = require('../scripts/governance/lib/runtime-evidence-artifacts');
const {
  MASTER_SCORECARD_REGISTRY,
  REQUIRED_CATEGORIES,
} = require('./master-scorecard-registry');

const ARTIFACT_TYPE = 'rap-master-scorecard';
const ARTIFACT_VERSION = '2.0.0';
const ENGINE_VERSION = 'rap-master-scorecard-engine/v2';
const ALLOWED_REQUIREMENT_STATUSES = new Set([
  'PASS',
  'FAIL',
  'NO_GO',
  'STALE',
  'INVALID',
  'INSUFFICIENT_EVIDENCE',
]);
const ALLOWED_RUN_STATUSES = new Set([
  'CREATED',
  'RUNNING',
  'COMPLETED',
  'PACKAGED',
  'VERIFIED',
  'FAILED',
]);
const STATUS_PRIORITY = Object.freeze({
  PASS: 0,
  INSUFFICIENT_EVIDENCE: 1,
  FAIL: 2,
  NO_GO: 3,
  STALE: 4,
  INVALID: 5,
});
const GAP_SEVERITY = Object.freeze({
  IMPLEMENTED: 'high',
  INTEGRATED: 'high',
  TESTED: 'medium',
  RUNTIME_VALIDATED: 'high',
  GOVERNED: 'high',
  REGRESSION_PROTECTED: 'medium',
  CURRENT_RUN: 'critical',
  CURRENT_SOURCE: 'critical',
});

// Dimensões cuja verificação só existe na fase DELIVERED (artefato entregue).
// Em PRE_PACKAGE, seus gaps são DEFERRED (não-blocking) — não é FAIL, nem GO.
const { deliveredPhaseDimensions } = require('./release-phase-policy');
// §TAREFA 49 — dimensões de fase DELIVERED: derivação da declaração única.
const DELIVERED_PHASE_DIMENSIONS = deliveredPhaseDimensions();

function readJsonSafe(absPath) {
  if (!fs.existsSync(absPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function getByPath(value, dottedPath) {
  return String(dottedPath || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => (current == null ? undefined : current[key]), value);
}

function pathIsNonEmpty(absPath) {
  if (!fs.existsSync(absPath)) return false;
  const stat = fs.statSync(absPath);
  if (stat.isFile()) return stat.size > 0;
  if (stat.isDirectory()) return fs.readdirSync(absPath).length > 0;
  return false;
}

function result(status, code, reason, details = {}) {
  if (!ALLOWED_REQUIREMENT_STATUSES.has(status)) {
    throw new Error(`master_scorecard_invalid_requirement_status:${status}`);
  }
  return { status, code, reason, ...details };
}

function normalizeObservedStatus(value) {
  if (value === true) return 'PASS';
  if (value === false) return 'FAIL';
  return value == null ? null : String(value);
}

function acceptedStatus(observed, acceptedValues) {
  return (acceptedValues || []).some((accepted) => {
    if (accepted === observed) return true;
    return normalizeObservedStatus(accepted) === normalizeObservedStatus(observed);
  });
}

function evaluateAllPaths(spec, context) {
  const paths = Array.isArray(spec.paths) ? spec.paths : [];
  if (paths.length === 0) {
    return result(
      'INSUFFICIENT_EVIDENCE',
      'TRACEABILITY_NOT_DECLARED',
      'Nenhum caminho de fonte/prova foi declarado.',
      { paths: [] },
    );
  }

  const checked = paths.map((relPath) => ({
    path: relPath,
    exists: pathIsNonEmpty(path.join(context.rootDir, relPath)),
  }));
  const missing = checked.filter((entry) => !entry.exists).map((entry) => entry.path);
  if (missing.length > 0) {
    return result('FAIL', 'SOURCE_OR_TEST_PATH_MISSING', `Caminhos ausentes ou vazios: ${missing.join(', ')}`, {
      paths: checked,
    });
  }
  return result('PASS', 'PATHS_VERIFIED', 'Todos os caminhos declarados existem e são não vazios.', {
    paths: checked,
  });
}

function validateRunContext(runContext) {
  if (!runContext || typeof runContext !== 'object') {
    return result('INVALID', 'RUN_CONTEXT_MISSING', 'governance/.current-run.json está ausente ou inválido.');
  }
  if (!runContext.runId || typeof runContext.runId !== 'string') {
    return result('INVALID', 'RUN_ID_MISSING', 'RunContext não possui runId.');
  }
  if (!runContext.sourceFingerprint || typeof runContext.sourceFingerprint !== 'string') {
    return result('INVALID', 'RUN_SOURCE_FINGERPRINT_MISSING', 'RunContext não possui sourceFingerprint.');
  }
  if (!runContext.startedAt && !runContext.createdAt) {
    return result('INVALID', 'RUN_STARTED_AT_MISSING', 'RunContext não possui startedAt/createdAt.');
  }
  if (!runContext.status || !ALLOWED_RUN_STATUSES.has(runContext.status)) {
    return result(
      'INVALID',
      runContext.status === 'INVALIDATED' ? 'RUN_INVALIDATED' : 'RUN_STATUS_INVALID',
      `RunContext possui status não certificável: ${runContext.status || 'missing'}.`,
    );
  }
  return result('PASS', 'RUN_CONTEXT_VALID', 'RunContext está completo e em estado certificável.', {
    runId: runContext.runId,
    runStatus: runContext.status,
  });
}

function evaluateCurrentSource(context) {
  const runValidation = validateRunContext(context.runContext);
  if (runValidation.status !== 'PASS') return runValidation;
  if (context.runContext.sourceFingerprint !== context.sourceFingerprint) {
    return result('STALE', 'RUN_SOURCE_DRIFT', 'A fonte atual diverge do source freeze do run.', {
      runSourceFingerprint: context.runContext.sourceFingerprint,
      currentSourceFingerprint: context.sourceFingerprint,
    });
  }
  return result('PASS', 'CURRENT_SOURCE_VERIFIED', 'A fonte atual coincide com o source freeze do run.', {
    sourceFingerprint: context.sourceFingerprint,
  });
}

function evaluateCurrentPolicy(context) {
  const run = context.runContext;
  if (!run?.policyId || !run.policyVersion || !run.policyFingerprint) {
    return result('INSUFFICIENT_EVIDENCE', 'RUN_POLICY_MISSING', 'Run não possui policyId, policyVersion e policyFingerprint.');
  }
  if (!/^[a-f0-9]{64}$/i.test(run.policyFingerprint)) {
    return result('INVALID', 'RUN_POLICY_FINGERPRINT_INVALID', 'policyFingerprint não é SHA-256.');
  }
  return result('PASS', 'CURRENT_POLICY_VERIFIED', 'Policy congelada no run atual.', {
    policyId: run.policyId,
    policyVersion: run.policyVersion,
    policyFingerprint: run.policyFingerprint,
  });
}

function evaluateCurrentArtifact(spec, context) {
  if (!spec.path) {
    return result('INSUFFICIENT_EVIDENCE', 'ARTIFACT_PATH_NOT_DECLARED', 'Artifact governado não declarado.');
  }
  const absPath = path.join(context.rootDir, spec.path);
  if (!fs.existsSync(absPath)) {
    return result('INSUFFICIENT_EVIDENCE', 'ARTIFACT_MISSING', `Artifact ausente: ${spec.path}`, {
      path: spec.path,
    });
  }
  const artifact = readJsonSafe(absPath);
  if (!artifact || typeof artifact !== 'object') {
    return result('INVALID', 'ARTIFACT_INVALID_JSON', `Artifact inválido: ${spec.path}`, { path: spec.path });
  }

  if (spec.requireLineage !== false) {
    const runValidation = validateRunContext(context.runContext);
    if (runValidation.status !== 'PASS') return { ...runValidation, path: spec.path };
    if (!artifact.runId) {
      return result('INVALID', 'ARTIFACT_RUN_ID_MISSING', `Artifact sem runId: ${spec.path}`, { path: spec.path });
    }
    if (artifact.runId !== context.runContext.runId) {
      return result('INVALID', 'FOREIGN_RUN_ARTIFACT', `Artifact pertence a outro run: ${spec.path}`, {
        path: spec.path,
        artifactRunId: artifact.runId,
        currentRunId: context.runContext.runId,
      });
    }
    if (!artifact.sourceFingerprint) {
      return result('INVALID', 'ARTIFACT_SOURCE_FINGERPRINT_MISSING', `Artifact sem sourceFingerprint: ${spec.path}`, {
        path: spec.path,
      });
    }
    if (
      artifact.sourceFingerprint !== context.sourceFingerprint
      || artifact.sourceFingerprint !== context.runContext.sourceFingerprint
    ) {
      return result('STALE', 'STALE_ARTIFACT', `Artifact foi gerado para outra fonte: ${spec.path}`, {
        path: spec.path,
        artifactSourceFingerprint: artifact.sourceFingerprint,
        currentSourceFingerprint: context.sourceFingerprint,
      });
    }
    if (!artifact.artifactType || !artifact.artifactVersion) {
      return result('INVALID', 'ARTIFACT_CONTRACT_INCOMPLETE', `Artifact sem artifactType/artifactVersion: ${spec.path}`, {
        path: spec.path,
      });
    }
    if (!artifact.generatedAt) {
      return result('INVALID', 'ARTIFACT_GENERATED_AT_MISSING', `Artifact sem generatedAt: ${spec.path}`, {
        path: spec.path,
      });
    }
    const generatedAt = Date.parse(artifact.generatedAt);
    if (!Number.isFinite(generatedAt)) {
      return result('INVALID', 'ARTIFACT_GENERATED_AT_INVALID', `generatedAt inválido: ${spec.path}`, {
        path: spec.path,
      });
    }
    if (generatedAt > context.nowMs + 60_000) {
      return result('INVALID', 'ARTIFACT_FROM_FUTURE', `Artifact possui timestamp futuro: ${spec.path}`, {
        path: spec.path,
      });
    }
    // REGRA TEMPORAL — generatedAt >= run.startedAt (autoridade única acima).
    //
    // DEFEITO REAL (medido 2026-10-05): esta checagem não existia. Um artefato
    // produzido ANTES do início do run, estampado com o runId/sourceFingerprint
    // atuais, passava em TODAS as checagens anteriores (runId certo, fingerprint
    // certo, contrato completo, timestamp válido) e a dimensão recebia 10/10 —
    // o 78/78 ficava sustentado por evidência pré-run. O tempo é a única das
    // checagens capaz de detectar isso.
    const runStartedAtMs = runStartMs(context.runContext);
    if (runStartedAtMs !== null && generatedAt < runStartedAtMs) {
      return result('STALE', 'STALE_ARTIFACT', `Artifact gerado ANTES do início do run: ${spec.path}`, {
        path: spec.path,
        artifactGeneratedAt: artifact.generatedAt,
        runStartedAt: context.runContext.startedAt,
        rule: TEMPORAL_REASONS.STALE_ARTIFACT_PRE_RUN,
      });
    }
    const maxAgeMs = Number(spec.maxAgeMs);
    if (Number.isFinite(maxAgeMs) && context.nowMs - generatedAt > maxAgeMs) {
      return result('STALE', 'ARTIFACT_EXPIRED', `Artifact expirado: ${spec.path}`, {
        path: spec.path,
        ageMs: context.nowMs - generatedAt,
        maxAgeMs,
      });
    }
  }

  const statusPaths = Array.isArray(spec.statusPaths) ? spec.statusPaths : ['status'];
  let observed;
  let observedPath = null;
  for (const statusPath of statusPaths) {
    const candidate = getByPath(artifact, statusPath);
    if (candidate !== undefined && candidate !== null) {
      observed = candidate;
      observedPath = statusPath;
      break;
    }
  }
  if (observedPath == null) {
    return result('INSUFFICIENT_EVIDENCE', 'ARTIFACT_STATUS_MISSING', `Artifact sem decisão verificável: ${spec.path}`, {
      path: spec.path,
      statusPaths,
    });
  }
  if (acceptedStatus(observed, spec.acceptedValues)) {
    return result('PASS', 'ARTIFACT_VERIFIED', `Artifact atual aprovou: ${spec.path}`, {
      path: spec.path,
      observedStatus: observed,
      observedPath,
    });
  }

  const normalized = normalizeObservedStatus(observed) || 'UNKNOWN';
  if (normalized.includes('STALE')) {
    return result('STALE', 'ARTIFACT_REPORTED_STALE', `Artifact reporta STALE: ${spec.path}`, {
      path: spec.path,
      observedStatus: observed,
    });
  }
  if (normalized.includes('INVALID')) {
    return result('INVALID', 'ARTIFACT_REPORTED_INVALID', `Artifact reporta INVALID: ${spec.path}`, {
      path: spec.path,
      observedStatus: observed,
    });
  }
  if (normalized.includes('NO_GO')) {
    return result('NO_GO', 'MANDATORY_GATE_NO_GO', `Artifact reporta NO_GO: ${spec.path}`, {
      path: spec.path,
      observedStatus: observed,
    });
  }
  return result('FAIL', 'ARTIFACT_DID_NOT_PASS', `Artifact não aprovou: ${spec.path} (${normalized})`, {
    path: spec.path,
    observedStatus: observed,
  });
}

function evaluateEvidence(spec, context) {
  if (!spec || typeof spec !== 'object') {
    return result('INSUFFICIENT_EVIDENCE', 'EVIDENCE_SPEC_INVALID', 'Especificação de evidência ausente ou inválida.');
  }
  if (spec.type === 'all_paths_exist') return evaluateAllPaths(spec, context);
  if (spec.type === 'current_artifact') return evaluateCurrentArtifact(spec, context);
  if (spec.type === 'current_run') return validateRunContext(context.runContext);
  if (spec.type === 'current_source') return evaluateCurrentSource(context);
  if (spec.type === 'current_policy') return evaluateCurrentPolicy(context);
  if (spec.type === 'derived_no_gap' || spec.type === 'derived_no_blocker') {
    return result('INSUFFICIENT_EVIDENCE', 'DERIVED_REQUIREMENT_PENDING', 'Requisito derivado ainda não calculado.');
  }
  return result('INVALID', 'EVIDENCE_TYPE_UNKNOWN', `Tipo de evidência desconhecido: ${spec.type || 'missing'}`);
}

function aggregateEvidence(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return result('INSUFFICIENT_EVIDENCE', 'EVIDENCE_NOT_DECLARED', 'Nenhuma evidência foi declarada.');
  }
  const worst = results.reduce((selected, current) => (
    STATUS_PRIORITY[current.status] > STATUS_PRIORITY[selected.status] ? current : selected
  ));
  if (worst.status !== 'PASS') return worst;
  return result('PASS', 'ALL_EVIDENCE_PASSED', 'Todas as evidências obrigatórias passaram.');
}

function evaluateRequirement(requirement, context) {
  const evidenceResults = (requirement.evidence || []).map((spec) => evaluateEvidence(spec, context));
  const aggregate = aggregateEvidence(evidenceResults);
  return {
    id: requirement.id,
    category: requirement.category,
    mandatory: requirement.mandatory !== false,
    description: requirement.description,
    status: aggregate.status,
    code: aggregate.code,
    reason: aggregate.reason,
    validator: (requirement.evidence || [])
      .filter((spec) => spec.path)
      .map((spec) => spec.path),
    evidence: evidenceResults,
  };
}

function requirementByCategory(requirements, category) {
  return requirements.find((requirement) => requirement.category === category);
}

function requirementHasPartialPass(requirement) {
  return Boolean(requirement?.evidence?.some((entry) => entry.status === 'PASS'));
}

/**
 * Escala derivada e sequencial. Um estágio posterior nunca compensa um estágio
 * obrigatório anterior. Nota 10 é reservada a todos os mandatory=PASS.
 */
function deriveDimensionScore(requirements) {
  const byCategory = Object.fromEntries(requirements.map((item) => [item.category, item]));
  const passed = (category) => byCategory[category]?.status === 'PASS';

  if (!passed('IMPLEMENTED')) return requirementHasPartialPass(byCategory.IMPLEMENTED) ? 2 : 1;
  if (!passed('INTEGRATED')) return requirementHasPartialPass(byCategory.INTEGRATED) ? 4 : 3;
  if (!passed('TESTED')) return 5;
  if (!passed('RUNTIME_VALIDATED')) return 6;
  if (!passed('GOVERNED')) return 7;
  if (!passed('REGRESSION_PROTECTED')) return 8;

  const mandatoryFailures = requirements.filter((item) => item.mandatory && item.status !== 'PASS');
  if (mandatoryFailures.length === 0) return 10;
  const structuralFailure = mandatoryFailures.some((item) => (
    item.category === 'CURRENT_RUN'
    || item.category === 'CURRENT_SOURCE'
    || item.category === 'NO_OPEN_BLOCKER'
    || ['INVALID', 'STALE', 'NO_GO'].includes(item.status)
  ));
  return structuralFailure ? 8 : 9;
}

function gapForRequirement(dimensionDefinition, requirement, requirementIndex) {
  const files = new Set();
  for (const evidence of requirement.evidence || []) {
    for (const checkedPath of evidence.paths || []) files.add(checkedPath.path || checkedPath);
    if (evidence.path) files.add(evidence.path);
  }
  const deferredPhase = DELIVERED_PHASE_DIMENSIONS.has(dimensionDefinition.id);
  const severity = deferredPhase ? 'low' : (GAP_SEVERITY[requirement.category] || 'medium');
  return {
    id: `GAP-${dimensionDefinition.id}-${String(requirementIndex + 1).padStart(3, '0')}`,
    dimension: dimensionDefinition.id,
    requirementId: requirement.id,
    severity,
    status: deferredPhase ? 'DEFERRED' : 'OPEN',
    rootCause: requirement.code,
    description: requirement.reason,
    files: [...files],
    runtimeImpact: `${requirement.category} não está comprovado; a dimensão não pode atingir 10/10.`,
    testRequired: `Produzir prova atual e adversarial para ${requirement.id}.`,
    acceptanceCriteria: `${requirement.id} deve resultar PASS no mesmo runId e sourceFingerprint.`,
  };
}

function setDerivedRequirements(requirements, gaps) {
  const noGap = requirementByCategory(requirements, 'NO_KNOWN_GAP');
  const noBlocker = requirementByCategory(requirements, 'NO_OPEN_BLOCKER');
  const blockers = gaps.filter((gap) => gap.severity === 'critical' || gap.severity === 'high');

  Object.assign(noGap, gaps.length === 0
    ? {
      status: 'PASS', code: 'NO_KNOWN_GAP', reason: 'Nenhum gap obrigatório permanece aberto.',
      evidence: [result('PASS', 'NO_KNOWN_GAP', 'Nenhum gap obrigatório permanece aberto.')],
    }
    : {
      status: 'FAIL', code: 'OPEN_GAPS_PRESENT', reason: `${gaps.length} gap(s) obrigatório(s) aberto(s).`,
      evidence: [result('FAIL', 'OPEN_GAPS_PRESENT', `${gaps.length} gap(s) obrigatório(s) aberto(s).`)],
    });
  Object.assign(noBlocker, blockers.length === 0
    ? {
      status: 'PASS', code: 'NO_OPEN_BLOCKER', reason: 'Nenhum blocker high/critical permanece aberto.',
      evidence: [result('PASS', 'NO_OPEN_BLOCKER', 'Nenhum blocker high/critical permanece aberto.')],
    }
    : {
      status: 'FAIL', code: 'OPEN_BLOCKERS_PRESENT', reason: `${blockers.length} blocker(s) high/critical aberto(s).`,
      evidence: [result('FAIL', 'OPEN_BLOCKERS_PRESENT', `${blockers.length} blocker(s) high/critical aberto(s).`)],
    });
  return blockers;
}

function evaluateDimension(definition, context) {
  const requirements = definition.requirements.map((requirement) => evaluateRequirement(requirement, context));
  const preliminaryGaps = requirements
    .map((requirement, index) => ({ requirement, index }))
    .filter(({ requirement }) => (
      requirement.mandatory
      && requirement.status !== 'PASS'
      && !['NO_KNOWN_GAP', 'NO_OPEN_BLOCKER'].includes(requirement.category)
    ))
    .map(({ requirement, index }) => gapForRequirement(definition, requirement, index));
  const blockers = setDerivedRequirements(requirements, preliminaryGaps);
  const score = deriveDimensionScore(requirements);
  const status = score === 10 ? 'VERIFIED' : (
    requirements.some((item) => item.status === 'INVALID') ? 'INVALID'
      : requirements.some((item) => item.status === 'STALE') ? 'STALE'
        : 'IN_PROGRESS'
  );

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    ownerArea: definition.ownerArea,
    applicable: definition.applicable,
    applicabilityRationale: definition.applicabilityRationale,
    score,
    currentScore: score,
    target: 10,
    targetScore: 10,
    status,
    requirements,
    gaps: preliminaryGaps,
    blockers,
    tests: definition.traceability.tests.map((testPath) => ({ path: testPath, declared: true })),
    runtimeEvidence: definition.traceability.runtimeArtifacts.map((artifactPath) => ({ path: artifactPath })),
    traceability: definition.traceability,
    runId: context.runContext?.runId || null,
    sourceFingerprint: context.sourceFingerprint,
    lastEvaluatedAt: context.nowIso,
    validatedBy: ENGINE_VERSION,
  };
}

function validateRegistry(registry, options = {}) {
  const errors = [];
  if (!Array.isArray(registry) || registry.length === 0) return ['registry_empty'];
  const ids = registry.map((item) => item?.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) errors.push(`duplicate_ids:${[...new Set(duplicates)].join(',')}`);

  for (const definition of registry) {
    if (!definition || !/^RAP-\d{3}$/.test(definition.id || '')) {
      errors.push(`invalid_id:${definition?.id || 'missing'}`);
      continue;
    }
    if (!definition.name) errors.push(`missing_name:${definition.id}`);
    if (definition.applicable !== true && definition.applicable !== false) {
      errors.push(`missing_applicability:${definition.id}`);
    }
    const categories = (definition.requirements || []).map((requirement) => requirement.category);
    for (const category of REQUIRED_CATEGORIES) {
      const count = categories.filter((value) => value === category).length;
      if (count !== 1) errors.push(`requirement_category_${count === 0 ? 'missing' : 'duplicated'}:${definition.id}:${category}`);
    }
    for (const requirement of definition.requirements || []) {
      if (requirement.mandatory !== true) errors.push(`requirement_not_mandatory:${definition.id}:${requirement.id}`);
    }
  }

  if (options.requireCanonicalIds) {
    // Contagem canônica derivada do próprio registry (contíguo 1..N), não um
    // literal fixo: adicionar RAP-078+ não pode quebrar o gate por acidente.
    const maxNumber = registry.reduce((max, d) => Math.max(max, Number.parseInt(String(d.id || '').replace('RAP-', ''), 10) || 0), 0);
    if (registry.length !== maxNumber) errors.push(`canonical_dimension_count:${registry.length}`);
    for (let number = 1; number <= maxNumber; number += 1) {
      const expected = `RAP-${String(number).padStart(3, '0')}`;
      if (!ids.includes(expected)) errors.push(`canonical_id_missing:${expected}`);
    }
  }
  return errors;
}

function evaluateMasterScorecard(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.join(__dirname, '..'));
  const registry = options.registry || MASTER_SCORECARD_REGISTRY;
  const registryErrors = validateRegistry(registry, {
    requireCanonicalIds: options.requireCanonicalIds !== false && registry === MASTER_SCORECARD_REGISTRY,
  });
  if (registryErrors.length > 0) {
    const error = new Error(`master_scorecard_registry_invalid:${registryErrors.join('|')}`);
    error.registryErrors = registryErrors;
    throw error;
  }

  const now = options.now ? new Date(options.now) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('master_scorecard_now_invalid');
  const runContext = options.runContext !== undefined
    ? options.runContext
    : readJsonSafe(path.join(rootDir, 'governance', '.current-run.json'));
  const sourceFingerprint = options.sourceFingerprint
    || computeSourceFingerprint(rootDir);
  const context = {
    rootDir,
    runContext,
    sourceFingerprint,
    nowIso: now.toISOString(),
    nowMs: now.getTime(),
  };
  const dimensions = registry
    .filter((definition) => definition.applicable)
    .map((definition) => evaluateDimension(definition, context));
  const dimensionsAt10 = dimensions.filter((dimensionResult) => dimensionResult.score === 10).length;
  const dimensionsBelow10 = dimensions.length - dimensionsAt10;
  const gaps = dimensions.flatMap((dimensionResult) => dimensionResult.gaps);
  const blockers = dimensions.flatMap((dimensionResult) => dimensionResult.blockers);
  const mandatoryGateFailures = dimensions.reduce((total, dimensionResult) => (
    total + dimensionResult.requirements.filter((requirement) => requirement.mandatory && requirement.status !== 'PASS').length
  ), 0);
  const runValidation = validateRunContext(runContext);
  const sourceValidation = evaluateCurrentSource(context);
  const overallStatus = dimensionsBelow10 === 0 && blockers.length === 0 && mandatoryGateFailures === 0
    ? 'VERIFIED'
    : runValidation.status === 'INVALID'
      ? 'INVALID'
      : sourceValidation.status === 'STALE'
        ? 'STALE'
        : 'IN_PROGRESS';

  const scorecard = {
    schema: 'rap-master-scorecard/v2',
    artifactType: ARTIFACT_TYPE,
    artifactVersion: ARTIFACT_VERSION,
    engine: ENGINE_VERSION,
    generatedAt: context.nowIso,
    runId: runContext?.runId || null,
    runStatus: runContext?.status || null,
    sourceFingerprint,
    runSourceFingerprint: runContext?.sourceFingerprint || null,
    policyId: runContext?.policyId || null,
    policyVersion: runContext?.policyVersion || null,
    policyFingerprint: runContext?.policyFingerprint || null,
    scorecardFingerprint: null,
    overallStatus,
    scale: {
      0: 'inexistente',
      1: 'conceito registrado, sem implementação comprovada',
      2: 'protótipo ou implementação parcial isolada',
      3: 'implementação comprovada, sem integração comprovada',
      4: 'parcialmente integrada, blockers críticos',
      5: 'implementada e integrada em caminhos limitados',
      6: 'testada, sem runtime validation atual',
      7: 'runtime validada, sem governança atual completa',
      8: 'governada, com gap/blocker/regressão ainda aberto',
      9: 'muito madura, pequena lacuna comprovável permanece',
      10: 'implemented + integrated + tested + runtime validated + governed + regression protected + no known gap',
    },
    summary: {
      totalDimensions: dimensions.length,
      dimensionsAt10,
      dimensionsBelow10,
      openGaps: gaps.length,
      openBlockers: blockers.length,
      mandatoryGateFailures,
      staleArtifacts: dimensions.reduce((total, item) => total + item.requirements.filter((req) => req.status === 'STALE').length, 0),
      invalidArtifacts: dimensions.reduce((total, item) => total + item.requirements.filter((req) => req.status === 'INVALID').length, 0),
      insufficientEvidence: dimensions.reduce((total, item) => total + item.requirements.filter((req) => req.status === 'INSUFFICIENT_EVIDENCE').length, 0),
      scoreDistribution: Object.fromEntries(
        Array.from({ length: 11 }, (_, score) => [score, dimensions.filter((item) => item.score === score).length]),
      ),
    },
    dependencyOrder: [
      'CURRENT_RUN_AND_SOURCE',
      'IMPLEMENTED_AND_INTEGRATED',
      'TESTED_AND_REGRESSION_PROTECTED',
      'RUNTIME_VALIDATED',
      'GOVERNED',
      'NO_KNOWN_GAP_AND_NO_OPEN_BLOCKER',
    ],
    gaps,
    blockers,
    dimensions,
  };
  scorecard.scorecardFingerprint = fingerprintObject({
    ...scorecard,
    generatedAt: null,
    scorecardFingerprint: null,
  });
  return scorecard;
}

function writeScorecard(scorecard, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(scorecard, null, 2)}\n`, 'utf8');
}

module.exports = {
  ARTIFACT_TYPE,
  ARTIFACT_VERSION,
  ENGINE_VERSION,
  ALLOWED_REQUIREMENT_STATUSES,
  DELIVERED_PHASE_DIMENSIONS,
  evaluateEvidence,
  evaluateRequirement,
  evaluateMasterScorecard,
  deriveDimensionScore,
  validateRegistry,
  validateRunContext,
  writeScorecard,
};

if (require.main === module) {
  const rootIndex = process.argv.indexOf('--root');
  const rootDir = rootIndex >= 0 ? path.resolve(process.argv[rootIndex + 1]) : path.join(__dirname, '..');
  const outputPath = path.join(rootDir, 'governance', 'rap-master-scorecard.json');
  const scorecard = evaluateMasterScorecard({ rootDir });
  writeScorecard(scorecard, outputPath);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(scorecard.summary, null, 2));
  process.exitCode = scorecard.overallStatus === 'VERIFIED' ? 0 : 1;
}
