'use strict';

const { CRMEventService } = require('../crm');
const revenueEngine = require('../revenue/RevenueEngine');
const schedulingService = require('../../services/schedulingService');
const queueService = require('../../services/queueService');
const ccCampaignsService = require('../../services/cc/ccCampaignsService');
const ccScheduledCallbacksService = require('../../services/cc/ccScheduledCallbacksService');
const tasksService = require('../../services/tasksService');
const schedulingHealthService = require('../../services/schedulingHealthService');
const ragService = require('../../services/ragService');
const ragDocumentsService = require('../../services/ragDocumentsService');

function safeStr(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePhoneDigits(raw) {
  return String(raw || '').replace(/\D/g, '');
}

async function safeCall(fn, fallback) {
  try {
    return await fn();
  } catch (_) {
    return fallback;
  }
}

function summarizeSchedules(items = []) {
  const base = {
    total: 0,
    scheduled: 0,
    canceled: 0,
    noShow: 0,
    done: 0,
    upcoming: 0,
    cancelRate: 0,
  };

  const now = Date.now();
  for (const item of safeArray(items)) {
    base.total += 1;
    const status = String(item?.status || '').toLowerCase();
    if (status === 'scheduled') base.scheduled += 1;
    if (status === 'canceled') base.canceled += 1;
    if (status === 'no_show') base.noShow += 1;
    if (status === 'done') base.done += 1;
    const startAtTs = Date.parse(item?.startAt || item?.start_at || 0);
    if (Number.isFinite(startAtTs) && startAtTs >= now) base.upcoming += 1;
  }

  if (base.total > 0) {
    base.cancelRate = Number(((base.canceled + base.noShow) / base.total).toFixed(3));
  }

  return base;
}

function countScheduleConflicts(items = []) {
  const candidates = safeArray(items)
    .filter((item) => {
      const status = String(item?.status || '').toLowerCase();
      return status === 'scheduled' || status === 'in_progress';
    })
    .map((item) => ({
      id: item?.id || null,
      startAtTs: Date.parse(item?.startAt || item?.start_at || 0),
      endAtTs: Date.parse(item?.endAt || item?.end_at || 0),
    }))
    .filter((item) => Number.isFinite(item.startAtTs) && Number.isFinite(item.endAtTs) && item.endAtTs > item.startAtTs)
    .sort((a, b) => a.startAtTs - b.startAtTs);

  let conflicts = 0;
  for (let i = 0; i < candidates.length; i += 1) {
    const current = candidates[i];
    for (let j = i + 1; j < candidates.length; j += 1) {
      const next = candidates[j];
      if (next.startAtTs >= current.endAtTs) break;
      if (current.startAtTs < next.endAtTs && current.endAtTs > next.startAtTs) {
        conflicts += 1;
      }
    }
  }
  return conflicts;
}

class OperationalContextAssembler {
  async assembleTenantContext({ tenantId }) {
    const tenantKey = safeStr(tenantId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };

    const [
      crmSummaryOut,
      revenueOut,
      schedulesOut,
      waitingOut,
      inProgressOut,
      campaignsOut,
      callbacksOut,
      tasksOut,
      scheduleAlertsOut,
      ragAvailableOut,
      ragHealthOut,
    ] = await Promise.all([
      safeCall(() => CRMEventService.getTenantOperationalSummary({ tenantId: tenantKey, recentWindowHours: 72 }), { ok: false, summary: null }),
      safeCall(() => revenueEngine.listOpportunities({ tenantId: tenantKey }), { ok: false, items: [] }),
      safeCall(() => schedulingService.listSchedules({ tenantId: tenantKey, filters: { limit: 200 } }), { ok: false, items: [] }),
      safeCall(() => queueService.listAllTicketsPaged({ tenantId: tenantKey, status: ['waiting'], limit: 200 }), { items: [] }),
      safeCall(() => queueService.listAllTicketsPaged({ tenantId: tenantKey, status: ['in_progress'], limit: 200 }), { items: [] }),
      safeCall(() => ccCampaignsService.listCampaigns({ tenantKey }), []),
      safeCall(() => ccScheduledCallbacksService.listScheduledCallbacks({ tenantKey }), []),
      safeCall(() => tasksService.listTasks(tenantKey), { ok: false, tasks: [] }),
      safeCall(() => schedulingHealthService.listAlerts({ tenantId: tenantKey, includeResolved: false, limit: 120 }), { ok: false, items: [] }),
      safeCall(() => ragService.isRagAvailable(tenantKey), false),
      safeCall(() => ragDocumentsService.getRagHealth(tenantKey), { ok: false, docs: { total: 0, indexed: 0 }, warnings: [] }),
    ]);

    const scheduleStats = summarizeSchedules(schedulesOut?.items || []);
    const waitingTickets = safeArray(waitingOut?.items).length;
    const inProgressTickets = safeArray(inProgressOut?.items).length;
    const campaigns = safeArray(campaignsOut);
    const callbacks = safeArray(callbacksOut);
    const tasks = safeArray(tasksOut?.tasks);
    const revenueItems = safeArray(revenueOut?.items);

    const callbackPending = callbacks.filter((item) => String(item?.status || '').toLowerCase() === 'pending').length;
    const openTasks = tasks.filter((item) => String(item?.status || '').toLowerCase() !== 'completed').length;
    const scheduleAlerts = safeArray(scheduleAlertsOut?.items);
    const conflictAlerts = scheduleAlerts.filter((item) => {
      const type = String(item?.alertType || item?.alert_type || '').toLowerCase();
      return type.includes('conflict');
    });
    const unavailableAlerts = scheduleAlerts.filter((item) => {
      const type = String(item?.alertType || item?.alert_type || '').toLowerCase();
      return type.includes('outside_working_hours') || type.includes('impossible_slot');
    });
    const doubleBookingAlerts = scheduleAlerts.filter((item) => {
      const type = String(item?.alertType || item?.alert_type || '').toLowerCase();
      return type.includes('repeated_professional_conflict') || type.includes('repeated_resource_conflict');
    });
    const ragWarnings = safeArray(ragHealthOut?.warnings);

    return {
      ok: true,
      tenantId: tenantKey,
      crmSummary: crmSummaryOut?.summary || null,
      scheduleStats,
      support: {
        waitingTickets,
        inProgressTickets,
      },
      campaigns,
      callbacks: {
        total: callbacks.length,
        pending: callbackPending,
      },
      tasks: {
        total: tasks.length,
        open: openTasks,
      },
      revenue: {
        totalOpen: revenueItems.length,
        items: revenueItems,
      },
      scheduling: {
        totalAlerts: scheduleAlerts.length,
        conflictAlerts: conflictAlerts.length,
        unavailableAlerts: unavailableAlerts.length,
        doubleBookingAlerts: doubleBookingAlerts.length,
        alerts: scheduleAlerts,
      },
      rag: {
        available: ragAvailableOut === true,
        docsTotal: safeNumber(ragHealthOut?.docs?.total, 0),
        docsIndexed: safeNumber(ragHealthOut?.docs?.indexed, 0),
        warnings: ragWarnings,
      },
    };
  }

  async assembleContactContext({ tenantId, contactId }) {
    const tenantKey = safeStr(tenantId);
    const contactKey = safeStr(contactId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };
    if (!contactKey) return { ok: false, error: 'contact_required' };

    const [summaryOut, profileOut, schedulesOut, revenueOut, callbacksOut, ragAvailableOut, ragHealthOut] = await Promise.all([
      safeCall(() => CRMEventService.getContactOperationalSummary({ tenantId: tenantKey, contactId: contactKey, recentWindowHours: 72 }), { ok: false, summary: null }),
      safeCall(() => CRMEventService.getContactProfile({ tenantId: tenantKey, contactId: contactKey, timelineLimit: 40 }), { ok: false, profile: null }),
      safeCall(() => schedulingService.listSchedules({ tenantId: tenantKey, filters: { contactId: contactKey, limit: 100 } }), { ok: false, items: [] }),
      safeCall(() => revenueEngine.listOpportunities({ tenantId: tenantKey }), { ok: false, items: [] }),
      safeCall(() => ccScheduledCallbacksService.listScheduledCallbacks({ tenantKey }), []),
      safeCall(() => ragService.isRagAvailable(tenantKey), false),
      safeCall(() => ragDocumentsService.getRagHealth(tenantKey), { ok: false, docs: { total: 0, indexed: 0 }, warnings: [] }),
    ]);

    const summary = summaryOut?.summary || null;
    const profile = profileOut?.profile || null;
    const schedules = safeArray(schedulesOut?.items);
    const revenueItemsAll = safeArray(revenueOut?.items);
    const revenueItems = revenueItemsAll.filter((item) => {
      const relatedEntityType = String(item?.related_entity_type || '').toLowerCase();
      const relatedEntityId = String(item?.related_entity_id || '').trim();
      const entityId = String(item?.entity_id || '').trim();
      return (relatedEntityType === 'crm_contact' && relatedEntityId === contactKey) || entityId === contactKey;
    });

    const contactPhoneDigits = normalizePhoneDigits(profile?.contact?.phone || profile?.contact?.phoneNumber || '');
    const now = Date.now();
    const callbackMatches = safeArray(callbacksOut).filter((item) => {
      if (!contactPhoneDigits) return false;
      return normalizePhoneDigits(item?.phone) === contactPhoneDigits;
    });
    const callbackPending = callbackMatches.filter((item) => String(item?.status || '').toLowerCase() === 'pending').length;
    const callbackOverdue = callbackMatches.filter((item) => {
      if (String(item?.status || '').toLowerCase() !== 'pending') return false;
      const ts = Date.parse(item?.scheduledAt || item?.scheduled_at || 0);
      return Number.isFinite(ts) && ts < now;
    }).length;

    const scheduleStats = summarizeSchedules(schedules);
    const scheduleConflictCount = countScheduleConflicts(schedules);
    const hasUpcomingSchedule = scheduleStats.upcoming > 0;
    const hasUpsellOpportunity = revenueItems.some((item) => String(item?.type || '').toLowerCase().includes('upsell'));
    const ragWarnings = safeArray(ragHealthOut?.warnings);

    return {
      ok: true,
      tenantId: tenantKey,
      contactId: contactKey,
      summary,
      profile,
      schedules,
      scheduleStats,
      callbacks: {
        total: callbackMatches.length,
        pending: callbackPending,
        overdue: callbackOverdue,
      },
      revenue: {
        totalOpen: revenueItems.length,
        hasUpsellOpportunity,
        items: revenueItems,
      },
      flags: {
        hasUpcomingSchedule,
        recentActivity: summary?.recentActivity === true,
        scheduleConflictCount,
        hasScheduleConflict: scheduleConflictCount > 0,
      },
      rag: {
        available: ragAvailableOut === true,
        docsTotal: safeNumber(ragHealthOut?.docs?.total, 0),
        docsIndexed: safeNumber(ragHealthOut?.docs?.indexed, 0),
        warnings: ragWarnings,
      },
    };
  }
}

module.exports = {
  OperationalContextAssembler,
};
