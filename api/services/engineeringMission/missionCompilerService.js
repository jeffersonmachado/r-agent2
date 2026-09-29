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
const {
  buildEnrichment,
  selectKnowledgeForEnrichment,
  resolveKnowledgeDerivedRequirements,
} = require('../../../engine/engineeringMission/enrichmentBuilder');
const { classifyMateriality } = require('../../../engine/engineeringMission/materiality');
const { buildEnrichmentPreview } = require('../../../engine/engineeringMission/missionPreview');
const { evaluateAutoApproval } = require('../../../engine/engineeringMission/autoApprovalPolicy');
const { deriveDisplayStatus } = require('../../../engine/engineeringMission/missionStatus');
const { MISSION_FAILURE_CODES } = require('../../../engine/engineeringMission/constants');
const { parseStructuredJson } = require('../../../engine/engineeringRouter/responseParsing');
const { selectForRole } = require('../../../engine/engineeringRouter/modelSelector');

/**
 * Tenant de PLATAFORMA — mesmo padrão de `DEFAULT_TENANT_ID` em
 * `api/services/engineeringRouter/*`. O caller pode (e deve) passar um tenant
 * explícito; ausente, o default é o tenant da PRÓPRIA plataforma, nunca um
 * tenant de negócio arbitrário.
 */
const PLATFORM_TENANT_ID = 'system';

const missionStore = require('./missionStoreService');
const missionContext = require('./missionContextService');
const policyAuthority = require('./missionPolicyAuthority');
const { emitMissionStage } = require('./missionEvents');
const { invokeModel } = require('../engineeringRouter/engineeringAiInvoker');
const availabilityService = require('../engineeringRouter/engineeringModelAvailabilityService');
const logger = require('../../utils/logger');
const os = require('os');
const crypto = require('crypto');
const { startLeaseHeartbeat } = require('../engineeringRouter/leaseHeartbeat');

/**
 * Identidade DISTRIBUÍDA do compiler: UUID de instância (ou a identidade declarada pela
 * implantação). O PID NÃO é identidade — fica só como metadado de diagnóstico. A autoridade de
 * posse é o MissionLease (workerInstanceId + token + fence + expiração + heartbeat).
 */
const WORKER_INSTANCE_ID = process.env.ENGINEERING_MISSION_COMPILER_INSTANCE_ID
  || `compiler-${os.hostname()}-${crypto.randomUUID()}`;
/** Compatibilidade de leitura (logs/relatórios antigos): mesmo valor, nunca autoridade. */
const WORKER_ID = WORKER_INSTANCE_ID;

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
Campo OPCIONAL adicional, quando houver CONHECIMENTO DE ENGENHARIA no contexto:
  "knowledgeDerivedRequirements": [{ "text": "<requisito que o conhecimento torna obrigatório para ESTA missão>", "chunkRef": "<K1..Kn>" }]
Regras:
- Requisito derivado de conhecimento DEVE citar o chunkRef de onde veio; sem citação ele é descartado.
- NÃO invente nomes de arquivo, tabela, serviço ou política que não estejam no contexto fornecido.
- Se a intenção for ambígua, liste a ambiguidade em "ambiguities" em vez de adivinhar.
- Nunca proponha remover autenticação, autorização ou validação de tenant.`;

function buildIntentPrompt({ originalMission, facts, knowledge = null }) {
  // CONTEÚDO do conhecimento (não só metadados): o Enricher recebe o trecho selecionado dentro do
  // orçamento, cada um com a referência que ele deve citar.
  const knowledgeSection = knowledge && knowledge.chunks && knowledge.chunks.length > 0
    ? [
      '',
      '=== CONHECIMENTO DE ENGENHARIA (Knowledge Plane SYSTEM — cite o chunkRef) ===',
      ...knowledge.chunks.map((c) => `[${c.ref}] (fonte: ${c.title || c.sourceId || 'desconhecida'}; score ${Number(c.score).toFixed(3)})\n${c.text}`),
    ]
    : [];
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
    ...knowledgeSection,
  ].join('\n');
}

/**
 * Proposta de intenção por modelo — OPCIONAL por design. Sem candidato qualificado, sem
 * credencial, com erro, timeout ou resposta malformada: retorna `{intent: null, degradation}`.
 * Nenhuma dessas situações é erro fatal do compilador.
 */
async function proposeIntent({ originalMission, facts, tenantId, signal = null, deadlineMeta = {} }) {
  const knowledge = selectKnowledgeForEnrichment(facts.knowledgeChunks || []);
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
      prompt: buildIntentPrompt({ originalMission, facts, knowledge }),
      tenantId,
      extraContext: { purpose: 'engineering_mission_enrichment' },
      // Deadline do provider pela política PROVIDER_REQUEST; perda do MissionLease cancela.
      signal,
      deadlineMeta: { ...deadlineMeta, phase: 'ENRICHING' },
    });

    // CONTRATO REAL do parser: `parseStructuredJson` devolve um ENVELOPE `{ok, value}` (ou
    // `{ok:false, error}`) — não o valor direto. Achado real: ler o envelope como se fosse o
    // payload fazia uma resposta lixo ("isso não é JSON") virar `intent` vazia com
    // `degradation: null`, ou seja, a plataforma registrava sucesso onde não houve interpretação
    // nenhuma. Detecção agora é: envelope ok + payload objeto + pelo menos um campo reconhecido.
    const parsed = parseStructuredJson(result.text);
    const payload = parsed && parsed.ok === true ? parsed.value : null;
    const RECOGNIZED_FIELDS = ['missionType', 'objective', 'subsystems', 'risk', 'confidence', 'ambiguities', 'knowledgeDerivedRequirements'];
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

    const knowledgeResolution = resolveKnowledgeDerivedRequirements(payload.knowledgeDerivedRequirements, knowledge.chunks);
    return {
      intent: {
        missionType: payload.missionType || null,
        objective: payload.objective || null,
        subsystems: Array.isArray(payload.subsystems) ? payload.subsystems.filter((s) => typeof s === 'string') : [],
        risk: payload.risk || null,
        confidence: typeof payload.confidence === 'number' ? payload.confidence : null,
        ambiguities: Array.isArray(payload.ambiguities) ? payload.ambiguities : [],
        knowledgeDerivedRequirements: knowledgeResolution.accepted,
        source: 'model',
      },
      knowledgeContext: { refs: knowledge.chunks.map((c) => ({ ref: c.ref, sourceId: c.sourceId, hash: c.hash, score: c.score, truncated: c.truncated })), budget: knowledge.budget, rejectedDerivations: knowledgeResolution.rejected.length },
      modelSelection: { selected: selection.selected, reasonCodes: selection.reasonCodes },
      degradation: knowledgeResolution.rejected.length > 0 ? `KNOWLEDGE_DERIVATION_REJECTED:${knowledgeResolution.rejected.length}` : null,
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
  // Lease JÁ detido pelo chamador (recovery/orquestrador) — propagado, nunca readquirido.
  lease: providedLease = null,
} = {}) {
  const mission = await missionStore.getMission(missionId);
  if (!mission) {
    const err = new Error(`mission ${missionId} não encontrada`);
    err.code = 'not_found';
    throw err;
  }
  if (mission.status === 'REJECTED' || mission.status === 'GREEN') return getMissionDetail(missionId);

  // POSSE: MissionLease (§10-§12). Um chamador que já detém o lease (recovery) o PROPAGA — mesma
  // identidade, mesmo token, mesmo fence; caso contrário o compiler adquire o seu com a identidade
  // de instância (UUID), nunca `mission-compiler-<pid>`.
  let lease = null;
  let ownsLease = false;
  if (providedLease && providedLease.token) {
    const current = await missionStore.getMissionLease(missionId);
    if (!current || current.token !== providedLease.token) {
      const err = new Error(`lease propagado para a missão ${missionId} não é mais o vigente`);
      err.code = 'MISSION_LEASE_LOST';
      throw err;
    }
    lease = current;
  } else {
    // Compilação concorrente da MESMA missão serializa (espera o dono vivo, LEASE_ACQUIRE_WAIT) e
    // converge idempotente — nunca toma a posse de quem está enriquecendo.
    const acquired = await missionStore.acquireMissionLeaseWaiting(missionId, {
      // Identidade por EXECUÇÃO (instância + id da chamada): duas compilações concorrentes no mesmo
      // processo nunca se tratam como "o mesmo dono".
      workerInstanceId: `${WORKER_INSTANCE_ID}#${crypto.randomUUID().slice(0, 8)}`,
      workerType: 'COMPILER',
      host: os.hostname(),
    });
    if (!acquired.acquired) {
      const err = new Error(`mission ${missionId} está com outro worker (${acquired.lease?.workerInstanceId || 'desconhecido'}) — ${acquired.reason}`);
      err.code = 'MISSION_LOCKED_BY_OTHER_WORKER';
      err.lockedBy = acquired.lease?.workerInstanceId || null;
      err.leaseState = acquired.reason;
      throw err;
    }
    lease = acquired.lease;
    ownsLease = true;
  }
  const guard = { leaseToken: lease.token, fence: lease.fence };
  const heartbeat = startLeaseHeartbeat({
    name: `mission-compiler:${missionId}`,
    renew: () => missionStore.renewMissionLease(missionId, { leaseToken: guard.leaseToken }),
    meta: { missionId, workerInstanceId: lease.workerInstanceId, fence: lease.fence },
  });
  const write = (patch) => missionStore.updateMissionGuarded(missionId, patch, guard);
  const merge = (patch) => missionStore.mergeMissionJson(missionId, patch, guard);
  const held = () => missionStore.assertMissionLeaseHeld(missionId, guard);
  const progress = (signal, detail) => missionStore.recordMissionProgress(missionId, { signal, detail }, guard);
  try {
    await write({
      status: 'ENRICHING',
      approval_mode: mission.approval_mode || 'MANUAL',
    });
    await merge({
      resume: { phase: 'ENRICHING', startedAt: new Date().toISOString(), workerId: lease.workerInstanceId, leaseFence: lease.fence, pid: process.pid },
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

    await progress('evidence_produced', `contexto inspecionado (${(facts.knowledgeChunks || []).length} chunk(s) de conhecimento)`);

    const proposal = await proposeIntent({
      originalMission: mission.original_mission,
      facts,
      tenantId,
      signal: heartbeat.signal,
      deadlineMeta: { missionId, leaseOwner: lease.workerInstanceId, fence: lease.fence },
    });
    if (heartbeat.state.lost) {
      const err = new Error('MissionLease perdido durante o enriquecimento — worker para de escrever');
      err.code = 'MISSION_LEASE_LOST';
      throw err;
    }
    if (proposal.intent) await progress('provider_response', proposal.modelSelection?.selected ? `${proposal.modelSelection.selected.providerId}:${proposal.modelSelection.selected.modelId}` : null);
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
    if (proposal.knowledgeContext) enrichment.knowledgeContext = proposal.knowledgeContext;

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

    await held();
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
    await progress('mission_enriched', `v${spec.version} (${materiality.level})`);
    if (autoApproval.eligible && materiality.level !== 'CRITICAL') {
      await held();
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
      await held();
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

    await held();
    await missionStore.supersedeApprovalsForOlderVersions(missionId, spec.version);
    await write({
      status: approvalState === 'AUTO_APPROVED' ? 'APPROVED' : 'AWAITING_APPROVAL',
      approval_state: approvalState,
      approval_mode: approvalMode,
      preview,
      enrichment,
    });
    await merge({
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
    heartbeat.stop();
    // Só libera o que é seu: lease propagado pertence ao chamador (que o libera); lease próprio é
    // liberado por TOKEN — nunca apaga o lease de um novo dono.
    if (ownsLease) await missionStore.releaseMissionLease(missionId, { leaseToken: guard.leaseToken }).catch(() => {});
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
    tenantId: options.tenantId || PLATFORM_TENANT_ID,
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
  WORKER_INSTANCE_ID,
  INTENT_CONTRACT,
  buildIntentPrompt,
  proposeIntent,
  buildSpecFromEnrichment,
  enrichMission,
  compileMission,
  getMissionDetail,
};
