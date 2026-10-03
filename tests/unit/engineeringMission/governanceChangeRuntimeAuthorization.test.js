'use strict';

/**
 * tests/unit/engineeringMission/governanceChangeRuntimeAuthorization.test.js
 *
 * LEGITIMATE_GOVERNANCE_CHANGE_RUNTIME — prova de que uma mudança LEGÍTIMA de governança
 * (aval humano explícito + motivo + reviewer independente) ATRAVESSA o runtime e fecha o
 * finding, e que todo o resto continua bloqueado.
 *
 * DEFEITO ELIMINADO (2026-10-03): `verifySelfModificationBaseline` chamava
 * `verifyRuleBaseline({ baseline, current })` SEM autorização. O motor recusa toda mudança
 * não autorizada (`GOVERNANCE_BASELINE_VIOLATION`), então um fix que alterava legitimamente
 * um gate — mesmo com aval humano — era recusado e o finding NUNCA fechava. O caminho de
 * mudança legítima existia apenas dentro do motor e nos testes do motor: nunca no runtime.
 *
 * Os testes abaixo exercitam a COSTURA (serviço → motor → persistência), não só o motor.
 */

const engine = require('../../../engine/engineeringMission/bugFinding/selfModification');

const mockGetFinding = jest.fn();
const mockRecordEvent = jest.fn(async () => ({}));
jest.mock('../../../api/services/engineeringMission/bugFindingService', () => ({
  getFinding: (...args) => mockGetFinding(...args),
  recordEvent: (...args) => mockRecordEvent(...args),
}));

const mockUpdate = jest.fn(async () => [1]);
jest.mock('../../../api/db/models/EngineeringBugFinding', () => () => ({ update: mockUpdate }));

const bugTriageService = require('../../../api/services/engineeringMission/bugTriageService');

/**
 * Semântica do diff (medida, não suposta): só ENFRAQUECIMENTO conta como violação —
 * remoção de gate/teste/requisito, arquivo de regra MODIFICADO (hash diferente) ou limiar
 * numérico reduzido. ACRESCENTAR é tightening e é legítimo.
 */
const BASELINE = {
  mandatoryGates: ['GATE_A'],
  testManifest: ['t1'],
  thresholds: { coverage: 80 },
  requirements: ['r1'],
  files: { 'config/engineering-gates.json': 'hash_v1' },
};
// Enfraquecimento real: o arquivo de regra foi reescrito (hash diferente).
const WEAKENED = { ...BASELINE, files: { 'config/engineering-gates.json': 'hash_v2' } };

function approval(overrides = {}) {
  return {
    actor: 'humano1',
    actorTypeVerified: 'human',
    policy: engine.HUMAN_ONLY_APPROVAL_POLICY,
    hasSpecificPermission: true,
    governanceChangeApproved: true,
    governanceChangeReason: 'a suite mudou de runner; o limiar antigo media outro conjunto',
    requiresIndependentReviewer: true,
    reviewer: 'auditor2',
    ...overrides,
  };
}

function findingWith(selfModificationApproval, baseline = BASELINE) {
  return {
    id: 'f1',
    mission_id: 'm1',
    triage: { ruleBaseline: baseline, selfModificationApproval },
  };
}

/** Extrai a verificação persistida no último update. */
function persisted() {
  const calls = mockUpdate.mock.calls;
  if (!calls.length) return null;
  return calls[calls.length - 1][0].triage.ruleBaselineVerification;
}

beforeEach(() => {
  mockGetFinding.mockReset();
  mockUpdate.mockClear();
  mockRecordEvent.mockClear();
});

describe('LEGITIMATE_GOVERNANCE_CHANGE_RUNTIME', () => {
  test('GOV_CHG_01 baseline inalterado fecha sem precisar de autorização', async () => {
    mockGetFinding.mockResolvedValue(findingWith(null));

    const result = await bugTriageService.verifySelfModificationBaseline('f1', {
      currentRules: BASELINE,
    });

    expect(result.ok).toBe(true);
    expect(result.code ?? null).toBeNull();
    expect(persisted().ok).toBe(true);
  });

  test('GOV_CHG_02 baseline enfraquecido sem nenhuma aprovação é BLOQUEADO', async () => {
    mockGetFinding.mockResolvedValue(findingWith(null));

    const result = await bugTriageService.verifySelfModificationBaseline('f1', {
      currentRules: WEAKENED,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('GOVERNANCE_BASELINE_VIOLATION');
    // A causa raiz precisa ser legível na evidência: não é "sem aprovação de missão", é
    // "sem consentimento EXPLÍCITO de mudança de governança".
    expect(persisted().authorizationAllowed).toBe(false);
    // Sem aprovador registrado o motor reporta ACTOR_REQUIRED (não ACTOR_NOT_HUMAN): a
    // ausência é distinguível de um principal explicitamente não-humano.
    expect(persisted().authorizationCode).toBe('ACTOR_REQUIRED');
  });

  test('GOV_CHG_03 aprovação GENÉRICA de missão NÃO autoriza mudança de governança', async () => {
    // O ponto exato da missão: aprovar a missão não é aprovar a governança.
    mockGetFinding.mockResolvedValue(
      findingWith(approval({ governanceChangeApproved: false })),
    );

    const result = await bugTriageService.verifySelfModificationBaseline('f1', {
      currentRules: WEAKENED,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('GOVERNANCE_BASELINE_VIOLATION');
    expect(persisted().authorizationCode).toBe('GOVERNANCE_CHANGE_APPROVAL_REQUIRED');
    expect(persisted().authorizationStage).toBe('EXPLICIT_GOVERNANCE_APPROVAL');
  });

  test('GOV_CHG_04 aval explícito SEM motivo é BLOQUEADO', async () => {
    mockGetFinding.mockResolvedValue(
      findingWith(approval({ governanceChangeReason: '   ' })),
    );

    const result = await bugTriageService.verifySelfModificationBaseline('f1', {
      currentRules: WEAKENED,
    });

    expect(result.ok).toBe(false);
    expect(persisted().authorizationCode).toBe('GOVERNANCE_CHANGE_REASON_REQUIRED');
  });

  test('GOV_CHG_05 reviewer independente exigido e ausente é BLOQUEADO', async () => {
    mockGetFinding.mockResolvedValue(findingWith(approval({ reviewer: null })));

    const result = await bugTriageService.verifySelfModificationBaseline('f1', {
      currentRules: WEAKENED,
    });

    expect(result.ok).toBe(false);
    expect(persisted().authorizationCode).toBe('GOVERNANCE_CHANGE_REVIEWER_REQUIRED');
  });

  test('GOV_CHG_06 reviewer igual ao autor NÃO é independente — BLOQUEADO', async () => {
    mockGetFinding.mockResolvedValue(findingWith(approval({ reviewer: 'humano1' })));

    const result = await bugTriageService.verifySelfModificationBaseline('f1', {
      currentRules: WEAKENED,
    });

    expect(result.ok).toBe(false);
    expect(persisted().authorizationCode).toBe('GOVERNANCE_CHANGE_REVIEWER_NOT_INDEPENDENT');
  });

  test('GOV_CHG_07 conta de serviço (não-humano) é BLOQUEADA mesmo com tudo preenchido', async () => {
    mockGetFinding.mockResolvedValue(
      findingWith(approval({ actorTypeVerified: 'SERVICE_ACCOUNT' })),
    );

    const result = await bugTriageService.verifySelfModificationBaseline('f1', {
      currentRules: WEAKENED,
    });

    expect(result.ok).toBe(false);
    expect(persisted().authorizationCode).toBe('SELF_MODIFICATION_APPROVAL_ACTOR_NOT_HUMAN');
  });

  test('GOV_CHG_08 humano sem a permissão específica é BLOQUEADO', async () => {
    mockGetFinding.mockResolvedValue(
      findingWith(approval({ hasSpecificPermission: false })),
    );

    const result = await bugTriageService.verifySelfModificationBaseline('f1', {
      currentRules: WEAKENED,
    });

    expect(result.ok).toBe(false);
    expect(persisted().authorizationCode).toBe(
      'SELF_MODIFICATION_APPROVAL_PERMISSION_REQUIRED',
    );
  });

  test('GOV_CHG_09 aval humano completo faz o finding FECHAR (regressão do defeito)', async () => {
    // Antes da correção este caso devolvia ok:false e `closeFinding` recusava para sempre.
    mockGetFinding.mockResolvedValue(findingWith(approval()));

    const result = await bugTriageService.verifySelfModificationBaseline('f1', {
      currentRules: WEAKENED,
    });

    expect(result.ok).toBe(true);
    expect(result.authorized).toBe(true);
    expect(result.code).toBe('GOVERNANCE_BASELINE_HUMAN_AUTHORIZED');

    const saved = persisted();
    expect(saved.ok).toBe(true);
    expect(saved.authorized).toBe(true);
    expect(saved.authorizationAllowed).toBe(true);
    // Evidência auditável persistida: quem autorizou, por quê, com qual reviewer e os hashes
    // antes/depois — sem necessidade de reconstrução por joins.
    expect(saved.authorization.actor).toBe('humano1');
    expect(saved.authorization.reviewer).toBe('auditor2');
    expect(saved.authorization.reason).toMatch(/runner/);
    expect(saved.authorization.beforeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(saved.authorization.afterHash).toMatch(/^[0-9a-f]{64}$/);
    expect(saved.authorization.beforeHash).not.toBe(saved.authorization.afterHash);
    expect(saved.authorization.filesChanged).toEqual(['config/engineering-gates.json']);
  });

  test('GOV_CHG_10 ACRESCENTAR gate/arquivo é tightening e não é violação', async () => {
    const tightened = {
      ...BASELINE,
      mandatoryGates: [...BASELINE.mandatoryGates, 'GATE_B'],
      files: { ...BASELINE.files, 'config/new-gate.json': 'hash_new' },
    };
    mockGetFinding.mockResolvedValue(findingWith(null));

    const result = await bugTriageService.verifySelfModificationBaseline('f1', {
      currentRules: tightened,
    });

    expect(result.ok).toBe(true);
    expect(result.code ?? null).toBeNull();
  });

  test('GOV_CHG_11 finding inexistente é fail-closed', async () => {
    mockGetFinding.mockResolvedValue(null);

    await expect(
      bugTriageService.verifySelfModificationBaseline('inexistente', { currentRules: BASELINE }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  test('GOV_CHG_12 a aprovação persiste o consentimento explícito de governança', async () => {
    // O aval precisa ser gravado no ATO da aprovação: sem isso a autorização não é auditável
    // depois e o runtime de fechamento não tem como distinguir mudança declarada de silenciosa.
    mockGetFinding.mockResolvedValue({
      id: 'f1',
      mission_id: 'm1',
      triage: {},
      // `self_modification` é o campo real que habilita o caminho de aprovação humana.
      self_modification: true,
      status: 'CONFIRMED',
      severity: 'HIGH',
      category: 'SELF_MODIFICATION',
    });

    await bugTriageService.approveSelfModification('f1', {
      actor: 'humano1',
      authenticatedActorType: 'human',
      hasSelfModificationPermission: true,
      governanceChangeApproved: true,
      governanceChangeReason: 'motivo auditável',
      reviewer: 'auditor2',
      requiresIndependentReviewer: true,
    });

    const savedApproval = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0].triage
      .selfModificationApproval;
    expect(savedApproval.governanceChangeApproved).toBe(true);
    expect(savedApproval.governanceChangeReason).toBe('motivo auditável');
    expect(savedApproval.reviewer).toBe('auditor2');
    expect(savedApproval.requiresIndependentReviewer).toBe(true);
    expect(savedApproval.hasSpecificPermission).toBe(true);
    expect(savedApproval.actorTypeVerified).toBe('human');
  });
});
