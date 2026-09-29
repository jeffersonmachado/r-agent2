'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Testes obrigatórios para os blockers FINAL-001, FINAL-002, FINAL-004, FINAL-009.
 *
 * Cada teste falha antes da correção e passa depois — prova que a invariante
 * foi implementada (e não apenas declarada em narrativa).
 *
 * FINAL-001 — fingerprint da prova torna-se STALE após mudança de fonte.
 * FINAL-002 — NO_GO obrigatório bloqueia GO final; engines contraditórios são proibidos.
 * FINAL-004 — cobertura set-based nunca excede 100%; extras não aumentam cobertura.
 * FINAL-009 — UUID aleatório não satisfaz FK; validateSeedFkIntegrity rejeita FK_UNRESOLVED.
 */

// ─────────────────────────────────────────────────────────────────────────────
// FINAL-001 — Fingerprint chain
// ─────────────────────────────────────────────────────────────────────────────

const {
  compareFingerprintChains,
} = require('../../governance/proof-engine/fingerprint-chain');

describe('FINAL-001 — fingerprint chain: STALE, FRESH, UNREGISTERED', () => {
  function chain(overrides = {}) {
    return {
      sourceFingerprint: 'src_fp_aaa',
      inventoryFingerprint: 'inv_fp_bbb',
      scenarioRegistryFingerprint: 'sce_fp_ccc',
      policyFingerprint: 'pol_fp_ddd',
      chainFingerprint: 'chain_fp_eee',
      ...overrides,
    };
  }

  test('prova torna-se STALE após mudança de fonte (sourceFingerprint diverge)', () => {
    const registered = chain();
    const current = chain({ sourceFingerprint: 'src_fp_CHANGED' });
    const result = compareFingerprintChains(registered, current);
    expect(result.status).toBe('STALE');
    expect(result.diverged).toContain('sourceFingerprint');
  });

  test('mudança de inventário também invalida a cadeia (STALE)', () => {
    const registered = chain();
    const current = chain({ inventoryFingerprint: 'inv_fp_CHANGED' });
    const result = compareFingerprintChains(registered, current);
    expect(result.status).toBe('STALE');
    expect(result.diverged).toContain('inventoryFingerprint');
  });

  test('sem cadeia registrada → UNREGISTERED (primeiro run não é STALE)', () => {
    const current = chain();
    // null e undefined indicam ausência de registro anterior
    expect(compareFingerprintChains(null, current).status).toBe('UNREGISTERED');
    expect(compareFingerprintChains(undefined, current).status).toBe('UNREGISTERED');
    // string (tipo inválido) também é UNREGISTERED
    expect(compareFingerprintChains('not-an-object', current).status).toBe('UNREGISTERED');
  });

  test('cadeia idêntica → FRESH (prova válida sem mudança de fonte)', () => {
    const c = chain();
    expect(compareFingerprintChains(c, { ...c }).status).toBe('FRESH');
  });

  test('STALE nunca é GO: status deve ser "STALE", não "FRESH"', () => {
    const registered = chain({ chainFingerprint: 'chain_fp_OLD' });
    const current = chain({ chainFingerprint: 'chain_fp_NEW' });
    const result = compareFingerprintChains(registered, current);
    expect(result.status).not.toBe('FRESH');
    expect(result.status).toBe('STALE');
  });

  test('diverged lista todos os componentes alterados, não apenas o primeiro', () => {
    const registered = chain();
    const current = chain({
      sourceFingerprint: 'src_CHANGED',
      policyFingerprint: 'pol_CHANGED',
    });
    const result = compareFingerprintChains(registered, current);
    expect(result.status).toBe('STALE');
    expect(result.diverged).toContain('sourceFingerprint');
    expect(result.diverged).toContain('policyFingerprint');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FINAL-002 — FinalDecisionAggregator (fail-closed)
// ─────────────────────────────────────────────────────────────────────────────

const {
  computeFinalDecision,
  buildCertificationAuthorityChecks,
  STRICT_MODE,
} = require('../../governance/final-governance-engine');

const {
  _internal: { _computeMandatoryDecision },
} = require('../../tools/system/platform-readiness');

describe('FINAL-002 — computeFinalDecision: NO_GO obrigatório bloqueia GO', () => {
  function passCheck(id, severity = 'HIGH') {
    return { id, pass: true, severity, reason: id };
  }
  function failCheck(id, severity = 'CRITICAL') {
    return { id, pass: false, severity, reason: id };
  }

  test('check CRITICAL falho → NO_GO:GOVERNANCE_BLOCKED (independente do proofDecision)', () => {
    const decision = computeFinalDecision(
      [passCheck('mesh', 'HIGH'), failCheck('replay_integrity', 'CRITICAL')],
      { proofDecision: 'AUTONOMOUS_READY_GO' },
    );
    expect(decision).toMatch(/^NO_GO:GOVERNANCE_BLOCKED/);
    expect(decision).toContain('replay_integrity');
  });

  test('sem falhas críticas → retorna o proofDecision informado', () => {
    const decision = computeFinalDecision(
      [passCheck('mesh'), passCheck('release_gate')],
      { proofDecision: 'AUTONOMOUS_READY_GO' },
    );
    expect(decision).toBe('AUTONOMOUS_READY_GO');
  });

  test('proof ausente/UNKNOWN nunca pode virar GO', () => {
    expect(computeFinalDecision([passCheck('mesh')], { proofDecision: undefined }))
      .toMatch(/^NO_GO:PROOF_NOT_PASS/);
    expect(computeFinalDecision([passCheck('mesh')], { proofDecision: 'UNKNOWN' }))
      .toMatch(/^NO_GO:PROOF_NOT_PASS/);
  });

  test('engines contraditórios são proibidos: CRITICAL blocked + proofGO → resultado é NO_GO', () => {
    const decision = computeFinalDecision(
      [failCheck('governance_signature', 'CRITICAL')],
      { proofDecision: 'AUTONOMOUS_READY_GO' },
    );
    // AUTONOMOUS_READY_GO nunca pode coexistir com CRITICAL blocker
    expect(decision).not.toBe('AUTONOMOUS_READY_GO');
    expect(decision.startsWith('NO_GO')).toBe(true);
  });

  if (STRICT_MODE) {
    test('[STRICT_MODE] HIGH falho → NO_GO:STRICT_ENTERPRISE', () => {
      const decision = computeFinalDecision(
        [failCheck('visual_journeys', 'HIGH')],
        { proofDecision: 'STAGE_GO' },
      );
      expect(decision).toMatch(/^NO_GO:STRICT_ENTERPRISE/);
    });
  }
});

describe('FINAL-002 — autoridade final exige scorecard/self-proof/tamper do mesmo run', () => {
  const fp = 'a'.repeat(64);
  const runContext = {
    runId: 'rap-release-20260821-120000-aaaaaaaa',
    sourceFingerprint: fp,
    startedAt: '2026-08-21T15:00:00.000Z',
    generatedAt: '2026-08-21T15:00:00.000Z',
    status: 'RUNNING',
    artifactType: 'run-context',
    artifactVersion: '1.0.0',
  };
  const meta = (artifactType) => ({
    runId: runContext.runId,
    sourceFingerprint: fp,
    generatedAt: '2026-08-21T15:01:00.000Z',
    artifactType,
    artifactVersion: '1.0.0',
  });
  const documents = () => ({
    scorecard: {
      ...meta('rap-master-scorecard'),
      dimensions: [{
        id: 'RAP-001', score: 10, target: 10,
        requirements: [{ id: 'r1', mandatory: true, status: 'PASS' }],
        tests: ['t'], runtimeEvidence: ['e'], blockers: [], gaps: [],
      }],
      blockers: [], gaps: [],
    },
    selfProof: {
      ...meta('self-proving-report'), pass: true, selfProofStatus: 'PASS',
      verifierPassed: true, staleReferencesFound: 0, staleHashesFound: 0,
      selfProofGate: { failedGates: [] },
    },
    tamper: {
      ...meta('tamper-detection-report'), pass: true, decision: 'GO',
      failedChecks: 0, checks: [{ id: 'signature', pass: true }],
    },
    proof: {
      ...meta('final-proof-report'), finalDecision: 'AUTONOMOUS_READY_GO',
      fingerprintStatus: 'FRESH', blockerCount: 0, missingArtifacts: [],
    },
    readiness: {
      ...meta('final-readiness-report'), finalDecision: 'AUTONOMOUS_READY_GO', blockingGaps: [],
    },
  });

  test('all authority artifacts PASS only when their lineage and semantics pass', () => {
    const checks = buildCertificationAuthorityChecks({ runContext, ...documents(), gateDirection: gateDirectionFixture() });
    // 5 artefatos de autoridade + o check de DIREÇÃO entre gates (invariante child→parent,
    // adicionado em 2026-09-28: um gate pai não pode certificar GO enquanto um filho obrigatório
    // diz NO_GO). O número é afirmado para que a inclusão de novos checks seja deliberada.
    expect(checks).toHaveLength(6);
    expect(checks.every((check) => check.pass)).toBe(true);
    // O check de direção é OBRIGATÓRIO na certificação — não é informativo.
    expect(checks.map((check) => check.id)).toContain('child_gate_direction');
  });

  test.each([
    ['scorecard below 10', (docs) => { docs.scorecard.dimensions[0].score = 9; }],
    ['self proof FAIL', (docs) => { docs.selfProof.pass = false; docs.selfProof.selfProofStatus = 'FAIL'; }],
    ['tamper NO_GO', (docs) => { docs.tamper.pass = false; docs.tamper.decision = 'NO_GO'; }],
    ['foreign readiness', (docs) => { docs.readiness.runId = 'foreign'; }],
    ['unknown proof', (docs) => { docs.proof.finalDecision = 'UNKNOWN'; }],
  ])('%s blocks authority', (_label, mutate) => {
    const docs = documents();
    mutate(docs);
    const checks = buildCertificationAuthorityChecks({ runContext, ...docs, gateDirection: gateDirectionFixture() });
    expect(checks.some((check) => !check.pass)).toBe(true);
  });

  // ÂNCORA DO CONTRATO (regressão do ciclo de 2026-09-29): a injeção é a FONTE, não o disco.
  // Sentido 1 (cadeia injetada GO com disco possivelmente NO_GO) → pass. Enquanto não houver
  // injeção, este sentido falha sempre que a governança real estiver NO_GO — que era o ciclo.
  // Sentido 2 (cadeia injetada NO_GO) → fail. Enquanto o disco for NO_GO este sentido passa por
  // acidente; o valor probatório está na COMBINAÇÃO dos dois sentidos.
  test('child_gate_direction lê a cadeia INJETADA, nunca o estado real de governança', () => {
    const goChecks = buildCertificationAuthorityChecks({
      runContext,
      ...documents(),
      gateDirection: gateDirectionFixture(),
    });
    const goDirection = goChecks.find((check) => check.id === 'child_gate_direction');
    expect(goDirection).toBeDefined();
    expect(goDirection.pass).toBe(true);

    const badFixture = gateDirectionFixture();
    const noGoChecks = buildCertificationAuthorityChecks({
      runContext,
      ...documents(),
      gateDirection: { root: badFixture.root, readJson: () => ({ status: 'NO_GO', finalDecision: 'NO_GO' }) },
    });
    const noGoDirection = noGoChecks.find((check) => check.id === 'child_gate_direction');
    expect(noGoDirection.pass).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cadeia de gates INJETADA no check de direção (isolamento do teste)
// ─────────────────────────────────────────────────────────────────────────────
// DEFEITO REAL medido em 2026-09-29: `checkChildGateDirection` lê a cadeia REAL do disco. Sem
// injeção, este teste de autoridade passava a FALHAR sempre que os artefatos de governança reais
// estavam em NO_GO — e essa falha RETROALIMENTAVA o ciclo:
//   artefato NO_GO → teste de autoridade FAIL → master-scorecard-test-report FAIL →
//   scorecard NO_GO (dimensões TESTED/REGRESSION_PROTECTED) → proof NO_GO → artefato NO_GO.
// O teste deve medir a LÓGICA de certificação, nunca o estado de governança do momento.
const GATE_DIRECTION_DIRS = [];

function gateDirectionFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'final-gov-gates-'));
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'config', 'mandatory-gate-dependencies.json'),
    `${JSON.stringify({
      schema: 'mandatory-gate-dependencies/v1',
      gates: [
        {
          id: 'FINAL_GOVERNANCE',
          report: 'governance/final-governance-report.json',
          decisionPath: 'finalDecision',
          children: [{ id: 'FIXTURE_CHILD', report: 'fixture/child.json', decisionPath: 'status' }],
        },
      ],
    }, null, 2)}\n`,
  );
  GATE_DIRECTION_DIRS.push(dir);
  // Filhos da fixture respondem GO: a invariante de direção fica satisfeita por construção.
  return { root: dir, readJson: () => ({ status: 'GO', finalDecision: 'AUTONOMOUS_READY_GO' }) };
}

afterAll(() => {
  for (const dir of GATE_DIRECTION_DIRS) fs.rmSync(dir, { recursive: true, force: true });
});

describe('FINAL-002 — _computeMandatoryDecision: invariante agregador fail-closed', () => {
  test('governance NO_GO bloqueia finalDecision mesmo com proof GO', () => {
    const dec = _computeMandatoryDecision({
      govDecision: 'NO_GO:STRICT_ENTERPRISE [visual_journeys]',
      proofDecision: 'AUTONOMOUS_READY_GO',
    });
    expect(dec).toMatch(/^NO_GO:MANDATORY_GATE_BLOCKED/);
    expect(dec).toContain('governance=NO_GO:STRICT_ENTERPRISE');
  });

  test('replay-hardening NO_GO bloqueia finalDecision mesmo com proof GO', () => {
    const dec = _computeMandatoryDecision({
      hardeningDecision: 'REPLAY_HARDENING_NO_GO',
      proofDecision: 'AUTONOMOUS_READY_GO',
    });
    expect(dec).toMatch(/^NO_GO:MANDATORY_GATE_BLOCKED/);
    expect(dec).toContain('replay-hardening=REPLAY_HARDENING_NO_GO');
  });

  test('qa-mesh NO_GO bloqueia finalDecision', () => {
    const dec = _computeMandatoryDecision({
      meshHardBlock: true,
      proofDecision: 'AUTONOMOUS_READY_GO',
    });
    expect(dec).toMatch(/^NO_GO:MANDATORY_GATE_BLOCKED/);
    expect(dec).toContain('qa-mesh=NO_GO');
  });

  test('nenhum gate bloqueado + sem gaps → retorna proofDecision original', () => {
    const dec = _computeMandatoryDecision({
      proofDecision: 'AUTONOMOUS_READY_GO',
    });
    expect(dec).toBe('AUTONOMOUS_READY_GO');
  });

  test('nenhum gate bloqueado + blockingGaps > 0 → NO_GO do proof', () => {
    const dec = _computeMandatoryDecision({
      blockingGaps: 2,
      proofDecision: 'AUTONOMOUS_READY_GO',
    });
    expect(dec).toMatch(/^NO_GO:/);
  });

  test('múltiplos gates bloqueados → todos listados na mensagem', () => {
    const dec = _computeMandatoryDecision({
      meshHardBlock: true,
      govDecision: 'NO_GO:GOVERNANCE_BLOCKED [x]',
      proofDecision: 'AUTONOMOUS_READY_GO',
    });
    expect(dec).toContain('qa-mesh=NO_GO');
    expect(dec).toContain('governance=NO_GO:GOVERNANCE_BLOCKED');
  });

  test('governance PASS_WITH_DEFERRED_PACKAGE_GATE NÃO promove para AUTONOMOUS_READY_GO', () => {
    const dec = _computeMandatoryDecision({
      govDecision: 'PASS_WITH_DEFERRED_PACKAGE_GATE',
      proofDecision: 'AUTONOMOUS_READY_GO',
    });
    expect(dec).toBe('PASS_WITH_DEFERRED_PACKAGE_GATE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FINAL-004 — Set-based coverage (nunca > 100%)
// ─────────────────────────────────────────────────────────────────────────────

const { calculateSetCoverage } = require('../../qa/coverage/setCoverage');

describe('FINAL-004 — calculateSetCoverage: set-based, nunca > 100%', () => {
  test('extras não aumentam cobertura — 8 validados para 6 requeridos nunca dá > 100%', () => {
    const required = ['j1', 'j2', 'j3', 'j4', 'j5', 'j6'];
    const validated = ['j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7', 'j8'];
    const result = calculateSetCoverage(required, validated);
    expect(result.percent).toBeLessThanOrEqual(100);
    expect(result.percent).toBe(100);
    expect(result.extra).toEqual(['j7', 'j8']);
    expect(result.matched).toHaveLength(6);
  });

  test('jornada requerida ausente reduz cobertura abaixo de 100%', () => {
    const required = ['j1', 'j2', 'j3'];
    const validated = ['j1', 'j2'];
    const result = calculateSetCoverage(required, validated);
    expect(result.percent).toBeLessThan(100);
    expect(result.missing).toContain('j3');
    expect(result.matched).toHaveLength(2);
  });

  test('item extra sem matching com requerido: percent permanece igual ao sem extras', () => {
    const required = ['j1', 'j2'];
    const withoutExtra = calculateSetCoverage(required, ['j1', 'j2']);
    const withExtra = calculateSetCoverage(required, ['j1', 'j2', 'extra1', 'extra2']);
    expect(withExtra.percent).toBe(withoutExtra.percent);
    expect(withExtra.extra).toEqual(['extra1', 'extra2']);
  });

  test('cobertura é interseção: matched ⊆ required e matched ⊆ validated', () => {
    const required = ['A', 'B', 'C'];
    const validated = ['B', 'C', 'D', 'E'];
    const result = calculateSetCoverage(required, validated);
    // matched só pode conter itens que estão em AMBOS os conjuntos
    for (const id of result.matched) {
      expect(required).toContain(id);
      expect(validated).toContain(id);
    }
    expect(result.matched).toHaveLength(2); // B e C
    expect(result.missing).toEqual(['A']);
    expect(result.extra).toEqual(['D', 'E']);
  });

  test('required vazio → 100% por definição (sem requerimentos)', () => {
    expect(calculateSetCoverage([], ['j1', 'j2']).percent).toBe(100);
    expect(calculateSetCoverage([], []).percent).toBe(100);
  });

  test('nenhum validado para requeridos existentes → 0%', () => {
    const result = calculateSetCoverage(['j1', 'j2', 'j3'], []);
    expect(result.percent).toBe(0);
    expect(result.matched).toHaveLength(0);
    expect(result.missing).toHaveLength(3);
  });

  test('percent é número, nunca NaN nem Infinity', () => {
    const cases = [
      [[], []],
      [['j1'], []],
      [[], ['j1']],
      [['j1'], ['j1']],
      [['j1', 'j2'], ['j2', 'j3']],
    ];
    for (const [req, val] of cases) {
      const { percent } = calculateSetCoverage(req, val);
      expect(Number.isFinite(percent)).toBe(true);
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(100);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FINAL-009 — Relational Seed FK integrity
// ─────────────────────────────────────────────────────────────────────────────

const {
  generateCompatibleValue,
  validateSeedFkIntegrity,
  FK_UNRESOLVED,
} = require('../../api/modules/agent-os/services/model-driven-pipeline');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('FINAL-009 — generateCompatibleValue: UUID aleatório não satisfaz FK', () => {
  test('campo terminando em _id vira FK_UNRESOLVED, não UUID', () => {
    const val = generateCompatibleValue('user_id', { type: 'UUID', allowNull: false });
    expect(val).toBe(FK_UNRESOLVED);
    expect(UUID_PATTERN.test(val)).toBe(false);
  });

  test('campo terminando em _key vira FK_UNRESOLVED, não UUID', () => {
    const val = generateCompatibleValue('tenant_key', {}, { tenantKey: null });
    expect(val).toBe(FK_UNRESOLVED);
  });

  test('tenant_key com contexto → usa o tenantKey fornecido (não FK_UNRESOLVED)', () => {
    const val = generateCompatibleValue('tenant_key', {}, { tenantKey: 'tenant-abc' });
    expect(val).toBe('tenant-abc');
    expect(val).not.toBe(FK_UNRESOLVED);
  });

  test('campo não-FK retorna valor compatível com o tipo (não FK_UNRESOLVED)', () => {
    const strVal = generateCompatibleValue('name', { type: 'STRING' });
    expect(strVal).not.toBe(FK_UNRESOLVED);

    const boolVal = generateCompatibleValue('active', { type: 'BOOLEAN' });
    expect(typeof boolVal).toBe('boolean');
    expect(boolVal).not.toBe(FK_UNRESOLVED);
  });

  test('qualquer campo _id: nunca UUID aleatório mesmo que type seja UUID', () => {
    const fkFields = ['agent_id', 'conversation_id', 'ticket_id', 'owner_id', 'flow_id'];
    for (const field of fkFields) {
      const val = generateCompatibleValue(field, { type: 'UUID' });
      expect(val).toBe(FK_UNRESOLVED);
      expect(UUID_PATTERN.test(val)).toBe(false);
    }
  });
});

describe('FINAL-009 — validateSeedFkIntegrity: integridade relacional dos seeds', () => {
  test('seed com FK_UNRESOLVED → inválido', () => {
    const result = validateSeedFkIntegrity({
      data: { name: 'Test Item', user_id: FK_UNRESOLVED, active: true },
    });
    expect(result.valid).toBe(false);
    expect(result.status).toBe('FK_UNRESOLVED');
    expect(result.unresolvedFkFields).toContain('user_id');
  });

  test('seed sem FK_UNRESOLVED → válido (SEED_VALIDATED)', () => {
    const result = validateSeedFkIntegrity({
      data: { name: 'Clean Item', active: true, score: 42 },
    });
    expect(result.valid).toBe(true);
    expect(result.status).toBe('SEED_VALIDATED');
    expect(result.unresolvedFkFields).toHaveLength(0);
  });

  test('múltiplos FK_UNRESOLVED → todos listados em unresolvedFkFields', () => {
    const result = validateSeedFkIntegrity({
      data: {
        name: 'Multi FK',
        user_id: FK_UNRESOLVED,
        tenant_key: FK_UNRESOLVED,
        conversation_id: FK_UNRESOLVED,
      },
    });
    expect(result.valid).toBe(false);
    expect(result.unresolvedFkFields).toContain('user_id');
    expect(result.unresolvedFkFields).toContain('tenant_key');
    expect(result.unresolvedFkFields).toContain('conversation_id');
    expect(result.unresolvedFkFields).toHaveLength(3);
  });

  test('seed vazio → válido (sem campos FK_UNRESOLVED)', () => {
    const result = validateSeedFkIntegrity({ data: {} });
    expect(result.valid).toBe(true);
    expect(result.status).toBe('SEED_VALIDATED');
  });

  test('seed nulo/ausente → trata como vazio, não lança', () => {
    const result = validateSeedFkIntegrity({});
    expect(result.valid).toBe(true);
    expect(result.status).toBe('SEED_VALIDATED');
  });

  test('cross-tenant: seed com tenant_key resolvido + FK_UNRESOLVED em outro campo → inválido', () => {
    const result = validateSeedFkIntegrity({
      data: {
        name: 'Cross Tenant Test',
        tenant_key: 'tenant-abc',
        agent_id: FK_UNRESOLVED,
      },
    });
    expect(result.valid).toBe(false);
    expect(result.unresolvedFkFields).toContain('agent_id');
    expect(result.unresolvedFkFields).not.toContain('tenant_key');
  });

  test('FK_UNRESOLVED sentinel é string distinta de UUID e de string vazia', () => {
    expect(typeof FK_UNRESOLVED).toBe('string');
    expect(FK_UNRESOLVED.length).toBeGreaterThan(0);
    expect(UUID_PATTERN.test(FK_UNRESOLVED)).toBe(false);
    expect(FK_UNRESOLVED).not.toBe('');
  });
});
