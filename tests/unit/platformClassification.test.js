'use strict';

/**
 * Política de classificação de plataforma (2026-08-27):
 * tenantRole e platformClassification são eixos INDEPENDENTES.
 * Um role de negócio do tenant (ex.: auditor) NÃO concede acesso a plataforma;
 * classificação SUPPORT/DEVELOPMENT exige platformRole ou platformClassification
 * concedidos server-side (coluna users.platform_role / agent_snapshot).
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const {
  getClassificationForAgent,
  classificationMeets,
  CLASSIFICATIONS,
  PLATFORM_ROLE_CLASSIFICATION,
} = require('../../api/modules/agent-os/experience-segregation');
const { checkClassification } = require('../../api/middleware/requireClassification');

describe('platform classification — eixo independente do tenant role', () => {
  test('(a) tenantRole auditor SEM platformRole é PRODUCTION (negado em SUPPORT)', () => {
    const agent = { role: 'auditor' };
    expect(getClassificationForAgent(agent)).toBe('PRODUCTION');
    expect(checkClassification({ agent }, 'SUPPORT').allowed).toBe(false);
  });

  test('(b) platformRole support_n1/n2/n3 → SUPPORT', () => {
    for (const platformRole of ['support_n1', 'support_n2', 'support_n3']) {
      expect(getClassificationForAgent({ role: 'operator', platformRole })).toBe('SUPPORT');
    }
    expect(PLATFORM_ROLE_CLASSIFICATION.support_n1).toBe('SUPPORT');
    expect(PLATFORM_ROLE_CLASSIFICATION.support_n2).toBe('SUPPORT');
    expect(PLATFORM_ROLE_CLASSIFICATION.support_n3).toBe('SUPPORT');
  });

  test('(c) platformRole engineer → DEVELOPMENT', () => {
    expect(getClassificationForAgent({ role: 'operator', platformRole: 'engineer' })).toBe('DEVELOPMENT');
    expect(getClassificationForAgent({ platformRole: 'qa_engineer' })).toBe('DEVELOPMENT');
  });

  test('(d) platformClassification explícito (server-side) é respeitado', () => {
    expect(getClassificationForAgent({ role: 'auditor', platformClassification: 'SUPPORT' })).toBe('SUPPORT');
    expect(getClassificationForAgent({ role: 'operator', platformClassification: 'DEVELOPMENT' })).toBe('DEVELOPMENT');
    // Inválido não amplia: ignora e cai nos próximos eixos.
    expect(getClassificationForAgent({ role: 'operator', platformClassification: 'ADMIN' })).toBe('PRODUCTION');
  });

  test('(e) super_admin → DEVELOPMENT (fallback legado, flag de plataforma)', () => {
    expect(getClassificationForAgent({ role: 'super_admin' })).toBe('DEVELOPMENT');
  });

  test('(f) operator/admin → PRODUCTION', () => {
    expect(getClassificationForAgent({ role: 'operator' })).toBe('PRODUCTION');
    expect(getClassificationForAgent({ role: 'admin' })).toBe('PRODUCTION');
  });

  test('(g) classificationMeets respeita a hierarquia DEVELOPMENT > SUPPORT > PRODUCTION', () => {
    expect(classificationMeets('DEVELOPMENT', 'SUPPORT')).toBe(true);
    expect(classificationMeets('SUPPORT', 'PRODUCTION')).toBe(true);
    expect(classificationMeets('SUPPORT', 'DEVELOPMENT')).toBe(false);
    expect(classificationMeets('PRODUCTION', 'SUPPORT')).toBe(false);
    expect(classificationMeets('PRODUCTION', 'PRODUCTION')).toBe(true);
    // Mínimo inválido falha fechado.
    expect(classificationMeets('DEVELOPMENT', 'GODMODE')).toBe(false);
    expect(classificationMeets('GODMODE', 'PRODUCTION')).toBe(false);
  });

  test('(h) auditor com platformRole support NÃO acessa DEVELOPMENT (SUPPORT não controla RPA DEVELOPMENT)', () => {
    const agent = { role: 'auditor', platformRole: 'support_n2' };
    expect(getClassificationForAgent(agent)).toBe('SUPPORT');
    expect(checkClassification({ agent }, 'SUPPORT').allowed).toBe(true);
    expect(checkClassification({ agent }, 'DEVELOPMENT').allowed).toBe(false);
  });

  test('CLASSIFICATIONS expõe as três classificações canônicas', () => {
    expect(CLASSIFICATIONS).toEqual({
      PRODUCTION: 'PRODUCTION',
      SUPPORT: 'SUPPORT',
      DEVELOPMENT: 'DEVELOPMENT',
    });
  });
});
