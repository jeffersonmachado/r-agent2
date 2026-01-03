/**
 * Avaliadores de Governança - Módulo Reutilizável
 * 
 * Extraído de tests/governance/governancePolicy.test.js para uso em QA e CI.
 * 
 * Funções:
 * - policyEvaluator: Avalia política de QA e determina status (PASS/WARN/FAIL)
 * - warnApprovalValidator: Valida aprovação de WARN por papel
 * - timeEvaluator: Avalia SLA de tempo de execução
 */

const fs = require('fs');
const path = require('path');

// Carrega políticas
const qaPolicyPath = path.join(__dirname, 'qa-policy.json');
const warnApprovalPolicyPath = path.join(__dirname, 'warn-approval-policy.json');

let qaPolicy, warnApprovalPolicy;

try {
  qaPolicy = JSON.parse(fs.readFileSync(qaPolicyPath, 'utf8'));
} catch (error) {
  throw new Error(`Erro ao carregar política de QA: ${error.message}`);
}

try {
  warnApprovalPolicy = JSON.parse(fs.readFileSync(warnApprovalPolicyPath, 'utf8'));
} catch (error) {
  throw new Error(`Erro ao carregar política de aprovação WARN: ${error.message}`);
}

/**
 * Avalia política de QA.
 * 
 * @param {Object} qaResult - Resultado de QA (status, scope, checks)
 * @param {Object} [policy] - Política de QA (padrão: qa-policy.json)
 * @returns {Object} { status: 'PASS'|'WARN'|'FAIL', reason: string, ... }
 */
function policyEvaluator(qaResult, policy = qaPolicy) {
  const warnings = qaResult.checks.filter(c => c.result === 'WARN' || (c.result === 'FAIL' && !c.blocking));
  const failures = qaResult.checks.filter(c => c.result === 'FAIL' && c.blocking);
  const criticalScopes = policy.warnings?.whenWarnBecomesFail?.criticalScopes || [];
  const maxAcceptable = policy.warnings?.maxAcceptable || 3;

  // WARN vira FAIL se exceder maxAcceptable e afetar escopos críticos
  if (warnings.length >= maxAcceptable) {
    const hasCriticalScope = qaResult.scope.some(s => criticalScopes.includes(s));
    if (hasCriticalScope) {
      return {
        status: 'FAIL',
        reason: 'WARN excedeu maxAcceptable em escopo crítico',
        warningsCount: warnings.length,
        maxAcceptable
      };
    }
  }

  // FAIL bloqueante sempre bloqueia
  if (failures.length > 0) {
    return {
      status: 'FAIL',
      reason: 'Falhas bloqueantes detectadas',
      failuresCount: failures.length
    };
  }

  // WARN não bloqueante
  if (warnings.length > 0) {
    return {
      status: 'WARN',
      reason: 'Warnings detectados',
      warningsCount: warnings.length
    };
  }

  return {
    status: 'PASS',
    reason: 'Nenhum problema detectado'
  };
}

/**
 * Valida aprovação de WARN.
 * 
 * @param {string} approverRole - Papel do aprovador (tech_lead, qa_lead, etc.)
 * @param {number} warnCount - Quantidade de WARNs a aprovar
 * @param {string} scope - Escopo afetado
 * @param {string|null} justification - Justificativa (opcional)
 * @returns {Object} { valid: boolean, reason: string }
 */
function warnApprovalValidator(approverRole, warnCount, scope, justification = null) {
  const roleConfig = warnApprovalPolicy.approvers?.roles?.[approverRole];
  
  if (!roleConfig || !roleConfig.canApprove) {
    return {
      valid: false,
      reason: `Papel ${approverRole} não pode aprovar WARN`
    };
  }

  // Verifica limite por aprovação
  const maxWarnings = roleConfig.maxWarningsPerApproval || 0;
  if (warnCount > maxWarnings) {
    return {
      valid: false,
      reason: `WARN count (${warnCount}) excede máximo permitido (${maxWarnings}) para ${approverRole}`
    };
  }

  // Verifica escopo
  const allowedScope = roleConfig.scope || [];
  if (allowedScope.length > 0 && !allowedScope.includes('all')) {
    const isNonCritical = !['contracts', 'gate'].includes(scope);
    if (!allowedScope.includes('non_critical') || !isNonCritical) {
      return {
        valid: false,
        reason: `Papel ${approverRole} não pode aprovar WARN em escopo ${scope}`
      };
    }
  }

  // Verifica justificativa obrigatória
  if (roleConfig.requiresJustification && (!justification || justification.length < 50)) {
    return {
      valid: false,
      reason: 'Justificativa obrigatória e deve ter pelo menos 50 caracteres'
    };
  }

  // Verifica restrições
  const restrictions = warnApprovalPolicy.restrictions?.cannotApprove || [];
  if (restrictions.some(r => r.includes(scope))) {
    return {
      valid: false,
      reason: `WARN em escopo ${scope} não pode ser aprovado (restrição)`
    };
  }

  return {
    valid: true,
    reason: 'Aprovação válida'
  };
}

/**
 * Avalia SLA de tempo.
 * 
 * @param {number} executionTime - Tempo de execução
 * @param {Object} slaConfig - Configuração de SLA (maxExecutionTime, unit, actionOnExceed)
 * @returns {Object} { exceeded: boolean, executionTime: number, maxTime: number, unit: string, action: string|null }
 */
function timeEvaluator(executionTime, slaConfig) {
  const maxTime = slaConfig.maxExecutionTime || slaConfig.maxResponseTime || Infinity;
  const unit = slaConfig.unit || 'seconds';
  
  // Converte para segundos se necessário
  let timeInSeconds = executionTime;
  if (unit === 'milliseconds') {
    timeInSeconds = executionTime / 1000;
  } else if (unit === 'minutes') {
    timeInSeconds = executionTime * 60;
  }

  const exceeded = timeInSeconds > maxTime;
  const action = exceeded ? (slaConfig.actionOnExceed || 'log_warning') : null;

  return {
    exceeded,
    executionTime: timeInSeconds,
    maxTime,
    unit: 'seconds',
    action
  };
}

module.exports = {
  policyEvaluator,
  warnApprovalValidator,
  timeEvaluator
};

