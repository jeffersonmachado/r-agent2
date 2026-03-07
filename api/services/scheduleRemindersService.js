'use strict';

const { Op } = require('sequelize');
const { ScheduleReminder, OperationalSchedule } = require('../db/models');
const schedulingService = require('./schedulingService');
const { sendScheduleConfirmationRequest } = require('./scheduleWhatsAppResponder');
const outboundQueueService = require('./outboundQueueService');
const { logAction } = require('./auditService');
const { appendEventV1 } = require('./eventLedgerService');
const logger = require('../utils/logger');

function nowIso() {
  return new Date().toISOString();
}

function parseIntEnv(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function nowDate() {
  return new Date();
}

function shouldMarkNoShow(scheduleJson) {
  const graceMinutes = parseIntEnv('SCHEDULE_NO_SHOW_GRACE_MINUTES', 10);
  const requireConfirmedOnly = String(process.env.SCHEDULE_NO_SHOW_REQUIRE_CONFIRMED_ONLY || 'false').toLowerCase() === 'true';

  if (String(scheduleJson.status || '').toLowerCase() !== 'scheduled') {
    return false;
  }
  const start = new Date(scheduleJson.start_at || scheduleJson.startAt);
  if (Number.isNaN(start.getTime())) return false;

  const threshold = start.getTime() + (graceMinutes * 60 * 1000);
  if (Date.now() < threshold) return false;

  if (scheduleJson.requires_confirmation) {
    const status = String(scheduleJson.confirmation_status || 'pending').toLowerCase();
    if (requireConfirmedOnly) return status === 'confirmed';
    return status === 'pending' || status === 'confirmed';
  }

  return true;
}

async function emitReminderLedger({ tenantId, reminder, action, status, details = {} }) {
  try {
    logAction({
      tenantId,
      action,
      resource: 'schedule_reminder',
      resourceId: reminder?.id || null,
      details: {
        reminderId: reminder?.id || null,
        scheduleId: reminder?.schedule_id || null,
        reminderAction: reminder?.action || null,
        status,
        ...details,
      },
      agentId: null,
      username: 'schedule-reminders-worker',
      ipAddress: '127.0.0.1',
      userAgent: 'scheduleRemindersService',
    });
  } catch (_) {}

  try {
    await appendEventV1({
      tenantId,
      type: 'ScheduleReminderProcessed',
      source: 'schedule.reminders.worker',
      occurredAt: nowIso(),
      correlationId: reminder?.schedule_id || null,
      subject: { type: 'schedule_reminder', id: reminder?.id || null },
      actor: { type: 'system', id: 'schedule-reminders-worker' },
      idempotencyKey: `schedule_reminder:${reminder?.id || 'unknown'}:${status}`,
      payload: {
        reminderId: reminder?.id || null,
        scheduleId: reminder?.schedule_id || null,
        action: reminder?.action || null,
        status,
        ...details,
      },
    });
  } catch (err) {
    logger.warn('[ScheduleReminders] Falha ao registrar event ledger (best-effort)', { error: err.message });
  }
}

async function lockDueReminders({ limit = 50 }) {
  const Model = ScheduleReminder();
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const now = nowDate();
  const candidates = await Model.findAll({
    where: {
      status: 'pending',
      execute_at: { [Op.lte]: now },
    },
    order: [['execute_at', 'ASC']],
    limit: safeLimit,
    attributes: ['id'],
  });

  const locked = [];
  for (const row of (candidates || [])) {
    const reminderId = String(row.id);
    // Claim otimista e portátil: apenas um worker consegue transicionar pending->processing.
    // eslint-disable-next-line no-await-in-loop
    const [affectedRows] = await Model.update({
      status: 'processing',
      processing_started_at: now,
      updated_at: now,
    }, {
      where: {
        id: reminderId,
        status: 'pending',
      },
    });

    if (affectedRows !== 1) continue;

    // eslint-disable-next-line no-await-in-loop
    const claimed = await Model.findOne({ where: { id: reminderId } });
    if (claimed) locked.push(claimed.toJSON ? claimed.toJSON() : claimed);
  }

  return locked;
}

async function recoverStaleProcessingReminders() {
  const Model = ScheduleReminder();
  const timeoutMin = parseIntEnv('SCHEDULE_REMINDERS_PROCESSING_TIMEOUT_MINUTES', 15);
  const safeTimeoutMin = Math.min(Math.max(timeoutMin, 1), 24 * 60);
  const strategy = String(process.env.SCHEDULE_REMINDERS_STALE_STRATEGY || 'requeue').trim().toLowerCase();
  const threshold = new Date(Date.now() - (safeTimeoutMin * 60 * 1000));

  const stale = await Model.findAll({
    where: {
      status: 'processing',
      processing_started_at: { [Op.lte]: threshold },
    },
    attributes: ['id'],
    limit: 200,
  });

  if (!stale.length) return { recovered: 0, strategy };

  const ids = stale.map((r) => String(r.id));
  if (strategy === 'failed') {
    const [affected] = await Model.update({
      status: 'failed',
      last_error: `processing_timeout_${safeTimeoutMin}m`,
      processing_started_at: null,
      updated_at: nowDate(),
    }, {
      where: { id: { [Op.in]: ids } },
    });
    return { recovered: affected || 0, strategy };
  }

  const [affected] = await Model.update({
    status: 'pending',
    processing_started_at: null,
    updated_at: nowDate(),
  }, {
    where: { id: { [Op.in]: ids } },
  });
  return { recovered: affected || 0, strategy };
}

async function markReminderDone(reminderId) {
  const Model = ScheduleReminder();
  await Model.update({
    status: 'done',
    executed_at: new Date(),
    processing_started_at: null,
    last_error: null,
    updated_at: new Date(),
  }, {
    where: { id: String(reminderId) },
  });
}

async function markReminderFailed(reminderId, error) {
  const Model = ScheduleReminder();
  await Model.update({
    status: 'failed',
    processing_started_at: null,
    last_error: String(error || 'unknown_error').slice(0, 4000),
    updated_at: new Date(),
  }, {
    where: { id: String(reminderId) },
  });
}

async function getScheduleForReminder({ tenantId, scheduleId }) {
  const Model = OperationalSchedule();
  return Model.findOne({
    where: {
      tenant_key: String(tenantId),
      id: String(scheduleId),
    },
  });
}

async function sendReminderNotify({ tenantId, scheduleJson }) {
  const fmt = (() => {
    const d = new Date(scheduleJson.start_at || scheduleJson.startAt);
    if (Number.isNaN(d.getTime())) return { date: '-', time: '-' };
    try {
      return {
        date: new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: scheduleJson.timezone || 'UTC' }).format(d),
        time: new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: scheduleJson.timezone || 'UTC' }).format(d),
      };
    } catch (_) {
      return {
        date: d.toLocaleDateString('pt-BR'),
        time: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      };
    }
  })();

  const text = `⏰ Lembrete: nosso contato é ${fmt.date} às ${fmt.time}.`;
  return outboundQueueService.enqueueOutbound({
    tenantId,
    channelType: 'whatsapp',
    conversationId: scheduleJson.conversation_id || null,
    message: {
      to: scheduleJson.contact_id,
      type: 'text',
      body: { text },
      meta: {
        clientMessageId: `schedule:${scheduleJson.id}:notify:${Date.now()}`,
        scheduleId: scheduleJson.id,
        operationalTemplateType: 'notify',
      },
    },
  });
}

async function executeReminder(reminder) {
  const tenantId = String(reminder.tenant_key);
  const scheduleId = String(reminder.schedule_id);
  const action = String(reminder.action || '').toLowerCase();

  const schedule = await getScheduleForReminder({ tenantId, scheduleId });
  if (!schedule) {
    throw new Error('schedule_not_found_for_reminder');
  }

  const scheduleJson = schedule.toJSON ? schedule.toJSON() : schedule;
  const channel = String(reminder.channel || scheduleJson.channel || 'whatsapp').toLowerCase();

  if (action === 'notify') {
    if (channel === 'whatsapp') {
      await sendReminderNotify({ tenantId, scheduleJson });
      return { action, channel, result: 'sent' };
    }
    logger.info('[ScheduleReminders] notify em canal sem integração full (stub)', { tenantId, scheduleId, channel });
    return { action, channel, result: 'stub' };
  }

  if (action === 'request_confirmation') {
    if (String(scheduleJson.status || '').toLowerCase() !== 'scheduled') {
      return { action, channel, result: 'skipped_non_scheduled' };
    }
    if (!scheduleJson.requires_confirmation || String(scheduleJson.confirmation_status || '').toLowerCase() !== 'pending') {
      return { action, channel, result: 'skipped_confirmation_not_pending' };
    }
    if (channel === 'whatsapp') {
      const out = await sendScheduleConfirmationRequest({
        tenantId,
        schedule,
        to: scheduleJson.contact_id,
        conversationId: scheduleJson.conversation_id || null,
        reminderId: reminder.id,
        source: 'request_confirmation_reminder',
      });
      return { action, channel, result: out?.skipped ? out.reason || 'skipped' : 'sent', details: out };
    }
    logger.info('[ScheduleReminders] request_confirmation em canal sem integração full (stub)', { tenantId, scheduleId, channel });
    return { action, channel, result: 'stub' };
  }

  if (action === 'mark_no_show') {
    if (!shouldMarkNoShow(scheduleJson)) {
      return { action, channel, result: 'skipped_rule' };
    }
    const out = await schedulingService.markNoShow({
      tenantId,
      scheduleId,
      actor: {
        actorType: 'system',
        username: 'schedule-reminders-worker',
      },
      idempotencyKey: `schedule_reminder:${reminder.id}:mark_no_show`,
    });
    return { action, channel, result: 'marked_no_show', scheduleStatus: out?.schedule?.status || null };
  }

  throw new Error(`unsupported_reminder_action:${action}`);
}

async function processDueRemindersBatch({ limit = 50 } = {}) {
  await recoverStaleProcessingReminders();
  const due = (await lockDueReminders({ limit })) || [];
  if (!due.length) {
    return {
      ok: true,
      locked: 0,
      done: 0,
      failed: 0,
      items: [],
    };
  }

  let done = 0;
  let failed = 0;
  const items = [];

  for (const reminder of due) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await executeReminder(reminder);
      // eslint-disable-next-line no-await-in-loop
      await markReminderDone(reminder.id);
      done += 1;
      items.push({ id: reminder.id, status: 'done', result });
      // eslint-disable-next-line no-await-in-loop
      await emitReminderLedger({
        tenantId: String(reminder.tenant_key),
        reminder,
        action: 'schedule_reminder_done',
        status: 'done',
        details: result,
      });
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-await-in-loop
      await markReminderFailed(reminder.id, err.message || String(err));
      items.push({ id: reminder.id, status: 'failed', error: err.message || String(err) });
      // eslint-disable-next-line no-await-in-loop
      await emitReminderLedger({
        tenantId: String(reminder.tenant_key),
        reminder,
        action: 'schedule_reminder_failed',
        status: 'failed',
        details: { error: err.message || String(err) },
      });
    }
  }

  return {
    ok: true,
    locked: due.length,
    done,
    failed,
    items,
  };
}

module.exports = {
  lockDueReminders,
  processDueRemindersBatch,
};
