'use strict';

function decidePromotion({ plan, validation, stabilityBefore, stabilityAfter, releaseGateHealthy }) {
  const checks = {
    failureResolved: !!validation?.failureResolved,
    criticalTestsPassed: !!validation?.criticalTestsPassed,
    criticalReplayPassed: !!validation?.criticalReplayPassed,
    stabilityNotDegraded: Number(stabilityAfter || 0) >= Number(stabilityBefore || 0),
    releaseGateHealthy: !!releaseGateHealthy,
  };

  const approved = Object.values(checks).every(Boolean);

  return {
    failureSignature: plan.failureSignature,
    approved,
    checks,
    decision: approved ? 'promoted' : 'rejected',
    reason: approved
      ? 'Todos os gates obrigatorios passaram.'
      : 'Promocao negada: ao menos um gate obrigatorio falhou.',
  };
}

module.exports = {
  decidePromotion,
};
