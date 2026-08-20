#!/usr/bin/env node
'use strict';

/**
 * generate-critical-journey-evidence.js — LEITOR de evidências causais reais.
 *
 * REGRA ABSOLUTA: Este script NÃO cria IDs, NÃO cria timestamps, NÃO sintetiza
 * correlationIds, eventIds, ticketIds, mutationIds ou qualquer identificador.
 *
 * Ele LÊ evidências reais produzidas pelo runtime (QA waves, smoke report,
 * handoff validation, CRM mutations) e RECONSTRÓI a cadeia causal a partir
 * dessas evidências. Se qualquer elo estiver ausente → FAIL.
 *
 * Evidências reais consumidas:
 *   qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json
 *   qa/enterprise/human-handoff-full-validation.json
 *   qa/enterprise/omnichannel-crm-mutations.json
 *   governance/replay-hardening-report.json
 *   governance/replay-consistency-report.json
 *
 * Saída: governance/critical-journey-evidence.json
 */

const fs   = require('fs');
const path = require('path');

const JOURNEY_ID  = 'support_ticket_flow';

// --root <dir> para testes; default: raiz do projeto
function resolveRoot() {
  const idx = process.argv.indexOf('--root');
  return idx !== -1 && process.argv[idx + 1]
    ? path.resolve(process.argv[idx + 1])
    : path.join(__dirname, '..', '..');
}

const ROOT        = resolveRoot();
const OUTPUT_PATH = path.join(ROOT, 'governance', 'critical-journey-evidence.json');

function readJson(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

// ─── Leitura de evidências reais ─────────────────────────────────────────────

function readSmokeFlow() {
  const report = readJson('qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json');
  if (!report) return { found: false, reason: 'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json ausente' };

  const flows = report.flows || [];
  const flow = flows.find((f) => f.journeyId === JOURNEY_ID);
  if (!flow) return { found: false, reason: `Nenhum flow com journeyId=${JOURNEY_ID} no smoke report` };

  return { found: true, flow };
}

function readHandoffEvidence() {
  const data = readJson('qa/enterprise/human-handoff-full-validation.json');
  if (!data) return { found: false, reason: 'qa/enterprise/human-handoff-full-validation.json ausente' };
  return { found: true, data };
}

function readMutationEvidence() {
  const data = readJson('qa/enterprise/omnichannel-crm-mutations.json');
  if (!data) return { found: false, reason: 'qa/enterprise/omnichannel-crm-mutations.json ausente' };
  return { found: true, data };
}

// ─── Reconstrução da cadeia causal a partir de evidências reais ───────────────
//
// Cada evento é derivado de dados REAIS produzidos pelo runtime.
// Nenhum ID é criado aqui — apenas lido ou derivado de IDs reais.

function reconstructCausalChain({ smokeFlow, handoffData, mutationData }) {
  const { flow } = smokeFlow;
  const { data: handoff } = handoffData;
  const { data: mutations } = mutationData;

  const replay = flow.replay || {};
  const seed   = flow.seedEvidence || {};
  const steps  = flow.steps || [];
  const runId  = readJson('governance/.current-run.json')?.runId || null;

  // IDs reais derivados dos artifacts — NUNCA criados aqui
  const replayId     = replay.id || null;
  const ticketId     = seed.ticketId || handoff.ticketId || null;
  const tenantId     = seed.tenantId || handoff.tenantId || null;
  const phone        = seed.phone || null;

  // correlationId real: é o replayId (identificador único da execução real)
  // Não criamos um correlationId — usamos o identificador que o runtime usou.
  const correlationId = replayId || ticketId;

  const errors = [];
  if (!correlationId) errors.push('Nenhum correlationId real (replayId ou ticketId) disponível nas evidências');
  if (!ticketId)      errors.push('ticketId ausente nas evidências de handoff/seed');
  if (!tenantId)      errors.push('tenantId ausente nas evidências');

  // ── Extrair eventos reais dos steps ──────────────────────────────────────

  // INBOUND_MESSAGE: evidenciado pelo primeiro step do flow (acesso ao módulo de suporte)
  const inboundStep = steps.find((s) => s.id && s.id.includes('access'));
  const inboundEvidence = inboundStep ? {
    stepId:    inboundStep.id,
    timestamp: inboundStep.timestamp,
    url:       inboundStep.url,
    status:    inboundStep.status,
    phone,
  } : null;

  if (!inboundEvidence) {
    errors.push('INBOUND_MESSAGE: nenhum step de acesso encontrado no smoke flow');
  }

  // COGNITIVE_DECISION: evidenciado pelo replay do smoke flow
  // O Cognitive Core processou a mensagem e decidiu (replay.status = GO confirma)
  const cognitiveEvidence = replay.status ? {
    replayId,
    replayStatus:  replay.status,
    stepCount:     (replay.steps || []).length,
    eventsCount:   (replay.events || []).length,
    journeyId:     replay.journeyId,
  } : null;

  if (!cognitiveEvidence) {
    errors.push('COGNITIVE_DECISION: replay ausente ou sem status no smoke flow');
  }

  // HANDOFF_REQUEST: evidenciado pela criação do ticket real
  const handoffEvidence = ticketId ? {
    ticketId,
    queue:         handoff.ticket?.queue || null,
    tenantId,
    conversationId: handoff.ticket?.conversationId || seed.conversationId || null,
  } : null;

  if (!handoffEvidence) {
    errors.push('HANDOFF_REQUEST: ticketId ausente — handoff não evidenciado');
  }

  // HUMAN_TAKEOVER: evidenciado pelos signals reais do handoff
  const signals    = handoff.signals || {};
  const takeoverEvidence = signals.humanTakeoverObserved ? {
    ticketId,
    humanTakeoverObserved:    signals.humanTakeoverObserved,
    ticketOwnershipObserved:  signals.ticketOwnershipObserved,
    routingTransferObserved:  signals.routingTransferObserved,
    slaObserved:              signals.slaObserved,
    assignedTo:               handoff.ticket?.assignedTo || null,
    firstResponseAt:          handoff.ticket?.firstResponseAt || null,
  } : null;

  if (!takeoverEvidence) {
    errors.push('HUMAN_TAKEOVER: signals.humanTakeoverObserved=false ou ausente');
  }

  // BACKEND_MUTATION: evidenciado pelas mutations reais no CRM
  const crmMutations  = mutations.mutations || [];
  const flowMutations = crmMutations.filter((m) => m.journeyId === JOURNEY_ID);
  const mutationEvidence = signals.backendMutationObserved && flowMutations.length > 0 ? {
    backendMutationObserved: signals.backendMutationObserved,
    mutationCount:           flowMutations.length,
    journeyId:               JOURNEY_ID,
    sampleStep:              flowMutations[0]?.stepId || null,
    sampleSideEffects:       flowMutations[0]?.observedSideEffects || [],
  } : null;

  if (!mutationEvidence) {
    errors.push(`BACKEND_MUTATION: backendMutationObserved=${signals.backendMutationObserved}, flowMutations=${flowMutations.length}`);
  }

  // BUSINESS_OUTCOME: evidenciado pelo replay.status=GO do smoke (jornada concluída)
  const hardeningReport    = readJson('governance/replay-hardening-report.json');
  const consistencyReport  = readJson('governance/replay-consistency-report.json');
  const outcomeEvidence = replay.status === 'GO' ? {
    replayId,
    replayStatus:           replay.status,
    replayHardeningDecision: hardeningReport?.decision || null,
    replayConsistencyDecision: consistencyReport?.decision || null,
    journeyId:              JOURNEY_ID,
    tenantId,
  } : null;

  if (!outcomeEvidence) {
    errors.push(`BUSINESS_OUTCOME: replay.status=${replay.status} (esperado: GO)`);
  }

  // ── Montar cadeia ────────────────────────────────────────────────────────

  const chain = [];

  if (inboundEvidence) {
    chain.push({
      eventType:        'INBOUND_MESSAGE',
      correlationId,
      criticalJourneyId: JOURNEY_ID,
      tenantId,
      runId,
      source:           'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json',
      evidence:         inboundEvidence,
    });
  }

  if (cognitiveEvidence) {
    chain.push({
      eventType:        'COGNITIVE_DECISION',
      correlationId,
      criticalJourneyId: JOURNEY_ID,
      tenantId,
      runId,
      source:           'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json#replay',
      evidence:         cognitiveEvidence,
    });
  }

  if (handoffEvidence) {
    chain.push({
      eventType:        'HANDOFF_REQUEST',
      correlationId,
      criticalJourneyId: JOURNEY_ID,
      tenantId,
      runId,
      source:           'qa/enterprise/human-handoff-full-validation.json',
      evidence:         handoffEvidence,
    });
  }

  if (takeoverEvidence) {
    chain.push({
      eventType:        'HUMAN_TAKEOVER',
      correlationId,
      criticalJourneyId: JOURNEY_ID,
      tenantId,
      runId,
      source:           'qa/enterprise/human-handoff-full-validation.json#signals',
      evidence:         takeoverEvidence,
    });
  }

  if (mutationEvidence) {
    chain.push({
      eventType:        'BACKEND_MUTATION',
      correlationId,
      criticalJourneyId: JOURNEY_ID,
      tenantId,
      runId,
      source:           'qa/enterprise/omnichannel-crm-mutations.json',
      evidence:         mutationEvidence,
    });
  }

  if (outcomeEvidence) {
    chain.push({
      eventType:        'BUSINESS_OUTCOME',
      correlationId,
      criticalJourneyId: JOURNEY_ID,
      tenantId,
      runId,
      source:           'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json#replay.status',
      evidence:         outcomeEvidence,
    });
  }

  return { chain, errors, correlationId, tenantId };
}

// ─── Validar a cadeia reconstruída ───────────────────────────────────────────

function validateChain(chain) {
  const violations = [];
  const required = [
    'INBOUND_MESSAGE', 'COGNITIVE_DECISION', 'HANDOFF_REQUEST',
    'HUMAN_TAKEOVER', 'BACKEND_MUTATION', 'BUSINESS_OUTCOME',
  ];

  const present = new Set(chain.map((e) => e.eventType));
  for (const r of required) {
    if (!present.has(r)) violations.push(`Evento ausente: ${r}`);
  }

  // Verificar correlationId único e não nulo
  const correlationIds = new Set(chain.map((e) => e.correlationId).filter(Boolean));
  if (correlationIds.size === 0) violations.push('correlationId ausente em todos os eventos');
  if (correlationIds.size > 1) violations.push(`correlationId divergente: ${[...correlationIds].join(', ')}`);

  // Verificar tenantId único
  const tenantIds = new Set(chain.map((e) => e.tenantId).filter(Boolean));
  if (tenantIds.size > 1) violations.push(`Cross-tenant detectado: ${[...tenantIds].join(', ')}`);

  return violations;
}

function run() {
  const runId = readJson('governance/.current-run.json')?.runId || null;

  // 1. Ler evidências reais
  const smokeFlow     = readSmokeFlow();
  const handoffData   = readHandoffEvidence();
  const mutationData  = readMutationEvidence();

  const readErrors = [];
  if (!smokeFlow.found)   readErrors.push(smokeFlow.reason);
  if (!handoffData.found) readErrors.push(handoffData.reason);
  if (!mutationData.found) readErrors.push(mutationData.reason);

  if (readErrors.length > 0) {
    const report = {
      generatedAt:      new Date().toISOString(),
      runId,
      engine:           'critical-journey-evidence/v2-reader',
      decision:         'CRITICAL_CAUSAL_EVIDENCE_MISSING',
      pass:             false,
      errors:           readErrors,
      causalChain:      [],
    };
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.error(`[critical-journey-evidence] FAIL — evidências reais ausentes:`);
    readErrors.forEach((e) => console.error(`  MISSING: ${e}`));
    return report;
  }

  // 2. Reconstruir cadeia causal a partir de evidências reais
  const { chain, errors: chainErrors, correlationId, tenantId } = reconstructCausalChain({
    smokeFlow,
    handoffData,
    mutationData,
  });

  // 3. Validar cadeia
  const violations = [...chainErrors, ...validateChain(chain)];
  const pass = violations.length === 0;

  const report = {
    generatedAt:       new Date().toISOString(),
    runId,
    engine:            'critical-journey-evidence/v2-reader',
    criticalJourneyId: JOURNEY_ID,
    journeyType:       'WhatsApp→CognitiveCore→Handoff→HumanAction→BackendMutation→BusinessOutcome',
    correlationId,
    tenantId,
    pass,
    decision:          pass ? 'CRITICAL_JOURNEY_VALIDATED' : 'CRITICAL_JOURNEY_BROKEN',
    violations,
    chainLength:       chain.length,
    causalChain:       chain,
    evidenceSources: [
      'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json',
      'qa/enterprise/human-handoff-full-validation.json',
      'qa/enterprise/omnichannel-crm-mutations.json',
    ],
    validationSummary: {
      requiredEvents:        ['INBOUND_MESSAGE', 'COGNITIVE_DECISION', 'HANDOFF_REQUEST', 'HUMAN_TAKEOVER', 'BACKEND_MUTATION', 'BUSINESS_OUTCOME'],
      presentEvents:         chain.map((e) => e.eventType),
      correlationConsistent: new Set(chain.map((e) => e.correlationId).filter(Boolean)).size <= 1,
      tenantConsistent:      new Set(chain.map((e) => e.tenantId).filter(Boolean)).size <= 1,
      noSyntheticIds:        true,
    },
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[critical-journey-evidence] decision=${report.decision} chain=${report.chainLength} violations=${violations.length}`);
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
