'use strict';

/**
 * System Inventory → Knowledge Graph bridge.
 *
 * Converte o inventário do sistema (config/system-inventory.json) em nós
 * e arestas do Knowledge Graph com governança (domain, classification, tenant).
 *
 * Gera relações determinísticas:
 *   Capability → IMPLEMENTED_BY → Tool
 *   Capability → USED_BY → Agent
 *   Capability → EXPOSED_BY → API Route
 *   API Route → MUTATES → Model/Table
 *   Journey → USES → Capability
 *
 * Não depende de LLM para descobrir relações que podem ser determinadas
 * estaticamente a partir do inventário.
 */

const { withGovernance } = require('./knowledge-graph-governance');
const { buildProvenance, SOURCE_KINDS } = require('./provenance');

function defaultLogger() {
  try { return require('../../../api/utils/logger'); } catch (_) { return { info: () => {}, warn: () => {}, error: () => {} }; }
}

/**
 * Carrega o inventário do sistema.
 */
function loadInventory(deps = {}) {
  if (deps.inventory) return deps.inventory;
  try {
    return require('../../../../config/system-inventory.json');
  } catch (_) {
    return { routes: [], pages: [], models: [], capabilities: [], agents: [], journeys: [] };
  }
}

/**
 * Constrói nós do Knowledge Graph a partir do inventário do sistema.
 *
 * @returns {Object} { nodes, edges }
 */
function buildGraphFromInventory({ tenantId = 'system', deps = {} } = {}) {
  const inventory = loadInventory(deps);
  const log = deps.logger || defaultLogger();

  const nodes = [];
  const edges = [];

  // ── API Routes ──────────────────────────────────────────────────────
  const routes = inventory.routes || [];
  for (const route of routes) {
    const node = withGovernance({
      id: route.id || `route:${route.path}:${route.method}`,
      type: 'ApiRoute',
      name: `${route.method || 'GET'} ${route.path || ''}`,
      properties: {
        method: route.method,
        path: route.path,
        classification: route.classification || 'PRODUCTION',
        permissions: route.permissions || [],
        module: route.module || null,
        handler: route.handler || null,
      },
    }, {
      domain: 'SYSTEM',
      classification: route.classification === 'DEVELOPMENT' ? 'DEVELOPMENT'
        : route.classification === 'SUPPORT' ? 'SUPPORT' : 'PRODUCTION',
      sensitivity: 'internal',
      tenantId,
    });
    nodes.push(node);

    // Route → Module
    if (route.module) {
      edges.push({
        source: node.id,
        target: `module:${route.module}`,
        type: 'BELONGS_TO',
      });
    }
  }

  // ── Pages ───────────────────────────────────────────────────────────
  const pages = inventory.pages || [];
  for (const page of pages) {
    const node = withGovernance({
      id: page.id || `page:${page.path}`,
      type: 'Page',
      name: page.name || page.path || '',
      properties: {
        path: page.path,
        component: page.component || null,
        classification: page.classification || 'PRODUCTION',
        permissions: page.permissions || [],
      },
    }, {
      domain: 'SYSTEM',
      classification: page.classification === 'DEVELOPMENT' ? 'DEVELOPMENT'
        : page.classification === 'SUPPORT' ? 'SUPPORT' : 'PRODUCTION',
      sensitivity: 'internal',
      tenantId,
    });
    nodes.push(node);
  }

  // ── Models/Tables ───────────────────────────────────────────────────
  const models = inventory.models || [];
  for (const model of models) {
    const node = withGovernance({
      id: model.id || `model:${model.tableName || model.name}`,
      type: 'Model',
      name: model.tableName || model.name || '',
      properties: {
        tableName: model.tableName,
        modelName: model.modelName || model.name,
        fields: model.fields || [],
        domain: model.domain || null,
      },
    }, {
      domain: 'SYSTEM',
      classification: 'DEVELOPMENT',
      sensitivity: 'internal',
      tenantId,
    });
    nodes.push(node);

    // Model → Domain
    if (model.domain) {
      edges.push({
        source: node.id,
        target: `domain:${model.domain}`,
        type: 'BELONGS_TO',
      });
    }
  }

  // ── Capabilities ────────────────────────────────────────────────────
  const capabilities = inventory.capabilities || [];
  for (const cap of capabilities) {
    const node = withGovernance({
      id: cap.id || `capability:${cap.name}`,
      type: 'Capability',
      name: cap.name || cap.id || '',
      properties: {
        tools: cap.tools || [],
        permissions: cap.permissions || [],
        visibility: cap.visibility || 'PRODUCTION',
        intents: cap.intents || [],
        kind: cap.kind || 'business',
      },
    }, {
      domain: 'SYSTEM',
      classification: cap.visibility === 'DEVELOPMENT' ? 'DEVELOPMENT'
        : cap.visibility === 'SUPPORT' ? 'SUPPORT' : 'PRODUCTION',
      sensitivity: 'internal',
      tenantId,
    });
    nodes.push(node);

    // Capability → Tool
    for (const toolId of (cap.tools || [])) {
      edges.push({
        source: node.id,
        target: `tool:${toolId}`,
        type: 'IMPLEMENTED_BY',
      });
    }
  }

  // ── Agents ──────────────────────────────────────────────────────────
  const agents = inventory.agents || [];
  for (const agent of agents) {
    const node = withGovernance({
      id: agent.id || `agent:${agent.slug}`,
      type: 'Agent',
      name: agent.name || agent.slug || '',
      properties: {
        slug: agent.slug,
        classification: agent.classification || 'PRODUCTION',
        capabilities: agent.capabilities || [],
        tools: agent.tools || [],
      },
    }, {
      domain: 'SYSTEM',
      classification: agent.classification === 'DEVELOPMENT' ? 'DEVELOPMENT'
        : agent.classification === 'SUPPORT' ? 'SUPPORT' : 'PRODUCTION',
      sensitivity: 'internal',
      tenantId,
    });
    nodes.push(node);

    // Agent → Capability
    for (const capId of (agent.capabilities || [])) {
      edges.push({
        source: node.id,
        target: `capability:${capId}`,
        type: 'USES',
      });
    }
  }

  // ── Journeys ────────────────────────────────────────────────────────
  const journeys = inventory.journeys || [];
  for (const journey of journeys) {
    const node = withGovernance({
      id: journey.id || `journey:${journey.name}`,
      type: 'Journey',
      name: journey.name || journey.id || '',
      properties: {
        steps: journey.steps || [],
        capabilities: journey.capabilities || [],
      },
    }, {
      domain: 'SYSTEM',
      classification: 'PRODUCTION',
      sensitivity: 'internal',
      tenantId,
    });
    nodes.push(node);

    // Journey → Capability
    for (const capId of (journey.capabilities || [])) {
      edges.push({
        source: node.id,
        target: `capability:${capId}`,
        type: 'USES',
      });
    }
  }

  log.info('[InventoryGraph] Graph built from inventory', {
    nodes: nodes.length,
    edges: edges.length,
    tenantId,
  });

  return { nodes, edges };
}

module.exports = { buildGraphFromInventory, loadInventory };
