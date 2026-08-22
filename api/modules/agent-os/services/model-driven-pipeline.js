'use strict';

/**
 * Entity Graph Service + Journey Inference Engine + Scenario Generator + Seed Generator
 *
 * Pipeline completo model-driven:
 *   Models → Entity Graph → Journey Inference → Scenario Generation → Seed Generation
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function nowIso() { return new Date().toISOString(); }
function makeHash(input) { return crypto.createHash('sha256').update(String(input)).digest('hex'); }
function makeId(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function makeStableId(prefix, input) { return `${prefix}_${makeHash(input).slice(0, 24)}`; }

// ============================================================================
// FASE 3: ENTITY GRAPH
// ============================================================================

/**
 * Constrói grafo de entidades a partir dos models e FK.
 */
function buildEntityGraph(introspectionReport, domainMap) {
  const models = introspectionReport.models || [];
  const nodes = [];
  const edges = [];

  // Cria nodes
  for (const model of models) {
    if (model.error) continue;
    nodes.push({
      id: model.modelName,
      label: model.modelName,
      tableName: model.tableName,
      domain: findDomainForModel(model.modelName, domainMap),
      totalAttributes: model.totalAttributes,
      primaryKeys: model.primaryKeys || [],
    });
  }

  // Cria edges a partir de FK (metadata real: references/associations).
  // references.model pode ser tableName ('kg_nodes') ou modelName
  // ('KnowledgeGraphNode') — resolve por ambos.
  const nodeIds = new Set(nodes.map(n => n.id));
  const nodeIdByTableName = new Map(nodes.map(n => [n.tableName, n.id]));
  for (const model of models) {
    if (model.error || !model.foreignKeys) continue;
    for (const [fkName, fkDef] of Object.entries(model.foreignKeys)) {
      let targetModel = fkDef.referencedModel;
      if (!nodeIds.has(targetModel) && fkDef.referencedTable && nodeIdByTableName.has(fkDef.referencedTable)) {
        targetModel = nodeIdByTableName.get(fkDef.referencedTable);
      }
      if (!nodeIds.has(targetModel) && nodeIdByTableName.has(String(targetModel))) {
        targetModel = nodeIdByTableName.get(String(targetModel));
      }
      if (nodeIds.has(targetModel)) {
        edges.push({
          source: model.modelName,
          target: targetModel,
          relationship: fkName.replace(/_id$|_key$/, ''),
          fkField: fkName,
          fkSource: fkDef.source || null,
          required: !fkDef.allowNull,
        });
      }
    }
  }

  // Adiciona edges de domínio (models no mesmo domínio)
  const domainModels = {};
  if (domainMap?.domains) {
    for (const domain of domainMap.domains) {
      const modelNames = domain.models.map(m => m.modelName);
      domainModels[domain.domain] = modelNames;
      // Conecta models do mesmo domínio via edge de domínio
      for (let i = 0; i < modelNames.length; i++) {
        for (let j = i + 1; j < modelNames.length; j++) {
          if (!edges.some(e =>
            (e.source === modelNames[i] && e.target === modelNames[j]) ||
            (e.source === modelNames[j] && e.target === modelNames[i])
          )) {
            edges.push({
              source: modelNames[i],
              target: modelNames[j],
              relationship: 'same_domain',
              domain: domain.domain,
              required: false,
            });
          }
        }
      }
    }
  }

  return {
    generatedAt: nowIso(),
    totalNodes: nodes.length,
    totalEdges: edges.length,
    nodes,
    edges,
  };
}

function findDomainForModel(modelName, domainMap) {
  if (!domainMap?.domains) return 'Unassigned';
  for (const domain of domainMap.domains) {
    if (domain.models.some(m => m.modelName === modelName)) {
      return domain.domain;
    }
  }
  return 'Unassigned';
}

// ============================================================================
// FASE 4: JOURNEY INFERENCE ENGINE
// ============================================================================

/**
 * Definições de jornadas inferidas dos modelos.
 */
const JOURNEY_TEMPLATES = {
  'Omnichannel Attendance': {
    domain: 'Omnichannel',
    sourceModels: ['ChannelConversation', 'ChannelMessage', 'Ticket', 'TicketEvent', 'Evidence'],
    entrypoints: ['ChannelConversation'],
    expectedOutcomes: ['ticket_resolved', 'customer_satisfied'],
    successCriteria: ['ticket_status_closed', 'evidence_generated', 'all_messages_delivered'],
    failureCriteria: ['ticket_abandoned', 'no_agent_available', 'message_delivery_failed'],
  },
  'Scheduling & Booking': {
    domain: 'Agenda / Scheduling',
    sourceModels: ['Schedule', 'Resource', 'ResourceAvailability', 'ResourceBooking', 'PaymentEvent'],
    entrypoints: ['Schedule', 'ResourceBooking'],
    expectedOutcomes: ['booking_confirmed', 'payment_processed'],
    successCriteria: ['booking_status_confirmed', 'payment_completed', 'resource_available'],
    failureCriteria: ['booking_conflict', 'payment_failed', 'resource_unavailable'],
  },
  'Campaign Conversion': {
    domain: 'CRM / Growth',
    sourceModels: ['MarketingLead', 'MarketingFormSubmission', 'MarketingEmailCampaign', 'CcCampaign', 'ChannelConversation'],
    entrypoints: ['MarketingLead', 'CcCampaign'],
    expectedOutcomes: ['lead_converted', 'campaign_executed'],
    successCriteria: ['form_submitted', 'email_delivered', 'lead_status_converted'],
    failureCriteria: ['email_bounced', 'form_abandoned', 'lead_duplicated'],
  },
  'Order & Delivery': {
    domain: 'Food / Delivery',
    sourceModels: ['Order', 'Delivery', 'PaymentEvent', 'ChannelMessage'],
    entrypoints: ['Order'],
    expectedOutcomes: ['order_delivered', 'payment_received'],
    successCriteria: ['order_status_delivered', 'delivery_completed', 'payment_confirmed'],
    failureCriteria: ['order_cancelled', 'delivery_failed', 'payment_declined'],
  },
  'Process Automation': {
    domain: 'Automation',
    sourceModels: ['Flow', 'FlowExecution', 'NodeExecution', 'ProcessExecutionEvent', 'Evidence'],
    entrypoints: ['Flow', 'FlowExecution'],
    expectedOutcomes: ['flow_completed', 'evidence_generated'],
    successCriteria: ['execution_status_completed', 'all_nodes_executed', 'process_event_recorded'],
    failureCriteria: ['node_failed', 'execution_timeout', 'process_event_missing'],
  },
  'Voice / PBX Call': {
    domain: 'PBX / Voice',
    sourceModels: ['PbxCdr', 'PbxQueue', 'PbxExtension', 'Ticket', 'Evidence'],
    entrypoints: ['PbxCdr'],
    expectedOutcomes: ['call_connected', 'ticket_linked'],
    successCriteria: ['cdr_recorded', 'queue_processed', 'ticket_created'],
    failureCriteria: ['call_dropped', 'queue_timeout', 'no_agent_available'],
  },
  'Agent Validation': {
    domain: 'Agent OS',
    sourceModels: ['CorporateAgent', 'JourneyRegistry', 'Evidence', 'AiGovernanceRecord', 'LearningRecord'],
    entrypoints: ['CorporateAgent'],
    expectedOutcomes: ['agent_validated', 'governance_recorded'],
    successCriteria: ['qa_wave_passed', 'evidence_generated', 'replay_generated', 'governance_approved'],
    failureCriteria: ['qa_wave_failed', 'evidence_missing', 'governance_rejected'],
  },
  'Access / Check-in': {
    domain: 'Access / Fitness',
    sourceModels: ['AccessSubject', 'AccessMembership', 'AccessCredential', 'AccessDevice', 'AccessEvent'],
    entrypoints: ['AccessSubject', 'AccessEvent'],
    expectedOutcomes: ['checkin_completed', 'access_granted'],
    successCriteria: ['device_recognized', 'credential_valid', 'access_event_recorded'],
    failureCriteria: ['device_unknown', 'credential_expired', 'access_denied'],
  },
  'Workspace 360': {
    domain: 'Workspace',
    sourceModels: ['WorkspaceEntity', 'WorkspaceTimelineEvent', 'WorkspaceInsight', 'WorkspaceAction', 'WorkspaceEntityLink'],
    entrypoints: ['WorkspaceEntity'],
    expectedOutcomes: ['entity_linked', 'timeline_updated', 'insight_generated'],
    successCriteria: ['entity_created', 'links_established', 'timeline_recorded', 'insight_critical'],
    failureCriteria: ['entity_not_found', 'links_missing', 'timeline_empty'],
  },
};

/**
 * FASES 13-14 — Inferência de jornadas candidatas via entity graph (FKs
 * reais). Componentes de models conectados por FK que NÃO são cobertos por
 * nenhuma jornada de template geram:
 *   - `candidateJourneys`: jornada candidata inferida via FK (status
 *     'candidate', source 'entity_graph_fk');
 *   - `uncoveredBehaviors`: sinal 'behavior_without_registered_journey' por
 *     model conectado por FK sem jornada registrada.
 * Os JOURNEY_TEMPLATES continuam como conhecimento adicional — não são mais
 * a única fonte de descoberta.
 */
function inferFkCandidateJourneys(introspectionReport, entityGraph, templateJourneys = []) {
  const fkEdges = (entityGraph?.edges || []).filter(e => e.relationship !== 'same_domain');
  const nodeDomain = new Map((entityGraph?.nodes || []).map(n => [n.id, n.domain]));
  const coveredModels = new Set(templateJourneys.flatMap(j => j.availableModels || []));

  // Adjacência não-direcionada (componentes) + grau de entrada (entrypoints)
  const adjacency = new Map();
  const inDegree = new Map();
  for (const edge of fkEdges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
    if (!inDegree.has(edge.source)) inDegree.set(edge.source, 0);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  }

  // Componentes conectados — visita em ordem alfabética (determinístico)
  const visited = new Set();
  const components = [];
  for (const start of [...adjacency.keys()].sort()) {
    if (visited.has(start)) continue;
    const component = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const current = queue.shift();
      component.push(current);
      for (const next of [...(adjacency.get(current) || [])].sort()) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    components.push(component.sort());
  }

  const candidateJourneys = [];
  const uncoveredBehaviors = [];

  for (const component of components) {
    const uncovered = component.filter(m => !coveredModels.has(m));
    if (uncovered.length === 0) continue;

    for (const modelName of uncovered) {
      uncoveredBehaviors.push({
        model: modelName,
        signal: 'behavior_without_registered_journey',
        linkedModels: [...(adjacency.get(modelName) || [])].sort(),
        fkLinked: true,
      });
    }

    const entrypoints = component.filter(m => (inDegree.get(m) || 0) === 0);
    const domainCounts = {};
    for (const m of component) {
      const d = nodeDomain.get(m) || 'Unassigned';
      domainCounts[d] = (domainCounts[d] || 0) + 1;
    }
    const dominantDomain = Object.entries(domainCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const componentEdges = fkEdges.filter(e => component.includes(e.source) && component.includes(e.target));
    const rootName = entrypoints[0] || component[0];

    // BLOCKER 8 — Candidate Journey states: DISCOVERED é o estado inicial.
    // Pipeline: DISCOVERED → REGISTERED → SCENARIO_GENERATED → SEED_READY
    //           → EXECUTED → VALIDATED.
    // Jornadas descobertas via entity graph entram como DISCOVERED.
    // Jornadas mutáveis ou de alto risco não são autoativadas (exigem approval).
    const candidateSignature = JSON.stringify({
      component,
      entrypoints: entrypoints.length > 0 ? entrypoints : [component[0]],
      fkEdges: componentEdges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        fkField: edge.fkField || null,
      })),
    });
    candidateJourneys.push({
      id: makeStableId('candidate_journey', candidateSignature),
      name: `FK Candidate: ${rootName}`,
      slug: `fk-candidate-${rootName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      description: `Jornada candidata inferida via FKs reais do entity graph (${component.length} models conectados, ${uncovered.length} sem jornada registrada)`,
      domain: dominantDomain,
      source: 'entity_graph_fk',
      inferredFromFk: true,
      status: 'DISCOVERED',
      pipelineState: 'DISCOVERED',
      autoActivate: false,
      requiresApproval: uncovered.some(m => m.toLowerCase().includes('payment') || m.toLowerCase().includes('mutation')),
      sourceModels: component,
      availableModels: component,
      missingModels: [],
      uncoveredModels: uncovered,
      entrypoints: entrypoints.length > 0 ? entrypoints : [component[0]],
      fkEdges: componentEdges,
      expectedOutcomes: [],
      successCriteria: [],
      failureCriteria: [],
      completeness: 1,
      discoveredAt: nowIso(),
    });
  }

  return { candidateJourneys, uncoveredBehaviors, fkEdgesAnalyzed: fkEdges.length };
}

/**
 * Infere jornadas a partir do domain map e entity graph.
 */
function inferJourneys(introspectionReport, domainMap, entityGraph) {
  const modelNames = new Set((introspectionReport.models || []).map(m => m.modelName));
  const journeys = [];

  for (const [journeyName, template] of Object.entries(JOURNEY_TEMPLATES)) {
    const availableModels = template.sourceModels.filter(m => modelNames.has(m));
    const missingModels = template.sourceModels.filter(m => !modelNames.has(m));

    if (availableModels.length === 0) continue;

    // Determina required vs optional baseado nos domínios que têm todos os models
    const domain = domainMap?.domains?.find(d => d.domain === template.domain);

    journeys.push({
      id: makeStableId('journey', JSON.stringify({ journeyName, sourceModels: template.sourceModels })),
      domain: template.domain,
      name: journeyName,
      slug: journeyName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      description: `Jornada model-driven inferida: ${journeyName}`,
      sourceModels: template.sourceModels,
      availableModels,
      missingModels,
      requiredModels: availableModels.filter(m => {
        const model = introspectionReport.models.find(md => md.modelName === m);
        return model && model.totalRequired > 0;
      }),
      optionalModels: availableModels.filter(m => {
        const model = introspectionReport.models.find(md => md.modelName === m);
        return model && model.totalRequired === 0;
      }),
      entrypoints: template.entrypoints.filter(e => modelNames.has(e)),
      expectedOutcomes: template.expectedOutcomes,
      successCriteria: template.successCriteria,
      failureCriteria: template.failureCriteria,
      kpis: domain?.kpis || [],
      completeness: availableModels.length / template.sourceModels.length,
      status: availableModels.length === template.sourceModels.length ? 'complete' : 'partial',
      pipelineState: 'REGISTERED',
    });
  }

  // FASES 13-14 — o entityGraph (FKs reais) é consumido de verdade: templates
  // são conhecimento adicional, não a única fonte de descoberta de jornadas.
  const { candidateJourneys, uncoveredBehaviors, fkEdgesAnalyzed } =
    inferFkCandidateJourneys(introspectionReport, entityGraph, journeys);

  return {
    generatedAt: nowIso(),
    totalJourneys: journeys.length,
    journeys,
    candidateJourneys,
    totalCandidateJourneys: candidateJourneys.length,
    uncoveredBehaviors,
    entityGraphConsumed: true,
    fkEdgesAnalyzed,
  };
}

function isExactGo(value) {
  return value === 'GO';
}

function hasValidRegistrationEvidence(candidate, context = {}) {
  const evidence = candidate?.registrationEvidence;
  if (!evidence || typeof evidence !== 'object') return false;
  if (evidence.stage !== 'REGISTERED' || evidence.journeyId !== candidate.id) return false;
  if (!evidence.registrationId || !evidence.approvedBy || !evidence.producer) return false;
  if (!Number.isFinite(Date.parse(evidence.producedAt))) return false;
  if (context.runId && evidence.runId !== context.runId) return false;
  if (context.sourceFingerprint && evidence.sourceFingerprint !== context.sourceFingerprint) return false;
  return true;
}

/**
 * Fonte canônica para as fases posteriores do pipeline. Templates registrados
 * sempre entram; candidates somente entram após registro/aprovação explícitos.
 */
function resolveEligibleJourneys(journeysReport = {}, context = {}) {
  const registeredJourneys = Array.isArray(journeysReport.journeys)
    ? journeysReport.journeys
    : [];
  const candidates = Array.isArray(journeysReport.candidateJourneys)
    ? journeysReport.candidateJourneys
    : [];
  const eligibleCandidates = [];
  const rejectedCandidates = [];

  for (const candidate of candidates) {
    const registered = candidate?.pipelineState === 'REGISTERED'
      && candidate?.status === 'REGISTERED'
      && hasValidRegistrationEvidence(candidate, context);
    if (!registered) {
      rejectedCandidates.push({ id: candidate?.id || null, reason: 'candidate_not_registered' });
      continue;
    }
    eligibleCandidates.push(candidate);
  }

  const seen = new Set();
  const journeys = [...registeredJourneys, ...eligibleCandidates].filter((journey) => {
    if (!journey?.id || seen.has(journey.id)) return false;
    seen.add(journey.id);
    return true;
  });

  return {
    journeys,
    registeredJourneys,
    eligibleCandidates,
    rejectedCandidates,
    totalJourneys: journeys.length,
  };
}

const CANDIDATE_LIFECYCLE_STAGES = Object.freeze([
  'REGISTERED',
  'SCENARIO_GENERATED',
  'SEED_PLANNED',
  'SEED_READY',
  'WAVE_CREATED',
  'EXECUTED',
  'EVIDENCE_GENERATED',
  'VALIDATED',
]);

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function validateLifecycleArtifact(stage, artifact, previous, context) {
  const violations = [];
  if (!artifact || typeof artifact !== 'object') return [`${stage}: artifact ausente`];
  if (artifact.stage !== stage) violations.push(`${stage}: stage inválido`);
  if (!artifact.producer || !Number.isFinite(Date.parse(artifact.producedAt))) {
    violations.push(`${stage}: producer/producedAt ausente ou inválido`);
  }
  if (context.runId && artifact.runId !== context.runId) violations.push(`${stage}: foreign runId`);
  if (context.sourceFingerprint && artifact.sourceFingerprint !== context.sourceFingerprint) {
    violations.push(`${stage}: foreign sourceFingerprint`);
  }

  if (stage === 'REGISTERED' && (!artifact.registrationId || !artifact.approvedBy)) {
    violations.push('REGISTERED: registrationId/approvedBy ausente');
  }
  if (stage === 'SCENARIO_GENERATED' && !nonEmptyArray(artifact.scenarioIds)) {
    violations.push('SCENARIO_GENERATED: scenarioIds vazio');
  }
  if (stage === 'SEED_PLANNED' && !artifact.seedPlanId) {
    violations.push('SEED_PLANNED: seedPlanId ausente');
  }
  if (stage === 'SEED_READY') {
    if (!nonEmptyArray(artifact.seedIds)) violations.push('SEED_READY: seedIds vazio');
    if (artifact.provisioned !== true) violations.push('SEED_READY: seed não provisionada');
    if (artifact.fkIntegrity?.valid !== true) violations.push('SEED_READY: FK integrity inválida');
  }
  if (stage === 'WAVE_CREATED') {
    if (!artifact.waveId || !nonEmptyArray(artifact.scenarioIds)) violations.push('WAVE_CREATED: wave/scenarios ausentes');
    if (previous?.scenarioIds && !artifact.scenarioIds.every((id) => previous.scenarioIds.includes(id))) {
      violations.push('WAVE_CREATED: scenarioIds não derivam do scenario artifact');
    }
  }
  if (stage === 'EXECUTED') {
    if (!artifact.executionId || !artifact.waveId) violations.push('EXECUTED: executionId/waveId ausente');
    if (!isExactGo(artifact.status)) violations.push(`EXECUTED: status=${artifact.status || 'missing'} (esperado GO exato)`);
    if (previous?.waveId && artifact.waveId !== previous.waveId) violations.push('EXECUTED: waveId divergente');
  }
  if (stage === 'EVIDENCE_GENERATED') {
    if (!artifact.executionId || !artifact.evidenceId) violations.push('EVIDENCE_GENERATED: executionId/evidenceId ausente');
    if (previous?.executionId && artifact.executionId !== previous.executionId) {
      violations.push('EVIDENCE_GENERATED: executionId divergente');
    }
  }
  if (stage === 'VALIDATED') {
    if (!isExactGo(artifact.decision)) violations.push(`VALIDATED: decision=${artifact.decision || 'missing'} (esperado GO exato)`);
    if (!artifact.executionId || !artifact.evidenceId || !artifact.replayId) {
      violations.push('VALIDATED: execution/evidence/replay linkage ausente');
    }
    if (previous?.executionId && artifact.executionId !== previous.executionId) violations.push('VALIDATED: executionId divergente');
    if (previous?.evidenceId && artifact.evidenceId !== previous.evidenceId) violations.push('VALIDATED: evidenceId divergente');
  }
  return violations;
}

/**
 * Reconstrói a lifecycle de uma candidate exclusivamente de artifacts emitidos
 * pelos componentes responsáveis. Não cria timestamps nem promove smoke global.
 */
function evaluateCandidateJourneyLifecycle(candidate, artifacts = [], context = {}) {
  const violations = [];
  const transitions = [];
  let pipelineState = candidate?.pipelineState || 'DISCOVERED';
  let previous = null;
  let previousTimestamp = -Infinity;

  for (const stage of CANDIDATE_LIFECYCLE_STAGES) {
    const matches = artifacts.filter((artifact) => artifact?.journeyId === candidate?.id && artifact?.stage === stage);
    if (matches.length !== 1) {
      violations.push(`${stage}: esperado exatamente 1 artifact candidate-specific; encontrado ${matches.length}`);
      break;
    }
    const artifact = matches[0];
    const stageViolations = validateLifecycleArtifact(stage, artifact, previous, context);
    const timestamp = Date.parse(artifact.producedAt);
    if (Number.isFinite(timestamp) && timestamp < previousTimestamp) {
      stageViolations.push(`${stage}: producedAt fora de ordem`);
    }
    if (stageViolations.length > 0) {
      violations.push(...stageViolations);
      break;
    }
    transitions.push({ ...artifact });
    pipelineState = stage;
    previous = artifact;
    previousTimestamp = timestamp;
  }

  return {
    ...candidate,
    pipelineState,
    transitions,
    violations,
    valid: pipelineState === 'VALIDATED' && violations.length === 0,
  };
}

// ============================================================================
// FASE 6: SCENARIO GENERATION
// ============================================================================

/**
 * Gera cenários de teste a partir de constraints dos models.
 */
function generateScenarios(introspectionReport, journeys) {
  const allScenarios = [];

  for (const journey of journeys.journeys || []) {
    const journeyScenarios = [];

    // Para cada model na jornada, gera cenários baseados nas constraints
    for (const modelName of journey.availableModels) {
      const model = (introspectionReport.models || []).find(m => m.modelName === modelName);
      if (!model || model.error) continue;

      const attrs = model.attributes || {};
      const requiredFields = Object.entries(attrs).filter(([, a]) => !a.allowNull && a.defaultValue === null && !a.primaryKey);

      // Happy path
      journeyScenarios.push({
        id: makeId('scenario'),
        journeyId: journey.id,
        type: 'happy_path',
        name: `${journey.name} - Happy Path`,
        description: `Fluxo completo da jornada ${journey.name} com todos os campos obrigatórios preenchidos`,
        modelName,
        criticality: 'blocking',
        assertions: [
          ...requiredFields.map(([name]) => `${modelName}.${name} preenchido`),
          `${modelName} criado com sucesso`,
          'status válido',
        ],
      });

      // Missing required field
      for (const [fieldName] of requiredFields.slice(0, 3)) {
        journeyScenarios.push({
          id: makeId('scenario'),
          journeyId: journey.id,
          type: 'missing_required',
          name: `${journey.name} - Missing ${fieldName}`,
          description: `Não permite criar ${modelName} sem o campo obrigatório ${fieldName}`,
          modelName,
          fieldName,
          criticality: 'high',
          assertions: [
            `${modelName} NÃO deve ser criado`,
            `erro de validação para ${fieldName}`,
          ],
        });
      }

      // Invalid status transition (se tem status field)
      if (model.statusFields && Object.keys(model.statusFields).length > 0) {
        const statusField = Object.keys(model.statusFields)[0];
        journeyScenarios.push({
          id: makeId('scenario'),
          journeyId: journey.id,
          type: 'invalid_transition',
          name: `${journey.name} - Invalid Status Transition`,
          description: `Não permite transição inválida de status em ${modelName}`,
          modelName,
          criticality: 'high',
          assertions: [
            `${modelName}.${statusField} rejeitado`,
            'transição inválida bloqueada',
          ],
        });
      }

      // Duplicate request
      if (model.primaryKeys && model.primaryKeys.length > 0) {
        journeyScenarios.push({
          id: makeId('scenario'),
          journeyId: journey.id,
          type: 'duplicate',
          name: `${journey.name} - Duplicate ${modelName}`,
          description: `Não permite criar ${modelName} duplicado`,
          modelName,
          criticality: 'medium',
          assertions: [
            `${modelName} NÃO deve ser criado`,
            'erro de unicidade',
          ],
        });
      }

      // Edge case: JSONB vazio
      if (model.jsonbFields && Object.keys(model.jsonbFields).length > 0) {
        const jsonbField = Object.keys(model.jsonbFields)[0];
        journeyScenarios.push({
          id: makeId('scenario'),
          journeyId: journey.id,
          type: 'edge_case',
          name: `${journey.name} - Empty ${jsonbField}`,
          description: `Valida comportamento com ${jsonbField} vazio em ${modelName}`,
          modelName,
          criticality: 'low',
          assertions: [
            `${modelName} criado com ${jsonbField} vazio`,
            'defaultValue aplicado',
          ],
        });
      }
    }

    allScenarios.push({
      journeyId: journey.id,
      journeyName: journey.name,
      domain: journey.domain,
      scenarioCount: journeyScenarios.length,
      scenarios: journeyScenarios,
    });
  }

  return {
    generatedAt: nowIso(),
    totalScenarios: allScenarios.reduce((sum, j) => sum + j.scenarioCount, 0),
    journeyScenarios: allScenarios,
  };
}

// ============================================================================
// FASE 7: MODEL-DRIVEN SEED GENERATOR
// ============================================================================

/**
 * Gera seeds compatíveis com constraints Sequelize.
 * Cada seed respeita: allowNull, defaultValue, PK, FK, tipo.
 */
function generateSeeds(introspectionReport, journeys) {
  const allSeeds = [];

  for (const journey of journeys.journeys || []) {
    const journeySeeds = [];

    for (const modelName of journey.availableModels.slice(0, 3)) {
      const model = (introspectionReport.models || []).find(m => m.modelName === modelName);
      if (!model || model.error) continue;

      const attrs = model.attributes || {};
      const seed = {
        modelName,
        tableName: model.tableName,
      };

      // Constrói seed data respeitando constraints
      const journeyTenantKey = journey.tenantKey || null;
      for (const [attrName, attrDef] of Object.entries(attrs)) {
        if (attrDef.primaryKey) {
          // PK: gera UUID ou string
          const type = String(attrDef.type || '').toUpperCase();
          seed[attrName] = type.includes('UUID') ? crypto.randomUUID() : makeId(modelName.toLowerCase());
        } else if (attrDef.defaultValue !== null && attrDef.defaultValue !== undefined) {
          seed[attrName] = attrDef.defaultValue;
        } else if (!attrDef.allowNull) {
          // Required field: gera valor compatível com o tipo.
          // FKs ficam marcadas como FK_UNRESOLVED para validação posterior.
          seed[attrName] = attrDef.references
            ? FK_UNRESOLVED
            : generateCompatibleValue(attrName, attrDef, { tenantKey: journeyTenantKey });
        }
      }

      // Validações estruturais e FK integrity (BLOCKER 9)
      const validations = [];
      for (const [attrName, attrDef] of Object.entries(attrs)) {
        if (seed[attrName] === undefined && attrDef.allowNull) continue;
        if (seed[attrName] === undefined && !attrDef.allowNull) {
          validations.push({ field: attrName, issue: 'missing_required', resolved: true });
        }
      }
      const fkIntegrity = validateSeedFkIntegrity({ data: seed });

      journeySeeds.push({
        id: makeId('seed'),
        journeyId: journey.id,
        modelName,
        data: seed,
        validations,
        compatible: validations.length === 0 && fkIntegrity.valid,
        fkIntegrity,
        // Generation creates a plan only. SEED_READY is emitted by the runtime
        // provisioner after parent IDs and FKs have been resolved.
        seedStatus: fkIntegrity.valid ? 'SEED_PLANNED' : 'FK_UNRESOLVED',
      });
    }

    allSeeds.push({
      journeyId: journey.id,
      journeyName: journey.name,
      seedCount: journeySeeds.length,
      seeds: journeySeeds,
    });
  }

  return {
    generatedAt: nowIso(),
    totalSeeds: allSeeds.reduce((sum, j) => sum + j.seedCount, 0),
    journeySeeds: allSeeds,
  };
}

// Símbolo canônico para FK não resolvida. Nunca usar UUID aleatório como FK —
// uma FK semanticamente válida precisa referenciar entidade existente no mesmo
// tenant. Seeds com FK_UNRESOLVED devem ser rejeitados pelo validador.
const FK_UNRESOLVED = '__FK_UNRESOLVED__';

function generateCompatibleValue(fieldName, attrDef, { tenantKey = null } = {}) {
  const type = String(attrDef.type || '').toUpperCase();

  // tenant_key / tenant_id: nunca 'system' como fallback genérico —
  // usar o tenantKey do contexto de seed. Se ausente, marcar como FK pendente.
  if (fieldName === 'tenant_key' || fieldName === 'tenant_id') {
    return tenantKey || FK_UNRESOLVED;
  }

  // FK fields (_id, _key suffix): UUID aleatório NÃO é semanticamente válido.
  // Marcar como não resolvida para que o validador rejeite o seed.
  if (fieldName.endsWith('_id') || fieldName.endsWith('_key')) {
    return FK_UNRESOLVED;
  }

  if (fieldName === 'status') return 'active';
  if (fieldName === 'lifecycle') return 'draft';
  if (fieldName === 'classification') return 'DEVELOPMENT';
  if (fieldName === 'channel_type') return 'whatsapp';
  if (fieldName === 'kind') return 'interval';
  if (fieldName === 'source') return 'model_driven';
  if (fieldName === 'eventType' || fieldName === 'event_type') return 'platform_event';
  if (fieldName === 'mode') return 'auto';
  if (fieldName === 'queue') return 'default';

  if (type.includes('UUID')) return crypto.randomUUID();
  if (type.includes('INT')) return 1;
  if (type.includes('FLOAT') || type.includes('DECIMAL')) return 0.0;
  if (type.includes('BOOL')) return true;
  if (type.includes('DATE')) return nowIso();
  if (type.includes('JSON')) return {};
  if (type.includes('STRING') || type.includes('TEXT')) return `${fieldName}_value`;

  return `${fieldName}_value`;
}

/**
 * Valida um seed: rejeita se tiver FK_UNRESOLVED em campo obrigatório.
 * BLOCKER 9 — FK integrity validation.
 */
function validateSeedFkIntegrity(seed) {
  const unresolvedFields = Object.entries(seed.data || {})
    .filter(([, v]) => v === FK_UNRESOLVED)
    .map(([k]) => k);
  return {
    valid: unresolvedFields.length === 0,
    unresolvedFkFields: unresolvedFields,
    status: unresolvedFields.length === 0 ? 'SEED_VALIDATED' : 'FK_UNRESOLVED',
  };
}

// ============================================================================
// FASE 8: QA WAVES MODEL-DRIVEN
// ============================================================================

/**
 * Gera QA Waves a partir das jornadas inferidas.
 */
function generateModelDrivenWaves(journeys, scenarios) {
  const waves = [];

  for (const journey of journeys.journeys || []) {
    const journeyScenarios = (scenarios.journeyScenarios || [])
      .find(js => js.journeyId === journey.id);

    const wave = {
      waveId: `model-driven-${journey.slug}`,
      journeyId: journey.id,
      journeyName: journey.name,
      domain: journey.domain,
      sourceModels: journey.sourceModels,
      scenarioCount: journeyScenarios?.scenarioCount || 0,
      criticality: 'high',
      assertions: [
        ...journey.successCriteria.map(c => ({ type: 'success', criterion: c })),
        ...journey.failureCriteria.map(c => ({ type: 'failure', criterion: c })),
        { type: 'evidence', criterion: 'evidence_required' },
        { type: 'replay', criterion: 'replay_required' },
        { type: 'governance', criterion: 'governance_required' },
      ],
      expectedEvidence: [
        'executionId registrado',
        'agentId vinculado',
        'journeyId vinculado',
        'assertions validadas',
        'status registrado',
      ],
      expectedReplay: [
        'replayId gerado',
        'hash SHA-256',
        'signature SHA-256',
        'startedAt registrado',
        'finishedAt registrado',
      ],
    };

    waves.push(wave);
  }

  return {
    generatedAt: nowIso(),
    totalWaves: waves.length,
    waves,
  };
}

/**
 * Executa o pipeline de inferência completo sobre os models atuais
 * (introspection → domain map → entity graph → journey inference).
 * Usado pelo Agent Factory (agent-hardening-service) para resolver jornadas
 * model-driven reais em tempo de validação.
 */
function inferJourneysFromModels() {
  const { introspectAllModels } = require('./model-introspection-service');
  const { buildDomainMap } = require('./domain-map-service');
  const introspection = introspectAllModels();
  const domainMap = buildDomainMap(introspection);
  const entityGraph = buildEntityGraph(introspection, domainMap);
  return inferJourneys(introspection, domainMap, entityGraph);
}

/**
 * Verificação REAL da integração Agent Factory ↔ model-driven journeys.
 * Nunca literal: exige que o consumidor (agent-hardening-service) exista,
 * exponha o resolvedor e que uma chamada real derive das jornadas desta
 * execução do pipeline.
 */
function verifyAgentFactoryModelDrivenIntegration(journeysReport) {
  try {
    const hardeningService = require('./agent-hardening-service');
    if (typeof hardeningService.resolveModelDrivenJourneysForValidation !== 'function') {
      return {
        used: false,
        evidence: {
          reason: 'consumer_missing',
          detail: 'agent-hardening-service não expõe resolveModelDrivenJourneysForValidation',
        },
      };
    }
    const probe = hardeningService.resolveModelDrivenJourneysForValidation({
      agent: { slug: 'model-driven-integration-probe', name: 'integration-probe', domain: 'Agent OS' },
      journeysReport,
    });
    const derived = Boolean(probe)
      && probe.source === 'model-driven-pipeline.inferJourneys'
      && probe.totalJourneys === (journeysReport?.totalJourneys ?? -1)
      && Array.isArray(probe.relatedJourneys);
    return {
      used: derived,
      evidence: { reason: derived ? 'consumer_invoked' : 'consumer_output_invalid', probe },
    };
  } catch (error) {
    return { used: false, evidence: { reason: 'consumer_error', detail: error.message } };
  }
}

/**
 * Avança pipelineState das candidateJourneys usando evidência real de execução.
 *
 * Transições suportadas:
 *   DISCOVERED → SCENARIO_GENERATED  (quando scenario gerado para a journey)
 *   SCENARIO_GENERATED → SEED_READY  (quando seed presente para a journey)
 *   SEED_READY → EXECUTED            (quando flow correspondente no smoke está GO)
 *   EXECUTED → VALIDATED             (quando hardening report está GO e replay integro)
 *
 * Nenhuma transição é sintética: cada avanço requer evidência externa real.
 *
 * @param {Array} candidateJourneys - jornadas com pipelineState inicial
 * @param {Object} opts.smokeReport - qa-waves-operational-prod-like-smoke.json
 * @param {Object} opts.hardeningReport - replay-hardening-report.json
 * @param {Array} opts.scenarios - cenários gerados para as jornadas
 * @param {Array} opts.seeds - seeds gerados para as jornadas
 * @returns {Array} candidateJourneys com pipelineState e executionEvidence atualizados
 */
function advanceCandidateJourneyStates(candidateJourneys, { lifecycleArtifacts = [], runId, sourceFingerprint } = {}) {
  if (!Array.isArray(candidateJourneys) || candidateJourneys.length === 0) return [];
  return candidateJourneys.map((journey) => evaluateCandidateJourneyLifecycle(
    journey,
    lifecycleArtifacts,
    { runId, sourceFingerprint },
  ));
}

module.exports = {
  buildEntityGraph,
  inferJourneys,
  inferFkCandidateJourneys,
  inferJourneysFromModels,
  verifyAgentFactoryModelDrivenIntegration,
  generateScenarios,
  generateSeeds,
  generateModelDrivenWaves,
  generateCompatibleValue,
  validateSeedFkIntegrity,
  advanceCandidateJourneyStates,
  resolveEligibleJourneys,
  evaluateCandidateJourneyLifecycle,
  CANDIDATE_LIFECYCLE_STAGES,
  isExactGo,
  FK_UNRESOLVED,
  JOURNEY_TEMPLATES,
};
