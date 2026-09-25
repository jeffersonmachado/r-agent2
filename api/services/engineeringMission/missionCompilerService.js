'use strict';

/**
 * api/services/engineeringMission/missionCompilerService.js
 *
 * O Engineering Mission Compiler: transforma uma missão em linguagem natural em uma MissionSpec
 * enriquecida, contextualizada, auditável e executável — e a deixa em AWAITING_APPROVAL (ou
 * autoaprovada por política, com preview persistido).
 *
 * Divisão de responsabilidades (deliberada):
 *   - FATOS vêm de `missionContextService` (inspeção real do repositório + histórico persistido);
 *   - INTERPRETAÇÃO pode vir de um modelo (`proposeIntent`), sempre como proposta REVISÁVEL;
 *   - ENRIQUECIMENTO é determinístico (`engine/engineeringMission/enrichmentBuilder`);
 *   - APROVAÇÃO é decidida por política (`engine/engineeringMission/autoApprovalPolicy`).
 *
 * Nada aqui inventa sucesso: sem provider/modelo qualificado, a missão enriquece com fatos e
 * regras, registra a degradação explícita (`modelSelection.selected = null`) e segue para
 * aprovação humana — nunca finge que houve interpretação de modelo.
 */

const {
  createSpec,
  createNextVersion,
  diffSpecs,
  computeSpecHash,
  sha256,
} = require('../../../engine/engineeringMission/missionSpec');
const { buildEnrichment } = require('../../../engine/engineeringMission/enrichmentBuilder');
const { classifyMateriality } = require('../../../engine/engineeringMission/materiality');
const { buildEnrichmentPreview } = require('../../../engine/engineeringMission/missionPreview');
const { evaluateAutoApproval } = require('../../../engine/engineeringMission/autoApprovalPolicy');
const { deriveDisplayStatus } = require('../../../engine/engineeringMission/missionStatus');
const { MISSION_FAILURE_CODES } = require('../../../engine/engineeringMission/constants');
const { parseStructuredJson } = require('../../../engine/engineeringRouter/responseParsing');
const { selectForRole } = require('../../../engine/engineeringRouter/modelSelector');

const missionStore = require('./missionStoreService');
const missionContext = require('./missionContextService');
const policyAuthority = require('./missionPolicyAuthority');
const { emitMissionStage } = require('./missionEvents');
const { invokeModel } = require('../engineeringRouter/engineeringAiInvoker');
const availabilityService = require('../engineeringRouter/engineeringModelAvailabilityService');
const logger = require('../../utils/logger');

const WORKER_ID = `mission-compiler-${process.pid}`;

const INTENT_CONTRACT = `Você é o MISSION_ENRICHER de uma plataforma de engenharia automatizada.
Sua função é INTERPRETAR a intenção do usuário, nunca inventar fatos e nunca alterar a missão original.
Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois, no formato exato:
{
  "missionType": "<BUG_FIX|FEATURE|ARCHITECTURE|REFACTOR|SECURITY|DATABASE|PERFORMANCE|INTEGRATION|MIGRATION|RELEASE|INVESTIGATION|TECH_DEBT|QA_HARDENING>",
  "objective": "<objetivo operacional em uma frase, em português>",
  "subsystems": ["<subsistema afetado>"],
  "risk": "<LOW|MEDIUM|HIGH|CRITICAL>",
  "confidence": <número entre 0 e 1>,
  "ambiguities": ["<ambiguidade material, se houver>"]
}
Regras:
- NÃO invente nomes de arquivo, tabela, serviço ou política que não estejam no contexto fornecido.
- Se a intenção for ambígua, liste a ambiguidade em "ambiguities" em vez de adivinhar.
- Nunca proponha remover autenticação, autorização ou validação de tenant.`;

function buildIntentPrompt({ originalMission, facts }) {
  return [
    INTENT_CONTRACT,
    '',
    '=== MISSÃO ORIGINAL (imutável) ===',
    String(originalMission),
    '',
    '=== FATOS DE CONTEXTO COLETADOS (autoridade sobre o texto) ===',
    JSON.stringify({
      repository: facts.repository,
      branch: facts.branch,
      subsystems: facts.subsystems,
      touchesSchema: facts.touchesSchema === true,
      touchesDatabase: facts.touchesDatabase === true,
      touchesMultiTenant: facts.touchesMultiTenant === true,
      touchesAuth: facts.touchesAuth === true,
      touchesRbac: facts.touchesRbac === true,
      touchesSecrets: facts.touchesSecrets === true,
      touchesFrontend: facts.touchesFrontend === true,
      touchesDeployment: facts.touchesDeployment === true,
      isReleaseBlocker: facts.isReleaseBlocker === true,
      previousOccurrences: facts.previousOccurrences || 0,
      evidenceSample: (facts.evidenceRefs || []).slice(0, 10).map((e) => e.path),
    }, null, 2),
  ].join('\n');
}

/**
 * Proposta de intenção por modelo — OPCIONAL por design. Sem candidato qualificado, sem
 * credencial, com erro, timeout ou resposta malformada: retorna `{intent: null, degradation}`.
 * Nenhuma dessas situações é erro fatal do compilador.
 */
async function proposeIntent({ originalMission, facts, tenantId }) {
  let candidates = [];
  try {
    candidates = await availabilityService.buildAvailableModels({ tenantId });
  } catch (err) {
    return { intent: null, modelSelection: { selected: null, reasonCodes: ['AVAILABILITY_RESOLUTION_FAILED'] }, degradation: `AVAILABILITY_FAILED:${err.message}` };
  }

  const selection = selectForRole(candidates, {
    role: 'ENRICHER',
    requiredCapabilities: ['ARCHITECTURE'],
    preferredCostClass: 'LOW',
  });

  if (!selection.selected) {
    return {
      intent: null,
      modelSelection: { selected: null, reasonCodes: selection.reasonCodes },
      degradation: `NO_ENRICHER_CANDIDATE:${selection.reasonCodes.join(',')}`,
    };
  }

  try {
    const result = await invokeModel({
      providerId: selection.selected.providerId,
      modelId: selection.selected.modelId,
      prompt: buildIntentPrompt({ originalMission, facts }),
      tenantId,
      extraContext: { purpose: 'engineering_mission_enrichment' },
    });

    // CONTRATO REAL do parser: `parseStructuredJson` devolve um ENVELOPE `{ok, value}` (ou
    // `{ok:false, error}`) — não o valor direto. Achado real: ler o envelope como se fosse o
    // payload fazia uma resposta lixo ("isso não é JSON") virar `intent` vazia com
    // `degradation: null`, ou seja, a plataforma registrava sucesso onde não houve interpretação
    // nenhuma. Detecção agora é: envelope ok + payload objeto + pelo menos um campo reconhecido.
    const parsed = parseStructuredJson(result.text);
    const payload = parsed && parsed.ok === true ? parsed.value : null;
    const RECOGNIZED_FIELDS = ['missionType', 'objective', 'subsystems', 'risk', 'confidence', 'ambiguities'];
    const hasRecognizedField = payload && typeof payload === 'object'
      && RECOGNIZED_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(payload, field));

    if (!payload || typeof payload !== 'object' || !hasRecognizedField) {
      const reason = parsed && parsed.ok === false ? parsed.error : 'UNRECOGNIZED_SHAPE';
      return {
        intent: null,
        modelSelection: { selected: selection.selected, reasonCodes: [...selection.reasonCodes, 'MALFORMED_MODEL_RESPONSE'] },
        degradation: `MALFORMED_MODEL_RESPONSE:${reason}`,
      };
    }

    return {
      intent: {
        missionType: payload.missionType || null,
        objective: payload.objective || null,
        subsystems: Array.isArray(payload.subsystems) ? payload.subsystems.filter((s) => typeof s === 'string') : [],
        risk: payload.risk || null,
        confidence: typeof payload.confidence === 'number' ? payload.confidence : null,
        ambiguities: Array.isArray(payload.ambiguities) ? payload.ambiguities : [],
        source: 'model',
      },
      modelSelection: { selected: selection.selected, reasonCodes: selection.reasonCodes },
      degradation: null,
      latencyMs: result.latencyMs,
      usage: result.usage || null,
    };
  } catch (err) {
    return {
      intent: null,
      modelSelection: { selected: selection.selected, reasonCodes: [...selection.reasonCodes, 'MODEL_INVOCATION_FAILED'] },
      degradation: `MODEL_INVOCATION_FAILED:${err.message}`,
    };
  }
}

function buildSpecFromEnrichment({ mission, enrichment, contextFacts, previousSpec = null }) {
  const base = {
    missionId: mission.id,
    originalMission: mission.original_mission,
    missionType: enrichment.missionType,
    objective: enrichment.objective,
    repository: mission.repository || contextFacts.repository,
    branch: mission.branch || contextFacts.branch,
    scope: mission.scope || 'MEDIUM',
    constraints: mission.constraints || [],
    acceptanceCriteria: enrichment.acceptanceCriteria,
    derivedRequirements: enrichment.derivedRequirements,
    testStrategy: enrichment.testStrategy,
    assumptions: enrichment.assumptions,
    contextSources: enrichment.contextSources,
    subsystems: enrichment.subsystems,
    allowedPaths: previousSpec ? previousSpec.allowedPaths : [],
    forbiddenPaths: previousSpec ? previousSpec.forbiddenPaths : [],
    testCommands: previousSpec ? previousSpec.testCommands : [],
    maxIterations: previousSpec ? previousSpec.maxIterations : null,
    releaseBlocker: previousSpec ? previousSpec.releaseBlocker : contextFacts.isReleaseBlocker === true,
    explicitPolicyAuthorization: previousSpec ? previousSpec.explicitPolicyAuthorization : false,
    risk: enrichment.risk,
    confidence: enrichment.confidence,
    enrichmentPolicyVersion: enrichment.enrichmentPolicyVersion,
  };
  return previousSpec ? createNextVersion(previousSpec, base) : createSpec(base);
}

/**
 * Compila (enriquece) uma missão. Idempotente e retomável: pode ser chamado novamente após crash
 * — a versão já gravada para os mesmos fatos é reaproveitada em vez de duplicada (unicidade de
 * `spec_hash` no banco).
 */
async function enrichMission(missionId, {
  actor = null,
  tenantId = 'system',
  contextHints = {},
  forceNewVersion = false,
  policyEscalationAuthorized = false,
  // Roles do ator para a ACL do corpus de conhecimento (domínio SYSTEM). Sem eles o retrieval
  // devolve 0 itens — por AUTORIZAÇÃO, não por ausência de conteúdo.
  actorRoles = null,
  actorClassification = 'DEVELOPMENT',
} = {}) {
  const mission = await missionStore.getMission(missionId);
  if (!mission) {
    const err = new Error(`mission ${missionId} não encontrada`);
    err.code = 'not_found';
    throw err;
  }
  if (mission.status === 'REJECTED' || mission.status === 'GREEN') return getMissionDetail(missionId);

  await missionStore.lockMission(missionId, WORKER_ID);
  try {
    await missionStore.updateMission(missionId, {
      status: 'ENRICHING',
      approval_mode: mission.approval_mode || 'MANUAL',
    });
    await missionStore.mergeMissionJson(missionId, {
      resume: { phase: 'ENRICHING', startedAt: new Date().toISOString(), workerId: WORKER_ID },
    });
    emitMissionStage(tenantId, missionId, { stage: 'ENRICHING', status: 'running', phase: 'ENRICHING' });

    const { facts, keywords, memory, factsHash, degraded } = await missionContext.collectContextFacts({
      originalMission: mission.original_mission,
      repository: mission.repository,
      branch: mission.branch,
      contextHints,
      missionId,
      actorRoles,
      actorClassification,
    });

    const proposal = await proposeIntent({ originalMission: mission.original_mission, facts, tenantId });
    const intent = proposal.intent || {};
    if (proposal.degradation) degraded.push(proposal.degradation);

    const enrichment = buildEnrichment({
      missionId,
      originalMission: mission.original_mission,
      intent: { ...intent, subsystems: [...(intent.subsystems || []), ...(contextHints.subsystems || [])] },
      contextFacts: facts,
      memory,
    });
    enrichment.factsHash = factsHash;
    enrichment.keywords = keywords;
    enrichment.degraded = degraded;
    enrichment.modelSelection = proposal.modelSelection;

    const previousSpec = forceNewVersion ? (await missionStore.getCurrentVersion(missionId))?.spec || null : null;
    const spec = buildSpecFromEnrichment({ mission, enrichment, contextFacts: facts, previousSpec });
    if (computeSpecHash(spec) !== spec.specHash) {
      throw Object.assign(new Error('hash da MissionSpec inconsistente'), { code: MISSION_FAILURE_CODES.ENRICHMENT_FAILED });
    }

    const changes = diffSpecs(previousSpec, spec);
    const materiality = classifyMateriality({ previousSpec, nextSpec: spec, enrichment, changes });

    const policy = await missionStore.getAutoApprovalPolicy();
    // AUTORIDADE ÚNICA de política (api/services/engineeringMission/missionPolicyAuthority).
    // O merge ingênuo `{...policy, ...mission.auto_approval_policy}` permitia a própria MISSÃO
    // ampliar privilégio (ex.: declarar `maxRisk: 'CRITICAL'` e `confidenceThreshold: 0.1`
    // autorizava mais do que a instalação autorizava). A resolução formal já existia AQUI, mas
    // não nos outros caminhos (UI/edição) — que passavam a discordar da execução. Agora todos
    // consomem o mesmo resolvedor.
    const policyResolution = await policyAuthority.resolvePolicyForMission({
      mission,
      actor,
      // Autorização de escalação NUNCA vem do corpo da requisição: só de quem já passou pela
      // checagem de permissão (RBAC `engineering.policy_admin`) na borda HTTP ou de worker confiável.
      policyEscalationAuthorized: policyEscalationAuthorized === true,
    });
    const effectivePolicy = policyAuthority.requireAuthorizedPolicy(policyResolution, missionId);
    const autoApproval = evaluateAutoApproval({
      policy: effectivePolicy,
      spec,
      enrichment,
      repository: spec.repository,
      branch: spec.branch,
    });

    const preview = buildEnrichmentPreview({
      spec,
      enrichment,
      previousSpec,
      changes,
      materiality,
      autoApproval,
    });
    // §21: a resolução de política é EVIDÊNCIA persistida (global × solicitada × efetiva,
    // diferenças, escalações e a decisão com motivo) — não um cálculo que se perde na memória.
    preview.policyResolution = policyResolution;

    const versionRow = await missionStore.saveVersion({
      missionId,
      spec,
      enrichment,
      materiality: materiality.level,
      materialityReasons: materiality.reasons,
      changes,
      event: previousSpec ? 'RE_ENRICHED' : 'ENRICHED',
      createdBy: actor,
    });

    // Decisão: humana aguardando, ou autoaprovada por POLÍTICA (nunca por narrativa).
    let approvalState = 'PENDING';
    let approvalMode = effectivePolicy.mode;
    let approval = null;
    if (autoApproval.eligible && materiality.level !== 'CRITICAL') {
      const saved = await missionStore.saveApproval({
        missionId,
        specVersion: spec.version,
        specHash: spec.specHash,
        state: 'AUTO_APPROVED',
        mode: approvalMode,
        policyId: autoApproval.policyId,
        policySnapshot: effectivePolicy,
        rulesEvaluated: autoApproval.rulesEvaluated,
        blockers: [],
        enrichmentDiff: changes,
        reason: `autoaprovada pela política ${autoApproval.policyId} (modo ${approvalMode}) com risco ${autoApproval.risk} e confiança ${autoApproval.confidence}`,
        actor: 'SYSTEM:AUTO_APPROVAL_POLICY',
        idempotencyKey: `auto-approve:${missionId}:v${spec.version}`,
      });
      approval = saved.approval;
      approvalState = 'AUTO_APPROVED';
    } else {
      const saved = await missionStore.saveApproval({
        missionId,
        specVersion: spec.version,
        specHash: spec.specHash,
        state: 'PENDING',
        mode: approvalMode,
        policyId: autoApproval.policyId,
        policySnapshot: effectivePolicy,
        rulesEvaluated: autoApproval.rulesEvaluated,
        blockers: autoApproval.blockers,
        enrichmentDiff: changes,
        reason: autoApproval.blockers.length > 0
          ? `aguardando aprovação humana — bloqueios de política: ${autoApproval.blockers.map((b) => b.code).join(', ')}`
          : 'aguardando aprovação humana (modo MANUAL)',
        actor: 'SYSTEM:ENRICHMENT',
        idempotencyKey: `pending:${missionId}:v${spec.version}`,
      });
      approval = saved.approval;
      approvalState = 'PENDING';
    }

    await missionStore.supersedeApprovalsForOlderVersions(missionId, spec.version);
    await missionStore.updateMission(missionId, {
      status: approvalState === 'AUTO_APPROVED' ? 'APPROVED' : 'AWAITING_APPROVAL',
      approval_state: approvalState,
      approval_mode: approvalMode,
      preview,
      enrichment,
    });
    await missionStore.mergeMissionJson(missionId, {
      resume: { phase: approvalState === 'AUTO_APPROVED' ? 'APPROVED' : 'AWAITING_APPROVAL', enrichedAt: new Date().toISOString() },
      // §21: guarda a resolução de política também no resume metadata, para que a evidência
      // sobreviva mesmo se o preview for regerado por um re-enriquecimento.
      policyResolution,
    });

    const detail = await getMissionDetail(missionId);
    emitMissionStage(tenantId, missionId, {
      stage: approvalState === 'AUTO_APPROVED' ? 'AUTO_APPROVED' : 'AWAITING_APPROVAL',
      status: 'success',
      phase: 'ENRICHMENT',
      missionVersion: spec.version,
      approvalMode,
      displayStatus: detail.displayStatus,
      message: `enriquecimento v${spec.version} persistido (materialidade ${materiality.level})`,
      meta: { risk: spec.risk, confidence: spec.confidence, blockers: autoApproval.blockers.map((b) => b.code) },
    });
    return detail;
  } finally {
    await missionStore.unlockMission(missionId, WORKER_ID).catch(() => {});
  }
}

/** Cria + enriquece em um passo (fluxo do usuário: "digite a missão"). */
async function compileMission(rawMission, options = {}) {
  const { mission, created } = await missionStore.createMission({
    title: options.title || String(rawMission).slice(0, 120),
    originalMission: rawMission,
    repository: options.repository || 'r-agent2',
    branch: options.branch || 'main',
    scope: options.scope || null,
    approvalMode: options.approvalMode || null,
    autoApprovalPolicy: options.autoApprovalPolicy || {},
    constraints: options.constraints || [],
    createdBy: options.createdBy || null,
    idempotencyKey: options.idempotencyKey || null,
    parentMissionId: options.parentMissionId || null,
  });

  if (!created) return { mission: await getMissionDetail(mission.id), created: false };

  const detail = await enrichMission(mission.id, {
    actor: options.createdBy || null,
    tenantId: options.tenantId || 'system',
    contextHints: options.contextHints || {},
    // Propagação OBRIGATÓRIA: sem isto, `compileMission` (que cria E enriquece) recusaria toda
    // missão com política mais ampla mesmo quando a borda HTTP já autorizou a escalação.
    policyEscalationAuthorized: options.policyEscalationAuthorized === true,
  });
  return { mission: detail, created: true };
}

async function getMissionDetail(missionId) {
  const mission = await missionStore.getMission(missionId);
  if (!mission) return null;
  const [versions, approvals] = await Promise.all([
    missionStore.listVersions(missionId),
    missionStore.listApprovals(missionId),
  ]);
  const currentVersion = versions.find((v) => v.version === mission.current_version) || null;
  const executionApproval = await missionStore.getExecutionApproval(missionId);

  let task = null;
  if (mission.linked_task_id) {
    try {
      const index = require('../../db/models');
      const row = await index.EngineeringTask().findByPk(mission.linked_task_id);
      if (row) {
        task = {
          id: row.get('id'),
          status: row.get('status'),
          taskType: row.get('task_type'),
          risk: row.get('risk'),
          routingDecision: row.get('routing_decision'),
          updatedAt: row.get('updated_at'),
        };
      }
    } catch (err) {
      logger.warn('[missionCompiler] falha ao ler task vinculada', { missionId, error: err.message });
    }
  }

  return {
    ...mission,
    displayStatus: deriveDisplayStatus(mission, task ? { status: task.status } : null),
    currentSpec: currentVersion ? currentVersion.spec : null,
    currentVersionRow: currentVersion,
    versions: versions.map((v) => ({
      version: v.version,
      specHash: v.spec_hash,
      materiality: v.materiality,
      materialityReasons: v.materiality_reasons,
      event: v.event,
      createdAt: v.created_at,
      createdBy: v.created_by,
    })),
    approvals,
    executionApproval,
    task,
    originalMissionHash: mission.original_mission_hash,
    traceId: { missionId: mission.id, missionVersion: mission.current_version, specHash: mission.current_spec_hash },
  };
}

module.exports = {
  WORKER_ID,
  INTENT_CONTRACT,
  buildIntentPrompt,
  proposeIntent,
  buildSpecFromEnrichment,
  enrichMission,
  compileMission,
  getMissionDetail,
};
