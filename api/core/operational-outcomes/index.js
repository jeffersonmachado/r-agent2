'use strict';

const logger = require('../../utils/logger');
const { OutcomeClassifier } = require('./OutcomeClassifier');
const { OutcomeAttributionService } = require('./OutcomeAttributionService');
const { OperationalOutcomeEngine } = require('./OperationalOutcomeEngine');

const outcomeClassifier = new OutcomeClassifier();
const outcomeAttributionService = new OutcomeAttributionService();
const operationalOutcomeEngine = new OperationalOutcomeEngine({
  outcomeClassifier,
  outcomeAttributionService,
});

let observerUnsubscribe = null;

function setupOperationalOutcomeObserver({ eventBus } = {}) {
  if (!eventBus || typeof eventBus.on !== 'function') {
    return { ok: false, error: 'event_bus_unavailable' };
  }

  if (observerUnsubscribe) {
    return { ok: true, attached: true, reused: true };
  }

  observerUnsubscribe = eventBus.on('operational:event', async (eventEnvelope = {}) => {
    try {
      await operationalOutcomeEngine.recordFromEvent(eventEnvelope);
    } catch (err) {
      logger.debug('[OperationalOutcomeEngine] Falha no observer de eventos (ignorado)', {
        error: err?.message || String(err || 'unknown_error'),
        type: eventEnvelope?.type || null,
        tenantId: eventEnvelope?.tenantId || null,
      });
    }
  });

  return { ok: true, attached: true, reused: false };
}

module.exports = {
  OutcomeClassifier,
  OutcomeAttributionService,
  OperationalOutcomeEngine,
  outcomeClassifier,
  outcomeAttributionService,
  operationalOutcomeEngine,
  setupOperationalOutcomeObserver,
};
