'use strict';

const marketplaceService = require('../../agent-marketplace/service');
const agentRegistryService = require('../../agent-registry/service');
const logger = require('../../../utils/logger');
const { getClassificationForAgent, CLASSIFICATIONS } = require('../experience-segregation');
const { canAccess } = require('../../../../src/core/cognitive/visibility');

/**
 * Resolve a classificação do ator e filtra catálogo.
 * P1: PRODUCTION não descobre DEVELOPMENT/SUPPORT. SUPPORT não descobre DEVELOPMENT.
 */
function filterCatalogByClassification(catalog, actorClassification) {
  if (!actorClassification || !['PRODUCTION', 'SUPPORT', 'DEVELOPMENT'].includes(actorClassification)) {
    // Fail closed: unknown classification → vê apenas PRODUCTION.
    return catalog.filter((a) => (a.classification || 'PRODUCTION') === 'PRODUCTION');
  }
  return catalog.filter((a) => canAccess(actorClassification, a.classification || 'PRODUCTION'));
}

async function handleAgentMarketplaceRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { requireAuth, requirePermission, sendJson: _s, badRequest: _b, hasJsonContentType, parseJsonBody } = deps;
  const sendJson = (d, c) => _s(res, c || 200, d);
  const badRequest = (m) => _b(res, m);
  // Fail-closed: requireAuth popula req.tenantId e req.agent.tenantId
  // (camelCase); req.tenant_id nunca é populado em produção, então o fallback
  // 'system' executava 100% das vezes. Tenant ausente → 400 tenant_required
  // (super_admin deve enviar X-Tenant-Id explicitamente, sem inferência).
  const tenantId = req.tenantId || req.agent?.tenantId || null;

  // P1: Resolve classificação do ator autenticado.
  const actorClassification = getClassificationForAgent(req.agent);

  // GET /api/agent-marketplace/catalog
  if (method === 'GET' && pathname === '/api/agent-marketplace/catalog') {
    const a = requireAuth(req); if (!a.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const p = requirePermission(req, 'agents', 'read'); if (!p.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    const category = req.query.category || null;
    let catalog = marketplaceService.getAgentsByCategory(category);
    // P1: Filtra catálogo pela classificação do ator.
    catalog = filterCatalogByClassification(catalog, actorClassification);
    sendJson({ catalog, total: catalog.length, actorClassification }); return true;
  }

  // GET /api/agent-marketplace/catalog/:slug
  const catalogMatch = pathname.match(/^\/api\/agent-marketplace\/catalog\/([a-z0-9-]+)$/);
  if (method === 'GET' && catalogMatch) {
    const a = requireAuth(req); if (!a.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const p = requirePermission(req, 'agents', 'read'); if (!p.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    const agent = marketplaceService.getAgentBySlug(catalogMatch[1]);
    if (!agent) { sendJson({ error: 'Agent not found in catalog' }, 404); return true; }
    // P1: Verifica se ator pode ver este agente.
    if (!canAccess(actorClassification, agent.classification || 'PRODUCTION')) {
      sendJson({ error: 'forbidden: agent classification not accessible' }, 403); return true;
    }
    sendJson({ agent }); return true;
  }

  // POST /api/agent-marketplace/install - Install agent from marketplace
  if (method === 'POST' && pathname === '/api/agent-marketplace/install') {
    const a = requireAuth(req); if (!a.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const p = requirePermission(req, 'agents', 'create'); if (!p.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    if (!tenantId) { sendJson({ error: 'tenant_required' }, 400); return true; }
    if (!hasJsonContentType(req)) { badRequest('Content-Type must be application/json'); return true; }
    try {
      const body = await parseJsonBody(req);
      if (!body.slug) { badRequest('slug is required'); return true; }
      const template = marketplaceService.getAgentBySlug(body.slug);
      if (!template) { sendJson({ error: 'Agent not found in catalog' }, 404); return true; }

      // P1: Não permitir instalação de agente acima da classificação do ator.
      const agentClassification = template.classification || 'PRODUCTION';
      if (!canAccess(actorClassification, agentClassification)) {
        sendJson({ error: `forbidden: cannot install ${agentClassification} agent as ${actorClassification}` }, 403);
        return true;
      }

      // P1: Slug canônico por tenant — sem timestamp.
      // tenant_id + slug garante unicidade no Agent Registry.
      const canonicalSlug = template.slug;

      const agent = await agentRegistryService.createCorporateAgent({
        tenantId, name: template.name,
        slug: canonicalSlug,
        description: template.description,
        classification: agentClassification,
        capabilities: template.capabilities || [],
        tools: template.tools || [],
        knowledgeSources: template.knowledgeSources || [],
        config: template.profile || {},
        lifecycle: 'draft',
      });
      sendJson({ agent, installed: true }, 201);
    } catch (err) { sendJson({ error: err.message }, 500); }
    return true;
  }

  return false;
}

module.exports = { handleAgentMarketplaceRoutes, filterCatalogByClassification };
