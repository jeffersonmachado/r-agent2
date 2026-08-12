'use strict';

/**
 * Cognitive Entry Policy — estratégia explícita de entrada do fluxo operacional.
 *
 *   Inbound Channel/Event → Operational Event → Cognitive Entry Policy →
 *     DETERMINISTIC_FLOW | COGNITIVE | DURABLE_PROCESS | HUMAN
 *
 * Flows determinísticos existentes continuam válidos e são o caminho padrão.
 * O Cognitive Core decide/coordena quando aplicável (configuração por tenant).
 * Nenhuma mensagem é passada cegamente para a LLM: a decisão de path é
 * registrada (reason auditável) e a configuração do tenant é a autoridade.
 */

const PATHS = Object.freeze({
  DETERMINISTIC_FLOW: 'DETERMINISTIC_FLOW',
  COGNITIVE: 'COGNITIVE',
  DURABLE_PROCESS: 'DURABLE_PROCESS',
  HUMAN: 'HUMAN',
});

/**
 * @param {object} args
 * @param {boolean} args.hasDeterministicFlow  existe flow padrão utilizável
 * @param {object}  [args.cognitiveConfig]     config.cognitive do tenant:
 *   { enabled: boolean, mode: 'fallback'|'preferred' }
 *   - fallback (default): flow determinístico primeiro; cognitivo quando não há flow
 *   - preferred: cognitivo primeiro; flow permanece para intents não cognitivos
 * @param {object}  [args.payload]             evento estruturado (durable hints)
 * @param {string} [args.message]
 * @returns {{ path: string, reason: string }}
 */
function decideEntryPath({ hasDeterministicFlow, cognitiveConfig = null, payload = {}, message = null } = {}) {
  const config = cognitiveConfig || {};
  const enabled = config.enabled === true;
  const mode = config.mode === 'preferred' ? 'preferred' : 'fallback';

  // Hints explícitos de processo durável (waiting/timer/evento externo).
  const wantsDurable = payload.durable === true || !!payload.waitForEvent || !!payload.waitTimerMs;

  if (!enabled) {
    if (!hasDeterministicFlow) {
      return { path: PATHS.HUMAN, reason: 'cognitive_disabled_no_flow' };
    }
    return { path: PATHS.DETERMINISTIC_FLOW, reason: 'cognitive_disabled' };
  }

  if (wantsDurable) {
    return { path: PATHS.DURABLE_PROCESS, reason: 'explicit_durable_hints' };
  }

  if (mode === 'preferred') {
    return { path: PATHS.COGNITIVE, reason: 'tenant_mode_preferred' };
  }

  // fallback (default): flow determinístico continua sendo o caminho quando existe.
  if (hasDeterministicFlow) {
    return { path: PATHS.DETERMINISTIC_FLOW, reason: 'deterministic_flow_available' };
  }

  if (message || payload.eventType) {
    return { path: PATHS.COGNITIVE, reason: 'no_deterministic_flow_cognitive_enabled' };
  }

  return { path: PATHS.HUMAN, reason: 'no_flow_no_message' };
}

module.exports = { decideEntryPath, PATHS };
