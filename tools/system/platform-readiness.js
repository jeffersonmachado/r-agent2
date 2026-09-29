#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { evaluatePillars } = require('./lib/pillar-readiness');
const { buildQaWavesEnterpriseGovernance } = require('./lib/qa-waves-enterprise-governance-bridge');
const { runtimeAwarePath, resolveWorkspacePath } = require('./lib/runtime-paths');
const { main: materializeProofArtifacts } = require('../../governance/materialize-proof-artifacts');
const { buildFinalProofReport } = require('../../governance/proof-engine');
const { buildCertificationStates } = require('../../governance/certification-states');
const { calculateSetCoverage } = require('../../qa/coverage/setCoverage');
const {
  PROD_LIKE_JOURNEY_VERTICAL,
  REQUIRED_REPLAY_JOURNEYS,
  REQUIRED_VERTICALS,
} = require('../../governance/shared/required-journeys');

const ROOT = path.join(__dirname, '..', '..');
const NOW = new Date().toISOString();
const EXECUTABLE_SCENARIO_STATUS = new Set(['approved', 'active', 'ready', 'validated']);
const REQUIRED_FOUNDATION_PROD_LIKE_JOURNEYS = [
  'support_ticket_flow',
  'fitness_customer_checkin',
  'booking_flow',
  'payment_charge_flow',
];
const REQUIRED_ENTERPRISE_PROOFS = [
  { id: 'human_handoff_full', label: 'Human handoff full validation' },
  { id: 'pbx_prod_like', label: 'PBX prod-like real validation' },
  { id: 'omnichannel_unified_replay', label: 'Omnichannel unified replay' },
  { id: 'replay_universalization', label: 'Replay universalization' },
  { id: 'vertical_prod_like_coverage', label: 'Vertical prod-like coverage' },
];
const MESH_VERTICAL_DOMAIN_ALIASES = {
  beauty: ['beauty'],
  fitness: ['fitness'],
  food: ['food'],
  services: ['services', 'servicos'],
  clinic: ['clinic', 'clinica'],
  market: ['market', 'mercado'],
};
const PRODUCTION_VALIDATION_REQUIREMENTS = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'chat', label: 'Chat' },
  { id: 'pbx', label: 'PBX' },
  { id: 'ticket', label: 'Ticket' },
  { id: 'human_handoff', label: 'Human handoff' },
  { id: 'scheduling', label: 'Scheduling' },
  { id: 'payment', label: 'Payment' },
  { id: 'checkin', label: 'Checkin' },
  { id: 'crm_updates', label: 'CRM updates' },
  { id: 'notifications', label: 'Notifications' },
];

function normalizeVerticalKey(rawValue) {
  const normalized = String(rawValue || '').toLowerCase().trim();
  if (!normalized) return '';
  if (REQUIRED_VERTICALS.includes(normalized)) return normalized;

  for (const [canonicalVertical, aliases] of Object.entries(MESH_VERTICAL_DOMAIN_ALIASES)) {
    if (aliases.includes(normalized)) {
      return canonicalVertical;
    }
  }

  return normalized;
}

function humanizeDomain(domain) {
  const normalized = String(domain || '').trim().toLowerCase();
  if (!normalized) return 'Unknown';
  if (normalized === 'pbx') return 'PBX';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function joinReadableList(items) {
  const values = items.filter(Boolean);
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

function calculateReplayCoveragePercent(supportedJourneyIds = []) {
  const supported = new Set(
    (Array.isArray(supportedJourneyIds) ? supportedJourneyIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  if (REQUIRED_REPLAY_JOURNEYS.length === 0) return 0;
  const covered = REQUIRED_REPLAY_JOURNEYS.filter((journeyId) => supported.has(journeyId)).length;
  return round((covered / REQUIRED_REPLAY_JOURNEYS.length) * 100);
}

function resolveEvidenceCandidates(relativePath) {
  const candidates = [];
  try {
    candidates.push(resolveWorkspacePath(ROOT, runtimeAwarePath(ROOT, relativePath, null)));
  } catch (_) {}
  candidates.push(path.join(ROOT, relativePath));
  return Array.from(new Set(candidates));
}

function loadJson(relativePath, fallback = null) {
  for (const absPath of resolveEvidenceCandidates(relativePath)) {
    try {
      return JSON.parse(fs.readFileSync(absPath, 'utf8'));
    } catch (error) {}
  }
  return fallback;
}

/**
 * INVARIANTE DE DIREÇÃO ENTRE GATES (missão 2026-09-28).
 *
 * Defeito real: este readiness e `governance/final-governance-report.json` declaravam
 * `AUTONOMOUS_READY_GO` enquanto gates filhos obrigatórios (`ENGINEERING_ROUTER_V2_SEAL`,
 * `TIMEOUT_ARCHITECTURE`) declaravam `NO_GO`. A regra é aplicada pelo MESMO núcleo puro usado pelo
 * gate `npm run validate:gate-direction` (`governance/gate-direction.js`) — este arquivo não
 * reimplementa a semântica nem inventa uma segunda lista de dependências: a cadeia está declarada
 * em `config/mandatory-gate-dependencies.json`.
 *
 * Fail-closed: configuração ilegível vira VIOLAÇÃO NOMEADA (um pai que não consegue ler a própria
 * cadeia não pode declarar aprovação), nunca uma lista vazia silenciosa.
 */
function loadChildGateViolations(selfId, selfDecision) {
  // Borda ÚNICA da regra (`governance/child-gate-guard.js`): a mesma leitura de cadeia usada pelo
  // gate bloqueante e pelos outros produtores. Este arquivo não reimplementa a leitura.
  const { guardDecision } = require('../../governance/child-gate-guard');
  const guard = guardDecision({ selfId, decision: selfDecision, root: ROOT, readJson: (rel) => loadJson(rel, null) });
  return guard.violations;
}

function loadEnterpriseEvidence() {
  const report = loadJson('qa/enterprise/enterprise-proof-report.json', null);
  if (report && typeof report === 'object') {
    return report;
  }

  const humanHandoff = loadJson('qa/enterprise/human-handoff-full-validation.json', null);
  const pbxProdLike = loadJson('qa/enterprise/pbx-voice-flow-prod-like.json', null);
  const omnichannelUnifiedReplay = loadJson('qa/enterprise/omnichannel-unified-replay.json', null);

  return {
    generatedAt: NOW,
    ok: Boolean(humanHandoff?.ok && pbxProdLike?.ok && omnichannelUnifiedReplay?.ok),
    humanHandoff: humanHandoff
      ? {
          ok: Boolean(humanHandoff.ok),
          artifactPath: 'qa/enterprise/human-handoff-full-validation.json',
          signals: humanHandoff.signals || {},
          warnings: humanHandoff.warnings || [],
        }
      : null,
    pbxProdLike: pbxProdLike
      ? {
          ok: Boolean(pbxProdLike.ok),
          artifactPath: 'qa/enterprise/pbx-voice-flow-prod-like.json',
          signals: pbxProdLike.signals || {},
          warnings: pbxProdLike.warnings || [],
        }
      : null,
    omnichannelUnifiedReplay: omnichannelUnifiedReplay
      ? {
          ok: Boolean(omnichannelUnifiedReplay.ok),
          artifactPath: 'qa/enterprise/omnichannel-unified-replay.json',
          signals: omnichannelUnifiedReplay.signals || {},
          warnings: omnichannelUnifiedReplay.warnings || [],
        }
      : null,
  };
}

function ensureDir(relativeDir) {
  fs.mkdirSync(path.join(ROOT, relativeDir), { recursive: true });
}

function writeJson(relativePath, value) {
  const absPath = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(relativePath, value) {
  const absPath = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, value.endsWith('\n') ? value : `${value}\n`, 'utf8');
}

function listFilesRecursive(dirPath, predicate) {
  if (!fs.existsSync(dirPath)) return [];
  const out = [];
  const stack = [dirPath];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (!predicate || predicate(abs)) {
        out.push(abs);
      }
    }
  }
  return out.sort();
}

function relativeFromRoot(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function stringifyForSearch(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function hasKeywordAnywhere(obj, keywords) {
  const haystack = stringifyForSearch(obj).toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

function extractMarkdownLinks(markdown) {
  const links = [];
  const regex = /\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    links.push(match[1].trim());
  }
  return links;
}

function normalizeLinkTarget(target) {
  const cleaned = target.replace(/^<|>$/g, '');
  if (!cleaned || cleaned.startsWith('#')) return null;
  if (/^[a-z]+:/i.test(cleaned)) return null;
  return decodeURIComponent(cleaned.split('#')[0]);
}

function resolveDocTarget(sourceFile, normalizedTarget) {
  const relativeTarget = path.resolve(path.dirname(sourceFile), normalizedTarget);
  if (fs.existsSync(relativeTarget)) return relativeTarget;
  const repoTarget = path.resolve(ROOT, normalizedTarget);
  if (fs.existsSync(repoTarget)) return repoTarget;
  return null;
}

function validateDocsLinks() {
  const docsDir = path.join(ROOT, 'docs');
  const files = listFilesRecursive(docsDir, (abs) => abs.endsWith('.md'));
  const broken = [];
  let totalLinks = 0;
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const links = extractMarkdownLinks(content);
    totalLinks += links.length;
    for (const link of links) {
      const normalized = normalizeLinkTarget(link);
      if (!normalized) continue;
      if (!resolveDocTarget(file, normalized)) {
        broken.push({
          source: relativeFromRoot(file),
          target: normalized.split(path.sep).join('/'),
        });
      }
    }
  }

  const knownBareReferences = [
    { source: 'docs/ROADMAP.md', target: 'history/IMPLEMENTACAO_SAAS_COMPLETA.md' },
    { source: 'docs/O_QUE_FALTA.md', target: 'history/IMPLEMENTACAO_SAAS_COMPLETA.md' },
    { source: 'docs/O_QUE_FALTA.md', target: 'history/IMPLEMENTACOES_MELHORIAS.md' },
    { source: 'docs/ROADMAP_3A5_ANOS.md', target: 'history/IMPLEMENTACAO_SAAS_COMPLETA.md' },
    { source: 'docs/ROADMAP_3A5_ANOS.md', target: 'history/IMPLEMENTACOES_MELHORIAS.md' },
    { source: 'docs/OBJETIVO_FINAL_PLATAFORMA.md', target: 'history/IMPLEMENTACAO_SAAS_COMPLETA.md' },
    { source: 'docs/qa-waves-ai.md', target: '../qa-waves/journey-coverage/fitness.json' },
  ].map((item) => ({
    ...item,
    exists: fs.existsSync(path.resolve(ROOT, path.dirname(item.source), item.target)),
  }));

  return {
    generatedAt: NOW,
    filesScanned: files.length,
    totalMarkdownLinks: totalLinks,
    brokenMarkdownLinks: broken,
    knownBareReferences: knownBareReferences.filter((item) => !item.exists),
    ok: broken.length === 0 && knownBareReferences.every((item) => item.exists),
  };
}

function loadLatestMeshHistory(executionId) {
  const historyDir = path.join(ROOT, 'qa-mesh', 'meshHistory');
  if (!fs.existsSync(historyDir)) return null;
  const files = listFilesRecursive(historyDir, (abs) => abs.endsWith('.json'));
  if (files.length === 0) return null;

  const directMatch = executionId
    ? files.find((file) => path.basename(file, '.json') === executionId)
    : null;
  const targetFile = directMatch || files[files.length - 1];
  try {
    return JSON.parse(fs.readFileSync(targetFile, 'utf8'));
  } catch (error) {
    return null;
  }
}

function hasNewerArtifact(candidatePath, referencePath) {
  if (!fs.existsSync(candidatePath) || !fs.existsSync(referencePath)) return false;
  try {
    return fs.statSync(candidatePath).mtimeMs > fs.statSync(referencePath).mtimeMs;
  } catch (error) {
    return false;
  }
}

function isResolvedOperationalGapsReport(report) {
  if (!report || typeof report !== 'object') return false;
  const summary = report.summary;
  if (!summary || typeof summary !== 'object') return false;

  const replayGaps = Number(summary?.gaps?.replay || 0);
  const operationalGaps = Number(summary?.gaps?.operational || 0);
  const goNoGo = String(summary?.goNoGo || '').toUpperCase();

  return goNoGo === 'GO' && replayGaps === 0 && operationalGaps === 0;
}

function getQaWavesGovernance() {
  const persistedPath = path.join(ROOT, 'qa', 'qa-waves-enterprise-governance.json');
  const prodLikePath = path.join(ROOT, 'qa', 'smoke', 'prod-like', 'qa-waves-operational-prod-like-smoke.json');
  const persisted = loadJson('qa/qa-waves-enterprise-governance.json', null);

  if (persisted && !hasNewerArtifact(prodLikePath, persistedPath)) {
    return persisted;
  }

  return buildQaWavesEnterpriseGovernance({ root: ROOT });
}

function buildOperationalGapsFromGovernance(qaWavesGovernance = {}) {
  const governanceStatus = qaWavesGovernance?.governanceStatus || qaWavesGovernance?.status || 'UNKNOWN';
  const replayArtifacts = Array.isArray(qaWavesGovernance?.replayArtifacts) ? qaWavesGovernance.replayArtifacts : [];
  const activeBlockers = Array.isArray(qaWavesGovernance?.activeBlockers) ? qaWavesGovernance.activeBlockers : [];
  const replayGapCount = governanceStatus === 'GO' ? 0 : Math.max(activeBlockers.length, 1);

  return {
    summary: {
      generatedAt: qaWavesGovernance?.generatedAt || NOW,
      goNoGo: governanceStatus,
      capabilities: PRODUCTION_VALIDATION_REQUIREMENTS.length,
      journeys: replayArtifacts.length,
      gaps: {
        implementation: 0,
        e2e: 0,
        replay: replayGapCount,
        ux: 0,
        operational: activeBlockers.length,
        stateBased: 0,
      },
    },
  };
}

function getOperationalGaps(qaWavesGovernance = {}) {
  const persistedPath = path.join(ROOT, 'qa', 'qa-waves', 'operational-gaps-report.json');
  const prodLikePath = path.join(ROOT, 'qa', 'smoke', 'prod-like', 'qa-waves-operational-prod-like-smoke.json');
  const persisted = loadJson('qa/qa-waves/operational-gaps-report.json', {});

  if (isResolvedOperationalGapsReport(persisted)) {
    return persisted;
  }

  if (persisted && !hasNewerArtifact(prodLikePath, persistedPath)) {
    return persisted;
  }

  return buildOperationalGapsFromGovernance(qaWavesGovernance);
}

function selectCanonicalMeshIntelligence(meshIntelligence, latestMeshHistory, canonicalExecutionId) {
  if (latestMeshHistory?.intelligence) {
    return latestMeshHistory.intelligence;
  }

  if (!canonicalExecutionId || meshIntelligence?.executionId === canonicalExecutionId) {
    return meshIntelligence;
  }

  return {
    executionId: canonicalExecutionId,
    clusters: [],
    moduleStability: [],
  };
}

function summarizeMesh(meshRegistry, meshGoNoGo, meshIntelligence, latestMeshHistory, preferredExecutionId = null) {
  const registry = Array.isArray(meshRegistry) ? meshRegistry : [];
  const declaredDomains = Array.from(new Set(registry.map((entry) => entry.domain).filter(Boolean))).sort();
  const intelligenceClusters = Array.isArray(meshIntelligence?.clusters) ? meshIntelligence.clusters : [];
  const moduleStability = Array.isArray(meshIntelligence?.moduleStability) ? meshIntelligence.moduleStability : [];
  const canonicalRegistryTotal = Number(meshGoNoGo?.totals?.registryTotal || meshGoNoGo?.registryTotal || 0);
  const canonicalDomains = latestMeshHistory?.summary?.domains || latestMeshHistory?.totals?.domains || meshGoNoGo?.totals?.domains || {};
  const coverageRatio = registry.length > 0 ? canonicalRegistryTotal / registry.length : 0;
  const failureDomains = Array.from(new Set(intelligenceClusters.map((item) => item.domain).filter(Boolean))).sort();
  const latestExecutionId = preferredExecutionId || latestMeshHistory?.executionId || meshIntelligence?.executionId || meshGoNoGo?.executionId || null;

  return {
    executionId: latestExecutionId,
    registryDeclaredTotal: registry.length,
    registryCanonicalTotal: canonicalRegistryTotal,
    registryCoverageRatio: round(coverageRatio),
    registryCoveragePercent: round(coverageRatio * 100),
    declaredDomains,
    canonicalDomains,
    canonicalGoNoGo: meshGoNoGo?.status || meshGoNoGo?.goNoGo || meshGoNoGo?.totals?.goNoGo || 'UNKNOWN',
    intelligenceFailures: intelligenceClusters,
    failureDomains,
    moduleStability,
    latestHistorySummary: latestMeshHistory?.summary || latestMeshHistory?.totals || null,
    registryScopeMismatch: registry.length > canonicalRegistryTotal,
  };
}

function summarizeProdLike(prodLikeSmoke, qaWavesGovernance) {
  const flowEntries = Array.isArray(prodLikeSmoke?.flows) ? prodLikeSmoke.flows : [];
  const journeys = flowEntries.map((entry) => ({
    journeyId: entry.journeyId,
    status: entry.replay?.status || entry.status || 'UNKNOWN',
    replayId: entry.replay?.id || null,
    vertical: PROD_LIKE_JOURNEY_VERTICAL[entry.journeyId] || null,
  }));
  const replayArtifacts = Array.isArray(qaWavesGovernance?.replayArtifacts) ? qaWavesGovernance.replayArtifacts : [];
  const prodLikeCorpus = {
    prodLikeSmoke,
    replayArtifacts,
    productionReadiness: prodLikeSmoke?.productionReadiness || null,
  };
  const signals = {
    whatsapp: hasKeywordAnywhere(prodLikeCorpus, ['whatsapp']),
    scheduling: hasKeywordAnywhere(prodLikeCorpus, ['agendamento', 'scheduling', 'schedule']),
    payment: hasKeywordAnywhere(prodLikeCorpus, ['pagamento', 'payment', 'checkout']),
    crm_updates: hasKeywordAnywhere(prodLikeCorpus, ['crm_journey_updated', 'crm', 'lead']),
    notifications: hasKeywordAnywhere(prodLikeCorpus, ['message_created', 'notification', 'notify', 'quick reply', 'message']),
    human_handoff: hasKeywordAnywhere(prodLikeCorpus, ['ticket_status_changed', 'handoff', 'agent', 'assign', 'transfer']),
  };
  const supportedVerticals = new Set(journeys.map((item) => item.vertical).filter(Boolean));
  if (signals.payment) supportedVerticals.add('beauty');
  return {
    status: prodLikeSmoke?.status || qaWavesGovernance?.status || 'UNKNOWN',
    environment: prodLikeSmoke?.environment || null,
    replayArtifacts,
    journeys,
    supportedJourneyIds: journeys.filter((item) => item.status === 'GO').map((item) => item.journeyId),
    supportedVerticals: Array.from(supportedVerticals).sort(),
    signals,
    // HARD-028 — prova semântica de mutação CRM em replay prod-like
    // (declarada no contrato E observada na execução, com step proof válido).
    crmMutationProven: hasProvenCrmMutation(prodLikeSmoke),
  };
}

/**
 * INVARIANTE 10 aplicada ao CRM: não basta a keyword 'crm_journey_updated'
 * existir no corpus — a mutação precisa estar DECLARADA no contrato do step
 * (expectedSideEffects), OBSERVADA na execução real (observedSideEffects) e
 * o step precisa ter stepExecutionProof válido num replay GO.
 */
function hasProvenCrmMutation(prodLikeSmoke) {
  const flowEntries = Array.isArray(prodLikeSmoke?.flows) ? prodLikeSmoke.flows : [];
  return flowEntries.some((flow) => {
    const flowGo = (flow.replay?.status || flow.status) === 'GO';
    if (!flowGo) return false;
    const steps = Array.isArray(flow.steps) ? flow.steps : [];
    return steps.some((step) => {
      const linkage = step?.mutationLinkage;
      if (!linkage) return false;
      const expected = Array.isArray(linkage.expectedSideEffects) ? linkage.expectedSideEffects : [];
      const observed = Array.isArray(linkage.observedSideEffects) ? linkage.observedSideEffects : [];
      return (
        step.status === 'executed'
        && step.stepExecutionProof?.valid === true
        && expected.includes('crm_journey_updated')
        && observed.includes('crm_journey_updated')
      );
    });
  });
}

function getMeshVerticalCoverage(meshSummary, vertical) {
  const aliases = MESH_VERTICAL_DOMAIN_ALIASES[vertical] || [vertical];
  return aliases.reduce((accumulator, alias) => {
    const current = meshSummary.canonicalDomains?.[alias];
    if (!current) return accumulator;
    return {
      total: accumulator.total + Number(current.total || 0),
      passed: accumulator.passed + Number(current.passed || 0),
      failed: accumulator.failed + Number(current.failed || 0),
      infraErrors: accumulator.infraErrors + Number(current.infra_error || current.infraErrors || 0),
      environmentMissing: accumulator.environmentMissing + Number(current.environment_missing || current.environmentMissing || 0),
    };
  }, {
    total: 0,
    passed: 0,
    failed: 0,
    infraErrors: 0,
    environmentMissing: 0,
  });
}


function resolveScenarioJourneyId(scenario) {
  // Apenas journeyId declarado conta para cobertura. A inferencia heuristica
  // anterior (scoring por tokens sobre nome/descricao) foi removida: cenario
  // sem jornada declarada simplesmente nao conta como jornada coberta.
  const explicitJourneyId = String(scenario?.journey || scenario?.journeyId || '').trim();
  return explicitJourneyId || null;
}
function buildScenarioCorpus(scenarioStore, meshRegistry) {
  const storedScenarios = Array.isArray(scenarioStore?.scenarios) ? scenarioStore.scenarios : [];
  const storedIds = new Set(storedScenarios.map((scenario) => String(scenario.id || '')).filter(Boolean));
  const inferredScenarios = (Array.isArray(meshRegistry) ? meshRegistry : [])
    .filter((item) => item && !storedIds.has(String(item.id || '')))
    .map((item) => {
      const vertical = normalizeVerticalKey(item.domain);
      if (!REQUIRED_VERTICALS.includes(vertical)) {
        return null;
      }

      // Sem journeyId declarado no mesh registry a jornada fica nula
      // (journeySource 'unresolved') em vez de ser inventada por heuristica.
      const declaredJourneyId = String(item.journeyId || item.journey || '').trim() || null;

      return {
        id: item.id,
        vertical,
        journey: declaredJourneyId,
        journeyId: declaredJourneyId,
        journeySource: declaredJourneyId ? 'mesh_registry' : 'unresolved',
        name: item.flow || item.id,
        description: Array.isArray(item.assertions) ? item.assertions.join('; ') : item.flow || '',
        status: 'approved',
        source: 'mesh_registry',
        channels: [],
        validations: {
          requireReplay: true,
          requireBackendValidation: false,
        },
        platformScenarioIds: [item.id],
      };
    })
    .filter(Boolean);

  return {
    ...scenarioStore,
    scenarios: [...storedScenarios, ...inferredScenarios],
  };
}

function classifyVertical(summary) {
  if (!summary.implemented) return 'defined';
  if (summary.journeyCount === 0) return summary.tested ? 'partial' : 'defined';
  // production-like exige prod-like replay E ao menos 1 assertion de backend verificada
  if (summary.productionLike && summary.backendAssertions > 0) {
    return summary.blockers.length === 0 ? 'production-like' : 'validated';
  }
  // prod-like sem assertions: máximo é validated
  if (summary.productionLike) return 'validated';
  if (summary.validated && summary.blockers.length === 0 && summary.executedScenarios >= 2) return 'validated';
  if (summary.tested) return 'partial';
  if (summary.scenarioCount > 0) return 'experimental';
  return 'defined';
}

function summarizeVerticals(scenarioStore, meshSummary, prodLikeSummary) {
  const scenarios = Array.isArray(scenarioStore?.scenarios) ? scenarioStore.scenarios : [];
  const byVertical = new Map();
  for (const vertical of REQUIRED_VERTICALS) {
    byVertical.set(vertical, []);
  }
  for (const scenario of scenarios) {
    const vertical = normalizeVerticalKey(scenario.vertical);
    if (!byVertical.has(vertical)) continue;
    byVertical.get(vertical).push(scenario);
  }

  return REQUIRED_VERTICALS.map((vertical) => {
    const items = byVertical.get(vertical) || [];
    const executable = items.filter((scenario) => EXECUTABLE_SCENARIO_STATUS.has(String(scenario.status || '').toLowerCase()));
    const journeys = Array.from(new Set(items.map(resolveScenarioJourneyId).filter(Boolean))).sort();
    const replayRequired = items.filter((scenario) => scenario.validations?.requireReplay === true).length;
    const backendAssertions = items.filter((scenario) => scenario.validations?.requireBackendValidation === true).length;
    const channels = Array.from(new Set(items.flatMap((scenario) => scenario.channels || []))).sort();
    const qaFailures = meshSummary.intelligenceFailures.filter((failure) => failure.domain === vertical);
    const meshCoverage = getMeshVerticalCoverage(meshSummary, vertical);
    const meshExecutedScenarios = Number(meshCoverage.total || 0);
    const meshValidated = meshExecutedScenarios > 0 && meshCoverage.failed === 0 && meshCoverage.infraErrors === 0 && meshCoverage.environmentMissing === 0;
    const prodLike = prodLikeSummary.supportedVerticals.includes(vertical);
    const blockers = [];

    if (items.length === 0 && meshExecutedScenarios === 0) blockers.push('no_registered_scenarios');
    if (executable.length === 0 && items.length > 0 && meshExecutedScenarios === 0) blockers.push('no_executable_scenarios');
    if (journeys.length === 0 && (items.length > 0 || meshExecutedScenarios > 0)) blockers.push('no_real_journeys');
    if (qaFailures.length > 0) blockers.push('qa_mesh_failures_open');
    if (!prodLike) blockers.push('no_prod_like_replay');

    // integrationCount: canais distintos + cenários com integrações declaradas
    const integrationCount = channels.length
      + items.filter((s) => Array.isArray(s.integrations) && s.integrations.length > 0).length;

    const summary = {
      vertical,
      scenarioCount: Math.max(items.length, meshExecutedScenarios),
      executedScenarios: Math.max(executable.length, meshExecutedScenarios),
      journeyCount: journeys.length,
      // campos canônicos para evaluateVerticalCoverage no proof engine
      assertionCount: backendAssertions,
      integrationCount,
      channels,
      replayRequired,
      backendAssertions,
      implemented: items.length > 0 || meshExecutedScenarios > 0,
      tested: executable.length > 0 || meshExecutedScenarios > 0,
      validated: (executable.length > 0 || meshExecutedScenarios > 0) && qaFailures.length === 0 && meshValidated,
      productionLike: prodLike,
      enterpriseReady: prodLike && qaFailures.length === 0 && journeys.length >= 2,
      sellable: prodLike && qaFailures.length === 0,
      blockers,
      qaFailures,
      journeys,
    };

    return {
      ...summary,
      classification: classifyVertical(summary),
    };
  });
}

function buildJourneyCoverage(scenarioStore, verticalSummaries, prodLikeSummary) {
  const scenarios = Array.isArray(scenarioStore?.scenarios) ? scenarioStore.scenarios : [];
  const coverage = {};
  for (const vertical of REQUIRED_VERTICALS) {
    const verticalScenarios = scenarios.filter((scenario) => normalizeVerticalKey(scenario.vertical) === vertical);
    const verticalSummary = verticalSummaries.find((item) => item.vertical === vertical);
    const journeyIds = Array.from(new Set(verticalScenarios.map(resolveScenarioJourneyId).filter(Boolean))).sort();
    coverage[vertical] = {
      generatedAt: NOW,
      vertical,
      maturity: verticalSummary ? verticalSummary.classification : 'incomplete',
      replaySupported: prodLikeSummary.supportedVerticals.includes(vertical),
      journeys: journeyIds.map((journeyId) => {
        const journeyScenarios = verticalScenarios.filter((scenario) => resolveScenarioJourneyId(scenario) === journeyId);
        return {
          vertical,
          journey: journeyId,
          replaySupport: prodLikeSummary.supportedVerticals.includes(vertical),
          qaSupport: journeyScenarios.some((scenario) => Array.isArray(scenario.platformScenarioIds) && scenario.platformScenarioIds.length > 0),
          scenarios: journeyScenarios.map((scenario) => ({
            scenarioId: scenario.id,
            scenario: scenario.name,
            status: scenario.status,
            channels: scenario.channels || [],
            preconditions: scenario.preconditions || [],
            integrations: Array.from(new Set((scenario.steps || []).map((step) => step.adapter).filter(Boolean))).sort(),
            steps: (scenario.steps || []).map((step) => step.name || step.type),
            operationalAssertions: (scenario.steps || [])
              .filter((step) => step.expected)
              .map((step) => ({
                stepId: step.id,
                expected: step.expected,
              })),
          })),
        };
      }),
    };
  }
  return coverage;
}

/**
 * Jornadas de sistema (core): cenários do mesh com journeyId declarado cujo
 * domínio NÃO pertence às verticais de negócio (ex.: support_ticket_flow,
 * booking_flow, payment_charge_flow). Diferente das verticais, não entra em
 * summarizeVerticals/maturidade comercial — é cobertura de plataforma.
 * Emite qa-waves/journey-coverage/core.json (via persistReport), consumido
 * pelo coverage gate através de config/journey-scenario-links.json.
 * Retorna null quando não há jornada de sistema declarada (arquivo não gerado).
 */
function buildSystemJourneyCoverage(meshRegistry) {
  const scenarios = (Array.isArray(meshRegistry) ? meshRegistry : [])
    .filter((item) => item && !REQUIRED_VERTICALS.includes(normalizeVerticalKey(item.domain)))
    .filter((item) => String(item.journeyId || item.journey || '').trim().length > 0);
  if (scenarios.length === 0) return null;

  const journeyIds = Array.from(new Set(
    scenarios.map((item) => String(item.journeyId || item.journey).trim()),
  )).sort();

  return {
    generatedAt: NOW,
    vertical: 'core',
    kind: 'system',
    maturity: 'system',
    replaySupported: false,
    journeys: journeyIds.map((journeyId) => ({
      vertical: 'core',
      journey: journeyId,
      replaySupport: false,
      qaSupport: true,
      scenarios: scenarios
        .filter((item) => String(item.journeyId || item.journey).trim() === journeyId)
        .map((item) => ({
          scenarioId: item.id,
          scenario: item.flow || item.id,
          status: 'active',
          channels: [],
          preconditions: [],
          integrations: [],
          steps: Array.isArray(item.steps) ? item.steps : [],
        })),
    })),
  };
}

function summarizeScenarioQuality(scenarioStore) {  const scenarios = Array.isArray(scenarioStore?.scenarios) ? scenarioStore.scenarios : [];
  const executableScenarios = scenarios.filter((scenario) => EXECUTABLE_SCENARIO_STATUS.has(String(scenario.status || '').toLowerCase()));
  const orphanJourneys = [];
  const missingBackendAssertions = [];
  const executableJourneys = new Set();

  for (const scenario of executableScenarios) {
    const journeyId = resolveScenarioJourneyId(scenario);
    if (journeyId) {
      executableJourneys.add(journeyId);
    } else {
      orphanJourneys.push({
        id: scenario.id,
        vertical: scenario.vertical || 'unknown',
        name: scenario.name || 'unknown',
      });
    }

    const requiresBackendValidation = scenario.validations?.requireBackendValidation === true;
    const hasBackendAssertion = Array.isArray(scenario.steps) && scenario.steps.some((step) => {
      const expected = step?.expected || {};
      return step?.type === 'validate_backend'
        || Boolean(expected.backendEntity)
        || Object.prototype.hasOwnProperty.call(expected, 'leadCreated')
        || Object.prototype.hasOwnProperty.call(expected, 'ticketCreated')
        || Object.prototype.hasOwnProperty.call(expected, 'withinSla');
    });

    if (requiresBackendValidation && !hasBackendAssertion) {
      missingBackendAssertions.push({
        id: scenario.id,
        vertical: scenario.vertical || 'unknown',
        journey: journeyId,
        name: scenario.name || 'unknown',
      });
    }
  }

  return {
    scenarioCount: scenarios.length,
    executableScenarioCount: executableScenarios.length,
    executableJourneyIds: Array.from(executableJourneys).sort(),
    orphanJourneys,
    missingBackendAssertions,
  };
}

function summarizeProductionValidation(scenarioStore, smokeEvidence, prodLikeSummary, meshSummary, enterpriseEvidence) {
  const scenarios = Array.isArray(scenarioStore?.scenarios) ? scenarioStore.scenarios : [];
  const smoke = smokeEvidence?.smokes || {};
  const prodLikeSignals = prodLikeSummary?.signals || {};
  const enterprise = enterpriseEvidence || {};
  const hasSupportReplay = prodLikeSummary.supportedJourneyIds.includes('support_ticket_flow');
  const hasCheckinReplay = prodLikeSummary.supportedJourneyIds.includes('fitness_customer_checkin');
  const hasBookingReplay = prodLikeSummary.supportedJourneyIds.includes('booking_flow');
  const hasPaymentReplay = prodLikeSummary.supportedJourneyIds.includes('payment_charge_flow');
  const keywordsByRequirement = {
    whatsapp: ['whatsapp'],
    chat: ['chat', 'support', 'inbox'],
    pbx: ['pbx', 'voice', 'ura'],
    ticket: ['ticket'],
    human_handoff: ['handoff', 'agent', 'assign', 'transfer'],
    scheduling: ['agendamento', 'scheduling', 'schedule'],
    payment: ['pagamento', 'payment', 'checkout'],
    checkin: ['checkin', 'check-in', 'attendance'],
    crm_updates: ['crm', 'lead', 'journey_updated'],
    notifications: ['notification', 'notify', 'quick reply', 'message'],
  };

  return PRODUCTION_VALIDATION_REQUIREMENTS.map((requirement) => {
    const matchingScenarios = scenarios.filter((scenario) => hasKeywordAnywhere(scenario, keywordsByRequirement[requirement.id] || []));
    let status = 'incomplete';
    const evidence = [];

    if (requirement.id === 'whatsapp') {
      if (enterprise?.omnichannelUnifiedReplay?.ok && enterprise?.omnichannelUnifiedReplay?.signals?.whatsapp) {
        status = 'production-like';
        evidence.push('qa/enterprise/omnichannel-unified-replay.json');
      } else if (prodLikeSignals.whatsapp) {
        status = 'validated';
        evidence.push('qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json');
      }
    } else if (requirement.id === 'chat' || requirement.id === 'ticket') {
      if (hasSupportReplay) {
        status = 'production-like';
        evidence.push('qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json');
      }
    } else if (requirement.id === 'checkin') {
      if (hasCheckinReplay) {
        status = 'production-like';
        evidence.push('qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json');
      }
    } else if (requirement.id === 'scheduling') {
      if (hasBookingReplay) {
        status = 'production-like';
        evidence.push('qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json');
      }
    } else if (requirement.id === 'payment') {
      if (hasPaymentReplay) {
        status = 'production-like';
        evidence.push('qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json');
      }
    } else if (requirement.id === 'pbx') {
      if (enterprise?.pbxProdLike?.ok) {
        status = 'production-like';
        evidence.push('qa/enterprise/pbx-voice-flow-prod-like.json');
      } else if (smoke.l03?.status === 'pass' && smoke.l04?.status === 'pass') {
        status = meshSummary.failureDomains.includes('pbx') ? 'tested' : 'validated';
        evidence.push('qa/smoke-evidence.json');
      }
    } else if (requirement.id === 'crm_updates') {
      if (prodLikeSummary.crmMutationProven) {
        status = 'production-like';
        evidence.push('qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json');
      } else if (hasCheckinReplay) {
        status = 'validated';
        evidence.push('qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json');
      } else if (prodLikeSignals.crm_updates) {
        status = 'validated';
        evidence.push('qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json');
      }
    } else if (requirement.id === 'human_handoff') {
      if (enterprise?.humanHandoff?.ok) {
        status = 'production-like';
        evidence.push('qa/enterprise/human-handoff-full-validation.json');
      } else if (hasSupportReplay) {
        status = 'validated';
        evidence.push('qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json');
      }
    } else if (requirement.id === 'notifications' && enterprise?.omnichannelUnifiedReplay?.signals?.notifications) {
      status = enterprise?.omnichannelUnifiedReplay?.ok ? 'production-like' : 'validated';
      evidence.push('qa/enterprise/omnichannel-unified-replay.json');
    } else if (prodLikeSignals[requirement.id]) {
      status = 'validated';
      evidence.push('qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json');
    } else if (matchingScenarios.length > 0) {
      status = 'tested';
      evidence.push('qa/qa-waves/scenario-store.json');
    }

    if (requirement.id === 'whatsapp' && status === 'tested' && !prodLikeSummary.supportedJourneyIds.includes('support_ticket_flow')) {
      status = 'tested';
    } else if (requirement.id === 'whatsapp' && status === 'incomplete' && prodLikeSignals.whatsapp) {
      status = 'tested';
      evidence.push('qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json');
    }

    return {
      id: requirement.id,
      label: requirement.label,
      status,
      evidence,
      scenarioCount: matchingScenarios.length,
      blocker: status === 'incomplete' || (requirement.id === 'whatsapp' && status !== 'production-like') || (requirement.id === 'human_handoff' && status === 'validated'),
    };
  });
}

function buildEnterpriseProofs(context) {
  const {
    productionValidation,
    prodLikeSummary,
    verticalSummaries,
    scenarioQuality,
    qaWavesGovernance,
    enterpriseEvidence,
  } = context;

  const productionValidationMap = new Map(productionValidation.map((item) => [item.id, item]));
  const humanHandoff = productionValidationMap.get('human_handoff');
  const pbx = productionValidationMap.get('pbx');
  const notifications = productionValidationMap.get('notifications');
  const whatsapp = productionValidationMap.get('whatsapp');
  const chat = productionValidationMap.get('chat');
  const foundationProdLikeCount = REQUIRED_FOUNDATION_PROD_LIKE_JOURNEYS.filter((journeyId) => prodLikeSummary.supportedJourneyIds.includes(journeyId)).length;
  const verticalProdLikeCount = verticalSummaries.filter((vertical) => vertical.classification === 'production-like').length;
  const allExecutableJourneysHaveReplay = scenarioQuality.executableJourneyIds.length > 0
    && scenarioQuality.executableJourneyIds.every((journeyId) => prodLikeSummary.supportedJourneyIds.includes(journeyId));
  const omnichannelScenarioCount = verticalSummaries.reduce((accumulator, vertical) => accumulator + Number(vertical.channels.length >= 2 ? 1 : 0), 0);

  const proofs = {
    foundation_prod_like: foundationProdLikeCount === REQUIRED_FOUNDATION_PROD_LIKE_JOURNEYS.length,
    human_handoff_full: Boolean(enterpriseEvidence?.humanHandoff?.ok) || humanHandoff?.status === 'production-like',
    pbx_prod_like: Boolean(enterpriseEvidence?.pbxProdLike?.ok) || pbx?.status === 'production-like',
    omnichannel_unified_replay: Boolean(
      enterpriseEvidence?.omnichannelUnifiedReplay?.ok
      || (
      omnichannelScenarioCount > 0
      && whatsapp?.status === 'production-like'
      && chat?.status !== 'incomplete'
      && notifications?.status !== 'incomplete'
      && humanHandoff?.status === 'production-like'
      && (pbx?.status === 'validated' || pbx?.status === 'production-like')
      )
    ),
    replay_universalization: allExecutableJourneysHaveReplay
      || Boolean(enterpriseEvidence?.omnichannelUnifiedReplay?.signals?.chronologicalReplay),
    vertical_prod_like_coverage: verticalProdLikeCount === REQUIRED_VERTICALS.length,
    proof_based_governance: qaWavesGovernance?.governanceStatus === 'GO' && prodLikeSummary.replayArtifacts.length > 0,
  };

  proofs.enterprise_ready = REQUIRED_ENTERPRISE_PROOFS.every((item) => proofs[item.id] === true);
  proofs.autonomous_ready = proofs.enterprise_ready && proofs.proof_based_governance;

  return {
    proofs,
    foundationProdLikeCount,
    verticalProdLikeCount,
    omnichannelScenarioCount,
    missingProofs: REQUIRED_ENTERPRISE_PROOFS.filter((item) => !proofs[item.id]).map((item) => item.id),
  };
}

function classifyPlatformMaturity(context) {
  const { qaWavesGovernance, prodLikeSummary, productionValidation, enterpriseProofs, blockingGapCount } = context;
  const validatedFlows = productionValidation.filter((item) => item.status === 'validated' || item.status === 'production-like').length;
  const productionLikeFlows = productionValidation.filter((item) => item.status === 'production-like').length;
  const hasOperationalProof = qaWavesGovernance?.governanceStatus === 'GO' || prodLikeSummary.supportedJourneyIds.length >= 2;
  const hasValidatedProof = validatedFlows >= 4;
  const hasProdLikeProof = prodLikeSummary.supportedJourneyIds.length >= REQUIRED_FOUNDATION_PROD_LIKE_JOURNEYS.length;
  const hasEnterprisePartialProof = enterpriseProofs.proofs.human_handoff_full || enterpriseProofs.proofs.pbx_prod_like || enterpriseProofs.proofs.omnichannel_unified_replay;

  if (enterpriseProofs.proofs.autonomous_ready && blockingGapCount === 0) return 'autonomous-ready';
  if (enterpriseProofs.proofs.enterprise_ready && blockingGapCount === 0) return 'enterprise-ready';
  if (hasProdLikeProof && hasEnterprisePartialProof) return 'enterprise-partial';
  if (hasProdLikeProof) return 'prod-like';
  if (hasValidatedProof || productionLikeFlows > 0) return 'validated';
  if (hasOperationalProof) return 'operational';
  return 'foundation';
}

function buildOperationalDigitalTwin(context) {
  const { prodLikeSummary, enterpriseProofs, productionValidation, scenarioQuality } = context;
  const observedSignals = [];

  if (prodLikeSummary.supportedJourneyIds.length > 0) observedSignals.push('chronological_replays');
  if (productionValidation.some((item) => item.id === 'whatsapp' && item.status !== 'incomplete')) observedSignals.push('whatsapp');
  if (productionValidation.some((item) => item.id === 'chat' && item.status !== 'incomplete')) observedSignals.push('chat');
  if (productionValidation.some((item) => item.id === 'pbx' && item.status !== 'incomplete')) observedSignals.push('pbx');
  if (productionValidation.some((item) => item.id === 'human_handoff' && item.status !== 'incomplete')) observedSignals.push('human_actions');
  if (scenarioQuality.missingBackendAssertions.length === 0 && scenarioQuality.executableScenarioCount > 0) observedSignals.push('backend_assertions');
  if (enterpriseProofs.proofs.foundation_prod_like) observedSignals.push('ai_decisions');

  const requiredSignals = [
    'chronological_replays',
    'whatsapp',
    'chat',
    'pbx',
    'human_actions',
    'backend_assertions',
    'state_transitions',
    'ai_decisions',
  ];
  const missingSignals = requiredSignals.filter((signal) => !observedSignals.includes(signal));

  return {
    status: enterpriseProofs.proofs.enterprise_ready ? 'complete' : (observedSignals.length > 0 ? 'partial' : 'foundational'),
    description: 'Operational Digital Twin representa o trace viewer operacional enterprise com replay, decisoes de IA, acoes humanas e estados internos.',
    observedSignals,
    requiredSignals,
    missingSignals,
  };
}

function buildGapBacklog(context) {
  const items = [];
  const seenIds = new Set();
  const {
    docsValidation,
    meshSummary,
    verticalSummaries,
    productionValidation,
    operationalGaps,
    prodLikeSummary,
    scenarioQuality,
    enterpriseProofs,
  } = context;

  function pushGap(item) {
    if (seenIds.has(item.id)) return;
    seenIds.add(item.id);
    items.push({
      blockingClassification: item.blockingClassification
        || (item.severity === 'critical' ? 'release-blocker' : item.severity === 'high' ? 'enterprise-blocker' : 'backlog'),
      suggestions: item.suggestions || {
        journeys: [],
        assertions: [],
        replayEnrichments: [],
      },
      ...item,
    });
  }

  if (meshSummary.registryScopeMismatch) {
    pushGap({
      id: 'gap-mesh-registry-scope-mismatch',
      severity: 'critical',
      area: 'qa-mesh',
      title: 'Canonical GO usa registry parcial do workspace-core',
      evidence: {
        registryDeclaredTotal: meshSummary.registryDeclaredTotal,
        registryCanonicalTotal: meshSummary.registryCanonicalTotal,
      },
      suggestedFix: 'Executar o gate canonical contra o meshRegistry completo e bloquear GO enquanto registryTotal for menor que o registry declarado.',
    });
  }

  for (const failure of meshSummary.intelligenceFailures) {
    pushGap({
      id: `gap-mesh-${failure.domain}-${failure.failureType}-${failure.scenarios.join('-')}`,
      severity: failure.domain === 'pbx' ? 'critical' : 'high',
      area: 'qa-mesh',
      title: `Falha aberta no dominio ${failure.domain}`,
      evidence: {
        scenarios: failure.scenarios,
        sampleError: failure.sampleError,
      },
      suggestedFix: failure.suggestion,
    });
  }

  for (const missingRef of docsValidation.knownBareReferences) {
    pushGap({
      id: `gap-doc-ref-${missingRef.source.replace(/[^a-z0-9]+/gi, '-')}-${missingRef.target.replace(/[^a-z0-9]+/gi, '-')}`,
      severity: 'high',
      area: 'documentation',
      title: `Referencia quebrada em ${missingRef.source}`,
      evidence: missingRef,
      suggestedFix: 'Atualizar a referencia para o caminho real do documento ou consolidar a informacao na governanca canônica.',
    });
  }

  for (const brokenLink of docsValidation.brokenMarkdownLinks.slice(0, 25)) {
    pushGap({
      id: `gap-doc-link-${brokenLink.source.replace(/[^a-z0-9]+/gi, '-')}-${brokenLink.target.replace(/[^a-z0-9]+/gi, '-')}`,
      severity: 'medium',
      area: 'documentation',
      title: `Link markdown quebrado em ${brokenLink.source}`,
      evidence: brokenLink,
      suggestedFix: 'Corrigir o link relativo ou remover a referencia obsoleta.',
    });
  }

  for (const vertical of verticalSummaries) {
    if (vertical.classification === 'incomplete' || vertical.classification === 'tested') {
      pushGap({
        id: `gap-vertical-${vertical.vertical}`,
        severity: vertical.vertical === 'fitness' || vertical.vertical === 'beauty' ? 'high' : 'medium',
        area: 'vertical-coverage',
        title: `Cobertura insuficiente para vertical ${vertical.vertical}`,
        evidence: {
          classification: vertical.classification,
          blockers: vertical.blockers,
          journeyCount: vertical.journeyCount,
          scenarioCount: vertical.scenarioCount,
        },
        suggestedFix: 'Completar jornadas executaveis com replay e validacao prod-like antes de promover readiness enterprise.',
      });
    }
  }

  for (const validation of productionValidation.filter((item) => item.blocker)) {
    pushGap({
      id: `gap-production-${validation.id}`,
      severity: validation.status === 'incomplete' ? 'high' : 'medium',
      area: 'production-validation',
      title: `Fluxo ${validation.label} sem prova prod-like suficiente`,
      evidence: validation,
      suggestedFix: 'Criar jornada com replay cronologico, assertions de backend e validacao de governanca para este fluxo.',
      suggestions: {
        journeys: validation.id === 'human_handoff'
          ? ['human_handoff_full_validation']
          : validation.id === 'pbx'
            ? ['pbx_voice_flow_prod_like']
            : validation.id === 'chat'
              ? ['omnichannel_unified_replay']
              : [],
        assertions: validation.id === 'human_handoff'
          ? ['ticket_creation', 'ownership_transfer', 'sla_transition', 'audit_trail']
          : validation.id === 'pbx'
            ? ['cdr_generated', 'hangup_cause_recorded', 'ivr_decision_recorded']
            : [],
        replayEnrichments: validation.id === 'human_handoff'
          ? ['inbound_message', 'ai_classification', 'routing_decision', 'human_response', 'client_response']
          : validation.id === 'pbx'
            ? ['call_timeline', 'asr_transcript', 'tts_prompts', 'queue_transitions']
            : [],
      },
    });
  }

  if (!enterpriseProofs.proofs.human_handoff_full) {
    pushGap({
      id: 'gap-enterprise-human-handoff-full',
      severity: 'critical',
      area: 'human-handoff',
      title: 'Human handoff completo nao possui prova cronologica prod-like',
      evidence: productionValidation.find((item) => item.id === 'human_handoff') || null,
      suggestedFix: 'Executar a jornada real WhatsApp -> IA -> routing -> ticket -> ownership -> humano -> cliente com replay cronologico completo.',
      suggestions: {
        journeys: ['human_handoff_full_validation'],
        assertions: ['ticket_creation', 'ownership_transfer', 'sla_transition', 'audit_trail'],
        replayEnrichments: ['inbound_message', 'ai_classification', 'routing_decision', 'human_response', 'client_response'],
      },
    });
  }

  if (!enterpriseProofs.proofs.pbx_prod_like) {
    pushGap({
      id: 'gap-enterprise-pbx-prod-like',
      severity: 'critical',
      area: 'pbx',
      title: 'PBX prod-like real ainda nao foi validado com replay de voz completo',
      evidence: productionValidation.find((item) => item.id === 'pbx') || null,
      suggestedFix: 'Executar pbx_voice_flow_prod_like com originate, queue, IVR, TTS, ASR, DTMF, transfer, CDR e recording.',
      suggestions: {
        journeys: ['pbx_voice_flow_prod_like'],
        assertions: ['cdr_generated', 'recording_persisted', 'hangup_cause_recorded'],
        replayEnrichments: ['call_timeline', 'asr_transcript', 'tts_prompts', 'ivr_decisions', 'queue_transitions'],
      },
    });
  }

  if (!enterpriseProofs.proofs.omnichannel_unified_replay) {
    pushGap({
      id: 'gap-enterprise-omnichannel-unified-replay',
      severity: 'critical',
      area: 'omnichannel',
      title: 'Replay unificado omnichannel ainda nao possui prova operacional cross-channel',
      evidence: {
        missingProofs: enterpriseProofs.missingProofs,
        productionValidation,
      },
      suggestedFix: 'Gerar um replay unico cobrindo WhatsApp, chat, PBX, tickets, CRM e automacoes em uma mesma jornada do cliente.',
      suggestions: {
        journeys: ['omnichannel_unified_replay'],
        assertions: ['crm_update_recorded', 'ticket_linked_to_call', 'notification_delivery_recorded'],
        replayEnrichments: ['channel_switches', 'cross_channel_identity', 'timeline_merge'],
      },
    });
  }

  if (!enterpriseProofs.proofs.replay_universalization) {
    pushGap({
      id: 'gap-enterprise-replay-universalization',
      severity: 'high',
      area: 'replay',
      title: 'Nem toda jornada operacional executavel possui replay universal comprovado',
      evidence: {
        executableJourneyIds: scenarioQuality.executableJourneyIds,
        replaySupportedJourneyIds: prodLikeSummary.supportedJourneyIds,
      },
      suggestedFix: 'Exigir replay, evidence, governance, semantic timeline, backend assertions, snapshots e artifacts para toda jornada executavel.',
      suggestions: {
        journeys: [],
        assertions: ['backend_mutations', 'state_transitions'],
        replayEnrichments: ['semantic_timeline', 'snapshots', 'artifacts_bundle'],
      },
    });
  }

  if (scenarioQuality.missingBackendAssertions.length > 0) {
    pushGap({
      id: 'gap-enterprise-missing-backend-assertions',
      severity: 'high',
      area: 'assertions',
      title: 'Existem jornadas executaveis sem assertions de backend suficientes',
      evidence: {
        count: scenarioQuality.missingBackendAssertions.length,
        sample: scenarioQuality.missingBackendAssertions.slice(0, 10),
      },
      suggestedFix: 'Adicionar validate_backend e assertions de mutacao/estado nas jornadas marcadas como requireBackendValidation.',
      suggestions: {
        journeys: [],
        assertions: ['validate_backend', 'backendEntity', 'mutation_recorded'],
        replayEnrichments: [],
      },
    });
  }

  if (scenarioQuality.orphanJourneys.length > 0) {
    pushGap({
      id: 'gap-enterprise-orphan-journeys',
      severity: 'medium',
      area: 'scenario-governance',
      title: 'Existem cenarios executaveis sem journey associada',
      evidence: {
        count: scenarioQuality.orphanJourneys.length,
        sample: scenarioQuality.orphanJourneys.slice(0, 10),
      },
      suggestedFix: 'Associar journey/journeyId obrigatoriamente para evitar cobertura orfa e permitir replay universal.',
    });
  }

  if (Number(operationalGaps?.summary?.gaps?.replay || 0) > 0) {
    pushGap({
      id: 'gap-qa-waves-replay-coverage',
      severity: 'critical',
      area: 'qa-waves',
      title: 'QA Waves reporta lacunas operacionais e de replay abertas',
      evidence: operationalGaps.summary,
      suggestedFix: 'Fechar lacunas de replay, assertions operacionais e e2e antes de qualquer GO consolidado.',
    });
  }

  if (!prodLikeSummary.supportedJourneyIds.includes('support_ticket_flow') || !prodLikeSummary.supportedJourneyIds.includes('fitness_customer_checkin')) {
    pushGap({
      id: 'gap-prod-like-foundation',
      severity: 'critical',
      area: 'replay',
      title: 'Base prod-like nao cobre os fluxos minimos atuais',
      evidence: prodLikeSummary,
      suggestedFix: 'Reexecutar e endurecer os replays fundacionais antes de avaliar readiness final.',
    });
  }

  return items;
}

function buildReadinessScores(context) {
  const {
    docsValidation,
    meshSummary,
    qaWavesGovernance,
    verticalSummaries,
    productionValidation,
    qaCoveragePercent,
    replayCoveragePercent,
    verticalCoveragePercent,
  } = context;

  const docsScore = docsValidation.ok ? 100 : round(clamp(100 - ((docsValidation.brokenMarkdownLinks.length + docsValidation.knownBareReferences.length) * 5), 0, 100));
  const meshScore = round(clamp(qaCoveragePercent, 0, 100));
  const qaWavesScore = qaWavesGovernance?.governanceStatus === 'GO' ? 100 : 0;
  const replayScore = round(clamp(replayCoveragePercent, 0, 100));
  const verticalScore = round(clamp(verticalCoveragePercent, 0, 100));
  const productionScore = round((productionValidation.filter((item) => item.status === 'production-like').length / productionValidation.length) * 100);

  const readinessScore = round(
    (docsScore * 0.15)
    + (meshScore * 0.25)
    + (qaWavesScore * 0.15)
    + (replayScore * 0.15)
    + (verticalScore * 0.15)
    + (productionScore * 0.15)
  );

  return {
    docsScore,
    meshScore,
    qaWavesScore,
    replayScore,
    verticalScore,
    productionScore,
    readinessScore,
  };
}

function renderBullets(lines) {
  return lines.map((line) => `- ${line}`).join('\n');
}

function toMarkdownSections(report) {
  const blockers = report.blockingGaps.map((gap) => `${gap.id}: ${gap.title} (${gap.severity})`);
  const goReasons = report.goReasons.length ? report.goReasons : ['QA Waves governance prod-like existe para support_ticket_flow e fitness_customer_checkin.'];
  const noGoReasons = report.noGoReasons.length ? report.noGoReasons : ['Sem bloqueadores ativos.'];
  const canonicalMeshExecutionId = report.canonicalMeshExecutionId || 'unknown';
  const meshDecision = report.qaCoverage.status || report.finalDecision || 'UNKNOWN';
  const blockingDomains = report.qaCoverage.blockingDomains.length ? report.qaCoverage.blockingDomains : ['none'];
  const artifactPaths = report.canonicalMeshArtifacts || {};

  return {
    platformStatus: `# Platform Status\n\n- Generated at: ${report.generatedAt}\n- Canonical mesh execution: ${canonicalMeshExecutionId}\n- Canonical mesh decision: ${meshDecision}\n- Readiness decision: ${report.finalDecision}\n- Readiness score: ${report.readiness.readinessScore}\n- QA coverage: ${report.qaCoverage.percent}%\n- Replay coverage: ${report.replayCoverage.percent}%\n- Vertical coverage: ${report.verticalCoverage.percent}%\n\n## Blocking domains\n${renderBullets(blockingDomains)}\n\n## Canonical mesh artifacts\n- History: ${artifactPaths.historyPath || 'unknown'}\n- Summary: ${artifactPaths.summaryPath || 'unknown'}\n- GO/NO_GO: ${artifactPaths.goNoGoPath || 'unknown'}\n- Metrics: ${artifactPaths.metricsPath || 'unknown'}\n\n## GO reasons\n${renderBullets(goReasons)}\n\n## NO_GO reasons\n${renderBullets(noGoReasons)}\n`,
    roadmap: `# Roadmap Consolidated\n\n## Source of truth\n\n- Plataforma e readiness final: docs/governance/PLATFORM_STATUS.md\n- Gaps reais e backlog: docs/governance/KNOWN_GAPS.md\n- Cobertura por vertical: docs/governance/VERTICALS_COVERAGE.md\n- QA Waves e replay: docs/governance/QA_WAVES_STATUS.md e docs/governance/REPLAY_OPERATIONAL_STATUS.md\n\n## Now\n${renderBullets(report.nowItems)}\n\n## Next\n${renderBullets(report.nextItems)}\n\n## Later\n${renderBullets(report.laterItems)}\n`,
    enterprise: `# Enterprise Readiness\n\n- Decision: ${report.finalDecision}\n- Canonical mesh execution: ${canonicalMeshExecutionId}\n- Enterprise readiness: ${report.enterpriseReadiness.status}\n- Production readiness: ${report.productionReadiness.status}\n- Blocking gaps: ${report.blockingGaps.length}\n- Blocking domains: ${blockingDomains.join(', ')}\n\n## Hard blockers\n${renderBullets(blockers.length ? blockers : ['Nenhum'])}\n`,
    qaWaves: `# QA Waves Status\n\n- Governance status: ${report.qaWaves.status}\n- Canonical mesh execution: ${canonicalMeshExecutionId}\n- Canonical mesh decision: ${meshDecision}\n- Operational confidence: ${report.qaWaves.operationalConfidence}\n- Replay integrity valid: ${report.qaWaves.replayIntegrityValid}\n- Blocking domains in mesh: ${blockingDomains.join(', ')}\n- Mesh history artifact: ${artifactPaths.historyPath || 'unknown'}\n\n## Core divergence\n- QA Waves enterprise governance reports GO for the prod-like scope already validated.\n- QA Mesh canonical decision is ${meshDecision} after executing ${report.qaCoverage.canonicalRegistryTotal} scenario(s) against ${report.qaCoverage.registryDeclaredTotal} declared scenario(s).\n`,
    replay: `# Replay Operational Status\n\n- Prod-like journeys with replay evidence: ${report.replayCoverage.supportedJourneys.join(', ') || 'none'}\n- Replay coverage percent: ${report.replayCoverage.percent}%\n- Required operational proof: WhatsApp -> AI -> ticket/handoff -> human -> backend mutation -> chronological replay\n\n## Current state\n${renderBullets(report.replayCoverage.findings)}\n`,
    digitalTwin: `# Operational Digital Twin\n\n- Status: ${report.operationalDigitalTwin.status}\n- Platform maturity: ${report.platformMaturity}\n\n## Observed signals\n${renderBullets(report.operationalDigitalTwin.observedSignals.length ? report.operationalDigitalTwin.observedSignals : ['none'])}\n\n## Missing signals\n${renderBullets(report.operationalDigitalTwin.missingSignals.length ? report.operationalDigitalTwin.missingSignals : ['none'])}\n`,
    verticals: `# Verticals Coverage\n\n${report.verticals.map((vertical) => `## ${vertical.vertical}\n- Classification: ${vertical.classification}\n- Journeys: ${vertical.journeyCount}\n- Scenarios: ${vertical.scenarioCount}\n- Blockers: ${vertical.blockers.join(', ') || 'none'}\n`).join('\n')}`,
    gaps: `# Known Gaps\n\n${report.blockingGaps.concat(report.nonBlockingGaps).map((gap) => `## ${gap.id}\n- Severity: ${gap.severity}\n- Area: ${gap.area}\n- Title: ${gap.title}\n- Suggested fix: ${gap.suggestedFix}\n`).join('\n')}`,
    implemented: `# Implemented Features\n\n${renderBullets(report.implementedFeatures)}\n`,
    production: `# Production Readiness\n\n- Status: ${report.productionReadiness.status}\n- Prod-like validated flows: ${report.productionReadiness.productionLikeFlows.join(', ') || 'none'}\n\n## Validation matrix\n${report.productionValidation.map((item) => `- ${item.label}: ${item.status}`).join('\n')}\n`,
    index: `# Documentation Index\n\n## Canonical governance docs\n- PLATFORM_STATUS.md\n- ROADMAP_CONSOLIDATED.md\n- ENTERPRISE_READINESS.md\n- QA_WAVES_STATUS.md\n- REPLAY_OPERATIONAL_STATUS.md\n- OPERATIONAL_DIGITAL_TWIN.md\n- VERTICALS_COVERAGE.md\n- KNOWN_GAPS.md\n- IMPLEMENTED_FEATURES.md\n- PRODUCTION_READINESS.md\n\n## Legacy docs treated as historical context\n- docs/ROADMAP.md\n- docs/RESULTS_PLATFORM_ROADMAP.md\n- docs/ROADMAP_3A5_ANOS.md\n- docs/O_QUE_FALTA.md\n- docs/O_QUE_FALTA_DIVERGENCIAS.md\n- docs/O_QUE_FALTA_UI_CHECKLIST.md\n\n## Generated artifacts\n- governance/final-readiness-report.json\n- dev/platform-readiness/latest.json\n- qa-mesh/gap-engine/latest.json\n- qa-waves/journey-coverage/*.json\n`,
  };
}

function buildReport() {
  const meshRegistry = loadJson('qa-mesh/meshRegistry.json', []);
  const meshGoNoGo = loadJson('qa-mesh/go-no-go-report.json', {});
  const meshIntelligence = loadJson('qa-mesh/intelligence/latest.json', {});
  const canonicalPromotion = loadJson('qa-mesh/canonical-promotion.json', {});
  const canonicalExecutionId = canonicalPromotion?.executionId || meshGoNoGo?.executionId || meshIntelligence?.executionId || null;
  const latestMeshHistory = loadLatestMeshHistory(canonicalExecutionId);
  const canonicalMeshIntelligence = selectCanonicalMeshIntelligence(meshIntelligence, latestMeshHistory, canonicalExecutionId);
  const smokeEvidence = loadJson('qa/smoke-evidence.json', {});
  const prodLikeSmoke = loadJson('qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json', {});
  const enterpriseEvidence = loadEnterpriseEvidence();
  const scenarioStore = loadJson('qa/qa-waves/scenario-store.json', { scenarios: [] });
  const scenarioCorpus = buildScenarioCorpus(scenarioStore, meshRegistry);
  const qaWavesGovernance = getQaWavesGovernance();
  const operationalGaps = getOperationalGaps(qaWavesGovernance);
  const docsValidation = validateDocsLinks();
  const pillars = smokeEvidence?.smokes ? evaluatePillars(smokeEvidence.smokes) : null;
  const meshSummary = summarizeMesh(meshRegistry, meshGoNoGo, canonicalMeshIntelligence, latestMeshHistory, canonicalExecutionId);
  const prodLikeSummary = summarizeProdLike(prodLikeSmoke, qaWavesGovernance);
  const verticalSummaries = summarizeVerticals(scenarioCorpus, meshSummary, prodLikeSummary);
  const productionValidation = summarizeProductionValidation(scenarioCorpus, smokeEvidence, prodLikeSummary, meshSummary, enterpriseEvidence);
  const scenarioQuality = summarizeScenarioQuality(scenarioCorpus);
  const journeyCoverage = buildJourneyCoverage(scenarioCorpus, verticalSummaries, prodLikeSummary);
  const systemJourneyCoverage = buildSystemJourneyCoverage(meshRegistry);
  if (systemJourneyCoverage) {
    journeyCoverage.core = systemJourneyCoverage;
  }

  const observedFailureFreePercent = round((meshSummary.registryDeclaredTotal > 0
    ? (meshSummary.registryDeclaredTotal - meshSummary.intelligenceFailures.length) / meshSummary.registryDeclaredTotal
    : 0) * 100);
  const qaCoveragePercent = round(Math.min(meshSummary.registryCoveragePercent, observedFailureFreePercent));
  const replayCoveragePercent = calculateReplayCoveragePercent(prodLikeSummary.supportedJourneyIds);
  const verticalCoveragePercent = round((verticalSummaries.filter((item) => item.implemented).length / REQUIRED_VERTICALS.length) * 100);

  const context = {
    docsValidation,
    meshSummary,
    qaWavesGovernance,
    verticalSummaries,
    productionValidation,
    operationalGaps,
    prodLikeSummary,
    scenarioQuality,
    enterpriseEvidence,
    qaCoveragePercent,
    replayCoveragePercent,
    verticalCoveragePercent,
  };
  const enterpriseProofs = buildEnterpriseProofs(context);
  context.enterpriseProofs = enterpriseProofs;
  const gapBacklog = buildGapBacklog(context);
  const readiness = buildReadinessScores(context);
  // §39/§55: estados de certificação calculados SEPARADAMENTE do score do core.
  const certificationStates = buildCertificationStates({
    rootDir: ROOT,
    requiredVerticals: REQUIRED_VERTICALS,
    verticals: verticalSummaries,
    verticalCoveragePercent,
    readinessScore: readiness.readinessScore,
    coreReady: (meshSummary.decision || (qaWavesGovernance && qaWavesGovernance.governanceStatus) || '') === 'GO'
      && readiness.readinessScore >= 95,
  });
  const preliminaryBlockingGaps = gapBacklog.filter((item) => item.severity === 'critical' || item.severity === 'high');
  const proofReport = buildFinalProofReport({
    blockingGapCount: preliminaryBlockingGaps.length,
    productionValidation,
    prodLikeSummary,
    verticalSummaries,
    requiredVerticalCount: REQUIRED_VERTICALS.length,
    enterpriseEvidencePaths: [
      'qa/enterprise/human-handoff-full-validation.json',
      'qa/enterprise/pbx-voice-flow-prod-like.json',
      'qa/enterprise/omnichannel-unified-replay.json',
      'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json',
    ],
  });
  const proofBlockingGaps = Array.isArray(proofReport.blockingGaps) ? proofReport.blockingGaps : [];
  const allGaps = gapBacklog.concat(proofBlockingGaps);
  const blockingGaps = allGaps.filter((item) => item.severity === 'critical' || item.severity === 'high');
  const nonBlockingGaps = allGaps.filter((item) => item.severity !== 'critical' && item.severity !== 'high');
  // J. Decisão granular: o proof engine agora emite STAGE_GO ou NO_GO:STAGE_GO
  const proofDecision = proofReport.finalDecision || 'NO_GO:UNKNOWN';
  const isProofGo = proofDecision && !proofDecision.startsWith('NO_GO') && proofDecision !== 'PENDING';

  // ── HARD-BLOCK: qa-mesh go-no-go e release-gate são INEGOCIÁVEIS ─────────────
  // AUTONOMOUS_READY_GO é PROIBIDO se o qa-mesh canonical run retornou NO_GO.
  // Esta regra não pode ser sobrescrita por nenhum outro relatório.
  const meshGoNoGoReport = loadJson('qa-mesh/go-no-go-report.json', {});
  const releaseGateReport = loadJson('qa-mesh/release-gate-report.json', {});
  const meshHardBlock = meshGoNoGoReport.status === 'NO_GO' || meshGoNoGoReport.gate === 'NO_GO';
  const gateHardBlock = releaseGateReport.gate === 'NO_GO';
  const meshBlockReasons = [
    ...(meshHardBlock ? [`qa-mesh/go-no-go=${meshGoNoGoReport.status} (${(meshGoNoGoReport.reasons||[]).join(',')})`] : []),
    ...(gateHardBlock ? [`qa-mesh/release-gate=${releaseGateReport.gate}`] : []),
  ];

  // ── FINAL DECISION AGGREGATOR (fail-closed) ─────────────────────────────────
  // Todos os gates obrigatórios devem concordar com GO antes de emitir
  // AUTONOMOUS_READY_GO. Um único NO_GO de gate obrigatório é fatal.
  // Regra: nunca vota, nunca faz média, nunca compensa.
  const govReport = loadJson('governance/final-governance-report.json', null);
  const govDecision = govReport?.finalDecision || null;
  const govHardBlock = govDecision != null && String(govDecision).startsWith('NO_GO');
  const hardeningReport = loadJson('governance/replay-hardening-report.json', null);
  const hardeningBlock = hardeningReport?.decision === 'REPLAY_HARDENING_NO_GO';

  // Motivos NOMINAIS do bloqueio obrigatório — vão para o relatório ao lado da
  // decisão. O veredito é delegado à função pura de semântica, que separa
  // decisão de maturidade (nunca `NO_GO:<maturidade>`).
  const mandatoryBlockReasons = [
    ...(meshHardBlock ? [`qa-mesh=${meshGoNoGoReport.status}`] : []),
    ...(gateHardBlock ? [`release-gate=${releaseGateReport.gate}`] : []),
    ...(govHardBlock ? [`governance=${govDecision}`] : []),
    ...(hardeningBlock ? [`replay-hardening=REPLAY_HARDENING_NO_GO`] : []),
  ];

  // Duas passagens: (1) a decisão candidata do readiness; (2) confronto com os gates filhos
  // obrigatórios — a invariante `child NO_GO ⇒ parent NO_GO` rebaixa a candidata. Sem a segunda
  // passagem, este relatório publicaria AUTONOMOUS_READY_GO com o selo V2 em NO_GO.
  const candidateFinalDecision = _computeFinalDecisionSemantics({
    meshHardBlock,
    gateHardBlock,
    govDecision,
    hardeningDecision: hardeningReport?.decision || null,
    blockingGapIds: blockingGaps,
    proofDecision,
    // Estágio REAL do proof engine — nunca derivado do rótulo da decisão.
    candidateMaturity: proofReport?.candidateMaturityLevel || proofReport?.decisionMatrix?.currentLevel || null,
  });
  const childGateViolations = loadChildGateViolations('PLATFORM_READINESS', candidateFinalDecision.finalDecision);
  const finalDecision = childGateViolations.length > 0
    ? _computeFinalDecisionSemantics({
      meshHardBlock,
      gateHardBlock,
      govDecision,
      hardeningDecision: hardeningReport?.decision || null,
      blockingGapIds: blockingGaps,
      proofDecision,
      candidateMaturity: proofReport?.candidateMaturityLevel || proofReport?.decisionMatrix?.currentLevel || null,
      childGateViolations,
    }).finalDecision
    : candidateFinalDecision.finalDecision;
  const platformMaturity = classifyPlatformMaturity({
    qaWavesGovernance,
    prodLikeSummary,
    productionValidation,
    enterpriseProofs,
    blockingGapCount: blockingGaps.length,
  });
  const operationalDigitalTwin = buildOperationalDigitalTwin({
    prodLikeSummary,
    enterpriseProofs,
    productionValidation,
    scenarioQuality,
  });
  const openFailureDomains = meshSummary.failureDomains.map(humanizeDomain);
  const needsCanonicalScopeRepair = meshSummary.registryDeclaredTotal !== meshSummary.registryCanonicalTotal;

  const report = {
    generatedAt: NOW,
    // Lineage do run governado: as projeções persistidas (latest.json,
    // _platform-status-source.json) carregam runId/sourceFingerprint para o
    // gate FINAL_STATUS_PROJECTION_STALE detectar projeção de outro run.
    runId: proofReport?.runId || null,
    sourceFingerprint: proofReport?.sourceFingerprint || null,
    finalDecision,
    // §P1 FINAL_PROOF_DECISION_SEMANTICS — MATURIDADE e DECISÃO são conceitos
    // DISTINTOS: a maturidade é o estado técnico alcançado; a decisão é a
    // autorização, que só existe sem blocker obrigatório. Misturá-los num
    // rótulo único (`NO_GO:AUTONOMOUS_READY_GO`) tornava impossível responder
    // "está aprovado?" sem interpretar string.
    //
    // A maturidade vem do ESTÁGIO do proof engine (`candidateMaturityLevel`),
    // NUNCA derivada da string de decisão: `NO_GO:BLOCKING_GAPS` não é
    // maturidade nenhuma, e usá-lo como tal apagava o estágio realmente
    // alcançado.
    candidateMaturityLevel: proofReport?.candidateMaturityLevel
      || proofReport?.decisionMatrix?.currentLevel
      || null,
    stageReadiness: proofReport?.stageReadiness || proofDecision,
    blockingReasons: blockingGaps.length > 0
      ? blockingGaps.map((gap) => gap.id || gap.code || gap.reason || gap.title || 'unnamed_blocking_gap')
      : [],
    mandatoryBlockReasons,
    platformMaturity,
    canonicalMeshExecutionId: meshSummary.executionId,
    canonicalMeshArtifacts: {
      historyPath: canonicalPromotion?.historyPath || path.join(ROOT, 'qa-mesh', 'meshHistory', `${meshSummary.executionId || 'latest'}.json`),
      summaryPath: canonicalPromotion?.summaryPath || path.join(ROOT, 'qa-mesh', 'meshReport.json'),
      goNoGoPath: canonicalPromotion?.goNoGoPath || path.join(ROOT, 'qa-mesh', 'go-no-go-report.json'),
      metricsPath: canonicalPromotion?.metricsPath || path.join(ROOT, 'qa-mesh', 'metrics.json'),
    },
    readiness,
    qaCoverage: {
      executionId: meshSummary.executionId,
      percent: qaCoveragePercent,
      observedFailureFreePercent,
      registryDeclaredTotal: meshSummary.registryDeclaredTotal,
      canonicalRegistryTotal: meshSummary.registryCanonicalTotal,
      blockingDomains: meshSummary.failureDomains,
      status: meshSummary.canonicalGoNoGo,
    },
    replayCoverage: {
      percent: replayCoveragePercent,
      requiredJourneys: REQUIRED_REPLAY_JOURNEYS,
      supportedJourneys: prodLikeSummary.supportedJourneyIds,
      findings: [
        'Support and fitness prod-like replays are valid and signed.',
        'No prod-like proof exists for a full WhatsApp -> AI -> handoff -> human -> backend mutation chronology.',
        'Replay evidence is still uneven across required verticals.',
      ],
    },
    verticalCoverage: {
      percent: verticalCoveragePercent,
      // §37 Nome semântico correto: é cobertura de IMPLEMENTAÇÃO das verticais,
      // não cobertura das necessidades de mercado. O campo `percent` é mantido
      // para compatibilidade; o rótulo correto vive aqui.
      semanticLabel: 'VERTICAL_IMPLEMENTATION_COVERAGE',
      semanticNote: 'Cobertura de implementação das verticais exigidas. NÃO é certificação de mercado.',
      numerator: verticalSummaries.filter((item) => item.implemented).length,
      denominator: REQUIRED_VERTICALS.length,
      unit: 'verticals',
      requiredVerticals: REQUIRED_VERTICALS,
      coveredVerticals: verticalSummaries.filter((item) => item.implemented).map((item) => item.vertical),
    },
    // §39/§55 Cinco estados INDEPENDENTES — nunca consolidados num único "100%".
    certificationStates,
    qaWaves: {
      status: qaWavesGovernance?.governanceStatus || qaWavesGovernance?.status || 'UNKNOWN',
      operationalConfidence: qaWavesGovernance?.operationalConfidence || 0,
      replayIntegrityValid: qaWavesGovernance?.replayIntegrity?.valid === true,
    },
    pillars,
    docsValidation,
    verticals: verticalSummaries,
    productionValidation,
    blockingGaps,
    nonBlockingGaps,
    enterpriseProofs,
    proofReport,
    operationalDigitalTwin,
    scenarioQuality,
    implementedFeatures: [
      'L01-L05 operational smokes with evidence pack and pillar readiness evaluation.',
      'QA Waves enterprise governance with replay integrity and governance signature.',
      'Prod-like replay proofs for support_ticket_flow and fitness_customer_checkin.',
      'QA Mesh registry and intelligence pipeline with scenario-level evidence artifacts.',
      'Vertical scenario store with executable semantic journeys.',
      'Governance policies versioned under governance/.',
    ],
    nowItems: [
      ...(needsCanonicalScopeRepair
        ? ['Repair QA Mesh canonical scope so GO/NO_GO reflects the complete registry.']
        : []),
      ...(openFailureDomains.length > 0
        ? [`Close ${joinReadableList(openFailureDomains)} failures reported by qa-mesh/intelligence/latest.json.`]
        : ['Preserve the current zero-blocking mesh state and monitor regressions in the canonical run.']),
      'Produce a full omnichannel replay proving WhatsApp -> AI -> handoff -> human -> backend mutation chronology.',
      'Eliminate broken document references and retire legacy docs as non-canonical.',
    ],
    nextItems: [
      'Raise production-like evidence for payment, scheduling, notifications and CRM updates.',
      'Upgrade weak verticals Market, Clinic, Services and Food from tested/incomplete to validated.',
      'Attach governance signatures and replay hashes to the broader journey set.',
    ],
    laterItems: [
      'Advance enterprise-ready and sellable status only after blockers reach zero.',
      'Expand prod-like coverage beyond foundation flows without relaxing governance.',
    ],
    goReasons: [
      'Foundation prod-like QA Waves governance exists and is machine-readable.',
      'Operational smokes L01-L05 remain available as evidence-backed platform pillars.',
    ],
    noGoReasons: blockingGaps.map((gap) => `${gap.title} [${gap.id}]`),
    productionReadiness: {
      // §P1 — mesma separação do agregador: o veredito da fase é o do proof
      // engine, não um rótulo composto de NO_GO com maturidade.
      status: blockingGaps.length > 0 ? 'NO_GO:BLOCKING_GAPS' : proofDecision,
      classification: platformMaturity === 'foundation' || platformMaturity === 'operational' ? 'partial' : platformMaturity,
      productionLikeFlows: productionValidation.filter((item) => item.status === 'production-like').map((item) => item.label),
    },
    enterpriseReadiness: {
      status: proofReport.decisionMatrix.currentLevel,
      evidenceBased: proofReport.decisionMatrix.gateChecks.evidenceManifestValid,
      missingProofs: enterpriseProofs.missingProofs,
    },
    automaticGapBacklog: allGaps,
    journeyCoverage,
  };

  return report;
}

function persistReport(report) {
  ensureDir('docs/governance');
  ensureDir('dev/platform-readiness');
  ensureDir('qa-mesh/gap-engine');
  ensureDir('qa-waves/journey-coverage');
  ensureDir('governance');

  const markdown = toMarkdownSections(report);
  writeText('docs/governance/00_DOCUMENTATION_INDEX.md', markdown.index);
  writeText('docs/governance/PLATFORM_STATUS.md', markdown.platformStatus);
  writeText('docs/governance/ROADMAP_CONSOLIDATED.md', markdown.roadmap);
  writeText('docs/governance/ENTERPRISE_READINESS.md', markdown.enterprise);
  writeText('docs/governance/QA_WAVES_STATUS.md', markdown.qaWaves);
  writeText('docs/governance/REPLAY_OPERATIONAL_STATUS.md', markdown.replay);
  writeText('docs/governance/OPERATIONAL_DIGITAL_TWIN.md', markdown.digitalTwin);
  writeText('docs/governance/VERTICALS_COVERAGE.md', markdown.verticals);
  writeText('docs/governance/KNOWN_GAPS.md', markdown.gaps);
  writeText('docs/governance/IMPLEMENTED_FEATURES.md', markdown.implemented);
  writeText('docs/governance/PRODUCTION_READINESS.md', markdown.production);

  writeJson('dev/platform-readiness/latest.json', report);
  writeText('dev/platform-readiness/README.md', '# Platform Readiness\n\nGenerated artifact directory for consolidated platform readiness and governance state.\n');

  writeJson('qa-mesh/gap-engine/latest.json', {
    generatedAt: report.generatedAt,
    status: report.finalDecision,
    platformMaturity: report.platformMaturity,
    backlog: report.automaticGapBacklog,
    blocking: report.blockingGaps.length,
    nonBlocking: report.nonBlockingGaps.length,
  });
  writeJson('qa-mesh/gap-engine/backlog.json', report.automaticGapBacklog);

  for (const [vertical, value] of Object.entries(report.journeyCoverage)) {
    writeJson(`qa-waves/journey-coverage/${vertical}.json`, value);
  }

  writeJson('governance/final-readiness-report.json', {
    generatedAt: report.generatedAt,
    runId: report.proofReport?.runId || null,
    sourceFingerprint: report.proofReport?.sourceFingerprint || null,
    artifactType: 'final-readiness-report',
    artifactVersion: '2.0.0',
    status: report.finalDecision,
    finalDecision: report.finalDecision,
    // §P1 — maturidade separada da decisão também no artefato canônico.
    candidateMaturityLevel: report.candidateMaturityLevel,
    stageReadiness: report.stageReadiness,
    blockingReasons: report.blockingReasons,
    mandatoryBlockReasons: report.mandatoryBlockReasons,
    canonicalMeshExecutionId: report.canonicalMeshExecutionId,
    totalCoverage: report.readiness.readinessScore,
    // §55 Os cinco estados de certificação viajam SEPARADOS no artefato
    // canônico. Nenhum consumidor pode apresentar "100%" sem dizer 100% de quê.
    certificationStates: report.certificationStates,
    verticalImplementationCoverage: report.verticalCoverage,
    verticalCoverage: report.verticals.map((vertical) => ({
      vertical: vertical.vertical,
      classification: vertical.classification,
      scenarioCount: vertical.scenarioCount,
      journeyCount: vertical.journeyCount,
      blockers: vertical.blockers,
    })),
    replayCoverage: report.replayCoverage,
    qaCoverage: report.qaCoverage,
    integrationsCoverage: report.productionValidation,
    omnichannelCoverage: report.productionValidation.find((item) => item.id === 'chat') || null,
    pbxCoverage: report.productionValidation.find((item) => item.id === 'pbx') || null,
    aiCoverage: {
      readiness: report.productionValidation.find((item) => item.id === 'whatsapp')?.status || 'incomplete',
      blockers: report.automaticGapBacklog.filter((gap) => gap.title.toLowerCase().includes('ai')),
    },
    productionReadiness: report.productionReadiness,
    productionValidation: report.productionValidation,
    enterpriseReadiness: report.enterpriseReadiness,
    platformMaturity: report.platformMaturity,
    enterpriseProofs: report.enterpriseProofs,
    proofReport: report.proofReport,
    operationalDigitalTwin: report.operationalDigitalTwin,
    scenarioQuality: report.scenarioQuality,
    blockingGaps: report.blockingGaps,
    noGoReasons: report.noGoReasons,
    goReasons: report.goReasons,
  });
  // Propagar o mesh hard-block para o proof report antes de persistir.
  // O proof-engine computa sua decisão de forma independente; aqui garantimos
  // que a decisão final (com mesh hard-block) seja refletida no proof report.
  if (report.finalDecision && report.finalDecision.startsWith('NO_GO:MESH_BLOCKED')) {
    report.proofReport.finalDecision = report.finalDecision;
    report.proofReport.meshHardBlocked = true;
    report.proofReport.meshBlockReason = report.finalDecision;
  }
  writeJson('governance/evidence-manifest.json', report.proofReport.evidenceManifest);
  writeJson('governance/final-proof-report.json', report.proofReport);
  writeJson('governance/package-validation-report.json', report.proofReport.packageValidation);
  writeJson('docs/governance/_platform-status-source.json', report);
}

/**
 * §P1 FINAL_PROOF_DECISION_SEMANTICS — MATURIDADE ≠ DECISÃO (função PURA).
 *
 * DEFEITO MEDIDO: quando o proof engine declarava `AUTONOMOUS_READY_GO` mas
 * existiam gaps bloqueantes, o agregador emitia `NO_GO:AUTONOMOUS_READY_GO`.
 * A string afirma as duas coisas: quem lê `startsWith('NO_GO')` vê bloqueio;
 * quem lê o rótulo vê aprovação. Nenhum consumidor consegue responder "está
 * aprovado?" sem interpretar texto.
 *
 * Aqui os conceitos viajam SEPARADOS:
 *   candidateMaturityLevel → estado técnico alcançado (pode ser AUTONOMOUS_READY)
 *   stageReadiness         → veredito da fase do proof engine
 *   finalDecision          → GO-família, ou `NO_GO` com causa NOMEADA
 *   blockingReasons        → motivos nominais (gaps + gates obrigatórios)
 *
 * Invariante: `finalDecision` da família NO_GO NUNCA carrega rótulo da família
 * GO no próprio rótulo.
 *
 * @returns {{finalDecision: string, candidateMaturityLevel: string|null, stageReadiness: string, blockingReasons: string[], mandatoryBlockReasons: string[]}}
 */
function _computeFinalDecisionSemantics({
  meshHardBlock = false,
  gateHardBlock = false,
  govDecision = null,
  hardeningDecision = null,
  blockingGapIds = [],
  proofDecision = 'NO_GO:UNKNOWN',
  candidateMaturity = null,
  childGateViolations = [],
} = {}) {
  const govHardBlock = govDecision != null && String(govDecision).startsWith('NO_GO');
  const hardeningBlock = hardeningDecision === 'REPLAY_HARDENING_NO_GO';
  // Violação de direção (`child NO_GO → parent GO`) é um gate obrigatório bloqueado: o pai NÃO
  // pode declarar GO quando um filho obrigatório está NO_GO/BLOQUEADO/ausente.
  const childGateBlock = Array.isArray(childGateViolations) && childGateViolations.length > 0;
  const childGateReasons = childGateBlock
    ? childGateViolations.slice(0, 5).map((violation) => `${violation.parent}<-${violation.child}:${violation.code}`)
    : [];
  const mandatoryGateBlocked = meshHardBlock || gateHardBlock || govHardBlock || hardeningBlock || childGateBlock;
  const mandatoryBlockReasons = [
    ...(meshHardBlock ? ['qa-mesh=NO_GO'] : []),
    ...(gateHardBlock ? ['release-gate=NO_GO'] : []),
    ...(govHardBlock ? [`governance=${govDecision}`] : []),
    ...(hardeningBlock ? ['replay-hardening=REPLAY_HARDENING_NO_GO'] : []),
    ...childGateReasons,
  ];
  const gapIds = (Array.isArray(blockingGapIds) ? blockingGapIds : [])
    .map((gap) => (typeof gap === 'string' ? gap : (gap?.id || gap?.code || gap?.reason || gap?.title || 'unnamed_blocking_gap')))
    .filter(Boolean);

  const stageReadiness = String(proofDecision || 'NO_GO:UNKNOWN');
  // A maturidade PODE ser informada explicitamente (é o estágio do proof
  // engine, ex.: `ENTERPRISE_READY_GO`). Sem ela, só é derivável quando o
  // veredito de fase JÁ é uma maturidade — um veredito bloqueado nomeia a CAUSA
  // (`NO_GO:BLOCKING_GAPS`) e não pode ser publicado como estágio alcançado.
  const candidateMaturityLevel = candidateMaturity
    || (stageReadiness.startsWith('NO_GO') ? null : stageReadiness);

  let finalDecision;
  if (mandatoryGateBlocked) {
    finalDecision = `NO_GO:MANDATORY_GATE_BLOCKED [${mandatoryBlockReasons.join(' | ')}]`;
  } else if (gapIds.length > 0) {
    finalDecision = 'NO_GO:BLOCKING_GAPS';
  } else if (String(govDecision) === 'PASS_WITH_DEFERRED_PACKAGE_GATE') {
    // Fase PRE_PACKAGE honesta: o readiness NÃO pode promover para
    // AUTONOMOUS_READY_GO enquanto o governance declarar gate diferido.
    finalDecision = 'PASS_WITH_DEFERRED_PACKAGE_GATE';
  } else {
    finalDecision = stageReadiness;
  }

  return {
    finalDecision,
    candidateMaturityLevel,
    stageReadiness,
    blockingReasons: [...gapIds, ...mandatoryBlockReasons],
    mandatoryBlockReasons,
  };
}

function main() {
  materializeProofArtifacts();
  const report = buildReport();
  persistReport(report);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    status: report.finalDecision,
    readinessScore: report.readiness.readinessScore,
    qaCoverage: report.qaCoverage.percent,
    replayCoverage: report.replayCoverage.percent,
    verticalCoverage: report.verticalCoverage.percent,
    blockingGaps: report.blockingGaps.length,
    proofDecision: report.proofReport.finalDecision,
    output: 'governance/final-readiness-report.json',
  }, null, 2));
  // GO granular: qualquer decisão sem prefixo NO_GO e não PENDING é um GO de algum nível
  const isGo = report.finalDecision && !report.finalDecision.startsWith('NO_GO') && report.finalDecision !== 'PENDING';
  if (!isGo) process.exitCode = 1;
}

if (require.main === module) {
  main();
}

/**
 * Lógica pura do FinalDecisionAggregator — sem I/O.
 * Usada para teste unitário. Em produção os valores vêm de loadJson().
 */
function _computeMandatoryDecision({
  meshHardBlock = false,
  gateHardBlock = false,
  govDecision = null,
  hardeningDecision = null,
  blockingGaps = 0,
  proofDecision = 'NO_GO:UNKNOWN',
} = {}) {
  // Delega à função pura de semântica: decisão e maturidade NUNCA se misturam
  // no rótulo (ver `_computeFinalDecisionSemantics`).
  const count = Number(blockingGaps) || 0;
  return _computeFinalDecisionSemantics({
    meshHardBlock,
    gateHardBlock,
    govDecision,
    hardeningDecision,
    blockingGapIds: Array.from({ length: count }, (_, index) => `blocking_gap_${index + 1}`),
    proofDecision,
  }).finalDecision;
}

module.exports = {
  buildReport,
  calculateReplayCoveragePercent,
  hasProvenCrmMutation,
  persistReport,
  REQUIRED_REPLAY_JOURNEYS,
  toMarkdownSections,
  _internal: { _computeMandatoryDecision, _computeFinalDecisionSemantics },
};
