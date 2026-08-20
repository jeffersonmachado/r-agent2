'use strict';

/**
 * Required Journeys — fonte canônica ÚNICA das jornadas/verticais requeridas
 * para cobertura de replay e prod-like.
 *
 * Consumidores obrigatórios:
 *   - tools/system/platform-readiness.js
 *   - governance/proof-engine (replay/prod-like coverage)
 *
 * Nunca duplicar estas listas em outro módulo: mudança de jornada requerida
 * acontece AQUI e propaga para readiness e proof engine ao mesmo tempo.
 */

const PROD_LIKE_JOURNEY_VERTICAL = Object.freeze({
  support_ticket_flow: 'services',
  fitness_customer_checkin: 'fitness',
  booking_flow: 'services',
  payment_charge_flow: 'fitness',
  food_order_status_flow: 'food',
  market_node_publish_flow: 'market',
  clinic_calendar_block_flow: 'clinic',
});

/** Jornadas prod-like obrigatórias no replay coverage. */
const REQUIRED_REPLAY_JOURNEYS = Object.freeze(Object.keys(PROD_LIKE_JOURNEY_VERTICAL));

/** Verticais obrigatórias na cobertura prod-like. */
const REQUIRED_VERTICALS = Object.freeze(['beauty', 'fitness', 'food', 'services', 'clinic', 'market']);

module.exports = {
  PROD_LIKE_JOURNEY_VERTICAL,
  REQUIRED_REPLAY_JOURNEYS,
  REQUIRED_VERTICALS,
};
