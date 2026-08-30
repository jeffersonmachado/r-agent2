'use strict';

/**
 * Testes do Domain Router do RAG (api/services/rag/domainRouter.js).
 *
 * Garante que o domínio de recuperação é decidido pela identidade/classificação
 * do ator — nunca pelo texto da pergunta nem por metadados forjáveis — e que
 * na dúvida o escopo mais restritivo é aplicado.
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { resolveRetrievalScope, sanitizeScope, DEFAULT_SCOPE } = require('../../api/services/rag/domainRouter');

describe('resolveRetrievalScope', () => {
  test('ator nulo (fluxo interno operacional) recebe escopo mais restritivo', () => {
    const result = resolveRetrievalScope({ actor: null });
    expect(result.allowed).toBe(true);
    expect(result.scope).toEqual({ domain: 'OPERATIONAL', classifications: ['PRODUCTION'] });
  });

  test('ator nulo não pode sair do domínio OPERATIONAL', () => {
    const result = resolveRetrievalScope({ actor: null, requestedDomain: 'SYSTEM' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('anonymous_actor_cannot_leave_operational_domain');
  });

  test('usuário PRODUCTION consulta apenas OPERATIONAL/PRODUCTION', () => {
    const result = resolveRetrievalScope({ actor: { role: 'operator' } });
    expect(result.allowed).toBe(true);
    expect(result.scope).toEqual({ domain: 'OPERATIONAL', classifications: ['PRODUCTION'] });
  });

  test('usuário PRODUCTION é negado no domínio SYSTEM', () => {
    const result = resolveRetrievalScope({ actor: { role: 'operator' }, requestedDomain: 'SYSTEM' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('cannot_access_system_domain');
  });

  test('auditor de tenant puro é PRODUCTION e NÃO acessa SYSTEM', () => {
    const result = resolveRetrievalScope({ actor: { role: 'auditor' }, requestedDomain: 'SYSTEM' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('cannot_access_system_domain');
  });

  test('usuário SUPPORT (platformRole concedido server-side) acessa SYSTEM/SUPPORT mas não DEVELOPMENT', () => {
    const result = resolveRetrievalScope({ actor: { role: 'auditor', platformRole: 'support_n2' }, requestedDomain: 'SYSTEM' });
    expect(result.allowed).toBe(true);
    expect(result.scope.domain).toBe('SYSTEM');
    expect(result.scope.classifications).toEqual(['SUPPORT']);
  });

  test('usuário SUPPORT no domínio OPERATIONAL vê PRODUCTION e SUPPORT', () => {
    const result = resolveRetrievalScope({ actor: { role: 'auditor', platformRole: 'support_n2' } });
    expect(result.scope.classifications).toEqual(['PRODUCTION', 'SUPPORT']);
  });

  test('super_admin (DEVELOPMENT) acessa SYSTEM com SUPPORT e DEVELOPMENT', () => {
    const result = resolveRetrievalScope({ actor: { role: 'super_admin' }, requestedDomain: 'SYSTEM' });
    expect(result.allowed).toBe(true);
    expect(result.scope).toEqual({ domain: 'SYSTEM', classifications: ['SUPPORT', 'DEVELOPMENT'] });
  });

  test('requestedDomain inválido cai no OPERATIONAL (mais restritivo)', () => {
    const result = resolveRetrievalScope({ actor: { role: 'super_admin' }, requestedDomain: 'TUDO' });
    expect(result.allowed).toBe(true);
    expect(result.scope.domain).toBe('OPERATIONAL');
  });

  test('role desconhecido é tratado como PRODUCTION', () => {
    const result = resolveRetrievalScope({ actor: { role: 'hacker' }, requestedDomain: 'SYSTEM' });
    expect(result.allowed).toBe(false);
  });

  test('platformRole desconhecido não amplia: cai no fallback por role', () => {
    const result = resolveRetrievalScope({ actor: { role: 'operator', platformRole: 'root_god' }, requestedDomain: 'SYSTEM' });
    expect(result.allowed).toBe(false);
  });
});

describe('sanitizeScope', () => {
  test('null cai no default restritivo', () => {
    expect(sanitizeScope(null)).toEqual({ domain: 'OPERATIONAL', classifications: ['PRODUCTION'] });
    expect(sanitizeScope(undefined)).toEqual(DEFAULT_SCOPE);
  });

  test('classifications inválidas são descartadas, nunca ampliam', () => {
    const scope = sanitizeScope({ domain: 'SYSTEM', classifications: ['HACK', 'PRODUCTION'] });
    expect(scope.domain).toBe('SYSTEM');
    expect(scope.classifications).not.toContain('HACK');
    expect(scope.classifications).not.toContain('PRODUCTION');
  });

  test('OPERATIONAL nunca inclui DEVELOPMENT mesmo se forjado', () => {
    const scope = sanitizeScope({ domain: 'OPERATIONAL', classifications: ['DEVELOPMENT'] });
    expect(scope.classifications).toEqual(['PRODUCTION']);
  });

  test('escopo válido é preservado', () => {
    const scope = sanitizeScope({ domain: 'SYSTEM', classifications: ['SUPPORT', 'DEVELOPMENT'] });
    expect(scope).toEqual({ domain: 'SYSTEM', classifications: ['SUPPORT', 'DEVELOPMENT'] });
  });

  test('domain forjado cai no OPERATIONAL', () => {
    const scope = sanitizeScope({ domain: 'system; DROP TABLE', classifications: ['DEVELOPMENT'] });
    expect(scope.domain).toBe('OPERATIONAL');
  });
});
