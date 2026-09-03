'use strict';

const fs = require('fs');

const { learnPath } = require('./paths');

const OUTPUT_PATH = learnPath('patchExecutions.json');

function executePatchPlans(fixPlans, mode = process.env.RAP_LEARN_MODE || 'suggestion-only') {
  const executions = (fixPlans.plans || []).map((plan) => {
    const executionMode = mode === 'promote-conditional' ? 'patch-controlled' : mode;
    return {
      failureSignature: plan.failureSignature,
      mode: executionMode,
      status: executionMode === 'suggestion-only' ? 'suggested' : 'patched-dry-run',
      applied: false,
      dryRun: executionMode !== 'suggestion-only',
      targets: plan.proposedFix.targets,
      actions: plan.proposedFix.actions,
      createdAt: new Date().toISOString(),
      notes: executionMode === 'suggestion-only'
        ? 'Nenhuma alteracao automatica aplicada; plano somente sugestao.'
        : 'Dry-run gerado. Promocao automatica permanece bloqueada por feature flag.',
    };
  });

  const output = {
    generatedAt: new Date().toISOString(),
    mode,
    totalExecutions: executions.length,
    executions,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  return output;
}

module.exports = {
  executePatchPlans,
  OUTPUT_PATH,
};
