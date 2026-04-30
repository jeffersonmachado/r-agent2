'use strict';

const { exec } = require('child_process');

function defaultRunner(command, cwd) {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: 120000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code ?? 0,
        stdout: stdout || '',
        stderr: stderr || '',
      });
    });
  });
}

class CorrectionValidationService {
  constructor(deps = {}) {
    this.logger = deps.logger || console;
    this.commandRunner = deps.commandRunner || defaultRunner;
    this.cwd = deps.cwd || process.cwd();
    this.enableCommandExecution = deps.enableCommandExecution ?? (process.env.RAP_AUTOCORRECTION_RUN_VALIDATION === 'true');
  }

  async runStep(command) {
    if (!this.enableCommandExecution) {
      return { command, status: 'suggested', output: 'Execucao automatica desabilitada; aguardar revisao humana.' };
    }

    const result = await this.commandRunner(command, this.cwd);
    return {
      command,
      status: result.ok ? 'passed' : 'failed',
      output: [result.stdout, result.stderr].filter(Boolean).join('\n').slice(0, 4000),
      code: result.code,
    };
  }

  async validateProposal({ proposal = {}, diagnosis = {}, sourceType = '', sourceId = '' } = {}) {
    const testsToRun = Array.isArray(proposal.testsToRun) ? proposal.testsToRun : [];
    const steps = [];

    for (const command of testsToRun) {
      // Execucao controlada: nunca aplica patch ou deploy.
      steps.push(await this.runStep(command));
    }

    const failed = steps.filter((step) => step.status === 'failed').length;
    const passed = steps.filter((step) => step.status === 'passed').length;
    const suggested = steps.filter((step) => step.status === 'suggested').length;
    const status = failed > 0
      ? 'failed'
      : suggested > 0
        ? 'pending_manual_execution'
        : 'passed';

    return {
      status,
      sourceType,
      sourceId,
      affectedModule: diagnosis.affectedModule || null,
      executedAt: new Date().toISOString(),
      summary: `Validacao controlada concluida: ${passed} passo(s) aprovados, ${failed} falhou/falharam, ${suggested} pendente(s).`,
      steps,
      safety: {
        patchApplied: false,
        deployExecuted: false,
        humanApprovalRequired: true,
      },
    };
  }
}

module.exports = CorrectionValidationService;