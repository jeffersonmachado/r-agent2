'use strict';

const { Op } = require('sequelize');
const { CrmContact, AutonomousGapCandidate } = require('../../db/models');
const { listEligibleWaitingEntries } = require('./WaitingListService');
const { getPolicy } = require('./AutonomousSchedulePolicyService');
const { getJson } = require('./shared');
const { matchesPreferredTimeWindows, resolvePolicy } = require('./runtime');

function getAttrs(contact) {
  return (contact && typeof contact.attributes === 'object' && contact.attributes) ? contact.attributes : {};
}

function calculateScore(contact, gap, waitingMap, policy, inviteHistory) {
  const attrs = getAttrs(contact);
  const breakdown = {};
  let score = 0;

  const wait = waitingMap.get(String(contact.id));
  if (wait) {
    breakdown.waitingList = 55 + Math.min(Number(wait.priority || 0) / 4, 25);
    score += breakdown.waitingList;
    if (matchesPreferredTimeWindows(gap, wait.preferredTimeWindows)) {
      breakdown.waitingWindowFit = 15;
      score += 15;
    }
  }

  if (gap.settings?.preferredOwnerId && gap.ownerId && String(gap.settings.preferredOwnerId) === String(gap.ownerId)) {
    breakdown.policyOwnerFit = 8;
    score += 8;
  }

  const serviceType = gap.serviceType || gap.settings?.serviceType || null;
  if (serviceType && Array.isArray(attrs.preferredServices) && attrs.preferredServices.includes(serviceType)) {
    breakdown.serviceAffinity = 16;
    score += 16;
  }

  if (attrs.acceptsMarketing === false) {
    breakdown.marketingOptOut = -100;
    score -= 100;
  }

  const preferredOwnerId = attrs.preferredOwnerId || null;
  if (preferredOwnerId && gap.ownerId && String(preferredOwnerId) === String(gap.ownerId)) {
    breakdown.ownerAffinity = 10;
    score += 10;
  }

  if (matchesPreferredTimeWindows(gap, attrs.preferredTimeWindows || policy.settings?.preferredTimeWindows || [])) {
    breakdown.timeWindowFit = 12;
    score += 12;
  }

  const noShowRate = Number(attrs.noShowRate || 0);
  if (Number.isFinite(noShowRate) && noShowRate > 0) {
    breakdown.noShowRisk = -Math.min(noShowRate * 25, 25);
    score += breakdown.noShowRisk;
  }

  const responseRate = Number(attrs.responseRate || 0);
  if (Number.isFinite(responseRate) && responseRate > 0) {
    breakdown.responseRate = Math.min(responseRate * 20, 20);
    score += breakdown.responseRate;
  }

  const cooldownRaw = attrs.cooldownUntil || inviteHistory?.cooldownUntil || null;
  if (cooldownRaw) {
    const cooldown = new Date(cooldownRaw);
    if (!Number.isNaN(cooldown.getTime()) && cooldown.getTime() > Date.now()) {
      breakdown.cooldown = -1000;
      score -= 1000;
    }
  }

  if ((inviteHistory?.acceptedCount || 0) > 0) {
    breakdown.acceptHistory = 8;
    score += 8;
  }
  if ((inviteHistory?.rejectedCount || 0) > 0) {
    breakdown.rejectionHistory = -Math.min(inviteHistory.rejectedCount * 10, 30);
    score += breakdown.rejectionHistory;
  }
  if ((inviteHistory?.noResponseCount || 0) > 0) {
    breakdown.noResponseHistory = -Math.min(inviteHistory.noResponseCount * 8, 24);
    score += breakdown.noResponseHistory;
  }
  if ((inviteHistory?.last7d || 0) > 0) {
    breakdown.contactFatigue = -Math.min(inviteHistory.last7d * 4, 18);
    score += breakdown.contactFatigue;
  }

  return { score, breakdown };
}

async function getRecentInviteCounts(tenantId, contactIds) {
  if (!contactIds.length) return new Map();
  const rows = await AutonomousGapCandidate().findAll({
    where: {
      tenant_key: String(tenantId),
      contact_id: { [Op.in]: contactIds.map(String) },
      sent_at: { [Op.gte]: new Date(Date.now() - (7 * 24 * 3600 * 1000)) },
      invite_status: { [Op.in]: ['sent', 'accepted', 'rejected', 'expired', 'cooldown'] },
    },
    attributes: ['contact_id', 'sent_at', 'invite_status', 'cooldown_until'],
  });
  const out = new Map();
  for (const row of rows) {
    const json = getJson(row);
    const id = String(json.contact_id);
    const entry = out.get(id) || {
      last7d: 0,
      last1d: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      noResponseCount: 0,
      cooldownUntil: null,
    };
    entry.last7d += 1;
    if (json.sent_at && new Date(json.sent_at).getTime() >= Date.now() - (24 * 3600 * 1000)) entry.last1d += 1;
    if (json.invite_status === 'accepted') entry.acceptedCount += 1;
    if (json.invite_status === 'rejected') entry.rejectedCount += 1;
    if (json.invite_status === 'expired') entry.noResponseCount += 1;
    if (json.cooldown_until && (!entry.cooldownUntil || new Date(json.cooldown_until).getTime() > new Date(entry.cooldownUntil).getTime())) {
      entry.cooldownUntil = json.cooldown_until;
    }
    out.set(id, entry);
  }
  return out;
}

async function rankCandidatesForGap({ tenantId, gap }) {
  const policy = resolvePolicy(await getPolicy(tenantId));
  const runtimeGap = { ...gap, serviceType: gap.serviceType || policy.settings?.serviceType || null, settings: policy.settings };
  const waiting = await listEligibleWaitingEntries({ tenantId, serviceType: gap.serviceType, ownerId: gap.ownerId, teamId: gap.teamId });
  const waitingMap = new Map((waiting.items || []).map((item) => [String(item.contactId), item]));

  const contacts = await CrmContact().findAll({
    where: {
      tenant_key: String(tenantId),
      status: 'active',
      phone: { [Op.ne]: null },
    },
    limit: waitingMap.size > 0 ? 250 : 180,
    order: [['created_at', 'DESC']],
  });

  const contactIds = contacts.map((c) => String(c.id));
  const inviteCounts = await getRecentInviteCounts(tenantId, contactIds);

  const ranked = [];
  for (const row of contacts) {
    const contact = getJson(row);
    const counts = inviteCounts.get(String(contact.id)) || { last7d: 0, last1d: 0 };
    if (counts.last1d >= policy.maxInvitesPerContactDay) continue;
    if (counts.last7d >= policy.maxInvitesPerContactWeek) continue;

    const { score, breakdown } = calculateScore(contact, runtimeGap, waitingMap, policy, counts);
    if (score <= 0) continue;
    ranked.push({
      contactId: String(contact.id),
      score,
      scoreBreakdown: breakdown,
      source: waitingMap.has(String(contact.id)) ? 'waiting_list' : 'crm_ranked',
      contact,
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return { ok: true, items: ranked.slice(0, policy.maxInvitesPerCampaign) };
}

module.exports = { rankCandidatesForGap };
