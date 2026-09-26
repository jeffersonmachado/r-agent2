'use strict';

/**
 * QA Waves Intelligence Service
 *
 * Responsabilidades:
 * - Analisar jornadas existentes e detectar gaps de cobertura
 * - Gerar cenários draft por IA adaptados ao RAP
 * - Gerar seeds diversificadas por IA
 * - Classificar criticidade de cenários
 * - Propor ligação com mesh scenarios existentes
 * - Calcular cobertura por vertical / jornada / etapa
 * - Governança de waves (GO / NO_GO)
 *
 * Modelo de status para cenários gerados por IA:
 *   draft_ai → approved | rejected
 *   approved → active | deprecated
 *
 * Cenários draft_ai NUNCA são executados automaticamente.
 */

const fs = require('fs');
const path = require('path');
const { generateAiResponse } = require('./aiProviderService');
const qaMeshService = require('./qaMeshService');
const {
  loadScenarioStore,
  upsertScenarioStore,
  normalizeScenarioRecord,
} = require('./qaWavesScenarioService');
const { normalizeAiOutput } = require('../modules/qa-waves/aiScenarioAdapter');
const { getAllReplayReadDirs } = require('../../lib/rpaPathResolver');
const { belongsToTenant, normalizeTenantKey } = require('../../lib/rpaSecurity');
const { getBlockingJourneys, getSeverityByJourney } = require('../../qa/contracts/journeyCriticality');
const { writeJsonAtomic } = require('../utils/atomicJsonFile');

const ROOT_DIR = path.join(__dirname, '..', '..');
const COVERAGE_MAP_PATH = path.join(ROOT_DIR, 'qa', 'qa-waves', 'coverage-map.json');
const DRAFTS_STORE_PATH = path.join(ROOT_DIR, 'qa', 'qa-waves', 'ai-drafts.json');
const GOVERNANCE_REPORT_PATH = path.join(ROOT_DIR, 'qa', 'qa-waves', 'governance-report.json');

// ─── Utilidades ──────────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function safeWriteJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  writeJsonAtomic(filePath, data);
}

// ─── Coverage Map ─────────────────────────────────────────────────────────────

/**
 * Lê o mapa de cobertura.
 */
function loadCoverageMap() {
  return safeReadJson(COVERAGE_MAP_PATH, { verticals: [] });
}

/**
 * Persiste o mapa de cobertura.
 */
function saveCoverageMap(map) {
  safeWriteJson(COVERAGE_MAP_PATH, map);
}

/**
 * Retorna o coverage map para uma vertical específica, criando entrada vazia se não existir.
 */
function getCoverageMapForVertical(vertical) {
  const map = loadCoverageMap();
  const entry = (map.verticals || []).find((v) => v.vertical === vertical);
  return entry || { vertical, journeys: [] };
}

// ─── Replay Index ─────────────────────────────────────────────────────────────

const REPLAY_FRESHNESS_DAYS = 7;

// ── Cache do índice de replays (2026-09-26) ─────────────────────────────────
// `buildReplayIndex` varre TODOS os diretórios de replay e faz
// `JSON.parse(readFileSync())` arquivo a arquivo, de forma SÍNCRONA. Medido no
// runtime real: `GET /api/qa-waves/intelligence/coverage` custava ~25 s por
// requisição com a máquina ociosa e, num burst de 4 concorrentes (o cenário de
// browser da malha carrega a página de QA Waves em vários contextos), os tempos
// foram 30/50/77/105,7 s — estourando o timeout de 90 s do client em DEV
// (`frontend/src/api/client.js:46`) e derrubando `fitness-matricula-leads` como
// `infra_error` → `CRITICAL_DOMAIN_FAILED:omnichannel` → mesh NO_GO → selo
// bloqueado na fase prepare.
// O índice é SOMENTE LEITURA (nenhum consumidor muta o objeto devolvido) e só
// muda quando um replay novo aparece, então:
//  - `signature` = (dir, nº de entradas, mtime do diretório): replay é
//    write-once, então adicionar/remover arquivo muda a assinatura — é ESTA a
//    invalidação de precisão;
//  - `TTL` é apenas o backstop temporal (5 min): a frescura do índice é dado
//    operacional que muda quando a malha/ondas rodam, não a cada segundo;
//  - `cooldown` limita a FREQUÊNCIA do rebuild — sem ele, N requisições
//    concorrentes num momento de mudança fazem N varreduras síncronas em série
//    no mesmo event loop, que é a amplificação medida acima.
const REPLAY_INDEX_TTL_MS = Number(process.env.QA_WAVES_REPLAY_INDEX_TTL_MS || 300000);
const REPLAY_INDEX_REBUILD_COOLDOWN_MS = Number(process.env.QA_WAVES_REPLAY_INDEX_COOLDOWN_MS || 5000);
const replayIndexCache = new Map();

function replayDirsSignature(dirs) {
  // Só `stat` do diretório: a mtime do diretório muda quando entradas são
  // criadas/removidas (replay é write-once). NÃO usar `readdirSync(dir).length`
  // aqui: em diretório com milhares de arquivos ele lê a listagem inteira a
  // CADA requisição e vira o novo gargalo (medido: burst de 8 custava 11,4 s só
  // por causa disso, com o índice já em cache).
  return dirs.map((dir) => {
    try {
      return `${dir}\u0000${fs.statSync(dir).mtimeMs}`;
    } catch (_) {
      return `${dir}\u0000missing`;
    }
  }).join('|');
}

/**
 * Lê todos os arquivos de replay disponíveis e retorna um índice
 * {scenarioId -> { latestAt, hasFailure, count }}
 */
function buildReplayIndex(tenantId = 'system') {
  const scopedTenantId = normalizeTenantKey(tenantId);
  const dirs = getAllReplayReadDirs(scopedTenantId).filter((d) => fs.existsSync(d));
  const signature = replayDirsSignature(dirs);
  const cached = replayIndexCache.get(scopedTenantId);
  if (cached && Date.now() < cached.expiresAt) {
    if (cached.signature === signature) return cached.index;
    if (Date.now() - cached.builtAt < REPLAY_INDEX_REBUILD_COOLDOWN_MS) return cached.index;
  }

  const index = {};
  const now = Date.now();
  const freshnessMs = REPLAY_FRESHNESS_DAYS * 24 * 60 * 60 * 1000;

  for (const dir of dirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
        if (!belongsToTenant(raw, scopedTenantId)) continue;
        const scenarioId = raw.scenarioId || raw.recordingId || null;
        if (!scenarioId) continue;

        const finishedAt = raw.finishedAt || raw.endTime || null;
        const finishedMs = finishedAt ? new Date(finishedAt).getTime() : 0;
        const status = String(raw.status || raw.result || '').toLowerCase();
        const isFailed = status === 'failed' || status === 'failure' || status === 'error';
        const isFresh = finishedMs > 0 && now - finishedMs < freshnessMs;

        if (!index[scenarioId]) {
          index[scenarioId] = { latestAt: finishedAt, hasFailure: false, hasFresh: false, count: 0 };
        }
        const rec = index[scenarioId];
        rec.count += 1;
        if (!rec.latestAt || finishedMs > new Date(rec.latestAt).getTime()) {
          rec.latestAt = finishedAt;
        }
        if (isFailed) rec.hasFailure = true;
        if (isFresh) rec.hasFresh = true;
      } catch (_) {
        // arquivo ilegível, ignora
      }
    }
  }

  replayIndexCache.set(scopedTenantId, {
    builtAt: Date.now(),
    expiresAt: Date.now() + REPLAY_INDEX_TTL_MS,
    signature,
    index,
  });

  return index;
}

// ─── Gap Analyzer ─────────────────────────────────────────────────────────────

/**
 * Analisa gaps de cobertura para uma vertical/jornada específica.
 *
 * @param {{ vertical: string, journey?: string }} opts
 * @param {object[]} existingScenarios - cenários já salvos (de qaWavesScenarioService)
 * @returns {{
 *   vertical: string,
 *   journey: string|null,
 *   coverage: number,
 *   missingScenarios: string[],
 *   weakScenarios: Array<{id:string, reason:string}>,
 *   missingSeeds: string[],
 *   missingValidators: string[],
 *   recommendedActions: string[],
 *   replayStats: object,
 *   stageBreakdown: object[]
 * }}
 */
function analyzeCoverageGaps({ vertical, journey = null, tenantId = 'system' }, existingScenarios = [], prebuiltReplayIndex = null) {
  const scopedTenantId = normalizeTenantKey(tenantId);
  // scenario-store é a fonte primária de cenários requeridos
  const storeData = loadScenarioStore();
  const storeScenarios = storeData.scenarios || storeData || [];
  const replayIndex = prebuiltReplayIndex || buildReplayIndex(scopedTenantId);

  // Filtra pelo vertical; usa waveId como fallback quando vertical não está preenchido
  let relevantScenarios = storeScenarios
    .filter((scenario) => belongsToTenant(scenario, scopedTenantId))
    .filter((s) => s.vertical === vertical || (s.waveId && String(s.waveId).startsWith(vertical)));
  if (journey) {
    relevantScenarios = relevantScenarios.filter(
      (s) => s.journeyId === journey || s.journey === journey,
    );
  }

  // Mescla com cenários fornecidos explicitamente (overrides pontuais),
  // mantendo o escopo vertical/jornada para não contaminar o resultado.
  let tenantScenarios = existingScenarios.filter((scenario) => belongsToTenant(scenario, scopedTenantId));
  if (vertical) {
    tenantScenarios = tenantScenarios.filter((s) => s.vertical === vertical || (s.waveId && String(s.waveId).startsWith(vertical)));
  }
  if (journey) {
    tenantScenarios = tenantScenarios.filter((s) => s.journeyId === journey || s.journey === journey);
  }
  const overrideById = new Map(tenantScenarios.map((s) => [s.id || s.scenarioId, s]));
  const allRelevant = relevantScenarios.map((s) => overrideById.get(s.id) || s);
  // Adiciona qualquer cenário extra não presente no store (e.g. drafts passados manualmente)
  for (const extra of tenantScenarios) {
    const extraId = extra.id || extra.scenarioId;
    if (extraId && !allRelevant.find((r) => r.id === extraId)) {
      allRelevant.push(extra);
    }
  }

  const missingScenarios = [];
  const weakScenarios = [];
  const missingSeeds = [];
  const missingValidators = [];
  const recommendedActions = [];
  const stageBreakdown = [];

  const totalRequired = allRelevant.length;
  let totalCovered = 0;

  // Agrupa por jornada para o stageBreakdown
  const byJourney = {};
  for (const s of allRelevant) {
    const jid = s.journeyId || s.journey || 'unknown';
    if (!byJourney[jid]) byJourney[jid] = [];
    byJourney[jid].push(s);
  }

  for (const [journeyId, scenarios] of Object.entries(byJourney)) {
    const stageReport = {
      journeyId,
      stageId: journeyId,
      stageName: journeyId,
      required: [],
      covered: [],
      missing: [],
      weak: [],
    };

    for (const scenario of scenarios) {
      const reqScenarioId = scenario.id || scenario.scenarioId;
      stageReport.required.push(reqScenarioId);

      const replay = replayIndex[reqScenarioId] || null;

      if (!replay) {
        missingScenarios.push(reqScenarioId);
        stageReport.missing.push(reqScenarioId);
        recommendedActions.push(`Executar cenário para gerar replay: ${reqScenarioId}`);
      } else {
        totalCovered++;
        stageReport.covered.push(reqScenarioId);
      }

      const seeds = Array.isArray(scenario?.seeds) ? scenario.seeds : [];
      const semanticSteps = Array.isArray(scenario?.semanticSteps) ? scenario.semanticSteps : [];
      const validators = Array.isArray(scenario?.validators) ? scenario.validators : [];

      const weakReasons = [];

      if (seeds.length === 0) {
        missingSeeds.push(reqScenarioId);
        weakReasons.push('sem seeds');
        recommendedActions.push(`Gerar seeds para: ${reqScenarioId}`);
      }

      if (validators.length === 0 && semanticSteps.length === 0) {
        missingValidators.push(reqScenarioId);
        weakReasons.push('sem validadores/steps');
        recommendedActions.push(`Adicionar validadores semânticos em: ${reqScenarioId}`);
      }

      if (replay) {
        if (replay.hasFailure) {
          weakReasons.push('replay com falha recente');
          recommendedActions.push(`Investigar falha em replay: ${reqScenarioId}`);
        }
        if (!replay.hasFresh) {
          weakReasons.push('replay desatualizado (>7 dias)');
          recommendedActions.push(`Revalidar cenário: ${reqScenarioId}`);
        }
      }

      if (weakReasons.length > 0) {
        weakScenarios.push({ id: reqScenarioId, reasons: weakReasons });
        stageReport.weak.push({ id: reqScenarioId, reasons: weakReasons });
      }
    }

    stageBreakdown.push(stageReport);
  }

  const coverage = totalRequired > 0 ? Math.round((totalCovered / totalRequired) * 100) / 100 : 0;

  return {
    vertical,
    journey,
    coverage,
    totalRequired,
    totalCovered,
    missingScenarios: [...new Set(missingScenarios)],
    weakScenarios,
    missingSeeds: [...new Set(missingSeeds)],
    missingValidators: [...new Set(missingValidators)],
    recommendedActions: [...new Set(recommendedActions)],
    replayStats: buildReplayIndexSummary(replayIndex),
    stageBreakdown,
    analyzedAt: nowIso(),
  };
}

function buildReplayIndexSummary(index) {
  const ids = Object.keys(index);
  return {
    totalScenarios: ids.length,
    withFreshReplay: ids.filter((id) => index[id].hasFresh).length,
    withFailure: ids.filter((id) => index[id].hasFailure).length,
    withoutReplay: 0, // calculado no analyzer
  };
}

// ─── AI Scenario Generation ───────────────────────────────────────────────────

/**
 * Gera um rascunho de cenário por IA.
 * NUNCA é executado automaticamente — entra como draft_ai.
 *
 * @param {{ vertical: string, journey: string, stage: string, gap: string, context?: object }} opts
 * @returns {Promise<object>} scenario draft
 */
async function generateScenarioDraft({ vertical, journey, stage, gap, context = {}, tenantId = 'system' }) {
  const scopedTenantId = normalizeTenantKey(tenantId);
  const prompt = buildScenarioDraftPrompt({ vertical, journey, stage, gap, context });

  let scenarioJson = null;

  try {
    const aiResponse = await generateAiResponse(
      `${SCENARIO_SYSTEM_PROMPT}\n\n${prompt}`,
      scopedTenantId,
      { source: 'qa_waves_intelligence', caller: 'generateScenarioDraft' },
    );

    scenarioJson = extractJsonFromAiResponse(aiResponse?.text || '');
  } catch (_) {
    // fallback estrutural quando IA não está disponível
  }

  if (!scenarioJson || typeof scenarioJson !== 'object') {
    scenarioJson = buildFallbackScenarioDraft({ vertical, journey, stage, gap });
  }

  const now = nowIso();
  const draft = {
    id: scenarioJson.id || makeId(`${vertical}_${stage}`),
    tenantId: scopedTenantId,
    waveId: scenarioJson.waveId || `${vertical}-${journey}`,
    title: scenarioJson.title || `[IA] ${gap}`,
    vertical,
    journey,
    stage,
    gap,
    semanticSteps: Array.isArray(scenarioJson.semanticSteps) ? scenarioJson.semanticSteps : [],
    seeds: Array.isArray(scenarioJson.seeds) ? scenarioJson.seeds : [],
    validators: Array.isArray(scenarioJson.validators) ? scenarioJson.validators : [],
    platformScenarioIds: Array.isArray(scenarioJson.platformScenarioIds) ? scenarioJson.platformScenarioIds : [],
    criticality: scenarioJson.criticality || 'medium',
    // Status obrigatório: draft_ai — não executa sem aprovação manual
    status: 'draft_ai',
    source: 'ai_generated',
    reviewedBy: null,
    reviewedAt: null,
    approvedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    createdAt: now,
    updatedAt: now,
    aiModel: 'intelligence_engine_v1',
  };

  // Persiste nos drafts
  persistDraft(draft);

  return draft;
}

const SCENARIO_SYSTEM_PROMPT = `
Você é o RAP Intelligence Engine — gerador de cenários de QA para plataformas de atendimento.
Gere cenários ESPECÍFICOS para o contexto da jornada indicada, nunca genéricos.
Retorne APENAS JSON válido no formato especificado.
Nunca inclua explicações fora do JSON.
`.trim();

function buildScenarioDraftPrompt({ vertical, journey, stage, gap, context }) {
  return `
Vertical: ${vertical}
Jornada: ${journey}
Etapa: ${stage}
Gap identificado: ${gap}
Contexto adicional: ${JSON.stringify(context)}

Gere um cenário de QA Wave no formato JSON:
{
  "id": "<vertical>_<etapa>_<descricao_curta>",
  "waveId": "<vertical>-<jornada>",
  "title": "<título específico>",
  "criticality": "low|medium|high|critical",
  "semanticSteps": [
    { "type": "<tipo_do_step_catalog>", "expected": "<comportamento_esperado>", "adapter": "<adapter_opcional>" }
  ],
  "seeds": [],
  "validators": [
    { "type": "semantic_intent", "expected": "<intent>" }
  ],
  "platformScenarioIds": []
}

Tipos válidos de step: send_message, validate_intent, provide_data, validate_response,
check_availability, select_slot, create_booking, create_payment, validate_backend,
validate_sla, validate_context, validate_fallback, validate_flow_transition,
validate_access_release, wait_for_event, trigger_channel_event.
`.trim();
}

function buildFallbackScenarioDraft({ vertical, journey, stage, gap }) {
  const id = `${vertical}_${stage}_${String(gap).toLowerCase().replace(/\s+/g, '_').slice(0, 30)}`;
  return {
    id,
    waveId: `${vertical}-${journey}`,
    title: `[Rascunho] ${gap}`,
    criticality: 'medium',
    semanticSteps: [
      { type: 'send_message', expected: 'mensagem_inicial' },
      { type: 'validate_intent', expected: gap },
      { type: 'validate_response', expected: 'resposta_adequada' },
    ],
    seeds: [],
    validators: [{ type: 'semantic_intent', expected: gap }],
    platformScenarioIds: [],
  };
}

function extractJsonFromAiResponse(text) {
  try {
    // Tenta extrair bloco JSON de uma resposta markdown ou plain text
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]+?)```/) || text.match(/(\{[\s\S]+\})/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    return JSON.parse(text.trim());
  } catch (_) {
    return null;
  }
}

// ─── AI Seed Generation ───────────────────────────────────────────────────────

/**
 * Gera seeds diversificadas por IA para um cenário.
 *
 * @param {{ scenarioId: string, quantity?: number, scenarioContext?: object }} opts
 * @returns {Promise<object[]>}
 */
async function generateSeedsForScenario({ scenarioId, quantity = 5, scenarioContext = {}, tenantId = 'system' }) {
  const scopedTenantId = normalizeTenantKey(tenantId);
  const prompt = buildSeedGenerationPrompt({ scenarioId, quantity, scenarioContext });

  let seeds = null;

  try {
    const aiResponse = await generateAiResponse(
      `${SEED_SYSTEM_PROMPT}\n\n${prompt}`,
      scopedTenantId,
      { source: 'qa_waves_intelligence', caller: 'generateSeedsForScenario' },
    );

    const raw = extractJsonFromAiResponse(aiResponse?.text || '');
    if (Array.isArray(raw)) seeds = raw;
    else if (raw?.seeds && Array.isArray(raw.seeds)) seeds = raw.seeds;
  } catch (_) {
    // fallback
  }

  if (!Array.isArray(seeds) || seeds.length === 0) {
    seeds = buildFallbackSeeds({ scenarioId, quantity });
  }

  const now = nowIso();
  return seeds.map((seed, i) => ({
    id: seed.id || makeId(`seed_${scenarioId}_${i}`),
    tenantId: scopedTenantId,
    scenarioId,
    profile: seed.profile || 'cliente_generico',
    channel: seed.channel || 'whatsapp',
    input: seed.input || '',
    expectedIntent: seed.expectedIntent || '',
    constraints: seed.constraints || {},
    expectedOutcome: seed.expectedOutcome || '',
    // Seeds geradas por IA entram como draft
    status: 'draft_ai',
    source: 'ai_generated',
    createdAt: now,
    updatedAt: now,
  }));
}

const SEED_SYSTEM_PROMPT = `
Você é o RAP Intelligence Engine — gerador de seeds de teste para QA Waves.
Gere seeds VARIADAS e REALISTAS para o cenário indicado.
Cubra: perfis diferentes, canais, horários, intenções, restrições, erros propositais, contextos anteriores.
Retorne APENAS um array JSON de seeds.
`.trim();

function buildSeedGenerationPrompt({ scenarioId, quantity, scenarioContext }) {
  return `
Cenário: ${scenarioId}
Contexto: ${JSON.stringify(scenarioContext)}
Quantidade desejada: ${quantity}

Gere ${quantity} seeds no formato:
[
  {
    "id": "seed_<descricao>",
    "profile": "cliente_novo|cliente_ativo|sensivel_preco|urgente|indeciso",
    "channel": "whatsapp|chat|pbx|api",
    "input": "<texto de entrada do cliente>",
    "expectedIntent": "<intent esperado>",
    "constraints": { "<campo>": "<valor>" },
    "expectedOutcome": "<resultado esperado>"
  }
]

Varie obrigatoriamente: perfil, canal, horário, intenção, restrição, erro proposital,
contexto anterior e dados de negócio.
`.trim();
}

function buildFallbackSeeds({ scenarioId, quantity }) {
  const profiles = ['cliente_novo', 'cliente_ativo', 'sensivel_preco', 'urgente', 'indeciso'];
  const channels = ['whatsapp', 'chat', 'pbx', 'api'];
  const seeds = [];
  for (let i = 0; i < quantity; i++) {
    seeds.push({
      id: `seed_${scenarioId}_${i + 1}`,
      profile: profiles[i % profiles.length],
      channel: channels[i % channels.length],
      input: `Variação de entrada ${i + 1} para ${scenarioId}`,
      expectedIntent: scenarioId,
      constraints: {},
      expectedOutcome: 'resposta_adequada',
    });
  }
  return seeds;
}

// ─── Draft Management ─────────────────────────────────────────────────────────

function loadDrafts() {
  return safeReadJson(DRAFTS_STORE_PATH, { drafts: [], updatedAt: null });
}

function persistDraft(draft) {
  const scopedTenantId = normalizeTenantKey(draft?.tenantId || 'system');
  const scopedDraft = { ...draft, tenantId: scopedTenantId };
  const store = loadDrafts();
  const existing = store.drafts.findIndex((d) => d.id === scopedDraft.id
    && belongsToTenant(d, scopedTenantId));
  if (existing >= 0) {
    store.drafts[existing] = scopedDraft;
  } else {
    store.drafts.push(scopedDraft);
  }
  store.updatedAt = nowIso();
  safeWriteJson(DRAFTS_STORE_PATH, store);
}

function listDrafts({ status = null, vertical = null, journey = null, tenantId = 'system' } = {}) {
  const scopedTenantId = normalizeTenantKey(tenantId);
  const store = loadDrafts();
  let drafts = (store.drafts || []).filter((draft) => belongsToTenant(draft, scopedTenantId));

  if (status) drafts = drafts.filter((d) => d.status === status);
  if (vertical) drafts = drafts.filter((d) => d.vertical === vertical);
  if (journey) drafts = drafts.filter((d) => d.journey === journey);

  return drafts;
}

function findDraft(store, draftId, tenantId = 'system') {
  const scopedTenantId = normalizeTenantKey(tenantId);
  return (store.drafts || []).find((draft) => draft.id === draftId
    && belongsToTenant(draft, scopedTenantId)) || null;
}

function toScenarioValidators(draft) {
  if (Array.isArray(draft?.validators) && draft.validators.length > 0) {
    return draft.validators;
  }

  return (Array.isArray(draft?.semanticSteps) ? draft.semanticSteps : [])
    .filter((step) => String(step?.type || '').startsWith('validate_'))
    .map((step) => ({
      id: step.id || null,
      type: step.type,
      expected: step.expected || null,
    }));
}

function toScenarioSeeds(draft) {
  const now = nowIso();
  return (Array.isArray(draft?.seeds) ? draft.seeds : []).map((seed, index) => ({
    ...seed,
    id: seed.id || makeId(`seed_${draft.id}_${index + 1}`),
    scenarioId: draft.id,
    source: seed.source || 'ai_generated',
    status: seed.status === 'draft_ai' ? 'approved' : (seed.status || 'approved'),
    createdAt: seed.createdAt || now,
    updatedAt: now,
  }));
}

function convertDraftToScenario(draft) {
  const normalizedAiScenario = normalizeAiOutput({
    id: draft.id,
    waveId: draft.waveId,
    vertical: draft.vertical,
    journey: draft.journey,
    name: draft.title || draft.id,
    description: `Cenário materializado a partir de draft IA: ${draft.gap || draft.id}`,
    source: 'ai_inferred',
    status: 'active',
    channels: ['whatsapp', 'chat', 'api'],
    risk: draft.criticality || 'medium',
    priority: draft.criticality || 'medium',
    steps: Array.isArray(draft.semanticSteps) ? draft.semanticSteps : [],
    seeds: toScenarioSeeds(draft),
    validations: {
      requireReplay: true,
      requireBackendValidation: true,
      fallbackAllowed: false,
      slaMs: 15000,
    },
    platform: {
      platformScenarioIds: Array.isArray(draft.platformScenarioIds) ? draft.platformScenarioIds : [],
    },
    tags: {
      waveId: draft.waveId,
      journey: draft.journey,
      source: 'ai_generated',
      vertical: draft.vertical,
      stage: draft.stage || null,
      gap: draft.gap || null,
    },
    createdAt: draft.createdAt,
  }, {
    vertical: draft.vertical,
    journey: draft.journey,
    goal: draft.title || draft.id,
    channels: ['whatsapp', 'chat', 'api'],
  });

  return normalizeScenarioRecord({
    ...normalizedAiScenario,
    tenantId: normalizeTenantKey(draft.tenantId || 'system'),
    validators: toScenarioValidators(draft),
    semanticSteps: normalizedAiScenario.steps,
    executionStatus: 'queued',
    status: 'active',
    approvedAt: draft.approvedAt || nowIso(),
    reviewedBy: draft.reviewedBy || null,
  });
}

function validateMeshMapping(scenario) {
  const registry = qaMeshService.getRegistry();
  const allowedIds = new Set((registry || []).map((item) => item.id));
  const platformScenarioIds = Array.isArray(scenario?.platformScenarioIds)
    ? scenario.platformScenarioIds
    : [];

  for (const platformScenarioId of platformScenarioIds) {
    if (!allowedIds.has(platformScenarioId)) {
      const error = new Error(`Mesh scenario not found: ${platformScenarioId}`);
      error.code = 'BAD_REQUEST';
      throw error;
    }
  }

  return true;
}

function validateCoverageAlignment(existingScenarios = null) {
  const storeData = loadScenarioStore();
  const scenarios = Array.isArray(existingScenarios)
    ? existingScenarios
    : (storeData.scenarios || storeData || []);

  // Valida integridade dos cenários do store: todos devem ter id, journeyId e vertical
  const invalidScenarios = [];
  for (const s of scenarios) {
    const missing = [];
    if (!s.id) missing.push('id');
    if (!s.journeyId && !s.journey) missing.push('journeyId');
    if (!s.vertical) missing.push('vertical');
    if (missing.length > 0) {
      invalidScenarios.push({ scenarioId: s.id || '?', missingFields: missing });
    }
  }

  return {
    valid: invalidScenarios.length === 0,
    missingScenarios: [], // mantido por compatibilidade — já não deriva de coverage-map
    invalidScenarios,
    totalChecked: scenarios.length,
    checkedAt: nowIso(),
  };
}

/**
 * Aprova um cenário draft_ai.
 * Apenas cenários aprovados podem ser executados.
 */
function approveDraft(draftId, { approvedBy = 'unknown', tenantId = 'system' } = {}) {
  const scopedTenantId = normalizeTenantKey(tenantId);
  const store = loadDrafts();
  const draft = findDraft(store, draftId, scopedTenantId);
  if (!draft) {
    const err = new Error(`Draft não encontrado: ${draftId}`);
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (draft.status !== 'draft_ai') {
    const err = new Error(`Draft não está em status draft_ai: ${draft.status}`);
    err.code = 'BAD_REQUEST';
    throw err;
  }

  draft.status = 'approved';
  draft.reviewedBy = approvedBy;
  draft.reviewedAt = nowIso();
  draft.approvedAt = nowIso();
  draft.updatedAt = nowIso();

  const scenario = convertDraftToScenario(draft);
  validateMeshMapping(scenario);
  const savedScenario = upsertScenarioStore(scenario, {
    changedBy: approvedBy,
    changes: ['draft_ai aprovado e materializado como cenário real'],
  });

  store.updatedAt = nowIso();
  safeWriteJson(DRAFTS_STORE_PATH, store);

  return savedScenario;
}

/**
 * Rejeita um cenário draft_ai.
 */
function rejectDraft(draftId, { rejectedBy = 'unknown', reason = '', tenantId = 'system' } = {}) {
  const scopedTenantId = normalizeTenantKey(tenantId);
  const store = loadDrafts();
  const draft = store.drafts.find((d) => d.id === draftId && belongsToTenant(d, scopedTenantId));
  if (!draft) {
    const err = new Error(`Draft não encontrado: ${draftId}`);
    err.code = 'NOT_FOUND';
    throw err;
  }

  draft.status = 'rejected';
  draft.reviewedBy = rejectedBy;
  draft.reviewedAt = nowIso();
  draft.rejectedAt = nowIso();
  draft.rejectionReason = reason || 'Rejeitado manualmente';
  draft.updatedAt = nowIso();

  store.updatedAt = nowIso();
  safeWriteJson(DRAFTS_STORE_PATH, store);

  return draft;
}

// ─── Coverage Summary ─────────────────────────────────────────────────────────

/**
 * Retorna resumo de cobertura derivado do scenario-store (fonte primária).
 * Cobertura = cenários com pelo menos um replay fresco / total de cenários no store.
 */
function getCoverageSummary(existingScenarios = null, options = {}) {
  let filters = options || {};
  if (existingScenarios && !Array.isArray(existingScenarios) && typeof existingScenarios === 'object') {
    filters = existingScenarios;
    existingScenarios = null;
  }
  const scopedTenantId = normalizeTenantKey(filters.tenantId || 'system');
  const storeData = loadScenarioStore();
  let scenarios = Array.isArray(existingScenarios)
    ? existingScenarios
    : (storeData.scenarios || storeData || []).map((s) => normalizeScenarioRecord(s));
  scenarios = scenarios.filter((scenario) => belongsToTenant(scenario, scopedTenantId));
  if (filters.vertical) scenarios = scenarios.filter((scenario) => scenario.vertical === filters.vertical);
  if (filters.journey) {
    scenarios = scenarios.filter((scenario) => scenario.journeyId === filters.journey || scenario.journey === filters.journey);
  }

  const replayIndex = buildReplayIndex(scopedTenantId);
  const results = [];

  // Agrupa por vertical → jornada
  const byVertical = {};
  for (const s of scenarios) {
    const v = s.vertical || 'unknown';
    const jid = s.journeyId || s.journey || 'unknown';
    if (!byVertical[v]) byVertical[v] = {};
    if (!byVertical[v][jid]) byVertical[v][jid] = [];
    byVertical[v][jid].push(s);
  }

  for (const [vertical, byJourney] of Object.entries(byVertical)) {
    const journeySummaries = [];
    let vertTotalRequired = 0;
    let vertTotalCovered = 0;

    for (const [journeyId, jScenarios] of Object.entries(byJourney)) {
      const totalRequired = jScenarios.length;
      const totalCovered = jScenarios.filter((s) => replayIndex[s.id]?.hasFresh).length;

      vertTotalRequired += totalRequired;
      vertTotalCovered += totalCovered;
      journeySummaries.push({
        journeyId,
        journeyName: journeyId,
        coverage: totalRequired > 0 ? Math.round((totalCovered / totalRequired) * 100) / 100 : 0,
        totalRequired,
        totalCovered,
        missingCount: Math.max(0, totalRequired - totalCovered),
        weakCount: jScenarios.filter((s) => !Array.isArray(s.seeds) || s.seeds.length === 0).length,
      });
    }

    results.push({
      vertical,
      coverage: vertTotalRequired > 0 ? Math.round((vertTotalCovered / vertTotalRequired) * 100) / 100 : 0,
      totalRequired: vertTotalRequired,
      totalCovered: vertTotalCovered,
      journeys: journeySummaries,
    });
  }

  return {
    verticals: results,
    alignment: validateCoverageAlignment(scenarios),
    generatedAt: nowIso(),
  };
}

// ─── Governance ───────────────────────────────────────────────────────────────

// blockingJourneys e severityByJourney NÃO ficam mais aqui: vêm do registry
// declarativo config/journey-criticality.json (ver evaluateWaveGovernance).
const GOVERNANCE_DEFAULTS = {
  minCoverage: 0.7,
  minQuality: 0.8,
  maxCriticalFailures: 0,
  replayRequired: true,
  strictMode: true,
};

/**
 * Avalia se uma wave pode ir para produção (GO / NO_GO).
 *
 * @param {{ waveId: string, scenarios: object[], meshExecution?: object }} opts
 * @returns {{ waveId, status, coverage, quality, criticalFailures, reasons, details }}
 */
function evaluateWaveGovernance({ waveId, scenarios = [], meshExecution = null, policy = {}, tenantId = 'system' }) {
  const scopedTenantId = normalizeTenantKey(tenantId);
  // Defaults de blocking/severity vêm do registry declarativo; `policy`
  // continua podendo sobrescrever explicitamente.
  const rules = {
    ...GOVERNANCE_DEFAULTS,
    blockingJourneys: getBlockingJourneys(),
    severityByJourney: getSeverityByJourney(),
    ...policy,
  };
  const replayIndex = buildReplayIndex(scopedTenantId);
  const blockingJourneys = new Set(Array.isArray(rules.blockingJourneys) ? rules.blockingJourneys : []);

  let totalScenarios = 0;
  let coveredScenarios = 0;
  let criticalFailures = 0;
  let qualityScore = 0;
  const reasons = [];
  const details = [];

  for (const scenario of scenarios) {
    const id = scenario.id || scenario.scenarioId;
    if (!id) continue;
    totalScenarios++;

    const replay = replayIndex[id] || null;
    const seeds = Array.isArray(scenario.seeds) ? scenario.seeds : [];
    const validators = Array.isArray(scenario.validators) ? scenario.validators : [];
    const criticality = scenario.criticality || 'medium';
    const journeyId = String(scenario.journeyId || scenario.journey || '').trim();
    const severity = rules.severityByJourney?.[journeyId] || criticality;
    const isCritical = criticality === 'critical' || severity === 'critical';
    const isBlockingJourney = blockingJourneys.has(journeyId);
    const fallbackUsed = scenario.fallbackUsed === true
      || String(scenario.executionStatus || '').toLowerCase() === 'passed_via_fallback'
      || String(scenario.status || '').toLowerCase() === 'passed_via_fallback';

    let scenarioQuality = 1.0;

    if (fallbackUsed) {
      reasons.push(`Fallback operacional detectado: ${id}`);
      scenarioQuality -= 0.6;
      if (rules.strictMode || isBlockingJourney || isCritical) {
        criticalFailures++;
      }
    }

    // Cobertura: precisa ter replay ou estar aprovado e executado
    if (!replay) {
      if (rules.replayRequired) {
        reasons.push(`Cenário sem replay: ${id}`);
        scenarioQuality -= 0.3;
        if (isBlockingJourney || isCritical) {
          criticalFailures++;
        }
      }
    } else {
      coveredScenarios++;
      if (replay.hasFailure) {
        if (isCritical) {
          criticalFailures++;
          reasons.push(`Falha crítica no replay: ${id}`);
        } else {
          reasons.push(`Falha em replay não-crítico: ${id}`);
        }
        scenarioQuality -= 0.5;
      }
      if (!replay.hasFresh) {
        reasons.push(`Replay desatualizado: ${id}`);
        scenarioQuality -= 0.2;
        if (isBlockingJourney && rules.strictMode) {
          criticalFailures++;
        }
      }
    }

    // Qualidade: seeds e validadores
    if (seeds.length === 0) {
      scenarioQuality -= 0.1;
      reasons.push(`Sem seeds: ${id}`);
    }
    if (validators.length === 0) {
      scenarioQuality -= 0.1;
      reasons.push(`Sem validadores: ${id}`);
    }

    qualityScore += Math.max(0, scenarioQuality);
    details.push({
      id,
      replay: !!replay,
      hasFresh: replay?.hasFresh || false,
      hasFailure: replay?.hasFailure || false,
      criticality,
      journeyId,
      journeySeverity: severity,
      blockingJourney: isBlockingJourney,
      fallbackUsed,
      quality: Math.max(0, scenarioQuality),
    });
  }

  const coverage = totalScenarios > 0 ? coveredScenarios / totalScenarios : 0;
  const quality = totalScenarios > 0 ? qualityScore / totalScenarios : 0;

  const goNoGo = coverage >= rules.minCoverage
    && quality >= rules.minQuality
    && criticalFailures <= rules.maxCriticalFailures;

  const report = {
    waveId,
    tenantId: scopedTenantId,
    status: goNoGo ? 'GO' : 'NO_GO',
    coverage: Math.round(coverage * 100) / 100,
    quality: Math.round(quality * 100) / 100,
    criticalFailures,
    totalScenarios,
    coveredScenarios,
    reasons: [...new Set(reasons)],
    details,
    policy: rules,
    evaluatedAt: nowIso(),
  };

  // Persiste relatório de governança
  try {
    const existing = safeReadJson(GOVERNANCE_REPORT_PATH, { reports: [] });
    if (!Array.isArray(existing.reports)) existing.reports = [];
    const idx = existing.reports.findIndex((r) => r.waveId === waveId
      && belongsToTenant(r, scopedTenantId));
    if (idx >= 0) existing.reports[idx] = report;
    else existing.reports.push(report);
    existing.updatedAt = nowIso();
    safeWriteJson(GOVERNANCE_REPORT_PATH, existing);
  } catch (_) {
    // Não bloqueia resposta se falhar ao persistir
  }

  return report;
}

/**
 * Lista todos os relatórios de governança.
 */
function listGovernanceReports(tenantId = 'system') {
  const scopedTenantId = normalizeTenantKey(tenantId);
  const store = safeReadJson(GOVERNANCE_REPORT_PATH, { reports: [] });
  return (store.reports || []).filter((report) => belongsToTenant(report, scopedTenantId));
}

/**
 * Sugere ligações entre cenários wave existentes e mesh scenarios.
 */
function suggestMeshLinks(waveScenarios = [], meshRegistry = []) {
  const suggestions = [];

  for (const wave of waveScenarios) {
    const waveTitle = String(wave.title || wave.id || '').toLowerCase();
    for (const mesh of meshRegistry) {
      const meshTitle = String(mesh.name || mesh.id || '').toLowerCase();
      const waveWords = new Set(waveTitle.split(/\W+/).filter((w) => w.length > 3));
      const meshWords = meshTitle.split(/\W+/).filter((w) => w.length > 3);
      const overlap = meshWords.filter((w) => waveWords.has(w));

      if (overlap.length >= 2) {
        suggestions.push({
          waveScenarioId: wave.id || wave.scenarioId,
          meshScenarioId: mesh.id,
          confidence: Math.min(1, overlap.length / 5),
          matchedTerms: overlap,
        });
      }
    }
  }

  return suggestions;
}

// ─── Business Gaps (contracts × coverage) ──────────────────────────────────

/**
 * Returns business-level gap analysis suitable for UI display.
 * Cross-references journey-contracts.json × journey-coverage × scenario-store.
 */
function getBusinessGaps({ vertical = null, journey = null, tenantId = 'system' } = {}) {
  const scopedTenantId = normalizeTenantKey(tenantId);
  const contractsPath = path.join(ROOT_DIR, 'config', 'journey-contracts.json');
  const coverageDir = path.join(ROOT_DIR, 'qa-waves', 'journey-coverage');
  const storeData = loadScenarioStore();
  const scenarios = (storeData.scenarios || storeData || [])
    .map((s) => normalizeScenarioRecord(s))
    .filter((scenario) => belongsToTenant(scenario, scopedTenantId));

  // Load contracts
  let contracts = { journeys: {} };
  try { contracts = JSON.parse(fs.readFileSync(contractsPath, 'utf8')); } catch (_) {}

  // Build scenario index by vertical+journey
  const scenarioIndex = {};
  for (const s of scenarios) {
    const v = s.vertical || 'unknown';
    const j = s.journey || s.journeyId || 'unknown';
    const key = `${v}/${j}`;
    if (!scenarioIndex[key]) scenarioIndex[key] = [];
    scenarioIndex[key].push(s);
  }

  const results = [];

  // Load journey coverage
  if (fs.existsSync(coverageDir)) {
    for (const file of fs.readdirSync(coverageDir)) {
      if (!file.endsWith('.json')) continue;
      let covData = null;
      try { covData = JSON.parse(fs.readFileSync(path.join(coverageDir, file), 'utf8')); } catch (_) { continue; }
      const vert = covData.vertical || file.replace('.json', '');

      if (vertical && vert !== vertical) continue;

      for (const covJourney of (covData.journeys || [])) {
        const jId = covJourney.journey;
        if (journey && jId !== journey) continue;

        const contract = (contracts.journeys || {})[jId] || null;
        const requiredCaps = contract?.requiredCapabilities || [];
        const confidence = contract?.confidence || 0;
        const key = `${vert}/${jId}`;
        const storeScenarios = scenarioIndex[key] || [];
        const approvedCount = storeScenarios.filter(s => s.status === 'approved').length;
        const totalTarget = (covJourney.scenarios || []).length;

        // Find capabilities without QA scenario
        const coveredCaps = new Set();
        for (const s of storeScenarios) {
          for (const step of (s.steps || [])) {
            const entity = step.expected?.backendEntity || step.targetCapability || '';
            if (entity) coveredCaps.add(entity);
          }
          if (s.targetCapability) coveredCaps.add(s.targetCapability);
        }

        const capGaps = requiredCaps.filter(c => !coveredCaps.has(c));
        const capCoverage = requiredCaps.length > 0
          ? Math.round(((requiredCaps.length - capGaps.length) / requiredCaps.length) * 100) / 100
          : 0;

        results.push({
          vertical: vert,
          journeyId: jId,
          journeyName: covJourney.journey || jId,
          contract: {
            exists: Boolean(contract),
            requiredCapabilities: requiredCaps,
            confidence: Number((confidence * 100).toFixed(0)) / 100,
          },
          coverage: {
            approvedScenarios: approvedCount,
            targetScenarios: totalTarget,
            coverage: totalTarget > 0 ? Math.round((approvedCount / totalTarget) * 100) / 100 : 0,
          },
          gaps: {
            capabilityGaps: capGaps,
            capabilityCoverage: capCoverage,
            missingCount: capGaps.length,
            hasGaps: capGaps.length > 0,
          },
        });
      }
    }
  }

  return {
    verticals: results,
    summary: {
      totalJourneys: results.length,
      journeysWithGaps: results.filter(r => r.gaps.hasGaps).length,
      journeysWithoutContract: results.filter(r => !r.contract.exists).length,
      averageConfidence: results.length > 0
        ? Math.round(results.reduce((s, r) => s + r.contract.confidence, 0) / results.length * 100) / 100
        : 0,
    },
    generatedAt: nowIso(),
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Coverage
  loadCoverageMap,
  saveCoverageMap,
  getCoverageMapForVertical,
  getCoverageSummary,
  validateCoverageAlignment,
  validateMeshMapping,

  // Gap Analysis
  analyzeCoverageGaps,
  buildReplayIndex,
  getBusinessGaps,

  // AI Generation (draft_ai status — requer aprovação manual)
  generateScenarioDraft,
  generateSeedsForScenario,

  // Draft Management
  listDrafts,
  approveDraft,
  rejectDraft,
  persistDraft,
  convertDraftToScenario,

  // Governance
  evaluateWaveGovernance,
  listGovernanceReports,

  // Mesh Integration
  suggestMeshLinks,
};
