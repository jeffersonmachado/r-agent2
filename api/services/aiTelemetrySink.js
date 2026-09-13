'use strict';

/**
 * Sink de telemetria para o gate `validateGeneratedPlan` do `engine/`.
 *
 * O gate é puro por contrato: não pode importar `fs` nem a API. A gravação da
 * telemetria (que é I/O) mora aqui, na API, e é injetada pelo chamador via
 * `options.telemetry`.
 *
 * Uso:
 *   const aiTelemetrySink = require('../services/aiTelemetrySink');
 *   validateGeneratedPlanOrThrow(plan, 'chatbot', { telemetry: aiTelemetrySink });
 *
 * Sem injeção o gate permanece silencioso — a injeção é obrigatória nas rotas
 * que geram planos por IA para não perder o registro de falha.
 */

const { recordValidationFailure, logFailure, logSuccess } = require('./aiTelemetry');
const { recordAiGateFailure } = require('./qaTelemetry');

module.exports = {
  recordValidationFailure,
  recordAiGateFailure,
  logFailure,
  logSuccess,
};
