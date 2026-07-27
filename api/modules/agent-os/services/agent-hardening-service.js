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
 * Gera um validation journey para o agente, usando o Journey Registry.
 */
async function generateValidationJourney({ agent, tenantId }) {
  const journeyService = require('../../journey-registry/service');

  const journey = await journeyService.createJourney({
    tenantId,
    domain: 'agent-os',
    name: `Validation: ${agent.name}`,
    slug: `agent-validation-${agent.slug}`,
    description: `Jornada de validação para o agente ${agent.name}`,
    status: 'active',
    criticality: 'high',
    steps: [
      { id: 'step_capability_check', name: 'Capability Validation', type: 'validation' },
      { id: 'step_tool_check', name: 'Tool Configuration', type: 'validation' },
      { id: 'step_permission_check', name: 'Permission Verification', type: 'validation' },
      { id: 'step_integration_check', name: 'Integration Check', type: 'validation' },
    ],
  });

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

    // Salva cenário no store
    let savedScenario;
    try {
      savedScenario = qaWavesScenarioService.saveScenario({ scenario });
    } catch (saveErr) {
      logger.warn('[AgentOS:Hardening] Falha ao salvar cenário no store, tentando upsert', {
        error: saveErr.message,
        scenarioId: scenario.id,
      });
      savedScenario = qaWavesScenarioService.upsertScenarioStore(scenario);
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
 */
async function recordGovernanceTrail({ agent, waveResult, evidence, replay, tenantId, actor }) {
  await governanceService.logGovernanceEvent({
    tenantId,
    agentId: agent.id,
    // 'audit' é o eventType do ENUM do Postgres para trilhas de validação
    // ('agent_validation' violava o CHECK ai_governance_records_event_type_check).
    eventType: 'audit',
    actor: actor || 'system',
    actorRole: 'super_admin',
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
 * Pipeline completo de validação e publicação de agente.
 *
 * Fluxo:
 *   1. Gerar validation journey
 *   2. Executar QA Wave real
 *   3. Gerar evidência
 *   4. Gerar replay artifact
 *   5. Registrar governance trail
 *   6. Se GO: publicar; Se NO_GO: bloquear
 */
async function validateAndPublishAgent({ agentId, tenantId, actor }) {
  const agent = await agentRegistryService.getCorporateAgentById(agentId, tenantId);
  if (!agent) {
    return { ok: false, error: 'Agent not found', code: 'NOT_FOUND' };
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
    await recordGovernanceTrail({ agent, waveResult, evidence, replay, tenantId, actor });

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
  await recordGovernanceTrail({ agent, waveResult, evidence, replay, tenantId, actor });

  // Passo 6: Publicar (aprovar + publicar)
  await agentRegistryService.updateCorporateAgent(agentId, {
    lifecycle: 'active',
    status: 'active',
    governance: {
      ...(agent.governance || {}),
      approvedBy: actor || 'system',
      approvedAt: nowIso(),
      riskLevel: agent.governance?.riskLevel || 'low',
      auditEnabled: true,
      validation: {
        waveId: waveResult.waveId,
        executionId: waveResult.executionId,
        evidenceId: evidence.evidenceId,
        replayId: replay.replayId,
        validatedAt: nowIso(),
      },
    },
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
 * Valida se todos os gates de governança estão satisfeitos antes de publicar.
 */
async function validateGovernanceGates({ agent }) {
  const blockers = [];
  const checks = [];

  // Gate 1: QA Wave
  const hasQaWave = !!(agent.governance?.validation?.waveId);
  checks.push({ gate: 'qa_wave', passed: hasQaWave, detail: agent.governance?.validation?.waveId || null });
  if (!hasQaWave) {
    blockers.push({ gate: 'qa_wave', reason: 'missing_qa_wave_validation' });
  }

  // Gate 2: Replay
  const hasReplay = !!(agent.governance?.validation?.replayId);
  checks.push({ gate: 'replay', passed: hasReplay, detail: agent.governance?.validation?.replayId || null });
  if (!hasReplay) {
    blockers.push({ gate: 'replay', reason: 'missing_replay_artifact' });
  }

  // Gate 3: Evidence
  const hasEvidence = !!(agent.governance?.validation?.evidenceId);
  checks.push({ gate: 'evidence', passed: hasEvidence, detail: agent.governance?.validation?.evidenceId || null });
  if (!hasEvidence) {
    blockers.push({ gate: 'evidence', reason: 'missing_evidence' });
  }

  // Gate 4: Approval
  const hasApproval = !!(agent.governance?.approvedBy);
  checks.push({ gate: 'approval', passed: hasApproval, detail: agent.governance?.approvedBy || null });
  if (!hasApproval) {
    blockers.push({ gate: 'approval', reason: 'missing_approval' });
  }

  // Gate 5: Risk Assessment
  const hasRiskAssessment = !!(agent.governance?.riskLevel);
  checks.push({ gate: 'risk_assessment', passed: hasRiskAssessment, detail: agent.governance?.riskLevel || null });
  if (!hasRiskAssessment) {
    blockers.push({ gate: 'risk_assessment', reason: 'missing_risk_assessment' });
  }

  // Gate 6: Governance Signature (hash)
  const governanceSignature = createHash(JSON.stringify({
    agentId: agent.id,
    waveId: agent.governance?.validation?.waveId,
    replayId: agent.governance?.validation?.replayId,
    evidenceId: agent.governance?.validation?.evidenceId,
    approvedBy: agent.governance?.approvedBy,
  }));
  checks.push({ gate: 'governance_signature', passed: true, detail: governanceSignature });

  return {
    passed: blockers.length === 0,
    checks,
    blockers,
    governanceSignature,
  };
}

module.exports = {
  validateAndPublishAgent,
  validateGovernanceGates,
  generateValidationJourney,
  runQaWaveValidation,
  generateEvidence,
  generateReplayArtifact,
  recordGovernanceTrail,
};
