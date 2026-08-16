'use strict';

/**
 * Learning Core — Tutor Service (níveis 0 e 1).
 *
 * Nível 0 (observar): a cada lote ingerido, avalia deterministicamente se a
 * sessão mostra dificuldade — >= MIN_ERROR_EVENTS eventos de erro na mesma
 * rota dentro do lote recente (erro = type `error`/`flow_abandoned` ou
 * `api_call` com status >= 400 / errorCode).
 *
 * Nível 1 (dica): com dificuldade detectada, busca UMA dica contextual —
 * primeiro no FAQ curado da jornada (perguntas incluídas pelo admin, casadas
 * com os códigos de erro observados; fonte `curated_faq`), depois via RAG
 * (`queryRag`) — e emite `tutor.hint` por WebSocket somente para o agente
 * afetado. Sem fallback heurístico: FAQ sem match e RAG indisponível/sem
 * resposta => nenhum hint é emitido e o motivo fica explícito no log
 * (`ai_unavailable`).
 *
 * Governança:
 * - Todo hint emitido é persistido em `learning_tutor_hints` (auditoria).
 * - Cooldown de COOLDOWN_MINUTES por (tenant, agente, rota) — consultado na
 *   tabela, nunca em memória.
 * - Reuso de dica: se já existe hint para (tenant, rota) com menos de
 *   RAG_CACHE_HOURS, o texto é reutilizado (evita chamada RAG repetida).
 */

const { Op } = require('sequelize');

const getLearningTutorHintModel = require('../../db/models/LearningTutorHint');
const getLearningSimulationModel = require('../../db/models/LearningSimulation');
const { queryRag } = require('../../services/ragService');
const { emitEvent } = require('../../services/websocketService');
const journeyFaqService = require('./journeyFaqService');
const logger = require('../../utils/logger');

const MIN_ERROR_EVENTS = 2;
const COOLDOWN_MINUTES = 15;
const RAG_CACHE_HOURS = 24;
const MAX_HINT_CHARS = 600;
const MAX_EXPLAIN_CHARS = 1500;
const MAX_GUIDE_CHARS = 2000;
const TUTOR_LEVELS = Object.freeze([0, 1, 2, 3, 4]);

function isErrorEvent(event) {
  const type = String(event && event.type || '');
  if (type === 'learning.interaction.error' || type === 'learning.interaction.flow_abandoned') return true;
  if (type === 'learning.interaction.api_call') {
    const status = Number(event && event.status);
    return (Number.isFinite(status) && status >= 400) || Boolean(event && event.errorCode);
  }
  return false;
}

/**
 * Detector determinístico de dificuldade (nível 0).
 * Recebe os eventos sanitizados do lote (forma interna do service de ingest:
 * { type, payload: { route, status, errorCode } }) e retorna
 * { route, errorEvents } da primeira rota com >= MIN_ERROR_EVENTS erros,
 * ou null.
 */
function detectDifficulty(sanitizedEvents) {
  const errorsByRoute = new Map();
  for (const event of sanitizedEvents || []) {
    const payload = (event && event.payload) || {};
    const candidate = {
      type: event && event.type,
      status: payload.status,
      errorCode: payload.errorCode,
      id: null,
    };
    if (!isErrorEvent(candidate)) continue;
    const route = payload.route;
    if (!route) continue;
    if (!errorsByRoute.has(route)) errorsByRoute.set(route, []);
    errorsByRoute.get(route).push(event);
  }

  let best = null;
  for (const [route, events] of errorsByRoute.entries()) {
    if (events.length >= MIN_ERROR_EVENTS && (!best || events.length > best.errorEvents.length)) {
      best = { route, errorEvents: events };
    }
  }
  return best;
}

async function findRecentHintForAgent({ tenantId, agentId, route }) {
  const Model = getLearningTutorHintModel();
  const since = new Date(Date.now() - COOLDOWN_MINUTES * 60000);
  return Model.findOne({
    where: {
      tenant_id: String(tenantId),
      agentId: String(agentId),
      route,
      created_at: { [Op.gte]: since },
    },
    order: [['created_at', 'DESC']],
  });
}

async function findReusableHintForRoute({ tenantId, route }) {
  const Model = getLearningTutorHintModel();
  const since = new Date(Date.now() - RAG_CACHE_HOURS * 3600000);
  return Model.findOne({
    where: {
      tenant_id: String(tenantId),
      route,
      source: 'rag',
      created_at: { [Op.gte]: since },
    },
    order: [['created_at', 'DESC']],
  });
}

/**
 * Gera a dica via RAG (nível 1). Sem heurística: qualquer indisponibilidade
 * retorna null com motivo explícito no log.
 */
async function buildHintText({ tenantId, route, errorEvents }) {
  const reusable = await findReusableHintForRoute({ tenantId, route });
  if (reusable && reusable.hintText) {
    return { hintText: reusable.hintText, source: 'rag_cache' };
  }

  const errorCodes = Array.from(new Set(
    errorEvents.map((e) => e && e.payload && (e.payload.errorCode || e.payload.status)).filter(Boolean),
  )).slice(0, 5);

  // FAQ curado da jornada (incluído pelo admin) tem prioridade sobre o RAG:
  // casa os códigos de erro observados com as perguntas incluídas da rota.
  try {
    const curated = await journeyFaqService.findCuratedFaqForRoute({
      tenantId,
      route,
      question: errorCodes.join(' '),
    });
    if (curated && curated.match) {
      return {
        hintText: `${curated.match.question} ${curated.match.answer}`.slice(0, MAX_HINT_CHARS),
        source: 'curated_faq',
      };
    }
  } catch (error) {
    logger.warn('[learning-core] Tutor: FAQ curado indisponivel na dica, seguindo para RAG', {
      tenantId,
      route,
      error: error.message,
    });
  }

  const query = [
    `Explique de forma breve e pratica como usar corretamente a tela "${route}" da plataforma,`,
    'com foco em evitar os erros que o usuario esta cometendo',
    errorCodes.length > 0 ? ` (codigos observados: ${errorCodes.join(', ')})` : '',
    '. Responda em portugues, em no maximo 3 frases, sem introducao.',
  ].join('');

  try {
    const result = await queryRag(query, tenantId, { source: 'learning-core-tutor' });
    const text = result && result.success && typeof result.response === 'string'
      ? result.response.trim().slice(0, MAX_HINT_CHARS)
      : null;
    if (!text) {
      logger.warn('[learning-core] Tutor: RAG sem resposta utilizavel (ai_unavailable)', {
        tenantId,
        route,
        error: result && result.error,
      });
      return null;
    }
    return { hintText: text, source: 'rag' };
  } catch (error) {
    logger.warn('[learning-core] Tutor: RAG indisponivel ao gerar dica (ai_unavailable)', {
      tenantId,
      route,
      error: error.message,
    });
    return null;
  }
}

/**
 * Avalia o lote ingerido e, se houver dificuldade, emite um hint contextual
 * para o agente via WebSocket. Best-effort controlado pelo chamador (ingest):
 * falhas aqui nunca derrubam a ingestão, mas são sempre logadas.
 *
 * @returns {Promise<{hintEmitted: boolean, reason?: string}>}
 */
async function evaluateAndMaybeHint({ tenantId, agentId, sessionId, events }) {
  const difficulty = detectDifficulty(events);
  if (!difficulty) return { hintEmitted: false, reason: 'no_difficulty' };

  const { route, errorEvents } = difficulty;

  const recent = await findRecentHintForAgent({ tenantId, agentId, route });
  if (recent) return { hintEmitted: false, reason: 'cooldown' };

  const hint = await buildHintText({ tenantId, route, errorEvents });
  if (!hint) return { hintEmitted: false, reason: 'ai_unavailable' };

  const Model = getLearningTutorHintModel();
  const evidenceRefs = errorEvents
    .map((e) => e && e.clientEventId)
    .filter(Boolean)
    .slice(0, 10);

  const record = await Model.create({
    tenant_id: String(tenantId),
    agentId: String(agentId),
    sessionId: sessionId || null,
    route,
    level: 1,
    trigger: {
      errorCount: errorEvents.length,
      errorCodes: Array.from(new Set(
        errorEvents.map((e) => e && e.payload && (e.payload.errorCode || e.payload.status)).filter(Boolean),
      )).slice(0, 5),
    },
    hintText: hint.hintText,
    source: hint.source,
    evidenceRefs,
  });

  emitEvent('tutor.hint', {
    id: record.id,
    route,
    level: 1,
    hint: hint.hintText,
    errorCount: errorEvents.length,
    source: hint.source,
    createdAt: record.createdAt,
  }, { agentId });

  logger.info('[learning-core] Tutor nivel 1: hint emitido', {
    tenantId,
    agentId: String(agentId),
    route,
    errorCount: errorEvents.length,
    source: hint.source,
  });

  return { hintEmitted: true };
}

// ── Níveis 2-4: ajuda explícita solicitada pelo usuário ──────────────────

async function persistHelpRecord({ tenantId, agentId, route, level, content, source, extraTrigger }) {
  const Model = getLearningTutorHintModel();
  return Model.create({
    tenant_id: String(tenantId),
    agentId: String(agentId),
    route,
    level,
    trigger: { explicit: true, requestedLevel: level, ...(extraTrigger || {}) },
    hintText: typeof content === 'string' ? content : JSON.stringify(content),
    source,
    evidenceRefs: [],
  });
}

async function findAgentRecentErrors({ tenantId, agentId, route }) {
  const Model = getLearningTutorHintModel();
  const rows = await Model.findAll({
    where: { tenant_id: String(tenantId), agentId: String(agentId), route },
    order: [['created_at', 'DESC']],
    limit: 5,
  });
  return rows.map((row) => row.trigger || {});
}

/**
 * Nível 2 (explica): explicação detalhada da tela/processo. Prioriza o FAQ
 * curado da jornada (perguntas incluídas pelo admin — fonte `curated_faq`);
 * sem match curado, cai no RAG contextualizado com os erros recorrentes do
 * próprio usuário na rota.
 */
async function buildExplanation({ tenantId, agentId, route, question }) {
  try {
    const curated = await journeyFaqService.findCuratedFaqForRoute({ tenantId, route, question });
    if (curated && curated.match) {
      const text = `${curated.match.question}\n\n${curated.match.answer}`.slice(0, MAX_EXPLAIN_CHARS);
      return { text, source: 'curated_faq' };
    }
  } catch (error) {
    logger.warn('[learning-core] Tutor: FAQ curado indisponivel, seguindo para RAG', {
      tenantId,
      route,
      error: error.message,
    });
  }

  const recentTriggers = await findAgentRecentErrors({ tenantId, agentId, route });
  const errorCodes = Array.from(new Set(
    recentTriggers.flatMap((t) => (Array.isArray(t.errorCodes) ? t.errorCodes : [])),
  )).slice(0, 5);

  const query = [
    `Explique em detalhes a tela "${route}" da plataforma: o que ela faz,`,
    'quando usar, os campos/acoes principais e os erros mais comuns',
    errorCodes.length > 0 ? ` (o usuario ja encontrou: ${errorCodes.join(', ')})` : '',
    '. Responda em portugues, de forma pratica, sem introducao.',
  ].join('');

  const result = await queryRag(query, tenantId, { source: 'learning-core-tutor-l2' });
  const text = result && result.success && typeof result.response === 'string'
    ? result.response.trim().slice(0, MAX_EXPLAIN_CHARS)
    : null;
  return text ? { text } : null;
}

/**
 * Nível 3 (guia passo a passo): usa o material de treinamento gerado pelo
 * Journey Trainer (documentos RAG `training:*`, derivados de replays reais
 * anonimizados) para orientar o preenchimento da tela passo a passo.
 */
async function buildStepGuide({ tenantId, route }) {
  const query = [
    'Com base no material de treinamento da plataforma (roteiros gerados de',
    `replays operacionais), descreva o passo a passo para usar a tela "${route}":`,
    'cada etapa em ordem, o que preencher em cada campo e o que esperar como',
    'resultado. Responda em portugues, em lista numerada, sem introducao.',
  ].join('');

  const result = await queryRag(query, tenantId, { source: 'learning-core-tutor-l3' });
  const text = result && result.success && typeof result.response === 'string'
    ? result.response.trim().slice(0, MAX_GUIDE_CHARS)
    : null;
  return text ? { text } : null;
}

/**
 * Nível 4 (demonstração): cenários sintéticos disponíveis (Simulation
 * Engine) — determinístico, sem IA e nunca com dados reais.
 */
async function buildDemonstration({ tenantId }) {
  const Model = getLearningSimulationModel();
  const rows = await Model.findAll({
    where: { tenant_id: String(tenantId) },
    order: [['created_at', 'DESC']],
    limit: 5,
  });
  if (rows.length === 0) return null;
  return {
    demonstrations: rows.map((row) => ({
      id: row.id,
      journeyKey: row.journeyKey,
      seedType: row.seedType,
      personaKey: row.personaKey,
      scenario: row.scenario || {},
      createdAt: row.createdAt,
    })),
  };
}

/**
 * Ajuda explícita nos níveis 2-4 (o usuário pede; não é proativo como o
 * nível 1). Persiste o registro para auditoria e retorna o conteúdo por HTTP.
 *
 * @returns {Promise<{level, route, available, content?, source?, reason?}>}
 */
async function requestTutorHelp({ tenantId, agentId, route, level, question }) {
  const numericLevel = Number(level);
  if (!route || typeof route !== 'string') {
    const error = new Error('route obrigatorio');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  if (![2, 3, 4].includes(numericLevel)) {
    const error = new Error('level invalido: use 2 (explicar), 3 (guia passo a passo) ou 4 (demonstracao)');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  if (numericLevel === 4) {
    const demonstration = await buildDemonstration({ tenantId });
    if (!demonstration) {
      return { level: 4, route, available: false, reason: 'no_simulations' };
    }
    await persistHelpRecord({
      tenantId,
      agentId,
      route,
      level: 4,
      content: demonstration,
      source: 'simulation_engine',
    });
    return { level: 4, route, available: true, content: demonstration, source: 'simulation_engine' };
  }

  let built = null;
  try {
    built = numericLevel === 2
      ? await buildExplanation({ tenantId, agentId, route, question })
      : await buildStepGuide({ tenantId, route });
  } catch (error) {
    logger.warn('[learning-core] Tutor: RAG indisponivel na ajuda explicita (ai_unavailable)', {
      tenantId,
      route,
      level: numericLevel,
      error: error.message,
    });
    built = null;
  }

  if (!built) {
    return { level: numericLevel, route, available: false, reason: 'ai_unavailable' };
  }

  const source = built.source || (numericLevel === 2 ? 'rag_explain' : 'rag_guide');
  await persistHelpRecord({
    tenantId,
    agentId,
    route,
    level: numericLevel,
    content: built.text,
    source,
  });

  logger.info('[learning-core] Tutor: ajuda explicita emitida', {
    tenantId,
    agentId: String(agentId),
    route,
    level: numericLevel,
  });

  return { level: numericLevel, route, available: true, content: { text: built.text }, source };
}

module.exports = {
  detectDifficulty,
  evaluateAndMaybeHint,
  requestTutorHelp,
  MIN_ERROR_EVENTS,
  COOLDOWN_MINUTES,
  RAG_CACHE_HOURS,
  TUTOR_LEVELS,
};
