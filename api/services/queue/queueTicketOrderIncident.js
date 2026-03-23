'use strict';

const { safeToString } = require('../../utils/defensiveCoercion');

function extractOrderIncidentMetadata(ticket) {
  const kind = ticket?.context?.metadata?.kind || null;
  const orderId = ticket?.context?.metadata?.orderId || null;
  return {
    kind,
    orderId: orderId ? safeToString(orderId) : null,
  };
}

function closeOrderIncidentFromTicket(ticket) {
  try {
    const { kind, orderId } = extractOrderIncidentMetadata(ticket);
    if (kind !== 'order_incident' || !orderId || !ticket?.tenantId) {
      return;
    }

    const { getOrderIncident, setOrderIncident } = require('../orderService');
    getOrderIncident({ tenantId: ticket.tenantId, orderId })
      .then((existing) => {
        const base = existing && typeof existing === 'object' ? existing : {};
        return setOrderIncident({
          tenantId: ticket.tenantId,
          orderId,
          incident: {
            ...base,
            ticketId: ticket.id,
            status: 'closed',
            closedAt: new Date().toISOString(),
          },
        });
      })
      .catch(() => {});
  } catch (_) {}
}

module.exports = {
  closeOrderIncidentFromTicket,
};