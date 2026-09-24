'use strict';

/**
 * Policy Resolver (§20, §21) — a política da missão NUNCA amplia privilégio em silêncio.
 *
 * Defeito real corrigido: o merge `{...global, ...mission.auto_approval_policy}` permitia que a
 * própria missão declarasse `maxRisk: 'CRITICAL'` e `confidenceThreshold: 0.1` e passasse a
 * autorizar mais do que a instalação autorizava.
 */

const { resolveMissionPolicy, DECISIONS, COMPARISONS } = require('../../engine/engineeringMission/policyResolver');
const { DEFAULT_POLICY } = require('../../engine/engineeringMission/autoApprovalPolicy');

const GLOBAL = Object.freeze({
  ...DEFAULT_POLICY,
  enabled: true,
  mode: 'SAFE_ONLY',
  maxRisk: 'MEDIUM',
  confidenceThreshold: 0.75,
  allowedBranches: ['main'],
  allowedScopes: ['SMALL', 'MEDIUM'],
  allowedMissionTypes: ['TECH_DEBT', 'REFACTOR'],
});

describe('policyResolver — restringir é sempre permitido', () => {
  test('missão sem override ⇒ efetiva = instalação', () => {
    const r = resolveMissionPolicy({ globalPolicy: GLOBAL, requestedPolicy: null });
    expect(r.decision).toBe(DECISIONS.ALLOW);
    expect(r.effectivePolicy.maxRisk).toBe(GLOBAL.maxRisk);
    expect(r.effectivePolicy.mode).toBe('SAFE_ONLY');
    expect(r.differences).toHaveLength(0);
    expect(r.escalations).toHaveLength(0);
  });

  test('missão mais restritiva (risco menor, confiança maior, escopo menor) ⇒ ALLOW', () => {
    const r = resolveMissionPolicy({
      globalPolicy: GLOBAL,
      requestedPolicy: { maxRisk: 'LOW', confidenceThreshold: 0.9, allowedScopes: ['SMALL'], mode: 'MANUAL' },
    });
    expect(r.decision).toBe(DECISIONS.ALLOW);
    expect(r.escalations).toHaveLength(0);
    expect(r.effectivePolicy.maxRisk).toBe('LOW');
    expect(r.effectivePolicy.confidenceThreshold).toBe(0.9);
    expect(r.effectivePolicy.allowedScopes).toEqual(['SMALL']);
    expect(r.effectivePolicy.mode).toBe('MANUAL');
    expect(r.differences.every((d) => d.comparison === COMPARISONS.NARROWER)).toBe(true);
  });

  test('restringir a lista de branches/tipos ⇒ ALLOW (subconjunto)', () => {
    const r = resolveMissionPolicy({
      globalPolicy: GLOBAL,
      requestedPolicy: { allowedBranches: ['main'], allowedMissionTypes: ['TECH_DEBT'] },
    });
    expect(r.decision).toBe(DECISIONS.ALLOW);
    expect(r.effectivePolicy.allowedMissionTypes).toEqual(['TECH_DEBT']);
  });
});

describe('policyResolver — ampliar privilégio exige autorização explícita', () => {
  test('maxRisk CRITICAL declarado pela missão ⇒ DENY e a efetiva é a da INSTALAÇÃO', () => {
    const r = resolveMissionPolicy({ globalPolicy: GLOBAL, requestedPolicy: { maxRisk: 'CRITICAL' } });
    expect(r.decision).toBe(DECISIONS.DENY);
    expect(r.escalations.map((e) => e.axis)).toEqual(['maxRisk']);
    expect(r.effectivePolicy.maxRisk).toBe('MEDIUM');
    expect(r.reason).toMatch(/sem autorização administrativa/);
  });

  test('confidenceThreshold mais baixo ⇒ DENY (aceitaria enriquecimento menos confiável)', () => {
    const r = resolveMissionPolicy({ globalPolicy: GLOBAL, requestedPolicy: { confidenceThreshold: 0.1 } });
    expect(r.decision).toBe(DECISIONS.DENY);
    expect(r.escalations.map((e) => e.axis)).toEqual(['confidenceThreshold']);
  });

  test('modo mais amplo (SAFE_ONLY → POLICY_BASED) ⇒ DENY', () => {
    const r = resolveMissionPolicy({ globalPolicy: GLOBAL, requestedPolicy: { mode: 'POLICY_BASED' } });
    expect(r.decision).toBe(DECISIONS.DENY);
    expect(r.escalations.map((e) => e.axis)).toEqual(['mode']);
  });

  test('habilitar autoaprovação que a instalação tinha desligada ⇒ DENY', () => {
    const r = resolveMissionPolicy({ globalPolicy: { ...GLOBAL, enabled: false }, requestedPolicy: { enabled: true } });
    expect(r.decision).toBe(DECISIONS.DENY);
    expect(r.escalations.map((e) => e.axis)).toEqual(['enabled']);
    expect(r.effectivePolicy.enabled).toBe(false);
  });

  test('lista vazia (convenção = "qualquer") ⇒ DENY quando a instalação restringe', () => {
    const r = resolveMissionPolicy({ globalPolicy: GLOBAL, requestedPolicy: { allowedBranches: [] } });
    expect(r.decision).toBe(DECISIONS.DENY);
    expect(r.escalations.map((e) => e.axis)).toEqual(['allowedBranches']);
    expect(r.effectivePolicy.allowedBranches).toEqual(['main']);
  });

  test('acrescentar item à lista de tipos permitidos ⇒ DENY (superset)', () => {
    const r = resolveMissionPolicy({ globalPolicy: GLOBAL, requestedPolicy: { allowedMissionTypes: ['TECH_DEBT', 'REFACTOR', 'RELEASE'] } });
    expect(r.decision).toBe(DECISIONS.DENY);
    expect(r.escalations.map((e) => e.axis)).toEqual(['allowedMissionTypes']);
  });

  test('ligar allowPolicyRequirements desligado ⇒ DENY', () => {
    const r = resolveMissionPolicy({ globalPolicy: { ...GLOBAL, allowPolicyRequirements: false }, requestedPolicy: { allowPolicyRequirements: true } });
    expect(r.decision).toBe(DECISIONS.DENY);
  });

  test('IDENTIDADE ADMINISTRATIVA SOZINHA NÃO BASTA: falta permissão da política', () => {
    const r = resolveMissionPolicy({ globalPolicy: GLOBAL, requestedPolicy: { maxRisk: 'CRITICAL' }, actor: { id: 'admin', canEscalatePolicy: true } });
    expect(r.decision).toBe(DECISIONS.DENY);
    expect(r.escalationAuthorized).toBe(false);
    expect(r.reason).toMatch(/não permite escalação/);
  });

  test('POLÍTICA PERMISSIVA SOZINHA NÃO BASTA: identidade sem autorização administrativa', () => {
    const r = resolveMissionPolicy({ globalPolicy: { ...GLOBAL, allowPolicyEscalation: true }, requestedPolicy: { maxRisk: 'CRITICAL' } });
    expect(r.decision).toBe(DECISIONS.DENY);
    expect(r.reason).toMatch(/sem autorização administrativa/);
  });

  test('autorização explícita nos DOIS lados ⇒ ALLOW com escalação registrada (evidência)', () => {
    const r = resolveMissionPolicy({
      globalPolicy: { ...GLOBAL, allowPolicyEscalation: true },
      requestedPolicy: { maxRisk: 'HIGH' },
      actor: { id: 'eng-admin', canEscalatePolicy: true },
      evaluatedAt: '2026-09-24T16:00:00.000Z',
    });
    expect(r.decision).toBe(DECISIONS.ALLOW);
    expect(r.escalationAuthorized).toBe(true);
    expect(r.escalations.map((e) => e.axis)).toEqual(['maxRisk']);
    expect(r.effectivePolicy.maxRisk).toBe('HIGH');
    expect(r.evaluatedAt).toBe('2026-09-24T16:00:00.000Z');
  });
});

describe('policyResolver — evidência e fail-closed', () => {
  test('mistura de restrição e escalação ⇒ DENY (não existe "compensação" entre eixos)', () => {
    const r = resolveMissionPolicy({
      globalPolicy: GLOBAL,
      requestedPolicy: { maxRisk: 'CRITICAL', confidenceThreshold: 0.95, allowedScopes: ['SMALL'] },
    });
    expect(r.decision).toBe(DECISIONS.DENY);
    expect(r.escalations.map((e) => e.axis)).toEqual(['maxRisk']);
    // A restrição de confiança/escopo aparece nas diferenças, mas não "compra" a escalação de risco.
    expect(r.differences.map((d) => d.axis)).toContain('confidenceThreshold');
  });

  test('escalação negada NUNCA produz política mais permissiva que a instalação', () => {
    const requested = { enabled: true, mode: 'POLICY_BASED', maxRisk: 'CRITICAL', confidenceThreshold: 0.05, allowedBranches: [], allowedScopes: ['LARGE'] };
    const r = resolveMissionPolicy({ globalPolicy: GLOBAL, requestedPolicy: requested });
    expect(r.decision).toBe(DECISIONS.DENY);
    for (const axis of ['enabled', 'mode', 'maxRisk', 'confidenceThreshold', 'allowedBranches', 'allowedScopes']) {
      expect(r.effectivePolicy[axis]).toEqual(GLOBAL[axis]);
    }
  });

  test('threshold inválido (NaN/string) não afrouxa: tratado como WIDER, portanto DENY', () => {
    const r = resolveMissionPolicy({ globalPolicy: GLOBAL, requestedPolicy: { confidenceThreshold: 'muito-baixo' } });
    expect(r.decision).toBe(DECISIONS.DENY);
    expect(r.effectivePolicy.confidenceThreshold).toBe(GLOBAL.confidenceThreshold);
  });

  test('resolveMissionPolicy devolve o contrato completo de evidência (§21)', () => {
    const r = resolveMissionPolicy({ globalPolicy: GLOBAL, requestedPolicy: { maxRisk: 'LOW' } });
    for (const field of ['globalPolicy', 'requestedPolicy', 'effectivePolicy', 'differences', 'escalations', 'decision', 'reason']) {
      expect(r[field]).toBeDefined();
    }
    expect(typeof r.decision).toBe('string');
    expect(Array.isArray(r.escalations)).toBe(true);
  });

  test('núcleo puro: sem relógio, sem aleatoriedade, sem I/O', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../../engine/engineeringMission/policyResolver.js'), 'utf8');
    expect(src).not.toMatch(/Date\.now\(|new Date\(/);
    expect(src).not.toMatch(/Math\.random\(/);
    expect(src).not.toMatch(/require\(['"](fs|child_process|http|https|sequelize)['"]\)/);
  });

  test('policyId da missão é informativo (não é eixo de privilégio)', () => {
    const r = resolveMissionPolicy({ globalPolicy: GLOBAL, requestedPolicy: { policyId: 'minha-politica-de-time' } });
    expect(r.decision).toBe(DECISIONS.ALLOW);
    expect(r.policyId).toBe('minha-politica-de-time');
    expect(r.escalations).toHaveLength(0);
  });
});
