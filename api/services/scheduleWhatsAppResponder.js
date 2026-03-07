'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const { OperationalSchedule } = require('../db/models');
const schedulingService = require('./schedulingService');
const outboundQueueService = require('./outboundQueueService');
const { parseScheduleReply } = require('../utils/scheduleReplyParser');
const { getTicket } = require('./queueService');
const { logAction } = require('./auditService');
const { appendEventV1 } = require('./eventLedgerService');
const logger = require('../utils/logger');

function toIso(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function safeDateFmt(dateIso, timezone) {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return { date: '-', time: '-' };
  try {
    const date = new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone || 'UTC',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);
    const time = new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone || 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
    return { date, time };
  } catch (_) {
    return { date: d.toLocaleDateString('pt-BR'), time: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) };
  }
}

function formatScheduleDateTime(schedule) {
  return safeDateFmt(schedule.start_at || schedule.startAt, schedule.timezone || 'UTC');
}

function newToken() {
  return crypto.randomBytes(10).toString('hex');
}

function extractReplyToMessageId({ payload = {}, normalized = {} }) {
  const ids = [];
  const message = payload?.message || normalized?.raw?.message || null;
  const context = message?.context || normalized?.raw?.message?.context || {};
  if (context?.id) ids.push(String(context.id));
  if (context?.message_id) ids.push(String(context.message_id));
  if (context?.quoted_message_id) ids.push(String(context.quoted_message_id));
  if (normalized?.raw?.message?.context?.id) ids.push(String(normalized.raw.message.context.id));
  return Array.from(new Set(ids.filter(Boolean)));
}

function getScheduleLinks(meta) {
  const links = Array.isArray(meta?.schedule_message_links) ? meta.schedule_message_links : [];
  return links.filter((item) => item && typeof item === 'object');
}

function hasMatchingLink(meta, replyToMessageId) {
  if (!replyToMessageId) return false;
  const target = String(replyToMessageId);
  if (meta?.confirmation_message_id && String(meta.confirmation_message_id) === target) return true;
  return getScheduleLinks(meta).some((link) => {
    const candidates = [
      link.channel_message_id,
      link.channelMessageId,
      link.message_id,
      link.messageId,
    ].filter(Boolean).map(String);
    return candidates.includes(target);
  });
}

async function emitOperationalAuditEvent({ tenantId, action, scheduleId = null, details = {}, idempotencyKey = null }) {
  try {
    logAction({
      tenantId,
      action,
      resource: 'schedule',
      resourceId: scheduleId,
      details,
      agentId: null,
      username: 'system',
      ipAddress: '127.0.0.1',
      userAgent: 'scheduleWhatsAppResponder',
    });
  } catch (_) {}

  try {
    await appendEventV1({
      tenantId,
      type: 'ScheduleWhatsAppReplyHandled',
      source: 'schedule.whatsapp.responder',
      occurredAt: new Date().toISOString(),
      correlationId: scheduleId,
      subject: { type: 'schedule', id: scheduleId },
      actor: { type: 'system', id: 'schedule-whatsapp-responder' },
      idempotencyKey,
      payload: {
        action,
        ...details,
      },
    });
  } catch (err) {
    logger.warn('[ScheduleWA] Falha ao registrar event ledger (best-effort)', { error: err.message });
  }
}

function parseWindowDays() {
  const back = Number(process.env.SCHEDULE_WA_RESOLVE_WINDOW_BACK_DAYS || 7);
  const ahead = Number(process.env.SCHEDULE_WA_RESOLVE_WINDOW_AHEAD_DAYS || 30);
  return {
    backDays: Number.isFinite(back) ? Math.max(1, Math.min(30, back)) : 7,
    aheadDays: Number.isFinite(ahead) ? Math.max(1, Math.min(90, ahead)) : 30,
  };
}

async function listCandidateSchedules({ tenantId, conversationId = null, contactId = null, includeAwaitingReschedule = true }) {
  const Model = OperationalSchedule();
  const now = Date.now();
  const { backDays, aheadDays } = parseWindowDays();
  const startFrom = new Date(now - (backDays * 24 * 60 * 60 * 1000));
  const startTo = new Date(now + (aheadDays * 24 * 60 * 60 * 1000));

  const where = {
    tenant_key: String(tenantId),
    status: 'scheduled',
    start_at: {
      [Op.gte]: startFrom,
      [Op.lte]: startTo,
    },
  };

  const contactOrConversation = [];
  if (conversationId) contactOrConversation.push({ conversation_id: String(conversationId) });
  if (contactId) contactOrConversation.push({ contact_id: String(contactId) });
  if (contactOrConversation.length > 0) {
    where[Op.or] = contactOrConversation;
  }

  const rows = await Model.findAll({
    where,
    order: [['updated_at', 'DESC'], ['start_at', 'ASC']],
    limit: 120,
  });

  return (rows || []).filter((row) => {
    const json = row.toJSON ? row.toJSON() : row;
    if (json.requires_confirmation && json.confirmation_status === 'pending') return true;
    if (includeAwaitingReschedule && json?.metadata?.reschedule_state === 'awaiting_choice') return true;
    return false;
  });
}

async function findScheduleByInboundMessageId({ tenantId, inboundMessageId, conversationId = null, contactId = null }) {
  if (!inboundMessageId) return null;
  const Model = OperationalSchedule();
  const now = Date.now();
  const { backDays, aheadDays } = parseWindowDays();
  const startFrom = new Date(now - (backDays * 24 * 60 * 60 * 1000));
  const startTo = new Date(now + (aheadDays * 24 * 60 * 60 * 1000));

  const where = {
    tenant_key: String(tenantId),
    start_at: {
      [Op.gte]: startFrom,
      [Op.lte]: startTo,
    },
  };
  const contactOrConversation = [];
  if (conversationId) contactOrConversation.push({ conversation_id: String(conversationId) });
  if (contactId) contactOrConversation.push({ contact_id: String(contactId) });
  if (contactOrConversation.length > 0) where[Op.or] = contactOrConversation;

  const rows = await Model.findAll({
    where,
    order: [['updated_at', 'DESC']],
    limit: 150,
  });
  const target = String(inboundMessageId);
  return (rows || []).find((row) => {
    const json = row.toJSON ? row.toJSON() : row;
    const history = getProcessedInboundReplies(json.metadata || {});
    return history.has(target);
  }) || null;
}

async function resolveScheduleTarget({
  tenantId,
  conversationId = null,
  contactId = null,
  replyToMessageIds = [],
}) {
  const candidates = await listCandidateSchedules({ tenantId, conversationId, contactId, includeAwaitingReschedule: true });
  const replyIds = Array.isArray(replyToMessageIds) ? replyToMessageIds.filter(Boolean).map(String) : [];

  for (const replyId of replyIds) {
    const byReply = candidates.find((row) => {
      const json = row.toJSON ? row.toJSON() : row;
      return hasMatchingLink(json.metadata || {}, replyId);
    });
    if (byReply) {
      return {
        schedule: byReply,
        method: 'reply_context',
      };
    }
  }

  const pending = candidates.find((row) => {
    const json = row.toJSON ? row.toJSON() : row;
    return json.requires_confirmation && json.confirmation_status === 'pending';
  });
  if (pending) {
    return {
      schedule: pending,
      method: 'fallback_pending_confirmation',
    };
  }

  const awaitingChoice = candidates.find((row) => {
    const json = row.toJSON ? row.toJSON() : row;
    return json?.metadata?.reschedule_state === 'awaiting_choice';
  });
  if (awaitingChoice) {
    return {
      schedule: awaitingChoice,
      method: 'fallback_reschedule_state',
    };
  }

  return {
    schedule: null,
    method: 'not_found',
  };
}

async function sendOperationalMessage({
  tenantId,
  to,
  conversationId = null,
  scheduleId,
  type,
  text,
  clientMessageId,
}) {
  if (!to || !text) return { queued: false, skipped: true };
  return outboundQueueService.enqueueOutbound({
    tenantId,
    channelType: 'whatsapp',
    conversationId,
    message: {
      to: String(to),
      type: 'text',
      body: { text: String(text) },
      meta: {
        clientMessageId,
        scheduleId,
        operationalTemplateType: type,
      },
    },
  });
}

async function updateScheduleMetadata(row, patch = {}) {
  const json = row.toJSON ? row.toJSON() : row;
  const currentMeta = json.metadata && typeof json.metadata === 'object' ? json.metadata : {};
  const nextMeta = {
    ...currentMeta,
    ...patch,
  };
  await row.update({ metadata: nextMeta, updated_at: new Date() });
  return row;
}

function ensureLinkInMetadata(meta, link) {
  const links = getScheduleLinks(meta);
  links.push({
    ...link,
    createdAt: new Date().toISOString(),
  });
  return links.slice(-15);
}

function getProcessedInboundReplies(meta) {
  const history = Array.isArray(meta?.whatsapp_reply_history) ? meta.whatsapp_reply_history : [];
  const map = new Map();
  for (const item of history) {
    if (!item || typeof item !== 'object') continue;
    const key = item.messageId ? String(item.messageId) : null;
    if (!key) continue;
    map.set(key, item);
  }
  return map;
}

async function registerInboundReplyProcessed({ row, inboundMessageId, action, details = {} }) {
  if (!inboundMessageId) return;
  const json = row.toJSON ? row.toJSON() : row;
  const meta = json.metadata && typeof json.metadata === 'object' ? json.metadata : {};
  const current = Array.isArray(meta.whatsapp_reply_history) ? meta.whatsapp_reply_history : [];
  const exists = current.some((item) => item && String(item.messageId || '') === String(inboundMessageId));
  if (exists) return;

  const next = [
    ...current,
    {
      messageId: String(inboundMessageId),
      action: String(action || 'unknown'),
      processedAt: new Date().toISOString(),
      details: details && typeof details === 'object' ? details : {},
    },
  ].slice(-50);

  await updateScheduleMetadata(row, {
    whatsapp_reply_history: next,
  });
}

async function registerScheduleMessageLink({ row, type, channelMessageId = null, outboundQueueItemId = null, token = null }) {
  const json = row.toJSON ? row.toJSON() : row;
  const meta = json.metadata && typeof json.metadata === 'object' ? json.metadata : {};
  const schedule_message_links = ensureLinkInMetadata(meta, {
    type,
    channel_message_id: channelMessageId || null,
    outbound_queue_item_id: outboundQueueItemId || null,
    token: token || null,
  });

  return updateScheduleMetadata(row, {
    schedule_message_links,
    confirmation_message_id: channelMessageId || meta.confirmation_message_id || null,
    confirmation_token: token || meta.confirmation_token || null,
  });
}

function buildRescheduleFreeOptions(scheduleJson) {
  const startAt = new Date(scheduleJson.start_at || scheduleJson.startAt);
  const endAt = new Date(scheduleJson.end_at || scheduleJson.endAt);
  const durationMs = Math.max(5 * 60 * 1000, endAt.getTime() - startAt.getTime());
  const now = Date.now();
  const baseline = Math.max(now + 2 * 60 * 60 * 1000, startAt.getTime() + 2 * 60 * 60 * 1000);
  const tomorrowAt9 = new Date();
  tomorrowAt9.setUTCHours(9, 0, 0, 0);
  tomorrowAt9.setUTCDate(tomorrowAt9.getUTCDate() + 1);

  const starts = [
    new Date(baseline),
    new Date(baseline + 2 * 60 * 60 * 1000),
    new Date(Math.max(tomorrowAt9.getTime(), baseline + 4 * 60 * 60 * 1000)),
  ];

  return starts.map((start) => ({
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + durationMs).toISOString(),
  }));
}

async function buildRescheduleTeamBasedOptions({ tenantId, scheduleJson }) {
  const startAt = new Date(scheduleJson.start_at || scheduleJson.startAt);
  const endAt = new Date(scheduleJson.end_at || scheduleJson.endAt);
  const durationMs = Math.max(5 * 60 * 1000, endAt.getTime() - startAt.getTime());
  const now = Date.now();
  const firstTs = Math.max(now + 2 * 60 * 60 * 1000, startAt.getTime() + 2 * 60 * 60 * 1000);

  const candidates = [];
  for (let i = 0; i < 48; i += 1) {
    const candStart = new Date(firstTs + i * 60 * 60 * 1000);
    const candEnd = new Date(candStart.getTime() + durationMs);
    // eslint-disable-next-line no-await-in-loop
    const availability = await schedulingService.getAvailability({
      tenantId,
      mode: 'team_based',
      startAt: candStart.toISOString(),
      endAt: candEnd.toISOString(),
      ownerId: scheduleJson.owner_id || null,
      teamId: scheduleJson.team_id || null,
      timezone: scheduleJson.timezone || 'UTC',
      excludeScheduleId: scheduleJson.id,
    }).catch(() => ({ available: false }));

    if (availability?.available) {
      candidates.push({
        startAt: candStart.toISOString(),
        endAt: candEnd.toISOString(),
      });
      if (candidates.length >= 3) break;
    }
  }

  return candidates;
}

function formatRescheduleOptionsMessage(scheduleJson, options = []) {
  const lines = ['📅 Podemos reagendar. Escolha um horário:', ''];
  options.forEach((opt, idx) => {
    const fmt = safeDateFmt(opt.startAt, scheduleJson.timezone || 'UTC');
    lines.push(`${idx + 1}) ${fmt.date} às ${fmt.time}`);
  });
  lines.push('');
  lines.push('Responda com 1, 2 ou 3.');
  return lines.join('\n');
}

function scheduleAllowsOperationalTemplate(scheduleJson) {
  if (String(process.env.ALLOW_OPERATIONAL_TEMPLATES_IN_HUMAN_MODE || 'true').toLowerCase() === 'true') {
    return true;
  }
  if (scheduleJson.context_type !== 'ticket') return true;
  const ticket = getTicket(scheduleJson.context_id);
  if (!ticket) return true;
  return String(ticket.mode || 'bot') !== 'human';
}

async function handleScheduleWhatsAppReply({
  tenantId,
  messageText,
  contactId = null,
  conversationId = null,
  from = null,
  payload = {},
  normalized = {},
  inboundMessageId = null,
}) {
  if (!tenantId) return { handled: false, reason: 'tenant_required' };
  const text = String(messageText || '').trim();
  if (!text) return { handled: false, reason: 'empty_text' };

  if (inboundMessageId) {
    const duplicateRow = await findScheduleByInboundMessageId({
      tenantId,
      inboundMessageId,
      conversationId,
      contactId,
    });
    if (duplicateRow) {
      const duplicateJson = duplicateRow.toJSON ? duplicateRow.toJSON() : duplicateRow;
      const item = getProcessedInboundReplies(duplicateJson.metadata || {}).get(String(inboundMessageId));
      return {
        handled: true,
        idempotent: true,
        action: item?.action || 'duplicate',
        scheduleId: duplicateJson.id,
      };
    }
  }

  const replyToMessageIds = extractReplyToMessageId({ payload, normalized });
  const resolved = await resolveScheduleTarget({
    tenantId,
    conversationId,
    contactId,
    replyToMessageIds,
  });

  if (!resolved.schedule) {
    await emitOperationalAuditEvent({
      tenantId,
      action: 'schedule_whatsapp_not_found',
      details: {
        message: text,
        conversationId: conversationId || null,
        contactId: contactId || null,
        replyToMessageIds,
      },
      idempotencyKey: inboundMessageId ? `schedule_wa_not_found:${tenantId}:${inboundMessageId}` : null,
    });
    return { handled: false, reason: 'schedule_not_found' };
  }

  const scheduleRow = resolved.schedule;
  const scheduleJson = scheduleRow.toJSON ? scheduleRow.toJSON() : scheduleRow;
  const processedByMessageId = getProcessedInboundReplies(scheduleJson.metadata || {});
  if (inboundMessageId && processedByMessageId.has(String(inboundMessageId))) {
    const item = processedByMessageId.get(String(inboundMessageId));
    return {
      handled: true,
      idempotent: true,
      action: item?.action || 'duplicate',
      scheduleId: scheduleJson.id,
    };
  }
  const awaitingChoice = scheduleJson?.metadata?.reschedule_state === 'awaiting_choice';
  const parsed = parseScheduleReply(text, { awaitingRescheduleChoice: awaitingChoice });

  if (parsed.action === 'unknown') {
    return { handled: false, reason: 'not_schedule_command', scheduleId: scheduleJson.id };
  }

  const toPhone = from || scheduleJson.contact_id || null;
  const baseClientMsgId = inboundMessageId || `${Date.now()}`;

  if (!scheduleAllowsOperationalTemplate(scheduleJson)) {
    return { handled: true, skipped: true, reason: 'operational_templates_disabled_for_handover', scheduleId: scheduleJson.id };
  }

  if (parsed.action === 'reschedule_choice') {
    const options = Array.isArray(scheduleJson?.metadata?.reschedule_options)
      ? scheduleJson.metadata.reschedule_options
      : [];
    const picked = options.find((opt) => Number(opt.choice) === Number(parsed.choice));
    if (!picked) {
      await sendOperationalMessage({
        tenantId,
        to: toPhone,
        conversationId,
        scheduleId: scheduleJson.id,
        type: 'reschedule_invalid_choice',
        text: 'Não entendi a opção. Responda com 1, 2 ou 3 para escolher o novo horário.',
        clientMessageId: `schedule:${scheduleJson.id}:choice:invalid:${baseClientMsgId}`,
      });
      await registerInboundReplyProcessed({
        row: scheduleRow,
        inboundMessageId,
        action: 'reschedule_choice_invalid',
      });
      return { handled: true, scheduleId: scheduleJson.id, action: 'reschedule_choice_invalid' };
    }

    const rescheduled = await schedulingService.rescheduleSchedule({
      tenantId,
      scheduleId: scheduleJson.id,
      input: {
        startAt: picked.startAt,
        endAt: picked.endAt,
        timezone: scheduleJson.timezone || 'UTC',
        mode: scheduleJson.mode,
        ownerId: scheduleJson.owner_id || null,
        teamId: scheduleJson.team_id || null,
        channel: scheduleJson.channel,
        origin: scheduleJson.origin || 'system',
        purpose: scheduleJson.purpose,
        notes: scheduleJson.notes,
        metadata: {
          reschedule_state: 'completed',
          reschedule_selected_choice: Number(parsed.choice),
          reschedule_selected_at: new Date().toISOString(),
          reschedule_selected_by_message_id: inboundMessageId || null,
        },
      },
      actor: {
        actorType: 'system',
        username: 'schedule-whatsapp-responder',
      },
      idempotencyKey: `wa_reply:${scheduleJson.id}:${baseClientMsgId}:reschedule_choice:${parsed.choice}`,
    });

    const fmt = safeDateFmt(picked.startAt, scheduleJson.timezone || 'UTC');
    await sendOperationalMessage({
      tenantId,
      to: toPhone,
      conversationId,
      scheduleId: scheduleJson.id,
      type: 'reschedule_confirmed',
      text: `✅ Reagendado! Nosso contato ficou para ${fmt.date} às ${fmt.time}.`,
      clientMessageId: `schedule:${scheduleJson.id}:reschedule:ok:${baseClientMsgId}`,
    });

    await emitOperationalAuditEvent({
      tenantId,
      action: 'schedule_whatsapp_reschedule_choice',
      scheduleId: scheduleJson.id,
      details: {
        choice: Number(parsed.choice),
        startAt: picked.startAt,
        endAt: picked.endAt,
      },
      idempotencyKey: inboundMessageId ? `schedule_wa_choice:${tenantId}:${scheduleJson.id}:${inboundMessageId}` : null,
    });
    await registerInboundReplyProcessed({
      row: scheduleRow,
      inboundMessageId,
      action: 'reschedule_choice',
      details: { choice: Number(parsed.choice) },
    });

    return {
      handled: true,
      action: 'reschedule_choice',
      schedule: rescheduled.schedule,
      scheduleId: scheduleJson.id,
    };
  }

  if (parsed.action === 'confirm') {
    const out = await schedulingService.confirmSchedule({
      tenantId,
      scheduleId: scheduleJson.id,
      actor: {
        actorType: 'system',
        username: 'schedule-whatsapp-responder',
      },
      by: 'whatsapp_reply',
      idempotencyKey: `wa_reply:${scheduleJson.id}:${baseClientMsgId}:confirm`,
    });

    const fmt = formatScheduleDateTime(out.schedule);
    await sendOperationalMessage({
      tenantId,
      to: toPhone,
      conversationId,
      scheduleId: scheduleJson.id,
      type: 'confirmed',
      text: `✅ Confirmado! Falamos em ${fmt.date} às ${fmt.time}.`,
      clientMessageId: `schedule:${scheduleJson.id}:confirm:ok:${baseClientMsgId}`,
    });

    await updateScheduleMetadata(scheduleRow, {
      reschedule_state: null,
      reschedule_options: [],
    });
    await registerInboundReplyProcessed({
      row: scheduleRow,
      inboundMessageId,
      action: 'confirm',
    });

    return { handled: true, action: 'confirm', schedule: out.schedule, scheduleId: scheduleJson.id };
  }

  if (parsed.action === 'cancel') {
    let out;
    if (scheduleJson.requires_confirmation && scheduleJson.confirmation_status === 'pending') {
      out = await schedulingService.declineSchedule({
        tenantId,
        scheduleId: scheduleJson.id,
        actor: {
          actorType: 'system',
          username: 'schedule-whatsapp-responder',
        },
        by: 'whatsapp_reply',
        idempotencyKey: `wa_reply:${scheduleJson.id}:${baseClientMsgId}:decline`,
      });
    } else {
      out = await schedulingService.cancelSchedule({
        tenantId,
        scheduleId: scheduleJson.id,
        actor: {
          actorType: 'system',
          username: 'schedule-whatsapp-responder',
        },
        reason: 'customer_whatsapp_reply',
        idempotencyKey: `wa_reply:${scheduleJson.id}:${baseClientMsgId}:cancel`,
      });
    }

    await sendOperationalMessage({
      tenantId,
      to: toPhone,
      conversationId,
      scheduleId: scheduleJson.id,
      type: 'canceled',
      text: '❌ Agendamento cancelado. Se precisar, é só chamar.',
      clientMessageId: `schedule:${scheduleJson.id}:cancel:ok:${baseClientMsgId}`,
    });

    await updateScheduleMetadata(scheduleRow, {
      reschedule_state: null,
      reschedule_options: [],
    });
    await registerInboundReplyProcessed({
      row: scheduleRow,
      inboundMessageId,
      action: 'cancel',
    });

    return { handled: true, action: 'cancel', schedule: out.schedule, scheduleId: scheduleJson.id };
  }

  if (parsed.action === 'reschedule') {
    const options = scheduleJson.mode === 'team_based'
      ? await buildRescheduleTeamBasedOptions({ tenantId, scheduleJson })
      : buildRescheduleFreeOptions(scheduleJson);

    if (!options || options.length === 0) {
      await sendOperationalMessage({
        tenantId,
        to: toPhone,
        conversationId,
        scheduleId: scheduleJson.id,
        type: 'reschedule_no_slots',
        text: 'Não encontrei horários próximos agora. Pode sugerir uma data e horário?',
        clientMessageId: `schedule:${scheduleJson.id}:reschedule:no_slots:${baseClientMsgId}`,
      });
      await registerInboundReplyProcessed({
        row: scheduleRow,
        inboundMessageId,
        action: 'reschedule_no_slots',
      });
      return { handled: true, action: 'reschedule_no_slots', scheduleId: scheduleJson.id };
    }

    const optionsWithChoice = options.slice(0, 3).map((opt, idx) => ({
      choice: idx + 1,
      startAt: toIso(opt.startAt),
      endAt: toIso(opt.endAt),
    }));

    await updateScheduleMetadata(scheduleRow, {
      reschedule_state: 'awaiting_choice',
      reschedule_requested_at: new Date().toISOString(),
      reschedule_options: optionsWithChoice,
      reschedule_requested_by_message_id: inboundMessageId || null,
    });

    const textMessage = formatRescheduleOptionsMessage(scheduleJson, optionsWithChoice);
    await sendOperationalMessage({
      tenantId,
      to: toPhone,
      conversationId,
      scheduleId: scheduleJson.id,
      type: 'reschedule_options',
      text: textMessage,
      clientMessageId: `schedule:${scheduleJson.id}:reschedule:options:${baseClientMsgId}`,
    });

    await emitOperationalAuditEvent({
      tenantId,
      action: 'schedule_whatsapp_reschedule_requested',
      scheduleId: scheduleJson.id,
      details: {
        options: optionsWithChoice,
      },
      idempotencyKey: inboundMessageId ? `schedule_wa_reschedule_req:${tenantId}:${scheduleJson.id}:${inboundMessageId}` : null,
    });
    await registerInboundReplyProcessed({
      row: scheduleRow,
      inboundMessageId,
      action: 'reschedule',
    });

    return { handled: true, action: 'reschedule', scheduleId: scheduleJson.id };
  }

  return { handled: false, reason: 'no_action', scheduleId: scheduleJson.id };
}

async function sendScheduleConfirmationRequest({
  tenantId,
  schedule,
  to,
  conversationId = null,
  reminderId = null,
  source = 'reminder_worker',
}) {
  const scheduleJson = schedule?.toJSON ? schedule.toJSON() : schedule;
  if (!scheduleJson) return { queued: false, skipped: true, reason: 'schedule_missing' };

  if (!scheduleAllowsOperationalTemplate(scheduleJson)) {
    return { queued: false, skipped: true, reason: 'operational_templates_disabled_for_handover' };
  }

  const token = newToken();
  const fmt = formatScheduleDateTime(scheduleJson);
  const text = [
    `Olá! Confirmando seu agendamento de ${fmt.date} às ${fmt.time}.`,
    'Responda com:',
    '1 para confirmar',
    '2 para reagendar',
    '3 para cancelar',
  ].join('\n');

  const out = await sendOperationalMessage({
    tenantId,
    to: to || scheduleJson.contact_id,
    conversationId: conversationId || scheduleJson.conversation_id || null,
    scheduleId: scheduleJson.id,
    type: 'request_confirmation',
    text,
    clientMessageId: `schedule:${scheduleJson.id}:request_confirmation:${reminderId || token}`,
  });

  await registerScheduleMessageLink({
    row: schedule,
    type: source,
    channelMessageId: out?.externalMessageId || null,
    outboundQueueItemId: out?.itemId || out?.queueItemId || null,
    token,
  });

  return {
    queued: true,
    token,
    itemId: out?.itemId || out?.queueItemId || null,
    externalMessageId: out?.externalMessageId || null,
  };
}

module.exports = {
  handleScheduleWhatsAppReply,
  resolveScheduleTarget,
  sendScheduleConfirmationRequest,
  extractReplyToMessageId,
};
