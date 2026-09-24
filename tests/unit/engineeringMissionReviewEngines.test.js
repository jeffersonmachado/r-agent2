'use strict';

/**
 * Meta Reviewer (§23) e Adversarial Review (§24) — motores puros, cada check com caso positivo e
 * caso negativo. Um check que não consegue reprovar um artefato ruim é um check inútil: por isso
 * TODO check testado aqui aparece nas duas direções.
 */

const { runMetaReview, SEVERITY, REQUIRED_GATES_FOR_GREEN } = require('../../engine/engineeringMission/metaReview');
const { ADVERSARIAL_CASES, evaluateAdversarialCoverage } = require('../../engine/engineeringMission/adversarialReview');

const MISSION_ID = '11111111-2222-3333-4444-555555555555';
const SPEC_HASH = 'a'.repeat(64);

function parserAvailable() {
  try { require.resolve('@babel/parser'); return true; } catch (_) { return false; }
}

/** Bundle saudável — base para os casos negativos. */
function healthyBundle(overrides = {}) {
  return {
    mission: { id: MISSION_ID, status: 'GREEN', approvalState: 'APPROVED' },
    spec: {
      version: 2,
      specHash: SPEC_HASH,
      objective: 'corrigir soma',
      risk: 'LOW',
      missionType: 'BUG_FIX',
      originalMission: 'Corrija o defeito',
      acceptanceCriteria: [{ id: 'DR-A', text: 'validar tenant isolation' }],
      derivedRequirements: [{ id: 'DR-A', text: 'validar tenant isolation' }],
      subsystems: ['api/services'],
    },
    approvals: [{ state: 'APPROVED', specVersion: 2, specHash: SPEC_HASH, mode: 'MANUAL' }],
    versions: [{ version: 1 }, { version: 2, materiality: 'MATERIAL' }],
    task: { id: 'task-1', status: 'GREEN', acceptanceCriteria: [{ text: 'validar tenant isolation' }] },
    attempts: [{ status: 'DONE', coderProvider: 'anthropic', coderModel: 'claude', patchDiff: '' }],
    testRuns: [{ command: 'npx jest DR-A --no-coverage', status: 'PASS', exitCode: 0, stdoutExcerpt: 'DR-A ok' }],
    reviews: [{ decision: 'APPROVE', independentOfCoder: true, reviewerProvider: 'mistral', reviewerModel: 'large' }],
    gates: REQUIRED_GATES_FOR_GREEN.map((id) => ({ id, status: 'PASS', evidence: { ref: `${id}.json` } })),
    claims: [{ text: 'gates executados', evidence: [{ gate: 'unit' }] }],
    changedFiles: ['api/services/engineeringMission/missionStoreService.js'],
    fileContents: new Map(),
    ...overrides,
  };
}

function findingFor(result, checkId) {
  return result.findings.find((f) => f.checkId === checkId);
}

describe('metaReview — checks executáveis', () => {
  test('bundle saudável não produz blocking findings (NOT_VERIFIABLE nunca bloqueia)', () => {
    const result = runMetaReview(healthyBundle(), { policy: { internalEngineeringPaths: ['api/services/engineeringMission/'] } });
    expect(result.blocksGreen).toBe(false);
    expect(result.counts.blockers).toBe(0);
    expect(result.counts.regressions).toBe(0);
    // §23 exige ser explícito sobre o que NÃO foi verificado: o status nunca colapsa em PASS cego.
    expect(result.status).toBe('INCOMPLETE');
    expect(result.counts.notVerifiable).toBeGreaterThan(0);
    expect(findingFor(result, 'NO_DEAD_CODE').mechanism).toMatch(/eslint|depcheck|lint/);
  });

  test('MR-02 reprova quando a versão executada difere da aprovada', () => {
    const bundle = healthyBundle({ approvals: [{ state: 'APPROVED', specVersion: 1, specHash: 'b'.repeat(64), mode: 'MANUAL' }] });
    const result = runMetaReview(bundle);
    const f = findingFor(result, 'EXECUTED_MATCHES_APPROVED_SPEC');
    expect(f.status).toBe('FAIL');
    expect(f.severity).toBe(SEVERITY.BLOCKER);
    expect(f.blocksGreen).toBe(true);
    expect(result.blocksGreen).toBe(true);
    expect(result.status).toBe('FAIL');
  });

  test('MR-03 reprova versão posterior à aprovada sem aprovação própria', () => {
    const bundle = healthyBundle({ versions: [{ version: 1 }, { version: 2 }, { version: 3, materiality: 'CRITICAL' }] });
    const result = runMetaReview(bundle);
    const f = findingFor(result, 'NO_MATERIAL_CHANGE_WITHOUT_APPROVAL');
    expect(f.status).toBe('FAIL');
    expect(f.evidence.map((e) => e.version)).toContain(3);
  });

  test('MR-04 reprova critério de aceite que não chegou ao contrato de execução', () => {
    const bundle = healthyBundle({ task: { id: 'task-1', status: 'GREEN', acceptanceCriteria: [] } });
    const result = runMetaReview(bundle);
    expect(findingFor(result, 'ACCEPTANCE_CRITERIA_PROPAGATED').status).toBe('FAIL');
  });

  test('MR-05 reprova requisito derivado sem evidência de tratamento', () => {
    const bundle = healthyBundle({
      spec: { ...healthyBundle().spec, derivedRequirements: [{ id: 'DR-NAO_TESTADO', text: 'x' }] },
      testRuns: [{ command: 'npx jest', status: 'PASS', exitCode: 0 }],
      gates: REQUIRED_GATES_FOR_GREEN.map((id) => ({ id, status: 'PASS', evidence: {} })),
    });
    const result = runMetaReview(bundle);
    const f = findingFor(result, 'GAPS_HAVE_EVIDENCE');
    expect(f.status).toBe('FAIL');
    expect(f.detail).toMatch(/DR-NAO_TESTADO/);
  });

  test('MR-06 reprova gate ausente ou não-PASS', () => {
    const bundle = healthyBundle({ gates: [{ id: 'unit', status: 'PASS', evidence: {} }] });
    const result = runMetaReview(bundle);
    const f = findingFor(result, 'GATES_EXECUTED');
    expect(f.status).toBe('FAIL');
    expect(f.detail).toMatch(/integration/);
  });

  test('MR-07 reprova remoção de asserção e de caso de teste', () => {
    const diff = [
      'diff --git a/tests/unit/x.test.js b/tests/unit/x.test.js',
      '--- a/tests/unit/x.test.js',
      '+++ b/tests/unit/x.test.js',
      '@@ -1,4 +1,3 @@',
      '-    expect(value).toBe(2);',
      '-  test(\'caso removido\', () => {});',
      '+    // nada',
    ].join('\n');
    const result = runMetaReview(healthyBundle({ attempts: [{ status: 'DONE', patchDiff: diff }] }));
    const f = findingFor(result, 'TESTS_NOT_WEAKENED');
    expect(f.status).toBe('FAIL');
    expect(f.severity).toBe(SEVERITY.BLOCKER);
    expect(f.evidence.length).toBeGreaterThanOrEqual(2);
  });

  test('MR-08 reprova teste desligado (.skip/.only) adicionado', () => {
    const diff = [
      '+++ b/tests/unit/y.test.js',
      '@@ -1,0 +1,2 @@',
      '+  test.skip(\'ignora\', () => {});',
      '+  describe.only(\'só este\', () => {});',
    ].join('\n');
    const result = runMetaReview(healthyBundle({ attempts: [{ status: 'DONE', patchDiff: diff }] }));
    const f = findingFor(result, 'NO_TEST_SUPPRESSION');
    expect(f.status).toBe('FAIL');
    expect(f.evidence).toHaveLength(2);
  });

  test('MR-09 reprova segredo adicionado no patch', () => {
    const diff = [
      '+++ b/api/services/x.js',
      '@@ -1,0 +1,2 @@',
      '+const apiKey = "sk-abcdefghijklmnopqrstuvwx";',
      '+// -----BEGIN RSA PRIVATE KEY-----',
    ].join('\n');
    const result = runMetaReview(healthyBundle({ attempts: [{ status: 'DONE', patchDiff: diff }] }));
    const f = findingFor(result, 'NO_SECRETS_IN_PATCH');
    expect(f.status).toBe('FAIL');
    expect(f.severity).toBe(SEVERITY.BLOCKER);
    expect(result.blocksGreen).toBe(true);
  });

  test('MR-10 reprova catch vazio/silencioso (ou declara NOT_VERIFIABLE se faltar parser)', () => {
    const content = [
      "'use strict';",
      'async function load() {',
      '  try {',
      '    return await repo.read();',
      '  } catch (err) {',
      '    return null;',
      '  }',
      '}',
    ].join('\n');
    const diff = [
      '+++ b/api/services/x.js',
      '@@ -1,0 +1,8 @@',
      ...content.split('\n').map((l) => `+${l}`),
    ].join('\n');
    const result = runMetaReview(healthyBundle({
      attempts: [{ status: 'DONE', patchDiff: diff }],
      fileContents: new Map([['api/services/x.js', content]]),
    }));
    const f = findingFor(result, 'NO_SILENT_ERROR_HANDLING');
    if (parserAvailable()) {
      expect(f.status).toBe('FAIL');
      expect(f.title).toMatch(/retorno silencioso/);
      expect(f.evidence[0].kind).toBe('SILENT_RETURN_CATCH');
    } else {
      expect(f.status).toBe('NOT_VERIFIABLE');
      expect(f.mechanism).toMatch(/@babel\/parser|acorn/);
    }
  });

  test('MR-11 reprova flag que desliga funcionalidade para passar', () => {
    const diff = [
      '+++ b/api/services/x.js',
      '@@ -1,0 +1,2 @@',
      '+const VALIDATION_DISABLED = true;',
      '+process.env.SKIP_VALIDATION_DISABLE = "1";',
    ].join('\n');
    const result = runMetaReview(healthyBundle({ attempts: [{ status: 'DONE', patchDiff: diff }] }));
    expect(findingFor(result, 'NO_FEATURE_DISABLED_TO_PASS').status).toBe('FAIL');
  });

  test('MR-13 reprova risco alto sem review independente', () => {
    const bundle = healthyBundle({
      spec: { ...healthyBundle().spec, risk: 'HIGH' },
      reviews: [{ decision: 'APPROVE', independentOfCoder: false, reviewerProvider: 'anthropic' }],
    });
    const result = runMetaReview(bundle);
    expect(findingFor(result, 'INDEPENDENT_REVIEW_PRESENT').status).toBe('FAIL');
  });

  test('MR-14 reprova afirmação de conclusão sem evidência', () => {
    const bundle = healthyBundle({ claims: [{ text: 'tudo verde', evidence: [] }] });
    const result = runMetaReview(bundle);
    const f = findingFor(result, 'EVIDENCE_FOR_COMPLETION_CLAIMS');
    expect(f.status).toBe('FAIL');
    expect(f.severity).toBe(SEVERITY.BLOCKER);
  });

  test('MR-15 reprova duplicação de infraestrutura existente', () => {
    const bundle = healthyBundle({ changedFiles: ['api/services/engineeringRouter/engineeringProviderRegistry.js'] });
    const result = runMetaReview(bundle);
    const f = findingFor(result, 'NO_PARALLEL_INFRASTRUCTURE');
    expect(f.status).toBe('FAIL');
    expect(f.evidence[0].detail).toMatch(/registry de providers paralelo/);
  });

  test('MR-16 reprova rota nova sem enforcement de classificação', () => {
    const bundle = healthyBundle({
      changedFiles: ['api/modules/nova-area/routes.js'],
      fileContents: new Map([['api/modules/nova-area/routes.js', "router.get('/x', handler);"]]),
    });
    const result = runMetaReview(bundle);
    expect(findingFor(result, 'CLASSIFICATION_ENFORCED_ON_NEW_ROUTES').status).toBe('FAIL');
  });

  test('MR-17 reprova estado impossível: missão GREEN sem execução GREEN', () => {
    const bundle = healthyBundle({
      mission: { id: MISSION_ID, status: 'GREEN' },
      task: { id: 'task-1', status: 'READY_FOR_PROMOTION', acceptanceCriteria: [{ text: 'validar tenant isolation' }] },
    });
    const result = runMetaReview(bundle);
    const f = findingFor(result, 'NO_IMPOSSIBLE_STATES');
    expect(f.status).toBe('FAIL');
    expect(f.severity).toBe(SEVERITY.BLOCKER);
  });

  test('MR-18 reprova model alterado sem migration no mesmo patch', () => {
    const bundle = healthyBundle({
      changedFiles: ['api/db/models/EngineeringMission.js'],
      fileContents: new Map([['api/db/models/EngineeringMission.js', "id: { type: DataTypes.UUID }"]]),
    });
    const result = runMetaReview(bundle);
    expect(findingFor(result, 'MIGRATION_FOR_MODEL_CHANGE').status).toBe('FAIL');
  });

  test('MR-19 reprova leitura sem escopo em serviço tenant-facing e isenta infraestrutura interna', () => {
    const tenantFacing = healthyBundle({
      spec: { ...healthyBundle().spec, subsystems: ['api/services', 'multi-tenant'] },
      changedFiles: ['api/services/crmService.js'],
      fileContents: new Map([['api/services/crmService.js', 'const rows = await Model.findAll({ where: {} });']]),
    });
    const failing = runMetaReview(tenantFacing);
    expect(findingFor(failing, 'TENANT_SCOPING_PRESERVED').status).toBe('FAIL');

    const internal = healthyBundle({
      spec: { ...healthyBundle().spec, subsystems: ['api/services', 'multi-tenant'] },
      changedFiles: ['api/services/engineeringMission/missionStoreService.js'],
      fileContents: new Map([['api/services/engineeringMission/missionStoreService.js', 'const rows = await Mission.findAll({ where: { status } });']]),
    });
    const exempt = runMetaReview(internal, { policy: { internalEngineeringPaths: ['api/services/engineeringMission/'] } });
    expect(findingFor(exempt, 'TENANT_SCOPING_PRESERVED').status).toBe('PASS');
  });
});

describe('adversarialReview — catálogo com cobertura verificável', () => {
  test('catálogo declara ataques com teste permanente e defesa', () => {
    expect(ADVERSARIAL_CASES.length).toBeGreaterThanOrEqual(20);
    for (const c of ADVERSARIAL_CASES) {
      expect(c.attack).toBeTruthy();
      expect(c.target).toBeTruthy();
      expect(c.defense).toBeTruthy();
      expect(['BLOCKER', 'REGRESSION', 'POST_RELEASE']).toContain(c.severity);
      expect(c.permanentTest.path).toMatch(/^tests\//);
      expect(c.permanentTest.namePattern).toBeTruthy();
    }
    // IDs únicos — o catálogo é indexado por id em relatórios de auditoria.
    expect(new Set(ADVERSARIAL_CASES.map((c) => c.id)).size).toBe(ADVERSARIAL_CASES.length);
  });

  test('cobertura total ⇒ PASS e não bloqueia GREEN', () => {
    // readTest devolve TODOS os padrões do arquivo (um arquivo pode provar vários ataques).
    const allCovered = evaluateAdversarialCoverage(
      () => true,
      (p) => ADVERSARIAL_CASES.filter((c) => c.permanentTest.path === p).map((c) => c.permanentTest.namePattern).join('\n'),
    );
    expect(allCovered.uncovered).toHaveLength(0);
    expect(allCovered.status).toBe('PASS');
    expect(allCovered.blocksGreen).toBe(false);
    expect(allCovered.total).toBe(ADVERSARIAL_CASES.length);
  });

  test('ataque sem teste permanente ⇒ UNCOVERED e bloqueia GREEN', () => {
    const target = ADVERSARIAL_CASES[0];
    const result = evaluateAdversarialCoverage((p) => p !== target.permanentTest.path, () => null);
    expect(result.status).toBe('FAIL');
    expect(result.blocksGreen).toBe(true);
    expect(result.uncovered.map((c) => c.id)).toContain(target.id);
  });

  test('teste presente mas SEM o caso específico ⇒ também UNCOVERED (nome importa)', () => {
    const target = ADVERSARIAL_CASES[0];
    const result = evaluateAdversarialCoverage(() => true, () => 'arquivo existe mas não contém o caso');
    expect(result.uncovered.map((c) => c.id)).toContain(target.id);
  });

  test('ataques não automatizáveis ficam declarados, nunca omitidos', () => {
    const result = evaluateAdversarialCoverage(() => true, () => 'x');
    expect(result.notAutomatable.length).toBeGreaterThan(0);
    for (const a of result.notAutomatable) {
      expect(a.reason).toBeTruthy();
      expect(a.mechanism).toBeTruthy();
    }
  });
});
