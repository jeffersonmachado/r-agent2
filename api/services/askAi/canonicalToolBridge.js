'use strict';

/**
 * Canonical Tool Bridge — convergência do Ask AI para o Canonical Tool Registry.
 *
 * O copiloto NÃO mantém registro paralelo de tools. Ele declara CAPABILITIES
 * (`crm.read`, `attendance.read`, `billing.read`, `churn.read`) e o bridge:
 *
 *   1. registra as tools do catálogo no Canonical Tool Registry (uma única vez);
 *   2. resolve a capability para os PROVIDERS disponíveis (nativo e/ou um
 *      provider externo via MCP), de forma DETERMINÍSTICA;
 *   3. executa pelo Canonical Tool Registry — tenant, visibilidade, permissão,
 *      schema e política são aplicados LÁ, não em código do copiloto.
 *
 * Regra de seleção de provider (§53 do Control Plane MCP):
 *  - `native` tem precedência quando disponível;
 *  - um provider externo só é escolhido quando o nativo não está disponível;
 *  - side effect (quando existir) NUNCA troca de provider automaticamente —
 *    duplicar uma operação por fallback é pior do que falhar;
 *  - a seleção é auditável (`reason`), nunca "o LLM escolheu".
 */

const {
  ASK_AI_TOOLS,
  NATIVE_PROVIDER,
  findAskAiTool,
} = require('./askAiToolCatalog');
const {
  providerOf,
  resolveCapabilityProviders,
  selectProvider,
} = require('../../../src/core/mcp/capability-resolution');

/**
 * Registro idempotente das tools do catálogo no Canonical Tool Registry.
 * Se a tool já existe (registro compartilhado com o Cognitive Core), apenas
 * garante que o alias legado resolva — nunca sobrescreve a definição.
 *
 * @param {object} registry Canonical Tool Registry
 * @param {object} runners  mapa `runnerKey → função({tenantId, actor, entity})`
 * @returns {{registered: string[], existing: string[]}}
 */
function ensureAskAiCapabilityTools(registry, runners = {}) {
  if (!registry || typeof registry.register !== 'function') {
    throw new Error('ask_ai_canonical_registry_required');
  }
  const registered = [];
  const existing = [];

  for (const tool of ASK_AI_TOOLS) {
    if (registry.get(tool.id)) {
      existing.push(tool.id);
      continue;
    }
    const runner = runners[tool.runner];
    if (typeof runner !== 'function') {
      throw new Error(`ask_ai_capability_runner_missing: ${tool.runner} (${tool.id})`);
    }

    registry.register({
      id: tool.id,
      aliases: [...tool.aliases],
      capability: tool.capability,
      visibility: 'PRODUCTION',
      permissions: [...tool.permissions],
      description: tool.description,
      riskLevel: tool.riskLevel,
      sideEffects: tool.sideEffects,
      confirmationPolicy: tool.confirmationPolicy,
      idempotencyPolicy: tool.idempotencyPolicy,
      executionMode: tool.executionMode,
      inputSchema: {
        type: 'object',
        required: ['entity'],
        properties: {
          entity: {
            type: 'object',
            required: ['type', 'id'],
            properties: {
              type: { type: 'string' },
              id: { type: 'string' },
            },
            additionalProperties: true,
          },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        required: ['toolId', 'found'],
        properties: {
          toolId: { type: 'string' },
          found: { type: 'boolean' },
          facts: { type: 'array' },
          summary: { type: ['string', 'null'] },
        },
        additionalProperties: true,
      },
      version: '1.0.0',
      metadata: Object.freeze({
        provider: NATIVE_PROVIDER,
        source: 'ask_ai_catalog',
        capability: tool.capability,
        kind: tool.kind,
        label: tool.label,
        entityTypes: [...tool.entityTypes],
        entityIdField: tool.entityIdField,
        rbac: { ...tool.rbac },
      }),
      execute: (input, context) => runner({
        tenantId: context.tenantId,
        actor: context.actor,
        entity: input?.entity || null,
        context,
      }),
    });
    registered.push(tool.id);
  }

  return { registered, existing };
}

/**
 * Executa uma capability pelo Canonical Tool Registry.
 *
 * A resolução/seleção de provider é compartilhada com o restante do Control
 * Plane (`src/core/mcp/capability-resolution`) — não existe lógica de escolha
 * de provider específica do copiloto.
 *
 * @param {object} args
 * @param {object} args.registry   Canonical Tool Registry
 * @param {string} args.capability capability canônica (ex.: `crm.read`)
 * @param {string} args.entityType tipo de entidade do contexto
 * @param {string} args.tenantId   tenant (da sessão autenticada)
 * @param {object} args.actor      ator com `classification` e `permissions`
 * @param {object} args.entity     entidade resolvida/validada
 * @param {string} [args.idempotencyKey]
 * @returns {Promise<{toolId, provider, reason, output}>}
 */
async function executeCapability({
  registry,
  capability,
  entityType = null,
  tenantId,
  actor,
  entity,
  idempotencyKey = null,
}) {
  // O tenant do ator na resolução vem da SESSÃO autenticada (`tenantId`), nunca
  // do input: é o que liga o binding de tenant dos providers MCP externos
  // (metadata.tenantId) ao contexto governado.
  const scopedActor = actor ? { ...actor, tenant: actor.tenant || tenantId } : actor;
  const providers = resolveCapabilityProviders({ registry, capability, entityType, actor: scopedActor });
  const { provider, reason } = selectProvider(providers);
  if (!provider) {
    const error = new Error(`ask_ai_capability_unavailable: ${capability} (${reason})`);
    error.code = 'capability_unavailable';
    error.reason = reason;
    throw error;
  }

  const result = await registry.execute(provider.id, { entity }, {
    tenantId,
    actor,
    confirmed: false,
    idempotencyKey,
    correlationId: null,
  });

  return {
    toolId: provider.id,
    provider: provider.provider,
    reason,
    output: result.output,
  };
}

/**
 * Normaliza o id recebido (canônico ou alias legado) para o id canônico do
 * catálogo, sem consultar o registry — usado para montar a projeção.
 */
function canonicalAskAiToolId(id) {
  const entry = findAskAiTool(id);
  return entry ? entry.id : null;
}

module.exports = {
  ensureAskAiCapabilityTools,
  providerOf,
  resolveCapabilityProviders,
  selectProvider,
  executeCapability,
  canonicalAskAiToolId,
};
