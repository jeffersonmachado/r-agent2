'use strict';

/**
 * qa/learn/index.js
 *
 * Fachada pública para o subsistema de aprendizado adaptativo.
 * A implementação real está em qa/mesh/intelligence/learning/.
 *
 * Este arquivo centraliza o ponto de entrada canônico do Learn.
 */

const learning = require('../mesh/intelligence/learning/index');

module.exports = learning;
