'use strict';

const crypto = require('crypto');
const { QueryTypes } = require('sequelize');
const { connect, close } = require('../api/db');
const {
  defineRelationships,
  OperationalSchedule,
  ScheduleReminder,
  OutboundQueueItem,
} = require('../api/db/models');
const schedulingService = require('../api/services/schedulingService');
const { handleScheduleWhatsAppReply } = require('../api/services/scheduleWhatsAppResponder');
const { processDueRemindersBatch } = require('../api/services/scheduleRemindersService');

function reqEnv(name, fallback = null) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  return String(v).trim();
}

function assert(condition, message) {
  if (!condition) {
    const err = new Error(message || 'assert_failed');
    err.code = 'assert_failed';
    throw err;
  }
}

function randomId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function isoPlusMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

async function getScheduleById(tenantId, scheduleId) {
  const Model = OperationalSchedule();
  return Model.findOne({
    where: {
      tenant_key: String(tenantId),
      id: String(scheduleId),
    },
  });
}

async function listOutboundBySchedule(tenantId, scheduleId) {
  const Model = OutboundQueueItem();
  const rows = await Model.findAll({
    where: { tenant_key: String(tenantId) },
    order: [['created_at', 'DESC']],
    limit: 500,
  });
  return (rows || []).filter((row) => {
    const json = row.toJSON ? row.toJSON() : row;
    return String(json?.message?.meta?.scheduleId || '') === String(scheduleId);
  });
}

async function ensureLedgerEventForSchedule(tenantId, scheduleId, expectedTypes = []) {
  const sequelize = OperationalSchedule().sequelize;
  const rows = await sequelize.query(
    `SELECT type
     FROM event_ledger
     WHERE tenant_key = :tenantKey
       AND correlation_id = :correlationId
     ORDER BY created_at DESC
     LIMIT 100`,
    {
      replacements: {
        tenantKey: String(tenantId),
        correlationId: String(scheduleId),
      },
      type: QueryTypes.SELECT,
    },
  );

  const types = new Set((rows || []).map((r) => String(r.type || '')));
  const hit = expectedTypes.some((t) => types.has(String(t)));
  assert(hit, `event_ledger_missing_for_${scheduleId}: expected ${expectedTypes.join(',')}`);
}

async function createBaseSchedule({ tenantId, contextId, conversationId, contactId, purpose, requiresConfirmation = true, reminders = null }) {
  const payload = {
    contextType: 'ticket',
    contextId,
    contactId,
    conversationId,
    channel: 'whatsapp',
    mode: 'free',
    startAt: isoPlusMinutes(20),
    endAt: isoPlusMinutes(50),
    timezone: 'UTC',
    requiresConfirmation,
    purpose,
    origin: 'system',
    idempotencyKey: randomId('idem'),
  };
  if (Array.isArray(reminders)) payload.reminders = reminders;

  const out = await schedulingService.createSchedule({
    tenantId,
    input: payload,
    actor: { actorType: 'system', username: 'smoke' },
  });
  assert(out?.ok === true && out?.schedule?.id, 'schedule_create_failed');
  return out.schedule;
}

async function runBackendSmoke() {
  const tenantId = reqEnv('TEST_TENANT_ID', 'system');
  const runTag = crypto.randomBytes(3).toString('hex');
  const contact = (suffix) => `5511999${runTag}${suffix}`.slice(0, 13);
  const inboundId = (suffix) => `inbound-${runTag}-${suffix}-${Date.now()}`;

  console.log(`[SMOKE] tenant=${tenantId}`);

  // 1) Cliente responde "1" -> confirmado + audit + ledger + idempotência
  const context1 = randomId('ticket-smoke-1');
  const schedule1 = await createBaseSchedule({
    tenantId,
    contextId: context1,
    conversationId: randomId('conv-smoke-1'),
    contactId: contact('01'),
    purpose: 'smoke-confirm',
    requiresConfirmation: true,
  });

  const row1 = await getScheduleById(tenantId, schedule1.id);
  await row1.update({
    metadata: {
      ...(row1.toJSON().metadata || {}),
      confirmation_message_id: 'wamid-smoke-confirm-1',
    },
  });

  const confirmInbound = inboundId('confirm-1');
  const confirmReply = await handleScheduleWhatsAppReply({
    tenantId,
    messageText: '1',
    contactId: schedule1.contactId,
    conversationId: schedule1.conversationId,
    from: schedule1.contactId,
    payload: {
      message: {
        context: { id: 'wamid-smoke-confirm-1' },
      },
    },
    inboundMessageId: confirmInbound,
  });
  assert(confirmReply?.handled === true && confirmReply?.action === 'confirm', 'confirm_reply_not_handled');

  const row1After = await getScheduleById(tenantId, schedule1.id);
  const j1 = row1After.toJSON ? row1After.toJSON() : row1After;
  assert(String(j1.confirmation_status) === 'confirmed', 'schedule_not_confirmed_after_reply_1');
  await ensureLedgerEventForSchedule(tenantId, schedule1.id, ['ScheduleConfirmed']);

  const outBeforeDup = (await listOutboundBySchedule(tenantId, schedule1.id)).length;
  const confirmDup = await handleScheduleWhatsAppReply({
    tenantId,
    messageText: 'confirmo',
    contactId: schedule1.contactId,
    conversationId: schedule1.conversationId,
    from: schedule1.contactId,
    payload: {
      message: {
        context: { id: 'wamid-smoke-confirm-1' },
      },
    },
    inboundMessageId: confirmInbound,
  });
  assert(confirmDup?.idempotent === true, 'duplicate_inbound_not_idempotent');
  const outAfterDup = (await listOutboundBySchedule(tenantId, schedule1.id)).length;
  assert(outAfterDup === outBeforeDup, 'duplicate_inbound_generated_extra_outbound');
  console.log('[SMOKE] ✓ checklist 1 + idempotência inbound');

  // 2) Cliente responde "3" -> cancelado + audit + ledger
  const context2 = randomId('ticket-smoke-2');
  const schedule2 = await createBaseSchedule({
    tenantId,
    contextId: context2,
    conversationId: randomId('conv-smoke-2'),
    contactId: contact('02'),
    purpose: 'smoke-cancel',
    requiresConfirmation: true,
  });

  const cancelReply = await handleScheduleWhatsAppReply({
    tenantId,
    messageText: '3',
    contactId: schedule2.contactId,
    conversationId: schedule2.conversationId,
    from: schedule2.contactId,
    inboundMessageId: inboundId('cancel-1'),
  });
  assert(cancelReply?.handled === true && cancelReply?.action === 'cancel', 'cancel_reply_not_handled');

  const row2After = await getScheduleById(tenantId, schedule2.id);
  const j2 = row2After.toJSON ? row2After.toJSON() : row2After;
  assert(String(j2.status) === 'canceled', 'schedule_not_canceled_after_reply_3');
  await ensureLedgerEventForSchedule(tenantId, schedule2.id, ['ScheduleDeclined', 'ScheduleCanceled']);
  console.log('[SMOKE] ✓ checklist 2');

  // 3) Cliente responde "2" + escolha "1" -> reagendado
  const context3 = randomId('ticket-smoke-3');
  const schedule3 = await createBaseSchedule({
    tenantId,
    contextId: context3,
    conversationId: randomId('conv-smoke-3'),
    contactId: contact('03'),
    purpose: 'smoke-reschedule',
    requiresConfirmation: true,
  });

  const row3Before = await getScheduleById(tenantId, schedule3.id);
  const oldStart3 = String((row3Before.toJSON ? row3Before.toJSON() : row3Before).start_at);

  const resReq = await handleScheduleWhatsAppReply({
    tenantId,
    messageText: '2',
    contactId: schedule3.contactId,
    conversationId: schedule3.conversationId,
    from: schedule3.contactId,
    inboundMessageId: inboundId('reschedule-1'),
  });
  assert(resReq?.handled === true && resReq?.action === 'reschedule', 'reschedule_request_not_handled');

  const row3Mid = await getScheduleById(tenantId, schedule3.id);
  const j3Mid = row3Mid.toJSON ? row3Mid.toJSON() : row3Mid;
  assert(j3Mid?.metadata?.reschedule_state === 'awaiting_choice', 'reschedule_state_not_awaiting_choice');
  assert(Array.isArray(j3Mid?.metadata?.reschedule_options) && j3Mid.metadata.reschedule_options.length >= 1, 'reschedule_options_missing');

  const resPick = await handleScheduleWhatsAppReply({
    tenantId,
    messageText: '1',
    contactId: schedule3.contactId,
    conversationId: schedule3.conversationId,
    from: schedule3.contactId,
    inboundMessageId: inboundId('reschedule-2'),
  });
  assert(resPick?.handled === true && resPick?.action === 'reschedule_choice', 'reschedule_choice_not_handled');

  const row3After = await getScheduleById(tenantId, schedule3.id);
  const j3After = row3After.toJSON ? row3After.toJSON() : row3After;
  assert(String(j3After.start_at) !== oldStart3, 'schedule_start_not_changed_after_reschedule_choice');
  await ensureLedgerEventForSchedule(tenantId, schedule3.id, ['ScheduleRescheduled']);
  console.log('[SMOKE] ✓ checklist 3');

  // 4) Worker processa reminders e envia outbound_queue
  const context4 = randomId('ticket-smoke-4');
  const schedule4 = await schedulingService.createSchedule({
    tenantId,
    input: {
      contextType: 'ticket',
      contextId: context4,
      contactId: contact('04'),
      conversationId: randomId('conv-smoke-4'),
      channel: 'whatsapp',
      mode: 'free',
      startAt: isoPlusMinutes(-2),
      endAt: isoPlusMinutes(28),
      timezone: 'UTC',
      requiresConfirmation: false,
      purpose: 'smoke-reminder-worker',
      origin: 'system',
      reminders: [{ offsetMinutes: 0, action: 'notify', channel: 'whatsapp' }],
      idempotencyKey: randomId('idem-reminder'),
    },
    actor: { actorType: 'system', username: 'smoke' },
  });
  assert(schedule4?.ok && schedule4?.schedule?.id, 'schedule4_create_failed');

  const ReminderModel = ScheduleReminder();
  const remBefore = await ReminderModel.findAll({
    where: {
      tenant_key: String(tenantId),
      schedule_id: String(schedule4.schedule.id),
    },
  });
  assert(remBefore.length >= 1, 'schedule4_reminder_not_created');

  const workerOut = await processDueRemindersBatch({ limit: 50 });
  assert(workerOut?.ok === true, 'reminder_worker_failed');

  const remAfter = await ReminderModel.findAll({
    where: {
      tenant_key: String(tenantId),
      schedule_id: String(schedule4.schedule.id),
    },
  });
  const doneCount = remAfter.filter((r) => {
    const j = r.toJSON ? r.toJSON() : r;
    return String(j.status) === 'done';
  }).length;
  assert(doneCount >= 1, 'schedule4_reminder_not_marked_done');

  const out4 = await listOutboundBySchedule(tenantId, schedule4.schedule.id);
  assert(out4.length >= 1, 'reminder_worker_no_outbound_for_schedule4');
  console.log('[SMOKE] ✓ checklist 4');

  // 6) Sem duplicações em repetição
  assert(confirmDup?.idempotent === true, 'checklist6_duplicate_guard_failed');
  console.log('[SMOKE] ✓ checklist 6');

  console.log('[SMOKE] ✅ Backend checklist 1,2,3,4,6 aprovado');
}

async function run() {
  if (String(process.env.SMOKE_ALLOW_DB_WRITE || 'false').toLowerCase() !== 'true') {
    throw new Error('Defina SMOKE_ALLOW_DB_WRITE=true para executar este smoke com escrita em banco.');
  }

  await connect();
  defineRelationships();

  try {
    await runBackendSmoke();
    console.log('[SMOKE] ✅ Próximo passo: executar frontend (checklist 5): cd frontend && npx vitest run --config vitest.config.mjs src/__tests__/SupportPage.waqr.test.jsx');
  } finally {
    await close().catch(() => null);
  }
}

run().catch((err) => {
  console.error('[SMOKE] ❌ Falha:', err && err.message ? err.message : err);
  process.exit(1);
});
