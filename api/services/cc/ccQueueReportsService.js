'use strict';
/**
 * ccQueueReportsService
 * Relatórios de Contact Center baseados em CDR de filas do Asterisk.
 *
 * Os relatórios derivam do modelo PbxCdr. A associação de uma ligação a uma
 * fila é feita via campo `accountcode` (nome/id da fila) ou, quando disponível,
 * via `extra.queueName`. Agentes são identificados pelo campo `dst` (ramal que
 * atendeu) ou `extra.agentRef`.
 *
 * Relatórios implementados:
 *  - answered       : chamadas atendidas por fila com métricas de tempo
 *  - abandoned      : chamadas abandonadas por fila
 *  - agents         : performance por agente (atendidas, tempo médio, abandono)
 *  - hourly         : volume de chamadas por hora do dia
 *  - campaignSummary: totais agregados por campanha (accountcode)
 *  - survey         : registros de avaliação pós-atendimento (userfield JSON)
 */

const models = require('../../db/models');

function toDate(v) {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildDateWhere(Op, from, to) {
  if (!from && !to) return {};
  const cond = {};
  if (from) cond[Op.gte] = from;
  if (to) cond[Op.lte] = to;
  return { calldate: cond };
}

function defaultWindow(filters) {
  const to = toDate(filters.to) || new Date();
  const from = toDate(filters.from) || new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from, to };
}

function parseLimit(filters) {
  const n = Math.min(Math.max(Number(filters.limit) || 500, 1), 5000);
  return n;
}

function queueFilter(row, filters) {
  if (!filters.queueName) return true;
  const qn = String(filters.queueName).toLowerCase();
  const ac = String(row.accountcode || '').toLowerCase();
  const queueExtra = String((row.extra && row.extra.queueName) || '').toLowerCase();
  return ac === qn || queueExtra === qn;
}

function agentFromRow(row) {
  if (row.extra && row.extra.agentRef) return String(row.extra.agentRef);
  return String(row.dst || '');
}

function campaignFromRow(row) {
  if (row.extra && row.extra.campaignId) return String(row.extra.campaignId);
  return String(row.accountcode || '');
}

function isAnswered(row) {
  return String(row.disposition || '').toUpperCase() === 'ANSWERED';
}
function isAbandoned(row) {
  const d = String(row.disposition || '').toUpperCase();
  return d === 'NO ANSWER' || d === 'FAILED' || d === 'BUSY';
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Atendidas – chamadas atendidas por fila
// ─────────────────────────────────────────────────────────────────────────────
async function getAnsweredReport({ tenantKey, filters = {} }) {
  const Model = models.PbxCdr();
  const Op = Model.sequelize.constructor.Op;
  const { from, to } = defaultWindow(filters);
  const limit = parseLimit(filters);

  const rows = (await Model.findAll({
    where: {
      tenantKey,
      ...buildDateWhere(Op, from, to),
    },
    order: [['calldate', 'DESC']],
    limit,
  })).map((r) => r.toJSON());

  // Agregar por fila
  const byQueue = new Map();
  for (const row of rows) {
    if (!isAnswered(row)) continue;
    if (!queueFilter(row, filters)) continue;
    const queue = String(row.accountcode || '—');
    if (!byQueue.has(queue)) {
      byQueue.set(queue, { queue, count: 0, totalDuration: 0, totalBillsec: 0, minDuration: Infinity, maxDuration: 0 });
    }
    const s = byQueue.get(queue);
    s.count += 1;
    s.totalDuration += Number(row.duration) || 0;
    s.totalBillsec += Number(row.billsec) || 0;
    s.minDuration = Math.min(s.minDuration, Number(row.duration) || 0);
    s.maxDuration = Math.max(s.maxDuration, Number(row.duration) || 0);
  }

  const summary = [...byQueue.values()].map((s) => ({
    queue: s.queue,
    count: s.count,
    avgDuration: s.count ? Math.round(s.totalDuration / s.count) : 0,
    avgBillsec: s.count ? Math.round(s.totalBillsec / s.count) : 0,
    minDuration: s.count && s.minDuration !== Infinity ? s.minDuration : 0,
    maxDuration: s.maxDuration,
    totalDuration: s.totalDuration,
  })).sort((a, b) => b.count - a.count);

  return {
    report: 'answered',
    from: from.toISOString(),
    to: to.toISOString(),
    total: summary.reduce((acc, s) => acc + s.count, 0),
    queues: summary,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Abandonadas – chamadas não atendidas por fila
// ─────────────────────────────────────────────────────────────────────────────
async function getAbandonedReport({ tenantKey, filters = {} }) {
  const Model = models.PbxCdr();
  const Op = Model.sequelize.constructor.Op;
  const { from, to } = defaultWindow(filters);
  const limit = parseLimit(filters);

  const rows = (await Model.findAll({
    where: {
      tenantKey,
      ...buildDateWhere(Op, from, to),
    },
    order: [['calldate', 'DESC']],
    limit,
  })).map((r) => r.toJSON());

  const byQueue = new Map();
  for (const row of rows) {
    if (!queueFilter(row, filters)) continue;
    const queue = String(row.accountcode || '—');
    if (!byQueue.has(queue)) {
      byQueue.set(queue, { queue, answered: 0, abandoned: 0, total: 0 });
    }
    const s = byQueue.get(queue);
    s.total += 1;
    if (isAnswered(row)) s.answered += 1;
    else if (isAbandoned(row)) s.abandoned += 1;
  }

  const summary = [...byQueue.values()].map((s) => ({
    ...s,
    abandonRate: s.total ? Math.round((s.abandoned / s.total) * 1000) / 10 : 0,
  })).sort((a, b) => b.abandoned - a.abandoned);

  return {
    report: 'abandoned',
    from: from.toISOString(),
    to: to.toISOString(),
    total: summary.reduce((acc, s) => acc + s.abandoned, 0),
    queues: summary,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Agentes – performance por agente (ramal/dst)
// ─────────────────────────────────────────────────────────────────────────────
async function getAgentsReport({ tenantKey, filters = {} }) {
  const Model = models.PbxCdr();
  const Op = Model.sequelize.constructor.Op;
  const { from, to } = defaultWindow(filters);
  const limit = parseLimit(filters);

  const rows = (await Model.findAll({
    where: {
      tenantKey,
      ...buildDateWhere(Op, from, to),
    },
    order: [['calldate', 'DESC']],
    limit,
  })).map((r) => r.toJSON());

  const byAgent = new Map();
  for (const row of rows) {
    if (!queueFilter(row, filters)) continue;
    const agent = agentFromRow(row);
    if (!agent) continue;
    if (!byAgent.has(agent)) {
      byAgent.set(agent, { agent, answered: 0, missed: 0, totalBillsec: 0, maxBillsec: 0 });
    }
    const s = byAgent.get(agent);
    if (isAnswered(row)) {
      s.answered += 1;
      const bs = Number(row.billsec) || 0;
      s.totalBillsec += bs;
      s.maxBillsec = Math.max(s.maxBillsec, bs);
    } else {
      s.missed += 1;
    }
  }

  const summary = [...byAgent.values()].map((s) => ({
    ...s,
    avgBillsec: s.answered ? Math.round(s.totalBillsec / s.answered) : 0,
    total: s.answered + s.missed,
  })).sort((a, b) => b.answered - a.answered);

  return {
    report: 'agents',
    from: from.toISOString(),
    to: to.toISOString(),
    agents: summary,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Por Hora – volume de chamadas por hora do dia
// ─────────────────────────────────────────────────────────────────────────────
async function getHourlyReport({ tenantKey, filters = {} }) {
  const Model = models.PbxCdr();
  const Op = Model.sequelize.constructor.Op;
  const { from, to } = defaultWindow(filters);
  const limit = parseLimit(filters);

  const rows = (await Model.findAll({
    where: {
      tenantKey,
      ...buildDateWhere(Op, from, to),
    },
    order: [['calldate', 'DESC']],
    limit,
  })).map((r) => r.toJSON());

  // Agregar por hora (0-23)
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0, answered: 0, abandoned: 0 }));
  for (const row of rows) {
    if (!queueFilter(row, filters)) continue;
    const hour = new Date(row.calldate).getHours();
    byHour[hour].total += 1;
    if (isAnswered(row)) byHour[hour].answered += 1;
    else if (isAbandoned(row)) byHour[hour].abandoned += 1;
  }

  return {
    report: 'hourly',
    from: from.toISOString(),
    to: to.toISOString(),
    hours: byHour,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Resumo por Campanha
// ─────────────────────────────────────────────────────────────────────────────
async function getCampaignSummaryReport({ tenantKey, filters = {} }) {
  const Model = models.PbxCdr();
  const Op = Model.sequelize.constructor.Op;
  const { from, to } = defaultWindow(filters);
  const limit = parseLimit(filters);

  const rows = (await Model.findAll({
    where: {
      tenantKey,
      ...buildDateWhere(Op, from, to),
    },
    order: [['calldate', 'DESC']],
    limit,
  })).map((r) => r.toJSON());

  const byCampaign = new Map();
  for (const row of rows) {
    const campaign = campaignFromRow(row);
    if (!campaign) continue;
    if (!byCampaign.has(campaign)) {
      byCampaign.set(campaign, { campaign, total: 0, answered: 0, abandoned: 0, totalBillsec: 0 });
    }
    const s = byCampaign.get(campaign);
    s.total += 1;
    if (isAnswered(row)) {
      s.answered += 1;
      s.totalBillsec += Number(row.billsec) || 0;
    } else if (isAbandoned(row)) {
      s.abandoned += 1;
    }
  }

  const summary = [...byCampaign.values()].map((s) => ({
    ...s,
    avgBillsec: s.answered ? Math.round(s.totalBillsec / s.answered) : 0,
    abandonRate: s.total ? Math.round((s.abandoned / s.total) * 1000) / 10 : 0,
  })).sort((a, b) => b.total - a.total);

  return {
    report: 'campaignSummary',
    from: from.toISOString(),
    to: to.toISOString(),
    campaigns: summary,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Pesquisa – avaliações pós-atendimento (userfield JSON ou campo extra.survey)
// ─────────────────────────────────────────────────────────────────────────────
async function getSurveyReport({ tenantKey, filters = {} }) {
  const Model = models.PbxCdr();
  const Op = Model.sequelize.constructor.Op;
  const { from, to } = defaultWindow(filters);
  const limit = parseLimit(filters);

  const rows = (await Model.findAll({
    where: {
      tenantKey,
      ...buildDateWhere(Op, from, to),
    },
    order: [['calldate', 'DESC']],
    limit,
  })).map((r) => r.toJSON());

  const entries = [];
  for (const row of rows) {
    // Tenta parsear survey do extra ou userfield
    let survey = null;
    if (row.extra && row.extra.survey) {
      survey = row.extra.survey;
    } else if (row.userfield) {
      try {
        const parsed = JSON.parse(row.userfield);
        if (parsed && parsed.survey) survey = parsed.survey;
        else if (parsed && (parsed.rating !== undefined || parsed.score !== undefined)) survey = parsed;
      } catch (_) {
        // userfield não é JSON — ignora
      }
    }
    if (!survey) continue;
    if (!queueFilter(row, filters)) continue;

    entries.push({
      uniqueid: row.uniqueid,
      calldate: row.calldate,
      src: row.src,
      dst: row.dst,
      queue: String(row.accountcode || ''),
      agent: agentFromRow(row),
      rating: survey.rating !== undefined ? survey.rating : (survey.score !== undefined ? survey.score : null),
      comment: survey.comment || survey.observacao || null,
      raw: survey,
    });
  }

  // Estatísticas
  const ratings = entries.map((e) => e.rating).filter((r) => r !== null && !Number.isNaN(Number(r)));
  const avgRating = ratings.length ? Math.round((ratings.reduce((a, b) => a + Number(b), 0) / ratings.length) * 10) / 10 : null;

  return {
    report: 'survey',
    from: from.toISOString(),
    to: to.toISOString(),
    totalWithSurvey: entries.length,
    avgRating,
    entries,
  };
}

module.exports = {
  getAnsweredReport,
  getAbandonedReport,
  getAgentsReport,
  getHourlyReport,
  getCampaignSummaryReport,
  getSurveyReport,
};
