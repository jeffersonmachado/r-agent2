'use strict';

const agentRegistryService = require('../../agent-registry/service');
const governanceService = require('../../ai-governance/service');
const logger = require('../../../utils/logger');
const { getCapabilityRegistry } = require('../../../../src/core/cognitive/capability-registry');
const { canAccess } = require('../../../../src/core/cognitive/visibility');

/**
 * Agent Orchestrator — FACADE sobre o Cognitive Core.
 *
 * Não é um runtime independente: as capabilities vêm do Canonical Capability
 * Registry (config/canonical-capabilities.json) e a execução passa pelo
 * Cognitive Tool Registry — a mesma fonte da verdade do Cognitive Core e do
 * MCP Server Adapter.
 *
 * Contrato obrigatório (self-proving):
 *   REAL SUCCESS ou EXPLICIT FAILURE — nunca FAKE SUCCESS.
 * Não existe fallback silencioso: serviço indisponível, capability sem tool
 * executável ou falha de execução retornam success:false com erro real.
 */

function getToolRegistry() {
  return require('../../../../src/core/cognitive').getCognitiveOrchestrator().toolRegistry;
}

function normalizeActorClassification(context) {
  const c = String(context.actor?.classification || context.classification || 'PRODUCTION').toUpperCase();
  return ['PRODUCTION', 'SUPPORT', 'DEVELOPMENT'].includes(c) ? c : 'PRODUCTION';
}

/**
 * Resolve e executa uma capability real via Canonical Capability Registry +
 * Cognitive Tool Registry.
 *
 * @param {string} capabilityKey  nome canônico ou alias legado
 * @param {object} agent          agente corporativo (para auditoria)
 * @param {object} context        { tenantId, query, params, action?, actor? }
 */
async function executeCapability(capabilityKey, agent, context = {}) {
  const capabilityRegistry = getCapabilityRegistry();
  const capDef = capabilityRegistry.get(capabilityKey);
  const startTime = Date.now();

  if (!capDef) {
    return {
      success: false,
      error: `Unknown capability: ${capabilityKey}`,
      capability: capabilityKey,
    };
  }

  const actorClassification = normalizeActorClassification(context);
  if (!canAccess(actorClassification, capDef.visibility)) {
    return {
      success: false,
      capability: capDef.id,
      name: capDef.name,
      category: capDef.visibility,
      error: `capability_visibility_denied: ${capDef.id} requer ${capDef.visibility} (actor=${actorClassification})`,
      durationMs: Date.now() - startTime,
    };
  }

  if (!capDef.tools || capDef.tools.length === 0) {
    // explicit_unavailable: capability sem tool executável registrada.
    return {
      success: false,
      capability: capDef.id,
      name: capDef.name,
      category: capDef.visibility,
      error: `capability_without_executable_tool: ${capDef.id}`,
      durationMs: Date.now() - startTime,
    };
  }

  const toolRegistry = getToolRegistry();
  const toolId = capDef.tools[0];
  const input = { ...(context.query || {}), ...(context.params || {}) };

  try {
    const result = await toolRegistry.execute(toolId, input, {
      tenantId: context.tenantId,
      // Fail closed: sem actor explícito, sem permissões — nunca wildcard.
      actor: context.actor || { classification: actorClassification, permissions: [] },
      correlationId: context.correlationId || null,
      idempotencyKey: context.idempotencyKey || `agent-orchestrator:${context.tenantId}:${capDef.id}:${startTime}`,
    });

    return {
      success: true,
      capability: capDef.id,
      requestedCapability: capabilityKey,
      name: capDef.name,
      category: capDef.visibility,
      result: { toolId: result.toolId, data: result.output },
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    // Falha real e explícita — sem payload sintético.
    logger.error('[AgentOrchestrator] Capability execution failed', {
      capability: capDef.id,
      toolId,
      agentId: agent?.id,
      error: error.message,
    });
    return {
      success: false,
      capability: capDef.id,
      requestedCapability: capabilityKey,
      name: capDef.name,
      category: capDef.visibility,
      error: error.message,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Adapter de compatibilidade: o antigo CAPABILITY_REGISTRY (fonte independente)
 * foi eliminado. Esta visão é DERIVADA do Canonical Capability Registry —
 * mesma fonte, mesmo comportamento de execução.
 */
function buildLegacyCapabilityView() {
  const capabilityRegistry = getCapabilityRegistry();
  const view = {};
  for (const cap of capabilityRegistry.list({ classification: 'DEVELOPMENT' })) {
    view[cap.id] = {
      name: cap.name,
      type: cap.domain,
      tools: cap.tools,
      category: cap.visibility,
    };
  }
  return view;
}

async function handleAgentOrchestratorRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { requireAuth, requirePermission, sendJson: _s, badRequest: _b, hasJsonContentType, parseJsonBody } = deps;
  // Fail-closed: requireAuth popula req.tenantId e req.agent.tenantId
  // (camelCase); req.tenant_id nunca é populado em produção, então o fallback
  // 'system' executava 100% das vezes. Tenant ausente → 400 tenant_required
  // (super_admin deve enviar X-Tenant-Id explicitamente, sem inferência).
  const tenantId = req.tenantId || req.agent?.tenantId || null;
  const sendJson = (d, c) => _s(res, c || 200, d);
  const badRequest = (m) => _b(res, m);
  const tenantGuard = () => {
    if (tenantId) return true;
    sendJson({ error: 'tenant_required' }, 400);
    return false;
  };

  // POST /api/agent-orchestrator/execute - Execute orchestration workflow (REAL)
  if (method === 'POST' && pathname === '/api/agent-orchestrator/execute') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'execute'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    if (!tenantGuard()) return true;

    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');
    const body = await parseJsonBody(req);

    if (!body.intent) return badRequest('intent is required');

    // Orchestration logic:
    // 1. Parse intent
    // 2. Select relevant agents
    // 3. Resolve capabilities (Canonical Capability Registry)
    // 4. Execute capabilities reais (Cognitive Tool Registry)
    // 5. Collect results — sucesso real ou falha explícita

    const intentMap = {
      'whatsapp_message': ['sdr-agent', 'crm-agent', 'customer-service-agent'],
      'customer_inquiry': ['crm-agent', 'customer-service-agent'],
      'appointment_request': ['scheduling-agent', 'crm-agent'],
      'payment_reminder': ['collection-agent'],
      'campaign_trigger': ['campaign-agent'],
      'knowledge_query': ['operational-knowledge-agent'],
    };

    const capabilityIntentMap = {
      'whatsapp_message': ['crm.read', 'ticket.manage'],
      'customer_inquiry': ['crm.read', 'ticket.manage'],
      'appointment_request': ['schedule.read', 'crm.read', 'schedule.manage'],
      'payment_reminder': ['crm.read', 'messaging.send'],
      'campaign_trigger': ['campaign.manage', 'crm.read'],
      'knowledge_query': ['knowledge.operational'],
    };

    // P1: Legacy facade — delega ao CognitiveOrchestrator (runtime único).
    // O intentMap/capabilityIntentMap é apenas para compatibilidade de resposta.
    const agentSlugs = intentMap[body.intent] || ['customer-service-agent'];
    const capabilityKeys = capabilityIntentMap[body.intent] || [];

    // Ator derivado do request autenticado (RBAC real) — nunca do body.
    const { _internal: cognitiveInternal } = require('../../cognitive/routes');
    const requestActor = {
      userId: req.agent?.id || req.agent?.username || null,
      classification: cognitiveInternal.resolveActorClassification(req.agent),
      permissions: cognitiveInternal.resolveActorToolPermissions(req.agent),
    };

    const overallStartTime = Date.now();
    const executionSteps = [];

    // P1: Delega execução ao CognitiveOrchestrator (runtime único).
    // O Agent Orchestrator NÃO executa capabilities diretamente.
    try {
      const { getCognitiveOrchestrator } = require('../../../../src/core/cognitive/cognitive-orchestrator');
      const orchestrator = getCognitiveOrchestrator();

      const cognitiveResult = await orchestrator.process({
        tenantId,
        channel: 'api',
        message: body.message || body.intent,
        eventType: body.intent,
        payload: {
          intent: body.intent,
          params: body.params || {},
          query: body.query || body.params || {},
          correlationId: body.correlationId || null,
        },
        actor: requestActor,
      });

      executionSteps.push({
        capability: cognitiveResult.intent || body.intent,
        agent: cognitiveResult.agentSlug || 'cognitive-core',
        status: cognitiveResult.status === 'completed' ? 'executed' : cognitiveResult.status,
        durationMs: cognitiveResult.latencyMs || (Date.now() - overallStartTime),
        result: {
          success: cognitiveResult.status === 'completed',
          executionId: cognitiveResult.executionId,
          businessOutcome: cognitiveResult.businessOutcome,
          outputs: cognitiveResult.outputs,
        },
      });
    } catch (error) {
      // P1: CognitiveOrchestrator falhou → erro explícito. NUNCA fallback para execução direta.
      logger.error('[AgentOrchestrator] CognitiveOrchestrator failed — no fallback', {
        tenantId, intent: body.intent, error: error.message,
      });

      executionSteps.push({
        capability: body.intent,
        agent: 'cognitive-core',
        status: 'failed',
        durationMs: Date.now() - overallStartTime,
        result: {
          success: false,
          error: error.message,
        },
      });
    }

    const totalDurationMs = Date.now() - overallStartTime;

    // Trilha de governança (contrato CORE-BIZ-AGENT-ORCHESTRATOR): cada step
    // executado grava um evento 'execute' em ai_governance_records. Falha de
    // log nunca bloqueia a resposta da orquestração.
    for (const step of executionSteps) {
      await governanceService.logGovernanceEvent({
        tenantId,
        agentId: null,
        eventType: 'execute',
        actor: req.agent?.username || 'system',
        description: `Orchestrator executed capability ${step.capability} via agent ${step.agent} for intent: ${body.intent}`,
        toolsUsed: [step.capability],
        dataAccessed: [],
        cost: 0.01,
        riskLevel: 'low',
      }).catch((err) => {
        logger.warn('[AgentOrchestrator] Governance log failed (non-blocking)', { error: err.message });
      });
    }

    sendJson({
      orchestration: {
        intent: body.intent,
        agentsSelected: agentSlugs,
        capabilitiesResolved: capabilityKeys,
        steps: executionSteps,
        totalDurationMs,
        status: executionSteps.every(s => s.status === 'executed' || s.status === 'completed') ? 'completed' : 'partial',
      },
    });
  }

  // GET /api/agent-orchestrator/intents - List available intents
  if (method === 'GET' && pathname === '/api/agent-orchestrator/intents') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'read'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }

    const capabilityView = buildLegacyCapabilityView();

    sendJson({
      intents: [
        { id: 'whatsapp_message', label: 'Mensagem WhatsApp', agents: ['sdr-agent', 'crm-agent', 'customer-service-agent'] },
        { id: 'customer_inquiry', label: 'Consulta de Cliente', agents: ['crm-agent', 'customer-service-agent'] },
        { id: 'appointment_request', label: 'Solicitação de Agendamento', agents: ['scheduling-agent', 'crm-agent'] },
        { id: 'payment_reminder', label: 'Lembrete de Pagamento', agents: ['collection-agent'] },
        { id: 'campaign_trigger', label: 'Disparo de Campanha', agents: ['campaign-agent'] },
        { id: 'knowledge_query', label: 'Consulta de Conhecimento', agents: ['operational-knowledge-agent'] },
      ],
      capabilities: Object.keys(capabilityView).map(key => ({
        key,
        ...capabilityView[key],
      })),
    });
  }

  // GET /api/agent-orchestrator/capabilities - List all capabilities
  if (method === 'GET' && pathname === '/api/agent-orchestrator/capabilities') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'read'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }

    const capabilityView = buildLegacyCapabilityView();
    const byCategory = {};
    for (const [key, def] of Object.entries(capabilityView)) {
      if (!byCategory[def.category]) byCategory[def.category] = [];
      byCategory[def.category].push({ key, ...def });
    }

    sendJson({ capabilities: capabilityView, byCategory });
  }

  return false;
}

module.exports = {
  handleAgentOrchestratorRoutes,
  executeCapability,
  // Adapter derivado do Canonical Capability Registry (não é fonte independente).
  get CAPABILITY_REGISTRY() { return buildLegacyCapabilityView(); },
};
