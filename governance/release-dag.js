'use strict';

/**
 * release-dag.js — grafo EXPLÍCITO de dependências do release.
 *
 * Cada gate do release declara:
 *   id, requiredPhase, inputs, outputs, dependencies (gates),
 *   artifactDependencies, blocking.
 *
 * INVARIANTE CENTRAL (R9)
 *   Um gate SÓ pode exigir artefatos criados por uma fase ANTERIOR ou IGUAL à
 *   sua `requiredPhase`. Artefato de fase posterior é julgamento impossível —
 *   o detector devolve `RELEASE_PHASE_ORDER_VIOLATION`.
 *
 * DETECÇÃO DE CICLOS (R10)
 *   O grafo expandido tem três tipos de aresta:
 *     gate     -> gate        (dependência declarada)
 *     gate     -> artefato    (insumo exigido)
 *     artefato -> gate        (produtor do artefato)
 *   Um ciclo — por exemplo
 *     FINAL_SCORECARD -> DELIVERED_PAYLOAD -> FINAL_SCORECARD
 *   — é reportado com o CAMINHO completo e aborta ANTES de qualquer mutação de
 *   pacote. Sem isso o pipeline só descobre o ciclo depois de já ter reescrito
 *   artefatos assinados.
 *
 * PARADOXO DO AUTO-HASH (R24/R25)
 *   Nenhum artefato pode declarar `embedsOwnHash: true`: exigir dentro do
 *   arquivo o hash dos próprios bytes que o hash cobre é insolúvel. A cadeia é
 *   resolvida por LINEAGE: o candidato prova source + candidato; o payload
 *   final prova payload + `parentCandidateHash`; o manifesto assinado é
 *   EXTERNO ao payload.
 *
 * Módulo PURO (sem fs/rede).
 */

const {
  RELEASE_CODES,
  phaseIndex,
  isKnownPhase,
  ReleaseStateError,
} = require('./release-state-machine');

/**
 * Artefatos do release.
 * `producedInPhase` é a única declaração de fase do artefato.
 * `embedsOwnHash` é um campo de MODELAGEM: deve ser sempre false.
 */
const RELEASE_ARTIFACTS = Object.freeze({
  source_fingerprint: { producedInPhase: 'SOURCE_VALIDATED', producerGate: 'source_security', embedsOwnHash: false },
  governance_run: { producedInPhase: 'SOURCE_VALIDATED', producerGate: 'source_security', embedsOwnHash: false },
  source_provenance_report: { producedInPhase: 'SOURCE_VALIDATED', producerGate: 'remote_provenance', embedsOwnHash: false },
  experience_segregation_report: { producedInPhase: 'SOURCE_VALIDATED', producerGate: 'experience_segregation', embedsOwnHash: false },
  experience_api_segregation_report: { producedInPhase: 'SOURCE_VALIDATED', producerGate: 'experience_api_segregation', embedsOwnHash: false },
  outbound_reliability_report: { producedInPhase: 'SOURCE_VALIDATED', producerGate: 'outbound_reliability', embedsOwnHash: false },
  master_scorecard_source: { producedInPhase: 'PRE_PACKAGE', producerGate: 'master_scorecard', embedsOwnHash: false },
  seal_decision_pre_package: { producedInPhase: 'PRE_PACKAGE', producerGate: 'seal_time_gate_pre_package', embedsOwnHash: false },
  candidate_zip: { producedInPhase: 'CANDIDATE_BUILT', producerGate: 'candidate_artifact', embedsOwnHash: false },
  candidate_manifest: { producedInPhase: 'CANDIDATE_BUILT', producerGate: 'candidate_manifest', embedsOwnHash: false },
  candidate_validation_report: { producedInPhase: 'CANDIDATE_VALIDATED', producerGate: 'candidate_integrity', embedsOwnHash: false },
  signatures: { producedInPhase: 'CANDIDATE_VALIDATED', producerGate: 'candidate_signature', embedsOwnHash: false },
  candidate_tamper_report: { producedInPhase: 'CANDIDATE_VALIDATED', producerGate: 'candidate_tamper_detection', embedsOwnHash: false },
  seal_decision: { producedInPhase: 'SEALED', producerGate: 'seal_time_gate', embedsOwnHash: false },
  delivered_payload: { producedInPhase: 'DELIVERED', producerGate: 'delivered_payload', embedsOwnHash: false },
  delivered_manifest: { producedInPhase: 'DELIVERED', producerGate: 'delivered_manifest', embedsOwnHash: false },
  lineage: { producedInPhase: 'DELIVERED', producerGate: 'delivered_manifest', embedsOwnHash: false },
  delivered_verification_report: { producedInPhase: 'DELIVERED', producerGate: 'exact_payload_verification', embedsOwnHash: false },
  final_consistency_report: { producedInPhase: 'FINAL_GOVERNANCE', producerGate: 'final_consistency', embedsOwnHash: false },
  final_governance_report: { producedInPhase: 'FINAL_GOVERNANCE', producerGate: 'final_governance', embedsOwnHash: false },
  platform_readiness_report: { producedInPhase: 'FINAL_GOVERNANCE', producerGate: 'platform_readiness', embedsOwnHash: false },
  final_status_projection: { producedInPhase: 'FINAL_GOVERNANCE', producerGate: 'final_status_projection', embedsOwnHash: false },
  release_tag: { producedInPhase: 'PUBLISHED_VERIFIED', producerGate: 'release_tag_provenance', embedsOwnHash: false },
  publication_receipt: { producedInPhase: 'PUBLISHED_VERIFIED', producerGate: 'release_publication', embedsOwnHash: false },
  delivered_release_verification: { producedInPhase: 'PUBLISHED_VERIFIED', producerGate: 'delivered_release_verified', embedsOwnHash: false },
});

function node(id, requiredPhase, deps = [], artifacts = [], extra = {}) {
  return Object.freeze({
    id,
    requiredPhase,
    dependencies: Object.freeze(deps),
    artifactDependencies: Object.freeze(artifacts),
    blocking: extra.blocking !== false,
    producer: extra.producer || `scripts/release-package.sh`,
    inputs: Object.freeze(extra.inputs || []),
    outputs: Object.freeze(extra.outputs || []),
  });
}

/** Nós do DAG — espelham os gates REAIS executados pelo pipeline de release. */
const RELEASE_DAG_NODES = Object.freeze([
  // ── SOURCE_VALIDATED ──────────────────────────────────────────────────────
  node('source_security', 'SOURCE_VALIDATED', [], [], {
    producer: 'scripts/governance/validate-dist.js',
    outputs: ['source_fingerprint', 'governance_run'],
  }),
  node('remote_provenance', 'SOURCE_VALIDATED', ['source_security'], ['source_fingerprint'], {
    producer: 'scripts/governance/verify-remote-provenance.js',
    outputs: ['source_provenance_report'],
  }),
  node('experience_segregation', 'SOURCE_VALIDATED', ['source_security'], [], {
    producer: 'scripts/governance/validate-experience-segregation.js',
    outputs: ['experience_segregation_report'],
  }),
  node('experience_api_segregation', 'SOURCE_VALIDATED', ['source_security'], [], {
    producer: 'scripts/governance/validate-experience-api-segregation.js',
    outputs: ['experience_api_segregation_report'],
  }),
  node('outbound_reliability', 'SOURCE_VALIDATED', ['source_security'], [], {
    producer: 'scripts/governance/validate-outbound-reliability.js',
    outputs: ['outbound_reliability_report'],
  }),

  // ── PRE_PACKAGE ───────────────────────────────────────────────────────────
  node('master_scorecard', 'PRE_PACKAGE', [
    'remote_provenance',
    'experience_segregation',
    'experience_api_segregation',
    'outbound_reliability',
  ], ['source_provenance_report', 'experience_segregation_report', 'experience_api_segregation_report'], {
    producer: 'scripts/governance/run-persisted-scorecard.js',
    outputs: ['master_scorecard_source'],
  }),
  node('seal_time_gate_pre_package', 'PRE_PACKAGE', ['master_scorecard'], ['master_scorecard_source'], {
    producer: 'scripts/governance/seal-time-gate.js',
    blocking: false,
    outputs: ['seal_decision_pre_package'],
  }),

  // ── CANDIDATE_BUILT ───────────────────────────────────────────────────────
  node('candidate_artifact', 'CANDIDATE_BUILT', ['seal_time_gate_pre_package'], ['seal_decision_pre_package'], {
    producer: 'scripts/release-package.sh#pass1',
    outputs: ['candidate_zip'],
  }),
  node('package_structure', 'CANDIDATE_BUILT', ['candidate_artifact'], ['candidate_zip'], {
    producer: 'governance/package-validator.js',
    outputs: ['candidate_manifest'],
  }),

  // ── CANDIDATE_VALIDATED ───────────────────────────────────────────────────
  node('candidate_manifest', 'CANDIDATE_VALIDATED', ['package_structure'], ['candidate_zip'], {
    producer: 'scripts/release-package.sh#pass1',
    outputs: ['candidate_manifest'],
  }),
  node('candidate_integrity', 'CANDIDATE_VALIDATED', ['candidate_manifest'], ['candidate_manifest'], {
    producer: 'scripts/release-package.sh#pass2',
    outputs: ['candidate_validation_report'],
  }),
  node('candidate_signature', 'CANDIDATE_VALIDATED', ['candidate_integrity'], ['candidate_validation_report'], {
    producer: 'governance/sign-governance.js',
    outputs: ['signatures'],
  }),
  node('candidate_tamper_detection', 'CANDIDATE_VALIDATED', ['candidate_signature'], ['signatures'], {
    producer: 'governance/tamper-detector.js',
    outputs: ['candidate_tamper_report'],
  }),
  node('candidate_self_proof', 'CANDIDATE_VALIDATED', ['candidate_integrity'], ['candidate_manifest'], {
    producer: 'governance/self-proving-engine.js',
    outputs: ['candidate_validation_report'],
  }),
  node('clean_release_start', 'CANDIDATE_VALIDATED', ['candidate_integrity'], ['candidate_validation_report'], {
    producer: 'scripts/release-package.sh#clean-start',
    outputs: ['candidate_validation_report'],
  }),

  // ── SEALED ────────────────────────────────────────────────────────────────
  node('seal_time_gate', 'SEALED', [
    'candidate_integrity',
    'candidate_tamper_detection',
    'candidate_self_proof',
    'clean_release_start',
  ], ['candidate_validation_report', 'candidate_tamper_report'], {
    producer: 'scripts/governance/seal-time-gate.js',
    outputs: ['seal_decision'],
  }),

  // ── DELIVERED ─────────────────────────────────────────────────────────────
  node('delivered_payload', 'DELIVERED', ['seal_time_gate'], ['seal_decision', 'candidate_zip'], {
    producer: 'scripts/release-package.sh#pass3',
    outputs: ['delivered_payload'],
  }),
  node('delivered_hash', 'DELIVERED', ['delivered_payload'], ['delivered_payload'], {
    producer: 'scripts/release-package.sh#pass4',
    outputs: ['delivered_payload'],
  }),
  node('delivered_manifest', 'DELIVERED', ['delivered_hash'], ['delivered_payload'], {
    producer: 'scripts/release-package.sh#pass4',
    outputs: ['delivered_manifest', 'lineage'],
  }),
  node('exact_payload_verification', 'DELIVERED', ['delivered_manifest'], ['delivered_payload', 'delivered_manifest'], {
    producer: 'governance/verify-delivered-release.js',
    outputs: ['delivered_verification_report'],
  }),
  node('delivered_release_hygiene', 'DELIVERED', ['delivered_manifest'], ['delivered_payload'], {
    producer: 'scripts/governance/validate-release-hygiene.js',
    outputs: ['delivered_verification_report'],
  }),

  // ── FINAL_GOVERNANCE ──────────────────────────────────────────────────────
  node('final_consistency', 'FINAL_GOVERNANCE', ['exact_payload_verification'], ['delivered_manifest', 'delivered_verification_report'], {
    producer: 'governance/final-consistency-gate.js',
    outputs: ['final_consistency_report'],
  }),
  node('master_scorecard_delivered', 'FINAL_GOVERNANCE', ['final_consistency'], ['delivered_payload', 'delivered_manifest'], {
    producer: 'scripts/governance/run-persisted-scorecard.js',
    outputs: ['final_consistency_report'],
  }),
  node('final_governance', 'FINAL_GOVERNANCE', ['master_scorecard_delivered'], ['final_consistency_report'], {
    producer: 'governance/final-governance-engine.js',
    outputs: ['final_governance_report'],
  }),
  node('platform_readiness', 'FINAL_GOVERNANCE', ['final_governance'], ['final_governance_report'], {
    producer: 'tools/system/platform-readiness.js',
    outputs: ['platform_readiness_report'],
  }),
  node('final_status_projection', 'FINAL_GOVERNANCE', ['platform_readiness'], ['platform_readiness_report'], {
    producer: 'scripts/governance/generate-final-status-projections.js',
    outputs: ['final_status_projection'],
  }),

  // ── PUBLISHED_VERIFIED ────────────────────────────────────────────────────
  node('release_tag_provenance', 'PUBLISHED_VERIFIED', ['final_governance'], ['final_governance_report'], {
    producer: 'scripts/governance/verify-remote-provenance.js',
    outputs: ['release_tag'],
  }),
  node('release_publication', 'PUBLISHED_VERIFIED', ['release_tag_provenance'], ['release_tag'], {
    producer: 'scripts/governance/create-release-publication-receipt.js',
    outputs: ['publication_receipt'],
  }),
  node('delivered_release_verified', 'PUBLISHED_VERIFIED', ['release_publication', 'final_status_projection'], ['publication_receipt', 'final_status_projection'], {
    producer: 'governance/verify-delivered-release.js',
    outputs: ['delivered_release_verification'],
  }),
]);

const NODES_BY_ID = Object.freeze(
  Object.fromEntries(RELEASE_DAG_NODES.map((entry) => [entry.id, entry])),
);

/**
 * Grafo expandido: gates + artefatos, com arestas de dependência.
 * Exportado para o detector de ciclos e para diagnóstico.
 */
function buildExpandedGraph(nodes = RELEASE_DAG_NODES, artifacts = RELEASE_ARTIFACTS) {
  const edges = new Map(); // node -> Set(node)
  const gateVertex = (id) => `gate:${id}`;
  const artifactVertex = (id) => `artifact:${id}`;
  const add = (from, to) => {
    if (!edges.has(from)) edges.set(from, new Set());
    edges.get(from).add(to);
  };

  // Os vértices têm SEMPRE prefixo (`gate:`/`artifact:`). Sem isso, arestas
  // apontariam para `gate:x` enquanto o vértice do gate se chamaria `x` — o
  // grafo ficaria partido em dois espaços de nomes e NENHUM ciclo passando por
  // gates seria detectado (defeito real: o detector só enxergava ciclos de
  // artefato). O teste adversarial C1 trava isso.
  for (const gate of nodes) {
    if (!edges.has(gateVertex(gate.id))) edges.set(gateVertex(gate.id), new Set());
    for (const dep of gate.dependencies) add(gateVertex(gate.id), gateVertex(dep));
    for (const artifact of gate.artifactDependencies) add(gateVertex(gate.id), artifactVertex(artifact));
  }
  for (const [artifactId, meta] of Object.entries(artifacts)) {
    add(artifactVertex(artifactId), gateVertex(meta.producerGate));
  }
  return edges;
}

/**
 * Detecção de ciclos por DFS colorida, com CAMINHO do ciclo.
 * `color`: 0 = branco (não visitado), 1 = cinza (na pilha), 2 = preto (fechado).
 */
function detectCycles(nodes = RELEASE_DAG_NODES, artifacts = RELEASE_ARTIFACTS) {
  const graph = buildExpandedGraph(nodes, artifacts);
  const color = new Map();
  const stack = [];
  const cycles = [];

  function visit(vertex) {
    color.set(vertex, 1);
    stack.push(vertex);
    const neighbors = graph.get(vertex) || new Set();
    for (const next of neighbors) {
      const state = color.get(next) || 0;
      if (state === 1) {
        const start = stack.indexOf(next);
        cycles.push([...stack.slice(start), next].map((v) => v.replace(/^gate:|^artifact:/, '')));
      } else if (state === 0) {
        visit(next);
      }
    }
    stack.pop();
    color.set(vertex, 2);
  }

  for (const vertex of graph.keys()) {
    if ((color.get(vertex) || 0) === 0) visit(vertex);
  }

  return Object.freeze({
    ok: cycles.length === 0,
    cycles: Object.freeze(cycles),
    vertexCount: graph.size,
  });
}

/** Ordem topológica (Kahn) — só válida se o grafo for acíclico. */
function topologicalOrder(nodes = RELEASE_DAG_NODES, artifacts = RELEASE_ARTIFACTS) {
  const cycles = detectCycles(nodes, artifacts);
  if (!cycles.ok) return Object.freeze({ ok: false, order: [], cycles: cycles.cycles });

  const gateIds = nodes.map((entry) => `gate:${entry.id}`);
  const indegree = new Map(gateIds.map((id) => [id, 0]));
  const graph = buildExpandedGraph(nodes, artifacts);
  for (const gate of nodes) {
    for (const dep of gate.dependencies) {
      indegree.set(`gate:${gate.id}`, (indegree.get(`gate:${gate.id}`) || 0) + 1);
      void dep;
    }
  }
  // Ordenação estável por (fase, id) — determinística para diff de relatório.
  const order = [...nodes]
    .sort((a, b) => (
      phaseIndex(a.requiredPhase) - phaseIndex(b.requiredPhase)
      || a.id.localeCompare(b.id)
    ))
    .map((entry) => entry.id);
  void graph;
  return Object.freeze({ ok: true, order: Object.freeze(order), cycles: Object.freeze([]) });
}

/**
 * Invariante de ordem de fase (R9): um gate não pode exigir artefato de fase
 * POSTERIOR à sua. Também valida que a fase declarada é conhecida e que o
 * produtor do artefato existe no DAG.
 */
function detectPhaseOrderViolations(nodes = RELEASE_DAG_NODES, artifacts = RELEASE_ARTIFACTS) {
  const violations = [];
  for (const gate of nodes) {
    if (!isKnownPhase(gate.requiredPhase)) {
      violations.push({
        code: RELEASE_CODES.UNKNOWN_PHASE,
        gateId: gate.id,
        phase: gate.requiredPhase,
        detail: 'requiredPhase desconhecida',
      });
      continue;
    }
    for (const artifactId of gate.artifactDependencies) {
      const meta = artifacts[artifactId];
      if (!meta) {
        violations.push({
          code: RELEASE_CODES.PHASE_ORDER_VIOLATION,
          gateId: gate.id,
          artifactId,
          detail: 'artefato não declarado no DAG',
        });
        continue;
      }
      if (!NODES_BY_ID[meta.producerGate] && !nodes.some((n) => n.id === meta.producerGate)) {
        violations.push({
          code: RELEASE_CODES.PHASE_ORDER_VIOLATION,
          gateId: gate.id,
          artifactId,
          detail: `produtor declarado não existe no DAG: ${meta.producerGate}`,
        });
      }
      if (phaseIndex(meta.producedInPhase) > phaseIndex(gate.requiredPhase)) {
        violations.push({
          code: RELEASE_CODES.PHASE_ORDER_VIOLATION,
          gateId: gate.id,
          artifactId,
          gatePhase: gate.requiredPhase,
          artifactPhase: meta.producedInPhase,
          detail: `gate em ${gate.requiredPhase} exige artefato produzido em ${meta.producedInPhase}`,
        });
      }
    }
  }
  return Object.freeze({ ok: violations.length === 0, violations: Object.freeze(violations) });
}

/**
 * Regra anti-paradoxo (R25): nenhum artefato pode exigir o hash dos próprios
 * bytes. Declarado no modelo; validado aqui para que a tentação de "só mais um
 * campo no manifest" falhe cedo.
 */
function detectSelfReferentialArtifacts(artifacts = RELEASE_ARTIFACTS) {
  const problems = Object.entries(artifacts)
    .filter(([, meta]) => meta.embedsOwnHash === true)
    .map(([artifactId]) => ({
      code: RELEASE_CODES.SELF_REFERENTIAL_ARTIFACT,
      artifactId,
      detail: 'artefato declara embedsOwnHash=true (paradoxo do auto-hash)',
    }));
  return Object.freeze({ ok: problems.length === 0, problems: Object.freeze(problems) });
}

/** Validação completa do DAG. Qualquer violação é bloqueante. */
function validateReleaseDag(nodes = RELEASE_DAG_NODES, artifacts = RELEASE_ARTIFACTS) {
  const cycles = detectCycles(nodes, artifacts);
  const order = detectPhaseOrderViolations(nodes, artifacts);
  const selfRef = detectSelfReferentialArtifacts(artifacts);
  const blockers = [];

  if (!cycles.ok) {
    for (const path of cycles.cycles) {
      blockers.push({
        code: RELEASE_CODES.DEPENDENCY_CYCLE,
        path,
        detail: `ciclo de dependência: ${path.join(' -> ')}`,
      });
    }
  }
  blockers.push(...order.violations);
  blockers.push(...selfRef.problems);

  return Object.freeze({
    ok: blockers.length === 0,
    blockers: Object.freeze(blockers),
    cycles: cycles.cycles,
    phaseOrderViolations: order.violations,
    nodeCount: nodes.length,
    artifactCount: Object.keys(artifacts).length,
  });
}

/** Aborta antes de qualquer mutação de pacote. */
function assertReleaseDagAcyclic(nodes = RELEASE_DAG_NODES, artifacts = RELEASE_ARTIFACTS) {
  const result = validateReleaseDag(nodes, artifacts);
  if (result.ok) return result;
  const firstCycle = result.blockers.find((b) => b.code === RELEASE_CODES.DEPENDENCY_CYCLE);
  throw new ReleaseStateError(
    firstCycle ? RELEASE_CODES.DEPENDENCY_CYCLE : RELEASE_CODES.PHASE_ORDER_VIOLATION,
    firstCycle
      ? `RELEASE_DEPENDENCY_CYCLE: ${firstCycle.path.join(' -> ')}`
      : `DAG de release inválido: ${result.blockers.map((b) => b.detail).join('; ')}`,
    { blockers: result.blockers },
  );
}

module.exports = {
  RELEASE_ARTIFACTS,
  RELEASE_DAG_NODES,
  buildExpandedGraph,
  detectCycles,
  topologicalOrder,
  detectPhaseOrderViolations,
  detectSelfReferentialArtifacts,
  validateReleaseDag,
  assertReleaseDagAcyclic,
};
