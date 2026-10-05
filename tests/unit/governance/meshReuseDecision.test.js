'use strict';

/**
 * GUARDA da deduplicação do mesh (scripts/governance/mesh-reuse-decision.js).
 *
 * O RISCO desta otimização é evidente: suprimir a execução de uma prova é
 * exatamente o tipo de atalho que fabrica verde. A guarda prova os DOIS sentidos:
 *   - REUTILIZA só quando a evidência é DESTE run, canônica, GO, dentro do tempo
 *     do run e cobrindo o registry corrente;
 *   - REEXECUTA em CADA uma das violações, uma a uma (nenhuma delas pode passar).
 */

const { decideMeshReuse } = require('../../../scripts/governance/mesh-reuse-decision');
const RUN = {
  runId: 'rap-governed-20261005152701891-f5f76356',
  sourceFingerprint: 'c07e879775a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b',
  startedAt: '2026-10-05T15:27:01.891Z',
};

function evidence(overrides = {}) {
  const results = (overrides.results || [{ id: 's-1' }, { id: 's-2' }]);
  // `null` explícito significa AUSENTE (o caso que a guarda precisa exercitar);
  // objeto parcial é MESCLADO (mutação pontual de um campo).
  const pick = (override, base) => {
    if (override === null) return null;
    if (override === undefined) return base;
    return { ...base, ...override };
  };
  return {
    run: pick(overrides.run, RUN),
    goNoGo: pick(overrides.goNoGo, {
      runId: RUN.runId,
      sourceFingerprint: RUN.sourceFingerprint,
      isCanonicalExecution: true,
      executionOrigin: 'pipeline',
      status: 'GO',
      reasons: [],
      generatedAt: '2026-10-05T15:40:00.000Z',
    }),
    releaseGate: pick(overrides.releaseGate, { runId: RUN.runId, artifactType: 'release-gate-report' }),
    historyEntry: pick(overrides.historyEntry, {
      file: 'mesh-2026-10-05T15-38-00-000Z.json',
      runId: RUN.runId,
      isCanonicalExecution: true,
      results,
    }),
    registryIds: overrides.registryIds === undefined ? ['s-1', 's-2'] : overrides.registryIds,
  };
}

describe('mesh-reuse-decision — quando REUTILIZAR é legítimo', () => {
  test('evidência canônica GO DESTE run cobrindo o registry: reutiliza', () => {
    const decision = decideMeshReuse(evidence());

    expect(decision.reuse).toBe(true);
    expect(decision.code).toBe('MESH_REUSE_OK');
    expect(decision.checks.every((check) => check.ok)).toBe(true);
    // As condições que tornam a reutilização legítima ficam auditáveis no registro.
    expect(decision.checks.map((check) => check.code)).toEqual(expect.arrayContaining([
      'SAME_RUN_ID', 'SAME_SOURCE', 'RELEASE_GATE_BOUND', 'CANONICAL_EXECUTION',
      'CANONICAL_HISTORY', 'DECISION_GO', 'SAME_RUN_TIME', 'REGISTRY_COVERED',
    ]));
  });

  test('registry com cenário A MAIS que o executado não reutiliza (prova vencida)', () => {
    const decision = decideMeshReuse(evidence({ registryIds: ['s-1', 's-2', 's-3-novo'] }));

    expect(decision.reuse).toBe(false);
    expect(decision.code).toBe('REGISTRY_NOT_COVERED');
    expect(decision.detail).toContain('s-3-novo');
  });
});

describe('mesh-reuse-decision — fail-closed: cada violação força REEXECUÇÃO', () => {
  const cases = [
    ['run context ausente', { run: null }, 'RUN_CONTEXT_MISSING'],
    ['go-no-go ausente', { goNoGo: null }, 'MESH_EVIDENCE_MISSING'],
    ['release-gate ausente', { releaseGate: null }, 'RELEASE_GATE_MISSING'],
    ['sem histórico do run', { historyEntry: null }, 'CANONICAL_HISTORY_MISSING'],
    ['evidência de OUTRO run', { goNoGo: { runId: 'rap-governed-de-outro-run' } }, 'MESH_EVIDENCE_OTHER_RUN'],
    ['evidência de OUTRO source', { goNoGo: { sourceFingerprint: 'ffffffffffff' } }, 'MESH_EVIDENCE_OTHER_SOURCE'],
    ['release-gate de outro run', { releaseGate: { runId: 'rap-governed-de-outro-run' } }, 'RELEASE_GATE_NOT_BOUND'],
    ['execução não canônica', { goNoGo: { isCanonicalExecution: false } }, 'MESH_EVIDENCE_NOT_CANONICAL'],
    ['execução manual (origin)', { goNoGo: { executionOrigin: 'manual_run' } }, 'MESH_EVIDENCE_NOT_CANONICAL'],
    ['histórico não canônico', { historyEntry: { isCanonicalExecution: false } }, 'HISTORY_NOT_CANONICAL'],
    ['veredito NO_GO', { goNoGo: { status: 'NO_GO' } }, 'MESH_EVIDENCE_NOT_GO'],
    ['prova ANTERIOR ao run (regra temporal)', { goNoGo: { generatedAt: '2026-10-05T15:00:00.000Z' } }, 'MESH_EVIDENCE_PRE_RUN'],
    ['registry vazio', { registryIds: [] }, 'REGISTRY_EMPTY'],
  ];

  for (const [nome, overrides, code] of cases) {
    test(nome, () => {
      const decision = decideMeshReuse(evidence(overrides));
      expect(decision.reuse).toBe(false);
      expect(decision.code).toBe(code);
    });
  }

  test('nunca devolve reuse=true por omissão (base vazia)', () => {
    expect(decideMeshReuse({}).reuse).toBe(false);
    expect(decideMeshReuse().reuse).toBe(false);
  });
});
