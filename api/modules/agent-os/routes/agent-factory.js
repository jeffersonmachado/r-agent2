'use strict';

const agentRegistryService = require('../../agent-registry/service');
const logger = require('../../../utils/logger');
const hardeningService = require('../services/agent-hardening-service');

async function handleAgentFactoryRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { requireAuth, requirePermission, sendJson: _s, badRequest: _b, hasJsonContentType, parseJsonBody, logAction } = deps;
  const sendJson = (d, c) => _s(res, c || 200, d);
  const badRequest = (m) => _b(res, m);

  // Fail-closed: req.tenant_id e req.user nunca existiram. O tenant real vem
  // do middleware de auth (req.tenantId) ou do agente autenticado; o principal
  // vem de req.agent. Sem tenant → 400 tenant_required; sem principal → 401
  // principal_required. Nunca 'system' implícito.
  const resolveTenantId = () => req.tenantId || (req.agent && req.agent.tenantId) || null;
  const resolveActor = () => (req.agent && (req.agent.username || req.agent.id)) || null;
  const requireTenant = () => {
    const resolved = resolveTenantId();
    if (!resolved) {
      sendJson({ error: 'tenant_required', message: 'Tenant explicito obrigatorio (X-Tenant-Id ou agente autenticado)' }, 400);
      return null;
    }
    return resolved;
  };
  const requirePrincipal = () => {
    const actor = resolveActor();
    if (!actor) {
      sendJson({ error: 'principal_required', message: 'Principal autenticado obrigatorio para esta operacao' }, 401);
      return null;
    }
    return actor;
  };

  // POST /api/agent-factory/create - Create agent with full workflow
  if (method === 'POST' && pathname === '/api/agent-factory/create') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'create'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    const tenantId = requireTenant(); if (!tenantId) return true;

    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');
    const body = await parseJsonBody(req);

    if (!body.name || !body.slug) return badRequest('name and slug are required');

    const agent = await agentRegistryService.createCorporateAgent({
      ...body,
      tenantId,
      lifecycle: 'draft',
    });

    await logAction('agent_factory.create', { agentId: agent.id, slug: agent.slug });
    sendJson({ agent, workflow: { step: 'created', next: 'configure' } }, 201);
  }

  // POST /api/agent-factory/configure - Configure agent
  if (method === 'POST' && pathname === '/api/agent-factory/configure') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'update'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    const tenantId = requireTenant(); if (!tenantId) return true;

    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');
    const body = await parseJsonBody(req);
    if (!body.id) return badRequest('id is required');

    const agent = await agentRegistryService.updateCorporateAgent(body.id, {
      capabilities: body.capabilities,
      tools: body.tools,
      knowledgeSources: body.knowledgeSources,
      permissions: body.permissions,
      connectedSystems: body.connectedSystems,
      config: body.config,
    }, tenantId);

    if (!agent) return sendJson({ error: 'Agent not found' }, 404);
    await logAction('agent_factory.configure', { agentId: agent.id });
    sendJson({ agent, workflow: { step: 'configured', next: 'validate' } });
  }

  // POST /api/agent-factory/validate - Submit to QA Wave validation (REAL)
  if (method === 'POST' && pathname === '/api/agent-factory/validate') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'update'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    const tenantId = requireTenant(); if (!tenantId) return true;
    const actor = requirePrincipal(); if (!actor) return true;

    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');
    const body = await parseJsonBody(req);
    if (!body.id) return badRequest('id is required');

    // PROIBIDO: body.qaWaveResult como bypass manual
    if (body.qaWaveResult !== undefined) {
      return badRequest('qaWaveResult manual override is forbidden. Validation must execute real QA Waves.');
    }

    const agent = await agentRegistryService.getCorporateAgentById(body.id, tenantId);
    if (!agent) return sendJson({ error: 'Agent not found' }, 404);

    // Atualiza para estado de validação
    await agentRegistryService.updateCorporateAgent(body.id, {
      lifecycle: 'validation',
      status: 'pending_validation',
    }, tenantId);

    await logAction('agent_factory.validate', { agentId: agent.id });

    // Executa validação REAL via QA Waves
    try {
      const waveResult = await hardeningService.runQaWaveValidation({
        agent,
        tenantId,
        journeyId: body.journeyId || null,
      });

      // Gera evidência
      const { evidence } = await hardeningService.generateEvidence({
        agent,
        waveResult,
        tenantId,
      });

      // Gera replay artifact
      const { replay } = await hardeningService.generateReplayArtifact({
        agent,
        waveResult,
        evidence,
        tenantId,
      });

      // Registra governance trail com o principal real
      await hardeningService.recordGovernanceTrail({
        agent,
        waveResult,
        evidence,
        replay,
        tenantId,
        actor,
        actorRole: req.agent?.role || null,
      });

      // Atualiza agente com metadados de validação
      await agentRegistryService.updateCorporateAgent(body.id, {
        lifecycle: waveResult.status === 'GO' ? 'validated' : 'validation',
        status: waveResult.status === 'GO' ? 'pending_approval' : 'validation_failed',
        governance: {
          ...(agent.governance || {}),
          validation: {
            waveId: waveResult.waveId,
            executionId: waveResult.executionId,
            evidenceId: evidence.evidenceId,
            replayId: replay.replayId,
            validatedAt: new Date().toISOString(),
          },
        },
      }, tenantId);

      return sendJson({
        agent: await agentRegistryService.getCorporateAgentById(body.id, tenantId),
        qaWave: {
          status: waveResult.status,
          waveId: waveResult.waveId,
          executionId: waveResult.executionId,
          checks: waveResult.checks || [],
        },
        evidence: {
          evidenceId: evidence.evidenceId,
          status: evidence.status,
        },
        replay: {
          replayId: replay.replayId,
          status: replay.status,
        },
        workflow: {
          step: 'validated',
          next: waveResult.status === 'GO' ? 'approve' : 'fix',
        },
      });
    } catch (error) {
      logger.error('[AgentFactory] Validation failed', {
        agentId: agent.id,
        error: error.message,
      });

      // Registra falha como NO_GO
      const crypto = require('crypto');
      const failedWaveResult = {
        waveId: `agent-os-${agent.slug}`,
        executionId: crypto.randomUUID(),
        status: 'NO_GO',
        source: 'qa_waves_real',
        error: error.message,
        checks: [{ name: 'qa_wave_execution', status: 'FAILED', reason: error.message }],
      };

      const { evidence } = await hardeningService.generateEvidence({
        agent,
        waveResult: failedWaveResult,
        tenantId,
      });

      await hardeningService.generateReplayArtifact({
        agent,
        waveResult: failedWaveResult,
        evidence,
        tenantId,
      });

      return sendJson({
        agent,
        qaWave: { status: 'NO_GO', waveId: failedWaveResult.waveId, executionId: failedWaveResult.executionId, error: error.message },
        evidence: { evidenceId: evidence.evidenceId, status: 'failed' },
        workflow: { step: 'validation_failed', next: 'fix' },
      });
    }
  }

  // POST /api/agent-factory/approve - Approve agent (validated → approved)
  // O approve CRIA a aprovação: exige lifecycle 'validated' e gates técnicos,
  // mas não approvedBy pré-existente (esse gate passou a ser verificado no publish).
  if (method === 'POST' && pathname === '/api/agent-factory/approve') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'approve'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    const tenantId = requireTenant(); if (!tenantId) return true;
    const actor = requirePrincipal(); if (!actor) return true;

    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');
    const body = await parseJsonBody(req);
    if (!body.id) return badRequest('id is required');

    const result = await hardeningService.approveAgent({
      agentId: body.id,
      tenantId,
      actor,
      actorRole: req.agent?.role || null,
      riskLevel: body.riskLevel,
      auditEnabled: body.auditEnabled,
    });

    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        return sendJson({ error: 'agent_not_found', message: result.error || 'Agent not found' }, 404);
      }
      if (result.code === 'agent_not_validated') {
        return sendJson({
          error: 'agent_not_validated',
          message: result.error,
          lifecycle: result.agent?.lifecycle || null,
        }, 400);
      }
      return sendJson({
        error: 'governance_gates_failed',
        message: result.error || 'Cannot approve agent: governance gates not satisfied',
        governance: result.governance,
      }, 400);
    }

    await logAction('agent_factory.approve', { agentId: body.id, approvedBy: actor });
    sendJson({
      agent: result.agent,
      governance: result.governance,
      workflow: { step: 'approved', next: 'publish' },
    });
  }

  // POST /api/agent-factory/publish - Publish agent (approved → active)
  // Publish NUNCA contorna o approve: exige lifecycle 'approved', approvedBy
  // registrado e publisher ≠ approver (segregação de funções).
  if (method === 'POST' && pathname === '/api/agent-factory/publish') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'publish'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    const tenantId = requireTenant(); if (!tenantId) return true;
    const actor = requirePrincipal(); if (!actor) return true;

    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');
    const body = await parseJsonBody(req);
    if (!body.id) return badRequest('id is required');

    // Executa pipeline completo de validação e publicação
    const result = await hardeningService.validateAndPublishAgent({
      agentId: body.id,
      tenantId,
      actor,
      actorRole: req.agent?.role || null,
    });

    if (!result.ok) {
      // Agente inexistente é 404, não bloqueio de governança.
      if (result.code === 'NOT_FOUND') {
        return sendJson({ error: 'agent_not_found', message: result.error || 'Agent not found' }, 404);
      }

      await logAction('agent_factory.publish_blocked', {
        agentId: body.id,
        reason: result.reason,
      });

      // Bloqueios de lifecycle/segregação têm código explícito.
      if (result.code === 'agent_not_approved' || result.code === 'governance_gates_failed') {
        return sendJson({
          error: result.code,
          message: result.error || 'Publication blocked by governance',
          lifecycle: result.agent?.lifecycle || null,
          governance: result.governance,
          workflow: result.workflow,
        }, 400);
      }
      if (result.code === 'publish_self_approval_denied') {
        return sendJson({
          error: 'publish_self_approval_denied',
          message: result.error,
          workflow: result.workflow,
        }, 403);
      }

      return sendJson({
        error: 'publish_blocked',
        message: result.reason || 'Publication blocked by governance',
        status: result.status,
        waveResult: result.waveResult,
        evidence: result.evidence,
        replay: result.replay,
        workflow: result.workflow,
      }, 400);
    }

    await logAction('agent_factory.publish', { agentId: body.id });
    sendJson({
      agent: result.agent,
      qaWave: result.waveResult,
      evidence: result.evidence,
      replay: result.replay,
      workflow: { step: 'published', status: 'active' },
    });
  }

  return false;
}

module.exports = { handleAgentFactoryRoutes };
