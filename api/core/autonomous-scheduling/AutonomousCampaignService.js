'use strict';

const { Op } = require('sequelize');
const {
  AutonomousGapCampaign,
  AutonomousGapCandidate,
  OperationalSchedule,
  CrmContact,
} = require('../../db/models');
const crmService = require('../../services/crm/crmService');
const schedulingService = require('../../services/schedulingService');
const outboundQueueService = require('../../services/outboundQueueService');
const { getPolicy } = require('./AutonomousSchedulePolicyService');
const { rankCandidatesForGap } = require('./CandidateRankingService');
const { newId, getJson } = require('./shared');
const {
  buildGapFingerprint,
  getCampaignExpiryAt,
  isChannelAllowed,
  isWeekdayAllowed,
  isWithinSendWindow,
  matchesPreferredTimeWindows,
  resolvePolicy,
} = require('./runtime');
const logger = require('../../utils/logger');

function mapCampaign(row) {
  const json = getJson(row);
  return {
    id: json.id,
    tenantId: json.tenant_key,
    operationalScheduleId: json.operational_schedule_id || null,
    source: json.source,
    channel: json.channel,
    status: json.status,
    contextType: json.context_type,
    contextId: json.context_id,
    serviceType: json.service_type || null,
    ownerId: json.owner_id || null,
    teamId: json.team_id || null,
    gapFingerprint: json.gap_fingerprint || null,
    gapStartAt: json.gap_start_at ? new Date(json.gap_start_at).toISOString() : null,
    gapEndAt: json.gap_end_at ? new Date(json.gap_end_at).toISOString() : null,
    timezone: json.timezone || 'UTC',
    maxInvites: Number(json.max_invites || 0),
    sentInvites: Number(json.sent_invites || 0),
    acceptedContactId: json.accepted_contact_id || null,
    closedReason: json.closed_reason || null,
    startedAt: json.started_at ? new Date(json.started_at).toISOString() : null,
    closedAt: json.closed_at ? new Date(json.closed_at).toISOString() : null,
    metadata: json.metadata || {},
  };
}

function mapCandidate(row) {
  const json = getJson(row);
  return {
    id: json.id,
    tenantId: json.tenant_key,
    campaignId: json.campaign_id,
    contactId: json.contact_id,
    source: json.source,
    score: Number(json.score || 0),
    scoreBreakdown: json.score_breakdown || {},
    inviteStatus: json.invite_status,
    inviteChannel: json.invite_channel || null,
    outboundMessageId: json.outbound_message_id || null,
    sentAt: json.sent_at ? new Date(json.sent_at).toISOString() : null,
    respondedAt: json.responded_at ? new Date(json.responded_at).toISOString() : null,
    responseType: json.response_type || null,
    cooldownUntil: json.cooldown_until ? new Date(json.cooldown_until).toISOString() : null,
    metadata: json.metadata || {},
  };
}

function buildCooldownUntil(policy, reason, now = new Date()) {
  const hours = reason === 'rejected'
    ? policy.cooldownHoursAfterReject
    : policy.cooldownHoursAfterNoResponse;
  return new Date(now.getTime() + (Math.max(0, Number(hours) || 0) * 3600 * 1000));
}

async function ensureGapStillFree({ tenantId, campaign }) {
  const found = await OperationalSchedule().findOne({
    where: {
      tenant_key: String(tenantId),
      owner_id: campaign.ownerId || null,
      team_id: campaign.teamId || null,
      status: { [Op.in]: ['scheduled', 'in_progress'] },
      start_at: { [Op.lt]: new Date(campaign.gapEndAt) },
      end_at: { [Op.gt]: new Date(campaign.gapStartAt) },
    },
  });
  return !found;
}

async function closeCampaign({ tenantId, campaignRow, status, reason, transaction = null }) {
  const current = String(campaignRow.status || '').toLowerCase();
  if (['filled', 'expired', 'cancelled', 'canceled', 'completed'].includes(current) && current === status && String(campaignRow.closed_reason || '') === String(reason || '')) {
    return mapCampaign(campaignRow);
  }
  await campaignRow.update({
    status,
    closed_reason: reason || campaignRow.closed_reason || null,
    closed_at: campaignRow.closed_at || new Date(),
  }, transaction ? { transaction } : undefined);
  logger.info('[AutonomousScheduling] campanha encerrada', {
    tenantId,
    campaignId: campaignRow.id,
    reason: reason || null,
    status,
  });
  return mapCampaign(campaignRow);
}

async function expireCampaignIfNeeded({ tenantId, campaignRow, policy, now = new Date() }) {
  const campaign = mapCampaign(campaignRow);
  if (!['open', 'running'].includes(String(campaign.status || '').toLowerCase())) return campaign;
  const expiryAt = getCampaignExpiryAt(campaign, policy);
  if (expiryAt.getTime() > now.getTime()) return campaign;

  await AutonomousGapCandidate().update({
    invite_status: 'expired',
    responded_at: now,
    response_type: 'timeout',
    cooldown_until: buildCooldownUntil(policy, 'no_response', now),
  }, {
    where: {
      tenant_key: String(tenantId),
      campaign_id: String(campaign.id),
      invite_status: { [Op.in]: ['pending', 'sent'] },
    },
  });
  await closeCampaign({ tenantId, campaignRow, status: 'expired', reason: 'timeout' });
  logger.info('[AutonomousScheduling] campanha expirada', { tenantId, campaignId: campaign.id });
  return mapCampaign(campaignRow);
}

async function findExistingCampaign({ tenantId, fingerprint }) {
  if (!fingerprint) return null;
  return AutonomousGapCampaign().findOne({
    where: {
      tenant_key: String(tenantId),
      gap_fingerprint: fingerprint,
    },
  });
}

async function createCampaign({ tenantId, gap }) {
  const policy = resolvePolicy(await getPolicy(tenantId));
  const runtimeGap = {
    ...gap,
    serviceType: gap.serviceType || policy.settings?.serviceType || null,
    channel: gap.channel || policy.channel || 'whatsapp',
    ownerId: gap.ownerId || policy.settings?.preferredOwnerId || null,
  };
  const fingerprint = buildGapFingerprint({ tenantId, gap: runtimeGap });
  const existing = await findExistingCampaign({ tenantId, fingerprint });
  if (existing) {
    logger.info('[AutonomousScheduling] campanha ignorada por duplicidade', {
      tenantId,
      campaignId: existing.id,
      gapFingerprint: fingerprint,
    });
    return { ok: true, created: false, campaign: mapCampaign(existing) };
  }

  try {
    const row = await AutonomousGapCampaign().create({
      id: newId('agc'),
      tenant_key: String(tenantId),
      operational_schedule_id: runtimeGap.operationalScheduleId || null,
      source: runtimeGap.source || 'detected_gap',
      channel: runtimeGap.channel,
      status: 'open',
      context_type: runtimeGap.contextType || 'system',
      context_id: runtimeGap.contextId || 'system',
      service_type: runtimeGap.serviceType || null,
      owner_id: runtimeGap.ownerId || null,
      team_id: runtimeGap.teamId || null,
      gap_fingerprint: fingerprint,
      gap_start_at: new Date(runtimeGap.gapStartAt),
      gap_end_at: new Date(runtimeGap.gapEndAt),
      timezone: runtimeGap.timezone || 'UTC',
      max_invites: runtimeGap.maxInvites || policy.maxInvitesPerCampaign,
      metadata: runtimeGap.metadata && typeof runtimeGap.metadata === 'object' ? runtimeGap.metadata : {},
    });
    logger.info('[AutonomousScheduling] campanha criada', {
      tenantId,
      campaignId: row.id,
      gapFingerprint: fingerprint,
      ownerId: row.owner_id || null,
      teamId: row.team_id || null,
      startAt: row.gap_start_at?.toISOString?.() || null,
      endAt: row.gap_end_at?.toISOString?.() || null,
    });
    return { ok: true, created: true, campaign: mapCampaign(row) };
  } catch (err) {
    if (err?.name === 'SequelizeUniqueConstraintError') {
      const duplicate = await findExistingCampaign({ tenantId, fingerprint });
      if (duplicate) {
        logger.info('[AutonomousScheduling] campanha ignorada por duplicidade', {
          tenantId,
          campaignId: duplicate.id,
          gapFingerprint: fingerprint,
        });
        return { ok: true, created: false, campaign: mapCampaign(duplicate) };
      }
    }
    throw err;
  }
}

async function materializeCandidates({ tenantId, campaign, policy }) {
  const ranked = await rankCandidatesForGap({ tenantId, gap: { ...campaign, settings: policy.settings } });
  const rows = [];
  for (const item of ranked.items || []) {
    const existing = await AutonomousGapCandidate().findOne({
      where: {
        tenant_key: String(tenantId),
        campaign_id: String(campaign.id),
        contact_id: String(item.contactId),
      },
    });
    if (existing) {
      rows.push(existing);
      continue;
    }
    try {
      const created = await AutonomousGapCandidate().create({
        id: newId('agcand'),
        tenant_key: String(tenantId),
        campaign_id: String(campaign.id),
        contact_id: String(item.contactId),
        source: item.source,
        score: item.score,
        score_breakdown: item.scoreBreakdown,
        invite_status: item.scoreBreakdown?.cooldown ? 'cooldown' : 'pending',
        cooldown_until: item.contact?.attributes?.cooldownUntil || null,
        metadata: {
          contactSnapshot: {
            name: item.contact?.name || null,
            phone: item.contact?.phone || null,
          },
        },
      });
      rows.push(created);
      logger.info('[AutonomousScheduling] candidato ranqueado', {
        tenantId,
        campaignId: campaign.id,
        contactId: item.contactId,
        score: item.score,
        source: item.source,
      });
    } catch (err) {
      if (err?.name === 'SequelizeUniqueConstraintError') {
        const duplicate = await AutonomousGapCandidate().findOne({
          where: {
            tenant_key: String(tenantId),
            campaign_id: String(campaign.id),
            contact_id: String(item.contactId),
          },
        });
        if (duplicate) {
          rows.push(duplicate);
          continue;
        }
      }
      throw err;
    }
  }
  return rows.map((row) => getJson(row));
}

async function isCandidateBlockedByPolicy({ tenantId, campaign, candidate, policy, contact }) {
  const now = new Date();
  if (!isWeekdayAllowed(policy, now)) return 'weekday_not_allowed';
  if (!isWithinSendWindow(policy, now)) return 'send_window_blocked';
  if (!isChannelAllowed(policy, campaign.channel || policy.channel)) return 'channel_not_allowed';
  if (candidate.cooldown_until && new Date(candidate.cooldown_until).getTime() > now.getTime()) return 'cooldown_active';
  if (policy.settings?.preferredOwnerId && campaign.ownerId && String(policy.settings.preferredOwnerId) !== String(campaign.ownerId)) {
    return 'preferred_owner_mismatch';
  }
  const attrs = contact?.attributes && typeof contact.attributes === 'object' ? contact.attributes : {};
  if (!matchesPreferredTimeWindows(campaign, attrs.preferredTimeWindows || policy.settings?.preferredTimeWindows || [])) {
    return 'preferred_time_window_mismatch';
  }
  return null;
}

async function sendInviteMessage({ tenantId, campaign, candidate, policy }) {
  const contact = await CrmContact().findOne({
    where: {
      tenant_key: String(tenantId),
      id: String(candidate.contact_id),
    },
  });
  const contactJson = contact ? getJson(contact) : null;
  const blockedReason = await isCandidateBlockedByPolicy({
    tenantId,
    campaign,
    candidate,
    policy,
    contact: contactJson,
  });
  if (blockedReason) {
    logger.info('[AutonomousScheduling] convite bloqueado por policy', {
      tenantId,
      campaignId: campaign.id,
      candidateId: candidate.id,
      contactId: candidate.contact_id,
      reason: blockedReason,
    });
    return { ok: false, blocked: true, reason: blockedReason };
  }

  const to = contactJson?.phone ? String(contactJson.phone).replace(/[^\d]/g, '') : '';
  if (!to) {
    const err = new Error('candidate_phone_required');
    err.code = 'candidate_phone_required';
    throw err;
  }

  const when = new Intl.DateTimeFormat('pt-BR', {
    timeZone: campaign.timezone || 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(campaign.gapStartAt));
  const vertical = policy.settings?.verticalTemplate || 'beauty';
  const serviceLabel = campaign.serviceType || policy.settings?.serviceType || (vertical === 'fitness' ? 'treino' : 'atendimento');
  const text = vertical === 'fitness'
    ? `Abrimos uma vaga para ${serviceLabel} em ${when}. Se quiser aproveitar, responda a esta mensagem e nossa equipe confirma o encaixe.`
    : `Temos um horario livre para ${serviceLabel} em ${when}. Se quiser aproveitar a vaga, responda a esta mensagem e nossa equipe confirma.`;

  const outbound = await outboundQueueService.enqueueOutbound({
    tenantId,
    channelType: campaign.channel || 'whatsapp',
    message: {
      to,
      type: 'text',
      body: { text },
      meta: {
        clientMessageId: `autonomous-scheduling:${campaign.id}:${candidate.id}`,
        autonomousScheduling: {
          campaignId: campaign.id,
          candidateId: candidate.id,
          serviceType: serviceLabel,
        },
      },
    },
  });

  await crmService.logActivity({
    tenantId,
    type: 'autonomous_schedule_invite_sent',
    status: 'done',
    subjectType: 'crm_contact',
    subjectId: candidate.contact_id,
    contactId: candidate.contact_id,
    correlationId: campaign.id,
    payload: {
      campaignId: campaign.id,
      candidateId: candidate.id,
      serviceType: serviceLabel,
    },
    actorId: 'autonomous-scheduling',
  });

  logger.info('[AutonomousScheduling] convite enviado', {
    tenantId,
    campaignId: campaign.id,
    candidateId: candidate.id,
    contactId: candidate.contact_id,
    outboundItemId: outbound?.itemId || null,
  });

  return {
    ok: true,
    blocked: false,
    itemId: outbound?.itemId || null,
    mode: outbound?.direct ? 'direct' : 'queued',
  };
}

async function listCampaignCandidates({ tenantId, campaignId }) {
  const rows = await AutonomousGapCandidate().findAll({
    where: {
      tenant_key: String(tenantId),
      campaign_id: String(campaignId),
    },
    order: [['score', 'DESC'], ['created_at', 'ASC']],
  });
  const contactIds = rows.map((row) => String(row.contact_id));
  const contacts = contactIds.length > 0
    ? await CrmContact().findAll({ where: { tenant_key: String(tenantId), id: { [Op.in]: contactIds } } })
    : [];
  const contactsById = new Map(contacts.map((row) => [String(row.id), getJson(row)]));
  return {
    ok: true,
    items: rows.map((row) => ({
      ...mapCandidate(row),
      contact: contactsById.get(String(row.contact_id)) || null,
    })),
  };
}

async function runCampaign({ tenantId, campaignId }) {
  const policy = resolvePolicy(await getPolicy(tenantId));
  const row = await AutonomousGapCampaign().findOne({ where: { tenant_key: String(tenantId), id: String(campaignId) } });
  if (!row) {
    const err = new Error('autonomous_campaign_not_found');
    err.code = 'autonomous_campaign_not_found';
    throw err;
  }

  const expired = await expireCampaignIfNeeded({ tenantId, campaignRow: row, policy });
  if (!['open', 'running'].includes(String(expired.status || '').toLowerCase())) {
    return { ok: true, campaign: expired, dispatched: [] };
  }

  const free = await ensureGapStillFree({ tenantId, campaign: expired });
  if (!free) {
    await closeCampaign({ tenantId, campaignRow: row, status: 'filled', reason: 'occupied_externally' });
    return { ok: true, campaign: mapCampaign(row), dispatched: [] };
  }

  await row.update({ status: 'running', started_at: row.started_at || new Date() });
  const campaign = mapCampaign(row);
  const candidates = await materializeCandidates({ tenantId, campaign, policy });
  const remainingInvites = Math.max(0, Number(campaign.maxInvites || policy.maxInvitesPerCampaign) - Number(campaign.sentInvites || 0));
  if (remainingInvites <= 0) {
    logger.info('[AutonomousScheduling] campanha encerrada', {
      tenantId,
      campaignId: campaign.id,
      reason: 'max_invites_reached',
    });
    return { ok: true, campaign, dispatched: [] };
  }

  const pending = candidates
    .filter((item) => ['pending', 'cooldown'].includes(String(item.invite_status || '').toLowerCase()))
    .slice(0, remainingInvites);
  const dispatched = [];
  for (const item of pending) {
    const candidateRow = await AutonomousGapCandidate().findOne({ where: { tenant_key: String(tenantId), id: String(item.id) } });
    if (!candidateRow) continue;
    const candidate = getJson(candidateRow);
    const inviteResult = await sendInviteMessage({ tenantId, campaign, candidate, policy });
    if (inviteResult.blocked) {
      const nextStatus = inviteResult.reason === 'cooldown_active' ? 'cooldown' : 'skipped';
      const patch = {
        invite_status: nextStatus,
        response_type: inviteResult.reason,
      };
      if (nextStatus === 'cooldown') {
        patch.cooldown_until = candidate.cooldown_until || buildCooldownUntil(policy, 'no_response');
        logger.info('[AutonomousScheduling] cooldown aplicado', {
          tenantId,
          campaignId: campaign.id,
          candidateId: candidate.id,
          contactId: candidate.contact_id,
          reason: inviteResult.reason,
        });
      }
      await candidateRow.update(patch);
      continue;
    }
    await candidateRow.update({
      invite_status: 'sent',
      invite_channel: campaign.channel,
      outbound_message_id: inviteResult.itemId || null,
      sent_at: new Date(),
      metadata: { ...(candidateRow.metadata || {}), dispatch: inviteResult },
    });
    dispatched.push({ candidateId: candidateRow.id, contactId: candidateRow.contact_id, dispatch: inviteResult });
  }

  const sentInvites = Number(row.sent_invites || 0) + dispatched.length;
  await row.update({ sent_invites: sentInvites });
  if (sentInvites >= Number(campaign.maxInvites || policy.maxInvitesPerCampaign)) {
    logger.info('[AutonomousScheduling] campanha encerrada', {
      tenantId,
      campaignId: campaign.id,
      reason: 'max_invites_reached',
    });
  }
  return { ok: true, campaign: mapCampaign(row), dispatched };
}

async function rejectCandidate({ tenantId, campaignId, candidateId }) {
  const policy = resolvePolicy(await getPolicy(tenantId));
  const campaignRow = await AutonomousGapCampaign().findOne({ where: { tenant_key: String(tenantId), id: String(campaignId) } });
  const candidateRow = await AutonomousGapCandidate().findOne({ where: { tenant_key: String(tenantId), id: String(candidateId), campaign_id: String(campaignId) } });
  if (!campaignRow || !candidateRow) {
    const err = new Error('autonomous_campaign_or_candidate_not_found');
    err.code = 'autonomous_campaign_or_candidate_not_found';
    throw err;
  }
  const currentStatus = String(candidateRow.invite_status || '').toLowerCase();
  if (['rejected', 'expired', 'accepted'].includes(currentStatus)) {
    return { ok: true, campaign: mapCampaign(campaignRow), candidate: mapCandidate(candidateRow) };
  }

  const cooldownUntil = buildCooldownUntil(policy, 'rejected');
  await candidateRow.update({
    invite_status: 'rejected',
    response_type: 'rejected',
    responded_at: new Date(),
    cooldown_until: cooldownUntil,
  });
  logger.info('[AutonomousScheduling] rejeição registrada', {
    tenantId,
    campaignId,
    candidateId,
    cooldownUntil: cooldownUntil.toISOString(),
  });
  logger.info('[AutonomousScheduling] cooldown aplicado', {
    tenantId,
    campaignId,
    candidateId,
    reason: 'rejected',
  });
  return { ok: true, campaign: mapCampaign(campaignRow), candidate: mapCandidate(candidateRow) };
}

async function acceptCandidate({ tenantId, campaignId, candidateId, actor = {} }) {
  const CampaignModel = AutonomousGapCampaign();
  const sequelize = CampaignModel.sequelize || null;
  const run = sequelize?.transaction
    ? (handler) => sequelize.transaction(handler)
    : async (handler) => handler(null);

  return run(async (transaction) => {
    const campaignRow = await CampaignModel.findOne({
      where: { tenant_key: String(tenantId), id: String(campaignId) },
      transaction: transaction || undefined,
    });
    const candidateRow = await AutonomousGapCandidate().findOne({
      where: { tenant_key: String(tenantId), id: String(candidateId), campaign_id: String(campaignId) },
      transaction: transaction || undefined,
    });
    if (!campaignRow || !candidateRow) {
      const err = new Error('autonomous_campaign_or_candidate_not_found');
      err.code = 'autonomous_campaign_or_candidate_not_found';
      throw err;
    }

    const campaign = mapCampaign(campaignRow);
    const currentCampaignStatus = String(campaign.status || '').toLowerCase();
    const currentCandidateStatus = String(candidateRow.invite_status || '').toLowerCase();
    if (currentCandidateStatus === 'accepted' || (currentCampaignStatus === 'filled' && String(campaign.acceptedContactId || '') === String(candidateRow.contact_id || ''))) {
      return { ok: true, campaign, schedule: null, idempotent: true };
    }
    if (['expired', 'rejected', 'skipped', 'cooldown'].includes(currentCandidateStatus)) {
      const err = new Error('candidate_not_acceptable');
      err.code = 'candidate_not_acceptable';
      throw err;
    }
    if (['expired', 'cancelled', 'canceled', 'completed'].includes(currentCampaignStatus)) {
      const err = new Error('campaign_not_open');
      err.code = 'campaign_not_open';
      throw err;
    }

    const free = await ensureGapStillFree({ tenantId, campaign });
    if (!free) {
      await closeCampaign({ tenantId, campaignRow, status: 'filled', reason: 'occupied_externally', transaction });
      logger.info('[AutonomousScheduling] falha por concorrência/slot indisponível', {
        tenantId,
        campaignId,
        candidateId,
      });
      const err = new Error('gap_no_longer_available');
      err.code = 'gap_no_longer_available';
      throw err;
    }

    const created = await schedulingService.createSchedule({
      tenantId,
      contextType: campaign.contextType,
      contextId: campaign.contextId,
      contactId: candidateRow.contact_id,
      conversationId: null,
      channel: campaign.channel || 'whatsapp',
      mode: campaign.ownerId || campaign.teamId ? 'team_based' : 'free',
      origin: 'system',
      startAt: campaign.gapStartAt,
      endAt: campaign.gapEndAt,
      timezone: campaign.timezone || 'UTC',
      requiresConfirmation: true,
      ownerId: campaign.ownerId || null,
      teamId: campaign.teamId || null,
      purpose: campaign.serviceType || 'agendamento_autonomo',
      notes: 'Criado automaticamente pela Agenda Autônoma',
      idempotencyKey: `autonomous_campaign_fill:${campaign.id}`,
      metadata: {
        autonomousScheduling: {
          campaignId: campaign.id,
          candidateId: candidateRow.id,
          source: campaign.source,
        },
        serviceType: campaign.serviceType || null,
      },
      actor,
    });

    await candidateRow.update({
      invite_status: 'accepted',
      responded_at: new Date(),
      response_type: 'accepted',
    }, transaction ? { transaction } : undefined);
    await AutonomousGapCandidate().update(
      {
        invite_status: 'expired',
        responded_at: new Date(),
        response_type: 'filled_by_other',
      },
      {
        where: {
          tenant_key: String(tenantId),
          campaign_id: String(campaign.id),
          id: { [Op.ne]: String(candidateRow.id) },
          invite_status: { [Op.in]: ['pending', 'sent', 'cooldown', 'skipped'] },
        },
        ...(transaction ? { transaction } : {}),
      }
    );
    await closeCampaign({ tenantId, campaignRow, status: 'filled', reason: 'accepted', transaction });
    logger.info('[AutonomousScheduling] candidato aceitou', {
      tenantId,
      campaignId: campaign.id,
      candidateId: candidateRow.id,
      contactId: candidateRow.contact_id,
      scheduleId: created?.schedule?.id || null,
    });

    await crmService.logActivity({
      tenantId,
      type: 'autonomous_schedule_filled',
      status: 'done',
      subjectType: 'crm_contact',
      subjectId: candidateRow.contact_id,
      contactId: candidateRow.contact_id,
      correlationId: campaign.id,
      payload: {
        campaignId: campaign.id,
        candidateId: candidateRow.id,
        scheduleId: created?.schedule?.id || null,
      },
      actorId: actor?.agentId || 'autonomous-scheduling',
    });

    return { ok: true, campaign: mapCampaign(campaignRow), schedule: created.schedule || null };
  });
}

async function listCampaigns({ tenantId, limit = 50, statuses = null }) {
  const where = {
    tenant_key: String(tenantId),
  };
  if (Array.isArray(statuses) && statuses.length > 0) {
    where.status = { [Op.in]: statuses.map(String) };
  }
  const rows = await AutonomousGapCampaign().findAll({
    where,
    order: [['gap_start_at', 'ASC']],
    limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
  });
  return { ok: true, items: rows.map(mapCampaign) };
}

async function listOpenCampaigns({ tenantId, limit = 50 }) {
  return listCampaigns({ tenantId, limit, statuses: ['open', 'running'] });
}

module.exports = {
  createCampaign,
  runCampaign,
  acceptCandidate,
  rejectCandidate,
  listCampaigns,
  listOpenCampaigns,
  listCampaignCandidates,
  mapCampaign,
};
