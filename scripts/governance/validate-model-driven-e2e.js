#!/usr/bin/env node
'use strict';

/**
 * validate-model-driven-e2e.js — v2-real-pipeline
 *
 * REGRA ABSOLUTA: Este script NÃO simula, NÃO sintetiza estados, NÃO cria
 * IDs de jornada, NÃO hardcoda listas de entidades.
 *
 * Ele EXECUTA o pipeline real model-driven (sem DB) e LEITURA evidências QA:
 *   1. inferJourneysFromModels() → descoberta real via Sequelize models + introspection
 *   2. buildEntityGraph()        → grafo real de entidades e FKs
 *   3. generateSeeds()           → seeds reais derivados do domínio
 *   4. QA smoke report           → prova real de execução e geração de evidência
 *
 * Saída: governance/model-driven-e2e-report.json
 */

const fs   = require('fs');
const path = require('path');

const ROOT        = path.join(__dirname, '..', '..');
const OUTPUT_PATH = path.join(ROOT, 'governance', 'model-driven-e2e-report.json');

function readJson(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

// ─── Fase 1: Descoberta real via pipeline model-driven ────────────────────────

function runRealDiscovery() {
  const {
    inferJourneysFromModels,
    buildEntityGraph,
    generateSeeds,
  } = require('../../api/modules/agent-os/services/model-driven-pipeline');
  const { introspectAllModels } = require('../../api/modules/agent-os/services/model-introspection-service');
  const { buildDomainMap }      = require('../../api/modules/agent-os/services/domain-map-service');
  const { topologicalSort }     = require('../../api/modules/agent-os/services/relational-seed-planner');

  // Introspect models — funciona sem DB (lê arquivos fonte)
  const introspection = introspectAllModels();
  const domainMap     = buildDomainMap(introspection);
  const entityGraph   = buildEntityGraph(introspection, domainMap);

  // Inferir jornadas a partir do grafo real
  const journeysReport = inferJourneysFromModels();

  // Construir grafo de dependência para topological sort
  const modelNames = introspection.models.map((m) => m.modelName);
  const fkEdges    = new Map(modelNames.map((n) => [n, []]));

  for (const model of introspection.models) {
    for (const [field, attr] of Object.entries(model.attributes || {})) {
      if (attr && attr.references) {
        const targetModel = attr.references.model;
        if (targetModel && fkEdges.has(model.modelName)) {
          fkEdges.get(model.modelName).push(targetModel);
        }
      }
    }
  }

  const { order: topologicalOrder, cycles } = topologicalSort(modelNames, fkEdges);

  // Gerar seeds para a primeira jornada candidata
  const candidateJourneys = journeysReport.candidateJourneys || journeysReport.journeys || [];
  const sampleSeeds = candidateJourneys.length > 0
    ? generateSeeds(introspection, candidateJourneys.slice(0, 2))
    : [];

  return {
    introspection,
    domainMap,
    entityGraph,
    journeysReport,
    topologicalOrder,
    cycles,
    sampleSeeds,
    candidateJourneys,
  };
}

// ─── Fase 2: Leitura de evidências reais de execução ─────────────────────────

function readExecutionEvidence() {
  const smokeReport     = readJson('qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json');
  const hardeningReport = readJson('governance/replay-hardening-report.json');
  const consistReport   = readJson('governance/replay-consistency-report.json');
  const qaGoNoGo        = readJson('qa-mesh/go-no-go-report.json');

  return { smokeReport, hardeningReport, consistReport, qaGoNoGo };
}

// ─── Fase 3: Validação ────────────────────────────────────────────────────────

function validateDiscovery(discovery) {
  const violations = [];

  const { journeysReport, topologicalOrder, cycles, candidateJourneys, entityGraph } = discovery;

  // DISCOVERED: pelo menos uma jornada descoberta pelo pipeline real
  if (!journeysReport || journeysReport.totalJourneys === 0) {
    violations.push('DISCOVERED: nenhuma jornada descoberta pelo model-driven pipeline (inferJourneysFromModels)');
  }

  // REGISTERED: a estrutura do journey report deve conter journeys (CandidateJourney registradas)
  if (candidateJourneys.length === 0) {
    violations.push('REGISTERED: nenhuma candidateJourney no journeysReport');
  }

  // SEED_PLANNED: topological sort deve funcionar sem ciclos para os modelos de domínio
  if (cycles.length > 0) {
    violations.push(`SEED_PLANNED: ciclos detectados no grafo relacional: ${cycles.map((c) => c.join('→')).join(', ')}`);
  }

  // SEED_PLANNED: ordem topológica deve conter pelo menos os modelos de domínio core
  const domainModels = ['Tenant', 'Ticket', 'ChannelConversation', 'EventLedger'];
  const presentInOrder = new Set(topologicalOrder);
  for (const dm of domainModels) {
    if (!presentInOrder.has(dm)) {
      violations.push(`SEED_PLANNED: modelo de domínio ${dm} ausente na ordem topológica`);
    }
  }

  // ENTITY_GRAPH: entidades devem ter sido detectadas
  if (!entityGraph || (entityGraph.nodes || []).length === 0) {
    violations.push('ENTITY_GRAPH: buildEntityGraph retornou grafo vazio');
  }

  return violations;
}

function validateExecution(evidence) {
  const violations = [];
  const { smokeReport, hardeningReport } = evidence;

  // EXECUTED: smoke report deve existir e ter status GO
  if (!smokeReport) {
    violations.push('EXECUTED: smoke report ausente (qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json)');
  } else if (smokeReport.status !== 'GO') {
    violations.push(`EXECUTED: smoke report status=${smokeReport.status} (esperado: GO)`);
  }

  // EVIDENCE_GENERATED: smoke flows devem ter sido executados
  const flows = smokeReport?.flows || [];
  if (flows.length === 0) {
    violations.push('EVIDENCE_GENERATED: smoke report sem flows executados');
  } else {
    const failedFlows = flows.filter((f) => f.replay?.status !== 'GO');
    if (failedFlows.length > 0) {
      violations.push(`EVIDENCE_GENERATED: ${failedFlows.length} flow(s) com replay.status≠GO`);
    }
  }

  // VALIDATED: replay hardening deve ter passado
  if (!hardeningReport) {
    violations.push('VALIDATED: replay-hardening-report.json ausente');
  } else if (!hardeningReport.decision?.includes('GO')) {
    violations.push(`VALIDATED: replay hardening decision=${hardeningReport.decision} (esperado: *GO*)`);
  }

  return violations;
}

function run() {
  const runId = readJson('governance/.current-run.json')?.runId || null;
  const violations = [];

  // Fase 1: pipeline real
  let discovery;
  try {
    discovery = runRealDiscovery();
  } catch (err) {
    violations.push(`PIPELINE_ERROR: falha ao executar pipeline real: ${err.message}`);
    const report = {
      generatedAt: new Date().toISOString(),
      runId,
      engine:      'model-driven-e2e/v2-real-pipeline',
      pass:        false,
      decision:    'MODEL_DRIVEN_E2E_FAIL',
      violations,
    };
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.error(`[model-driven-e2e] PIPELINE_ERROR: ${err.message}`);
    return report;
  }

  violations.push(...validateDiscovery(discovery));

  // Fase 2: evidências de execução reais
  const evidence = readExecutionEvidence();
  violations.push(...validateExecution(evidence));

  const pass = violations.length === 0;

  const { journeysReport, topologicalOrder, cycles, candidateJourneys, entityGraph, introspection } = discovery;

  const report = {
    generatedAt:    new Date().toISOString(),
    runId,
    engine:         'model-driven-e2e/v2-real-pipeline',
    pass,
    decision:       pass ? 'MODEL_DRIVEN_E2E_VALIDATED' : 'MODEL_DRIVEN_E2E_FAIL',
    violations,
    pipelineOutput: {
      modelsIntrospected:      introspection.totalModels,
      modelsLoaded:            introspection.modelsLoaded,
      entityGraphNodes:        (entityGraph?.nodes || []).length,
      entityGraphEdges:        (entityGraph?.edges || []).length,
      journeysDiscovered:      journeysReport.totalJourneys,
      candidateJourneys:       candidateJourneys.length,
      topologicalOrderLength:  topologicalOrder.length,
      topologicalCycles:       cycles.length,
      topologicalSample:       topologicalOrder.slice(0, 10),
    },
    executionEvidence: {
      smokeStatus:      evidence.smokeReport?.status || null,
      smokeFlowsCount:  (evidence.smokeReport?.flows || []).length,
      smokeFlowsPassed: (evidence.smokeReport?.flows || []).filter((f) => f.replay?.status === 'GO').length,
      hardeningDecision: evidence.hardeningReport?.decision || null,
      consistencyDecision: evidence.consistReport?.decision || null,
    },
    candidateJourneysSample: candidateJourneys.slice(0, 3).map((j) => ({
      id:     j.id,
      domain: j.domain,
      entityCount: (j.entities || []).length,
    })),
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[model-driven-e2e] decision=${report.decision} journeys=${journeysReport.totalJourneys} models=${introspection.totalModels} violations=${violations.length}`);
  if (violations.length > 0) {
    violations.forEach((v) => console.log(`  VIOLATION: ${v}`));
  }

  return report;
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  process.exit(r.pass ? 0 : 1);
}
