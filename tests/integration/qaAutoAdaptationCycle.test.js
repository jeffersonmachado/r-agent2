'use strict';

const OperationalGateService = require('../../api/services/qa/OperationalGateService');
const ValidationSandboxService = require('../../api/services/qa/ValidationSandboxService');
const AutoCorrectionDecisionService = require('../../api/services/qa/AutoCorrectionDecisionService');

describe('QA Auto-Adaptation Cycle', () => {
  let gateService;
  let sandboxService;
  let decisionService;

  beforeEach(() => {
    gateService = new OperationalGateService({ logger: { log: jest.fn(), warn: jest.fn() } });
    sandboxService = new ValidationSandboxService({ logger: { log: jest.fn(), warn: jest.fn() } });
    decisionService = new AutoCorrectionDecisionService({ logger: { log: jest.fn(), warn: jest.fn() } });
  });

  test('ciclo completo: falha → diagnóstico → patch → sandbox → validação → aprovação', async () => {
    // 1. Sistema detecta falha → governance retorna REVIEW
    const failureGovernance = {
      decision: 'REVIEW',
      reason: 'High severity checks failed',
      severity: 'high',
      failedChecks: ['ticketLinked'],
    };

    const gateResponse = gateService.evaluateOperationalGate(failureGovernance);
    expect(gateResponse.mode).toBe('LIMITED');
    expect(gateResponse.allowed).toBe(true);

    // 2. AutoCorrection cria diagnóstico
    const diagnosis = {
      affectedModule: 'workspace',
      rootCause: 'Ticket linking failed due to API timeout',
      confidence: 0.85,
      risk: 'high',
      analyzedArtifacts: {},
    };

    // 3. Propõe patch
    const proposedPatch = {
      patchSummary: 'Increase API timeout and add retry logic',
      filesToChange: ['services/ticketService.js'],
    };

    // 4. Cria sandbox para validação
    const sandbox = sandboxService.createSandbox({
      tenantId: 'tenant-1',
      sourceRunId: 'run-123',
      originalContext: { ticketTimeout: 5000 },
    });

    expect(sandbox.sandboxId).toBeTruthy();
    expect(sandbox.status).toBe('active');

    // 5. Aplica patch no sandbox
    const patchApplication = sandboxService.applyPatchInSandbox(sandbox.sandboxId, proposedPatch);
    expect(patchApplication.applied).toBe(true);

    // 6. Roda QA no sandbox
    const sandboxQAResult = {
      governance: {
        decision: 'GO',
        reason: 'All checks passed in sandbox',
        severity: 'low',
        failedChecks: [],
      },
      status: 'passed',
    };

    sandboxService.recordQAResult(sandbox.sandboxId, sandboxQAResult);

    // 7. AutoCorrection Decision Engine avalia
    const approvalDecision = decisionService.evaluateApproval({
      diagnosis,
      proposedPatch,
      sandboxQAResult,
    });

    expect(approvalDecision.approved).toBe(true);
    expect(approvalDecision.confidence).toBeGreaterThan(0.8);
    expect(approvalDecision.recommendation).toBe('safe_to_apply');

    // 8. Se aprovado, obtém ações de mitigação
    const actions = decisionService.getRiskMitigationActions(approvalDecision);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('apply_immediately');

    // 9. Limpa sandbox
    const cleanup = sandboxService.destroySandbox(sandbox.sandboxId);
    expect(cleanup.destroyed).toBe(true);
  });

  test('ciclo com falha: patch piora situação → rejeição', () => {
    // 1. Diagnóstico
    const diagnosis = {
      affectedModule: 'workspace',
      rootCause: 'API timeout',
      confidence: 0.7,
      risk: 'high',
    };

    // 2. Patch proposto
    const proposedPatch = {
      patchSummary: 'Modify timeout behavior',
      filesToChange: ['services/api.js'],
    };

    // 3. Sandbox QA falha (patch piorou situação)
    const sandboxQAResult = {
      governance: {
        decision: 'NO_GO',
        reason: 'Patch made problem worse',
        severity: 'critical',
        failedChecks: ['entityCreated', 'timelineConsistent'],
      },
    };

    // 4. Decision engine rejeita
    const decision = decisionService.evaluateApproval({
      diagnosis,
      proposedPatch,
      sandboxQAResult,
    });

    expect(decision.approved).toBe(false);
    expect(decision.confidence).toBe(0);
    expect(decision.recommendation).toBe('reject_and_rollback');
    expect(decision.risks).toContain('patch_made_problem_worse');

    // 5. Recomenda ações
    const actions = decisionService.getRiskMitigationActions(decision);
    expect(actions.some((a) => a.type === 'reject_patch')).toBe(true);
  });

  test('ciclo com WARNING: patch melhora, mas com warnings → aprovação condicional', () => {
    const diagnosis = {
      affectedModule: 'workspace',
      rootCause: 'Transaction isolation issue',
      confidence: 0.9,
      risk: 'high',
    };

    const proposedPatch = {
      patchSummary: 'Add transaction lock with timeout',
      filesToChange: ['db/transaction.js'],
    };

    const sandboxQAResult = {
      governance: {
        decision: 'GO_WITH_WARNINGS',
        reason: 'Core functionality works but some edge cases have warnings',
        severity: 'medium',
        failedChecks: ['insightCreated'],
      },
    };

    const decision = decisionService.evaluateApproval({
      diagnosis,
      proposedPatch,
      sandboxQAResult,
    });

    expect(decision.approved).toBe(true);
    expect(decision.confidence).toBeGreaterThan(0.8);
    expect(decision.recommendation).toBe('approve_with_monitoring');
    expect(decision.risks).toContain('has_warnings');
  });

  test('operação bloqueada → sandbox isolado, modo FULL recuperado → liberada', () => {
    // Cenário: Sistema estava bloqueado (NO_GO)
    let currentGovernance = {
      decision: 'NO_GO',
      reason: 'Critical failure',
      severity: 'critical',
      failedChecks: ['entityCreated'],
    };

    let gateResponse = gateService.evaluateOperationalGate(currentGovernance);
    expect(gateResponse.mode).toBe('BLOCKED');
    expect(gateResponse.allowed).toBe(false);

    // AutoCorrection detecta problema e propõe fix
    // Cria sandbox, aplica patch, QA passa
    const sandbox = sandboxService.createSandbox({
      tenantId: 'tenant-1',
      sourceRunId: 'run-critical-fix',
    });

    const patch = { patchSummary: 'Fix entity creation', filesToChange: ['models/Entity.js'] };
    sandboxService.applyPatchInSandbox(sandbox.sandboxId, patch);

    const sandboxResult = {
      governance: { decision: 'GO', reason: 'Fixed', severity: 'low', failedChecks: [] },
    };
    sandboxService.recordQAResult(sandbox.sandboxId, sandboxResult);

    // Decision aprova
    const decision = decisionService.evaluateApproval({
      diagnosis: { confidence: 0.9, risk: 'critical' },
      proposedPatch: patch,
      sandboxQAResult: sandboxResult,
    });

    expect(decision.approved).toBe(true);

    // Após aplicar patch, governança muda para GO
    currentGovernance = { decision: 'GO', reason: 'Fixed and verified', severity: 'low', failedChecks: [] };
    gateResponse = gateService.evaluateOperationalGate(currentGovernance);
    expect(gateResponse.mode).toBe('FULL');
    expect(gateResponse.allowed).toBe(true);

    sandboxService.destroySandbox(sandbox.sandboxId);
  });

  test('monitoramento de sandboxes: múltiplas correções em paralelo', () => {
    const runIds = ['run-1', 'run-2', 'run-3'];

    // Cria múltiplos sandboxes
    const sandboxes = runIds.map((id) =>
      sandboxService.createSandbox({
        tenantId: 'tenant-1',
        sourceRunId: id,
      })
    );

    expect(sandboxes).toHaveLength(3);
    sandboxes.forEach((s) => expect(s.status).toBe('active'));

    // Aplica patches em cada
    sandboxes.forEach((s, idx) => {
      sandboxService.applyPatchInSandbox(s.sandboxId, {
        patchSummary: `Patch ${idx}`,
        filesToChange: [`file-${idx}.js`],
      });
    });

    // Verifica métricas
    const metrics = sandboxService.getSandboxMetrics();
    expect(metrics.total).toBe(3);
    expect(metrics.active).toBe(3);

    // Limpa um
    sandboxService.destroySandbox(sandboxes[0].sandboxId);
    const metricsAfter = sandboxService.getSandboxMetrics();
    expect(metricsAfter.total).toBe(2);
  });
});
