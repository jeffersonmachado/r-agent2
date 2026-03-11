'use strict';

/**
 * Verticals Registry
 * 
 * Centraliza acesso a todos os adapters operacionais por vertical.
 * 
 * Cada vertical especializa o ServiceOperationsKernel sem duplicação.
 */

const { BakeryOperationsAdapter, BAKERY_EVENTS, BAKERY_DECISION_POLICIES, BAKERY_KPI_SET } = require('./bakery');
const { PizzeriaOperationsAdapter, PIZZERIA_EVENTS, PIZZERIA_DECISION_POLICIES, PIZZERIA_KPI_SET } = require('./pizzeria');
const { ClinicOperationsAdapter, CLINIC_EVENTS, CLINIC_DECISION_POLICIES, CLINIC_KPI_SET } = require('./clinic');
const { MarketOperationsAdapter, MARKET_EVENTS, MARKET_DECISION_POLICIES, MARKET_KPI_SET } = require('./market');

const VERTICAL_ADAPTERS = Object.freeze({
  bakery: BakeryOperationsAdapter,
  pizzeria: PizzeriaOperationsAdapter,
  clinic: ClinicOperationsAdapter,
  market: MarketOperationsAdapter,
});

const VERTICAL_EVENTS = Object.freeze({
  bakery: BAKERY_EVENTS,
  pizzeria: PIZZERIA_EVENTS,
  clinic: CLINIC_EVENTS,
  market: MARKET_EVENTS,
});

const VERTICAL_POLICIES = Object.freeze({
  bakery: BAKERY_DECISION_POLICIES,
  pizzeria: PIZZERIA_DECISION_POLICIES,
  clinic: CLINIC_DECISION_POLICIES,
  market: MARKET_DECISION_POLICIES,
});

const VERTICAL_KPIS = Object.freeze({
  bakery: BAKERY_KPI_SET,
  pizzeria: PIZZERIA_KPI_SET,
  clinic: CLINIC_KPI_SET,
  market: MARKET_KPI_SET,
});

/**
 * Factory para criar adapter de vertical
 */
function createVerticalAdapter(verticalName, kernel) {
  const AdapterClass = VERTICAL_ADAPTERS[verticalName];
  if (!AdapterClass) {
    throw new Error(`Unknown vertical: ${verticalName}. Supported: bakery, pizzeria, clinic, market`);
  }
  return new AdapterClass(kernel);
}

module.exports = {
  // Adapters
  BakeryOperationsAdapter,
  PizzeriaOperationsAdapter,
  ClinicOperationsAdapter,
  MarketOperationsAdapter,

  // Events
  BAKERY_EVENTS,
  PIZZERIA_EVENTS,
  CLINIC_EVENTS,
  MARKET_EVENTS,

  // Policies
  BAKERY_DECISION_POLICIES,
  PIZZERIA_DECISION_POLICIES,
  CLINIC_DECISION_POLICIES,
  MARKET_DECISION_POLICIES,

  // KPIs
  BAKERY_KPI_SET,
  PIZZERIA_KPI_SET,
  CLINIC_KPI_SET,
  MARKET_KPI_SET,

  // Registries
  VERTICAL_ADAPTERS,
  VERTICAL_EVENTS,
  VERTICAL_POLICIES,
  VERTICAL_KPIS,

  // Factory
  createVerticalAdapter,
};
