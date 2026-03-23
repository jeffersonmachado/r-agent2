'use strict';

const { Op } = require('sequelize');

const {
  VerticalJourneyEvent,
  VerticalAttendance,
  AccessMembership,
} = require('../../db/models');
const { safeString } = require('./operationsDashboardHelpers');

async function collectBeautyCandidates({ tenantId, startDate, endDate, limit }) {
  const [journeyRows, attendanceRows, membershipRows] = await Promise.all([
    VerticalJourneyEvent().findAll({
      where: {
        tenant_key: tenantId,
        vertical: 'beauty',
        occurred_at: { [Op.between]: [startDate, endDate] },
      },
      attributes: ['subject_id', 'customer_id', 'membership_id'],
      limit: Math.max(limit * 5, 100),
      order: [['occurred_at', 'DESC']],
    }).catch(() => []),
    VerticalAttendance().findAll({
      where: {
        tenant_key: tenantId,
        vertical: 'beauty',
        checked_in_at: { [Op.between]: [startDate, endDate] },
      },
      attributes: ['subject_id', 'membership_id'],
      limit: Math.max(limit * 5, 100),
      order: [['checked_in_at', 'DESC']],
    }).catch(() => []),
    AccessMembership().findAll({
      where: {
        tenant_key: tenantId,
        vertical: 'beauty',
      },
      attributes: ['id', 'subject_id', 'customer_id', 'billing_status'],
      limit: Math.max(limit * 5, 100),
      order: [['updated_at', 'DESC']],
    }).catch(() => []),
  ]);

  const bySubject = {};

  for (const row of journeyRows) {
    const item = row.toJSON ? row.toJSON() : row;
    const subjectKey = safeString(item.subject_id || item.customer_id || '');
    if (!subjectKey || bySubject[subjectKey]) continue;
    bySubject[subjectKey] = {
      subjectId: item.subject_id || item.customer_id,
      customerId: item.customer_id || null,
      membershipId: item.membership_id || null,
      billingStatus: 'active',
    };
  }

  for (const row of attendanceRows) {
    const item = row.toJSON ? row.toJSON() : row;
    const subjectKey = safeString(item.subject_id || '');
    if (!subjectKey || bySubject[subjectKey]) continue;
    bySubject[subjectKey] = {
      subjectId: item.subject_id,
      customerId: null,
      membershipId: item.membership_id || null,
      billingStatus: 'active',
    };
  }

  for (const row of membershipRows) {
    const item = row.toJSON ? row.toJSON() : row;
    const subjectKey = safeString(item.subject_id || item.customer_id || '');
    if (!subjectKey || bySubject[subjectKey]) continue;
    bySubject[subjectKey] = {
      subjectId: item.subject_id || item.customer_id,
      customerId: item.customer_id || null,
      membershipId: item.id || null,
      billingStatus: item.billing_status || 'active',
    };
  }

  return Object.values(bySubject).slice(0, Math.max(limit * 2, 20));
}

async function collectFitnessCandidates({ tenantId, limit }) {
  const rows = await AccessMembership().findAll({
    where: {
      tenant_key: tenantId,
      vertical: 'fitness',
    },
    attributes: ['id', 'subject_id', 'customer_id', 'billing_status'],
    order: [['updated_at', 'DESC']],
    limit: Math.max(limit * 4, 100),
  }).catch(() => []);

  return rows
    .map((row) => (row.toJSON ? row.toJSON() : row))
    .map((item) => ({
      subjectId: item.subject_id,
      customerId: item.customer_id || null,
      membershipId: item.id,
      billingStatus: item.billing_status || 'active',
    }))
    .filter((item) => !!item.subjectId)
    .slice(0, Math.max(limit * 2, 20));
}

module.exports = {
  collectBeautyCandidates,
  collectFitnessCandidates,
};