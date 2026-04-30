'use strict';

/**
 * OperationalGateService
 *
 * Controla a operação do sistema baseado em decisões de governance do QA Mesh.
 * Mapeia decisões (GO, REVIEW, NO_GO, GO_WITH_WARNINGS) para modos operacionais
 * (FULL, MONITORING, LIMITED, BLOCKED).
 */
class OperationalGateService {
  constructor(deps = {}) {
    this.logger = deps.logger || console;
  }

  /**
   * Avalia se a operação é permitida baseado em governance.
   *
   * @param {Object} governance - resultado de governance do QA Mesh
   * @param {string} governance.decision - GO | REVIEW | NO_GO | GO_WITH_WARNINGS
   * @param {string} governance.reason - razão da decisão
   * @param {string} governance.severity - critical | high | medium | low
   * @param {Array} governance.failedChecks - checks que falharam
   * @returns {Object} {allowed, mode, reason, actions, operationalRestrictions}
   */
  evaluateOperationalGate(governance = {}) {
    const { decision = 'MONITORING', reason = 'No governance available', severity = 'medium', failedChecks = [] } = governance;

    // Fallback: se não houver governance, modo MONITORING
    if (!decision || !['GO', 'REVIEW', 'NO_GO', 'GO_WITH_WARNINGS'].includes(decision)) {
      return this._buildGateResponse({
        allowed: true,
        mode: 'MONITORING',
        decision: 'UNKNOWN',
        reason: reason || 'Governance decision unknown; operating in monitoring mode',
        severity: 'medium',
        failedChecks: [],
        operationalRestrictions: this._restrictionsForMode('MONITORING'),
      });
    }

    const responses = {
      GO: {
        allowed: true,
        mode: 'FULL',
        actions: ['allow_all_operations'],
      },
      GO_WITH_WARNINGS: {
        allowed: true,
        mode: 'MONITORING',
        actions: ['allow_all_operations', 'enable_extra_logging', 'create_monitoring_insight'],
      },
      REVIEW: {
        allowed: true,
        mode: 'LIMITED',
        actions: ['allow_manual_operations', 'block_mass_operations', 'require_approval_for_automation'],
      },
      NO_GO: {
        allowed: false,
        mode: 'BLOCKED',
        actions: ['block_outbound_operations', 'block_rpa_execution', 'block_automation', 'allow_read_only'],
      },
    };

    const response = responses[decision];
    return this._buildGateResponse({
      allowed: response.allowed,
      mode: response.mode,
      decision,
      reason,
      severity,
      failedChecks,
      actions: response.actions,
      operationalRestrictions: this._restrictionsForMode(response.mode),
    });
  }

  /**
   * Define restrições operacionais por modo.
   */
  _restrictionsForMode(mode) {
    const restrictions = {
      FULL: {
        block_mass_send: false,
        block_rpa_autonomous: false,
        block_automation: false,
        block_outbound: false,
        require_approval: false,
        read_only: false,
      },
      MONITORING: {
        block_mass_send: false,
        block_rpa_autonomous: false,
        block_automation: false,
        block_outbound: false,
        require_approval: false,
        read_only: false,
        extra_logging: true,
        create_insight: true,
      },
      LIMITED: {
        block_mass_send: true,
        block_rpa_autonomous: true,
        block_automation: true,
        block_outbound: false,
        require_approval: true,
        read_only: false,
      },
      BLOCKED: {
        block_mass_send: true,
        block_rpa_autonomous: true,
        block_automation: true,
        block_outbound: true,
        require_approval: true,
        read_only: true,
      },
    };
    return restrictions[mode] || restrictions.MONITORING;
  }

  /**
   * Verifica se uma operação é permitida no modo atual.
   */
  isOperationAllowed(operationType, gateResponse = {}) {
    const { mode = 'MONITORING', allowed = true } = gateResponse;
    const restrictions = this._restrictionsForMode(mode);

    // Read é sempre permitido (mesmo em read_only mode)
    if (operationType === 'read') {
      return {
        allowed: true,
        blocked: false,
        mode,
        reason: 'Read operations always allowed',
      };
    }

    // Para outras operações, verificar restrição + gate.allowed
    const operationBlocked =
      (operationType === 'mass_send' && restrictions.block_mass_send) ||
      (operationType === 'rpa_autonomous' && restrictions.block_rpa_autonomous) ||
      (operationType === 'automation' && restrictions.block_automation) ||
      (operationType === 'outbound_call' && restrictions.block_outbound) ||
      (operationType === 'campaign_trigger' && restrictions.block_automation) ||
      (operationType === 'ai_decision' && restrictions.block_automation);

    const isAllowed = !operationBlocked && allowed;

    return {
      allowed: isAllowed,
      blocked: operationBlocked,
      mode,
      reason: operationBlocked ? `Operation '${operationType}' is blocked in ${mode} mode` : 'Operation allowed',
    };
  }

  /**
   * Fornece response estruturada.
   */
  _buildGateResponse({ allowed, mode, decision, reason, severity, failedChecks, actions = [], operationalRestrictions = {} }) {
    return {
      allowed,
      mode,
      decision,
      reason,
      severity,
      failedChecks: failedChecks || [],
      actions,
      operationalRestrictions,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Retorna mensagem de status operacional para UI/logs.
   */
  getStatusMessage(gateResponse = {}) {
    const { allowed, mode, reason, decision } = gateResponse;
    const statusEmoji = allowed ? '✅' : '⛔';
    const modeLabel = {
      FULL: 'Operação completa',
      MONITORING: 'Monitoramento ativado',
      LIMITED: 'Operação limitada',
      BLOCKED: 'Operação bloqueada',
    }[mode] || 'Estado desconhecido';

    return `${statusEmoji} [${mode}] ${modeLabel} — ${reason}`;
  }
}

module.exports = OperationalGateService;
