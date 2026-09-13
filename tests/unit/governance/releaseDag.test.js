/**
 * releaseDag.test.js — R8..R10, R24/R25, C1, C6: o DAG do release é explícito,
 * o detector de ciclos consegue falhar e o paradoxo do auto-hash é bloqueado.
 */
'use strict';

const {
  RELEASE_ARTIFACTS,
  RELEASE_DAG_NODES,
  detectCycles,
  topologicalOrder,
  detectPhaseOrderViolations,
  detectSelfReferentialArtifacts,
  validateReleaseDag,
  assertReleaseDagAcyclic,
} = require('../../../governance/release-dag');

const { RELEASE_CODES } = require('../../../governance/release-state-machine');

function cloneNodes() {
  return RELEASE_DAG_NODES.map((entry) => ({
    ...entry,
    dependencies: [...entry.dependencies],
    artifactDependencies: [...entry.artifactDependencies],
  }));
}

describe('ReleaseDag — o DAG real', () => {
  test('todo gate declara id, fase, dependências e blocking', () => {
    for (const gate of RELEASE_DAG_NODES) {
      expect(typeof gate.id).toBe('string');
      expect(gate.requiredPhase).toMatch(/^[A-Z_]+$/);
      expect(Array.isArray(gate.dependencies)).toBe(true);
      expect(Array.isArray(gate.artifactDependencies)).toBe(true);
      expect(typeof gate.blocking).toBe('boolean');
    }
  });

  test('toda dependência aponta para um gate declarado', () => {
    const ids = new Set(RELEASE_DAG_NODES.map((entry) => entry.id));
    for (const gate of RELEASE_DAG_NODES) {
      for (const dep of gate.dependencies) {
        expect(ids.has(dep)).toBe(true);
      }
    }
  });

  test('o DAG real é acíclico, ordenado por fase e sem artefato auto-referente', () => {
    const result = validateReleaseDag();
    expect(result.blockers).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.cycles).toEqual([]);
    expect(result.phaseOrderViolations).toEqual([]);
    expect(result.nodeCount).toBe(RELEASE_DAG_NODES.length);
  });

  test('a ordem topológica respeita a ordem das fases', () => {
    const { ok, order } = topologicalOrder();
    expect(ok).toBe(true);
    const byId = Object.fromEntries(RELEASE_DAG_NODES.map((entry) => [entry.id, entry.requiredPhase]));
    const phaseRank = { SOURCE_VALIDATED: 0, PRE_PACKAGE: 1, CANDIDATE_BUILT: 2, CANDIDATE_VALIDATED: 3, SEALED: 4, DELIVERED: 5, FINAL_GOVERNANCE: 6, PUBLISHED_VERIFIED: 7 };
    const ranks = order.map((id) => phaseRank[byId[id]]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  test('nenhum artefato declara embedsOwnHash', () => {
    const result = detectSelfReferentialArtifacts();
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });
});

describe('ReleaseDag — C1 ciclo injetado é detectado com caminho', () => {
  test('Gate A requires artifact B e produtor de B requires Gate A => RELEASE_DEPENDENCY_CYCLE', () => {
    const nodes = cloneNodes();
    const artifacts = JSON.parse(JSON.stringify(RELEASE_ARTIFACTS));

    // Cenário C1 do adversarial: A (FINAL_SCORECARD) exige o artefato
    // produzido por B (DELIVERED_PAYLOAD), e B exige o relatório produzido por A.
    const finalScorecard = nodes.find((n) => n.id === 'master_scorecard_delivered');
    const deliveredPayload = nodes.find((n) => n.id === 'delivered_payload');

    artifacts.final_governance_report = {
      producedInPhase: 'FINAL_GOVERNANCE',
      producerGate: 'master_scorecard_delivered',
      embedsOwnHash: false,
    };
    artifacts.delivered_payload = {
      producedInPhase: 'DELIVERED',
      producerGate: 'delivered_payload',
      embedsOwnHash: false,
    };
    finalScorecard.artifactDependencies = ['delivered_payload'];
    deliveredPayload.artifactDependencies = ['seal_decision', 'final_governance_report'];

    const cycles = detectCycles(nodes, artifacts);
    expect(cycles.ok).toBe(false);
    const flat = cycles.cycles[0].join(' -> ');
    expect(flat).toContain('delivered_payload');
    expect(flat).toContain('master_scorecard_delivered');

    const validation = validateReleaseDag(nodes, artifacts);
    expect(validation.ok).toBe(false);
    expect(validation.blockers.some((b) => b.code === RELEASE_CODES.DEPENDENCY_CYCLE)).toBe(true);
  });

  test('assertReleaseDagAcyclic aborta antes de qualquer mutação de pacote', () => {
    const nodes = cloneNodes();
    const artifacts = JSON.parse(JSON.stringify(RELEASE_ARTIFACTS));
    const a = nodes.find((n) => n.id === 'final_governance');
    const b = nodes.find((n) => n.id === 'delivered_payload');
    artifacts.final_governance_report = { producedInPhase: 'FINAL_GOVERNANCE', producerGate: 'final_governance', embedsOwnHash: false };
    artifacts.delivered_payload = { producedInPhase: 'DELIVERED', producerGate: 'delivered_payload', embedsOwnHash: false };
    a.artifactDependencies = ['delivered_payload'];
    b.artifactDependencies = ['seal_decision', 'final_governance_report'];

    expect(() => assertReleaseDagAcyclic(nodes, artifacts)).toThrow(
      expect.objectContaining({ code: RELEASE_CODES.DEPENDENCY_CYCLE }),
    );
  });
});

describe('ReleaseDag — invariante de ordem de fase (R9)', () => {
  test('gate em fase anterior exigindo artefato de fase posterior é violação', () => {
    const nodes = cloneNodes();
    const artifacts = JSON.parse(JSON.stringify(RELEASE_ARTIFACTS));
    // Gate DELIVERED exigindo o relatório de governança FINAL: impossível.
    const delivered = nodes.find((n) => n.id === 'delivered_payload');
    delivered.artifactDependencies = ['seal_decision', 'final_governance_report'];

    const result = detectPhaseOrderViolations(nodes, artifacts);
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatchObject({
      code: RELEASE_CODES.PHASE_ORDER_VIOLATION,
      gateId: 'delivered_payload',
      artifactId: 'final_governance_report',
      gatePhase: 'DELIVERED',
      artifactPhase: 'FINAL_GOVERNANCE',
    });
  });

  test('artefato da própria fase é permitido (produtor no mesmo passo)', () => {
    const result = detectPhaseOrderViolations();
    expect(result.ok).toBe(true);
  });

  test('artefato não declarado no DAG é violação, não ignorado', () => {
    const nodes = cloneNodes();
    nodes.find((n) => n.id === 'delivered_payload').artifactDependencies = ['artefato_fantasma'];
    const result = detectPhaseOrderViolations(nodes);
    expect(result.ok).toBe(false);
    expect(result.violations[0].detail).toMatch(/artefato não declarado/);
  });
});

describe('ReleaseDag — C6 paradoxo do auto-hash', () => {
  test('artefato que embute o próprio hash é bloqueado', () => {
    const artifacts = JSON.parse(JSON.stringify(RELEASE_ARTIFACTS));
    artifacts.delivered_payload.embedsOwnHash = true;
    const result = detectSelfReferentialArtifacts(artifacts);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatchObject({
      code: RELEASE_CODES.SELF_REFERENTIAL_ARTIFACT,
      artifactId: 'delivered_payload',
    });

    const validation = validateReleaseDag(RELEASE_DAG_NODES, artifacts);
    expect(validation.ok).toBe(false);
  });

  test('o payload final é provado por manifesto EXTERNO (lineage), não por hash interno', () => {
    // O DAG modela o manifesto entregue como artefato distinto do payload.
    expect(RELEASE_ARTIFACTS.delivered_manifest.producedInPhase).toBe('DELIVERED');
    expect(RELEASE_ARTIFACTS.delivered_payload.embedsOwnHash).toBe(false);
    const gate = RELEASE_DAG_NODES.find((n) => n.id === 'exact_payload_verification');
    expect(gate.artifactDependencies).toContain('delivered_payload');
    expect(gate.artifactDependencies).toContain('delivered_manifest');
  });
});
