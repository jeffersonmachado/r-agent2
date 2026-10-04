'use strict';

/**
 * Agent OS Hardening Service
 *
 * Orquestra a validação real de agentes via QA Waves, Replay e Evidence Engine.
 * Substitui todas as simulações, stubs e mocks por integrações reais.
 *
 * Pipeline:
 *   Agent Draft → Validation Journey → QA Wave → Evidence → Replay → Governance → Publish
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('../../../utils/logger');
const agentRegistryService = require('../../agent-registry/service');
const governanceService = require('../../ai-governance/service');

// services/ → agent-os/ → modules/ → api/ → raiz do repositório.
// Evidências e replays devem ficar na raiz (qa-mesh/, replays/), nunca em api/.
const ROOT_DIR = path.join(__dirname, '..', '..', '..', '..');

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createHash(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

/**
 * Hash de integridade (SHA-256) do conteúdo canônico de um artefato de
 * validação: JSON.stringify do payload SEM o próprio campo contentHash.
 * Computado na criação (generateEvidence/generateReplayArtifact) e
 * recomputado no gate (verifyValidationArtifact) — qualquer adulteração do
 * conteúdo entre criação e gate invalida o hash.
 */
function computeArtifactContentHash(artifact) {
  if (!artifact || typeof artifact !== 'object') return null;
  const { contentHash, ...content } = artifact;
  return createHash(JSON.stringify(content));
}

function safeReadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeWriteJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/**
 * FASES 13-14 — Resolve as jornadas model-driven relacionadas ao agente,
 * derivadas de verdade do pipeline (models → entity graph → inferJourneys).
 * O relatório é memoizado por processo para não re-introspectar 150+ models
 * a cada validação; `journeysReport` injetável permite ao pipeline verificar
 * a integração com a saída da execução corrente.
 */
let cachedJourneysReport = null;

function getModelDrivenJourneysReport() {
  if (!cachedJourneysReport) {
    const { inferJourneysFromModels } = require('./model-driven-pipeline');
    cachedJourneysReport = inferJourneysFromModels();
  }
  return cachedJourneysReport;
}

function resolveModelDrivenJourneysForValidation({ agent = {}, journeysReport = null } = {}) {
  const report = journeysReport || getModelDrivenJourneysReport();
  const journeys = Array.isArray(report?.journeys) ? report.journeys : [];
  const domainHint = String(agent.domain || agent.vertical || '').toLowerCase();
  const related = domainHint
    ? journeys.filter((j) => {
      const journeyDomain = String(j.domain || '').toLowerCase();
      return journeyDomain.includes(domainHint) || domainHint.includes(journeyDomain);
    })
    : journeys;
  const effective = related.length > 0 ? related : journeys;
  return {
    source: 'model-driven-pipeline.inferJourneys',
    totalJourneys: report?.totalJourneys ?? journeys.length,
    relatedJourneys: effective.map((j) => ({
      id: j.id,
      name: j.name,
      domain: j.domain,
      completeness: j.completeness,
    })),
  };
}

/**
 * Gera um validation journey para o agente, usando o Journey Registry.
 * As jornadas model-driven relacionadas são resolvidas de verdade
 * (inferJourneys) e registradas na descrição da jornada de validação.
 */
async function generateValidationJourney({ agent, tenantId }) {
  const journeyService = require('../../journey-registry/service');

  const modelDriven = resolveModelDrivenJourneysForValidation({ agent });

  const journey = await journeyService.createJourney({
    tenantId,
    domain: 'agent-os',
    name: `Validation: ${agent.name}`,
    slug: `agent-validation-${agent.slug}`,
    description: `Jornada de validação para o agente ${agent.name} — model-driven journeys relacionadas: ${modelDriven.relatedJourneys.map((j) => j.name).join(', ') || 'nenhuma'}`,
    status: 'active',
    criticality: 'high',
    steps: [
      { id: 'step_capability_check', name: 'Capability Validation', type: 'validation' },
      { id: 'step_tool_check', name: 'Tool Configuration', type: 'validation' },
      { id: 'step_permission_check', name: 'Permission Verification', type: 'validation' },
      { id: 'step_integration_check', name: 'Integration Check', type: 'validation' },
    ],
  });

  // Vínculo model-driven no objeto retornado (não persistido — o registry
  // não tem coluna de metadata; o vínculo auditável fica na descrição).
  if (journey && typeof journey === 'object') {
    journey.modelDrivenJourneys = modelDriven.relatedJourneys;
  }

  return journey;
}

/**
 * Executa validação real via QA Waves.
 *
 * Cria um cenário de validação, submete ao QA Mesh e aguarda resultado.
 * NUNCA usa body.qaWaveResult — sempre execução real.
 */
async function runQaWaveValidation({ agent, tenantId, journeyId, maxWaitMs = 30000, pollIntervalMs = 1000 }) {
  const waveId = `agent-os-${agent.slug}`;
  const executionId = makeId('agent_qa_wave');

  try {
    // Tenta usar o serviço real de QA Waves
    const qaWavesScenarioService = require('../../../services/qaWavesScenarioService');

    // Cria cenário de validação do agente
    const scenario = {
      id: `agent-validation-${agent.slug}`,
      waveId,
      vertical: 'agent-os',
      journeyId: journeyId || `agent-validation-${agent.slug}`,
      name: `Agent Validation: ${agent.name}`,
      description: `Validação automatizada do agente ${agent.slug}`,
      source: 'agent-factory',
      status: 'approved',
      channels: ['api'],
      risk: 'medium',
      priority: 'high',
      validators: [
        { id: 'capabilities_valid', type: 'capability', expected: 'all_present' },
        { id: 'tools_configured', type: 'tool', expected: 'configured' },
        { id: 'permissions_verified', type: 'permission', expected: 'granted' },
      ],
      steps: [
        { id: 'step_001', order: 1, type: 'validate_capabilities', enabled: true },
        { id: 'step_002', order: 2, type: 'validate_tools', enabled: true },
        { id: 'step_003', order: 3, type: 'validate_permissions', enabled: true },
      ],
      validations: { requireReplay: true, slaMs: 30000 },
    };

    // Salva cenário no store.
    // `nonCanonical: true` — este cenário é gerado POR EXECUÇÃO (slug do agente
    // é timestampado) e não é política canônica: vai para o runtime store, fora
    // do workspace, e não para o registry rastreado `qa/qa-waves/scenario-store.json`
    // (que alimenta o `scenarioRegistryFingerprint` do proof chain).
    let savedScenario;
    try {
      savedScenario = qaWavesScenarioService.saveScenario({ scenario, nonCanonical: true });
    } catch (saveErr) {
      logger.warn('[AgentOS:Hardening] Falha ao salvar cenário no store, tentando upsert', {
        error: saveErr.message,
        scenarioId: scenario.id,
      });
      savedScenario = qaWavesScenarioService.upsertScenarioStore(scenario, { nonCanonical: true });
    }

    // Executa QA Wave real
    const execution = qaWavesScenarioService.runScenarioExecution({
      scenarioIds: [savedScenario?.scenario?.id || scenario.id],
      mode: 'real',
      replay: true,
      tenantId,
    });

    const finalExecutionId = execution?.executionId || executionId;

    // A execução é assíncrona (fila da QA Mesh): aguardar o veredito real em
    // vez de devolver 'executing' perpetuamente. Timeout vira NO_GO — nunca
    // um status ambíguo que o pipeline de publish possa interpretar mal.
    const qaMeshService = require('../../../services/qaMeshService');
    const deadline = Date.now() + Math.max(0, Number(maxWaitMs) || 0);
    const interval = Math.max(50, Number(pollIntervalMs) || 1000);
    let finalExecution = null;
    for (;;) {
      finalExecution = qaMeshService.getExecutionById(finalExecutionId);
      const status = finalExecution && String(finalExecution.status || '').toLowerCase();
      if (status && status !== 'running' && status !== 'queued' && status !== 'pending') break;
      if (Date.now() >= deadline) {
        logger.error('[AgentOS:Hardening] QA Wave execution timeout', {
          agentId: agent.id,
          executionId: finalExecutionId,
          maxWaitMs,
        });
        return {
          waveId,
          executionId: finalExecutionId,
          scenarioId: savedScenario?.scenario?.id || scenario.id,
          status: 'NO_GO',
          source: 'qa_waves_real',
          error: `Timeout aguardando veredito da QA Wave (${maxWaitMs}ms)`,
          checks: [
            { name: 'qa_wave_verdict', status: 'FAILED', reason: 'timeout_waiting_execution' },
          ],
        };
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    const goNoGo = finalExecution?.summary?.goNoGo || (finalExecution?.status === 'completed' ? 'GO' : 'NO_GO');
    return {
      waveId,
      executionId: finalExecutionId,
      scenarioId: savedScenario?.scenario?.id || scenario.id,
      status: goNoGo === 'GO' ? 'GO' : 'NO_GO',
      source: 'qa_waves_real',
      ...(goNoGo === 'GO' ? {} : {
        error: `QA Wave finalizou com ${goNoGo}`,
        checks: [
          { name: 'qa_wave_verdict', status: 'FAILED', reason: finalExecution?.summary?.reasons?.join('; ') || goNoGo },
        ],
      }),
    };
  } catch (error) {
    // Se QA Waves não estiver disponível, registra falha real (não simula)
    logger.error('[AgentOS:Hardening] QA Wave execution failed', {
      agentId: agent.id,
      error: error.message,
      code: error.code,
    });

    return {
      waveId,
      executionId,
      status: 'NO_GO',
      source: 'qa_waves_real',
      error: error.message,
      checks: [
        { name: 'qa_wave_availability', status: 'FAILED', reason: error.message },
      ],
    };
  }
}

/**
 * Gera evidência estruturada da validação do agente.
 *
 * Formato:
 * {
 *   executionId, agentId, journeyId, waveId,
 *   assertions[], status, replayId, generatedAt
 * }
 */
async function generateEvidence({ agent, waveResult, tenantId }) {
  const evidenceId = makeId('agent_evd');
  const evidenceDir = path.join(ROOT_DIR, 'qa-mesh', 'meshEvidence', `agent-os-${agent.slug}`);
  ensureDir(evidenceDir);

  const assertions = (waveResult?.checks || []).map((check, index) => ({
    id: `assertion_${index + 1}`,
    name: check.name || `check_${index}`,
    status: check.status === 'PASSED' ? 'passed' : 'failed',
    reason: check.reason || null,
  }));

  if (assertions.length === 0) {
    assertions.push({
      id: 'assertion_001',
      name: 'qa_wave_execution',
      status: waveResult?.status === 'GO' ? 'passed' : 'failed',
      reason: waveResult?.error || 'QA Wave validation result',
    });
  }

  const evidence = {
    evidenceId,
    executionId: waveResult?.executionId || null,
    agentId: agent.id,
    journeyId: waveResult?.journeyId || null,
    waveId: waveResult?.waveId || null,
    assertions,
    status: waveResult?.status === 'GO' ? 'passed' : 'failed',
    replayId: waveResult?.replayId || null,
    generatedAt: nowIso(),
    hash: createHash(JSON.stringify({ agentId: agent.id, status: waveResult?.status })),
    signature: createHash(`${evidenceId}:${agent.id}:${waveResult?.status}:${nowIso()}`),
  };
  // Hash de integridade do conteúdo — verificado fail-closed no gate de
  // evidence (artefato adulterado ou sem hash → NO_GO).
  evidence.contentHash = computeArtifactContentHash(evidence);

  const evidencePath = path.join(evidenceDir, `${evidenceId}.json`);
  safeWriteJson(evidencePath, evidence);

  // Tenta indexar no Evidence Engine
  try {
    const evidenceService = require('../../../services/evidenceService');
    await evidenceService.indexEvidence({
      tenantId,
      records: [{
        id: evidenceId,
        tenant_key: tenantId,
        entity_type: 'agent',
        entity_id: agent.id,
        source_type: 'agent_validation',
        source_id: evidenceId,
        category: 'governance',
        type: 'agent_validation',
        theme: 'agent_os',
        summary: `Agent ${agent.slug} validation evidence`,
        excerpt: `Validation result: ${waveResult?.status || 'unknown'}`,
        normalized_text: `agent validation ${agent.slug} ${waveResult?.status || 'unknown'}`,
        occurred_at: new Date(),
        indexed_at: new Date(),
        confidence: 1.0,
        strength: 'strong',
        actor_type: 'system',
        metadata: {
          agentId: agent.id,
          agentSlug: agent.slug,
          waveId: waveResult?.waveId,
          executionId: waveResult?.executionId,
          status: waveResult?.status,
        },
        idempotency_key: createHash(`agent_validation:${agent.id}:${waveResult?.executionId || nowIso()}`),
      }],
    });
    logger.info('[AgentOS:Hardening] Evidence indexed', { evidenceId, agentId: agent.id });
  } catch (err) {
    logger.warn('[AgentOS:Hardening] Evidence indexing failed (non-blocking)', {
      error: err.message,
      evidenceId,
    });
  }

  return { evidence, evidencePath };
}

/**
 * Gera replay artifact da validação.
 *
 * Campos mínimos: replayId, journeyId, waveId, agentId, executionId,
 * startedAt, finishedAt. Hash e assinatura obrigatórios.
 */
async function generateReplayArtifact({ agent, waveResult, evidence, tenantId }) {
  const replayId = makeId('agent_replay');
  const replayDir = path.join(ROOT_DIR, 'replays', 'agent-os');
  ensureDir(replayDir);

  const startedAt = nowIso();
  const finishedAt = nowIso();

  const replay = {
    replayId,
    journeyId: waveResult?.journeyId || null,
    waveId: waveResult?.waveId || null,
    agentId: agent.id,
    executionId: waveResult?.executionId || null,
    scenarioId: waveResult?.scenarioId || null,
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    status: waveResult?.status === 'GO' ? 'completed' : 'failed',
    evidenceId: evidence?.evidenceId || null,
    hash: createHash(`${replayId}:${agent.id}:${waveResult?.status}:${startedAt}`),
    signature: createHash(`${replayId}:${agent.id}:${finishedAt}:${waveResult?.status}`),
    assertions: evidence?.assertions || [],
    governance: {
      status: waveResult?.status || 'NO_GO',
      generatedAt: finishedAt,
    },
    type: 'agent_validation_replay',
    source: 'agent-os-hardening',
  };
  // Hash de integridade do conteúdo — verificado fail-closed no gate de
  // replay (artefato adulterado ou sem hash → NO_GO).
  replay.contentHash = computeArtifactContentHash(replay);

  const replayPath = path.join(replayDir, `${replayId}.json`);
  safeWriteJson(replayPath, replay);

  logger.info('[AgentOS:Hardening] Replay artifact created', {
    replayId,
    agentId: agent.id,
    status: replay.status,
  });

  return { replay, replayPath };
}

/**
 * Registra trilha de governança da validação.
 *
 * actor/actorRole devem vir do principal autenticado (req.agent); nunca
 * hardcodar papel. Sem actor explícito a trilha registra actor nulo em vez
 * de um 'system' implícito.
 */
async function recordGovernanceTrail({ agent, waveResult, evidence, replay, tenantId, actor, actorRole }) {
  await governanceService.logGovernanceEvent({
    tenantId,
    agentId: agent.id,
    // 'audit' é o eventType do ENUM do Postgres para trilhas de validação
    // ('agent_validation' violava o CHECK ai_governance_records_event_type_check).
    eventType: 'audit',
    actor: actor || null,
    actorRole: actorRole || null,
    description: `Agent ${agent.slug} validation: ${waveResult?.status || 'NO_GO'}`,
    decision: waveResult?.status === 'GO' ? 'approved' : 'rejected',
    metadata: {
      waveId: waveResult?.waveId,
      executionId: waveResult?.executionId,
      evidenceId: evidence?.evidenceId,
      replayId: replay?.replayId,
      assertions: evidence?.assertions || [],
    },
    toolsUsed: ['qa_waves', 'evidence_engine', 'replay_engine'],
    dataAccessed: [],
    riskLevel: agent.governance?.riskLevel || 'low',
  });

  logger.info('[AgentOS:Hardening] Governance trail recorded', {
    agentId: agent.id,
    decision: waveResult?.status === 'GO' ? 'approved' : 'rejected',
  });
}

/**
 * Assinatura de governança: hash SHA-256 sobre os campos que vinculam a
 * aprovação aos artefatos de validação. Emitida no approve e verificada no
 * publish — qualquer adulteração de approvedBy/waveId/replayId/evidenceId
 * entre as duas transições invalida a assinatura.
 */
function computeGovernanceSignature(agent) {
  return createHash(JSON.stringify({
    agentId: agent.id,
    waveId: agent.governance?.validation?.waveId,
    replayId: agent.governance?.validation?.replayId,
    evidenceId: agent.governance?.validation?.evidenceId,
    approvedBy: agent.governance?.approvedBy,
  }));
}

/**
 * Resolve o path local do artefato de validação (evidence/replay) gerado pelo
 * pipeline. Retorna null quando não é possível determinar o path (sem slug/id).
 */
function resolveArtifactPath(kind, agent, artifactId) {
  if (!agent?.slug || !artifactId) return null;
  if (kind === 'evidence') {
    return path.join(ROOT_DIR, 'qa-mesh', 'meshEvidence', `agent-os-${agent.slug}`, `${artifactId}.json`);
  }
  if (kind === 'replay') {
    return path.join(ROOT_DIR, 'replays', 'agent-os', `${artifactId}.json`);
  }
  return null;
}

/**
 * Verificação semântica local de um artefato de validação: o arquivo precisa
 * existir, carregar o id esperado, pertencer ao agente e ter integridade de
 * conteúdo (contentHash recomputado e comparado com o gravado na criação).
 * Quando o path não é determinável, retorna available:false — o gate trata
 * como VERIFIER_UNAVAILABLE (fail-closed, nunca PASS). Artefatos legados sem
 * contentHash são não verificáveis (artifact_unverifiable) e reprovam o gate.
 */
function verifyValidationArtifact(kind, agent, artifactId) {
  const filePath = resolveArtifactPath(kind, agent, artifactId);
  if (!filePath) {
    return { available: false, verified: false, reason: 'artifact_path_not_resolvable' };
  }
  const data = safeReadJson(filePath);
  if (!data) {
    return { available: true, verified: false, reason: 'artifact_not_found_or_unreadable' };
  }
  const idField = kind === 'evidence' ? 'evidenceId' : 'replayId';
  if (data[idField] !== artifactId) {
    return { available: true, verified: false, reason: 'artifact_id_mismatch' };
  }
  if (data.agentId && agent.id && data.agentId !== agent.id) {
    return { available: true, verified: false, reason: 'artifact_agent_mismatch' };
  }
  if (data.contentHash == null) {
    return { available: true, verified: false, reason: 'artifact_unverifiable' };
  }
  if (computeArtifactContentHash(data) !== data.contentHash) {
    return { available: true, verified: false, reason: 'artifact_integrity_failed' };
  }
  return { available: true, verified: true };
}

/**
 * Pipeline completo de validação e publicação de agente.
 *
 * Fluxo:
 *   0. Enforcement de lifecycle: somente agentes 'approved' com approvedBy
 *      registrado podem publicar; o publisher nunca pode ser o approver
 *      (segregação de funções). Gates de governança verificados por completo.
 *   1. Gerar validation journey
 *   2. Executar QA Wave real
 *   3. Gerar evidência
 *   4. Gerar replay artifact
 *   5. Registrar governance trail
 *   6. Se GO: publicar; Se NO_GO: bloquear
 */
async function validateAndPublishAgent({ agentId, tenantId, actor, actorRole }) {
  const agent = await agentRegistryService.getCorporateAgentById(agentId, tenantId);
  if (!agent) {
    return { ok: false, error: 'Agent not found', code: 'NOT_FOUND' };
  }

  // Passo 0: enforcement de lifecycle e segregação de funções.
  // Publish NUNCA contorna o approve: lifecycle precisa ser 'approved'.
  if (agent.lifecycle !== 'approved') {
    logger.warn('[AgentOS:Hardening] Publish blocked: agent not approved', {
      agentId,
      lifecycle: agent.lifecycle,
    });
    return {
      ok: false,
      code: 'agent_not_approved',
      status: 'BLOCKED',
      agent,
      error: `Agent lifecycle is '${agent.lifecycle}'; publish requires lifecycle 'approved'`,
      reason: 'agent_not_approved',
      workflow: { step: 'publish_blocked', next: 'approve' },
    };
  }

  const approvedBy = agent.governance?.approvedBy;
  if (!approvedBy) {
    return {
      ok: false,
      code: 'agent_not_approved',
      status: 'BLOCKED',
      agent,
      error: 'Agent has no recorded approval (governance.approvedBy is empty)',
      reason: 'agent_not_approved',
      workflow: { step: 'publish_blocked', next: 'approve' },
    };
  }

  // Segregação de funções: quem aprovou não pode publicar.
  if (actor && String(approvedBy) === String(actor)) {
    logger.warn('[AgentOS:Hardening] Publish blocked: self-approval denied', {
      agentId,
      actor,
      approvedBy,
    });
    return {
      ok: false,
      code: 'publish_self_approval_denied',
      status: 'BLOCKED',
      agent,
      error: 'Publisher cannot be the same principal that approved the agent',
      reason: 'publish_self_approval_denied',
      workflow: { step: 'publish_blocked', next: 'publish_by_another_principal' },
    };
  }

  // Gates de governança completos (approval + assinatura verificados de verdade).
  const governanceResult = await validateGovernanceGates({ agent });
  if (!governanceResult.passed) {
    return {
      ok: false,
      code: 'governance_gates_failed',
      status: 'BLOCKED',
      agent,
      error: 'Governance gates not satisfied for publish',
      reason: 'governance_gates_failed',
      governance: governanceResult,
      workflow: { step: 'publish_blocked', next: 'fix_governance' },
    };
  }

  // Passo 1: Gerar validation journey
  logger.info('[AgentOS:Hardening] Starting validation pipeline', { agentId, slug: agent.slug });
  let journey;
  try {
    journey = await generateValidationJourney({ agent, tenantId });
  } catch (err) {
    logger.warn('[AgentOS:Hardening] Journey generation failed, continuing without journey', {
      error: err.message,
    });
  }

  // Passo 2: Executar QA Wave real
  const waveResult = await runQaWaveValidation({
    agent,
    tenantId,
    journeyId: journey?.id || null,
  });

  // Atualiza estado do agente
  await agentRegistryService.updateCorporateAgent(agentId, {
    lifecycle: waveResult.status === 'GO' ? 'validated' : 'validation',
    status: waveResult.status === 'GO' ? 'pending_approval' : 'validation_failed',
  }, tenantId);

  // Se QA Wave retornou NO_GO, bloqueia imediatamente
  if (waveResult.status === 'NO_GO') {
    // Ainda gera evidência e replay do bloqueio
    const { evidence } = await generateEvidence({ agent, waveResult, tenantId });
    const { replay } = await generateReplayArtifact({ agent, waveResult, evidence, tenantId });
    await recordGovernanceTrail({ agent, waveResult, evidence, replay, tenantId, actor, actorRole });

    return {
      ok: false,
      status: 'NO_GO',
      agent,
      waveResult,
      evidence,
      replay,
      reason: waveResult.error || 'QA Wave validation failed',
      workflow: { step: 'validation_failed', next: 'fix_issues' },
    };
  }

  // Passo 3: Gerar evidência
  const { evidence } = await generateEvidence({ agent, waveResult, tenantId });

  // Passo 4: Gerar replay artifact
  const { replay } = await generateReplayArtifact({ agent, waveResult, evidence, tenantId });

  // Passo 5: Registrar governance trail
  await recordGovernanceTrail({ agent, waveResult, evidence, replay, tenantId, actor, actorRole });

  // Passo 6: Publicar. A aprovação (approvedBy/approvedAt) é preservada —
  // publish não aprova, apenas ativa quem já foi aprovado por outro principal.
  const governance = {
    ...(agent.governance || {}),
    approvedBy,
    approvedAt: agent.governance?.approvedAt || null,
    publishedBy: actor || null,
    publishedAt: nowIso(),
    riskLevel: agent.governance?.riskLevel || 'low',
    auditEnabled: true,
    validation: {
      waveId: waveResult.waveId,
      executionId: waveResult.executionId,
      evidenceId: evidence.evidenceId,
      replayId: replay.replayId,
      validatedAt: nowIso(),
    },
  };
  // Re-emite a assinatura sobre o novo linkage de validação (mesma aprovação).
  governance.governanceSignature = computeGovernanceSignature({ id: agent.id, governance });

  await agentRegistryService.updateCorporateAgent(agentId, {
    lifecycle: 'active',
    status: 'active',
    governance,
  }, tenantId);

  return {
    ok: true,
    status: 'GO',
    agent: await agentRegistryService.getCorporateAgentById(agentId, tenantId),
    waveResult,
    evidence,
    replay,
    workflow: { step: 'published', status: 'active' },
  };
}

/**
 * Aprova um agente validado (transição validated → approved).
 *
 * O approve CRIA o registro de aprovação: exige lifecycle 'validated' e os
 * gates técnicos (QA wave, replay, evidence, risco), mas NÃO exige approvedBy
 * pré-existente — o gate de approval só é verificado no publish. Emite a
 * assinatura de governança que o publish verificará.
 */
async function approveAgent({ agentId, tenantId, actor, actorRole, riskLevel, auditEnabled }) {
  const agent = await agentRegistryService.getCorporateAgentById(agentId, tenantId);
  if (!agent) {
    return { ok: false, error: 'Agent not found', code: 'NOT_FOUND' };
  }

  if (agent.lifecycle !== 'validated') {
    return {
      ok: false,
      code: 'agent_not_validated',
      agent,
      error: `Agent lifecycle is '${agent.lifecycle}'; approve requires lifecycle 'validated'`,
    };
  }

  // Gates técnicos: approval/signature são emitidos por ESTA transição,
  // portanto não podem ser pré-condição dela.
  const gates = await validateGovernanceGates({ agent, requireApproval: false });
  if (!gates.passed) {
    return {
      ok: false,
      code: 'governance_gates_failed',
      agent,
      error: 'Governance gates not satisfied for approval',
      governance: gates,
    };
  }

  const approvedAt = nowIso();
  const governance = {
    ...(agent.governance || {}),
    approvedBy: actor,
    approvedAt,
    riskLevel: riskLevel || agent.governance?.riskLevel || 'low',
    auditEnabled: auditEnabled !== false,
  };
  governance.governanceSignature = computeGovernanceSignature({ id: agent.id, governance });

  const updatedAgent = await agentRegistryService.updateCorporateAgent(agentId, {
    lifecycle: 'approved',
    status: 'approved',
    governance,
  }, tenantId);

  // Trilha de auditoria da aprovação com o principal real.
  try {
    await governanceService.logGovernanceEvent({
      tenantId,
      agentId: agent.id,
      eventType: 'approve',
      actor: actor || null,
      actorRole: actorRole || null,
      description: `Agent ${agent.slug} approved`,
      decision: 'approved',
      metadata: {
        waveId: governance.validation?.waveId || null,
        evidenceId: governance.validation?.evidenceId || null,
        replayId: governance.validation?.replayId || null,
        governanceSignature: governance.governanceSignature,
      },
      toolsUsed: [],
      dataAccessed: [],
      riskLevel: governance.riskLevel,
    });
  } catch (err) {
    logger.warn('[AgentOS:Hardening] Approval audit trail failed (non-blocking)', {
      agentId,
      error: err.message,
    });
  }

  logger.info('[AgentOS:Hardening] Agent approved', { agentId, approvedBy: actor });
  return { ok: true, agent: updatedAgent, governance: gates };
}

/**
 * Valida os gates de governança de um agente.
 *
 * Além de presença, verifica semanticamente o que é verificável localmente:
 * - qa_wave: waveId precisa corresponder à wave canônica do agente.
 * - replay/evidence: o artefato precisa existir em disco, carregar o id
 *   esperado, pertencer ao agente e ter integridade de conteúdo (contentHash
 *   SHA-256 recomputado e comparado com o gravado na criação).
 * - governance_signature: recomputada e comparada com a assinatura emitida no
 *   approve (nada de passed hardcoded).
 *
 * FAIL-CLOSED: gates obrigatórios exigem artifact exists AND verifier
 * available AND artifact verified. Verificador indisponível → blocker
 * verifier_unavailable (NO_GO); hash ausente/adulterado →
 * artifact_unverifiable/artifact_integrity_failed. Nunca PASS por presença.
 *
 * options.requireApproval (default true): exige approvedBy + assinatura
 * válida. O approve chama com false porque é ele quem CRIA a aprovação; o
 * publish chama com true e verifica tudo.
 */
async function validateGovernanceGates({ agent, requireApproval = true }) {
  const blockers = [];
  const checks = [];
  const validation = agent.governance?.validation || {};

  // Gate 1: QA Wave (presença + waveId canônico do agente).
  // Fail-closed: sem slug do agente o verificador canônico não roda →
  // verifier_unavailable (NO_GO), nunca PASS por presença.
  const waveId = validation.waveId;
  const hasQaWave = !!waveId;
  const qaWaveVerifierAvailable = !!agent.slug;
  let qaWaveVerified = false;
  let qaWaveReason = null;
  if (hasQaWave) {
    if (qaWaveVerifierAvailable) {
      qaWaveVerified = waveId === `agent-os-${agent.slug}`;
      if (!qaWaveVerified) qaWaveReason = 'wave_id_mismatch_for_agent';
    } else {
      qaWaveReason = 'agent_slug_unavailable';
    }
  }
  const qaWavePassed = hasQaWave && qaWaveVerifierAvailable && qaWaveVerified;
  checks.push({
    gate: 'qa_wave',
    passed: qaWavePassed,
    verified: qaWaveVerified,
    ...(qaWaveReason ? { reason: qaWaveReason } : {}),
    detail: waveId || null,
  });
  if (!hasQaWave) {
    blockers.push({ gate: 'qa_wave', reason: 'missing_qa_wave_validation' });
  } else if (!qaWaveVerifierAvailable) {
    blockers.push({ gate: 'qa_wave', reason: 'verifier_unavailable' });
  } else if (!qaWavePassed) {
    blockers.push({ gate: 'qa_wave', reason: qaWaveReason });
  }

  // Gate 2: Replay (presença + artefato real + integridade de conteúdo).
  // Fail-closed: verificador indisponível (path não resolvível) →
  // verifier_unavailable; hash adulterado → artifact_integrity_failed;
  // artefato legado sem hash → artifact_unverifiable. Nunca PASS sem
  // verificação completa.
  const replayId = validation.replayId;
  const replayCheck = verifyValidationArtifact('replay', agent, replayId);
  const hasReplay = !!replayId;
  const replayPassed = hasReplay && replayCheck.available && replayCheck.verified;
  checks.push({
    gate: 'replay',
    passed: replayPassed,
    verified: replayCheck.verified,
    ...(replayCheck.reason ? { reason: replayCheck.reason } : {}),
    detail: replayId || null,
  });
  if (!hasReplay) {
    blockers.push({ gate: 'replay', reason: 'missing_replay_artifact' });
  } else if (!replayCheck.available) {
    blockers.push({ gate: 'replay', reason: 'verifier_unavailable' });
  } else if (!replayPassed) {
    blockers.push({ gate: 'replay', reason: replayCheck.reason });
  }

  // Gate 3: Evidence (presença + artefato real + integridade de conteúdo).
  // Mesma regra fail-closed do gate de replay.
  const evidenceId = validation.evidenceId;
  const evidenceCheck = verifyValidationArtifact('evidence', agent, evidenceId);
  const hasEvidence = !!evidenceId;
  const evidencePassed = hasEvidence && evidenceCheck.available && evidenceCheck.verified;
  checks.push({
    gate: 'evidence',
    passed: evidencePassed,
    verified: evidenceCheck.verified,
    ...(evidenceCheck.reason ? { reason: evidenceCheck.reason } : {}),
    detail: evidenceId || null,
  });
  if (!hasEvidence) {
    blockers.push({ gate: 'evidence', reason: 'missing_evidence' });
  } else if (!evidenceCheck.available) {
    blockers.push({ gate: 'evidence', reason: 'verifier_unavailable' });
  } else if (!evidencePassed) {
    blockers.push({ gate: 'evidence', reason: evidenceCheck.reason });
  }

  // Gate 4: Approval — verificado no publish; no approve ele é a SAÍDA.
  const hasApproval = !!(agent.governance?.approvedBy);
  if (requireApproval) {
    checks.push({ gate: 'approval', passed: hasApproval, verified: hasApproval, detail: agent.governance?.approvedBy || null });
    if (!hasApproval) {
      blockers.push({ gate: 'approval', reason: 'missing_approval' });
    }
  } else {
    checks.push({
      gate: 'approval',
      passed: true,
      verified: false,
      reason: 'approval_created_by_this_transition',
      detail: null,
    });
  }

  // Gate 5: Risk Assessment
  const hasRiskAssessment = !!(agent.governance?.riskLevel);
  checks.push({ gate: 'risk_assessment', passed: hasRiskAssessment, verified: hasRiskAssessment, detail: agent.governance?.riskLevel || null });
  if (!hasRiskAssessment) {
    blockers.push({ gate: 'risk_assessment', reason: 'missing_risk_assessment' });
  }

  // Gate 6: Governance Signature — recomputada e comparada com a emitida no
  // approve. Sem assinatura armazenada (ou divergente) o publish não passa.
  const governanceSignature = computeGovernanceSignature(agent);
  const storedSignature = agent.governance?.governanceSignature || null;
  if (requireApproval) {
    if (!storedSignature) {
      checks.push({
        gate: 'governance_signature',
        passed: false,
        verified: false,
        reason: 'signature_not_stored',
        detail: governanceSignature,
      });
      blockers.push({ gate: 'governance_signature', reason: 'missing_governance_signature' });
    } else {
      const signatureMatch = storedSignature === governanceSignature;
      checks.push({
        gate: 'governance_signature',
        passed: signatureMatch,
        verified: true,
        ...(signatureMatch ? {} : { reason: 'signature_mismatch' }),
        detail: governanceSignature,
      });
      if (!signatureMatch) {
        blockers.push({ gate: 'governance_signature', reason: 'signature_mismatch' });
      }
    }
  } else {
    checks.push({
      gate: 'governance_signature',
      passed: true,
      verified: false,
      reason: 'signature_issued_on_approval',
      detail: governanceSignature,
    });
  }

  return {
    passed: blockers.length === 0,
    checks,
    blockers,
    governanceSignature,
  };
}

module.exports = {
  validateAndPublishAgent,
  approveAgent,
  validateGovernanceGates,
  computeGovernanceSignature,
  computeArtifactContentHash,
  generateValidationJourney,
  runQaWaveValidation,
  generateEvidence,
  generateReplayArtifact,
  recordGovernanceTrail,
  resolveModelDrivenJourneysForValidation,
};
