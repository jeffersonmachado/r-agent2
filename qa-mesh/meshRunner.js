'use strict';

const fs = require('fs');
const path = require('path');
const { SCREEN_SCENARIOS, FLOW_SCENARIOS, JOURNEY_SCENARIOS } = require('../tests/rpa/business/catalog');
const { getChangedFiles, determineAffectedScopes } = require('../qa/qaRunner');
const { evaluateGoNoGo, evaluateWaveResult } = require('./governance');
const { isTransientEnvFailure, waitForApiStable } = require('./transientEnvRetry');
const operationalStepExecutor = require('../api/services/qa/operationalStepExecutor');
const { buildFailureIntelligence } = require('./intelligence/failureIntelligence');
const rpaAdapter = require('./adapters/rpaAdapter');
const apiAdapter = require('./adapters/apiAdapter');
const pbxAdapter = require('./adapters/pbxAdapter');
const checkpointManager = require('../qa/checkpoints/checkpointManager');
const { runGenerateSummary } = require('../qa/checkpoints/generateSummary');
const { generateStabilitySnapshot } = require('../qa/mesh/intelligence/stabilityEngine');
const { persistStabilitySnapshot } = require('../qa/mesh/intelligence/stabilityHistory');
const { runLearningPipeline } = require('../qa/mesh/intelligence/learning');
const { loadBlockingJourneyEvidence } = require('./blockingJourneyEvidence');
const {
  isBusinessBatchEnabled,
  planBusinessBatches,
  executeBusinessBatches,
  parseBusinessQaReportPathFromLogs,
} = require('./businessBatchRunner');
const { isBlockingJourney: isRegistryBlockingJourney } = require('../qa/contracts/journeyCriticality');
const { belongsToTenant, normalizeTenantKey } = require('../lib/rpaSecurity');

const ROOT_DIR = path.join(__dirname, '..');
const REGISTRY_PATH = path.join(__dirname, 'meshRegistry.json');
const REPORT_PATH = process.env.QA_MESH_REPORT_PATH || path.join(__dirname, 'meshReport.json');
const HISTORY_DIR = process.env.QA_MESH_HISTORY_DIR || path.join(__dirname, 'meshHistory');
const EVIDENCE_DIR = process.env.QA_MESH_EVIDENCE_DIR || path.join(__dirname, 'meshEvidence');
const REPAIR_PLAN_PATH = process.env.QA_MESH_REPAIR_PLAN_PATH || path.join(__dirname, 'repairPlan.json');
const BASELINE_PATH = process.env.QA_MESH_BASELINE_PATH || path.join(__dirname, 'baseline.json');
const METRICS_PATH = process.env.QA_MESH_METRICS_PATH || path.join(__dirname, 'metrics.json');
const INTELLIGENCE_DIR = process.env.QA_MESH_INTELLIGENCE_DIR || path.join(__dirname, 'intelligence');
const QA_MESH_GO_NO_GO_PATH = process.env.QA_MESH_GO_NO_GO_PATH || path.join(__dirname, 'go-no-go-report.json');
const QA_MESH_RELEASE_GATE_PATH = process.env.QA_MESH_RELEASE_GATE_PATH || path.join(__dirname, 'release-gate-report.json');
const QA_MESH_CANONICAL_LOCK_PATH = process.env.QA_MESH_CANONICAL_LOCK_PATH || path.join(__dirname, 'canonical.lock.json');

/**
 * Lineage de execucao — resolvido NA ORIGEM, antes de executar.
 *
 * O run governado e fixado pelo orquestrador (release-seal/convergencia) e
 * injetado por env. Este runner NAO descobre o run depois: um relatorio de QA
 * so e prova do run que o EXECUTOU. Adotar o run mais recente a posteriori
 * transforma evidencia antiga em "evidencia" de um run onde nada rodou
 * (scripts/governance/stamp-report-lineage.js recusa esse caminho e
 * scripts/governance/validate-qa-evidence-same-run.js reprova).
 *
 * Ausente => null explicito. Nao inventamos identidade: o gate reprova
 * QA_EVIDENCE_LINEAGE_MISSING, que e o resultado honesto para execucao fora de
 * run governado (ex.: `npm run qa:mesh` local).
 */
function resolveOriginLineage() {
  const read = (name) => {
    const value = process.env[name];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  return {
    runId: read('GOVERNANCE_RUN_ID'),
    sourceFingerprint: read('GOVERNANCE_SOURCE_FINGERPRINT'),
    sourceCommit: read('GOVERNANCE_SOURCE_COMMIT'),
    sourceTree: read('GOVERNANCE_SOURCE_TREE'),
  };
}

// Configuracoes de auto-limpeza do ambiente
const MAX_HISTORY_FILES = parseInt(process.env.QA_MESH_MAX_HISTORY || '5', 10);
const MAX_EVIDENCE_DIRS = parseInt(process.env.QA_MESH_MAX_EVIDENCE || '5', 10);
const FLKY_HISTORY_WINDOW = parseInt(process.env.QA_MESH_FLKY_WINDOW || '5', 10);
const STALE_LOCK_MINUTES = parseInt(process.env.QA_MESH_STALE_LOCK_MINUTES || '30', 10);
const QA_MESH_CANONICAL_PROMOTION_PATH = process.env.QA_MESH_CANONICAL_PROMOTION_PATH || path.join(__dirname, 'canonical-promotion.json');
const SCENARIO_STORE_PATH = path.join(ROOT_DIR, 'qa', 'qa-waves', 'scenario-store.json');

function ensureMeshAuthDefaults() {
  const tenantId = process.env.TEST_TENANT_ID || 'system';
  const forceSuperadmin = process.env.QA_MESH_FORCE_SUPERADMIN !== '0';
  const username = process.env.TEST_SUPERADMIN_USERNAME
    || (forceSuperadmin ? 'systemadmin' : null)
    || process.env.TEST_USERNAME
    || process.env.TEST_ADMIN_USERNAME
    || process.env.TEST_USER_USERNAME
    || 'systemadmin';
  const password = process.env.TEST_SUPERADMIN_PASSWORD
    || (forceSuperadmin ? 'Admin123!' : null)
    || process.env.TEST_PASSWORD
    || process.env.TEST_ADMIN_PASSWORD
    || process.env.TEST_USER_PASSWORD
    || 'Admin123!';

  process.env.TEST_TENANT_ID = tenantId;
  process.env.TEST_SUPERADMIN_USERNAME = process.env.TEST_SUPERADMIN_USERNAME || username;
  process.env.TEST_SUPERADMIN_PASSWORD = process.env.TEST_SUPERADMIN_PASSWORD || password;

  if (forceSuperadmin) {
    // Evita drift de variaveis TEST_* herdadas na sessao local.
    process.env.TEST_USERNAME = process.env.TEST_SUPERADMIN_USERNAME;
    process.env.TEST_PASSWORD = process.env.TEST_SUPERADMIN_PASSWORD;
    process.env.TEST_ADMIN_USERNAME = process.env.TEST_SUPERADMIN_USERNAME;
    process.env.TEST_ADMIN_PASSWORD = process.env.TEST_SUPERADMIN_PASSWORD;
    process.env.TEST_USER_USERNAME = process.env.TEST_SUPERADMIN_USERNAME;
    process.env.TEST_USER_PASSWORD = process.env.TEST_SUPERADMIN_PASSWORD;
  } else {
    process.env.TEST_USERNAME = process.env.TEST_USERNAME || username;
    process.env.TEST_PASSWORD = process.env.TEST_PASSWORD || password;
    process.env.TEST_ADMIN_USERNAME = process.env.TEST_ADMIN_USERNAME || username;
    process.env.TEST_ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || password;
    process.env.TEST_USER_USERNAME = process.env.TEST_USER_USERNAME || username;
    process.env.TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || password;
  }
  process.env.RPA_LOGIN_STRATEGY = process.env.RPA_LOGIN_STRATEGY || 'ui_then_rpa';
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function resolveBlockingPageNullDecision(executionMode = 'operational_go') {
  return String(executionMode || 'operational_go').toLowerCase() === 'diagnostic'
    ? 'REVIEW'
    : 'NO_GO';
}

function determineExecutionOrigin(options = {}) {
  if (options.executionOrigin) return options.executionOrigin;
  if (process.env.RUNNING_IN_PIPELINE === '1') return 'pipeline';
  if (options.executionKind) return 'scheduler';
  if (Array.isArray(options.scenarioIds) && options.scenarioIds.length === 1) return 'manual_replay';
  return 'manual_run';
}

function normalizeExecutionRecord(execution) {
  if (!execution || typeof execution !== 'object') return execution;

  const summary = execution.summary && typeof execution.summary === 'object' ? execution.summary : {};
  const executionKind = execution.executionKind || summary.executionKind || null;

  let executionOrigin = execution.executionOrigin || summary.executionOrigin || null;
  if (!executionOrigin) {
    if (executionKind && ['smoke', 'critical', 'regression'].includes(executionKind)) {
      executionOrigin = 'scheduler';
    } else if (String(execution.executionId || '').startsWith('mesh-pipeline-')) {
      executionOrigin = 'pipeline';
    } else if (String(execution.executionId || '').startsWith('meshq-')) {
      executionOrigin = 'manual_run';
    } else {
      executionOrigin = 'unknown';
    }
  }

  const isCanonicalExecution = execution.isCanonicalExecution === true
    || summary.isCanonicalExecution === true
    || (executionOrigin === 'pipeline' && execution.isCanonicalExecution !== false && summary.isCanonicalExecution !== false);

  return {
    ...execution,
    executionKind,
    executionOrigin,
    isCanonicalExecution,
    summary: {
      ...summary,
      executionKind,
      executionOrigin,
      isCanonicalExecution,
    },
  };
}

function toScenarioBase(partial) {
  return {
    id: partial.id,
    domain: partial.domain || 'core',
    type: partial.type || 'technical',
    source: partial.source || 'qa',
    flow: partial.flow || partial.id,
    steps: partial.steps || [],
    assertions: partial.assertions || [],
    rpaRecordingId: partial.rpaRecordingId || null,
    criticality: partial.criticality || 'medium',
    adapter: partial.adapter || 'api',
    impactScopes: partial.impactScopes || [],
    requiresOfficialPipeline: partial.requiresOfficialPipeline === true,
    ...partial,
  };
}

function scenarioRequiresOfficialPipeline(scenario = {}) {
  if (scenario.requiresOfficialPipeline === true) return true;
  if (scenario.command !== 'node') return false;
  const args = Array.isArray(scenario.commandArgs) ? scenario.commandArgs : [];
  return args[0] === 'core/rpa/cli.js' && args[1] === 'business';
}

/**
 * Regra de `journeyId` nos cenários técnicos deste módulo (2026-09-19).
 *
 * `journeyId` só é declarado quando o ALVO do cenário corresponde EXATAMENTE a
 * uma jornada de sistema já declarada (ex.: `qa-core-auth-login` → `login`).
 * NUNCA por semelhança de token: atribuir jornada por heurística é exatamente o
 * que `resolveScenarioJourneyId` removeu de propósito ("cenário sem jornada
 * declarada simplesmente não conta como jornada coberta").
 *
 * Consequência ACEITA: as smokes técnicas abaixo não contam para jornada
 * nenhuma porque não SÃO jornadas de negócio nem de sistema — são verificação
 * de infraestrutura (PBX/voz, fila física, editor BPMN, provider omnichannel,
 * URA, exemplo didático de RPA). Isso é uma decisão registrada, não um
 * esquecimento: inventar uma jornada para elas inflaria a contagem de jornadas
 * com um cenário cada e não provaria jornada alguma.
 */
function loadQaSmokeScenarios() {
  return [
    toScenarioBase({
      id: 'qa-core-auth-login',
      domain: 'core',
      type: 'smoke',
      source: 'hybrid',
      flow: 'core_auth_login',
      // Jornada de sistema declarada: o alvo desta smoke é EXATAMENTE a jornada
      // `login` (autenticação do usuário). Sem `journeyId` o cenário executável
      // não conta para jornada nenhuma. Só é declarado quando o alvo casa
      // exatamente — nunca por semelhança de token (ver r-agent2-journey-
      // coverage-store-not-executable).
      journeyId: 'login',
      criticality: 'blocking',
      adapter: 'api',
      command: 'node',
      commandArgs: ['tests/rpa/login.test.js'],
      assertions: ['login funcional'],
      impactScopes: ['ci', 'telemetry'],
    }),
    toScenarioBase({
      id: 'qa-core-tenants-create',
      domain: 'core',
      type: 'regression',
      source: 'hybrid',
      flow: 'core_tenants_create',
      // Jornada de sistema declarada: criação de tenant é EXATAMENTE a jornada
      // `tenants` (ver comentário acima para o critério de declaração).
      journeyId: 'tenants',
      criticality: 'high',
      adapter: 'api',
      command: 'npm',
      commandArgs: ['exec', '--', 'jest', '--runTestsByPath', 'tests/rpa/createTenantByAI.test.js', '--runInBand', '--testPathIgnorePatterns', '[]'],
      assertions: ['tenant criado via fluxo oficial'],
      impactScopes: ['ci', 'telemetry'],
    }),
    toScenarioBase({
      id: 'qa-core-config-tenant-intelligence',
      domain: 'core',
      type: 'technical',
      source: 'qa',
      flow: 'core_config_tenant_intelligence',
      criticality: 'high',
      adapter: 'api',
      command: 'npm',
      commandArgs: ['run', 'test:tenant-intelligence:smoke'],
      assertions: ['configuração crítica respondendo'],
      impactScopes: ['ci', 'telemetry'],
    }),
    toScenarioBase({
      id: 'qa-physical-queue-smoke',
      domain: 'core',
      type: 'smoke',
      source: 'qa',
      flow: 'physical_queue_smoke',
      criticality: 'high',
      adapter: 'api',
      command: 'npm',
      commandArgs: ['run', 'test:physical:smoke'],
      assertions: ['fila física responde'],
      impactScopes: ['ci', 'telemetry'],
      expectedArtifacts: [path.join(ROOT_DIR, 'qa/l01-physical-queue-evidence.json')],
    }),
    toScenarioBase({
      id: 'qa-ura-publish-rollback-smoke',
      domain: 'pbx',
      type: 'smoke',
      source: 'qa',
      flow: 'ura_publish_rollback',
      criticality: 'blocking',
      adapter: 'pbx',
      command: 'npm',
      commandArgs: ['run', 'test:ura:publish-rollback:smoke'],
      assertions: ['publicação e rollback da URA'],
      impactScopes: ['ci', 'executors'],
      expectedArtifacts: [path.join(ROOT_DIR, 'qa/l02-ura-publish-rollback-evidence.json')],
    }),
    toScenarioBase({
      id: 'qa-pbx-voice-tts-asr-smoke',
      domain: 'pbx',
      type: 'technical',
      source: 'qa',
      flow: 'pbx_voice_tts_asr',
      criticality: 'blocking',
      adapter: 'pbx',
      command: 'npm',
      commandArgs: ['run', 'test:pbx:voice:tts-asr:smoke'],
      env: {
        L03_ALLOW_SYNTHETIC_ORIGINATE: 'true',
      },
      assertions: ['pipeline TTS/ASR operacional'],
      impactScopes: ['ci', 'executors'],
      expectedArtifacts: [path.join(ROOT_DIR, 'qa/l03-pbx-voice-tts-asr-evidence.json')],
    }),
    toScenarioBase({
      id: 'qa-pbx-call-events-runtime-smoke',
      domain: 'pbx',
      type: 'technical',
      source: 'qa',
      flow: 'pbx_call_events_runtime',
      criticality: 'blocking',
      adapter: 'pbx',
      command: 'npm',
      commandArgs: ['run', 'test:pbx:call-events-runtime:smoke'],
      env: {
        PBX_CALL_EVENTS_RUNTIME_INSERT_MODE: 'direct',
        PBX_CALL_EVENTS_RUNTIME_ALLOW_DB_FALLBACK: '1',
      },
      assertions: ['eventos de chamada entregues'],
      impactScopes: ['telemetry', 'executors'],
      expectedArtifacts: [path.join(ROOT_DIR, 'qa/l04-pbx-call-events-runtime-evidence.json')],
    }),
    toScenarioBase({
      id: 'qa-chatpro-omnichannel-smoke',
      domain: 'omnichannel',
      type: 'smoke',
      source: 'qa',
      flow: 'chatpro_omnichannel',
      criticality: 'blocking',
      adapter: 'api',
      command: 'npm',
      commandArgs: ['run', 'test:inbox:smoke'],
      assertions: ['tickets e fila omnichannel respondem'],
      impactScopes: ['telemetry', 'ci'],
      expectedArtifacts: [path.join(ROOT_DIR, 'qa/l05-chatpro-omnichannel-evidence.json')],
    }),
    toScenarioBase({
      id: 'qa-bpmn-editor-smoke',
      domain: 'bpmn',
      type: 'technical',
      source: 'qa',
      flow: 'bpmn_editor_smoke',
      criticality: 'high',
      adapter: 'api',
      command: 'npm',
      commandArgs: ['run', 'test:bpmn:smoke'],
      env: {
        FRONTEND_URL: process.env.TEST_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5173',
      },
      assertions: ['import/export BPMN preservado'],
      impactScopes: ['ci', 'wrappers'],
      expectedArtifacts: [
        path.join(ROOT_DIR, 'qa/l06-bpmn-editor-evidence.json'),
        path.join(ROOT_DIR, 'qa/bpmn-smoke-artifacts/diagram.bpmn'),
      ],
    }),
  ];
}

function normalizeBusinessScenario(item) {
  const modeByType = { screen: 'screens', flow: 'flows', journey: 'journeys' };
  return toScenarioBase({
    id: `business-${item.code.toLowerCase()}`,
    domain: item.vertical,
    // Jornada de sistema declarada (ex.: support_ticket_flow) — propaga para o
    // registry e permite ao platform-readiness gerar a cobertura de jornadas
    // core (qa-waves/journey-coverage/core.json) sem heurística.
    journeyId: item.journey || null,
    type: item.type === 'journey' ? 'business' : item.type === 'screen' ? 'smoke' : 'regression',
    source: item.type === 'screen' ? 'hybrid' : 'qa',
    flow: item.name,
    criticality: item.criticality === 'blocker' ? 'blocking' : item.criticality,
    adapter: 'api',
    command: 'node',
    commandArgs: ['core/rpa/cli.js', 'business', `--mode=${modeByType[item.type]}`, `--code=${item.code}`],
    // O QA mesh é o framework oficial de validação — PIPELINE_BYPASS autoriza execução sem o
    // pipeline CLI completo, sem comprometer a rastreabilidade (executionId e evidence são mantidos).
    env: { PIPELINE_BYPASS: '1' },
    assertions: item.assertions || [],
    steps: item.preconditions || [],
    impactScopes: [item.vertical, 'ci', 'telemetry'],
    scenarioCode: item.code,
    // Cenários sensíveis a estado compartilhado (browser/seed) são excluídos
    // do batching e executados em processo isolado (ver businessBatchRunner).
    requiresIsolatedExecution: item.requiresIsolatedExecution === true,
    requiresOfficialPipeline: true,
  });
}

function inferFlowDomain(recording) {
  const source = JSON.stringify(recording).toLowerCase();
  if (source.includes('pbx') || source.includes('ura') || source.includes('tts') || source.includes('asr')) return 'pbx';
  if (source.includes('whatsapp') || source.includes('ticket') || source.includes('omni')) return 'omnichannel';
  if (source.includes('bpmn')) return 'bpmn';
  if (source.includes('beauty')) return 'beauty';
  if (source.includes('fitness')) return 'fitness';
  return 'core';
}

function loadRpaSeedScenarios() {
  const waveScenarioMap = loadWaveScenarioMapByPlatformId();
  const seedsDir = path.join(ROOT_DIR, 'rpa/seeds');
  if (!fs.existsSync(seedsDir)) return [];
  return fs.readdirSync(seedsDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const recording = safeReadJson(path.join(seedsDir, file), null);
      if (!recording) return null;
      const domain = inferFlowDomain(recording);
      const semantic = waveScenarioMap.get(recording.id || file.replace(/\.json$/, '')) || null;
      const journeyId = semantic?.journeyId || recording.metadata?.journey || null;
      return toScenarioBase({
        id: recording.id || file.replace(/\.json$/, ''),
        scenarioId: semantic?.id || recording.id || file.replace(/\.json$/, ''),
        domain,
        type: 'e2e',
        source: 'seed',
        flow: recording.name || recording.id || file,
        steps: Array.isArray(semantic?.semanticSteps) && semantic.semanticSteps.length > 0
          ? semantic.semanticSteps
          : (recording.steps || []).map((step) => step.type || step.url || 'step'),
        semanticSteps: Array.isArray(semantic?.semanticSteps) ? semantic.semanticSteps : [],
        wave: semantic?.waveId || null,
        journeyId,
        scenarioStatus: semantic?.status || null,
        executionMode: semantic ? 'semantic' : 'legacy_seed',
        assertions: ['execução RPA seed concluída sem erro crítico'],
        rpaRecordingId: recording.id || file.replace(/\.json$/, ''),
        criticality: semantic?.criticality
          || (journeyId && operationalStepExecutor.isBlockingJourney(journeyId) ? 'blocking' : 'standard'),
        adapter: 'rpa',
        impactScopes: [domain, recording.metadata?.journey || 'general'],
      });
    })
    .filter(Boolean);
}

function loadWaveScenarioMapByPlatformId() {
  const map = new Map();
  const tenantId = normalizeTenantKey(process.env.TEST_TENANT_ID || 'system');
  const payload = safeReadJson(SCENARIO_STORE_PATH, null);
  const scenarios = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.scenarios) ? payload.scenarios : []);

  for (const scenario of scenarios) {
    if (!belongsToTenant(scenario, tenantId)) continue;
    const ids = new Set();
    ids.add(String(scenario?.id || '').trim());
    toArray(scenario?.platformScenarioIds).forEach((id) => ids.add(String(id || '').trim()));
    toArray(scenario?.platform?.platformScenarioIds).forEach((id) => ids.add(String(id || '').trim()));

    ids.forEach((id) => {
      if (!id) return;
      map.set(id, {
        id: scenario.id,
        waveId: scenario.waveId || null,
        journeyId: scenario.journeyId || scenario.journey || null,
        criticality: scenario.criticality || null,
        status: scenario.status || null,
        semanticSteps: Array.isArray(scenario?.semanticSteps)
          ? scenario.semanticSteps
          : (Array.isArray(scenario?.steps) ? scenario.steps : []),
      });
    });
  }

  return map;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function loadRpaFlowScenarios() {
  const flowsDir = path.join(ROOT_DIR, 'tests/rpa/flows');
  if (!fs.existsSync(flowsDir)) return [];
  return fs.readdirSync(flowsDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const recording = safeReadJson(path.join(flowsDir, file), null);
      if (!recording) return null;
      const domain = inferFlowDomain(recording);
      return toScenarioBase({
        id: `rpa-${recording.id || file.replace(/\.json$/, '')}`,
        domain,
        type: 'regression',
        source: 'rpa',
        flow: recording.name || recording.id || file,
        steps: (recording.steps || []).map((step) => step.type || step.selector || step.url || 'step'),
        assertions: ['execução RPA concluída sem erro crítico'],
        rpaRecordingId: recording.id || file.replace(/\.json$/, ''),
        criticality: domain === 'pbx' ? 'high' : 'medium',
        adapter: 'rpa',
        impactScopes: [domain, 'executors', 'telemetry'],
      });
    })
    .filter(Boolean);
}

function loadWorkspaceScenarios() {
  return [
    toScenarioBase({
      id: 'workspace-core',
      name: 'Workspace Core Journey',
      domain: 'workspace',
      category: 'business',
      type: 'workspace',
      source: 'qa',
      flow: 'Workspace Core Journey',
      criticality: 'blocking',
      adapter: 'api-rpa',
      replay: true,
      evidence: true,
      modes: ['real', 'failure'],
      script: 'scripts/workspace-core-smoke.js',
      command: 'node',
      commandArgs: ['scripts/workspace-core-smoke.js'],
      description: 'Validação real do Workspace com suporte a failure injection e autocorrection.',
      steps: [
        'create_workspace_entity',
        'simulate_inbound_message',
        'create_ticket',
        'create_task',
        'generate_insight',
        'generate_action',
        'validate_timeline',
        'generate_evidence',
        'create_autocorrection_run',
      ],
      assertions: [
        'entity criada',
        'links criados',
        'timeline correta',
        'evidence gerada',
        'replay gerado',
        'insight critico criado',
        'action criada',
        'autocorrection pendente de revisao humana',
      ],
      impactScopes: ['workspace', 'qa', 'rpa', 'autocorrection', 'telemetry'],
      expectedArtifacts: [path.join(ROOT_DIR, 'qa/workspace-core/evidence')],
    }),
  ];
}

function applyScenarioMode(scenario, mode) {
  const normalizedMode = String(mode || '').trim().toLowerCase();
  if (!normalizedMode) return scenario;
  if (scenario.id !== 'workspace-core') return scenario;
  if (!['real', 'failure'].includes(normalizedMode)) return scenario;

  return {
    ...scenario,
    env: {
      ...(scenario.env || {}),
      WORKSPACE_TEST_MODE: normalizedMode,
    },
    runtimeMode: normalizedMode,
  };
}

function buildRegistry() {
  return [
    ...loadQaSmokeScenarios(),
    ...loadWorkspaceScenarios(),
    ...[...SCREEN_SCENARIOS, ...FLOW_SCENARIOS, ...JOURNEY_SCENARIOS].map(normalizeBusinessScenario),
    ...loadRpaFlowScenarios(),
    ...loadRpaSeedScenarios(),
  ].sort((a, b) => a.id.localeCompare(b.id));
}

function saveRegistry(registry) {
  const newContent = `${JSON.stringify(registry, null, 2)}\n`;
  try {
    const existing = fs.readFileSync(REGISTRY_PATH, 'utf8');
    if (existing === newContent) return registry;
  } catch (_) {}
  fs.writeFileSync(REGISTRY_PATH, newContent, 'utf8');
  return registry;
}

function refreshRegistry() {
  return saveRegistry(buildRegistry());
}

function ensureWorkspaceCoreInRegistry(registry) {
  if (registry.some((item) => item.id === 'workspace-core')) return registry;
  const [workspaceCore] = loadWorkspaceScenarios();
  return [...registry, workspaceCore];
}

function loadRegistry() {
  const current = safeReadJson(REGISTRY_PATH, null);
  if (Array.isArray(current) && current.length > 0) {
    const mapped = current.map((item) => toScenarioBase({
      ...item,
      requiresOfficialPipeline: scenarioRequiresOfficialPipeline(item),
    }));
    return ensureWorkspaceCoreInRegistry(mapped);
  }
  return refreshRegistry();
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readCliOption(args, name) {
  const prefix = `${name}=`;
  const direct = args.find((arg) => arg.startsWith(prefix));
  if (direct) {
    return direct.slice(prefix.length);
  }

  const index = args.indexOf(name);
  if (index >= 0 && index + 1 < args.length) {
    return args[index + 1];
  }

  return null;
}

function selectScenarios(registry, options = {}) {
  const selectedIds = new Set((options.scenarioIds || []).filter(Boolean));
  const changedFiles = options.changedFiles || [];
  let scenarios = registry.slice();

  if (selectedIds.size > 0) {
    scenarios = scenarios.filter((item) => selectedIds.has(item.id));
  }
  if (options.domain) {
    scenarios = scenarios.filter((item) => item.domain === options.domain);
  }
  if (options.type) {
    scenarios = scenarios.filter((item) => item.type === options.type);
  }
  if (options.criticality) {
    scenarios = scenarios.filter((item) => item.criticality === options.criticality);
  }
  if (options.impactOnly && changedFiles.length > 0) {
    const affectedScopes = determineAffectedScopes(changedFiles);
    if (affectedScopes.size > 0) {
      scenarios = scenarios.filter((item) => (item.impactScopes || []).some((scope) => affectedScopes.has(scope)));
    }
  }
  return scenarios;
}

function isCanonicalRegistryExecution(options = {}, registry = [], scenarios = []) {
  if (Array.isArray(options.registry)) return false;
  if (Array.isArray(options.scenarioIds) && options.scenarioIds.length > 0) return false;
  if (options.domain || options.type || options.criticality) return false;
  if (options.impactOnly || options.detectChangedFiles) return false;
  return registry.length > 0 && scenarios.length === registry.length;
}

function resolveAdapter(adapterName) {
  if (adapterName === 'api-rpa') return apiAdapter;
  if (adapterName === 'rpa') return rpaAdapter;
  if (adapterName === 'pbx') return pbxAdapter;
  if (adapterName === 'api') return apiAdapter;
  return null;
}

function classifyScenarioStatus(adapterResult) {
  if (adapterResult?.status) return adapterResult.status;
  if (adapterResult?.success) return 'passed';
  return 'failed';
}

function normalizeErrorList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

/**
 * Mantém do rawStatus do adapter apenas o necessário para evidências de replay
 * (passo a passo rico do RPA com screenshots ANTES/DEPOIS, network events).
 * Remove domSnapshot/consoleLogs/logs para não inchar histórico em disco.
 */
function compactRawStatus(rawStatus) {
  if (!rawStatus || typeof rawStatus !== 'object') return null;
  const { logs: _rawLogs, ...rawRest } = rawStatus;
  const results = rawStatus.results && typeof rawStatus.results === 'object'
    ? rawStatus.results
    : {};
  const steps = Array.isArray(results.steps)
    ? results.steps.map((step) => {
      if (!step || typeof step !== 'object') return step;
      const { domSnapshot, consoleLogs, ...rest } = step;
      return rest;
    })
    : [];
  return {
    ...rawRest,
    results: {
      ...results,
      steps,
    },
  };
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  // RAP-078: espelho canônico em banco para stores mutáveis de Mesh.
  try {
    const rel = path.relative(path.join(__dirname, '..'), path.resolve(filePath)).replace(/\\/g, '/');
    if (/^(qa-mesh\/(baseline|canonical-promotion|scheduler-state|gap-engine)\/|qa\/qa-waves\/)/.test(rel)) {
      // eslint-disable-next-line global-require
      const dbStateStore = require('../qa/state/dbStateStore');
      dbStateStore.saveSyncExport(rel, payload);
    }
  } catch (_) {
    // Espelho DB best-effort; nunca derruba o writer.
  }
  return filePath;
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function tryReclaimStaleCanonicalLock() {
  const currentLock = safeReadJson(QA_MESH_CANONICAL_LOCK_PATH, null);
  if (!currentLock) return null;
  if (isProcessAlive(currentLock.pid)) {
    return currentLock;
  }
  try {
    fs.unlinkSync(QA_MESH_CANONICAL_LOCK_PATH);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return null;
}

function acquireCanonicalExecutionLock(lockPayload) {
  try {
    const handle = fs.openSync(QA_MESH_CANONICAL_LOCK_PATH, 'wx');
    fs.writeFileSync(handle, `${JSON.stringify(lockPayload, null, 2)}\n`, 'utf8');
    fs.closeSync(handle);
    return;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const reclaimedLock = tryReclaimStaleCanonicalLock();
    if (!reclaimedLock) {
      return acquireCanonicalExecutionLock(lockPayload);
    }
    const currentLock = safeReadJson(QA_MESH_CANONICAL_LOCK_PATH, reclaimedLock);
    const owner = currentLock?.executionId || 'desconhecida';
    const startedAt = currentLock?.startedAt || 'desconhecido';
    throw new Error(`Outra execução canônica do QA Mesh já está em andamento (${owner}, iniciada em ${startedAt}).`);
  }
}

function releaseCanonicalExecutionLock(lockPayload) {
  const currentLock = safeReadJson(QA_MESH_CANONICAL_LOCK_PATH, null);
  if (!currentLock || currentLock.executionId !== lockPayload.executionId) {
    return;
  }
  try {
    fs.unlinkSync(QA_MESH_CANONICAL_LOCK_PATH);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function buildCanonicalPromotionMetadata({
  executionId,
  startedAt,
  executionOrigin,
  executionKind,
  summary,
}) {
  return {
    executionId,
    startedAt,
    executionOrigin,
    executionKind,
    promotedAt: nowIso(),
    registryTotal: summary.registryTotal,
    goNoGo: summary.goNoGo,
    criterion: 'serialized_canonical_execution',
  };
}

function normalizePathFromSummary(value) {
  if (!value) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return path.isAbsolute(normalized) ? normalized : path.resolve(ROOT_DIR, normalized);
}

function parseSummaryPathFromLogs(logs = []) {
  for (const line of logs.map((item) => String(item?.message || ''))) {
    const match = line.match(/"summaryPath"\s*:\s*"([^"]+)"/);
    if (match && match[1]) {
      return normalizePathFromSummary(match[1]);
    }
  }
  return null;
}

function findLatestWorkspaceSummaryPath() {
  const baseDir = path.join(ROOT_DIR, 'qa', 'workspace-core', 'evidence');
  if (!fs.existsSync(baseDir)) return null;
  const candidates = fs.readdirSync(baseDir)
    .map((name) => path.join(baseDir, name, 'summary.json'))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => ({ filePath, mtime: fs.statSync(filePath).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.filePath || null;
}

function resolveWaveSummaryPath(scenario, result) {
  const fromLogs = parseSummaryPathFromLogs(result.logs || []);
  if (fromLogs && fs.existsSync(fromLogs)) return fromLogs;
  if (scenario.id === 'workspace-core') {
    return findLatestWorkspaceSummaryPath();
  }
  return null;
}

async function applyGovernanceIntegrations({
  summary,
  governance,
  scenario,
  summaryPath,
  db = null,
  closeDbAfterIntegration = true,
}) {
  if (!summary || !governance) {
    return { integrated: false, reason: 'missing_summary_or_governance' };
  }

  if (!['GO', 'NO_GO', 'REVIEW', 'GO_WITH_WARNINGS'].includes(governance.decision)) {
    return { integrated: false, reason: 'unsupported_decision' };
  }

  const tenantId = summary.tenantId;
  const entityId = summary.entityId;
  if (!tenantId) {
    return { integrated: false, reason: 'missing_tenant_id' };
  }

  let connect;
  let close;
  let models;
  if (db) {
    ({ connect, close, models } = db);
  } else {
    ({ connect, close } = require('../api/db/sequelize'));
    models = require('../api/db/models');
  }

  const summaryPathRel = summary?.artifacts?.summaryPath || (summaryPath ? path.relative(ROOT_DIR, summaryPath) : null);
  const replayPathRel = summary?.artifacts?.replayPath || null;
  const evidenceId = summary?.records?.evidenceId || null;

  const mustCreateAutoCorrection = ['NO_GO', 'REVIEW'].includes(governance.decision);
  const isGo = governance.decision === 'GO';
  const isGoWithWarnings = governance.decision === 'GO_WITH_WARNINGS';

  const runPayload = {
    tenant_id: tenantId,
    source_type: 'qa_mesh_governance',
    source_id: `${scenario.id}:${summaryPathRel || summary?.wave || 'wave'}`,
    status: 'pending_review',
    diagnosis: {
      affectedModule: 'workspace',
      rootCause: governance.reason,
      risk: governance.severity,
      failedChecks: governance.failedChecks || [],
      governance,
      summaryStatus: summary.status,
    },
    proposed_patch: {
      patchSummary: 'Revisão técnica requerida pela governança QA Mesh.',
      filesToChange: [],
      testsToRun: [],
    },
    validation_result: {
      status: 'pending_manual_execution',
      summary: 'Ação técnica pendente por decisão de governança.',
      governance,
      evidencePath: summaryPathRel,
      replayPath: replayPathRel,
      severity: governance.severity,
    },
  };

  const integrationResult = {
    integrated: false,
    created: {
      autocorrectionRunId: null,
      workspaceInsightId: null,
      workspaceActionId: null,
      timelineEventId: null,
    },
  };

  await connect(3, 300);
  try {
    let run = null;
    if (mustCreateAutoCorrection) {
      const existingRun = await models.AutoCorrectionRun().findOne({
        where: {
          tenant_id: runPayload.tenant_id,
          source_type: runPayload.source_type,
          source_id: runPayload.source_id,
        },
        order: [['created_at', 'DESC']],
      });

      run = existingRun || await models.AutoCorrectionRun().create(runPayload);
      integrationResult.created.autocorrectionRunId = run.id;

      await models.AutoCorrectionAction().create({
        run_id: run.id,
        type: 'human_review',
        status: 'pending',
        payload: {
          wave: summary.wave,
          decision: governance.decision,
          failedChecks: governance.failedChecks || [],
          evidencePath: summaryPathRel,
          replayPath: replayPathRel,
          severity: governance.severity,
          affectedModule: 'workspace',
        },
      });
    }

    if (entityId) {
      if (run?.id) {
        await models.WorkspaceEntityLink().findOrCreate({
          where: {
            tenant_id: tenantId,
            source_type: 'autocorrection_run',
            source_id: run.id,
          },
          defaults: {
            tenant_id: tenantId,
            entity_id: entityId,
            source_type: 'autocorrection_run',
            source_id: run.id,
            confidence: 0.95,
          },
        });
      }

      if (evidenceId) {
        await models.WorkspaceEntityLink().findOrCreate({
          where: {
            tenant_id: tenantId,
            source_type: 'evidence',
            source_id: evidenceId,
          },
          defaults: {
            tenant_id: tenantId,
            entity_id: entityId,
            source_type: 'evidence',
            source_id: evidenceId,
            confidence: 1,
          },
        });

        const evidenceRow = await models.Evidence().findOne({
          where: { tenant_key: tenantId, id: evidenceId },
        });
        if (evidenceRow) {
          const payload = typeof evidenceRow.toJSON === 'function' ? evidenceRow.toJSON() : evidenceRow;
          await models.Evidence().update({
            metadata: {
              ...(payload.metadata || {}),
              governance,
              qaWaveStatus: summary.status,
              checks: summary.checks || {},
            },
          }, {
            where: { tenant_key: tenantId, id: evidenceId },
          });
        }
      }

      if (!isGo) {
        const insight = await models.WorkspaceInsight().create({
          tenant_id: tenantId,
          entity_id: entityId,
          type: isGoWithWarnings ? 'qa_governance_warning' : 'qa_governance',
          description: governance.reason,
          confidence: governance.severity === 'critical' ? 1 : governance.severity === 'high' ? 0.95 : 0.8,
          source: 'QA_MESH',
        });
        integrationResult.created.workspaceInsightId = insight.id;

        const action = await models.WorkspaceAction().create({
          tenant_id: tenantId,
          entity_id: entityId,
          type: isGoWithWarnings ? 'operational_followup' : 'technical_review',
          status: isGoWithWarnings ? 'recommended' : 'pending',
          payload: {
            wave: summary.wave,
            decision: governance.decision,
            failedChecks: governance.failedChecks || [],
            evidencePath: summaryPathRel,
            replayPath: replayPathRel,
            severity: governance.severity,
            lightweight: isGoWithWarnings,
          },
        });
        integrationResult.created.workspaceActionId = action.id;
      }

      const timelineEvent = await models.WorkspaceTimelineEvent().create({
        tenant_id: tenantId,
        entity_id: entityId,
        type: isGo ? 'qa_execution' : 'evidence',
        ref_id: evidenceId || run?.id || null,
        payload: {
          source: 'QA_MESH',
          wave: summary.wave,
          governance,
          evidencePath: summaryPathRel,
          replayPath: replayPathRel,
          autocorrection: {
            required: mustCreateAutoCorrection,
            created: Boolean(run?.id),
          },
        },
      });
      integrationResult.created.timelineEventId = timelineEvent.id;
    }

    integrationResult.integrated = true;
    return integrationResult;
  } finally {
    if (closeDbAfterIntegration) {
      await close().catch(() => {});
    }
  }
}

async function evaluateScenarioGovernance(scenario, result, options = {}) {
  const summaryPath = resolveWaveSummaryPath(scenario, result);
  if (!summaryPath || !fs.existsSync(summaryPath)) {
    return null;
  }

  const summary = safeReadJson(summaryPath, null);
  if (!summary || typeof summary !== 'object') {
    return null;
  }

  const governance = evaluateWaveResult(summary);
  const updatedSummary = {
    ...summary,
    governance,
  };
  writeJson(summaryPath, updatedSummary);

  const integration = await applyGovernanceIntegrations({
    summary: updatedSummary,
    governance,
    scenario,
    summaryPath,
    closeDbAfterIntegration: options.closeGovernanceDbAfterIntegration !== false,
  }).catch((error) => ({
    integrated: false,
    error: error.message || String(error),
  }));

  return {
    summaryPath,
    summary: updatedSummary,
    governance,
    integration,
  };
}

function durationMs(startedAt, finishedAt) {
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function compactText(value) {
  return String(value || '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractEvidenceHints(artifacts = []) {
  const hints = [];
  for (const artifact of artifacts) {
    if (!artifact?.path || path.extname(artifact.path) !== '.json') continue;
    const payload = safeReadJson(artifact.path, null);
    if (!payload || typeof payload !== 'object') continue;
    if (payload.ok === false && payload.error) {
      hints.push(compactText(payload.error));
    }
    if (payload.status === 'failed' && payload.error) {
      hints.push(compactText(payload.error));
    }
    if (Array.isArray(payload.errors)) {
      payload.errors.forEach((item) => hints.push(compactText(item?.error || item?.message || item)));
    }
  }
  return hints.filter(Boolean);
}

function extractBusinessQaHints(result) {
  const hints = [];
  // parseBusinessQaReportPathFromLogs agora vive em businessBatchRunner.js
  // (fonte única do regex — compartilhada com a fase de batch).
  const reportPath = parseBusinessQaReportPathFromLogs(result?.logs || []);
  if (!reportPath) return hints;

  const report = safeReadJson(reportPath, null);
  if (!report || !Array.isArray(report.scenarios)) return hints;

  // Com batching (QA_MESH_BUSINESS_BATCH, default ON), UM relatório cobre N
  // cenários: restringe os hints FAIL ao `scenarioCode` do cenário em questão,
  // para que a falha de um código nunca contamine o diagnóstico dos demais.
  const scenarioCode = result?.scenarioCode ? String(result.scenarioCode) : null;
  // O campo canônico do relatório é `codigo` (pt-BR); `code` é fallback.
  const failedScenarios = report.scenarios.filter((item) => item && item.status === 'FAIL'
    && (!scenarioCode || String(item.codigo || item.code) === scenarioCode));
  for (const scenario of failedScenarios) {
    const rootCause = compactText(scenario?.resumo?.causaRaiz);
    if (rootCause) hints.push(rootCause);

    const failedStep = Array.isArray(scenario?.etapas)
      ? scenario.etapas.find((step) => step && step.status === 'FAIL' && step.detalhe)
      : null;
    const stepDetail = compactText(failedStep?.detalhe);
    if (stepDetail) hints.push(stepDetail);
  }

  return hints;
}

function isLowSignalDiagnostic(text) {
  const normalized = String(text || '').toLowerCase();
  return normalized.includes('[config] configuração carregada');
}

function collectScenarioDiagnostics(result) {
  const fromBusinessQa = extractBusinessQaHints(result);
  const fromErrors = normalizeErrorList(result.errors)
    .map((item) => compactText(item?.error || item?.message || item))
    .filter(Boolean);
  const fromLogs = (result.logs || [])
    .map((item) => compactText(item?.error || item?.message || item))
    .filter(Boolean)
    .filter((item) => !isLowSignalDiagnostic(item));
  const fromArtifacts = extractEvidenceHints(result.artifacts || []);
  return [...fromBusinessQa, ...fromErrors, ...fromLogs, ...fromArtifacts].filter(Boolean);
}

function detectFailureType(diagnostics = []) {
  const text = diagnostics.join(' | ').toLowerCase();
  if (!text) {
    return {
      failureType: 'functional_failure',
      status: 'failed',
      rootCauseHint: 'Command failed sem evidência suficiente; revisar relatório específico do cenário.',
    };
  }
  if (
    // Dependência EXTERNA de IA/RAG indisponível (provider fora do ar, credencial ausente, circuit
    // breaker aberto, cold start do serviço de embeddings) NÃO é falha funcional do código.
    // Medido (2026-09-24): `CORE-BIZ-FLOWS-EDITOR` respondia
    // `500 Internal Server Error: Provider de IA 'mistral' indisponível (circuit breaker)` e caía no
    // default `functional_failure` — o veredito de release contava causa AMBIENTAL como defeito de
    // produto. Mesmo vício que o gate anti-greenwashing corrigiu no Jest, aqui na camada do mesh.
    text.includes('ai_unavailable') ||
    text.includes('circuit breaker') ||
    text.includes('serviço rag indisponível') ||
    text.includes('servico rag indisponivel') ||
    ((text.includes('provider de ia') || text.includes('ai provider') || text.includes('serviço de ia') || text.includes('servico de ia')) &&
      (text.includes('indisponív') || text.includes('indisponiv') || text.includes('unavailable') ||
       text.includes('circuit breaker') || text.includes('api key') || text.includes('credencial') ||
       text.includes('credential') || text.includes('not configured') || text.includes('não configurad')))
  ) {
    return {
      failureType: 'environment_missing',
      status: 'environment_missing',
      rootCauseHint: 'Provedor de IA indisponível ou sem credencial no ambiente: o cenário não exercitou a funcionalidade (não é defeito funcional).',
    };
  }
  if (
    text.includes('exige o pipeline oficial') ||
    text.includes('execute: npm run pipeline') ||
    text.includes('pipeline_bypass=1')
  ) {
    return {
      failureType: 'pipeline_required',
      status: 'environment_missing',
      rootCauseHint: 'Cenário exige execução pelo pipeline oficial ou bypass explícito em ambiente local.',
    };
  }
  if (text.includes('auth_redirect') || text.includes('rpa_maintenance_auth_redirect')) {
    return {
      failureType: 'auth_redirect',
      status: 'auth_redirect',
      rootCauseHint: 'Fluxo redirecionado para login ou sem sessão autenticada válida em /maintenance.',
    };
  }
  if (text.includes('permission_block') || text.includes('rpa_maintenance_permission_block')) {
    return {
      failureType: 'permission_block',
      status: 'permission_block',
      rootCauseHint: 'Sessão autenticada sem permissão/RBAC para renderizar a tela de maintenance.',
    };
  }
  if (text.includes('loading_stuck') || text.includes('rpa_maintenance_loading_stuck')) {
    return {
      failureType: 'loading_stuck',
      status: 'loading_stuck',
      rootCauseHint: 'Tela de maintenance permaneceu em loading e não atingiu estado ready.',
    };
  }
  if (text.includes('maintenance_not_rendered') || text.includes('rpa_maintenance_maintenance_not_rendered')) {
    return {
      failureType: 'maintenance_not_rendered',
      status: 'maintenance_not_rendered',
      rootCauseHint: 'Rota /maintenance foi acessada, mas marcador da página não foi renderizado.',
    };
  }
  if (text.includes('hidden_element') || text.includes('rpa_maintenance_hidden_element')) {
    return {
      failureType: 'hidden_element',
      status: 'hidden_element',
      rootCauseHint: 'Elemento alvo existe, mas ficou oculto/inacessível para clique no cenário.',
    };
  }
  if (
    text.includes('business_batch_missing_scenario') ||
    text.includes('business_batch_crashed') ||
    text.includes('business_batch_report_missing')
  ) {
    // Falha estrutural do batch business (cenário ausente no relatório ou
    // processo/relatório íntegro indisponível): falha explícita, nunca
    // reclassificada como environment_missing pelo token "missing" do erro.
    // Assinaturas transitórias (socket/fetch) já foram tratadas pelo retry
    // em modo single antes da classificação.
    return {
      failureType: 'functional_failure',
      status: 'failed',
      rootCauseHint: 'Execução em batch do business QA não produziu resultado íntegro para o cenário.',
    };
  }
  if (
    text.includes('gravação não encontrada') ||
    text.includes('recording not found') ||
    text.includes('required_config_missing') ||
    text.includes('not configured') ||
    text.includes('não configurad') ||
    text.includes('missing') ||
    text.includes('enoent') ||
    text.includes('module not found') ||
    text.includes('nenhuma configuração')
  ) {
    return {
      failureType: 'environment_missing',
      status: 'environment_missing',
      rootCauseHint: 'Dependência ou configuração obrigatória ausente para executar o cenário.',
    };
  }
  if (
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('econnrefused') ||
    text.includes('err_connection_refused') ||
    text.includes('service "') && text.includes('is not running') ||
    text.includes('fetch failed') ||
    text.includes('service unavailable') ||
    text.includes('couldn\'t connect') ||
    text.includes('connect eperm') ||
    text.includes('operation not permitted') ||
    text.includes('browsertype.launch') ||
    text.includes('target page, context or browser has been closed') ||
    text.includes('sandbox_host_linux') ||
    text.includes('setsockopt')
  ) {
    return {
      failureType: 'infra_error',
      status: 'infra_error',
      rootCauseHint: 'Infraestrutura local, rede ou runtime do browser impediu a execução do cenário.',
    };
  }
  if (
    text.includes('não implementado') ||
    text.includes('nao implementado') ||
    text.includes('assert') ||
    text.includes('validation failed') ||
    text.includes('expected') ||
    text.includes('not found') ||
    text.includes('fluxo') ||
    text.includes('failed:')
  ) {
    return {
      failureType: 'functional_failure',
      status: 'failed',
      rootCauseHint: 'Fluxo executou, mas o comportamento observado divergiu do esperado.',
    };
  }
  return {
    failureType: 'functional_failure',
    status: 'failed',
    rootCauseHint: 'Falha funcional ou regra de negócio não atendida.',
  };
}

function classifyScenarioResult(result, history = [], options = {}) {
  if (result.status === 'passed') {
    return {
      ...result,
      failureType: null,
      errorMessage: null,
      rootCauseHint: null,
      durationMs: durationMs(result.startedAt, result.finishedAt),
    };
  }

  if (result.status === 'review') {
    const diagnostics = collectScenarioDiagnostics(result);
    return {
      ...result,
      failureType: 'review_required',
      errorMessage: diagnostics[0] || 'Execução em modo diagnóstico requer revisão manual.',
      rootCauseHint: 'Modo diagnóstico permite adapter/fallback, mas não valida GO operacional.',
      durationMs: durationMs(result.startedAt, result.finishedAt),
    };
  }

  // passed_via_fallback: degradação bloqueante em strictMode ou criticality=blocking
  if (result.status === 'passed_via_fallback') {
    const isBlockingJourney = result.criticality === 'blocking'
      || (result.journeyId && isRegistryBlockingJourney(result.journeyId));
    const isStrict = options.strictMode === true || result.strictMode === true;
    const isDegradedBlocking = isBlockingJourney || isStrict;
    return {
      ...result,
      // Em jornada blocking ou strictMode: falha real de degradação
      status: isDegradedBlocking ? 'failed' : 'passed_via_fallback',
      failureType: isDegradedBlocking ? 'fallback_degradation' : null,
      errorMessage: isDegradedBlocking
        ? 'Fallback utilizado em jornada blocking/strict — execução primária falhou, resultado NÃO é operacional.'
        : null,
      rootCauseHint: isDegradedBlocking
        ? 'Fallback em jornada blocking ou strictMode=true bloqueia GO imediatamente (fallback_degradation).'
        : 'Cenário passou via fallback para adapter API (primary adapter falhou).',
      runtimeMode: result.runtimeMode || 'REAL_FAILED_FALLBACK_USED',
      durationMs: durationMs(result.startedAt, result.finishedAt),
    };
  }

  if (result.status === 'skipped') {
    const diagnostics = collectScenarioDiagnostics(result);
    return {
      ...result,
      failureType: 'environment_missing',
      errorMessage: diagnostics[0] || null,
      rootCauseHint: 'Cenário pulado por adapter ou pré-requisito ausente.',
      durationMs: durationMs(result.startedAt, result.finishedAt),
    };
  }

  const diagnostics = collectScenarioDiagnostics(result);
  const classification = detectFailureType(diagnostics);
  if (classification.failureType === 'pipeline_required') {
    return {
      ...result,
      status: classification.status,
      failureType: classification.failureType,
      errorMessage: diagnostics[0] || null,
      rootCauseHint: classification.rootCauseHint,
      durationMs: durationMs(result.startedAt, result.finishedAt),
    };
  }
  const recentStatuses = history
    .flatMap((execution) => execution.results || [])
    .filter((item) => item.id === result.id)
    .map((item) => item.status);
  const hasIntermittentHistory = recentStatuses.includes('passed') && recentStatuses.some((item) => item !== 'passed');

  // Não converte infra_error ou environment_missing para flaky — são problemas de infraestrutura, não intermitência funcional
  const isInfraFailure = classification.failureType === 'infra_error' || classification.failureType === 'environment_missing';

  if (hasIntermittentHistory && !isInfraFailure) {
    return {
      ...result,
      status: 'flaky',
      failureType: 'flaky',
      errorMessage: diagnostics[0] || 'Falha intermitente detectada.',
      rootCauseHint: 'O cenário alternou entre PASS e FAIL em execuções recentes.',
      durationMs: durationMs(result.startedAt, result.finishedAt),
    };
  }

  return {
    ...result,
    status: classification.status,
    failureType: classification.failureType,
    errorMessage: diagnostics[0] || null,
    rootCauseHint: classification.rootCauseHint,
    durationMs: durationMs(result.startedAt, result.finishedAt),
  };
}

function aggregateFailures(results = [], options = {}) {
  // passed_via_fallback em jornada blocking/strict entra como falha real de degradação
  const strictMode = options.strictMode === true;
  const failures = results.filter((item) => {
    if (item.status === 'passed') return false;
    if (item.status === 'passed_via_fallback') {
      // Tratar como falha bloqueante se jornada blocking ou strictMode
      const isBlockingJourney = item.criticality === 'blocking'
        || (item.journeyId && isRegistryBlockingJourney(item.journeyId));
      return strictMode || isBlockingJourney;
    }
    return true;
  });
  const fallbackUsed = results.filter((item) => item.status === 'passed_via_fallback');
  const fallbackDegradations = results.filter((item) => item.failureType === 'fallback_degradation');
  const failuresByDomain = {};
  const failuresByType = {};
  const errorCount = new Map();

  failures.forEach((item) => {
    const domain = item.domain || 'core';
    const type = item.failureType || item.status || 'failed';
    if (!failuresByDomain[domain]) {
      failuresByDomain[domain] = {
        total: 0,
        blocking: 0,
        byType: {},
        successRate: 0,
      };
    }
    failuresByDomain[domain].total += 1;
    if (item.criticality === 'blocking') failuresByDomain[domain].blocking += 1;
    failuresByDomain[domain].byType[type] = (failuresByDomain[domain].byType[type] || 0) + 1;
    failuresByType[type] = (failuresByType[type] || 0) + 1;
    if (item.errorMessage) {
      errorCount.set(item.errorMessage, (errorCount.get(item.errorMessage) || 0) + 1);
    }
  });

  const totalsByDomain = results.reduce((acc, item) => {
    acc[item.domain] = acc[item.domain] || { total: 0, passed: 0 };
    acc[item.domain].total += 1;
    if (item.status === 'passed') acc[item.domain].passed += 1;
    return acc;
  }, {});

  Object.entries(totalsByDomain).forEach(([domain, stats]) => {
    if (!failuresByDomain[domain]) {
      failuresByDomain[domain] = {
        total: 0,
        blocking: 0,
        byType: {},
        successRate: stats.total > 0 ? stats.passed / stats.total : 0,
      };
      return;
    }
    failuresByDomain[domain].successRate = stats.total > 0 ? stats.passed / stats.total : 0;
  });

  return {
    failuresByDomain,
    failuresByType,
    topErrors: Array.from(errorCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([message, count]) => ({ message, count })),
    blockingDomains: Object.entries(failuresByDomain)
      .filter(([, value]) => value.blocking > 0)
      .map(([domain]) => domain),
  };
}

function buildRepairPlan(results = []) {
  const criticalityWeight = { blocking: 400, high: 200, medium: 100, low: 50 };
  const failureTypeWeight = {
    infra_error: 500,
    environment_missing: 350,
    auth_redirect: 320,
    permission_block: 320,
    loading_stuck: 300,
    maintenance_not_rendered: 280,
    hidden_element: 260,
    functional_failure: 250,
    flaky: 150,
  };
  const domainWeight = { core: 220, pbx: 220, omnichannel: 200, fitness: 120, beauty: 120, bpmn: 100 };

  const orderedFixList = results
    .filter((item) => item.status !== 'passed')
    .map((item) => {
      const priority =
        (criticalityWeight[item.criticality] || 0) +
        (failureTypeWeight[item.failureType] || 0) +
        (domainWeight[item.domain] || 0);
      return {
        scenarioId: item.id,
        domain: item.domain,
        status: item.status,
        failureType: item.failureType,
        priority,
        criticality: item.criticality,
        rootCauseHint: item.rootCauseHint,
        errorMessage: item.errorMessage,
      };
    })
    .sort((a, b) => b.priority - a.priority);

  return {
    generatedAt: nowIso(),
    orderedFixList,
  };
}

function loadBaseline() {
  return safeReadJson(BASELINE_PATH, null);
}

function updateBaseline(summary, results, executionId) {
  const currentPassRate = summary.total > 0 ? summary.passed / summary.total : 0;
  const currentBlockingFailures = results.filter((item) => item.criticality === 'blocking' && item.status !== 'passed').length;
  const currentInfraErrors = results.filter((item) => item.status === 'infra_error').length;
  const baseline = loadBaseline() || {
    target: {
      passRate: 0.9,
      blockingFailures: 0,
      infraErrors: 0,
    },
    accepted: false,
    bestKnown: null,
    history: [],
  };

  if ((summary.total || 0) < 10) {
    writeJson(BASELINE_PATH, baseline);
    return baseline;
  }

  const bestPassRate = baseline.bestKnown?.passRate || 0;
  const bestTotal = baseline.bestKnown?.total || 0;
  // Empate de passRate não basta: uma execução parcial (ex.: 15/15) não pode
  // erodir um bestKnown com cobertura maior (ex.: 130/130). Substitui apenas
  // em melhora real de passRate ou em refresh com cobertura >=.
  const isRealImprovement = currentPassRate > bestPassRate
    || (currentPassRate === bestPassRate && (summary.total || 0) >= bestTotal);
  if (!baseline.bestKnown || isRealImprovement) {
    baseline.bestKnown = {
      executionId,
      passRate: currentPassRate,
      blockingFailures: currentBlockingFailures,
      infraErrors: currentInfraErrors,
      total: summary.total,
      passed: summary.passed,
      failed: summary.failed,
      flaky: results.filter((item) => item.status === 'flaky').length,
      updatedAt: nowIso(),
    };
  }

  baseline.accepted =
    currentPassRate >= baseline.target.passRate &&
    currentBlockingFailures <= baseline.target.blockingFailures &&
    currentInfraErrors <= baseline.target.infraErrors;

  baseline.history = [
    {
      executionId,
      passRate: currentPassRate,
      blockingFailures: currentBlockingFailures,
      infraErrors: currentInfraErrors,
      at: nowIso(),
    },
    ...(baseline.history || []),
  ].slice(0, 20);

  writeJson(BASELINE_PATH, baseline);
  return baseline;
}

function compareWithBaseline(baseline, summary, results) {
  if (!baseline?.bestKnown || (baseline.bestKnown.total || 0) < 10) {
    return {
      available: false,
      regressed: false,
      reasons: [],
    };
  }

  const currentPassRate = summary.total > 0 ? summary.passed / summary.total : 0;
  const currentBlockingFailures = results.filter((item) => item.criticality === 'blocking' && item.status !== 'passed').length;
  const currentInfraErrors = results.filter((item) => item.status === 'infra_error').length;
  const reasons = [];

  if (currentPassRate < (baseline.bestKnown.passRate || 0)) {
    reasons.push('BASELINE_PASS_RATE_REGRESSION');
  }
  if (currentBlockingFailures > (baseline.bestKnown.blockingFailures || 0)) {
    reasons.push('BASELINE_BLOCKING_REGRESSION');
  }
  if (currentInfraErrors > (baseline.bestKnown.infraErrors || 0)) {
    reasons.push('BASELINE_INFRA_REGRESSION');
  }

  return {
    available: true,
    regressed: reasons.length > 0,
    reasons,
    current: {
      passRate: currentPassRate,
      blockingFailures: currentBlockingFailures,
      infraErrors: currentInfraErrors,
    },
    baseline: baseline.bestKnown,
  };
}

function buildMetrics(history, currentExecution) {
  const executions = [currentExecution, ...history.filter((item) => item.executionId !== currentExecution.executionId)].slice(0, 15);
  return {
    generatedAt: nowIso(),
    latestExecutionId: currentExecution.executionId,
    history: executions.map((item) => ({
      executionId: item.executionId,
      startedAt: item.startedAt,
      passRate: item.summary?.total > 0 ? item.summary.passed / item.summary.total : 0,
      coverage: item.summary?.executionCoverage || 0,
      goNoGo: item.summary?.goNoGo || 'NO_GO',
      total: item.summary?.total || 0,
      passed: item.summary?.passed || 0,
      failed: item.summary?.failed || 0,
      infraErrors: item.summary?.infraErrors || 0,
    })),
    avgDurationMsByScenario: currentExecution.results.reduce((acc, item) => {
      acc[item.id] = item.durationMs || null;
      return acc;
    }, {}),
    successRateByDomain: Object.entries(currentExecution.summary.domains || {}).reduce((acc, [domain, stats]) => {
      acc[domain] = stats.total > 0 ? stats.passed / stats.total : 0;
      return acc;
    }, {}),
  };
}

function buildSyntheticReplay(scenario, result, baseDir) {
  const existingReplayArtifact = Array.isArray(result?.artifacts)
    ? result.artifacts.find((item) => item && item.type === 'replay' && item.path)
    : null;

  if (existingReplayArtifact && fs.existsSync(existingReplayArtifact.path)) {
    return {
      type: 'replay',
      path: existingReplayArtifact.path,
      summaryType: scenario.source === 'hybrid'
        ? 'hybrid_replay_summary'
        : scenario.rpaRecordingId
          ? 'rpa_replay_summary'
          : 'api_replay_summary',
      source: 'adapter_replay',
    };
  }

  const replayDir = path.join(baseDir, 'replays');
  ensureDir(replayDir);
  const summaryType = scenario.source === 'hybrid'
    ? 'hybrid_replay_summary'
    : scenario.rpaRecordingId
      ? 'rpa_replay_summary'
      : 'api_replay_summary';
  const startedAt = result.startedAt || null;
  const finishedAt = result.finishedAt || null;

  // ── Training metadata ──────────────────────────────────────────
  // Use trainingSteps do registry (narrativos) ou steps tecnicos como fallback
  const trainingSteps = Array.isArray(scenario.trainingSteps) && scenario.trainingSteps.length > 0
    ? scenario.trainingSteps
    : null;

  // Se o adapter retornou enrichedSteps (API com parsing de logs), usa esses
  const adapterEnrichedSteps = result.enrichedSteps || null;

  // Constrói steps enriquecidos para o replay
  const rawSteps = (scenario.steps || []).map((step, index) => ({
    index: index + 1,
    name: typeof step === 'string' ? step : step.type || JSON.stringify(step),
    // Se tem trainingSteps, anexa descrição narrativa
    trainingDescription: trainingSteps && trainingSteps[index]
      ? (typeof trainingSteps[index] === 'string' ? trainingSteps[index] : trainingSteps[index].description || trainingSteps[index].name)
      : null,
    // Dica visual (screenshot esperado, indicador visual)
    trainingHint: trainingSteps && trainingSteps[index] && trainingSteps[index].hint
      ? trainingSteps[index].hint
      : null,
    actor: trainingSteps && trainingSteps[index] && trainingSteps[index].actor
      ? trainingSteps[index].actor
      : (scenario.adapter === 'rpa' ? 'rpa' : 'api'),
    category: trainingSteps && trainingSteps[index] && trainingSteps[index].category
      ? trainingSteps[index].category
      : 'SYSTEM_EVENT',
    expectedVisual: trainingSteps && trainingSteps[index] && trainingSteps[index].expectedVisual
      ? trainingSteps[index].expectedVisual
      : null,
  }));

  // Se temos enrichedSteps do adapter, mescla informação de log
  const finalSteps = adapterEnrichedSteps && adapterEnrichedSteps.length > 0
    ? adapterEnrichedSteps
    : rawSteps;

  const payload = {
    scenarioId: scenario.id,
    flow: scenario.flow,
    type: 'qa_mesh_replay_summary',
    summaryType,
    source: scenario.source,
    origin: 'mesh',
    command: scenario.command ? [scenario.command, ...(scenario.commandArgs || [])] : null,
    recordingId: scenario.rpaRecordingId || null,
    description: scenario.description || null,
    criticality: scenario.criticality || null,
    adapter: scenario.adapter || null,
    journeyId: scenario.journeyId || null,
    fallback: Boolean(result.metrics && result.metrics.fallback),
    startedAt,
    finishedAt,
    durationMs: durationMs(startedAt, finishedAt),
    steps: finalSteps,
    // Metadados de treinamento
    training: {
      enabled: !!(trainingSteps || adapterEnrichedSteps),
      trainingSteps: trainingSteps || null,
      domain: scenario.domain,
      businessFlow: scenario.flow,
      difficulty: scenario.trainingDifficulty || 'intermediate',
      estimatedDuration: scenario.trainingDuration || '5min',
      prerequisites: scenario.trainingPrerequisites || [],
      learningObjectives: scenario.trainingObjectives || [],
    },
    assertions: scenario.assertions || [],
    logs: result.logs || [],
    errors: result.errors || [],
    generatedAt: nowIso(),
  };
  return {
    type: 'replay',
    path: writeJson(path.join(replayDir, `${scenario.id}.json`), payload),
    summaryType,
  };
}

function writeScenarioEvidence(baseDir, result) {
  // ensureDir no alvo: a retenção (pruneOldEvidence) ou limpezas paralelas
  // podem remover subdiretórios entre o início do run e a escrita — evidência
  // nunca pode derrubar a execução com ENOENT.
  const target = path.join(baseDir, 'scenarios', `${result.id}.json`);
  ensureDir(path.dirname(target));
  writeJson(target, result);
  return target;
}

function writeSummary(baseDir, summary) {
  const target = path.join(baseDir, 'summary.json');
  ensureDir(path.dirname(target));
  writeJson(target, summary);
  return target;
}

/**
 * Extrai o timestamp real embutido no nome de um artefato de histórico/
 * evidência do mesh. Dois esquemas coexistem em produção:
 * - `meshq-<epochMs>-<rand>` (executionQueue)
 * - `mesh-<ISO com hífens no horário>` (runMesh direto)
 * Ordenar lexicograficamente coloca QUALQUER meshq- à frente de QUALQUER
 * mesh- independentemente da data — a retenção já apagou execuções do dia
 * preservando arquivos de dias atrás. Aqui a recência é a data real;
 * nomes fora dos padrões caem no mtime (fallback do chamador).
 */
function meshArtifactTimestamp(name) {
  const queued = /^meshq-(\d+)-/.exec(name);
  if (queued) {
    const epoch = Number(queued[1]);
    if (Number.isFinite(epoch) && epoch > 0) return epoch;
  }
  const iso = /^mesh-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(name);
  if (iso) {
    const parsed = Date.parse(`${iso[1]}T${iso[2]}:${iso[3]}:${iso[4]}.${iso[5]}Z`);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Lista entradas de um diretório (arquivos .json ou subdiretórios) ordenadas
 * da MAIS RECENTE para a mais antiga pela data real (nome), com fallback
 * para mtime quando o nome não carrega timestamp.
 */
function listEntriesNewestFirst(dir, { directories = false, jsonOnly = false } = {}) {
  ensureDir(dir);
  return fs.readdirSync(dir)
    .filter((name) => {
      if (jsonOnly && !name.endsWith('.json')) return false;
      const isDir = fs.statSync(path.join(dir, name)).isDirectory();
      return directories ? isDir : true;
    })
    .map((name) => {
      const embedded = meshArtifactTimestamp(name);
      const mtimeMs = fs.statSync(path.join(dir, name)).mtimeMs;
      return { name, recency: embedded !== null ? embedded : mtimeMs };
    })
    .sort((a, b) => b.recency - a.recency)
    .map((entry) => entry.name);
}

/**
 * Execuções canônicas (release/mesh completo) são evidência de cobertura:
 * o coverage gate lê o histórico por cenário e a retenção cega podava o
 * arquivo canônico quando o scheduler enchia a janela com runs parciais —
 * o gate oscilava GO → NO_GO sem mudança de código. Canônicos têm janela
 * própria (mesmo tamanho) e nunca são podados por runs não-canônicos.
 */
function isCanonicalHistoryFile(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Boolean(parsed && (parsed.isCanonicalExecution === true
      || (parsed.summary && parsed.summary.isCanonicalExecution === true)));
  } catch (_) {
    return false;
  }
}

function pruneOldHistory({ historyDir = HISTORY_DIR, maxFiles = MAX_HISTORY_FILES } = {}) {
  const files = listEntriesNewestFirst(historyDir, { jsonOnly: true });
  const canonical = [];
  const nonCanonical = [];
  for (const file of files) {
    if (isCanonicalHistoryFile(path.join(historyDir, file))) canonical.push(file);
    else nonCanonical.push(file);
  }
  const toRemove = [
    ...nonCanonical.slice(maxFiles),
    ...canonical.slice(maxFiles),
  ];
  for (const file of toRemove) {
    try { fs.unlinkSync(path.join(historyDir, file)); } catch (_) { /* ignore */ }
  }
  if (toRemove.length > 0) {
    console.log(`[mesh:cleanup] Removidos ${toRemove.length} arquivos de historico antigos (mantidos ${maxFiles} por classe; canonicos preservados)`);
  }
  return { removed: toRemove.length, keptCanonical: Math.min(canonical.length, maxFiles) };
}

/**
 * Execuções canônicas (release/mesh completo) geram diretórios de evidência
 * que são a prova de cobertura do release. A retenção cega por contagem
 * podava o replay/evidência canônica quando o scheduler enchia a janela com
 * runs parciais — o mesmo bug documentado em pruneOldHistory, agora para o
 * diretório de evidência. Canônicos têm janela própria e nunca são podados
 * por runs não-canônicos.
 */
function isCanonicalEvidenceDir(dirPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dirPath, 'summary.json'), 'utf8'));
    return Boolean(parsed && (parsed.isCanonicalExecution === true
      || (parsed.summary && parsed.summary.isCanonicalExecution === true)));
  } catch (_) {
    return false;
  }
}

function pruneOldEvidence({ evidenceDir = EVIDENCE_DIR, maxDirs = MAX_EVIDENCE_DIRS } = {}) {
  const dirs = listEntriesNewestFirst(evidenceDir, { directories: true });
  const canonical = [];
  const nonCanonical = [];
  for (const dir of dirs) {
    if (isCanonicalEvidenceDir(path.join(evidenceDir, dir))) canonical.push(dir);
    else nonCanonical.push(dir);
  }
  const toRemove = [
    ...nonCanonical.slice(maxDirs),
    ...canonical.slice(maxDirs),
  ];
  for (const dir of toRemove) {
    try { fs.rmSync(path.join(evidenceDir, dir), { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
  if (toRemove.length > 0) {
    console.log(`[mesh:cleanup] Removidos ${toRemove.length} diretorios de evidencia antigos (mantidos ${maxDirs} por classe; canonicos preservados)`);
  }
  return { removed: toRemove.length, keptCanonical: Math.min(canonical.length, maxDirs) };
}

function cleanStaleLocks() {
  const locks = [
    QA_MESH_CANONICAL_LOCK_PATH,
    path.join(__dirname, 'mesh-running.lock'),
  ];
  const now = Date.now();
  const staleThreshold = STALE_LOCK_MINUTES * 60 * 1000;
  for (const lockPath of locks) {
    try {
      const stat = fs.statSync(lockPath);
      if (now - stat.mtimeMs > staleThreshold) {
        fs.unlinkSync(lockPath);
        console.log(`[mesh:cleanup] Lock stale removido: ${path.basename(lockPath)} (${Math.round((now - stat.mtimeMs) / 60000)}min)`);
      }
    } catch (_) { /* lock nao existe, ok */ }
  }
}

function loadHistory(limit = MAX_HISTORY_FILES) {
  pruneOldHistory();
  return listEntriesNewestFirst(HISTORY_DIR, { jsonOnly: true })
    .slice(0, Math.min(limit, MAX_HISTORY_FILES))
    .map((file) => normalizeExecutionRecord(safeReadJson(path.join(HISTORY_DIR, file), null)))
    .filter(Boolean);
}

function diffAgainstPrevious(currentExecution) {
  const history = loadHistory(2);
  const previous = history.find((item) => item.executionId !== currentExecution.executionId) || null;
  if (!previous) {
    return { previousExecutionId: null, scenarioChanges: [] };
  }
  const previousMap = new Map((previous.results || []).map((item) => [item.id, item.status]));
  return {
    previousExecutionId: previous.executionId,
    scenarioChanges: (currentExecution.results || [])
      .filter((item) => previousMap.get(item.id) && previousMap.get(item.id) !== item.status)
      .map((item) => ({
        scenarioId: item.id,
        from: previousMap.get(item.id),
        to: item.status,
      })),
  };
}

async function executeScenarioWithFallback(scenario, context) {
  const normalizeOperationalResult = async (adapterResult) => {
    const journeyId = scenario.journeyId || scenario.journey || scenario.id || '';
    const executionMode = String(context?.executionMode || 'operational_go').toLowerCase();
    const blockingJourney = operationalStepExecutor.isBlockingJourney(journeyId);
    const sourceSteps = Array.isArray(adapterResult?.steps) ? adapterResult.steps : [];

    if (blockingJourney && executionMode !== 'diagnostic') {
      const decision = resolveBlockingPageNullDecision(executionMode);
      // O mesh não tem browser; a prova operacional das jornadas blocking é
      // produzida pelo smoke prod-like das QA Waves (Playwright real).
      // Evidência fresca e GO comprova a jornada; ausente/stale/not_go
      // mantém a falha — nunca mascara.
      const blockingEvidence = loadBlockingJourneyEvidence(journeyId, {
        evidencePath: context?.blockingJourneyEvidencePath,
      });

      if (blockingEvidence.status === 'valid') {
        return {
          ...adapterResult,
          status: classifyScenarioStatus(adapterResult),
          steps: sourceSteps,
          errors: normalizeErrorList(adapterResult?.errors),
          operationalExecution: {
            executorUsed: false,
            executionMode,
            decision,
            evidenceSource: 'qa-waves-operational-smoke',
            blockingJourneyEvidence: blockingEvidence,
            blockers: [],
          },
        };
      }

      return {
        ...adapterResult,
        status: 'failed',
        steps: [],
        errors: [
          ...normalizeErrorList(adapterResult?.errors),
          {
            message: 'blocking_journey_requires_browser_operational_runner',
            reason: 'page_null_blocking_journey',
            journeyId,
            evidenceStatus: blockingEvidence.status,
            evidenceDetail: blockingEvidence.detail || null,
            evidencePath: blockingEvidence.evidencePath || null,
          },
        ],
        operationalExecution: {
          executorUsed: false,
          executionMode,
          decision,
          blockingJourneyEvidence: blockingEvidence,
          blockers: [
            {
              reason: 'page_null_blocking_journey',
              journeyId,
              requiredRunner: 'browserOperationalRunner',
              detail: 'Blocking journey nunca deve executar step com page null.',
            },
          ],
        },
      };
    }

    const stepExecution = await operationalStepExecutor.executeOperationalSteps(sourceSteps, null, {
      journeyId,
      executionId: context?.executionId || null,
      executionMode,
    });

    const stepResults = Array.isArray(stepExecution.stepResults) ? stepExecution.stepResults : [];
    let blockers = Array.isArray(stepExecution.blockers) ? stepExecution.blockers : [];
    let normalizedSteps = Array.isArray(stepExecution.steps) ? stepExecution.steps : [];

    // Snapshot/post-state só pode ser validado quando before/after existem.
    if (adapterResult?.beforeSnapshot && adapterResult?.afterSnapshot) {
      const postStateValidation = operationalStepExecutor.validateJourneyPostStateProofs({
        beforeSnapshot: adapterResult.beforeSnapshot,
        afterSnapshot: adapterResult.afterSnapshot,
        executedSteps: normalizedSteps,
        replay: adapterResult,
        journeyContext: {
          journeyId,
          executionMode,
        },
      });

      normalizedSteps = postStateValidation.steps;
      blockers = blockers.concat(postStateValidation.blockers || []);
    }

    const hasBlockingFailure = blockers.some((item) => item.blocking === true)
      && executionMode !== 'diagnostic';
    const hasReview = blockers.some((item) => item.blocking === true)
      && executionMode === 'diagnostic';

    return {
      ...adapterResult,
      status: hasBlockingFailure ? 'failed' : (hasReview ? 'review' : classifyScenarioStatus(adapterResult)),
      steps: normalizedSteps,
      errors: [
        ...normalizeErrorList(adapterResult?.errors),
        ...blockers.map((item) => ({ message: item.reason, ...item })),
      ],
      operationalExecution: {
        executorUsed: true,
        executionMode,
        blockers,
      },
    };
  };

  let adapter = resolveAdapter(scenario.adapter);
  if (!adapter) {
    context.appendLog?.(`Adapter inválido para ${scenario.id}: ${scenario.adapter}`, 'error');
    return {
      status: 'skipped',
      logs: [],
      metrics: { adapter: scenario.adapter, fallback: 'none' },
      errors: [`Adapter inválido: ${scenario.adapter}`],
      artifacts: [],
    };
  }

  // Batch business (QA_MESH_BUSINESS_BATCH, default ON): o resultado já foi
  // produzido pela pré-execução (1 processo por modo) e é injetado aqui como
  // adapterResult — a normalização operacional abaixo permanece intacta.
  // take() CONSOME o resultado: o retry transitório re-executa o cenário
  // isolado no modo single (--code=<CODE> original), não a saída do batch.
  const batchedResult = context?.businessBatch && typeof context.businessBatch.take === 'function'
    ? context.businessBatch.take(scenario.id)
    : null;
  if (batchedResult) {
    return normalizeOperationalResult(batchedResult);
  }

  try {
    const adapterResult = await adapter.executeScenario(scenario, {
      repoRoot: ROOT_DIR,
      onStepProgress: context.onStepProgress,
      tenantId: scenario.tenantId || scenario.tenant_id || process.env.TEST_TENANT_ID || 'system',
    });
    return normalizeOperationalResult(adapterResult);
  } catch (error) {
    if (adapter !== apiAdapter && scenario.command) {
      context.appendLog?.(`Fallback para adapter API em ${scenario.id}`, 'warning');
      try {
        const fallbackResult = await apiAdapter.executeScenario(scenario, {
          repoRoot: ROOT_DIR,
          tenantId: scenario.tenantId || scenario.tenant_id || process.env.TEST_TENANT_ID || 'system',
        });
        const fallbackStatus = classifyScenarioStatus(fallbackResult);
        // Marcar explicitamente que o resultado passou via fallback — nunca ocultar degradação.
        const degradedStatus = fallbackStatus === 'passed' ? 'passed_via_fallback' : fallbackStatus;
        return normalizeOperationalResult({
          ...fallbackResult,
          status: degradedStatus,
          runtimeMode: 'REAL_FAILED_FALLBACK_USED',
          metrics: {
            ...(fallbackResult.metrics || {}),
            fallbackAdapter: 'api',
            primaryAdapterFailed: true,
          },
        });
      } catch (fallbackError) {
        return {
          status: 'infra_error',
          logs: [],
          metrics: { adapter: scenario.adapter, fallback: 'api' },
          errors: [fallbackError.message || String(fallbackError)],
          artifacts: [],
        };
      }
    }

    return {
      status: 'infra_error',
      logs: [],
      metrics: { adapter: scenario.adapter },
      errors: [error.message || String(error)],
      artifacts: [],
    };
  }
}

async function runMesh(options = {}) {
  // The mesh adapters still consume TEST_TENANT_ID.  Executions are
  // single-flight, so set it explicitly for every run (including the system
  // default) instead of inheriting the tenant from a previous request.
  const tenantId = normalizeTenantKey(options.tenantId || 'system');
  const previousTestTenantId = process.env.TEST_TENANT_ID;
  process.env.TEST_TENANT_ID = tenantId;
  try {
    return await runMeshInner(options, tenantId);
  } finally {
    // Restaura o valor anterior: o tenant residual no env polui outros
    // consumidores do mesmo processo (ex.: testes no mesmo worker do Jest).
    if (previousTestTenantId === undefined) delete process.env.TEST_TENANT_ID;
    else process.env.TEST_TENANT_ID = previousTestTenantId;
  }
}

async function runMeshInner(options = {}, tenantId = 'system') {
  ensureMeshAuthDefaults();
  ensureDir(HISTORY_DIR);
  ensureDir(EVIDENCE_DIR);
  const requestedCanonicalOutputs = options.writeCanonicalOutputs !== false;
  const executionOrigin = determineExecutionOrigin(options);
  const executionKind = options.executionKind || null;
  checkpointManager.ensureStateFiles();
  const waveId = options.wave || process.env.QA_WAVE_ID || 'WAVE-MESH';
  const waveTitle = options.waveTitle || 'Execucao QA Mesh integrada';
  checkpointManager.startWave({
    wave: waveId,
    title: waveTitle,
    changes: ['Execucao de malha QA iniciada'],
  });

  cleanStaleLocks();
  pruneOldEvidence();
  const priorHistory = loadHistory(FLKY_HISTORY_WINDOW);
  const registry = Array.isArray(options.registry)
    ? options.registry
    : (options.refreshRegistry === false ? loadRegistry() : refreshRegistry());
  const changedFiles = options.changedFiles || (options.detectChangedFiles ? getChangedFiles(options.baseRef) : []);
  const scenarios = selectScenarios(registry, options);
  const isCanonicalExecution = requestedCanonicalOutputs
    && process.env.RUNNING_IN_PIPELINE === '1'
    && executionOrigin === 'pipeline'
    && isCanonicalRegistryExecution(options, registry, scenarios);
  const writeCanonicalOutputs = isCanonicalExecution;
  const registryTotal = scenarios.length;
  const executionId = options.executionId || `mesh-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const startedAt = nowIso();
  const evidenceDir = path.join(EVIDENCE_DIR, executionId);
  const canonicalLockPayload = {
    executionId,
    startedAt,
    executionOrigin,
    executionKind,
    pid: process.pid,
  };

  if (writeCanonicalOutputs) {
    acquireCanonicalExecutionLock(canonicalLockPayload);
  }

  try {

  ensureDir(path.join(evidenceDir, 'scenarios'));
  ensureDir(path.join(evidenceDir, 'logs'));
  ensureDir(path.join(evidenceDir, 'screenshots'));
  ensureDir(path.join(evidenceDir, 'videos'));
  ensureDir(path.join(evidenceDir, 'replays'));
  // Diretório de treinamento persistente (não limpo pelo release)
  const trainingDir = path.join(ROOT_DIR, '..', 'training');
  ensureDir(path.join(trainingDir, 'replays'));
  ensureDir(path.join(trainingDir, 'screenshots'));
  ensureDir(path.join(trainingDir, 'videos'));

  const results = [];
  const executionLogs = [];
  const appendLog = (message, level = 'info', extra = {}) => {
    executionLogs.push({ timestamp: nowIso(), level, message, ...extra });
    if (typeof options.onLog === 'function') {
      options.onLog({ timestamp: nowIso(), level, message, ...extra });
    }
  };

  // Pré-execução em batch dos cenários business (QA_MESH_BUSINESS_BATCH,
  // default ON): agrupa os cenários business SELECIONADOS por modo
  // (screens/flows/journeys) e executa UM processo por modo com
  // `--code=A,B,C`. Os adapterResults são injetados no loop normal por
  // cenário via businessBatch.take() — ver qa-mesh/businessBatchRunner.js.
  let businessBatch = null;
  if (isBusinessBatchEnabled(options)) {
    const batchPlans = planBusinessBatches(scenarios);
    if (batchPlans.length > 0) {
      appendLog('BUSINESS_BATCH_START', 'info', {
        batches: batchPlans.map((plan) => ({ mode: plan.mode, codes: plan.codes })),
      });
      businessBatch = await executeBusinessBatches(batchPlans, {
        repoRoot: ROOT_DIR,
        evidenceDir,
        appendLog,
      });
    }
  }

  for (const [index, scenario] of scenarios.entries()) {
    const scenarioMode = (options.scenarioModeById && options.scenarioModeById[scenario.id]) || null;
    const effectiveScenario = applyScenarioMode(scenario, scenarioMode);
    // Cenários em batch executaram na pré-execução: usa a janela real do
    // processo do batch como startedAt/finishedAt (peek não consome).
    const batchPeek = businessBatch && typeof businessBatch.peek === 'function'
      ? businessBatch.peek(effectiveScenario.id)
      : null;
    const loopStartedAt = nowIso();
    const scenarioStartedAt = batchPeek?.startedAt || loopStartedAt;
    console.log('EXECUTING_SCENARIO', effectiveScenario.id);
    appendLog('EXECUTING_SCENARIO', 'info', { scenarioId: effectiveScenario.id, index: index + 1, total: registryTotal, mode: effectiveScenario.runtimeMode || 'default' });
    options.onScenarioStart?.({
      scenarioId: effectiveScenario.id,
      index: index + 1,
      total: registryTotal,
    });

    let adapterResult = await executeScenarioWithFallback(effectiveScenario, {
      executionMode: options.executionMode || options.operationalMode || 'operational_go',
      appendLog,
      businessBatch,
      onStepProgress: options.onStepProgress
        ? (meta) => options.onStepProgress({ ...meta, scenarioId: effectiveScenario.id })
        : null,
    });

    // Retry ÚNICO para falhas cuja evidência é exclusivamente de ambiente
    // transitório (API indisponível/socket/fetch): atravessa janelas de
    // restart do servidor dev e contenção de máquina. NÃO enfraquece
    // assertivas — a reexecução precisa passar integralmente, e a primeira
    // falha fica registrada em `transientEnvRetry` na evidência.
    if (adapterResult.status !== 'passed' && isTransientEnvFailure(adapterResult)) {
      const firstFailureSummary = {
        status: adapterResult.status,
        errors: normalizeErrorList(adapterResult.errors).slice(0, 3),
      };
      appendLog('TRANSIENT_ENV_RETRY', 'warn', { scenarioId: effectiveScenario.id, reason: 'environment_signature' });
      try {
        await waitForApiStable({
          apiUrl: process.env.TEST_API_URL || process.env.API_URL || 'http://localhost:3001',
          settleMs: 5000,
        });
        const retryResult = await executeScenarioWithFallback(effectiveScenario, {
          executionMode: options.executionMode || options.operationalMode || 'operational_go',
          appendLog,
          // businessBatch.take() já consumiu o resultado do batch na primeira
          // tentativa — o retry cai no spawn isolado do cenário (modo single).
          businessBatch,
          onStepProgress: options.onStepProgress
            ? (meta) => options.onStepProgress({ ...meta, scenarioId: effectiveScenario.id })
            : null,
        });
        if (retryResult.status === 'passed') {
          adapterResult = {
            ...retryResult,
            transientEnvRetry: { attempted: true, recovered: true, firstFailure: firstFailureSummary },
          };
          appendLog('TRANSIENT_ENV_RETRY_RECOVERED', 'warn', { scenarioId: effectiveScenario.id });
        } else {
          adapterResult = {
            ...retryResult,
            transientEnvRetry: { attempted: true, recovered: false, firstFailure: firstFailureSummary },
          };
          appendLog('TRANSIENT_ENV_RETRY_FAILED', 'error', { scenarioId: effectiveScenario.id });
        }
      } catch (retryError) {
        appendLog('TRANSIENT_ENV_RETRY_ABORTED', 'error', { scenarioId: effectiveScenario.id, message: retryError.message });
      }
    }
    // Timestamps do batch só se aplicam quando o resultado FINAL veio do
    // batch; após retry em modo single vale o relógio atual.
    const resultCameFromBatch = Boolean(adapterResult?.businessBatch);
    const scenarioFinishedAt = resultCameFromBatch ? (batchPeek?.finishedAt || nowIso()) : nowIso();
    const result = {
      id: effectiveScenario.id,
      domain: effectiveScenario.domain,
      type: effectiveScenario.type,
      source: effectiveScenario.source,
      flow: effectiveScenario.flow,
      journeyId: effectiveScenario.journeyId || effectiveScenario.journey || null,
      // scenarioCode business: filtra os hints do relatório do batch por código
      // (extractBusinessQaHints) para que falhas não vazem entre cenários.
      scenarioCode: effectiveScenario.scenarioCode || null,
      criticality: effectiveScenario.criticality,
      adapter: effectiveScenario.adapter,
      status: adapterResult.status,
      startedAt: resultCameFromBatch ? scenarioStartedAt : loopStartedAt,
      finishedAt: scenarioFinishedAt,
      logs: adapterResult.logs || [],
      metrics: adapterResult.metrics || {},
      errors: normalizeErrorList(adapterResult.errors),
      artifacts: adapterResult.artifacts || [],
      assertions: effectiveScenario.assertions || [],
      rpaRecordingId: effectiveScenario.rpaRecordingId || null,
      mode: effectiveScenario.runtimeMode || null,
      scenarioStatus: effectiveScenario.scenarioStatus || effectiveScenario.status || null,
      // rawStatus compacto alimenta o uiTrace do replay QA Waves (passo a passo das telas).
      rawStatus: compactRawStatus(adapterResult.rawStatus),
      // Evidência transparente do retry de falha transitória de ambiente.
      ...(adapterResult.transientEnvRetry ? { transientEnvRetry: adapterResult.transientEnvRetry } : {}),
    };
    const waveGovernance = await evaluateScenarioGovernance(effectiveScenario, result, {
      closeGovernanceDbAfterIntegration: options.closeGovernanceDbAfterIntegration,
    });
    if (waveGovernance) {
      result.waveSummaryPath = waveGovernance.summaryPath;
      result.waveSummary = waveGovernance.summary;
      result.governance = waveGovernance.governance;
      result.governanceIntegration = waveGovernance.integration;
    }
    const replayArtifact = buildSyntheticReplay(effectiveScenario, result, evidenceDir);
    result.artifacts = [...result.artifacts, replayArtifact];
    result.replayArtifact = replayArtifact.path;

    // Salvar replay enriquecido no diretório de treinamento (persistente)
    try {
      const trainingReplayPath = path.join(trainingDir, 'replays', `${effectiveScenario.id}.json`);
      const replayContent = safeReadJson(replayArtifact.path, null);
      if (replayContent) {
        writeJson(trainingReplayPath, replayContent);
      }
      // Copiar screenshots para training/
      const screenshots = (result.artifacts || []).filter((a) => a && a.type === 'screenshot');
      for (const shot of screenshots) {
        if (shot.path && fs.existsSync(shot.path)) {
          const destName = `${effectiveScenario.id}-${path.basename(shot.path)}`;
          fs.copyFileSync(shot.path, path.join(trainingDir, 'screenshots', destName));
        }
      }
      // Copiar videos para training/
      const videos = (result.artifacts || []).filter((a) => a && a.type === 'video');
      for (const vid of videos) {
        if (vid.path && fs.existsSync(vid.path)) {
          const destName = `${effectiveScenario.id}-${path.basename(vid.path)}`;
          fs.copyFileSync(vid.path, path.join(trainingDir, 'videos', destName));
        }
      }
    } catch (_) { /* non-blocking: training save is best-effort */ }

    const classifiedResult = classifyScenarioResult(result, priorHistory, options);
    classifiedResult.evidencePath = writeScenarioEvidence(evidenceDir, classifiedResult);
    results.push(classifiedResult);

    options.onScenarioComplete?.({
      scenarioId: scenario.id,
      index: index + 1,
      total: registryTotal,
      result: classifiedResult,
    });
  }

  const governance = evaluateGoNoGo(results, {
    ...(options.governance || {}),
    registryTotal,
  });

  const failureAnalysis = aggregateFailures(results, options);
  const governanceDecisions = results.reduce((acc, item) => {
    if (item.governance?.decision) {
      acc[item.id] = {
        decision: item.governance.decision,
        severity: item.governance.severity,
        reason: item.governance.reason,
      };
    }
    return acc;
  }, {});
  const repairPlan = buildRepairPlan(results);

  const summary = {
    executionId,
    tenantId,
    timestamp: startedAt,
    executionOrigin,
    executionKind,
    isCanonicalExecution,
    registryTotal,
    attempted: governance.attempted,
    executed: governance.executed,
    total: governance.attempted,
    passed: governance.passed,
    fallbackPassed: governance.fallbackPassed || 0,
    failed: governance.failed,
    skipped: governance.skipped,
    infraErrors: governance.infraErrors,
    environmentMissing: governance.environmentMissing,
    flaky: governance.flaky,
    // Degradação explícita: cenários que passaram via fallback de adapter (primary falhou)
    fallbackUsed: results.filter((r) => r.status === 'passed_via_fallback').length,
    fallbackBlockingUsed: results.filter((r) => r.status === 'passed_via_fallback' && r.criticality === 'blocking').length,
    governanceDecisions,
    executionCoverage: governance.executionCoverage,
    executionQuality: governance.executionQuality,
    domains: governance.domains,
    goNoGo: governance.goNoGo,
    reasons: governance.reasons,
    pipelineBlocked: failureAnalysis.failuresByType.pipeline_required || 0,
    failuresByDomain: failureAnalysis.failuresByDomain,
    failuresByType: failureAnalysis.failuresByType,
    topErrors: failureAnalysis.topErrors,
    blockingDomains: failureAnalysis.blockingDomains,
    changedFiles,
  };

  const executionMode = String(options.executionMode || options.operationalMode || 'operational_go').toLowerCase();
  if (executionMode === 'diagnostic' && summary.goNoGo === 'GO') {
    summary.goNoGo = 'REVIEW';
    summary.reasons = [
      ...(summary.reasons || []),
      'execution_mode_diagnostic: modo diagnóstico não pode emitir GO operacional.',
    ];
  }

  // Fallback em jornada blocking => NO_GO sempre (nunca GO_DEGRADED)
  if (summary.fallbackBlockingUsed > 0) {
    summary.goNoGo = 'NO_GO';
    summary.reasons = [
      ...(summary.reasons || []),
      `${summary.fallbackBlockingUsed} cenário(s) blocking passaram via fallback — execução primária falhou (fallback_degradation). GO bloqueado.`,
    ];
  }

  const baselineBeforeUpdate = loadBaseline();
  const baselineComparison = compareWithBaseline(baselineBeforeUpdate, summary, results);
  if (baselineComparison.regressed) {
    summary.goNoGo = 'NO_GO';
    summary.reasons = [...new Set([...(summary.reasons || []), ...baselineComparison.reasons])];
  }

  const canonicalPromotion = buildCanonicalPromotionMetadata({
    executionId,
    startedAt,
    executionOrigin,
    executionKind,
    summary,
  });
  summary.canonicalPromotion = writeCanonicalOutputs ? canonicalPromotion : null;

  writeSummary(evidenceDir, summary);
  if (writeCanonicalOutputs) {
    writeJson(REPORT_PATH, summary);
    writeJson(REPAIR_PLAN_PATH, repairPlan);
    writeJson(QA_MESH_GO_NO_GO_PATH, {
      source: 'qa-mesh',
      executionId,
      executionOrigin,
      executionKind,
      isCanonicalExecution,
      status: summary.goNoGo,
      reasons: summary.reasons,
      canonicalPromotion,
      totals: summary,
      // Identidade do artefato (não é lineage): desde o P0.3 o stamp recusa
      // RUNTIME_EVIDENCE, então artifactType/artifactVersion nascem aqui —
      // sem eles o scorecard derruba RAP-024/026 com ARTIFACT_CONTRACT_INCOMPLETE.
      artifactType: 'go-no-go-report',
      artifactVersion: '1.0.0',
      ...resolveOriginLineage(),
      generatedAt: nowIso(),
    });
    writeJson(QA_MESH_RELEASE_GATE_PATH, {
      source: 'qa-mesh',
      executionId,
      executionOrigin,
      executionKind,
      isCanonicalExecution,
      gate: summary.goNoGo,
      thresholds: governance.thresholds,
      totals: summary,
      reasons: summary.reasons,
      canonicalPromotion,
      ...resolveOriginLineage(),
      generatedAt: nowIso(),
    });
  }

  const execution = {
    executionId,
    tenantId,
    startedAt,
    finishedAt: nowIso(),
    executionOrigin,
    executionKind,
    isCanonicalExecution,
    // Lineage do run governado TAMBÉM no registro de histórico (não só nos
    // reports go-no-go/release-gate): o histórico é a trilha auditável de que
    // o mesh rodou DENTRO do run que reivindica. Sem run governado os campos
    // ficam null explícitos — nunca inventados (resolveOriginLineage).
    ...resolveOriginLineage(),
    changedFiles,
    summary,
    governance,
    repairPlan,
    results,
    logs: executionLogs,
    evidenceDir,
  };
  execution.diff = diffAgainstPrevious(execution);
  execution.baselineComparison = baselineComparison;
  execution.baseline = updateBaseline(execution.summary, results, executionId);
  execution.metrics = buildMetrics(priorHistory, execution);
  execution.intelligence = buildFailureIntelligence(execution, priorHistory, {
    outputDir: INTELLIGENCE_DIR,
  });
  execution.stability = generateStabilitySnapshot({ execution });
  execution.stabilityHistory = persistStabilitySnapshot(execution.stability.snapshot);
  execution.learning = runLearningPipeline(execution, priorHistory);
  execution.summary.intelligence = {
    totalClusters: execution.intelligence.totalClusters,
    recurringFailures: execution.intelligence.recurringFailures.length,
    weakestDomains: execution.intelligence.moduleStability.slice(0, 3),
    outputPath: execution.intelligence.outputPath || null,
  };
  if (writeCanonicalOutputs) {
    writeJson(METRICS_PATH, execution.metrics);
  }
  execution.historyPath = path.join(HISTORY_DIR, `${executionId}.json`);
  const normalizedExecution = normalizeExecutionRecord(execution);
  writeJson(execution.historyPath, normalizedExecution);
  try {
    require('./executionHistoryChain').appendExecutionRecord(execution);
  } catch (chainError) {
    execution.historyChainError = chainError.message;
    console.error(`[meshRunner] Falha ao anexar registro na cadeia de histórico: ${chainError.message}`);
  }
  // Dual-write opcional (MESH_HISTORY_DB=1): espelha no Postgres sem afetar o gate.
  require('./meshHistoryDb').mirrorExecution(normalizedExecution).catch((mirrorError) => {
    execution.historyDbError = mirrorError.message;
    console.error(`[meshRunner] Falha ao espelhar histórico no banco: ${mirrorError.message}`);
  });
  if (writeCanonicalOutputs) {
    writeJson(QA_MESH_CANONICAL_PROMOTION_PATH, {
      ...canonicalPromotion,
      finishedAt: execution.finishedAt,
      summaryPath: REPORT_PATH,
      goNoGoPath: QA_MESH_GO_NO_GO_PATH,
      metricsPath: METRICS_PATH,
      historyPath: execution.historyPath,
    });
  }

  checkpointManager.registerProgress({
    wave: waveId,
    changes: [
      `Execucao ${execution.executionId} concluida com status ${execution.summary.goNoGo}`,
      'Snapshot de estabilidade gerado',
      'Pipeline RAP Learn executado',
    ],
    filesCreated: [
      execution.historyPath,
      path.join(EVIDENCE_DIR, execution.executionId, 'summary.json'),
      execution.stability.outputPath,
      path.join(__dirname, '..', 'qa', 'mesh', 'intelligence', 'learning', 'failures.ranked.json'),
      path.join(__dirname, '..', 'qa', 'mesh', 'intelligence', 'learning', 'fixPlans.json'),
    ],
    filesModified: [
      REPORT_PATH,
      METRICS_PATH,
      REPAIR_PLAN_PATH,
      QA_MESH_GO_NO_GO_PATH,
      QA_MESH_RELEASE_GATE_PATH,
    ].filter(() => writeCanonicalOutputs),
  });

  checkpointManager.registerValidation({
    wave: waveId,
    validation: {
      buildBackend: summary.goNoGo !== 'NO_GO',
      buildFrontend: summary.goNoGo !== 'NO_GO',
      qaTechnical: summary.goNoGo !== 'NO_GO',
      qaBusiness: summary.goNoGo !== 'NO_GO',
      replay: summary.fallbackBlockingUsed === 0,
    },
    metrics: {
      testsPassed: Number(summary.passed || 0),
      testsFailed: Number(summary.failed || 0),
      warnings: Number(summary.reasons?.length || 0),
      criticalFlowsValidated: Number((results || []).filter((item) => item.criticality === 'blocking' && item.status === 'passed').length),
      durationMs: Math.max(0, new Date(execution.finishedAt).getTime() - new Date(execution.startedAt).getTime()),
    },
  });

  if (summary.goNoGo === 'NO_GO') {
    checkpointManager.failWave({
      wave: waveId,
      blockers: summary.reasons || ['qa_mesh_no_go'],
      nextActions: ['Corrigir blockers e reexecutar a wave antes de avancar.'],
    });
  } else {
    checkpointManager.completeWave({
      wave: waveId,
      status: summary.goNoGo === 'GO_DEGRADED' ? 'partial' : 'passed',
      blockers: summary.goNoGo === 'GO_DEGRADED' ? summary.reasons : [],
      nextActions: summary.goNoGo === 'GO_DEGRADED'
        ? ['Remover degradacao de fallback antes do proximo gate de release.']
        : ['Wave validada. Prosseguir para proxima execucao controlada.'],
    });
  }

  runGenerateSummary();
  return execution;
  } finally {
    if (writeCanonicalOutputs) {
      releaseCanonicalExecutionLock(canonicalLockPayload);
    }
  }
}

async function run(scenarioId, options = {}) {
  if (!scenarioId) {
    throw new Error('scenarioId é obrigatório para meshRunner.run');
  }

  const mode = options.mode ? String(options.mode).toLowerCase() : null;
  const scenarioModeById = mode ? { [scenarioId]: mode } : undefined;

  return runMesh({
    ...options,
    scenarioIds: [scenarioId],
    scenarioModeById,
  });
}

async function runFromCli() {
  const args = process.argv.slice(2);
  if (args.includes('--refresh-registry')) {
    const registry = refreshRegistry();
    console.log(`Mesh registry atualizado: ${registry.length} cenários`);
    return;
  }

  const criticality = readCliOption(args, '--criticality') || process.env.QA_MESH_CRITICALITY || null;
  const domain = readCliOption(args, '--domain') || process.env.QA_MESH_DOMAIN || null;
  const type = readCliOption(args, '--type') || process.env.QA_MESH_TYPE || null;
  const executionId = readCliOption(args, '--execution-id') || process.env.QA_MESH_EXECUTION_ID || null;
  const scenarioIds = [
    ...splitCsv(process.env.QA_MESH_SCENARIO_IDS),
    ...args.filter((arg) => arg.startsWith('--scenario-id=')).map((arg) => arg.slice('--scenario-id='.length)),
  ];

  const execution = await runMesh({
    detectChangedFiles: args.includes('--impact-only'),
    impactOnly: args.includes('--impact-only'),
    criticality,
    domain,
    type,
    executionId,
    scenarioIds,
    // O processo CLI é single-shot: fechar o singleton Sequelize a cada
    // cenário (default de applyGovernanceIntegrations) derruba a conexão
    // global usada por dbStateStore.js (checkpoints fire-and-forget) muito
    // antes do processo terminar, causando
    // "ConnectionManager.getConnection was called after the connection
    // manager was closed!" nos cenários seguintes. O Node encerra a conexão
    // sozinho ao sair — não precisa fechar por cenário aqui.
    closeGovernanceDbAfterIntegration: false,
  });
  console.log(JSON.stringify(execution.summary, null, 2));
  if (execution.summary.goNoGo === 'NO_GO') {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runFromCli().catch((error) => {
    console.error('[qa-mesh] erro fatal:', error);
    process.exit(1);
  });
}

module.exports = {
  ROOT_DIR,
  REGISTRY_PATH,
  REPORT_PATH,
  HISTORY_DIR,
  EVIDENCE_DIR,
  buildRegistry,
  scenarioRequiresOfficialPipeline,
  refreshRegistry,
  loadRegistry,
  selectScenarios,
  runMesh,
  run,
  evaluateScenarioGovernance,
  applyGovernanceIntegrations,
  loadHistory,
  pruneOldHistory,
  pruneOldEvidence,
  diffAgainstPrevious,
  executeScenarioWithFallback,
  classifyScenarioResult,
  resolveBlockingPageNullDecision,
  normalizeExecutionRecord,
  updateBaseline,
};
