'use strict';

const {
  mapNotificationDeliveryItems,
  mapLedgerNotificationItems,
  mapJourneyProxyNotificationItems,
  filterAndSortNotificationItems,
  summarizeNotificationItems,
} = require('./operationsDashboardNotifications');

/**
 * Executes notifications query flow and assembles API payload.
 *
 * @param {{tenantId: string, selectedVertical: string, selectedStatus: string|null, selectedChannel: string|null, safePage: number, safeLimit: number, period: {startDate: Date, endDate: Date}}} params
 * @param {{dbAvailable: Function, Op: Object, models: {NotificationDelivery: Function, EventLedger: Function, VerticalJourneyEvent: Function}, applyPagination: Function, helpers: Object}} deps
 * @returns {Promise<Object>}
 */
async function listDashboardNotifications(params, deps) {
  const {
    tenantId,
    selectedVertical,
    selectedStatus,
    selectedChannel,
    safePage,
    safeLimit,
    period,
  } = params;

  const {
    dbAvailable,
    Op,
    models,
    applyPagination,
    helpers,
  } = deps;

  const { NotificationDelivery, EventLedger, VerticalJourneyEvent } = models;

  if (!dbAvailable()) {
    return {
      tenantId,
      vertical: selectedVertical,
      period,
      summary: null,
      items: [],
      pagination: { page: safePage, limit: safeLimit, total: 0, totalPages: 1 },
      meta: { warnings: ['db_unavailable'] },
    };
  }

  const notificationRows = typeof NotificationDelivery === 'function'
    ? await NotificationDelivery().findAll({
      where: {
        tenant_key: tenantId,
        created_at: { [Op.between]: [period.startDate, period.endDate] },
      },
      order: [['created_at', 'DESC']],
      limit: 6000,
    }).catch(() => [])
    : [];

  let items = mapNotificationDeliveryItems(notificationRows, helpers);
  const warnings = [];

  if (!items.length) {
    warnings.push('notification_deliveries_not_found_using_legacy_sources');
    const ledgerRows = await EventLedger().findAll({
      where: {
        tenant_key: tenantId,
        type: 'VerticalJourney_Custom',
        source: { [Op.like]: 'vertical.notification.%' },
        occurred_at: { [Op.between]: [period.startDate, period.endDate] },
      },
      order: [['occurred_at', 'DESC']],
      limit: 6000,
    }).catch(() => []);

    items = mapLedgerNotificationItems(ledgerRows, helpers);
  }

  if (!items.length) {
    warnings.push('notification_delivery_events_not_found_using_journey_proxy');
    const proxyRows = await VerticalJourneyEvent().findAll({
      where: {
        tenant_key: tenantId,
        occurred_at: { [Op.between]: [period.startDate, period.endDate] },
        channel: { [Op.ne]: null },
      },
      order: [['occurred_at', 'DESC']],
      limit: 6000,
    }).catch(() => []);

    items = mapJourneyProxyNotificationItems(proxyRows, helpers);
  }

  items = filterAndSortNotificationItems(items, { selectedVertical, selectedStatus, selectedChannel });
  const summary = summarizeNotificationItems(items);
  const paged = applyPagination(items, { page: safePage, limit: safeLimit });

  return {
    tenantId,
    vertical: selectedVertical,
    period,
    summary,
    items: paged.items,
    pagination: paged.pagination,
    meta: {
      warnings,
      dataSource: items.some((item) => item.origin === 'notification_deliveries')
        ? 'notification_deliveries'
        : warnings.includes('notification_delivery_events_not_found_using_journey_proxy')
          ? 'vertical_journey_proxy'
          : 'event_ledger_notification_delivery',
    },
  };
}

module.exports = {
  listDashboardNotifications,
};
