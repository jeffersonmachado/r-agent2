'use strict';

const { CrmContact } = require('../../db/models');
const { getSequelize } = require('../../db/sequelize');
const outboundQueueService = require('../../services/outboundQueueService');
const whatsappTemplateService = require('../../services/whatsappTemplateService');
const schedulingService = require('../../services/schedulingService');
const ccScheduledCallbacksService = require('../../services/cc/ccScheduledCallbacksService');
const tasksService = require('../../services/tasksService');
const ccCampaignsService = require('../../services/cc/ccCampaignsService');
const crmService = require('../../services/crm/crmService');
const { emitEvent } = require('../../services/websocketService');

function safeString(value) {
  const normalized = value == null ? '' : String(value).trim();
  return normalized || null;
}

function nowPlusHours(hours) {
  const safeHours = Number.isFinite(Number(hours)) ? Number(hours) : 0;
  return new Date(Date.now() + safeHours * 60 * 60 * 1000);
}

function dbAvailable() {
  return !!getSequelize();
}

async function resolveContactPhone({ tenantId, context }) {
  const fromContext = safeString(
    context?.phoneNumber
    || context?.phone
    || context?.contactPhone
    || context?.metadata?.phoneNumber
    || context?.metadata?.phone
  );
  if (fromContext) return fromContext;

  const contactId = safeString(context?.contactId);
  if (!contactId || !dbAvailable()) return null;

  const ContactModel = typeof CrmContact === 'function' ? CrmContact() : CrmContact;
  if (!ContactModel) return null;

  const row = await ContactModel.findOne({
    where: {
      tenant_key: String(tenantId),
      id: String(contactId),
    },
  });
  if (!row) return null;
  const json = row.toJSON ? row.toJSON() : row;
  return safeString(json?.phone);
}

async function resolvePipelineAndStage({ tenantId, step }) {
  const explicitPipelineId = safeString(step?.pipelineId);
  const explicitStageId = safeString(step?.stageId);
  if (explicitPipelineId && explicitStageId) {
    return { pipelineId: explicitPipelineId, stageId: explicitStageId };
  }

  const pipelinesOut = await crmService.listPipelines({ tenantId, limit: 20, offset: 0 });
  const pipelines = Array.isArray(pipelinesOut?.items) ? pipelinesOut.items : [];
  let pipeline = pipelines.find((item) => item.is_default) || pipelines[0] || null;

  if (!pipeline) {
    const created = await crmService.upsertPipeline({
      tenantId,
      name: 'Pipeline padrão',
      status: 'active',
      isDefault: true,
      stages: [
        { id: 'qualificacao', name: 'Qualificação', order: 1 },
        { id: 'proposta', name: 'Proposta', order: 2 },
        { id: 'fechamento', name: 'Fechamento', order: 3 },
      ],
    });
    pipeline = created?.pipeline || null;
  }

  const stages = Array.isArray(pipeline?.stages) ? pipeline.stages : [];
  const stage = stages[0] || { id: 'qualificacao' };
  return {
    pipelineId: explicitPipelineId || safeString(pipeline?.id),
    stageId: explicitStageId || safeString(stage?.id),
  };
}

async function suggestSlots({ tenantId, step, context }) {
  const limit = Math.max(1, Number(step?.limit) || 3);
  const durationMinutes = Math.max(15, Number(step?.durationMinutes) || 30);
  const timezone = safeString(step?.timezone || context?.timezone) || 'UTC';
  const mode = safeString(step?.mode || 'free') || 'free';
  const ownerId = safeString(step?.ownerId || context?.ownerId);
  const teamId = safeString(step?.teamId || context?.teamId);

  const slots = [];
  const startHour = Number.isFinite(Number(step?.startHour)) ? Number(step.startHour) : 9;
  const endHour = Number.isFinite(Number(step?.endHour)) ? Number(step.endHour) : 18;
  const daysAhead = Math.max(1, Number(step?.daysAhead) || 7);

  const baseDate = new Date();
  let checks = 0;

  for (let day = 0; day < daysAhead && slots.length < limit; day += 1) {
    for (let hour = startHour; hour < endHour && slots.length < limit; hour += 1) {
      checks += 1;
      if (checks > 120) break;

      const candidateStart = new Date(baseDate);
      candidateStart.setDate(baseDate.getDate() + day);
      candidateStart.setHours(hour, 0, 0, 0);
      if (candidateStart.getTime() <= Date.now()) continue;

      const candidateEnd = new Date(candidateStart.getTime() + durationMinutes * 60 * 1000);
      const availability = await schedulingService.getAvailability({
        tenantId,
        mode,
        startAt: candidateStart.toISOString(),
        endAt: candidateEnd.toISOString(),
        ownerId: ownerId || null,
        teamId: teamId || null,
        timezone,
      });

      if (availability?.available) {
        slots.push({
          startAt: candidateStart.toISOString(),
          endAt: candidateEnd.toISOString(),
          timezone,
          mode,
          ownerId: ownerId || null,
          teamId: teamId || null,
        });
      }
    }
  }

  return { ok: true, slots };
}

class PlaybookStepExecutor {
  async executeStep(step, context) {
    const type = safeString(step?.type);
    const tenantId = safeString(context?.tenantId);
    if (!tenantId) throw new Error('tenant_required');
    if (!type) throw new Error('step_type_required');

    if (type === 'send_whatsapp_template') {
      const templateName = safeString(step?.template || step?.templateName);
      if (!templateName) throw new Error('template_required');
      const to = await resolveContactPhone({ tenantId, context });
      if (!to) throw new Error('contact_phone_required');
      const out = await whatsappTemplateService.sendTemplateMessage(
        to,
        templateName,
        safeString(step?.languageCode) || 'pt_BR',
        Array.isArray(step?.parameters) ? step.parameters : [],
        { tenantId }
      );
      if (!out?.success) throw new Error(out?.error || 'template_send_failed');
      return { ok: true, type, to, templateName, queued: !!out?.queued, itemId: out?.itemId || null };
    }

    if (type === 'send_whatsapp_message') {
      const text = safeString(step?.message || step?.text);
      if (!text) throw new Error('message_required');
      const to = await resolveContactPhone({ tenantId, context });
      if (!to) throw new Error('contact_phone_required');
      const out = await outboundQueueService.enqueueOutbound({
        tenantId,
        channelType: 'whatsapp',
        message: {
          to,
          type: 'text',
          body: { text },
        },
      });
      return { ok: true, type, to, text, queue: out };
    }

    if (type === 'create_followup') {
      const to = await resolveContactPhone({ tenantId, context });
      if (!to) throw new Error('contact_phone_required');
      const scheduledAt = step?.scheduledAt
        ? new Date(step.scheduledAt)
        : nowPlusHours(step?.delayHours ?? step?.delay_hours ?? 24);
      const payload = {
        scheduledAt: scheduledAt.toISOString(),
        phone: to,
        ddd: safeString(step?.ddd),
        description: safeString(step?.description) || 'Follow-up operacional via playbook',
        status: 'pending',
        settings: {
          contactId: safeString(context?.contactId),
          signalId: safeString(context?.signalId),
          recommendationId: safeString(context?.recommendationId),
          playbookId: safeString(context?.playbookId),
          stepId: safeString(step?.id),
        },
      };
      const out = await ccScheduledCallbacksService.upsertScheduledCallback({
        tenantKey: tenantId,
        payload,
        actorUserId: safeString(context?.operatorId),
      });
      return { ok: true, type, callback: out };
    }

    if (type === 'create_task') {
      const out = await tasksService.createTask(tenantId, {
        title: safeString(step?.titleTemplate || step?.taskTitle || step?.title) || 'Tarefa operacional',
        description: safeString(step?.description) || 'Tarefa criada por playbook operacional',
        dueAt: step?.dueAt || nowPlusHours(step?.delayHours ?? 24).toISOString(),
        priority: safeString(step?.priority) || 'normal',
      });
      if (!out?.ok) throw new Error(out?.error || 'task_create_failed');
      return { ok: true, type, task: out.task };
    }

    if (type === 'create_opportunity') {
      const mapping = await resolvePipelineAndStage({ tenantId, step });
      if (!mapping.pipelineId || !mapping.stageId) throw new Error('pipeline_or_stage_unavailable');
      const out = await crmService.upsertOpportunity({
        tenantId,
        pipelineId: mapping.pipelineId,
        stageId: mapping.stageId,
        title: safeString(step?.title) || 'Oportunidade criada por playbook',
        accountId: safeString(context?.accountId),
        contactId: safeString(context?.contactId),
        ownerUserId: safeString(context?.operatorId),
        valueCents: Number(step?.valueCents) || 0,
        currency: safeString(step?.currency) || 'BRL',
        status: safeString(step?.status) || 'open',
        correlationId: safeString(context?.recommendationId || context?.signalId || context?.playbookExecutionId),
        actorId: safeString(context?.operatorId),
      });
      if (!out?.ok) throw new Error(out?.error || 'opportunity_create_failed');
      return { ok: true, type, opportunity: out.opportunity };
    }

    if (type === 'suggest_schedule_slots') {
      return suggestSlots({ tenantId, step, context });
    }

    if (type === 'create_booking') {
      const slotFromContext = context?.selectedSlot && typeof context.selectedSlot === 'object'
        ? context.selectedSlot
        : null;
      const startAt = safeString(step?.startAt || slotFromContext?.startAt);
      const endAt = safeString(step?.endAt || slotFromContext?.endAt);
      if (!startAt || !endAt) throw new Error('booking_slot_required');

      const out = await schedulingService.createSchedule({
        tenantId,
        actor: {
          actorType: 'user',
          agentId: safeString(context?.operatorId),
          id: safeString(context?.operatorId),
        },
        input: {
          contextType: safeString(step?.contextType) || 'crm',
          contextId: safeString(step?.contextId || context?.contactId || context?.ticketId),
          contactId: safeString(context?.contactId),
          conversationId: safeString(context?.conversationId),
          channel: safeString(step?.channel) || 'whatsapp',
          mode: safeString(step?.mode) || 'free',
          origin: safeString(step?.origin) || 'human',
          startAt,
          endAt,
          timezone: safeString(step?.timezone || slotFromContext?.timezone) || 'UTC',
          purpose: safeString(step?.purpose) || 'Agendamento via playbook',
          notes: safeString(step?.notes) || null,
          requiresConfirmation: step?.requiresConfirmation !== false,
          ownerId: safeString(step?.ownerId || slotFromContext?.ownerId || context?.operatorId),
          teamId: safeString(step?.teamId || slotFromContext?.teamId || context?.teamId),
        },
      });
      return { ok: true, type, schedule: out };
    }

    if (type === 'add_to_campaign') {
      const campaignId = safeString(step?.campaignId);
      if (!campaignId) throw new Error('campaign_id_required');
      const to = await resolveContactPhone({ tenantId, context });
      if (!to) throw new Error('contact_phone_required');
      const out = await ccCampaignsService.addCampaignListItems({
        tenantKey: tenantId,
        campaignId,
        items: [
          {
            phone: to,
            ddd: safeString(step?.ddd),
            key: safeString(step?.key),
            extra: {
              contactId: safeString(context?.contactId),
              signalId: safeString(context?.signalId),
              recommendationId: safeString(context?.recommendationId),
              playbookId: safeString(context?.playbookId),
            },
          },
        ],
      });
      return { ok: true, type, campaignId, items: out };
    }

    if (type === 'notify_operator') {
      emitEvent('operational_playbook_notification', {
        playbookId: safeString(context?.playbookId),
        stepId: safeString(step?.id),
        message: safeString(step?.message || step?.description) || 'Ação operacional requer atenção do operador.',
        contactId: safeString(context?.contactId),
      }, {
        tenantId,
        agentId: safeString(context?.operatorId),
      });
      return { ok: true, type, notified: true };
    }

    if (type === 'notify_team') {
      emitEvent('operational_playbook_notification', {
        playbookId: safeString(context?.playbookId),
        stepId: safeString(step?.id),
        teamId: safeString(step?.teamId || context?.teamId),
        message: safeString(step?.message || step?.description) || 'Ação operacional requer atenção da equipe.',
        contactId: safeString(context?.contactId),
      }, {
        tenantId,
      });
      return { ok: true, type, notified: true };
    }

    throw new Error(`unsupported_step_type:${type}`);
  }
}

module.exports = {
  PlaybookStepExecutor,
};
