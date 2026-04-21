'use strict';

const fs = require('fs');
const path = require('path');
const { SCREEN_SCENARIOS, FLOW_SCENARIOS, JOURNEY_SCENARIOS } = require('../tests/rpa/business/catalog');
const { getChangedFiles, determineAffectedScopes } = require('../qa/qaRunner');
const { evaluateGoNoGo } = require('./governance');
const { buildFailureIntelligence } = require('./intelligence/failureIntelligence');
const rpaAdapter = require('./adapters/rpaAdapter');
const apiAdapter = require('./adapters/apiAdapter');
const pbxAdapter = require('./adapters/pbxAdapter');
const checkpointManager = require('../qa/checkpoints/checkpointManager');
const { runGenerateSummary } = require('../qa/checkpoints/generateSummary');
const { generateStabilitySnapshot } = require('../qa/mesh/intelligence/stabilityEngine');
const { persistStabilitySnapshot } = require('../qa/mesh/intelligence/stabilityHistory');
const { runLearningPipeline } = require('../qa/mesh/intelligence/learning');

const ROOT_DIR = path.join(__dirname, '..');
const REGISTRY_PATH = path.join(__dirname, 'meshRegistry.json');
const REPORT_PATH = process.env.QA_MESH_REPORT_PATH || path.join(__dirname, 'meshReport.json');
const HISTORY_DIR = process.env.QA_MESH_HISTORY_DIR || path.join(__dirname, 'meshHistory');
const EVIDENCE_DIR = process.env.QA_MESH_EVIDENCE_DIR || path.join(__dirname, 'meshEvidence');
const REPAIR_PLAN_PATH = process.env.QA_MESH_REPAIR_PLAN_PATH || path.join(__dirname, 'repairPlan.json');
const BASELINE_PATH = path.join(__dirname, 'baseline.json');
const METRICS_PATH = process.env.QA_MESH_METRICS_PATH || path.join(__dirname, 'metrics.json');
const INTELLIGENCE_DIR = process.env.QA_MESH_INTELLIGENCE_DIR || path.join(__dirname, 'intelligence');
const QA_MESH_GO_NO_GO_PATH = process.env.QA_MESH_GO_NO_GO_PATH || path.join(__dirname, 'go-no-go-report.json');
const QA_MESH_RELEASE_GATE_PATH = process.env.QA_MESH_RELEASE_GATE_PATH || path.join(__dirname, 'release-gate-report.json');

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

function loadQaSmokeScenarios() {
  return [
    toScenarioBase({
      id: 'qa-core-auth-login',
      domain: 'core',
      type: 'smoke',
      source: 'hybrid',
      flow: 'core_auth_login',
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
      criticality: 'high',
      adapter: 'api',
      command: 'npm',
      commandArgs: ['exec', '--', 'jest', 'tests/rpa/createTenantByAI.test.js', '--runInBand'],
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
    type: item.type === 'journey' ? 'business' : item.type === 'screen' ? 'smoke' : 'regression',
    source: item.type === 'screen' ? 'hybrid' : 'qa',
    flow: item.name,
    criticality: item.criticality === 'blocker' ? 'blocking' : item.criticality,
    adapter: 'api',
    command: 'node',
    commandArgs: ['core/rpa/cli.js', 'business', `--mode=${modeByType[item.type]}`, `--code=${item.code}`],
    assertions: item.assertions || [],
    steps: item.preconditions || [],
    impactScopes: [item.vertical, 'ci', 'telemetry'],
    scenarioCode: item.code,
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

function buildRegistry() {
  return [
    ...loadQaSmokeScenarios(),
    ...[...SCREEN_SCENARIOS, ...FLOW_SCENARIOS, ...JOURNEY_SCENARIOS].map(normalizeBusinessScenario),
    ...loadRpaFlowScenarios(),
  ].sort((a, b) => a.id.localeCompare(b.id));
}

function saveRegistry(registry) {
  fs.writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  return registry;
}

function refreshRegistry() {
  return saveRegistry(buildRegistry());
}

function loadRegistry() {
  const current = safeReadJson(REGISTRY_PATH, null);
  if (Array.isArray(current) && current.length > 0) {
    return current.map((item) => toScenarioBase({
      ...item,
      requiresOfficialPipeline: scenarioRequiresOfficialPipeline(item),
    }));
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

function resolveAdapter(adapterName) {
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

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return filePath;
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

function collectScenarioDiagnostics(result) {
  const fromErrors = normalizeErrorList(result.errors)
    .map((item) => compactText(item?.error || item?.message || item))
    .filter(Boolean);
  const fromLogs = (result.logs || [])
    .map((item) => compactText(item?.error || item?.message || item))
    .filter(Boolean);
  const fromArtifacts = extractEvidenceHints(result.artifacts || []);
  return [...fromErrors, ...fromLogs, ...fromArtifacts].filter(Boolean);
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

function classifyScenarioResult(result, history = []) {
  if (result.status === 'passed') {
    return {
      ...result,
      failureType: null,
      errorMessage: null,
      rootCauseHint: null,
      durationMs: durationMs(result.startedAt, result.finishedAt),
    };
  }

  // passed_via_fallback: passou mas via adapter secundário — degradação explícita
  if (result.status === 'passed_via_fallback') {
    return {
      ...result,
      failureType: null,
      errorMessage: null,
      rootCauseHint: 'Cenário passou via fallback para adapter API (primary adapter falhou).',
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

  if (hasIntermittentHistory) {
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

function aggregateFailures(results = []) {
  // passed_via_fallback é tratado como não-falha estrutural, mas degradação visível
  const failures = results.filter((item) => item.status !== 'passed' && item.status !== 'passed_via_fallback');
  const fallbackUsed = results.filter((item) => item.status === 'passed_via_fallback');
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
  if (!baseline.bestKnown || currentPassRate >= bestPassRate) {
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
  const replayDir = path.join(baseDir, 'replays');
  ensureDir(replayDir);
  const type = scenario.source === 'hybrid' ? 'hybrid_replay' : scenario.rpaRecordingId ? 'rpa_replay' : 'api_replay';
  const payload = {
    scenarioId: scenario.id,
    flow: scenario.flow,
    type,
    source: scenario.source,
    command: scenario.command ? [scenario.command, ...(scenario.commandArgs || [])] : null,
    recordingId: scenario.rpaRecordingId || null,
    steps: (scenario.steps || []).map((step, index) => ({
      index: index + 1,
      name: typeof step === 'string' ? step : step.type || JSON.stringify(step),
    })),
    assertions: scenario.assertions || [],
    logs: result.logs || [],
    errors: result.errors || [],
    generatedAt: nowIso(),
  };
  return {
    type: 'replay',
    path: writeJson(path.join(replayDir, `${scenario.id}.json`), payload),
    replayType: type,
  };
}

function writeScenarioEvidence(baseDir, result) {
  const target = path.join(baseDir, 'scenarios', `${result.id}.json`);
  writeJson(target, result);
  return target;
}

function writeSummary(baseDir, summary) {
  const target = path.join(baseDir, 'summary.json');
  writeJson(target, summary);
  return target;
}

function loadHistory(limit = 20) {
  ensureDir(HISTORY_DIR);
  return fs.readdirSync(HISTORY_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit)
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

  try {
    const adapterResult = await adapter.executeScenario(scenario, { repoRoot: ROOT_DIR });
    return {
      ...adapterResult,
      status: classifyScenarioStatus(adapterResult),
    };
  } catch (error) {
    if (adapter !== apiAdapter && scenario.command) {
      context.appendLog?.(`Fallback para adapter API em ${scenario.id}`, 'warning');
      try {
        const fallbackResult = await apiAdapter.executeScenario(scenario, { repoRoot: ROOT_DIR });
        const fallbackStatus = classifyScenarioStatus(fallbackResult);
        // Marcar explicitamente que o resultado passou via fallback — nunca ocultar degradação.
        const degradedStatus = fallbackStatus === 'passed' ? 'passed_via_fallback' : fallbackStatus;
        return {
          ...fallbackResult,
          status: degradedStatus,
          runtimeMode: 'REAL_FAILED_FALLBACK_USED',
          metrics: {
            ...(fallbackResult.metrics || {}),
            fallbackAdapter: 'api',
            primaryAdapterFailed: true,
          },
        };
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
  ensureDir(HISTORY_DIR);
  ensureDir(EVIDENCE_DIR);
  const requestedCanonicalOutputs = options.writeCanonicalOutputs !== false;
  const executionOrigin = determineExecutionOrigin(options);
  const executionKind = options.executionKind || null;
  const writeCanonicalOutputs = requestedCanonicalOutputs && process.env.RUNNING_IN_PIPELINE === '1';
  const isCanonicalExecution = writeCanonicalOutputs && executionOrigin === 'pipeline';
  checkpointManager.ensureStateFiles();
  const waveId = options.wave || process.env.QA_WAVE_ID || 'WAVE-MESH';
  const waveTitle = options.waveTitle || 'Execucao QA Mesh integrada';
  checkpointManager.startWave({
    wave: waveId,
    title: waveTitle,
    changes: ['Execucao de malha QA iniciada'],
  });

  const priorHistory = loadHistory(15);
  const registry = Array.isArray(options.registry)
    ? options.registry
    : (options.refreshRegistry === false ? loadRegistry() : refreshRegistry());
  const changedFiles = options.changedFiles || (options.detectChangedFiles ? getChangedFiles(options.baseRef) : []);
  const scenarios = selectScenarios(registry, options);
  const registryTotal = scenarios.length;
  const executionId = options.executionId || `mesh-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const startedAt = nowIso();
  const evidenceDir = path.join(EVIDENCE_DIR, executionId);

  ensureDir(path.join(evidenceDir, 'scenarios'));
  ensureDir(path.join(evidenceDir, 'logs'));
  ensureDir(path.join(evidenceDir, 'screenshots'));
  ensureDir(path.join(evidenceDir, 'videos'));
  ensureDir(path.join(evidenceDir, 'replays'));

  const results = [];
  const executionLogs = [];
  const appendLog = (message, level = 'info', extra = {}) => {
    executionLogs.push({ timestamp: nowIso(), level, message, ...extra });
    if (typeof options.onLog === 'function') {
      options.onLog({ timestamp: nowIso(), level, message, ...extra });
    }
  };

  for (const [index, scenario] of scenarios.entries()) {
    const scenarioStartedAt = nowIso();
    console.log('EXECUTING_SCENARIO', scenario.id);
    appendLog('EXECUTING_SCENARIO', 'info', { scenarioId: scenario.id, index: index + 1, total: registryTotal });
    options.onScenarioStart?.({
      scenarioId: scenario.id,
      index: index + 1,
      total: registryTotal,
    });

    const adapterResult = await executeScenarioWithFallback(scenario, { appendLog });
    const scenarioFinishedAt = nowIso();
    const result = {
      id: scenario.id,
      domain: scenario.domain,
      type: scenario.type,
      source: scenario.source,
      flow: scenario.flow,
      criticality: scenario.criticality,
      adapter: scenario.adapter,
      status: adapterResult.status,
      startedAt: scenarioStartedAt,
      finishedAt: scenarioFinishedAt,
      logs: adapterResult.logs || [],
      metrics: adapterResult.metrics || {},
      errors: normalizeErrorList(adapterResult.errors),
      artifacts: adapterResult.artifacts || [],
      assertions: scenario.assertions || [],
      rpaRecordingId: scenario.rpaRecordingId || null,
    };
    const replayArtifact = buildSyntheticReplay(scenario, result, evidenceDir);
    result.artifacts = [...result.artifacts, replayArtifact];
    result.replayArtifact = replayArtifact.path;
    const classifiedResult = classifyScenarioResult(result, priorHistory);
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

  const failureAnalysis = aggregateFailures(results);
  const repairPlan = buildRepairPlan(results);

  const summary = {
    executionId,
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

  // Se existem cenários blocking passando via fallback: degradar explicitamente o gate
  if (summary.fallbackBlockingUsed > 0) {
    if (summary.goNoGo === 'GO') {
      summary.goNoGo = 'GO_DEGRADED';
    }
    summary.reasons = [
      ...(summary.reasons || []),
      `${summary.fallbackBlockingUsed} cenário(s) blocking passaram via fallback de adapter (primary falhou) — execução degradada.`,
    ];
  }

  const baselineBeforeUpdate = loadBaseline();
  const baselineComparison = compareWithBaseline(baselineBeforeUpdate, summary, results);
  if (baselineComparison.regressed) {
    summary.goNoGo = 'NO_GO';
    summary.reasons = [...new Set([...(summary.reasons || []), ...baselineComparison.reasons])];
  }

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
      totals: summary,
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
      generatedAt: nowIso(),
    });
  }

  const execution = {
    executionId,
    startedAt,
    finishedAt: nowIso(),
    executionOrigin,
    executionKind,
    isCanonicalExecution,
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
  writeJson(execution.historyPath, normalizeExecutionRecord(execution));

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
  loadHistory,
  diffAgainstPrevious,
  executeScenarioWithFallback,
  normalizeExecutionRecord,
};
