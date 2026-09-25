'use strict';

/**
 * POLICY_RESOLVER_ALL_PATHS — autoridade ÚNICA de resolução de política.
 *
 * Achado real da auditoria V2 (medido em 2026-09-25): a política de autoaprovação era resolvida de
 * três formas diferentes, uma por caminho de chamada:
 *
 *   1. `missionCompilerService.enrichMission`              → resolver formal
 *   2. `missionApprovalService.evaluatePolicyForMission`   → `{ ...policy, ...missionPolicy }`
 *   3. `missionApprovalService.editAndApprove`             → política global pura
 *
 * Consequência medida: a superfície de preview/UI declarava ELEGÍVEL exatamente o que a execução
 * real recusava com `POLICY_ESCALATION_DENIED` — preview e execução discordavam, e a edição era
 * decidida sob política diferente da que o operador viu.
 *
 * Este teste prova as DUAS metades do requisito:
 *   (A) EQUIVALÊNCIA FUNCIONAL — para a mesma entrada, a decisão que a UI publica e a decisão que a
 *       execução aplica são a MESMA (nunca "elegível no preview, recusado na execução");
 *   (B) ENFORCEMENT ESTRUTURAL — nenhum caminho pode recalcular política por conta própria: todo
 *       arquivo que avalia autoaprovação precisa obter a política da autoridade única.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../api/services/engineeringMission/missionStoreService', () => ({
  getAutoApprovalPolicy: jest.fn(),
}));

/** Remove comentários: o texto explicativo cita o merge ingênuo e não pode virar "código". */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const missionStore = require('../../api/services/engineeringMission/missionStoreService');
const policyAuthority = require('../../api/services/engineeringMission/missionPolicyAuthority');
const { DEFAULT_POLICY } = require('../../engine/engineeringMission/autoApprovalPolicy');

const SERVICES_DIR = path.join(__dirname, '..', '..', 'api', 'services', 'engineeringMission');
const AUTHORITY_FILE = 'missionPolicyAuthority.js';

const GLOBAL_POLICY = Object.freeze({
  ...DEFAULT_POLICY,
  enabled: true,
  mode: 'POLICY_BASED',
  maxRisk: 'MEDIUM',
  confidenceThreshold: 0.75,
});

const SAFE_ENRICHMENT = Object.freeze({
  risk: 'LOW',
  confidence: 0.95,
  missionType: 'TECH_DEBT',
  derivedRequirements: [],
});

const SAFE_SPEC = Object.freeze({
  version: 1,
  risk: 'LOW',
  confidence: 0.95,
  missionType: 'TECH_DEBT',
  repository: 'r-agent2',
  branch: 'main',
  scope: 'SMALL',
  derivedRequirements: [],
});

/**
 * Matriz adversarial: cada caso declara a política pedida pela missão e o que se espera.
 * O ponto do teste NÃO é só "o resolver decide certo" (isso tem teste próprio) e sim que a
 * superfície de UI e a de execução derivam a MESMA decisão.
 */
const CASES = [
  { id: 'T1-restricao-de-risco', requested: { maxRisk: 'LOW' }, authorized: [false, true], expectAllowed: true },
  { id: 'T2-restricao-de-threshold', requested: { confidenceThreshold: 0.95 }, authorized: [false, true], expectAllowed: true },
  { id: 'T3-branches-mais-restritivas', requested: { allowedBranches: ['main'] }, authorized: [false, true], expectAllowed: true },
  { id: 'T4-escalacao-de-risco', requested: { maxRisk: 'CRITICAL' }, authorized: [false], expectAllowed: false },
  { id: 'T5-escalacao-de-threshold', requested: { confidenceThreshold: 0.1 }, authorized: [false], expectAllowed: false },
  { id: 'T6-lista-global-restrita-e-missao-amplia', requested: { allowedRepositories: [] }, globalOverride: { allowedRepositories: ['r-agent2'] }, authorized: [false], expectAllowed: false },
  { id: 'T7-escalacao-mista', requested: { maxRisk: 'CRITICAL', confidenceThreshold: 0.1 }, authorized: [false], expectAllowed: false },
];

describe('POLICY_RESOLVER_ALL_PATHS — autoridade única', () => {
  beforeEach(() => {
    // `resetMocks: true` no jest.config.cjs: re-declarar a cada teste.
    missionStore.getAutoApprovalPolicy.mockReset();
    missionStore.getAutoApprovalPolicy.mockResolvedValue({ ...GLOBAL_POLICY });
  });

  describe('(A) equivalência funcional preview × execução', () => {
    it.each(CASES)('$id — a decisão publicada e a decisão aplicada coincidem', async (testCase) => {
      if (testCase.globalOverride) {
        missionStore.getAutoApprovalPolicy.mockResolvedValue({ ...GLOBAL_POLICY, ...testCase.globalOverride });
      }
      for (const authorized of testCase.authorized) {
        const resolution = await policyAuthority.resolvePolicyForMission({
          mission: { id: 'm-1', auto_approval_policy: testCase.requested },
          actor: 'admin@results',
          policyEscalationAuthorized: authorized,
        });

        // VIA UI (missionApprovalService.evaluatePolicyForMission).
        const autoApproval = resolution.evaluate({
          spec: SAFE_SPEC,
          enrichment: SAFE_ENRICHMENT,
          repository: SAFE_SPEC.repository,
          branch: SAFE_SPEC.branch,
        });
        const denialBlocker = policyAuthority.policyDenialBlocker(resolution);
        const uiEligible = denialBlocker ? false : autoApproval.eligible;

        // VIA EXECUÇÃO (missionCompilerService.enrichMission).
        let executionPolicy = null;
        let executionDenied = false;
        let executionCode = null;
        try {
          executionPolicy = policyAuthority.requireAuthorizedPolicy(resolution, 'm-1');
        } catch (error) {
          executionDenied = true;
          executionCode = error.code;
        }

        expect(executionDenied).toBe(!uiEligible || (denialBlocker !== null));
        if (testCase.expectAllowed) {
          expect(denialBlocker).toBeNull();
          expect(executionDenied).toBe(false);
          expect(executionPolicy).not.toBeNull();
        } else {
          expect(denialBlocker).not.toBeNull();
          expect(denialBlocker.code).toBe('POLICY_ESCALATION_DENIED');
          expect(executionDenied).toBe(true);
          expect(executionCode).toBe('POLICY_ESCALATION_DENIED');
        }
      }
    });

    it('T8 — política idêntica à da instalação é permitida nas duas vias', async () => {
      const resolution = await policyAuthority.resolvePolicyForMission({
        mission: {
          id: 'm-1',
          auto_approval_policy: { maxRisk: GLOBAL_POLICY.maxRisk, confidenceThreshold: GLOBAL_POLICY.confidenceThreshold },
        },
        policyEscalationAuthorized: false,
      });
      expect(resolution.decision).toBe('ALLOW');
      expect(policyAuthority.policyDenialBlocker(resolution)).toBeNull();
      expect(policyAuthority.requireAuthorizedPolicy(resolution, 'm-1')).toEqual(resolution.effectivePolicy);
    });

    it('T9 — escalação AUTORIZADA nos dois lados é permitida nas duas vias, com a política pedida efetiva', async () => {
      missionStore.getAutoApprovalPolicy.mockResolvedValue({ ...GLOBAL_POLICY, allowPolicyEscalation: true });
      const resolution = await policyAuthority.resolvePolicyForMission({
        mission: { id: 'm-1', auto_approval_policy: { maxRisk: 'HIGH' } },
        actor: 'admin@results',
        policyEscalationAuthorized: true,
      });
      expect(resolution.decision).toBe('ALLOW');
      expect(resolution.escalationAuthorized).toBe(true);
      expect(resolution.effectivePolicy.maxRisk).toBe('HIGH');
      expect(policyAuthority.policyDenialBlocker(resolution)).toBeNull();
      expect(policyAuthority.requireAuthorizedPolicy(resolution, 'm-1').maxRisk).toBe('HIGH');
    });

    it('T10 — identidade administrativa sem permissão da política continua DENY (os dois lados exigidos)', async () => {
      const resolution = await policyAuthority.resolvePolicyForMission({
        mission: { id: 'm-1', auto_approval_policy: { maxRisk: 'CRITICAL' } },
        actor: 'admin@results',
        policyEscalationAuthorized: true, // identidade OK, política NÃO permite
      });
      expect(resolution.decision).toBe('DENY');
      expect(resolution.escalationAuthorized).toBe(false);
      expect(resolution.reason).toMatch(/não permite escalação/);
    });

    it('T11 — escalação negada NUNCA produz política mais ampla que a da instalação', async () => {
      const resolution = await policyAuthority.resolvePolicyForMission({
        mission: { id: 'm-1', auto_approval_policy: { maxRisk: 'CRITICAL', confidenceThreshold: 0.01, enabled: true, mode: 'POLICY_BASED' } },
        policyEscalationAuthorized: false,
      });
      expect(resolution.decision).toBe('DENY');
      expect(resolution.effectivePolicy.maxRisk).toBe(GLOBAL_POLICY.maxRisk);
      expect(resolution.effectivePolicy.confidenceThreshold).toBe(GLOBAL_POLICY.confidenceThreshold);
    });

    it('T12 — a resolução carrega a evidência exigida (global, pedida, efetiva, diferenças, decisão, motivo)', async () => {
      const resolution = await policyAuthority.resolvePolicyForMission({
        mission: { id: 'm-1', auto_approval_policy: { maxRisk: 'CRITICAL' } },
        policyEscalationAuthorized: false,
      });
      expect(resolution.globalPolicy.maxRisk).toBe('MEDIUM');
      expect(resolution.requestedPolicy.maxRisk).toBe('CRITICAL');
      expect(resolution.effectivePolicy.maxRisk).toBe('MEDIUM');
      expect(resolution.escalations.map((e) => e.axis)).toContain('maxRisk');
      expect(resolution.decision).toBe('DENY');
      expect(typeof resolution.reason).toBe('string');
      expect(resolution.evaluatedAt).toBeTruthy();
    });

    it('T13 — missão sem política declarada usa exatamente a política da instalação', async () => {
      const resolution = await policyAuthority.resolvePolicyForMission({
        mission: { id: 'm-1', auto_approval_policy: null },
        policyEscalationAuthorized: false,
      });
      expect(resolution.decision).toBe('ALLOW');
      expect(resolution.escalations).toHaveLength(0);
      expect(resolution.effectivePolicy.maxRisk).toBe(GLOBAL_POLICY.maxRisk);
    });
  });

  describe('(B) enforcement estrutural — nenhum caminho recalcula política', () => {
    const serviceFiles = fs.readdirSync(SERVICES_DIR).filter((f) => f.endsWith('.js'));

    it('todo serviço que avalia autoaprovação obtém a política da autoridade única', () => {
      const offenders = [];
      for (const file of serviceFiles) {
        if (file === AUTHORITY_FILE) continue;
        const source = stripComments(fs.readFileSync(path.join(SERVICES_DIR, file), 'utf8'));
        const evaluatesAutoApproval = /evaluateAutoApproval\s*\(/.test(source);
        if (!evaluatesAutoApproval) continue;
        const usesAuthority = source.includes('policyAuthority') || source.includes('resolvePolicyForMission');
        if (!usesAuthority) offenders.push(file);
      }
      expect(offenders).toEqual([]);
    });

    it('nenhum serviço faz merge ingênuo da política declarada pela missão', () => {
      const offenders = [];
      for (const file of serviceFiles) {
        if (file === AUTHORITY_FILE) continue;
        const source = stripComments(fs.readFileSync(path.join(SERVICES_DIR, file), 'utf8'));
        // `{ ...policy, ...mission.auto_approval_policy }` e variantes diretas.
        if (/\.\.\.\s*\(?\s*mission\.auto_approval_policy/.test(source)) offenders.push(file);
      }
      expect(offenders).toEqual([]);
    });

    it('o motor permanece PURO — a autoridade é quem resolve, o engine apenas decide', () => {
      const engineSource = fs.readFileSync(
        path.join(__dirname, '..', '..', 'engine', 'engineeringMission', 'policyResolver.js'),
        'utf8',
      );
      expect(engineSource).not.toMatch(/require\(.*missionStoreService/);
      expect(engineSource).not.toMatch(/new Date\(/);
    });
  });
});
