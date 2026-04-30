'use strict';

const OperationalGateService = require('../../api/services/qa/OperationalGateService');
const ValidationSandboxService = require('../../api/services/qa/ValidationSandboxService');
const AutoCorrectionDecisionService = require('../../api/services/qa/AutoCorrectionDecisionService');

describe('QA Operational Gate and Auto-Adaptation', () => {
  describe('OperationalGateService', () => {
    let service;

    beforeEach(() => {
      service = new OperationalGateService({ logger: { log: jest.fn(), warn: jest.fn() } });
    });

    test('GO decision → FULL mode permitido', () => {
      const governance = { decision: 'GO', reason: 'All checks passed', severity: 'low' };
      const result = service.evaluateOperationalGate(governance);

      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('FULL');
      expect(result.decision).toBe('GO');
      expect(result.operationalRestrictions.block_mass_send).toBe(false);
      expect(result.operationalRestrictions.block_rpa_autonomous).toBe(false);
    });

    test('GO_WITH_WARNINGS decision → MONITORING mode', () => {
      const governance = { decision: 'GO_WITH_WARNINGS', reason: 'Medium severity checks failed', severity: 'medium' };
      const result = service.evaluateOperationalGate(governance);

      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('MONITORING');
      expect(result.operationalRestrictions.extra_logging).toBe(true);
    });

    test('REVIEW decision → LIMITED mode', () => {
      const governance = { decision: 'REVIEW', reason: 'High severity review required', severity: 'high' };
      const result = service.evaluateOperationalGate(governance);

      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('LIMITED');
      expect(result.operationalRestrictions.block_mass_send).toBe(true);
      expect(result.operationalRestrictions.block_automation).toBe(true);
      expect(result.operationalRestrictions.require_approval).toBe(true);
    });

    test('NO_GO decision → BLOCKED mode', () => {
      const governance = { decision: 'NO_GO', reason: 'Critical checks failed', severity: 'critical' };
      const result = service.evaluateOperationalGate(governance);

      expect(result.allowed).toBe(false);
      expect(result.mode).toBe('BLOCKED');
      expect(result.operationalRestrictions.read_only).toBe(true);
      expect(result.operationalRestrictions.block_outbound).toBe(true);
    });

    test('sem governance → fallback para MONITORING', () => {
      const result = service.evaluateOperationalGate({});

      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('MONITORING');
    });

    test('verifica operação permitida em cada modo', () => {
      const fullGate = { mode: 'FULL', allowed: true };
      expect(service.isOperationAllowed('mass_send', fullGate).allowed).toBe(true);
      expect(service.isOperationAllowed('rpa_autonomous', fullGate).allowed).toBe(true);

      const limitedGate = { mode: 'LIMITED', allowed: true };
      expect(service.isOperationAllowed('mass_send', limitedGate).allowed).toBe(false);
      expect(service.isOperationAllowed('read', limitedGate).allowed).toBe(true);

      const blockedGate = { mode: 'BLOCKED', allowed: false };
      expect(service.isOperationAllowed('outbound_call', blockedGate).allowed).toBe(false);
      expect(service.isOperationAllowed('read', blockedGate).allowed).toBe(true);
    });

    test('getStatusMessage produz mensagem legível', () => {
      const gateResponse = { allowed: true, mode: 'FULL', reason: 'All systems operational' };
      const msg = service.getStatusMessage(gateResponse);

      expect(msg).toContain('✅');
      expect(msg).toContain('FULL');
    });
  });

  describe('ValidationSandboxService', () => {
    let service;

    beforeEach(() => {
      service = new ValidationSandboxService({ logger: { log: jest.fn(), warn: jest.fn() } });
    });

    test('cria sandbox isolado com ID único', () => {
      const result = service.createSandbox({
        tenantId: 'tenant-1',
        sourceRunId: 'run-123',
      });

      expect(result.sandboxId).toBeTruthy();
      expect(result.tenantId).toContain(':');
      expect(result.status).toBe('active');
      expect(result.createdAt).toBeTruthy();
    });

    test('lança erro se tenantId não fornecido', () => {
      expect(() => service.createSandbox({})).toThrow('tenantId is required');
    });

    test('aplica patch no sandbox', () => {
      const sandbox = service.createSandbox({ tenantId: 'tenant-1', sourceRunId: 'run-1' });
      const patch = { patchSummary: 'Fix API timeout', filesToChange: ['api.js'] };

      const result = service.applyPatchInSandbox(sandbox.sandboxId, patch);

      expect(result.applied).toBe(true);
      expect(result.patchHash).toBeTruthy();
      expect(result.sandboxId).toBe(sandbox.sandboxId);
    });

    test('lança erro ao aplicar patch em sandbox inexistente', () => {
      expect(() => service.applyPatchInSandbox('nonexistent', {})).toThrow('Sandbox not found');
    });

    test('registra resultado de QA no sandbox', () => {
      const sandbox = service.createSandbox({ tenantId: 'tenant-1' });
      const qaResult = { governance: { decision: 'GO', reason: 'All checks passed' }, status: 'passed' };

      const result = service.recordQAResult(sandbox.sandboxId, qaResult);

      expect(result.qaRecorded).toBe(true);
      expect(result.decision).toBe('GO');
    });

    test('retorna status do sandbox', () => {
      const sandbox = service.createSandbox({ tenantId: 'tenant-1' });
      const status = service.getSandboxStatus(sandbox.sandboxId);

      expect(status.found).toBe(true);
      expect(status.status).toBe('active');
      expect(status.patchesApplied).toBe(0);
      expect(status.hasQAResult).toBe(false);
    });

    test('destroi sandbox e limpa memória', () => {
      const sandbox = service.createSandbox({ tenantId: 'tenant-1' });
      const result = service.destroySandbox(sandbox.sandboxId);

      expect(result.destroyed).toBe(true);
      expect(service.getSandboxStatus(sandbox.sandboxId).found).toBe(false);
    });

    test('retorna métricas de sandboxes', () => {
      service.createSandbox({ tenantId: 'tenant-1' });
      service.createSandbox({ tenantId: 'tenant-2' });

      const metrics = service.getSandboxMetrics();

      expect(metrics.total).toBe(2);
      expect(metrics.active).toBe(2);
    });
  });

  describe('AutoCorrectionDecisionService', () => {
    let service;

    beforeEach(() => {
      service = new AutoCorrectionDecisionService({ logger: { log: jest.fn(), warn: jest.fn() } });
    });

    test('aprova patch com confiança alta quando sandbox = GO', () => {
      const context = {
        diagnosis: { confidence: 0.9, risk: 'high' },
        proposedPatch: { patchSummary: 'Fix API timeout' },
        sandboxQAResult: { governance: { decision: 'GO', failedChecks: [] } },
      };

      const decision = service.evaluateApproval(context);

      expect(decision.approved).toBe(true);
      expect(decision.confidence).toBeGreaterThan(0.8);
      expect(decision.recommendation).toBe('safe_to_apply');
    });

    test('aprova com monitoramento quando sandbox = GO_WITH_WARNINGS', () => {
      const context = {
        diagnosis: { confidence: 0.85, risk: 'medium' },
        sandboxQAResult: { governance: { decision: 'GO_WITH_WARNINGS', failedChecks: ['insightCreated'] } },
      };

      const decision = service.evaluateApproval(context);

      expect(decision.approved).toBe(true);
      expect(decision.recommendation).toBe('approve_with_monitoring');
      expect(decision.risks).toContain('has_warnings');
    });

    test('condicional quando sandbox = REVIEW e alta confiança', () => {
      const context = {
        diagnosis: { confidence: 0.85, risk: 'medium' },
        sandboxQAResult: { governance: { decision: 'REVIEW', failedChecks: ['ticketLinked'] } },
      };

      const decision = service.evaluateApproval(context);

      expect(decision.approved).toBe(true);
      expect(decision.recommendation).toBe('approve_with_extra_monitoring');
    });

    test('rejeita quando sandbox = REVIEW e baixa confiança', () => {
      const context = {
        diagnosis: { confidence: 0.6, risk: 'high' },
        sandboxQAResult: { governance: { decision: 'REVIEW', failedChecks: [] } },
      };

      const decision = service.evaluateApproval(context);

      expect(decision.approved).toBe(false);
      expect(decision.recommendation).toBe('require_manual_review');
    });

    test('rejeita quando sandbox = NO_GO', () => {
      const context = {
        diagnosis: { confidence: 0.8, risk: 'critical' },
        sandboxQAResult: { governance: { decision: 'NO_GO', failedChecks: ['entityCreated'] } },
      };

      const decision = service.evaluateApproval(context);

      expect(decision.approved).toBe(false);
      expect(decision.confidence).toBe(0);
      expect(decision.recommendation).toBe('reject_and_rollback');
      expect(decision.risks).toContain('patch_made_problem_worse');
    });

    test('calcula confiança baseado em múltiplos fatores', () => {
      const context = {
        diagnosis: { confidence: 0.9 },
        sandboxQAResult: { governance: { decision: 'GO' } },
        patchComplexity: 'simple',
      };

      const score = service.calculateConfidenceScore(context);

      expect(score).toBeGreaterThan(0.8);
    });

    test('recomenda ações de risk mitigation', () => {
      const decision = { recommendation: 'approve_with_monitoring' };
      const actions = service.getRiskMitigationActions(decision);

      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('apply_with_monitoring');
    });

    test('getDecisionMessage produz mensagem legível', () => {
      const decision = { approved: true, confidence: 0.85, recommendation: 'safe_to_apply', reason: 'All checks passed' };
      const msg = service.getDecisionMessage(decision);

      expect(msg).toContain('✅');
      expect(msg).toContain('safe_to_apply');
      expect(msg).toContain('85%');
    });
  });
});
