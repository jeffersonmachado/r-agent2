const repository = require('./accessControlRepository');
const { listSchedules } = require('../../services/scheduleService');
const { MarketingLead } = require('../../db/models');

async function findCustomerReference({ tenantId, customerId }) {
  if (!customerId) return null;
  try {
    const Model = MarketingLead();
    const row = await Model.findOne({
      where: {
        tenant_key: tenantId,
        id: String(customerId),
      },
    });
    return row && row.toJSON ? row.toJSON() : row;
  } catch {
    return null;
  }
}

async function resolveSubjectContext({ tenantId, subjectId, customerId, membershipId, vertical = 'fitness' }) {
  let subject = null;
  if (subjectId) {
    subject = await repository.findSubject({ tenantId, where: { id: String(subjectId) } });
  }
  if (!subject && customerId) {
    subject = await repository.findSubject({ tenantId, where: { customer_id: String(customerId) } });
  }
  if (!subject && membershipId) {
    subject = await repository.findSubject({ tenantId, where: { membership_id: String(membershipId) } });
  }

  const membership = membershipId
    ? await repository.findMembership({ tenantId, where: { id: String(membershipId) } })
    : subject?.membership_id
      ? await repository.findMembership({ tenantId, where: { id: String(subject.membership_id) } })
      : subject?.id
        ? await repository.findMembership({ tenantId, where: { subject_id: String(subject.id) } })
        : null;

  const customer = await findCustomerReference({
    tenantId,
    customerId: customerId || subject?.customer_id || membership?.customer_id || null,
  });

  let activeSchedule = null;
  if (vertical === 'beauty') {
    const schedules = listSchedules({
      tenantId,
      contextType: 'beauty_access',
      contextId: customerId || subject?.customer_id || subject?.id,
      limit: 20,
    }).items || [];
    const now = Date.now();
    activeSchedule = schedules.find((schedule) => {
      const start = new Date(schedule.startAt).getTime();
      const end = new Date(schedule.endAt).getTime();
      return Number.isFinite(start) && Number.isFinite(end) && start <= now && end >= now && schedule.status !== 'cancelled';
    }) || null;
  }

  return {
    subject,
    membership,
    customer,
    activeSchedule,
  };
}

module.exports = {
  resolveSubjectContext,
};
