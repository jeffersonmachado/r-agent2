#!/usr/bin/env node
'use strict';

/**
 * Learning Core — Skill Graph builder (Fase 1, N6).
 *
 * Monta o grafo de skills da plataforma a partir de fontes declarativas:
 *   - config/capabilities-registry.json  (capabilities com id/domain/tags)
 *   - config/journey-contracts.json      (jornadas -> requiredCapabilities)
 *   - frontend/src/navigation/menu.js    (árvore de rotas com permission.resource)
 *
 * Taxonomia de skills (metadados explícitos — NÃO é heurística de runtime):
 *   - kind 'resource': um skill por permission.resource distinto do menu.
 *   - kind 'channel':  capabilities `omnichannel_*` viram skills de canal
 *                      (sufixo do id: whatsapp, pbx, email, webchat...).
 *   - kind 'domain':   skills declaradas estaticamente neste arquivo
 *                      (DOMAIN_SKILLS), alvo do mapa CAPABILITY_SKILL_MAP.
 *
 * Capabilities ligadas a skills via CAPABILITY_SKILL_MAP (mapa explícito
 * abaixo) ou pelo prefixo `omnichannel_`. O que não mapeia explicitamente
 * fica fora do grafo de skills e é reportado no stdout.
 *
 * Saídas:
 *   - artefato config/learning/skill-graph.json (obrigatório);
 *   - upsert idempotente no knowledge-graph (tenant `system`): nós skill /
 *     journey / capability e edges requires_capability / belongs_to_skill.
 *     Falha de DB é warning explícito, nunca derruba a geração do artefato.
 *
 * Uso: node scripts/learning/build-skill-graph.js
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const CAPABILITIES_PATH = path.join(ROOT, 'config', 'capabilities-registry.json');
const JOURNEYS_PATH = path.join(ROOT, 'config', 'journey-contracts.json');
const MENU_PATH = path.join(ROOT, 'frontend', 'src', 'navigation', 'menu.js');
const OUTPUT_PATH = path.join(ROOT, 'config', 'learning', 'skill-graph.json');

const OMNICHANNEL_PREFIX = 'omnichannel_';

/**
 * Mapa estático e explícito capability -> skill.
 * Taxonomia declarada como metadado de build; manter enxuto e revisado.
 */
const CAPABILITY_SKILL_MAP = Object.freeze({
  support_ticket_flow: 'tickets',
  support_ticket_reply: 'tickets',
  crm_update: 'crm',
  crm_updates: 'crm',
  lead_capture: 'crm',
  onboarding: 'tenant',
  access_decision: 'access_control',
  membership_validation: 'access_control',
  turnstile_release: 'access_control',
  customer_identification: 'access_control',
  attendance_record: 'access_control',
  scheduling: 'scheduling',
  notifications: 'scheduling',
  billing_validation: 'billing',
  payment: 'billing',
});

/**
 * Skills de domínio declaradas estaticamente (não existem como resource de
 * menu nem como canal omnichannel). Referenciadas por CAPABILITY_SKILL_MAP.
 *
 * `routes` é metadado explícito e opcional: telas onde a competência do
 * domínio é exercida, mas que o menu registra sob resources genéricos
 * (ex.: /access-control é resource 'config'; /fitness/attendance é
 * resource 'reports'). Declaradas aqui, a jornada se torna alcançável pelo
 * Tutor/FAQ nessas telas. NÃO alimentam o routeSkillMap (a atribuição de
 * competência por rota continua vindo do menu).
 */
const DOMAIN_SKILLS = Object.freeze({
  access_control: {
    key: 'access_control',
    label: 'access_control',
    kind: 'domain',
    routes: ['/access-control', '/fitness/attendance'],
  },
  scheduling: {
    key: 'scheduling',
    label: 'scheduling',
    kind: 'domain',
    // agenda é registrada no menu como resource genérico 'reports'
    routes: ['/agenda'],
  },
  billing: {
    key: 'billing',
    label: 'billing',
    kind: 'domain',
    // única tela de plano/cobrança exposta no menu (resource 'config')
    routes: ['/plan-usage'],
  },
});

/**
 * Mapeamento skill -> tipo de nó do knowledge-graph. O enum de `kg_nodes`
 * é fechado (ver api/db/models/KnowledgeGraphNode.js), então os tipos
 * lógicos do learning-core viajam em `externalType`/`externalRef`.
 */
const KG_NODE_TYPE = Object.freeze({
  skill: 'Knowledge',
  journey: 'Journey',
  capability: 'Service',
});

function humanize(key) {
  return String(key || '').replace(/_/g, ' ');
}

/**
 * Monta os dados do skill graph de forma pura (sem I/O) — exportada para
 * testabilidade.
 *
 * @param {object} inputs
 * @param {Array}  inputs.capabilities  capabilities do registry
 * @param {object} inputs.journeys      mapa key -> { requiredCapabilities }
 * @param {Array}  inputs.menuEntries   folhas do menu: [{ path, permission }]
 * @param {Date}   [inputs.now]
 * @returns {{ artifact: object, report: object }}
 */
function buildSkillGraphData({ capabilities, journeys, menuEntries, now }) {
  const generatedAt = (now || new Date()).toISOString();
  const skillsByKey = new Map();
  const routeSkillMap = {};
  const unmappedRoutes = [];

  const ensureSkill = (key, kind) => {
    if (!skillsByKey.has(key)) {
      skillsByKey.set(key, { key, label: humanize(key), kind, routes: [], capabilities: [] });
    }
    return skillsByKey.get(key);
  };

  // 1. Skills de recurso: permission.resource distinto das folhas do menu.
  for (const entry of menuEntries || []) {
    if (!entry || !entry.path) continue;
    const resource = entry.permission && entry.permission.resource;
    if (!resource) {
      unmappedRoutes.push(entry.path);
      continue;
    }
    const skill = ensureSkill(resource, 'resource');
    if (!skill.routes.includes(entry.path)) skill.routes.push(entry.path);
    routeSkillMap[entry.path] = resource;
  }

  // 2. Skills de domínio declaradas estaticamente (rotas declaradas são
  //    unidas às do skill, sem tocar o routeSkillMap).
  for (const domainSkill of Object.values(DOMAIN_SKILLS)) {
    const skill = ensureSkill(domainSkill.key, domainSkill.kind);
    for (const route of domainSkill.routes || []) {
      if (!skill.routes.includes(route)) skill.routes.push(route);
    }
  }

  // 3. Capabilities -> skills (canal por prefixo; mapa estático explícito).
  const registryCapabilityIds = new Set();
  const unmappedCapabilities = [];

  const linkCapabilityToSkill = (capabilityId) => {
    if (capabilityId.startsWith(OMNICHANNEL_PREFIX)) {
      const channel = capabilityId.slice(OMNICHANNEL_PREFIX.length);
      const skill = ensureSkill(channel, 'channel');
      if (!skill.capabilities.includes(capabilityId)) skill.capabilities.push(capabilityId);
      return skill.key;
    }
    const mapped = CAPABILITY_SKILL_MAP[capabilityId];
    if (mapped && skillsByKey.has(mapped)) {
      const skill = skillsByKey.get(mapped);
      if (!skill.capabilities.includes(capabilityId)) skill.capabilities.push(capabilityId);
      return skill.key;
    }
    return null;
  };

  for (const capability of capabilities || []) {
    if (!capability || !capability.id) continue;
    registryCapabilityIds.add(capability.id);
    if (linkCapabilityToSkill(capability.id) === null) {
      unmappedCapabilities.push(capability.id);
    }
  }

  // 4. Jornadas -> requiredCapabilities (inclusive capabilities fora do
  //    registry: entram no grafo como nós capability e são reportadas).
  const journeyList = [];
  const unregisteredCapabilities = new Set();
  for (const [key, journey] of Object.entries(journeys || {})) {
    const requiredCapabilities = Array.isArray(journey && journey.requiredCapabilities)
      ? journey.requiredCapabilities.slice()
      : [];
    journeyList.push({ key, requiredCapabilities });
    for (const capabilityId of requiredCapabilities) {
      if (!registryCapabilityIds.has(capabilityId)) {
        unregisteredCapabilities.add(capabilityId);
      }
      // Tenta mapear também capabilities declaradas só em jornadas.
      linkCapabilityToSkill(capabilityId);
    }
  }

  // 5. Artefato final, ordenado deterministicamente.
  const skills = Array.from(skillsByKey.values())
    .map((skill) => ({
      key: skill.key,
      label: skill.label,
      kind: skill.kind,
      routes: skill.routes.slice().sort(),
      capabilities: skill.capabilities.slice().sort(),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const sortedRouteSkillMap = {};
  for (const route of Object.keys(routeSkillMap).sort()) {
    sortedRouteSkillMap[route] = routeSkillMap[route];
  }

  const artifact = {
    version: 1,
    generatedAt,
    skills,
    journeys: journeyList.sort((a, b) => a.key.localeCompare(b.key)),
    routeSkillMap: sortedRouteSkillMap,
  };

  const report = {
    skillCount: skills.length,
    routeCount: Object.keys(sortedRouteSkillMap).length,
    journeyCount: journeyList.length,
    unmappedCapabilities: unmappedCapabilities.sort(),
    unregisteredCapabilities: Array.from(unregisteredCapabilities).sort(),
    unmappedRoutes: unmappedRoutes.sort(),
  };

  return { artifact, report };
}

/**
 * Upsert idempotente no knowledge-graph (tenant `system`).
 * Nós deduplicados por externalRef/externalType (ver service.upsertNode);
 * edges deduplicadas via findOne (createEdge do service não dedup).
 */
async function upsertSkillGraphToKnowledgeGraph(artifact, tenantId = 'system') {
  const { connect, close } = require('../../api/db/sequelize');
  const kgService = require('../../api/modules/knowledge-graph/service');
  const getKnowledgeGraphEdgeModel = require('../../api/db/models/KnowledgeGraphEdge');

  await connect(5, 500);

  const KGEdge = getKnowledgeGraphEdgeModel();
  const stats = { nodes: 0, edges: 0, edgesSkipped: 0 };
  const nodeIds = new Map();

  async function upsert(kind, key, label, properties) {
    const node = await kgService.upsertNode({
      tenantId,
      type: KG_NODE_TYPE[kind],
      label,
      properties,
      externalRef: `${kind}:${key}`,
      externalType: `learning-${kind}`,
    });
    nodeIds.set(`${kind}:${key}`, node.id);
    stats.nodes += 1;
    return node;
  }

  async function ensureEdge(sourceId, targetId, relationship, properties) {
    const existing = await KGEdge.findOne({
      where: {
        tenant_id: tenantId,
        sourceNodeId: sourceId,
        targetNodeId: targetId,
        relationship,
      },
    });
    if (existing) {
      stats.edgesSkipped += 1;
      return existing;
    }
    await kgService.createEdge({
      tenantId,
      sourceNodeId: sourceId,
      targetNodeId: targetId,
      relationship,
      weight: 1.0,
      properties: properties || {},
    });
    stats.edges += 1;
    return null;
  }

  for (const skill of artifact.skills) {
    await upsert('skill', skill.key, skill.label, {
      kind: skill.kind,
      routes: skill.routes,
      capabilities: skill.capabilities,
    });
  }

  const capabilityIds = new Set();
  for (const skill of artifact.skills) {
    for (const capabilityId of skill.capabilities) capabilityIds.add(capabilityId);
  }
  for (const journey of artifact.journeys) {
    for (const capabilityId of journey.requiredCapabilities) capabilityIds.add(capabilityId);
  }
  for (const capabilityId of Array.from(capabilityIds).sort()) {
    await upsert('capability', capabilityId, humanize(capabilityId), {});
  }

  for (const journey of artifact.journeys) {
    await upsert('journey', journey.key, humanize(journey.key), {
      requiredCapabilities: journey.requiredCapabilities,
    });
  }

  for (const journey of artifact.journeys) {
    const journeyNodeId = nodeIds.get(`journey:${journey.key}`);
    for (const capabilityId of journey.requiredCapabilities) {
      const capabilityNodeId = nodeIds.get(`capability:${capabilityId}`);
      if (journeyNodeId && capabilityNodeId) {
        await ensureEdge(journeyNodeId, capabilityNodeId, 'requires_capability');
      }
    }
  }

  for (const skill of artifact.skills) {
    const skillNodeId = nodeIds.get(`skill:${skill.key}`);
    for (const capabilityId of skill.capabilities) {
      const capabilityNodeId = nodeIds.get(`capability:${capabilityId}`);
      if (skillNodeId && capabilityNodeId) {
        await ensureEdge(capabilityNodeId, skillNodeId, 'belongs_to_skill');
      }
    }
  }

  await close();
  return stats;
}

async function main() {
  const capabilitiesRegistry = JSON.parse(fs.readFileSync(CAPABILITIES_PATH, 'utf8'));
  const journeyContracts = JSON.parse(fs.readFileSync(JOURNEYS_PATH, 'utf8'));
  const menuModule = await import(pathToFileURL(MENU_PATH).href);

  const menuEntries = typeof menuModule.getRouteCatalog === 'function'
    ? menuModule.getRouteCatalog()
    : [];

  const { artifact, report } = buildSkillGraphData({
    capabilities: capabilitiesRegistry.capabilities || [],
    journeys: journeyContracts.journeys || {},
    menuEntries,
  });

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  console.log('[learning:skill-graph] Artefato gerado:', path.relative(ROOT, OUTPUT_PATH));
  console.log(`[learning:skill-graph] skills=${report.skillCount} rotas=${report.routeCount} jornadas=${report.journeyCount}`);
  console.log(`[learning:skill-graph] capabilities sem skill (fora do mapa explícito): ${report.unmappedCapabilities.length}`);
  for (const id of report.unmappedCapabilities) console.log(`  - ${id}`);
  console.log(`[learning:skill-graph] capabilities de jornadas fora do registry: ${report.unregisteredCapabilities.length}`);
  for (const id of report.unregisteredCapabilities) console.log(`  - ${id}`);
  console.log(`[learning:skill-graph] rotas do menu sem permission.resource (sem skill): ${report.unmappedRoutes.length}`);
  for (const route of report.unmappedRoutes) console.log(`  - ${route}`);

  try {
    const stats = await upsertSkillGraphToKnowledgeGraph(artifact, 'system');
    console.log(`[learning:skill-graph] Knowledge-graph: ${stats.nodes} nós upserted, ${stats.edges} edges criadas, ${stats.edgesSkipped} edges já existentes`);
  } catch (error) {
    console.warn(`[learning:skill-graph] AVISO: upsert no knowledge-graph falhou (${error.message}). Artefato JSON íntegro; rode novamente com o DB no ar para sincronizar o grafo.`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[learning:skill-graph] Falha fatal:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildSkillGraphData,
  CAPABILITY_SKILL_MAP,
  DOMAIN_SKILLS,
  OMNICHANNEL_PREFIX,
};
