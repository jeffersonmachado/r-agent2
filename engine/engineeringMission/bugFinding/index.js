'use strict';

/**
 * engine/engineeringMission/bugFinding/index.js — superfície pública do motor de bug finding.
 *
 * Módulo PURO (sem I/O). Consumido pelos serviços de `api/services/engineeringMission/` e pelo gate
 * `scripts/governance/validate-bug-autonomous-loop.js` — uma única implementação das regras, nunca
 * uma cópia para o gate.
 */

const constants = require('./constants');
const fingerprint = require('./fingerprint');
const classification = require('./classification');
const lifecycle = require('./lifecycle');
const reproductionPlan = require('./reproductionPlan');
const reproductionDerivation = require('./reproductionDerivation');
const selfModification = require('./selfModification');
const anomalyDetection = require('./anomalyDetection');
const routing = require('./routing');
const preventiveRules = require('./preventiveRules');

module.exports = {
  ...constants,
  ...fingerprint,
  ...classification,
  ...lifecycle,
  ...reproductionPlan,
  ...reproductionDerivation,
  ...selfModification,
  ...anomalyDetection,
  ...routing,
  ...preventiveRules,
};
