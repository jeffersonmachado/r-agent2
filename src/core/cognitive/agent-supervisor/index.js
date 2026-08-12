'use strict';

/**
 * Agent Supervisor — seleção governada de especialistas no Cognitive Core.
 *
 * Posição no pipeline:
 *   INPUT → CONTEXT → INTENT → AGENT SUPERVISOR → SPECIALIST PROFILE → PLAN → ...
 *
 * Responsabilidades: receber intent/contexto/ator/tenant/vertical/canal,
 * descobrir agentes elegíveis (CorporateAgents ativos do tenant), eliminar
 * proibidos, selecionar o especialista e produzir decisão de roteamento.
 *
 * O Supervisor NÃO executa serviço de negócio, NÃO possui tools de domínio
 * e NÃO consulta agentes fora do diretório registrado. Toda delegação entre
 * agentes passa por aqui (com proteção de profundidade, ciclo, tenant,
 * classificação e capability).
 *
 * O envelope de decisão é interno — nunca exposto ao usuário final.
 */

const { canAccess, VISIBILITY, isValidVisibility } = require('../visibility');
const { createCapabilityRegistry } = require('../capability-registry');
const { resolveRetrievalScope } = require('../../../../api/services/rag/domainRouter');
const { validateAgentVisibility } = require('../../../../api/modules/agent-os/experience-segregation');

const DEFAULT_MAX_DELEGATION_DEPTH = 2;

function defaultLogger() {
  return require('../../../../api/utils/logger');
}

/**
 * Diretório padrão de agentes: CorporateAgents ativos do tenant
 * (Agent Registry sobre Postgres). Lazy para não acoplar I/O no core.
 */
function defaultAgentDirectory() {
  const agentRegistryService = require('../../../../api/modules/agent-registry/service');
  return {
    async listActiveAgents({ tenantId }) {
      const agents = await agentRegistryService.listCorporateAgents({
        tenantId,
        filters: { lifecycle: 'active' },
      });
      return agents.map((a) => (a.toJSON ? a.toJSON() : a));
    },
  };
}

/** Mapeia classificação → papel sintético para reutilizar o Domain Router. */
function roleForClassification(classification) {
  if (classification === 'DEVELOPMENT') return 'super_admin';
  if (classification === 'SUPPORT') return 'auditor';
  return 'user';
}

/**
 * Knowledge scope do especialista: calculado pelo Domain Router a partir da
 * classificação — NUNCA escolhido pelo prompt/conteúdo do agente.
 */
function knowledgeScopeFor(classification) {
  const scope = resolveRetrievalScope({ actor: { role: roleForClassification(classification) } });
  return {
    domain: scope.scope.domain,
    classifications: [...scope.scope.classifications],
    policy: scope.retrievalPolicy,
  };
}

function normalizeClassification(value) {
  const c = String(value || VISIBILITY.PRODUCTION).toUpperCase();
  return isValidVisibility(c) ? c : VISIBILITY.PRODUCTION;
}

function createAgentSupervisor({
  agentDirectory,
  capabilityRegistry,
  toolRegistry,
  logger,
  maxDelegationDepth = DEFAULT_MAX_DELEGATION_DEPTH,
} = {}) {
  const log = logger || defaultLogger();
  const directory = agentDirectory || defaultAgentDirectory();
  const capRegistry = capabilityRegistry || createCapabilityRegistry();

  /** Compatibilidade declarativa de vertical/canal a partir do profile (config JSONB). */
  function isVerticalCompatible(agent, vertical) {
    if (!vertical) return true;
    const verticals = agent?.config?.verticals;
    if (!verticals || verticals.inherited === true) return true;
    const list = Array.isArray(verticals) ? verticals : verticals.list;
    if (!Array.isArray(list) || list.length === 0) return true;
    return list.includes(vertical);
  }

  function isChannelCompatible(agent, channel) {
    if (!channel) return true;
    const channels = agent?.config?.channels;
    if (!Array.isArray(channels) || channels.length === 0) return true;
    return channels.includes(channel);
  }

  /**
   * Descobre agentes elegíveis para o ator/tenant e elimina proibidos.
   * Retorna { candidates, eliminated[] } para auditoria da decisão.
   *
   * P0: Defense in depth — mesmo após o diretório filtrar por tenant,
   * revalidamos agent.tenant_id === tenantId antes de considerar elegível.
   */
  async function discoverEligible({ tenantId, actor, channel = null, vertical = null }) {
    const actorClassification = normalizeClassification(actor?.classification);
    const agents = await directory.listActiveAgents({ tenantId });
    const candidates = [];
    const eliminated = [];

    for (const agent of agents) {
      const classification = normalizeClassification(agent.classification);

      // P0: Defesa em profundidade — tenant mismatch mesmo após filtro do diretório.
      const agentTenantId = String(agent.tenant_id || agent.tenantId || '');
      if (agentTenantId !== tenantId) {
        eliminated.push({ agentSlug: agent.slug, reason: 'tenant_mismatch_defense_in_depth', agentTenantId, requestedTenant: tenantId });
        continue;
      }

      if (agent.lifecycle !== 'active') {
        eliminated.push({ agentSlug: agent.slug, reason: 'lifecycle_not_active', lifecycle: agent.lifecycle });
        continue;
      }
      // PRODUCTION nunca vê SUPPORT/DEVELOPMENT; SUPPORT nunca vê DEVELOPMENT.
      const visibility = validateAgentVisibility({ classification }, actorClassification);
      if (!visibility.visible) {
        eliminated.push({ agentSlug: agent.slug, reason: 'classification_denied', agentClassification: classification });
        continue;
      }
      if (!isVerticalCompatible(agent, vertical)) {
        eliminated.push({ agentSlug: agent.slug, reason: 'vertical_incompatible' });
        continue;
      }
      if (!isChannelCompatible(agent, channel)) {
        eliminated.push({ agentSlug: agent.slug, reason: 'channel_incompatible' });
        continue;
      }
      candidates.push({ ...agent, classification });
    }

    return { candidates, eliminated };
  }

  /**
   * Tools permitidas ao especialista: tools das capabilities cobertas,
   * filtradas pela visibilidade E permissões efetivas do ator.
   */
  function resolveAllowedTools({ capabilityIds, actor }) {
    const actorClassification = normalizeClassification(actor?.classification);
    const granted = new Set(Array.isArray(actor?.permissions) ? actor.permissions : []);
    const wildcard = granted.has('*');
    const allowed = [];

    for (const capId of capabilityIds) {
      for (const toolId of capRegistry.toolsFor(capId)) {
        const tool = toolRegistry ? toolRegistry.get(toolId) : null;
        if (!tool) continue;
        if (!canAccess(actorClassification, tool.visibility)) continue;
        const missing = (tool.permissions || []).filter((p) => !wildcard && !granted.has(p));
        if (missing.length > 0) continue;
        allowed.push(tool.id);
      }
    }
    return [...new Set(allowed)];
  }

  /**
   * Seleciona o especialista para um intent de negócio.
   *
   * @returns {object} decisão estruturada:
   *   { status: 'routed', agentId, agentSlug, classification, reason,
   *     confidence, capabilities, allowedTools, knowledgeScope }
   *   ou { status: 'no_specialist'|'directory_unavailable', reason, ... }
   */
  async function route({ intent, context = {}, actor = {}, tenantId, channel = null, vertical = null, excludeAgentIds = [] } = {}) {
    const effectiveTenant = String(tenantId || context.tenantId || '').trim();
    if (!effectiveTenant) throw new Error('agent_supervisor_tenant_required');
    if (!intent) throw new Error('agent_supervisor_intent_required');

    let discovery;
    try {
      discovery = await discoverEligible({ tenantId: effectiveTenant, actor, channel, vertical });
    } catch (error) {
      // Diretório indisponível é falha explícita e auditável — nunca fake routing.
      log.error('[AgentSupervisor] Agent directory unavailable', {
        tenantId: effectiveTenant, error: error.message,
      });
      return {
        status: 'directory_unavailable',
        reason: 'agent_directory_unavailable',
        error: error.message,
        agentId: null,
        agentSlug: null,
        capabilities: [],
        allowedTools: [],
        knowledgeScope: knowledgeScopeFor(normalizeClassification(actor?.classification)),
      };
    }

    const excluded = new Set(excludeAgentIds);
    const requiredCapabilities = capRegistry.forIntent(intent).map((c) => c.id);

    let best = null;
    for (const agent of discovery.candidates) {
      if (excluded.has(agent.id)) continue;
      const agentCapabilities = capRegistry.normalize(agent.capabilities || []);
      const matched = requiredCapabilities.filter((c) => agentCapabilities.includes(c));
      if (matched.length === 0) continue;
      const coverage = requiredCapabilities.length > 0 ? matched.length / requiredCapabilities.length : 0;
      const candidate = { agent, agentCapabilities, matched, coverage };
      if (!best || candidate.coverage > best.coverage
        || (candidate.coverage === best.coverage && candidate.matched.length > best.matched.length)) {
        best = candidate;
      }
    }

    if (!best) {
      log.info('[AgentSupervisor] No eligible specialist', {
        tenantId: effectiveTenant, intent, eliminated: discovery.eliminated.length,
      });
      return {
        status: 'no_specialist',
        reason: requiredCapabilities.length === 0 ? 'intent_without_capability_mapping' : 'no_eligible_agent_covers_intent',
        intent,
        requiredCapabilities,
        agentId: null,
        agentSlug: null,
        capabilities: [],
        allowedTools: [],
        knowledgeScope: knowledgeScopeFor(normalizeClassification(actor?.classification)),
      };
    }

    const allowedTools = resolveAllowedTools({ capabilityIds: best.matched, actor });
    const decision = {
      status: 'routed',
      agentId: best.agent.id,
      agentSlug: best.agent.slug,
      classification: best.agent.classification,
      agentProfile: { config: best.agent.config || {}, goal: best.agent.goal || null, name: best.agent.name },
      reason: `intent '${intent}' coberto por ${best.matched.length}/${requiredCapabilities.length} capabilities do especialista`,
      confidence: Math.round((0.5 + best.coverage * 0.5) * 100) / 100,
      capabilities: best.matched,
      allowedTools,
      knowledgeScope: knowledgeScopeFor(best.agent.classification),
      eliminated: discovery.eliminated,
    };

    log.info('[AgentSupervisor] Routing decision', {
      tenantId: effectiveTenant,
      intent,
      agentSlug: decision.agentSlug,
      confidence: decision.confidence,
      eliminated: discovery.eliminated.length,
    });
    return decision;
  }

  /**
   * Delegação entre agentes — SEMPRE via Supervisor. Proteções:
   * maxDelegationDepth, cycleDetection, allowedTargets (delegation policy),
   * tenant boundary, classification boundary (PRODUCTION nunca delega para
   * DEVELOPMENT; SUPPORT nunca usa delegação como bypass), capability boundary.
   *
   * @param {object} args
   * @param {object} args.fromAgent   agente solicitante (profile completo)
   * @param {string} args.intent      intent a delegar
   * @param {string[]} [args.chain]   ids dos agentes já na cadeia de delegação
   * @param {string} [args.targetAgentSlug] destino explícito (opcional)
   */
  async function delegate({ fromAgent, intent, chain = [], targetAgentSlug = null, actor = {}, tenantId, channel = null, vertical = null } = {}) {
    const effectiveTenant = String(tenantId || '').trim();
    if (!effectiveTenant) throw new Error('agent_supervisor_tenant_required');
    if (!fromAgent || !fromAgent.id) throw new Error('agent_supervisor_delegation_source_required');

    const depth = chain.length;
    if (depth >= maxDelegationDepth) {
      return { status: 'denied', reason: 'delegation_depth_exceeded', maxDelegationDepth, chain };
    }
    if (chain.includes(fromAgent.id)) {
      return { status: 'denied', reason: 'delegation_cycle_detected', chain };
    }

    const sourceClassification = normalizeClassification(fromAgent.classification);

    // Destino explícito: valida política de delegação declarada no profile.
    if (targetAgentSlug) {
      const delegationPolicy = fromAgent?.config?.delegation;
      const allowedTargets = Array.isArray(delegationPolicy?.allowed) ? delegationPolicy.allowed : null;
      if (allowedTargets && !allowedTargets.includes(targetAgentSlug)) {
        return { status: 'denied', reason: 'delegation_target_not_allowed', targetAgentSlug };
      }
    }

    const decision = await route({
      intent,
      actor: { ...actor, classification: sourceClassification },
      tenantId: effectiveTenant,
      channel,
      vertical,
      excludeAgentIds: [...chain, fromAgent.id],
    });

    if (decision.status !== 'routed') return { ...decision, chain };

    // Classification boundary: o destino não pode ter classificação mais alta
    // que a origem (PRODUCTION → DEVELOPMENT é sempre negado).
    if (!canAccess(sourceClassification, decision.classification)) {
      return {
        status: 'denied',
        reason: 'delegation_classification_boundary',
        sourceClassification,
        targetClassification: decision.classification,
        chain,
      };
    }
    if (targetAgentSlug && decision.agentSlug !== targetAgentSlug) {
      return { status: 'denied', reason: 'delegation_target_mismatch', targetAgentSlug, routedTo: decision.agentSlug, chain };
    }

    return { ...decision, delegated: true, chain: [...chain, fromAgent.id], depth: depth + 1 };
  }

  return { route, delegate, discoverEligible, knowledgeScopeFor };
}

module.exports = { createAgentSupervisor, DEFAULT_MAX_DELEGATION_DEPTH, knowledgeScopeFor };
