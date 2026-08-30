import { describe, expect, it } from 'vitest';
import { CLASSIFICATIONS, getAgentClassification, isPlatformInternal } from './classification';

describe('classification util', () => {
  it('usa classification explícita do servidor quando válida', () => {
    expect(getAgentClassification({ classification: 'SUPPORT', role: 'operator' })).toBe('SUPPORT');
    expect(getAgentClassification({ classification: 'development', role: 'operator' })).toBe('DEVELOPMENT');
    expect(getAgentClassification({ classification: 'PRODUCTION' })).toBe('PRODUCTION');
  });

  it('classification explícita vence platformRole e role', () => {
    expect(getAgentClassification({ classification: 'SUPPORT', platformRole: 'engineer', role: 'super_admin' })).toBe('SUPPORT');
  });

  it('mapeia platformRole interno para SUPPORT/DEVELOPMENT', () => {
    expect(getAgentClassification({ platformRole: 'support_n1', role: 'operator' })).toBe('SUPPORT');
    expect(getAgentClassification({ platformRole: 'Platform_Support', role: 'operator' })).toBe('SUPPORT');
    expect(getAgentClassification({ platformRole: 'engineer', role: 'admin' })).toBe('DEVELOPMENT');
    expect(getAgentClassification({ platformRole: 'qa_engineer' })).toBe('DEVELOPMENT');
    expect(getAgentClassification({ platformRole: 'devops' })).toBe('DEVELOPMENT');
    expect(getAgentClassification({ platformRole: 'platform_engineer' })).toBe('DEVELOPMENT');
    expect(getAgentClassification({ platformRole: 'developer' })).toBe('DEVELOPMENT');
  });

  it('platformRole desconhecido cai para as demais regras', () => {
    expect(getAgentClassification({ platformRole: 'desconhecido', role: 'operator' })).toBe('PRODUCTION');
    expect(getAgentClassification({ platformRole: 'desconhecido', role: 'super_admin' })).toBe('DEVELOPMENT');
  });

  it('super_admin sem classification/platformRole é DEVELOPMENT', () => {
    expect(getAgentClassification({ role: 'super_admin' })).toBe('DEVELOPMENT');
  });

  it('auditor puro NÃO é mais SUPPORT por role (fail-closed PRODUCTION)', () => {
    expect(getAgentClassification({ role: 'auditor' })).toBe('PRODUCTION');
  });

  it('demais roles sem platformRole são PRODUCTION', () => {
    expect(getAgentClassification({ role: 'operator' })).toBe('PRODUCTION');
    expect(getAgentClassification({ role: 'admin' })).toBe('PRODUCTION');
    expect(getAgentClassification({ role: 'owner' })).toBe('PRODUCTION');
  });

  it('agent ausente é PRODUCTION (fail-closed)', () => {
    expect(getAgentClassification(null)).toBe('PRODUCTION');
    expect(getAgentClassification(undefined)).toBe('PRODUCTION');
    expect(getAgentClassification({})).toBe('PRODUCTION');
  });

  it('isPlatformInternal reflete a classificação', () => {
    expect(isPlatformInternal({ classification: 'SUPPORT' })).toBe(true);
    expect(isPlatformInternal({ role: 'super_admin' })).toBe(true);
    expect(isPlatformInternal({ role: 'operator' })).toBe(false);
    expect(isPlatformInternal(null)).toBe(false);
  });

  it('CLASSIFICATIONS expõe os valores canônicos', () => {
    expect(CLASSIFICATIONS).toEqual({ PRODUCTION: 'PRODUCTION', SUPPORT: 'SUPPORT', DEVELOPMENT: 'DEVELOPMENT' });
  });
});
