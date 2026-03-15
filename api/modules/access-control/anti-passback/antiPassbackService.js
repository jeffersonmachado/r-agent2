const repository = require('../accessControlRepository');
const { REASON_CODES } = require('../constants');

async function evaluateAntiPassback({ tenantId, subjectId, action, policy }) {
  const mode = policy?.anti_passback_mode || 'none';
  if (mode === 'none' || !subjectId) return { allowed: true };

  const recentEvents = await repository.listEvents({
    tenantId,
    where: { subject_id: String(subjectId) },
    order: [['occurred_at', 'DESC']],
    limit: 5,
  });
  const lastDirectional = recentEvents.find((event) => event.direction === 'in' || event.direction === 'out');
  if (!lastDirectional) return { allowed: true };

  if (action === 'enter' && lastDirectional.direction === 'in') {
    return { allowed: false, reasonCode: REASON_CODES.DENY_ANTI_PASSBACK, lastDirectional };
  }
  if (action === 'exit' && lastDirectional.direction === 'out') {
    return mode === 'soft'
      ? { allowed: true, lastDirectional }
      : { allowed: false, reasonCode: REASON_CODES.DENY_ANTI_PASSBACK, lastDirectional };
  }

  return { allowed: true, lastDirectional };
}

module.exports = {
  evaluateAntiPassback,
};
