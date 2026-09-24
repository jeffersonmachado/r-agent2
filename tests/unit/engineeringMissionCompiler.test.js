'use strict';

/**
 * Engineering Mission Compiler — enriquecimento, versionamento, aprovação e status (núcleo puro).
 *
 * Cobre os requisitos TEST 31–42 (parte determinística) e as invariantes de bypass:
 *   TEST 31 missão simples é enriquecida
 *   TEST 32 originalMission permanece inalterada
 *   TEST 33 enriquecimento gera provenance
 *   TEST 34 preview mostra corretamente os campos adicionados
 *   TEST 35 modo MANUAL não executa antes da aprovação
 *   TEST 36 aprovação gera versão/hash persistente
 *   TEST 37 AUTO_APPROVAL SAFE_ONLY aprova missão elegível
 *   TEST 38 AUTO_APPROVAL bloqueia missão acima do risco permitido
 *   TEST 39 alteração material cria nova MissionSpec
 *   TEST 40 MissionSpec antiga não é executada depois de nova versão aprovada
 *   TEST 41 continuous enrichment gera novo diff
 *   TEST 42 mudança crítica exige aprovação humana conforme política
 *   TEST 45 approval bypass falha
 *   TEST 46 modificar MissionSpec aprovada silenciosamente falha
 */

const {
  MISSION_STATES,
  DISPLAY_STATUSES,
  MISSION_FAILURE_CODES,
} = require('../../engine/engineeringMission/constants');
const {
  createSpec,
  createNextVersion,
  diffSpecs,
  computeSpecHash,
  assertExecutableVersion,
  assertOriginalMissionImmutable,
} = require('../../engine/engineeringMission/missionSpec');
const { buildEnrichment, inferMissionType, detectContradictions } = require('../../engine/engineeringMission/enrichmentBuilder');
const { evaluateAutoApproval } = require('../../engine/engineeringMission/autoApprovalPolicy');
const { classifyMateriality } = require('../../engine/engineeringMission/materiality');
const { buildEnrichmentPreview, summarizePreview } = require('../../engine/engineeringMission/missionPreview');
const { deriveDisplayStatus, describeStatus } = require('../../engine/engineeringMission/missionStatus');

const MISSION_ID = '11111111-2222-3333-4444-555555555555';
const RAW_MISSION = 'Corrija definitivamente a importação do EVO e deixe tudo verde.';

/** Fatos de contexto reais (shape entregue pelo coletor de contexto — ver serviço). */
const FACTS_DB_MULTITENANT = {
  repository: 'r-agent2',
  branch: 'main',
  subsystems: ['api/import', 'api/db'],
  touchesDatabase: true,
  touchesSchema: true,
  touchesMultiTenant: true,
  isReleaseBlocker: true,
  contextSources: ['REPOSITORY_INSPECTION'],
  evidenceRefs: [{ path: 'api/services/evoImportService.js', kind: 'file' }],
};

function enrichedSpec(overrides = {}, factsOverrides = {}, intentOverrides = {}) {
  const facts = { ...FACTS_DB_MULTITENANT, ...factsOverrides };
  const enrichment = buildEnrichment({
    missionId: MISSION_ID,
    originalMission: RAW_MISSION,
    intent: { objective: 'Eliminar falhas de importação EVO', ...intentOverrides },
    contextFacts: facts,
    memory: { previousOccurrences: 0 },
  });
  const spec = createSpec({
    missionId: MISSION_ID,
    originalMission: RAW_MISSION,
    missionType: enrichment.missionType,
    objective: enrichment.objective,
    repository: facts.repository,
    branch: facts.branch,
    scope: 'MEDIUM',
    constraints: [],
    acceptanceCriteria: enrichment.acceptanceCriteria,
    derivedRequirements: enrichment.derivedRequirements,
    testStrategy: enrichment.testStrategy,
    assumptions: enrichment.assumptions,
    contextSources: enrichment.contextSources,
    subsystems: enrichment.subsystems,
    risk: enrichment.risk,
    confidence: enrichment.confidence,
    enrichmentPolicyVersion: enrichment.enrichmentPolicyVersion,
    ...overrides,
  });
  return { spec, enrichment, facts };
}

describe('EngineeringMission — enriquecimento e determinismo', () => {
  test('TEST 31: missão em linguagem natural é enriquecida com contexto real', () => {
    const { spec, enrichment } = enrichedSpec();
    expect(enrichment.derivedRequirements.length).toBeGreaterThan(0);
    expect(spec.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(spec.testStrategy.length).toBeGreaterThan(0);
    // A intenção original está preservada literalmente.
    expect(spec.originalMission).toBe(RAW_MISSION);
    // Risco/confiança são consequência dos fatos, não decoração.
    expect(['HIGH', 'CRITICAL']).toContain(spec.risk);
    expect(spec.confidence).toBeGreaterThan(0);
  });

  test('ENRICHMENT_DETERMINISTIC_AND_IDEMPOTENT: mesmos fatos ⇒ mesmo enriquecimento', () => {
    const a = buildEnrichment({ missionId: MISSION_ID, originalMission: RAW_MISSION, contextFacts: FACTS_DB_MULTITENANT });
    const b = buildEnrichment({ missionId: MISSION_ID, originalMission: RAW_MISSION, contextFacts: FACTS_DB_MULTITENANT });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.derivedRequirements.map((r) => r.id)).toEqual(b.derivedRequirements.map((r) => r.id));
  });

  test('ENRICHMENT_SOURCES: cada requisito derivado aponta para política/conhecimento auditável', () => {
    const { enrichment } = enrichedSpec();
    for (const req of enrichment.derivedRequirements) {
      expect(req.source).toBeTruthy();
      expect(req.ruleId).toBeTruthy();
      expect(['POLICY_REQUIRED', 'INFERRED']).toContain(req.enrichmentType);
    }
    expect(enrichment.derivedRequirements.map((r) => r.ruleId)).toContain('TENANT_ISOLATION');
    expect(enrichment.derivedRequirements.map((r) => r.ruleId)).toContain('DATABASE_MIGRATION');
  });

  test('TEST 33: enriquecimento gera provenance com motivo, fonte, confiança e risco', () => {
    const { enrichment } = enrichedSpec();
    expect(enrichment.provenance.length).toBe(enrichment.derivedRequirements.length + (enrichment.subsystems.length ? 0 : 0) + (enrichment.objective ? 1 : 0));
    for (const p of enrichment.provenance) {
      expect(p).toEqual(expect.objectContaining({
        field: expect.any(String),
        enrichmentType: expect.any(String),
        reason: expect.any(String),
        source: expect.any(String),
      }));
      expect(p.reason).not.toMatch(/como (um|uma) (modelo|IA)/i);
    }
    const tenant = enrichment.provenance.find((p) => p.ruleId === 'TENANT_ISOLATION');
    expect(tenant).toEqual(expect.objectContaining({
      enrichmentType: 'POLICY_REQUIRED',
      source: 'TENANCY_POLICY',
      riskImpact: 'HIGH',
      confidence: 1,
    }));
  });

  test('ENRICHMENT_CONTRADICTION: texto que contradiz política é detectado de forma explícita', () => {
    const contradictions = detectContradictions('Corrija o import sem migration', { touchesSchema: true });
    expect(contradictions.length).toBeGreaterThan(0);
    expect(contradictions[0].reason).toMatch(/migration/i);
  });

  test('ENRICHMENT_TYPE_INFERENCE: tipo de missão é inferido do texto (revisável, nunca oculto)', () => {
    expect(inferMissionType('corrija o bug de importação').missionType).toBe('BUG_FIX');
    expect(inferMissionType('adicione suporte a webhook').missionType).toBe('FEATURE');
    expect(inferMissionType('vulnerabilidade de injeção no importador').missionType).toBe('SECURITY');
    const { enrichment } = enrichedSpec();
    expect(enrichment.missionTypeInferred).toBe(true);
  });
});

describe('EngineeringMission — MissionSpec versionada', () => {
  test('TEST 32: originalMission permanece inalterada entre versões', () => {
    const { spec } = enrichedSpec();
    const v2 = createNextVersion(spec, { objective: 'Outro objetivo operacional' });
    expect(v2.originalMission).toBe(RAW_MISSION);
    expect(v2.version).toBe(2);

    expect(() => createNextVersion(spec, { originalMission: 'troque a intenção do usuário' }))
      .toThrow(/imutável|originalMission/i);

    expect(() => assertOriginalMissionImmutable(spec, { ...spec, originalMission: 'outra coisa' }))
      .toThrow(/imutável/i);
  });

  test('ORIGINAL_MISSION_FAILURE_CODE: a violação tem código estruturado', () => {
    const { spec } = enrichedSpec();
    try {
      createNextVersion(spec, { originalMission: 'x' });
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err.code).toBe(MISSION_FAILURE_CODES.ORIGINAL_MISSION_MUTATED);
    }
  });

  test('TEST 36: hash/versão são determinísticos e independentes da ordem das chaves', () => {
    const { spec } = enrichedSpec();
    expect(spec.specHash).toBe(computeSpecHash(spec));
    const reordered = { ...spec };
    const shuffled = {};
    for (const key of Object.keys(reordered).reverse()) shuffled[key] = reordered[key];
    expect(computeSpecHash(shuffled)).toBe(spec.specHash);
    const other = createSpec({
      missionId: MISSION_ID,
      originalMission: 'outra missão',
      risk: 'LOW',
      confidence: 0.9,
    });
    expect(other.specHash).not.toBe(spec.specHash);
    expect(other.version).toBe(1);
  });

  test('SPEC_INVALID_INPUT: risk/missionType/tipo inválidos falham fechado', () => {
    expect(() => createSpec({ missionId: MISSION_ID, originalMission: RAW_MISSION, missionType: 'NAO_EXISTE' })).toThrow(/missionType inválido/);
    expect(() => createSpec({ missionId: MISSION_ID, originalMission: RAW_MISSION, risk: 'URGENTE' })).toThrow(/risk inválido/);
    expect(() => createSpec({ missionId: MISSION_ID, originalMission: '' })).toThrow(/originalMission/i);
  });

  test('TEST 39: alteração material cria nova MissionSpec versionada', () => {
    const { spec, enrichment } = enrichedSpec();
    const nextEnrichment = buildEnrichment({
      missionId: MISSION_ID,
      originalMission: RAW_MISSION,
      contextFacts: { ...FACTS_DB_MULTITENANT, touchesSecrets: true, touchesAuth: true },
    });
    const v2 = createNextVersion(spec, {
      derivedRequirements: nextEnrichment.derivedRequirements,
      acceptanceCriteria: nextEnrichment.acceptanceCriteria,
      risk: nextEnrichment.risk,
      confidence: nextEnrichment.confidence,
    });
    const changes = diffSpecs(spec, v2);
    const materiality = classifyMateriality({ previousSpec: spec, nextSpec: v2, enrichment: nextEnrichment, changes });
    expect(v2.version).toBe(2);
    expect(changes.map((c) => c.field)).toEqual(expect.arrayContaining(['derivedRequirements', 'risk']));
    expect(materiality.level).toBe('CRITICAL');
    expect(materiality.reasons.map((r) => r.code)).toContain('CRITICAL_REQUIREMENT_INTRODUCED');
    expect(enrichment.derivedRequirements.length).toBeLessThan(nextEnrichment.derivedRequirements.length);
  });

  test('TEST 41: continuous enrichment produz novo diff sem tocar a intenção original', () => {
    const { spec } = enrichedSpec();
    const reEnriched = buildEnrichment({
      missionId: MISSION_ID,
      originalMission: RAW_MISSION,
      contextFacts: { ...FACTS_DB_MULTITENANT, isReleaseBlocker: false, touchesPerformanceSensitive: true },
    });
    const v2 = createNextVersion(spec, {
      derivedRequirements: reEnriched.derivedRequirements,
      acceptanceCriteria: reEnriched.acceptanceCriteria,
      testStrategy: reEnriched.testStrategy,
      risk: reEnriched.risk,
      confidence: reEnriched.confidence,
    });
    const changes = diffSpecs(spec, v2);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some((c) => c.field === 'originalMission')).toBe(false);
    expect(v2.originalMission).toBe(spec.originalMission);
  });

  test('MATERIALITY_NON_MATERIAL: acrescentar teste/observabilidade não escala materialidade', () => {
    const { spec } = enrichedSpec();
    const v2 = createNextVersion(spec, { testStrategy: [...spec.testStrategy, 'adversarial', 'e2e'] });
    const materiality = classifyMateriality({ previousSpec: spec, nextSpec: v2, enrichment: {}, changes: diffSpecs(spec, v2) });
    expect(materiality.level).toBe('NON_MATERIAL');
  });

  test('MATERIALITY_CRITICAL_ACCEPTANCE_REMOVAL: remover critério de aceite é CRITICAL', () => {
    const { spec } = enrichedSpec();
    const v2 = createNextVersion(spec, { acceptanceCriteria: spec.acceptanceCriteria.slice(1) });
    const materiality = classifyMateriality({ previousSpec: spec, nextSpec: v2, enrichment: {}, changes: diffSpecs(spec, v2) });
    expect(materiality.level).toBe('CRITICAL');
    expect(materiality.reasons.map((r) => r.code)).toContain('ACCEPTANCE_CRITERION_REMOVED');
  });
});

describe('EngineeringMission — aprovação e anti-bypass', () => {
  test('TEST 35: modo MANUAL nunca autoaprova', () => {
    const { spec, enrichment } = enrichedSpec();
    const decision = evaluateAutoApproval({ policy: { enabled: true, mode: 'MANUAL' }, spec, enrichment, branch: 'main' });
    expect(decision.eligible).toBe(false);
    expect(decision.blockers.map((b) => b.code)).toContain('MODE_MANUAL');
  });

  test('TEST 35b: sem aprovação registrada, execução é bloqueada', () => {
    const { spec } = enrichedSpec();
    expect(() => assertExecutableVersion({ mission: { id: MISSION_ID }, approval: null, currentSpec: spec }))
      .toThrow(/aprovação/i);
  });

  test('TEST 37: AUTO_APPROVAL SAFE_ONLY aprova missão elegível de baixo risco', () => {
    const facts = {
      repository: 'r-agent2',
      branch: 'main',
      subsystems: ['lib/format'],
      contextSources: ['REPOSITORY_INSPECTION'],
      evidenceRefs: [{ path: 'lib/format.js', kind: 'file' }],
    };
    const enrichment = buildEnrichment({
      missionId: MISSION_ID,
      originalMission: 'Remova código morto do formatador e cubra com testes',
      contextFacts: facts,
    });
    const spec = createSpec({
      missionId: MISSION_ID,
      originalMission: 'Remova código morto do formatador e cubra com testes',
      missionType: 'TECH_DEBT',
      objective: enrichment.objective,
      repository: 'r-agent2',
      branch: 'main',
      scope: 'SMALL',
      acceptanceCriteria: enrichment.acceptanceCriteria,
      derivedRequirements: enrichment.derivedRequirements,
      testStrategy: enrichment.testStrategy,
      contextSources: enrichment.contextSources,
      subsystems: enrichment.subsystems,
      risk: 'LOW',
      confidence: 0.9,
    });
    const decision = evaluateAutoApproval({ policy: { enabled: true, mode: 'SAFE_ONLY' }, spec, enrichment: { ...enrichment, risk: 'LOW', confidence: 0.9, missionType: 'TECH_DEBT' }, branch: 'main' });
    expect(decision.eligible).toBe(true);
    expect(decision.blockers).toEqual([]);
    expect(decision.mode).toBe('SAFE_ONLY');
    expect(decision.rulesEvaluated).toContain('SAFE_ONLY_REVERSIBLE_TYPES');
  });

  test('TEST 38: AUTO_APPROVAL bloqueia missão acima do risco permitido', () => {
    const { spec, enrichment } = enrichedSpec();
    const highRisk = evaluateAutoApproval({
      policy: { enabled: true, mode: 'POLICY_BASED', maxRisk: 'MEDIUM', confidenceThreshold: 0.5 },
      spec,
      enrichment,
      branch: 'main',
    });
    expect(highRisk.eligible).toBe(false);
    expect(highRisk.blockers.map((b) => b.code)).toContain('RISK_ABOVE_POLICY');

    const safeOnly = evaluateAutoApproval({
      policy: { enabled: true, mode: 'SAFE_ONLY', confidenceThreshold: 0.5 },
      spec,
      enrichment,
      branch: 'main',
    });
    expect(safeOnly.eligible).toBe(false);
    expect(safeOnly.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(['MISSION_TYPE_NOT_ALLOWED', 'POLICY_REQUIREMENTS_NOT_ALLOWED']));
  });

  test('TEST 42: mudança crítica exige aprovação humana mesmo com autoaprovação habilitada', () => {
    const { spec, enrichment } = enrichedSpec({}, { touchesSecrets: true, touchesCredentials: true });
    const decision = evaluateAutoApproval({
      policy: { enabled: true, mode: 'POLICY_BASED', maxRisk: 'CRITICAL', confidenceThreshold: 0.1 },
      spec,
      enrichment,
      branch: 'main',
    });
    expect(decision.eligible).toBe(false);
    expect(decision.blockers.map((b) => b.code)).toContain('SECRET_EXPOSURE');
    const materiality = classifyMateriality({ previousSpec: null, nextSpec: spec, enrichment });
    expect(materiality.level).toBe('MATERIAL');
  });

  test('AUTO_APPROVAL_POLICY_CONSTRAINTS: confiança, tipo, repositório, branch e escopo são política', () => {
    const { spec, enrichment } = enrichedSpec();
    const decision = evaluateAutoApproval({
      policy: {
        enabled: true,
        mode: 'POLICY_BASED',
        maxRisk: 'CRITICAL',
        confidenceThreshold: 0.99,
        allowedMissionTypes: ['TECH_DEBT'],
        allowedRepositories: ['outro-repo'],
        allowedBranches: ['release'],
        allowedScopes: ['SMALL'],
        allowPolicyRequirements: false,
        allowDerivedRequirements: false,
      },
      spec,
      enrichment,
    });
    const codes = decision.blockers.map((b) => b.code);
    expect(decision.eligible).toBe(false);
    expect(codes).toEqual(expect.arrayContaining([
      'CONFIDENCE_BELOW_THRESHOLD',
      'MISSION_TYPE_NOT_ALLOWED',
      'REPOSITORY_NOT_ALLOWED',
      'BRANCH_NOT_ALLOWED',
      'SCOPE_NOT_ALLOWED',
      'POLICY_REQUIREMENTS_NOT_ALLOWED',
    ]));
  });

  test('TEST 45: approval bypass falha (PENDING, REJECTED, outra mission, sem approval)', () => {
    const { spec } = enrichedSpec();
    const base = { missionId: MISSION_ID, specVersion: 1, specHash: spec.specHash };
    expect(() => assertExecutableVersion({ mission: { id: MISSION_ID }, approval: { ...base, state: 'PENDING' }, currentSpec: spec }))
      .toThrow(/não autoriza execução/);
    expect(() => assertExecutableVersion({ mission: { id: MISSION_ID }, approval: { ...base, state: 'REJECTED' }, currentSpec: spec }))
      .toThrow(/não autoriza execução/);
    expect(() => assertExecutableVersion({ mission: { id: MISSION_ID }, approval: { ...base, state: 'APPROVED', missionId: 'outra' }, currentSpec: spec }))
      .toThrow(/outra mission/);
    expect(() => assertExecutableVersion({ mission: { id: MISSION_ID }, approval: { state: 'APPROVED', missionId: MISSION_ID }, currentSpec: spec }))
      .toThrow(/nenhuma aprovação/i);
  });

  test('TEST 40 + 46: versão nova ou spec alterada após aprovação não executam', () => {
    const { spec } = enrichedSpec();
    const approval = { missionId: MISSION_ID, specVersion: 1, specHash: spec.specHash, state: 'APPROVED' };
    expect(assertExecutableVersion({ mission: { id: MISSION_ID }, approval, currentSpec: spec })).toBe(true);

    const v2 = createNextVersion(spec, { confidence: 0.95 });
    try {
      assertExecutableVersion({ mission: { id: MISSION_ID }, approval, currentSpec: v2 });
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err.code).toBe(MISSION_FAILURE_CODES.MISSION_STALE_VERSION);
    }

    // Mesma versão, conteúdo diferente do aprovado (mutação silenciosa) ⇒ também bloqueado.
    const tampered = { ...spec, specHash: 'deadbeef' };
    try {
      assertExecutableVersion({ mission: { id: MISSION_ID }, approval, currentSpec: tampered });
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err.code).toBe(MISSION_FAILURE_CODES.MISSION_STALE_VERSION);
    }
  });
});

describe('EngineeringMission — preview e status (§7, §42)', () => {
  test('TEST 34: preview classifica corretamente o que foi adicionado', () => {
    const { spec, enrichment } = enrichedSpec();
    const preview = buildEnrichmentPreview({
      spec,
      enrichment,
      changes: diffSpecs(null, spec),
      materiality: { level: 'MATERIAL', reasons: [] },
      autoApproval: evaluateAutoApproval({ policy: { enabled: false }, spec, enrichment }),
    });
    expect(preview.original.mission).toBe(RAW_MISSION);
    expect(preview.enriched.objective).toBe('Eliminar falhas de importação EVO');
    const policySection = preview.sections.find((s) => s.category === 'POLICY_REQUIRED');
    expect(policySection.items.length).toBeGreaterThan(0);
    expect(preview.counts.POLICY_REQUIRED).toBeGreaterThan(0);
    expect(preview.counts.UNCHANGED).toBeGreaterThan(0);
    expect(preview.autoApproval.eligible).toBe(false);
    // Todo item do preview tem provenance objetiva e nunca raciocínio interno.
    for (const section of preview.sections) {
      for (const item of section.items) {
        expect(item.source).toBeTruthy();
        expect(item.reason).toBeTruthy();
      }
    }
    expect(summarizePreview(preview)).toMatch(/Missão original/);
  });

  test('STATUS_NO_LIE: cada estado exibido é distinto e explicado', () => {
    for (const s of DISPLAY_STATUSES) expect(typeof describeStatus(s)).toBe('string');
    expect(deriveDisplayStatus({ id: MISSION_ID, status: 'APPROVED', approvalState: 'APPROVED' })).toBe('APPROVED');
    expect(deriveDisplayStatus({ id: MISSION_ID, status: 'APPROVED', approvalState: 'AUTO_APPROVED' })).toBe('AUTO_APPROVED');
    expect(deriveDisplayStatus({ id: MISSION_ID, status: 'ENRICHING' })).toBe('ENRICHING');
    expect(deriveDisplayStatus({ id: MISSION_ID, status: 'AWAITING_APPROVAL' })).toBe('AWAITING_APPROVAL');
    expect(deriveDisplayStatus({ id: MISSION_ID, status: 'EXECUTING' }, null)).toBe('RUNNING');
    expect(deriveDisplayStatus({ id: MISSION_ID, status: 'EXECUTING' }, { status: 'CODING' })).toBe('RUNNING');
    expect(deriveDisplayStatus({ id: MISSION_ID, status: 'EXECUTING' }, { status: 'GREEN' })).toBe('GREEN');
    // READY_FOR_PROMOTION NUNCA é GREEN — é progresso degradado, exatamente como no Router.
    expect(deriveDisplayStatus({ id: MISSION_ID, status: 'EXECUTING' }, { status: 'READY_FOR_PROMOTION' })).toBe('DEGRADED');
    expect(deriveDisplayStatus({ id: MISSION_ID, status: 'EXECUTING' }, { status: 'RED' })).toBe('FAILED');
    expect(deriveDisplayStatus({ id: MISSION_ID, status: 'EXECUTING' }, { status: 'CANCELLED' })).toBe('CANCELLED');
  });

  test('STATUS_VOCABULARY: estados canônicos de missão são declarados e usados', () => {
    expect(MISSION_STATES).toEqual(expect.arrayContaining([
      'CREATED', 'ENRICHING', 'AWAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'GREEN', 'BLOCKED', 'FAILED',
    ]));
    expect(DISPLAY_STATUSES).not.toContain('ENRICHED_AND_APPROVED');
  });
});
