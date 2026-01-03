/**
 * Testes organizacionais - papéis, aprovação, SLA.
 * 
 * Valida que:
 * - Papel correto aprova WARN
 * - Papel incorreto falha
 * - SLA estourado escala
 */

const fs = require('fs');
const path = require('path');

const rolesRaciPath = path.join(__dirname, '../../governance/roles-raci.json');
const warnApprovalPolicyPath = path.join(__dirname, '../../governance/warn-approval-policy.json');
const qaPolicyPath = path.join(__dirname, '../../governance/qa-policy.json');

let rolesRaci, warnApprovalPolicy, qaPolicy;

try {
  rolesRaci = JSON.parse(fs.readFileSync(rolesRaciPath, 'utf8'));
  warnApprovalPolicy = JSON.parse(fs.readFileSync(warnApprovalPolicyPath, 'utf8'));
  qaPolicy = JSON.parse(fs.readFileSync(qaPolicyPath, 'utf8'));
} catch (error) {
  throw new Error(`Erro ao carregar políticas: ${error.message}`);
}

/**
 * Valida se papel pode aprovar WARN.
 */
function canApproveWarn(role, warnCount, scope, justification) {
  const roleConfig = rolesRaci.warnApprovalMatrix[role];
  
  if (!roleConfig || !roleConfig.canApprove) {
    return { allowed: false, reason: 'Papel não pode aprovar WARN' };
  }

  if (warnCount > roleConfig.maxWarnings) {
    return { allowed: false, reason: 'Excede máximo de WARNs por aprovação' };
  }

  const allowedScopes = roleConfig.scope || [];
  if (!allowedScopes.includes('all')) {
    // Se não tem 'all', verifica se o escopo é permitido
    const isNonCritical = !['contracts', 'gate'].includes(scope);
    if (allowedScopes.includes('non_critical')) {
      // Se permite non_critical, verifica se o escopo é não crítico
      if (!isNonCritical) {
        return { allowed: false, reason: 'Escopo crítico não permitido para este papel' };
      }
    } else if (!allowedScopes.includes(scope)) {
      return { allowed: false, reason: 'Escopo não permitido para este papel' };
    }
  }

  if (roleConfig.requiresJustification && (!justification || justification.length < 50)) {
    return { allowed: false, reason: 'Justificativa obrigatória e deve ter pelo menos 50 caracteres' };
  }

  return { allowed: true };
}

/**
 * Valida se papel pode bloquear deploy.
 */
function canBlockDeploy(role) {
  const roleConfig = rolesRaci.deployBlockingMatrix[role];
  return roleConfig?.canBlock || false;
}

/**
 * Avalia se SLA foi estourado e deve escalar.
 */
function evaluateSlaEscalation(executionTime, slaType = 'ci') {
  const slaConfig = qaPolicy.sla[slaType];
  if (!slaConfig) {
    return { escalated: false, reason: 'SLA não configurado' };
  }

  const maxTime = slaConfig.maxExecutionTime || slaConfig.maxResponseTime || Infinity;
  const exceeded = executionTime > maxTime;

  if (exceeded) {
    const action = slaConfig.actionOnExceed || 'log_warning';
    return {
      escalated: true,
      executionTime,
      maxTime,
      action,
      reason: `SLA ${slaType} estourado: ${executionTime}s > ${maxTime}s`
    };
  }

  return { escalated: false };
}

describe('Organizacional - Papéis e Aprovação', () => {
  
  describe('Papel correto deve aprovar WARN', () => {
    test('tech_lead deve poder aprovar WARN válido', () => {
      const result = canApproveWarn(
        'tech_lead',
        3,
        'prompts',
        'Justificativa válida com mais de 50 caracteres para aprovar este WARN'
      );
      
      expect(result.allowed).toBe(true);
    });

    test('qa_lead deve poder aprovar WARN válido', () => {
      const result = canApproveWarn(
        'qa_lead',
        5,
        'wrappers',
        'Justificativa válida com mais de 50 caracteres para aprovar este WARN'
      );
      
      expect(result.allowed).toBe(true);
    });

    test('senior_engineer deve poder aprovar WARN em escopo não crítico', () => {
      const result = canApproveWarn(
        'senior_engineer',
        2,
        'prompts', // Não crítico
        'Justificativa válida com mais de 50 caracteres para aprovar este WARN'
      );
      
      expect(result.allowed).toBe(true);
    });
  });

  describe('Papel incorreto deve falhar', () => {
    test('engineer não deve poder aprovar WARN', () => {
      const result = canApproveWarn('engineer', 1, 'prompts', 'Justificativa');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('não pode aprovar');
    });

    test('senior_engineer não deve poder aprovar WARN em escopo crítico', () => {
      const result = canApproveWarn(
        'senior_engineer',
        2,
        'contracts', // Crítico
        'Justificativa válida com mais de 50 caracteres'
      );
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Escopo (não permitido|crítico não permitido)/);
    });

    test('tech_lead não deve poder aprovar WARN acima do limite', () => {
      const result = canApproveWarn(
        'tech_lead',
        6, // > 5 (maxWarnings)
        'prompts',
        'Justificativa válida com mais de 50 caracteres'
      );
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Excede máximo');
    });
  });

  describe('Bloqueio de Deploy', () => {
    test('tech_lead deve poder bloquear deploy', () => {
      expect(canBlockDeploy('tech_lead')).toBe(true);
    });

    test('qa_lead deve poder bloquear deploy', () => {
      expect(canBlockDeploy('qa_lead')).toBe(true);
    });

    test('engineer não deve poder bloquear deploy', () => {
      expect(canBlockDeploy('engineer')).toBe(false);
    });

    test('senior_engineer não deve poder bloquear deploy', () => {
      expect(canBlockDeploy('senior_engineer')).toBe(false);
    });
  });
});

describe('Organizacional - SLA Escalonamento', () => {
  
  describe('SLA estourado deve escalar', () => {
    test('deve escalar quando CI excede SLA', () => {
      const result = evaluateSlaEscalation(400, 'ci'); // 400s > 300s
      
      expect(result.escalated).toBe(true);
      expect(result.action).toBe('fail_build');
      expect(result.reason).toContain('SLA ci estourado');
    });

    test('deve escalar quando runtime excede SLA', () => {
      const result = evaluateSlaEscalation(6, 'runtime'); // 6s > 5s
      
      expect(result.escalated).toBe(true);
      expect(result.action).toBe('log_warning');
    });

    test('não deve escalar quando dentro do SLA', () => {
      const result = evaluateSlaEscalation(200, 'ci'); // 200s < 300s
      
      expect(result.escalated).toBe(false);
    });
  });
});

