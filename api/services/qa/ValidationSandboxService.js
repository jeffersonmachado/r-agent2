'use strict';

const crypto = require('crypto');

/**
 * ValidationSandboxService
 *
 * Cria e gerencia ambientes isolados para validar patches sem afetar produção.
 * Cada sandbox é um "espaço de execução" com dados isolados e contexto controlado.
 */
class ValidationSandboxService {
  constructor(deps = {}) {
    this.logger = deps.logger || console;
    this.sandboxes = new Map(); // id -> sandbox context
  }

  /**
   * Cria um novo sandbox isolado para validação.
   *
   * @param {Object} options
   * @param {string} options.tenantId - tenant isolado
   * @param {string} options.sourceRunId - ID do AutoCorrectionRun
   * @param {Object} options.originalContext - contexto original (para comparação)
   * @returns {Object} {sandboxId, tenantId, status, createdAt}
   */
  createSandbox(options = {}) {
    const { tenantId, sourceRunId, originalContext = {} } = options;

    if (!tenantId) {
      throw new Error('tenantId is required for sandbox creation');
    }

    const sandboxId = `sandbox_${sourceRunId || crypto.randomBytes(8).toString('hex')}_${Date.now()}`;
    const isolatedTenantId = `${tenantId}:${sandboxId}`;

    const sandbox = {
      id: sandboxId,
      tenantId,
      isolatedTenantId,
      sourceRunId,
      status: 'active',
      originalContext: JSON.parse(JSON.stringify(originalContext)),
      appliedPatches: [],
      qaResults: null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hora
    };

    this.sandboxes.set(sandboxId, sandbox);
    this.logger.log(`[Sandbox] Created: ${sandboxId} for tenant ${tenantId}`);

    return {
      sandboxId,
      tenantId: isolatedTenantId,
      status: sandbox.status,
      createdAt: sandbox.createdAt,
      expiresAt: sandbox.expiresAt,
    };
  }

  /**
   * Aplica um patch no sandbox.
   *
   * @param {string} sandboxId - ID do sandbox
   * @param {Object} patch - patch a aplicar
   * @returns {Object} {applied, sandboxId, patchHash}
   */
  applyPatchInSandbox(sandboxId, patch = {}) {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    if (sandbox.status !== 'active') {
      throw new Error(`Sandbox is not active: ${sandbox.status}`);
    }

    const patchHash = crypto.createHash('sha256').update(JSON.stringify(patch)).digest('hex');
    const patchRecord = {
      hash: patchHash,
      summary: patch.patchSummary || 'Unnamed patch',
      filesToChange: patch.filesToChange || [],
      appliedAt: new Date().toISOString(),
    };

    sandbox.appliedPatches.push(patchRecord);
    this.logger.log(`[Sandbox] Applied patch ${patchHash.substring(0, 8)} in ${sandboxId}`);

    return {
      applied: true,
      sandboxId,
      patchHash,
      appliedAt: patchRecord.appliedAt,
    };
  }

  /**
   * Registra resultados de QA Mesh executado no sandbox.
   *
   * @param {string} sandboxId - ID do sandbox
   * @param {Object} qaResult - resultado completo de QA
   * @returns {Object} com status e governance decision
   */
  recordQAResult(sandboxId, qaResult = {}) {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    sandbox.qaResults = {
      ...qaResult,
      recordedAt: new Date().toISOString(),
    };

    this.logger.log(`[Sandbox] Recorded QA result in ${sandboxId}: decision=${qaResult.governance?.decision}`);

    return {
      sandboxId,
      qaRecorded: true,
      decision: qaResult.governance?.decision,
    };
  }

  /**
   * Obtém status do sandbox.
   */
  getSandboxStatus(sandboxId) {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      return { found: false, sandboxId };
    }

    return {
      found: true,
      sandboxId,
      tenantId: sandbox.tenantId,
      isolatedTenantId: sandbox.isolatedTenantId,
      status: sandbox.status,
      patchesApplied: sandbox.appliedPatches.length,
      hasQAResult: Boolean(sandbox.qaResults),
      qaDecision: sandbox.qaResults?.governance?.decision || null,
      createdAt: sandbox.createdAt,
      expiresAt: sandbox.expiresAt,
    };
  }

  /**
   * Obtém dados completos do sandbox para análise.
   */
  getSandboxData(sandboxId) {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      return null;
    }
    return {
      sandbox: {
        id: sandbox.id,
        status: sandbox.status,
        createdAt: sandbox.createdAt,
        expiresAt: sandbox.expiresAt,
      },
      appliedPatches: sandbox.appliedPatches,
      qaResults: sandbox.qaResults,
      originalContext: sandbox.originalContext,
    };
  }

  /**
   * Destroi sandbox (limpeza).
   */
  destroySandbox(sandboxId) {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      return { destroyed: false, reason: 'Sandbox not found' };
    }

    sandbox.status = 'destroyed';
    this.sandboxes.delete(sandboxId);
    this.logger.log(`[Sandbox] Destroyed: ${sandboxId}`);

    return {
      destroyed: true,
      sandboxId,
      patchesApplied: sandbox.appliedPatches.length,
      qaDecision: sandbox.qaResults?.governance?.decision,
    };
  }

  /**
   * Limpa sandboxes expirados (cleanup automático).
   */
  cleanupExpiredSandboxes() {
    const now = new Date();
    let cleaned = 0;

    for (const [sandboxId, sandbox] of this.sandboxes.entries()) {
      if (new Date(sandbox.expiresAt) < now) {
        this.sandboxes.delete(sandboxId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.log(`[Sandbox] Cleaned up ${cleaned} expired sandboxes`);
    }

    return { cleaned, remaining: this.sandboxes.size };
  }

  /**
   * Retorna métricas de sandboxes ativos.
   */
  getSandboxMetrics() {
    const metrics = {
      total: this.sandboxes.size,
      active: 0,
      withQAResults: 0,
      averagePatchesPerSandbox: 0,
    };

    let totalPatches = 0;
    for (const [, sandbox] of this.sandboxes.entries()) {
      if (sandbox.status === 'active') metrics.active++;
      if (sandbox.qaResults) metrics.withQAResults++;
      totalPatches += sandbox.appliedPatches.length;
    }

    metrics.averagePatchesPerSandbox = metrics.total > 0 ? (totalPatches / metrics.total).toFixed(2) : 0;
    return metrics;
  }
}

module.exports = ValidationSandboxService;
