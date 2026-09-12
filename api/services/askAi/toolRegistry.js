'use strict';

/**
 * Ask AI Tool Adapter — adapter de DOMÍNIO + projeção do Canonical Tool Registry.
 *
 * ANTES (gap confirmado na auditoria de 2026-09-11): este arquivo ERA um
 * registro de tools independente — definia ids, capabilities, labels e
 * políticas próprias, sem qualquer relação com o Canonical Tool Registry usado
 * pelo Cognitive Core, pelo MCP Server e pelo Process Runtime. O copiloto
 * vivia num universo de tools paralelo, onde uma tool externa (MCP) jamais
 * seria considerada e onde a mesma capability podia ter duas políticas.
 *
 * AGORA:
 *   - a DEFINIÇÃO canônica (id, capability, permissão, política, schema) vive
 *     em `askAiToolCatalog.js` e é REGISTRADA no Canonical Tool Registry pelo
 *     `canonicalToolBridge`;
 *   - este arquivo mantém apenas o que é genuinamente local: como consultar os
 *     serviços de domínio (as "runners"), e a PROJEÇÃO que a orquestração
 *     consome;
 *   - a execução passa pelo Canonical Tool Registry — tenant, visibilidade,
 *     permissão, schema e política são aplicados LÁ.
 *
 * O copiloto pede CAPABILITY (`crm.read`), nunca provider. O bridge resolve se
 * quem atende é a tool nativa ou uma tool externa via MCP governado.
 */

const {
  TOOL_KINDS,
  ENTITY,
  ASK_AI_TOOLS,
  findAskAiTool,
} = require('./askAiToolCatalog');
const bridge = require('./canonicalToolBridge');
const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
const { resolveCanonicalPermissions } = require('./toolAuthorization');
const { getClassificationForAgent } = require('../../modules/agent-os/experience-segregation');

// ---------------------------------------------------------------------------
// Runners (adapter fino sobre serviços de domínio; zero SQL próprio)
// ---------------------------------------------------------------------------

function serviceLoader() {
  return {
    membership: require('../vertical/fitnessMembershipService'),
    attendance: require('../vertical/fitnessAttendanceService'),
    churn: require('../vertical/fitnessChurnSignalService'),
  };
}

function summarizeCounts(items) {
  return Array.isArray(items) ? items.length : 0;
}

async function runFitnessStudentSummary({ tenantId, entity }) {
  const { membership } = serviceLoader();
  const detail = await membership.getMembershipDetail({
    tenantId,
    membershipId: entity.id,
  });

  if (!detail) {
    return {
      toolId: 'askai.fitness.membershipSummary',
      found: false,
      facts: [],
      summary: 'Nenhuma matrícula encontrada para o aluno informado neste tenant.',
    };
  }

  const facts = [
    { key: 'membershipStatus', label: 'Status da matrícula', value: detail.status || detail.membership_status || null },
    { key: 'billingStatus', label: 'Status financeiro efetivo', value: detail.effectiveBillingStatus || null },
    { key: 'accessAllowed', label: 'Acesso liberado', value: detail.accessAllowed ?? null },
    { key: 'dueDate', label: 'Vencimento', value: detail.due_date || detail.dueDate || null },
  ].filter((fact) => fact.value !== null && fact.value !== undefined);

  return {
    toolId: 'askai.fitness.membershipSummary',
    found: true,
    facts,
    summary: `Matrícula ${detail.status || 'sem status declarado'} com acesso ${detail.accessAllowed ? 'liberado' : 'bloqueado'}.`,
  };
}

async function runFitnessAttendanceSummary({ tenantId, entity }) {
  const { attendance } = serviceLoader();
  const history = await attendance.getAttendanceHistory({
    tenantId,
    subjectId: entity.id,
    windowDays: 90,
  });

  const items = Array.isArray(history?.items) ? history.items : [];
  const lastVisit = items.length > 0
    ? (items[0].checked_in_at || items[0].checkedInAt || null)
    : null;
  const daysSinceLastVisit = lastVisit
    ? Math.floor((Date.now() - new Date(lastVisit).getTime()) / 86400000)
    : null;

  const facts = [
    { key: 'frequency7d', label: 'Frequência (7 dias)', value: history?.frequency7d ?? null },
    { key: 'frequency30d', label: 'Frequência (30 dias)', value: history?.frequency30d ?? null },
    { key: 'lastVisit', label: 'Última visita', value: lastVisit },
    { key: 'daysSinceLastVisit', label: 'Dias desde a última visita', value: daysSinceLastVisit },
  ].filter((fact) => fact.value !== null && fact.value !== undefined);

  return {
    toolId: 'askai.fitness.attendanceSummary',
    found: true,
    facts,
    summary: items.length === 0
      ? 'Nenhuma visita registrada na janela consultada.'
      : `${summarizeCounts(items)} visitas na janela; última em ${lastVisit}.`,
  };
}

async function runFitnessBillingSummary({ tenantId, entity }) {
  const { membership } = serviceLoader();
  const history = await membership.getMembershipBillingHistory({
    tenantId,
    membershipId: entity.id,
    limit: 20,
  });

  const items = Array.isArray(history?.items) ? history.items : [];
  const latest = items[0] || null;

  const facts = [
    { key: 'billingEvents', label: 'Eventos de cobrança', value: history?.total ?? items.length },
    { key: 'latestBillingStatus', label: 'Último status de cobrança', value: latest?.status || latest?.payload?.status || null },
    { key: 'latestBillingAt', label: 'Data do último evento', value: latest?.created_at || latest?.createdAt || null },
  ].filter((fact) => fact.value !== null && fact.value !== undefined);

  return {
    toolId: 'askai.billing.membershipHistory',
    found: true,
    facts,
    summary: items.length === 0
      ? 'Nenhum evento de cobrança encontrado.'
      : `${items.length} eventos de cobrança encontrados; último status: ${facts.find((f) => f.key === 'latestBillingStatus')?.value ?? 'não informado'}.`,
  };
}

async function runFitnessChurnSignal({ tenantId, entity }) {
  const { churn } = serviceLoader();
  const signals = await churn.latestFitnessSignalByPhone({
    tenantId,
    phone: entity.id,
  });

  if (!signals) {
    return {
      toolId: 'askai.churn.latestSignal',
      found: false,
      facts: [],
      summary: 'Nenhum sinal de risco registrado para o aluno.',
    };
  }

  const facts = [
    { key: 'signalType', label: 'Tipo de sinal', value: signals.signal_type || signals.signalType || null },
    { key: 'signalCreatedAt', label: 'Registrado em', value: signals.created_at || signals.createdAt || null },
  ].filter((fact) => fact.value !== null && fact.value !== undefined);

  return {
    toolId: 'askai.churn.latestSignal',
    found: true,
    facts,
    summary: `Sinal de risco: ${facts.find((f) => f.key === 'signalType')?.value ?? 'não classificado'}.`,
  };
}

const RUNNERS = Object.freeze({
  fitnessStudentSummary: runFitnessStudentSummary,
  fitnessAttendanceSummary: runFitnessAttendanceSummary,
  fitnessBillingSummary: runFitnessBillingSummary,
  fitnessChurnSignal: runFitnessChurnSignal,
});

// ---------------------------------------------------------------------------
// Registry resolution (fonte única compartilhada quando disponível)
// ---------------------------------------------------------------------------

let fallbackRegistry = null;

/**
 * Resolve o Canonical Tool Registry usado pelo copiloto.
 *
 * Preferência: registry injetado → registry COMPARTILHADO do Cognitive Core
 * (que já contém as tools de MCP externo) → registry canônico local do Ask AI.
 * O peek (`hasCognitiveOrchestrator`) evita instanciar o pipeline cognitivo
 * inteiro só para ler tools.
 */
function resolveToolRegistry(injected) {
  if (injected) return injected;
  try {
    const {
      getCognitiveOrchestrator,
      hasCognitiveOrchestrator,
    } = require('../../../src/core/cognitive/cognitive-orchestrator');
    if (hasCognitiveOrchestrator()) {
      const orchestrator = getCognitiveOrchestrator();
      if (orchestrator?.toolRegistry) return orchestrator.toolRegistry;
    }
  } catch (_) {
    // Orchestrator indisponível: cai no registry canônico local.
  }
  if (!fallbackRegistry) fallbackRegistry = createToolRegistry({});
  return fallbackRegistry;
}

/** Garante que as capabilities do copiloto existem no registry (idempotente). */
function ensureCapabilitiesRegistered(toolRegistry) {
  return bridge.ensureAskAiCapabilityTools(toolRegistry, RUNNERS);
}

// ---------------------------------------------------------------------------
// Projeção consumida pela orquestração
// ---------------------------------------------------------------------------

function buildProjectionEntry(tool) {
  return Object.freeze({
    id: tool.id,
    canonicalId: tool.id,
    aliases: [...tool.aliases],
    kind: tool.kind,
    label: tool.label,
    description: tool.description,
    // Capability canônica: é isto que a orquestração pede.
    capability: tool.capability,
    // RBAC de produto usado por `authorizeTools`.
    rbac: { ...tool.rbac },
    permissions: [...tool.permissions],
    entityTypes: [...tool.entityTypes],
    entityIdField: tool.entityIdField,
    riskLevel: tool.riskLevel,
    sideEffects: tool.sideEffects,
  });
}

/**
 * Projeção das tools do copiloto (derivada do catálogo canônico — nunca uma
 * segunda definição).
 *
 * @param {object} [injectedRegistry]
 */
function buildRegistry(injectedRegistry) {
  const projection = ASK_AI_TOOLS.map(buildProjectionEntry);
  const byId = new Map();
  for (const entry of projection) {
    byId.set(entry.id, entry);
    for (const alias of entry.aliases) byId.set(alias, entry);
  }

  return {
    all: () => [...projection],
    get: (id) => byId.get(String(id || '')) || null,
    byKind: (kind) => projection.filter((tool) => tool.kind === kind),
    byEntityType: (entityType) => projection.filter((tool) => tool.entityTypes.includes(entityType)),
    byCapability: (capability) => projection.filter((tool) => tool.capability === String(capability)),
    toolRegistry: resolveToolRegistry(injectedRegistry),
  };
}

// ---------------------------------------------------------------------------
// Execução (sempre pelo Canonical Tool Registry)
// ---------------------------------------------------------------------------

/**
 * Executa uma capability do copiloto.
 *
 * O id aceito pode ser o canônico (`askai.*`) ou o alias legado. A execução é
 * delegada ao Canonical Tool Registry, que reaplica tenant, visibilidade,
 * permissão, schema e política.
 *
 * @returns {Promise<Object>} resultado normalizado; erro de tool é capturado e
 *   devolvido como `{ failed: true }` (a resposta usa os fatos restantes).
 */
async function executeTool(toolId, { tenantId, actor, entity, toolRegistry } = {}) {
  const catalogEntry = findAskAiTool(toolId);
  if (!catalogEntry) {
    return { toolId, failed: true, error: 'unknown_tool', facts: [], summary: null };
  }
  if (!tenantId) {
    return { toolId: catalogEntry.id, failed: true, error: 'tenant_required', facts: [], summary: null };
  }
  if (!entity?.type || !entity?.id) {
    return { toolId: catalogEntry.id, failed: true, error: 'entity_context_required', facts: [], summary: null };
  }
  if (!catalogEntry.entityTypes.includes(entity.type)) {
    return { toolId: catalogEntry.id, failed: true, error: 'entity_type_not_supported', facts: [], summary: null };
  }

  const registry = resolveToolRegistry(toolRegistry);
  ensureCapabilitiesRegistered(registry);

  const classification = getClassificationForAgent(actor);
  const permissions = resolveCanonicalPermissions(actor, ASK_AI_TOOLS.map(buildProjectionEntry));

  try {
    const result = await bridge.executeCapability({
      registry,
      capability: catalogEntry.capability,
      entityType: entity.type,
      tenantId,
      actor: {
        userId: actor?.id || actor?.userId || null,
        username: actor?.username || null,
        classification,
        permissions,
      },
      entity,
      idempotencyKey: [tenantId, catalogEntry.id, entity.type, entity.id].join(':'),
    });

    return {
      toolId: result.toolId,
      provider: result.provider,
      providerReason: result.reason,
      failed: false,
      ...result.output,
    };
  } catch (error) {
    return {
      toolId: catalogEntry.id,
      failed: true,
      error: error?.code || error?.message || error?.name || 'tool_execution_failed',
      facts: [],
      summary: null,
    };
  }
}

module.exports = {
  TOOL_KINDS,
  ENTITY,
  DEFINITIONS: ASK_AI_TOOLS,
  RUNNERS,
  buildRegistry,
  executeTool,
  resolveToolRegistry,
  ensureCapabilitiesRegistered,
};
