'use strict';

/**
 * Produtor de SUPERSEDÊNCIA do reprocess semântico (T3/T7, 2026-09-19).
 *
 * Os estados SUPERSEDED / REJECTED / STALE_SEMANTICS tinham CONSUMIDOR nos
 * gates (corpus, versão semântica) e NENHUM produtor. Estes testes travam o
 * contrato do produtor (`scripts/benchmark/apply-semantic-reprocess.js`) e do
 * aposento no store:
 *
 *   - achado reproduzido e validado pelo pipeline atual → SUPERSEDED, com
 *     `supersededBy` apontando para o achado NOVO e as versões antiga/nova;
 *   - identidade reproduzida mas prova do próprio achado não verificável →
 *     REJECTED source_not_verifiable (a chave semântica não absolve a fonte);
 *   - o mesmo normalizedId em fonte verificada E não verificada: o achado da
 *     fonte verificada é SUPERSEDED, o da não verificada é REJECTED (medido:
 *     149 achados VERIFIED_OFFICIAL quase aposentados com o motivo errado);
 *   - rejeitado pelo classificador → REJECTED com a razão do funil;
 *   - NADA é apagado: previousVerificationState fica na linha;
 *   - IDEMPOTÊNCIA: re-rodar não re-aposenta nem troca `supersededBy`;
 *   - correção governada: só o MESMO run produtor corrige o próprio aposento,
 *     e a correção fica registrada (retirementCorrection de/para).
 */

const {
  RETIRE_REASONS,
  candidateKeyOf,
  decideOldFindingOutcome,
  buildRetirementMetadata,
} = require('../../../scripts/benchmark/apply-semantic-reprocess');
const { createBenchmarkResearchMemoryStore } = require('../../helpers/benchmarkResearchMemoryStore');

const CURRENT = 'sem-v1:9b0c801eb6ab5ba73344ede66481121b';
const RUN = 'brr-reprocess-run-1';

function oldFinding(overrides = {}) {
  return {
    id: 'brf-old-1',
    kind: 'capability',
    external_name: 'Online class booking',
    verification_state: 'VERIFIED_OFFICIAL',
    metadata: { normalizedId: 'class.book', ...overrides.metadata },
    ...overrides,
  };
}

describe('decideOldFindingOutcome — decisão de aposento', () => {
  test('identidade reproduzida + fonte própria validada => SUPERSEDED pelo achado novo', () => {
    const candidatesByKey = new Map([[candidateKeyOf('capability', 'class.book'), { newId: 'brf-new-1', validated: true }]]);
    const decision = decideOldFindingOutcome({
      finding: oldFinding(),
      candidatesByKey,
      rejectedByName: new Map(),
      ownSourceValidated: true,
    });
    expect(decision).toEqual({
      action: 'SUPERSEDED',
      reason: RETIRE_REASONS.REPRODUCED,
      newFindingId: 'brf-new-1',
    });
  });

  test('identidade reproduzida MAS fonte do próprio achado não verificável => REJECTED', () => {
    // O mesmo normalizedId existindo em outra fonte verificada NÃO absolve a
    // prova deste achado: a linha dele está ligada a uma fonte que não prova.
    const candidatesByKey = new Map([[candidateKeyOf('capability', 'class.book'), { newId: 'brf-new-1', validated: true }]]);
    const decision = decideOldFindingOutcome({
      finding: oldFinding(),
      candidatesByKey,
      rejectedByName: new Map(),
      ownSourceValidated: false,
    });
    expect(decision.action).toBe('REJECTED');
    expect(decision.reason).toBe(RETIRE_REASONS.SOURCE_NOT_VERIFIABLE);
    expect(decision.newFindingId).toBeNull();
  });

  test('candidato não validado pelo funil => REJECTED source_not_verifiable', () => {
    const candidatesByKey = new Map([[candidateKeyOf('capability', 'class.book'), { newId: null, validated: false }]]);
    const decision = decideOldFindingOutcome({
      finding: oldFinding(),
      candidatesByKey,
      rejectedByName: new Map(),
      ownSourceValidated: true,
    });
    expect(decision).toEqual({
      action: 'REJECTED',
      reason: RETIRE_REASONS.SOURCE_NOT_VERIFIABLE,
      newFindingId: null,
    });
  });

  test('rejeitado pelo classificador atual => REJECTED com a razão do funil', () => {
    const rejectedByName = new Map([['Every payment, in one place.', 'semantic_type_marketing_claim']]);
    const decision = decideOldFindingOutcome({
      finding: oldFinding({
        external_name: 'Every payment, in one place.',
        metadata: { normalizedId: null },
      }),
      candidatesByKey: new Map(),
      rejectedByName,
      ownSourceValidated: true,
    });
    expect(decision).toEqual({
      action: 'REJECTED',
      reason: 'semantic_type_marketing_claim',
      newFindingId: null,
    });
  });

  test('sem identidade e sem rejeição nominal => REJECTED unresolved_semantic_candidate', () => {
    const decision = decideOldFindingOutcome({
      finding: oldFinding({ metadata: {} }),
      candidatesByKey: new Map(),
      rejectedByName: new Map(),
      ownSourceValidated: true,
    });
    expect(decision.reason).toBe(RETIRE_REASONS.UNRESOLVED);
  });
});

describe('buildRetirementMetadata — trilha do aposento', () => {
  test('SUPERSEDED carrega supersededBy, motivo, run e versões antiga/nova', () => {
    const metadata = buildRetirementMetadata({
      decision: { action: 'SUPERSEDED', reason: RETIRE_REASONS.REPRODUCED, newFindingId: 'brf-new-1' },
      finding: oldFinding({ metadata: { normalizedId: 'class.book', semanticPipelineVersion: 'sem-v1:aaa' } }),
      reprocessRunId: RUN,
      currentVersion: CURRENT,
    });
    expect(metadata).toEqual({
      superseded: true,
      supersededBy: 'brf-new-1',
      supersededReason: RETIRE_REASONS.REPRODUCED,
      reprocessRunId: RUN,
      oldSemanticVersion: 'sem-v1:aaa',
      newSemanticVersion: CURRENT,
    });
  });

  test('REJECTED não carrega supersededBy e registra versão antiga ausente como null', () => {
    const metadata = buildRetirementMetadata({
      decision: { action: 'REJECTED', reason: RETIRE_REASONS.SOURCE_NOT_VERIFIABLE, newFindingId: null },
      finding: oldFinding({ metadata: { normalizedId: 'class.book' } }),
      reprocessRunId: RUN,
      currentVersion: CURRENT,
    });
    expect(metadata.supersededBy).toBeUndefined();
    expect(metadata.oldSemanticVersion).toBeNull();
    expect(metadata.newSemanticVersion).toBe(CURRENT);
  });
});

describe('retireFinding/correctRetirement — idempotência e trilha (store em memória)', () => {
  async function seedFinding(store) {
    await store.openRun({
      tenantId: 'system',
      vertical: 'fitness',
      researchVersion: 'v-test',
      benchmarkIds: ['b1'],
      registeredAt: '2026-09-19T00:00:00.000Z',
    });
    const run = await store.getRun({ tenantId: 'system', vertical: 'fitness', researchVersion: 'v-test' });
    const finding = await store.insertFinding({
      tenantId: 'system',
      runId: run.id,
      benchmarkId: 'b1',
      kind: 'capability',
      externalName: 'Online class booking',
      verified: true,
      verificationState: 'VERIFIED_OFFICIAL',
      metadata: { normalizedId: 'class.book' },
    });
    return { run, finding };
  }

  test('aposenta SEM apagar e re-rodar NÃO re-aposenta nem troca supersededBy', async () => {
    const store = createBenchmarkResearchMemoryStore();
    const { finding } = await seedFinding(store);

    const first = await store.retireFinding({
      tenantId: 'system',
      findingId: finding.id,
      state: 'SUPERSEDED',
      metadata: { superseded: true, supersededBy: 'brf-new-1', supersededReason: RETIRE_REASONS.REPRODUCED, reprocessRunId: RUN },
    });
    expect(first.retired).toBe(true);
    expect(first.alreadyRetired).toBe(false);

    const kept = await store.listFindings({ tenantId: 'system', runId: finding.run_id });
    expect(kept).toHaveLength(1);
    expect(kept[0].verification_state).toBe('SUPERSEDED');
    expect(kept[0].metadata.previousVerificationState).toBe('VERIFIED_OFFICIAL');

    const second = await store.retireFinding({
      tenantId: 'system',
      findingId: finding.id,
      state: 'REJECTED',
      metadata: { supersededBy: 'brf-OUTRO' },
    });
    expect(second.retired).toBe(false);
    expect(second.alreadyRetired).toBe(true);

    const after = await store.listFindings({ tenantId: 'system', runId: finding.run_id });
    expect(after[0].verification_state).toBe('SUPERSEDED');
    expect(after[0].metadata.supersededBy).toBe('brf-new-1');
  });

  test('correção governada: só o MESMO run produtor corrige, e o de/para fica registrado', async () => {
    const store = createBenchmarkResearchMemoryStore();
    const { finding } = await seedFinding(store);
    await store.retireFinding({
      tenantId: 'system',
      findingId: finding.id,
      state: 'REJECTED',
      metadata: { supersededReason: RETIRE_REASONS.SOURCE_NOT_VERIFIABLE, reprocessRunId: RUN },
    });

    await expect(store.correctRetirement({
      tenantId: 'system',
      findingId: finding.id,
      expectedReprocessRunId: 'brr-OUTRO-RUN',
      state: 'SUPERSEDED',
      metadata: { supersededBy: 'brf-new-1' },
      correctionReason: 'tentativa de outro run',
    })).rejects.toThrow(/outro run/);

    const corrected = await store.correctRetirement({
      tenantId: 'system',
      findingId: finding.id,
      expectedReprocessRunId: RUN,
      state: 'SUPERSEDED',
      metadata: { superseded: true, supersededBy: 'brf-new-1', supersededReason: RETIRE_REASONS.REPRODUCED },
      correctionReason: 'producer_decision_recomputed',
    });
    expect(corrected.corrected).toBe(true);

    const [row] = await store.listFindings({ tenantId: 'system', runId: finding.run_id });
    expect(row.verification_state).toBe('SUPERSEDED');
    expect(row.metadata.supersededBy).toBe('brf-new-1');
    expect(row.metadata.retirementCorrection).toMatchObject({
      from: 'REJECTED',
      fromReason: RETIRE_REASONS.SOURCE_NOT_VERIFIABLE,
      to: 'SUPERSEDED',
      toReason: RETIRE_REASONS.REPRODUCED,
    });
  });

  test('correção exige estado aposentado — achado ativo não é "corrigido", é aposentado', async () => {
    const store = createBenchmarkResearchMemoryStore();
    const { finding } = await seedFinding(store);
    await expect(store.correctRetirement({
      tenantId: 'system',
      findingId: finding.id,
      expectedReprocessRunId: RUN,
      state: 'SUPERSEDED',
      metadata: {},
      correctionReason: 'sem aposento prévio',
    })).rejects.toThrow(/não está aposentado/);
  });
});
