'use strict';

/**
 * Learning Core — Journey FAQ Service.
 *
 * Gera perguntas e respostas POR JORNADA de forma determinística, somente a
 * partir de fontes governadas (sem inferência livre de IA e sem fallback
 * heurístico):
 *
 * - config/journey-contracts.json     → capacidades exigidas/faltantes
 * - config/journey-preconditions.json → pré-condições required/optional/timeout
 * - config/journey-criticality.json   → criticidade/severidade (regra de negócio)
 * - config/learning/skill-graph.json  → telas (rotas) da jornada
 * - qa/qa-waves/scenario-store.json   → cenários aprovados (objetivo e passos)
 *
 * Cada item carrega `sources` com as fontes exatas de onde saiu — a resposta
 * é "validada pela jornada e regras de negócio" porque só existe se houver
 * fonte governada que a sustente.
 *
 * Curadoria: itens nascem `suggested`; o admin do tenant marca
 * `included`/`excluded` (regeneração preserva a curadoria por fingerprint).
 * O Tutor consome apenas itens `included` + `current` (fonte `curated_faq`).
 */

const crypto = require('crypto');

const getLearningJourneyFaqModel = require('../../db/models/LearningJourneyFaq');
const logger = require('../../utils/logger');

const JOURNEY_KEY_PATTERN = /^[\w.-]{1,120}$/;
const FAQ_STATUSES = Object.freeze(['suggested', 'included', 'excluded']);
const MATCH_THRESHOLD = 0.5;
const PRIMARY_JOURNEY_BONUS = 0.001;

const STOPWORDS = new Set([
  'a', 'o', 'e', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'um', 'uma', 'para', 'por', 'com', 'sem', 'que', 'qual', 'quais', 'como',
  'sao', 'eh', 'ser', 'se', 'os', 'as', 'ao', 'aos', 'eu', 'voce', 'me', 'seu',
  'sua', 'meu', 'minha', 'isso', 'isto', 'essa', 'esse', 'quando', 'onde',
]);

// ── Fontes governadas (carregadas sob demanda, com cache de módulo) ──────

let sourcesCache = null;

function loadGovernedSources() {
  if (sourcesCache) return sourcesCache;
  sourcesCache = {
    contracts: require('../../../config/journey-contracts.json'),
    preconditions: require('../../../config/journey-preconditions.json'),
    criticality: require('../../../config/journey-criticality.json'),
    skillGraph: require('../../../config/learning/skill-graph.json'),
    scenarioStore: require('../../../qa/qa-waves/scenario-store.json'),
  };
  return sourcesCache;
}

/** Apenas para testes: invalida o cache das fontes governadas. */
function resetGovernedSourcesCache() {
  sourcesCache = null;
}

function humanize(key) {
  return String(key || '').replace(/[._-]+/g, ' ').trim();
}

function fingerprint(journeyKey, question) {
  return crypto.createHash('sha1').update(`${journeyKey}|${question}`).digest('hex').slice(0, 16);
}

function latestApprovedScenario(scenarioStore, journeyKey) {
  const scenarios = Array.isArray(scenarioStore.scenarios) ? scenarioStore.scenarios : [];
  const candidates = scenarios.filter((s) => s && s.journey === journeyKey && s.status === 'approved');
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => String(b.version || '').localeCompare(String(a.version || '')))[0];
}

function resolveJourneyRoutes(skillGraph, requiredCapabilities) {
  const caps = new Set(requiredCapabilities || []);
  if (caps.size === 0) return [];
  const routes = new Set();
  for (const skill of skillGraph.skills || []) {
    const skillCaps = skill.capabilities || [];
    if (skillCaps.some((cap) => caps.has(cap))) {
      for (const route of skill.routes || []) routes.add(route);
    }
  }
  return Array.from(routes).sort();
}

/**
 * Monta os itens de FAQ de uma jornada a partir das fontes governadas.
 * Puro e determinístico: mesma entrada => mesma saída. Lança NOT_FOUND se a
 * jornada não existe nos contratos.
 */
function buildJourneyFaqItems(journeyKey) {
  const sources = loadGovernedSources();
  const entry = sources.contracts.journeys && sources.contracts.journeys[journeyKey];
  if (!entry) {
    const error = new Error('Jornada nao encontrada nos contratos');
    error.code = 'NOT_FOUND';
    throw error;
  }

  const label = humanize(journeyKey);
  const items = [];
  const push = (category, question, answer, itemSources) => {
    items.push({
      fingerprint: fingerprint(journeyKey, question),
      category,
      question,
      answer,
      sources: itemSources,
    });
  };

  const scenario = latestApprovedScenario(sources.scenarioStore, journeyKey);
  const pre = sources.preconditions[journeyKey] || null;
  const crit = (sources.criticality.journeys || sources.criticality)[journeyKey] || null;
  const routes = resolveJourneyRoutes(sources.skillGraph, entry.requiredCapabilities);

  if (scenario) {
    const channels = Array.isArray(scenario.channels) && scenario.channels.length > 0
      ? ` Canal(is) de operação: ${scenario.channels.join(', ')}.`
      : '';
    push(
      'visao_geral',
      `O que é a jornada "${label}" e qual o seu objetivo?`,
      `${scenario.name || label}: ${scenario.description || `jornada operacional ${journeyKey}`}.${channels}`
        + ` Risco: ${scenario.risk || 'não classificado'}; prioridade: ${scenario.priority || 'não classificada'}.`,
      ['qa/qa-waves/scenario-store.json'],
    );

    const steps = (Array.isArray(scenario.steps) ? scenario.steps : [])
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    if (steps.length > 0) {
      const stepLines = steps.map((step, index) => {
        const text = step.name || step.description || step.type || `passo ${index + 1}`;
        return `${index + 1}. ${String(text).slice(0, 180)}`;
      });
      push(
        'execucao',
        `Quais são os passos para executar a jornada "${label}"?`,
        `Passos do cenário aprovado "${scenario.name || journeyKey}":\n${stepLines.join('\n')}`,
        ['qa/qa-waves/scenario-store.json'],
      );
    }
  }

  if (pre) {
    const required = Array.isArray(pre.required) ? pre.required : [];
    const optional = Array.isArray(pre.optional) ? pre.optional : [];
    const parts = [];
    if (required.length > 0) parts.push(`Obrigatórias: ${required.join(', ')}.`);
    if (optional.length > 0) parts.push(`Opcionais: ${optional.join(', ')}.`);
    if (pre.timeout) parts.push(`Timeout da jornada: ${pre.timeout} ms.`);
    if (parts.length > 0) {
      push(
        'pre_condicoes',
        `Quais pré-condições são necessárias para executar a jornada "${label}"?`,
        parts.join(' '),
        ['config/journey-preconditions.json'],
      );
    }
  }

  const requiredCaps = Array.isArray(entry.requiredCapabilities) ? entry.requiredCapabilities : [];
  const missingCaps = Array.isArray(entry.missingCapabilities) ? entry.missingCapabilities : [];
  if (requiredCaps.length > 0) {
    const missingNote = missingCaps.length > 0
      ? ` Capacidades ainda não implementadas (gap conhecido): ${missingCaps.join(', ')}.`
      : '';
    push(
      'capacidades',
      `Quais capacidades da plataforma a jornada "${label}" exige?`,
      `Capacidades exigidas: ${requiredCaps.join(', ')}.${missingNote}`,
      ['config/journey-contracts.json'],
    );
  }

  if (crit && crit.criticality) {
    const blockingNote = crit.criticality === 'blocking'
      ? ' É uma jornada bloqueante: falhas nela impedem o release (regra de governança).'
      : ' Não é bloqueante para release.';
    push(
      'regra_negocio',
      `Qual a criticidade da jornada "${label}" para o negócio?`,
      `Criticidade: ${crit.criticality}; severidade: ${crit.severity || 'não classificada'}.${blockingNote}`,
      ['config/journey-criticality.json'],
    );
  }

  if (routes.length > 0) {
    push(
      'rotas',
      `Em quais telas da plataforma a jornada "${label}" acontece?`,
      `Telas envolvidas: ${routes.join(', ')}.`,
      ['config/learning/skill-graph.json'],
    );
  }

  return items;
}

// ── Geração persistida (admin) ────────────────────────────────────────────

/**
 * Gera/atualiza o FAQ de uma jornada para o tenant. Upsert por fingerprint:
 * itens já curados (included/excluded) preservam status e curadoria; itens
 * que deixaram de ser gerados são marcados current=false (nunca apagados).
 */
async function generateJourneyFaq({ tenantId, journeyKey, createdBy }) {
  if (!JOURNEY_KEY_PATTERN.test(String(journeyKey || ''))) {
    const error = new Error('journeyKey invalido');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  const items = buildJourneyFaqItems(journeyKey);
  if (items.length === 0) {
    const error = new Error('Jornada sem fontes governadas suficientes para gerar FAQ');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const Model = getLearningJourneyFaqModel();
  const scope = { tenant_id: String(tenantId), journeyKey };
  const existing = await Model.findAll({ where: scope });
  const byFingerprint = new Map(existing.map((row) => [row.fingerprint, row]));
  const seen = new Set();

  let created = 0;
  let updated = 0;
  let preserved = 0;

  for (const item of items) {
    seen.add(item.fingerprint);
    const row = byFingerprint.get(item.fingerprint);
    if (row) {
      await row.update({
        category: item.category,
        question: item.question,
        answer: item.answer,
        sources: item.sources,
        current: true,
      });
      if (row.status === 'suggested') updated += 1;
      else preserved += 1;
    } else {
      await Model.create({
        ...scope,
        ...item,
        status: 'suggested',
        current: true,
        curatedBy: createdBy || null,
      });
      created += 1;
    }
  }

  let stale = 0;
  for (const row of existing) {
    if (!seen.has(row.fingerprint) && row.current !== false) {
      await row.update({ current: false });
      stale += 1;
    }
  }

  logger.info('[learning-core] Journey FAQ gerado', {
    tenantId: String(tenantId),
    journeyKey,
    created,
    updated,
    preserved,
    stale,
  });

  const fresh = await Model.findAll({ where: scope, order: [['created_at', 'ASC']] });
  return {
    journeyKey,
    generated: items.length,
    created,
    updated,
    preserved,
    stale,
    items: fresh.map(serializeFaqItem),
  };
}

function serializeFaqItem(row) {
  return {
    id: row.id,
    journeyKey: row.journeyKey,
    category: row.category,
    question: row.question,
    answer: row.answer,
    sources: row.sources || [],
    status: row.status,
    current: row.current !== false,
    curatedBy: row.curatedBy || null,
    curatedAt: row.curatedAt || null,
    createdAt: row.createdAt,
  };
}

// ── Consultas ─────────────────────────────────────────────────────────────

async function listJourneyFaq({ tenantId, journeyKey, statuses }) {
  if (!JOURNEY_KEY_PATTERN.test(String(journeyKey || ''))) {
    const error = new Error('journeyKey invalido');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  const Model = getLearningJourneyFaqModel();
  const where = { tenant_id: String(tenantId), journeyKey };
  const rows = await Model.findAll({ where, order: [['created_at', 'ASC']] });
  const allowed = Array.isArray(statuses) && statuses.length > 0 ? new Set(statuses) : null;
  return rows
    .map(serializeFaqItem)
    .filter((item) => (!allowed || allowed.has(item.status)));
}

async function listJourneyFaqSummary({ tenantId }) {
  const sources = loadGovernedSources();
  const Model = getLearningJourneyFaqModel();
  const rows = await Model.findAll({ where: { tenant_id: String(tenantId) } });

  const byJourney = new Map();
  for (const key of Object.keys(sources.contracts.journeys || {})) {
    byJourney.set(key, { journeyKey: key, total: 0, suggested: 0, included: 0, excluded: 0 });
  }
  for (const row of rows) {
    if (!byJourney.has(row.journeyKey)) {
      byJourney.set(row.journeyKey, { journeyKey: row.journeyKey, total: 0, suggested: 0, included: 0, excluded: 0 });
    }
    const bucket = byJourney.get(row.journeyKey);
    bucket.total += 1;
    if (bucket[row.status] !== undefined) bucket[row.status] += 1;
  }

  return Array.from(byJourney.values())
    .sort((a, b) => (b.total - a.total) || a.journeyKey.localeCompare(b.journeyKey));
}

async function setJourneyFaqStatus({ tenantId, id, status, curatedBy }) {
  if (!FAQ_STATUSES.includes(status)) {
    const error = new Error(`status invalido: use ${FAQ_STATUSES.join(', ')}`);
    error.code = 'BAD_REQUEST';
    throw error;
  }
  const Model = getLearningJourneyFaqModel();
  const row = await Model.findOne({ where: { id: String(id || ''), tenant_id: String(tenantId) } });
  if (!row) {
    const error = new Error('Item de FAQ nao encontrado');
    error.code = 'NOT_FOUND';
    throw error;
  }
  await row.update({
    status,
    curatedBy: curatedBy || null,
    curatedAt: new Date(),
  });
  logger.info('[learning-core] Journey FAQ curado', {
    tenantId: String(tenantId),
    id: row.id,
    journeyKey: row.journeyKey,
    status,
    curatedBy,
  });
  return serializeFaqItem(row);
}

// ── Consumo pelo Tutor (somente FAQ curado: included + current) ──────────

/**
 * Capabilities associadas a uma rota de UI, via skill graph (skill contém a
 * rota → capabilities da skill).
 */
function resolveRouteCapabilities(route) {
  const sources = loadGovernedSources();
  const normalized = String(route || '').split('?')[0];
  const capabilities = new Set();
  if (!normalized) return capabilities;
  for (const skill of sources.skillGraph.skills || []) {
    if ((skill.routes || []).includes(normalized)) {
      for (const cap of skill.capabilities || []) capabilities.add(cap);
    }
  }
  return capabilities;
}

/**
 * Mapeia uma rota de UI para as jornadas que a utilizam, via skill graph
 * (skill contém a rota → capabilities da skill → jornadas que as exigem).
 */
function resolveJourneysForRoute(route) {
  const capabilities = resolveRouteCapabilities(route);
  if (capabilities.size === 0) return [];

  const sources = loadGovernedSources();
  const journeys = [];
  for (const [key, entry] of Object.entries(sources.contracts.journeys || {})) {
    if ((entry.requiredCapabilities || []).some((cap) => capabilities.has(cap))) {
      journeys.push(key);
    }
  }
  return journeys;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function scoreMatch(questionTokens, item) {
  const itemTokens = new Set([...tokenize(item.question), ...tokenize(item.answer)]);
  if (questionTokens.length === 0) return 0;
  const hits = questionTokens.filter((token) => itemTokens.has(token)).length;
  return hits / questionTokens.length;
}

/**
 * Busca o melhor item de FAQ curado para (rota, pergunta). Retorna null se
 * não houver match acima do limiar — o chamador segue o fluxo normal (RAG).
 *
 * Desempate determinístico: a jornada "dona" da rota (cujo próprio nome é
 * uma das capabilities da skill da rota — ex.: support_ticket_flow em
 * /support) recebe um bônus mínimo. Jornadas associadas indiretamente
 * (ex.: booking_flow, que apenas exige a capability support_ticket_flow)
 * perdem o empate para a dona.
 */
async function findCuratedFaqForRoute({ tenantId, route, question }) {
  const journeyKeys = resolveJourneysForRoute(route);
  if (journeyKeys.length === 0) return null;

  const routeCapabilities = resolveRouteCapabilities(route);
  const primaryJourneys = new Set(journeyKeys.filter((key) => routeCapabilities.has(key)));

  const Model = getLearningJourneyFaqModel();
  const rows = await Model.findAll({
    where: { tenant_id: String(tenantId), status: 'included', current: true },
  });
  const candidates = rows
    .map(serializeFaqItem)
    .filter((item) => journeyKeys.includes(item.journeyKey));
  if (candidates.length === 0) return null;

  if (!question) {
    return { journeyKeys, items: candidates, match: null };
  }

  const questionTokens = tokenize(question);
  let best = null;
  for (const item of candidates) {
    const score = scoreMatch(questionTokens, item);
    const effective = score + (primaryJourneys.has(item.journeyKey) ? PRIMARY_JOURNEY_BONUS : 0);
    if (score >= MATCH_THRESHOLD && (!best || effective > best.effective)) {
      best = { item, score, effective };
    }
  }
  if (!best) return null;
  return { journeyKeys, match: best.item, score: best.score };
}

module.exports = {
  generateJourneyFaq,
  listJourneyFaq,
  listJourneyFaqSummary,
  setJourneyFaqStatus,
  findCuratedFaqForRoute,
  buildJourneyFaqItems,
  resolveJourneysForRoute,
  resolveRouteCapabilities,
  resetGovernedSourcesCache,
  FAQ_STATUSES,
};
