'use strict';

/**
 * Autoridade de aprovação da superfície de Security Intelligence.
 *
 * Este teste protege a correção do achado P0 de 2026-10-10: a identidade de quem
 * aceita risco era AUTODECLARADA no corpo (`approvedBy`/`authorizedBy`) e nenhuma
 * permissão por ação era exigida — bastava alcançar a tela para aprovar qualquer
 * risco. Aqui a checagem de permissão é o RBAC REAL (`hasPermission` sobre
 * `ROLE_PERMISSIONS`), não um stub que sempre diz sim: um stub provaria apenas
 * que o teste sabe dizer "allowed: true".
 */

const fs = require('fs');
const path = require('path');

const { hasPermission } = require('../../../api/services/rbacService');
const {
  SECURITY_INTEL_RESOURCE,
  SECURITY_INTEL_ACTIONS,
  APPROVAL_IDENTITY_NOT_ACCEPTED,
  assertNoDeclaredIdentity,
  resolveApprovalIdentity,
  createApprovalAuthority,
} = require('../../../api/modules/security-intel/approvalAuthority');

/** Liga o RBAC real ao contrato do módulo (mesma assinatura usada nas rotas). */
function authorityFor(agent) {
  return createApprovalAuthority({
    agent,
    permissionCheck: (resource, action) => ({ allowed: hasPermission(agent, resource, action) }),
  });
}

const OWNER = { id: 'u-owner', username: 'dona', email: 'dona@results.com.br', role: 'owner', tenantId: 'system' };
const ADMIN = { id: 'u-admin', username: 'adm', role: 'admin', tenantId: 'tenant-x' };
const OPERATOR = { id: 'u-op', username: 'operador', role: 'operator', tenantId: 'tenant-x' };
const AUDITOR = { id: 'u-aud', username: 'auditor', role: 'auditor', tenantId: 'tenant-x' };
const SUPER = { id: 'u-super', username: 'root', role: 'super_admin', tenantId: 'system' };

describe('approvalAuthority — identidade derivada (nunca declarada)', () => {
  test('deriva id/label/key do ator autenticado', () => {
    const identity = resolveApprovalIdentity(OWNER);
    expect(identity).toMatchObject({ id: 'u-owner', label: 'dona', key: 'u-owner', role: 'owner' });
  });

  test('usa e-mail quando não há username e cai no label quando não há id', () => {
    expect(resolveApprovalIdentity({ id: 'x', email: 'a@b.c' }).label).toBe('a@b.c');
    expect(resolveApprovalIdentity({ username: 'SomenteNome' })).toMatchObject({ id: 'SomenteNome', label: 'SomenteNome' });
  });

  test('key é case-insensitive (comparação de SoD/idempotência não depende de caixa)', () => {
    expect(resolveApprovalIdentity({ id: 'A1B2' }).key).toBe('a1b2');
  });

  test('ator sem identidade utilizável devolve null (chamador deve negar)', () => {
    expect(resolveApprovalIdentity(null)).toBeNull();
    expect(resolveApprovalIdentity({})).toBeNull();
    expect(resolveApprovalIdentity({ id: '   ', username: '' })).toBeNull();
  });

  test('corpo com approvedBy/authorizedBy é RECUSADO com código nomeado', () => {
    for (const field of ['approvedBy', 'authorizedBy', 'approved_by', 'authorized_by', 'approver', 'approverId']) {
      expect(() => assertNoDeclaredIdentity({ [field]: 'fulano' })).toThrow(
        expect.objectContaining({ code: APPROVAL_IDENTITY_NOT_ACCEPTED, statusCode: 400 }),
      );
    }
  });

  test('corpo que NÃO declara identidade é aceito (null/vazio/false não declaram nada)', () => {
    expect(() => assertNoDeclaredIdentity(undefined)).not.toThrow();
    expect(() => assertNoDeclaredIdentity({})).not.toThrow();
    expect(() => assertNoDeclaredIdentity({ approvedBy: null, authorizedBy: '' })).not.toThrow();
    expect(() => assertNoDeclaredIdentity({ approver: false })).not.toThrow();
    expect(() => assertNoDeclaredIdentity({ findingKey: 'pkg@1.0.0#x', reason: 'motivo com substância' })).not.toThrow();
  });
});

describe('approvalAuthority — autorização POR AÇÃO com o RBAC real', () => {
  test('owner e admin têm as CINCO ações da capacidade', () => {
    const actions = Object.values(SECURITY_INTEL_ACTIONS);
    for (const agent of [OWNER, ADMIN]) {
      const authority = authorityFor(agent);
      for (const action of actions) {
        expect([agent.role, action, authority.allows(action)]).toEqual([agent.role, action, true]);
      }
    }
  });

  test('papéis operacionais NÃO ganham nenhuma ação (fail-closed)', () => {
    const actions = Object.values(SECURITY_INTEL_ACTIONS);
    for (const agent of [OPERATOR, AUDITOR]) {
      const authority = authorityFor(agent);
      for (const action of actions) {
        expect([agent.role, action, authority.allows(action)]).toEqual([agent.role, action, false]);
      }
    }
  });

  test('super_admin mantém bypass (engenharia de plataforma autorizada)', () => {
    const authority = authorityFor(SUPER);
    expect(authority.allows(SECURITY_INTEL_ACTIONS.PATCH_MISSION)).toBe(true);
  });

  test('DENIAL: capacidade de LER não implica capacidade de APROVAR risco', () => {
    // Um papel de leitura/scan não pode aceitar risco. Provado com o RBAC real:
    // se `read` implicasse `waiver_approve`, este teste falharia.
    const reader = { id: 'u-r', username: 'leitor', role: 'manager', tenantId: 'tenant-x' };
    const authority = authorityFor(reader);
    expect(authority.allows(SECURITY_INTEL_ACTIONS.WAIVER_APPROVE)).toBe(false);
    expect(authority.allows(SECURITY_INTEL_ACTIONS.PATCH_MISSION)).toBe(false);
  });

  test('sem identidade não há autoridade; sem checagem de permissão, nega', () => {
    expect(createApprovalAuthority({ agent: null, permissionCheck: () => ({ allowed: true }) })).toBeNull();
    const semChecagem = createApprovalAuthority({ agent: OWNER });
    expect(semChecagem.allows(SECURITY_INTEL_ACTIONS.READ)).toBe(false);
    const comChecagemQuebrada = createApprovalAuthority({
      agent: OWNER,
      permissionCheck: () => { throw new Error('rbac offline'); },
    });
    // Erro de infraestrutura de autorização NÃO pode virar permissão concedida.
    expect(() => comChecagemQuebrada.allows(SECURITY_INTEL_ACTIONS.READ)).toThrow('rbac offline');
  });

  test('ação vazia/desconhecida é negada', () => {
    const authority = authorityFor(OWNER);
    expect(authority.allows('')).toBe(false);
    expect(authority.allows('inventada')).toBe(false);
  });

  test('a decisão é memorizada por ação (uma consulta ao RBAC por ação)', () => {
    const seen = [];
    const authority = createApprovalAuthority({
      agent: OWNER,
      permissionCheck: (resource, action) => { seen.push(`${resource}:${action}`); return { allowed: true }; },
    });
    authority.allows(SECURITY_INTEL_ACTIONS.READ);
    authority.allows(SECURITY_INTEL_ACTIONS.READ);
    expect(seen).toEqual([`${SECURITY_INTEL_RESOURCE}:read`]);
  });
});

describe('routes.js — não-vacuidade do enforcement por ação', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../../api/modules/security-intel/routes.js'),
    'utf8',
  );

  test('TODA rota declarada tem ação na tabela (rota nova sem ação = 403 silencioso)', () => {
    const declared = [...source.matchAll(/router\.(get|post)\('([^']+)'/g)]
      .map((match) => `${match[1].toUpperCase()} ${match[2]}`);
    const table = [...source.matchAll(/'((?:GET|POST) \/api\/security-intel[^']+)':/g)]
      .map((match) => match[1]);
    expect(declared.length).toBeGreaterThan(0);
    expect(new Set(table)).toEqual(new Set(declared));
  });

  test('a taxonomia morta foi removida (ROUTE_ACTIONS agora é enforcement)', () => {
    expect(source).not.toMatch(/void ROUTE_ACTIONS/);
  });

  test('a identidade do aprovador não é mais lida do corpo da requisição', () => {
    expect(source).not.toMatch(/req\.body\?\.(approvedBy|authorizedBy)/);
    expect(source).toMatch(/approvedBy: actor/);
    expect(source).toMatch(/authorizedBy: actor/);
  });
});
