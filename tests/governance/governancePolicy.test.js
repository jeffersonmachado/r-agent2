/**
 * Testes de governança semi-automática (Policy, WARN, SLA).
 * 
 * Testa policyEvaluator, warnApprovalValidator, timeEvaluator.
 */

const fs = require('fs');
const path = require('path');

// Carrega políticas
const qaPolicyPath = path.join(__dirname, '../../governance/qa-policy.json');
const warnApprovalPolicyPath = path.join(__dirname, '../../governance/warn-approval-policy.json');
const rolesRaciPath = path.join(__dirname, '../../governance/roles-raci.json');

let qaPolicy, warnApprovalPolicy, rolesRaci;

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

try {
  rolesRaci = JSON.parse(fs.readFileSync(rolesRaciPath, 'utf8'));
} catch (error) {
  throw new Error(`Erro ao carregar papéis RACI: ${error.message}`);
}

/**
 * Avalia política de QA.
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

describe('Governança - Policy Evaluator', () => {
  test('deve retornar PASS quando não há problemas', () => {
    const qaResult = {
      status: 'PASS',
      scope: ['contracts'],
      checks: [
        { id: 'test1', result: 'PASS', blocking: true }
      ]
    };

    const result = policyEvaluator(qaResult);
    expect(result.status).toBe('PASS');
  });

  test('deve retornar FAIL quando há falhas bloqueantes', () => {
    const qaResult = {
      status: 'FAIL',
      scope: ['contracts'],
      checks: [
        { id: 'test1', result: 'FAIL', blocking: true }
      ]
    };

    const result = policyEvaluator(qaResult);
    expect(result.status).toBe('FAIL');
    expect(result.failuresCount).toBe(1);
  });

  test('deve converter WARN em FAIL quando excede maxAcceptable em escopo crítico', () => {
    const qaResult = {
      status: 'WARN',
      scope: ['contracts'], // Escopo crítico
      checks: [
        { id: 'test1', result: 'WARN', blocking: false },
        { id: 'test2', result: 'WARN', blocking: false },
        { id: 'test3', result: 'WARN', blocking: false },
        { id: 'test4', result: 'WARN', blocking: false } // 4 > 3 (maxAcceptable)
      ]
    };

    const result = policyEvaluator(qaResult);
    expect(result.status).toBe('FAIL');
    expect(result.warningsCount).toBe(4);
  });

  test('deve manter WARN quando não afeta escopo crítico', () => {
    const qaResult = {
      status: 'WARN',
      scope: ['prompts'], // Escopo não crítico
      checks: [
        { id: 'test1', result: 'WARN', blocking: false },
        { id: 'test2', result: 'WARN', blocking: false },
        { id: 'test3', result: 'WARN', blocking: false },
        { id: 'test4', result: 'WARN', blocking: false }
      ]
    };

    const result = policyEvaluator(qaResult);
    expect(result.status).toBe('WARN');
  });
});

describe('Governança - WARN Approval Validator', () => {
  test('tech_lead deve poder aprovar WARN válido', () => {
    const result = warnApprovalValidator('tech_lead', 3, 'prompts', 'Justificativa válida com mais de 50 caracteres para aprovar este WARN');
    expect(result.valid).toBe(true);
  });

  test('tech_lead não deve poder aprovar WARN acima do limite', () => {
    const result = warnApprovalValidator('tech_lead', 6, 'prompts', 'Justificativa válida');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('excede máximo');
  });

  test('engineer não deve poder aprovar WARN', () => {
    const result = warnApprovalValidator('engineer', 1, 'prompts', 'Justificativa');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('não pode aprovar');
  });

  test('senior_engineer não deve poder aprovar WARN em escopo crítico', () => {
    const result = warnApprovalValidator('senior_engineer', 2, 'contracts', 'Justificativa válida');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('não pode aprovar WARN em escopo');
  });

  test('deve exigir justificativa quando required', () => {
    const result = warnApprovalValidator('tech_lead', 2, 'prompts', 'Curta'); // < 50 caracteres
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Justificativa obrigatória');
  });

  test('qa_lead deve poder aprovar mais WARNs que tech_lead', () => {
    const result = warnApprovalValidator('qa_lead', 8, 'prompts', 'Justificativa válida com mais de 50 caracteres para aprovar este WARN específico');
    expect(result.valid).toBe(true);
  });
});

describe('Governança - Time Evaluator (SLA)', () => {
  test('deve detectar quando execução excede SLA de CI', () => {
    const slaConfig = qaPolicy.sla.ci;
    const result = timeEvaluator(400, slaConfig); // 400s > 300s

    expect(result.exceeded).toBe(true);
    expect(result.action).toBe('fail_build');
  });

  test('deve passar quando execução está dentro do SLA', () => {
    const slaConfig = qaPolicy.sla.ci;
    const result = timeEvaluator(200, slaConfig); // 200s < 300s

    expect(result.exceeded).toBe(false);
    expect(result.action).toBeNull();
  });

  test('deve detectar quando runtime excede SLA', () => {
    const slaConfig = qaPolicy.sla.runtime;
    const result = timeEvaluator(6000, slaConfig); // 6s > 5s (em ms)

    expect(result.exceeded).toBe(true);
    expect(result.action).toBe('log_warning');
  });
});

