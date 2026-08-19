'use strict';

/**
 * Política canônica de falha de step RPA.
 *
 * `critical: false` marca o step como soft (ex.: wait de toast efêmero cuja
 * prova durável fica em asserts/landmarks subsequentes). Falha em step soft é
 * evidência (warning em `results.warnings`) e nunca derruba a execução;
 * falha em step crítico é erro fatal: marca `results.success = false`, entra
 * em `results.errors` e o caller deve interromper o playback.
 *
 * Antes desta política, `critical: false` apenas evitava o `break` do loop,
 * mas a falha ainda ia para `results.errors` e marcava a execução inteira
 * como falha — o que derrubava cenários de QA mesh para `infra_error` quando
 * um toast efêmero não aparecia sob contenção de recursos.
 */
function isCriticalStep(step) {
  return !step || step.critical !== false;
}

function recordStepFailure(results, { step, stepNumber, error, debug = null }) {
  const entry = {
    step: stepNumber,
    action: step && step.type,
    error,
  };
  if (debug) entry.debug = debug;

  if (isCriticalStep(step)) {
    results.success = false;
    results.errors.push(entry);
    return { critical: true, entry };
  }

  results.warnings = results.warnings || [];
  const warning = { ...entry, severity: 'non_critical_step_failure' };
  results.warnings.push(warning);
  return { critical: false, entry: warning };
}

module.exports = {
  isCriticalStep,
  recordStepFailure,
};
