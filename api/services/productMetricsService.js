'use strict';

/**
 * Product Metrics Service — métricas de produto do cliente (P4.13).
 *
 * Computa, por tenant e janela de tempo, as métricas que respondem se o
 * produto está entregando valor operacional — todas derivadas de dados
 * reais já persistidos (nenhuma métrica técnica de QA/engenharia):
 *
 *   TTFR  timeToFirstResponse — 1ª mensagem inbound → 1ª resposta outbound
 *         por conversa (ChannelMessage), média/mediana.
 *   TTFV  timeToFirstValue — início do onboarding → primeira resposta real
 *         enviada a um cliente (primeira mensagem outbound do tenant).
 *   Cliques por tarefa — agregado das sessões de interação
 *         (UserInteractionSession.summary.clicksByRoute / taskCompletionClicks,
 *         alimentado pelo Learning Core interaction tracker): cliques médios
 *         por sessão nas superfícies centrais e cliques médios por tarefa
 *         concluída (alvos de conclusão: enviar/salvar/confirmar/agendar).
 *   Profundidade de navegação — rotas distintas por sessão e eventos por
 *         sessão (UserInteractionSession.routesVisited / eventCount).
 *
 * Classificação: PRODUCTION-safe — somente tempos e contagens de negócio.
 */

const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { ChannelMessage } = require('../db/models');
const getUserInteractionSessionModel = require('../db/models/UserInteractionSession');

const MAX_MESSAGES_SCAN = 20000;
const MAX_SESSIONS_SCAN = 5000;

/** Superfícies centrais do produto (prefixo de rota normalizada). */
const CORE_SURFACES = [
  { key: 'inbox', prefix: '/inbox', label: 'Inbox' },
  { key: 'workspace', prefix: '/workspace', label: 'Workspace' },
  { key: 'agenda', prefix: '/agenda', label: 'Agenda' },
  { key: 'crm', prefix: '/crm', label: 'CRM' },
];

function dbAvailable() {
  return !!getSequelize();
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/**
 * TTFR: para cada conversa com ao menos uma mensagem inbound seguida de uma
 * outbound, o delta entre a primeira inbound e a primeira outbound posterior.
 */
async function computeTimeToFirstResponse({ tenantId, since }) {
  const rows = await ChannelMessage().findAll({
    where: {
      tenant_key: String(tenantId),
      createdAt: { [Op.gte]: since },
    },
    attributes: ['conversation_id', 'direction', 'createdAt'],
    order: [['createdAt', 'ASC']],
    limit: MAX_MESSAGES_SCAN,
    raw: true,
  });

  const firstInboundByConversation = new Map();
  const deltas = [];
  for (const row of rows || []) {
    const convId = row.conversation_id;
    if (!convId) continue;
    if (row.direction === 'in') {
      if (!firstInboundByConversation.has(convId)) {
        firstInboundByConversation.set(convId, new Date(row.createdAt || row.created_at).getTime());
      }
    } else if (row.direction === 'out' && firstInboundByConversation.has(convId)) {
      const inboundAt = firstInboundByConversation.get(convId);
      const outboundAt = new Date(row.createdAt || row.created_at).getTime();
      if (outboundAt >= inboundAt) {
        deltas.push(Math.round((outboundAt - inboundAt) / 1000));
      }
      firstInboundByConversation.delete(convId);
    }
  }

  deltas.sort((a, b) => a - b);
  const total = deltas.reduce((acc, v) => acc + v, 0);
  return {
    avgSeconds: deltas.length ? Math.round(total / deltas.length) : null,
    medianSeconds: percentile(deltas, 50),
    p90Seconds: percentile(deltas, 90),
    conversations: deltas.length,
  };
}

/**
 * TTFV: início do onboarding → primeira mensagem outbound (primeira resposta
 * real a um cliente). Quando o tenant nunca respondeu, available=false.
 */
async function computeTimeToFirstValue({ tenantId }) {
  const { getOnboardingStatus } = require('./onboardingService');
  const status = await getOnboardingStatus(tenantId).catch(() => null);
  const startedAt = status?.startedAt ? new Date(status.startedAt) : null;
  const completedAt = status?.completedAt ? new Date(status.completedAt) : null;

  const firstOutbound = await ChannelMessage().findOne({
    where: { tenant_key: String(tenantId), direction: 'out' },
    attributes: ['createdAt'],
    order: [['createdAt', 'ASC']],
    raw: true,
  });

  const firstOutboundAt = firstOutbound?.createdAt || firstOutbound?.created_at ? new Date(firstOutbound.createdAt || firstOutbound.created_at) : null;
  const anchor = startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt : null;

  return {
    available: !!(anchor && firstOutboundAt && firstOutboundAt >= anchor),
    seconds: anchor && firstOutboundAt && firstOutboundAt >= anchor
      ? Math.round((firstOutboundAt.getTime() - anchor.getTime()) / 1000)
      : null,
    basis: 'onboarding_start_to_first_outbound_message',
    onboarding: {
      startedAt: anchor ? anchor.toISOString() : null,
      completedAt: completedAt && !Number.isNaN(completedAt.getTime()) ? completedAt.toISOString() : null,
      timeToCompleteSeconds: anchor && completedAt && completedAt >= anchor
        ? Math.round((completedAt.getTime() - anchor.getTime()) / 1000)
        : null,
    },
  };
}

function matchCoreSurface(route) {
  const path = String(route || '');
  return CORE_SURFACES.find((s) => path === s.prefix || path.startsWith(`${s.prefix}/`)) || null;
}

/**
 * Cliques por superfície central e cliques por tarefa concluída, a partir do
 * agregado de sessões do interaction tracker (privacy-by-design: só conta
 * cliques estruturais, nunca conteúdo).
 */
async function computeInteractionMetrics({ tenantId, since }) {
  const sessions = await getUserInteractionSessionModel().findAll({
    where: {
      tenant_id: String(tenantId),
      lastSeenAt: { [Op.gte]: since },
    },
    attributes: ['routesVisited', 'eventCount', 'summary'],
    order: [['lastSeenAt', 'DESC']],
    limit: MAX_SESSIONS_SCAN,
    raw: true,
  });

  const surfaceStats = new Map();
  const routeSessionCount = new Map();
  let totalRoutes = 0;
  let totalEvents = 0;

  for (const session of sessions || []) {
    const routes = Array.isArray(session.routesVisited) ? session.routesVisited : [];
    totalRoutes += routes.length;
    totalEvents += Number(session.eventCount) || 0;

    for (const route of routes) {
      routeSessionCount.set(route, (routeSessionCount.get(route) || 0) + 1);
    }

    const clicksByRoute = session.summary?.clicksByRoute || {};
    const completionByRoute = session.summary?.taskCompletionClicksByRoute || {};
    for (const [route, clicks] of Object.entries(clicksByRoute)) {
      const surface = matchCoreSurface(route);
      if (!surface) continue;
      const stat = surfaceStats.get(surface.key) || {
        surface: surface.label,
        sessions: 0,
        clicks: 0,
        taskCompletions: 0,
      };
      stat.clicks += Number(clicks) || 0;
      stat.taskCompletions += Number(completionByRoute[route]) || 0;
      stat.sessions += 1;
      surfaceStats.set(surface.key, stat);
    }
  }

  const clicksPerCoreSurface = Array.from(surfaceStats.values()).map((stat) => ({
    surface: stat.surface,
    sessions: stat.sessions,
    clicks: stat.clicks,
    avgClicksPerSession: stat.sessions ? Math.round((stat.clicks / stat.sessions) * 10) / 10 : null,
    taskCompletions: stat.taskCompletions,
    avgClicksPerCompletedTask: stat.taskCompletions
      ? Math.round((stat.clicks / stat.taskCompletions) * 10) / 10
      : null,
  }));

  const topRoutes = Array.from(routeSessionCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([route, count]) => ({ route, sessions: count }));

  const sessionCount = (sessions || []).length;
  return {
    sessions: sessionCount,
    avgRoutesPerSession: sessionCount ? Math.round((totalRoutes / sessionCount) * 10) / 10 : null,
    avgEventsPerSession: sessionCount ? Math.round((totalEvents / sessionCount) * 10) / 10 : null,
    topRoutes,
    clicksPerCoreSurface,
  };
}

/**
 * Sumário consolidado das métricas de produto do tenant.
 */
async function getProductMetricsSummary({ tenantId, windowDays = 30 } = {}) {
  if (!dbAvailable()) throw new Error('persistence_required: banco indisponível para métricas de produto');
  if (!tenantId) throw new Error('tenantId é obrigatório');
  const days = Math.min(365, Math.max(1, Number(windowDays) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [timeToFirstResponse, timeToFirstValue, interaction] = await Promise.all([
    computeTimeToFirstResponse({ tenantId, since }).catch((err) => {
      logger.warn('[ProductMetrics] TTFR indisponível', { tenantId, error: err?.message });
      return { avgSeconds: null, medianSeconds: null, p90Seconds: null, conversations: 0 };
    }),
    computeTimeToFirstValue({ tenantId }).catch((err) => {
      logger.warn('[ProductMetrics] TTFV indisponível', { tenantId, error: err?.message });
      return { available: false, seconds: null, basis: 'onboarding_start_to_first_outbound_message', onboarding: null };
    }),
    computeInteractionMetrics({ tenantId, since }).catch((err) => {
      logger.warn('[ProductMetrics] métricas de interação indisponíveis', { tenantId, error: err?.message });
      return { sessions: 0, avgRoutesPerSession: null, avgEventsPerSession: null, topRoutes: [], clicksPerCoreSurface: [] };
    }),
  ]);

  return {
    ok: true,
    tenantId: String(tenantId),
    windowDays: days,
    generatedAt: new Date().toISOString(),
    timeToFirstResponse,
    timeToFirstValue,
    navigation: {
      sessions: interaction.sessions,
      avgRoutesPerSession: interaction.avgRoutesPerSession,
      avgEventsPerSession: interaction.avgEventsPerSession,
      topRoutes: interaction.topRoutes,
    },
    clicksPerCoreSurface: interaction.clicksPerCoreSurface,
  };
}

module.exports = {
  getProductMetricsSummary,
  CORE_SURFACES,
};
