'use strict';

/**
 * qa/stability/index.js
 *
 * Fachada pública para o subsistema de estabilidade.
 * A implementação real está em qa/mesh/intelligence/stabilityEngine.js.
 *
 * Este arquivo centraliza o ponto de entrada canônico do Stability.
 */

const { generateStabilitySnapshot } = require('../mesh/intelligence/stabilityEngine');
const { loadStabilityHistory } = require('../mesh/intelligence/stabilityHistory');

module.exports = {
  generateStabilitySnapshot,
  loadStabilityHistory,
};
