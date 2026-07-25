'use strict';

/**
 * inventoryEngine — orquestra os scanners de inventário (API, frontend,
 * models), atribui fingerprints determinísticos e vincula itens a jornadas
 * de negócio ou waves técnicas.
 *
 * Fingerprint: SHA-256 (via qa/coverage/fingerprints.fingerprintObject) sobre
 * os campos estruturais do item — nunca timestamps nem anotações derivadas
 * de linking (linkStatus, linkedJourneys, linkedDomains, linkKind,
 * technicalWave, fingerprint).
 *
 * Regra de linking (findOrphanedItems), documentada:
 *   1. Vocabulário de negócio: jornadas de `config/journey-contracts.json`
 *      (chaves) e domínios de `qa-mesh/meshRegistry.json` (campo `domain`).
 *      Tokens gerados por split de palavras (camelCase/snake_case/kebab),
 *      removendo tokens genéricos (GENERIC_TOKENS abaixo).
 *   2. Tokens do item: módulo + segmentos de path (API/página) ou palavras do
 *      model/tabela (models), com os mesmos splits e stoplist.
 *   3. LINKED (linkKind 'journey'): interseção não vazia com tokens de alguma
 *      jornada (`linkedJourneys`) ou com algum domínio do mesh
 *      (`linkedDomains`); domínios também puxam jornadas cujo id contém o
 *      domínio.
 *   4. Sem vínculo de negócio:
 *      - itens DEVELOPMENT/SUPPORT recebem `technicalWave` pela regra
 *        TECHNICAL_WAVE_RULES e ficam LINKED com linkKind 'technical-wave';
 *      - itens de dados (model/table/field/relation) recebem
 *        technicalWave 'database-integrity' pelo mesmo mecanismo;
 *      - demais (páginas/rotas PRODUCTION) ficam `linkStatus: 'ORPHANED'`.
 *
 * TECHNICAL_WAVE_RULES (primeira regra que casa vence, sobre o texto
 * module+path+model em minúsculas):
 *   security             auth|rbac|access|credential|mfa|sso|permission|encrypt
 *   observability        health|status|metric|telemetry|observ|monitor
 *   support-diagnostics  support|diagnost|debug|audit|ledger|log
 *   resilience           qa|test|rpa|replay|chaos|seed|resilien
 *   database-integrity   itens de dados (model/table/field/relation)
 *   platform             fallback
 */

const fs = require('fs');
const path = require('path');
const { fingerprintObject } = require('../../../../qa/coverage/fingerprints');
const { scanApiRoutes } = require('./apiRouteScanner');
const { scanFrontendRoutes } = require('./frontendRouteScanner');
const { scanModels } = require('./modelScanner');

const INVENTORY_VERSION = 1;

const GENERIC_TOKENS = new Set([
  'api', 'v1', 'dev', 'page', 'index', 'flow', 'journey', 'customer',
  'default', 'new', 'core', 'id', 'system', 'management', 'service', 'services',
]);

const TECHNICAL_WAVE_RULES = [
  { wave: 'security', pattern: /auth|rbac|access|credential|mfa|sso|permission|encrypt/ },
  { wave: 'observability', pattern: /health|status|metric|telemetry|observ|monitor/ },
  { wave: 'support-diagnostics', pattern: /support|diagnost|debug|audit|ledger|log/ },
  { wave: 'resilience', pattern: /qa|test|rpa|replay|chaos|seed|resilien/ },
];

const DATA_KINDS = new Set(['model', 'table', 'field', 'relation']);

/** Campos derivados que não participam do fingerprint estrutural. */
const NON_STRUCTURAL_FIELDS = new Set([
  'fingerprint', 'linkStatus', 'linkKind', 'linkedJourneys', 'linkedDomains', 'technicalWave',
]);

function structuralFields(item) {
  const structural = {};
  for (const [key, value] of Object.entries(item)) {
    if (!NON_STRUCTURAL_FIELDS.has(key)) structural[key] = value;
  }
  return structural;
}

function tokenize(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !GENERIC_TOKENS.has(token));
}

function itemTokens(item) {
  if (item.kind === 'api') {
    const pathTokens = (item.path || '').split('/').flatMap((segment) => tokenize(segment.replace(/^:.*/, '')));
    return new Set([...tokenize(item.module), ...pathTokens]);
  }
  if (item.kind === 'page') {
    return new Set((item.path || '').split('/').flatMap(tokenize));
  }
  // model/table/field/relation
  return new Set([...tokenize(item.model), ...tokenize(item.table), ...tokenize(item.tableName)]);
}

function loadJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function buildJourneyIndex(journeyContracts, meshRegistry) {
  const journeys = Object.keys((journeyContracts && journeyContracts.journeys) || {});
  const journeyTokens = new Map(journeys.map((journey) => [journey, new Set(tokenize(journey))]));
  const scenarios = Array.isArray(meshRegistry) ? meshRegistry : (meshRegistry && meshRegistry.scenarios) || [];
  const domains = [...new Set(scenarios.map((scenario) => scenario && scenario.domain).filter(Boolean))].sort();
  return { journeys, journeyTokens, domains };
}

function assignTechnicalWave(item) {
  if (DATA_KINDS.has(item.kind)) return 'database-integrity';
  const text = `${item.module || ''} ${item.path || ''} ${item.model || ''} ${item.section || ''}`.toLowerCase();
  for (const rule of TECHNICAL_WAVE_RULES) {
    if (rule.pattern.test(text)) return rule.wave;
  }
  return 'platform';
}

/**
 * Vincula itens a jornadas de negócio ou waves técnicas (in place).
 * @returns {object[]} o mesmo array de itens, anotado.
 */
function findOrphanedItems(items, { journeyContracts, meshRegistry } = {}) {
  const { journeys, journeyTokens, domains } = buildJourneyIndex(journeyContracts, meshRegistry);

  for (const item of items) {
    const tokens = itemTokens(item);
    const linkedJourneys = new Set();
    const linkedDomains = new Set();

    for (const [journey, tokensOfJourney] of journeyTokens) {
      if ([...tokensOfJourney].some((token) => tokens.has(token))) linkedJourneys.add(journey);
    }
    for (const domain of domains) {
      if (tokens.has(domain)) {
        linkedDomains.add(domain);
        for (const journey of journeys) {
          if (journey.includes(domain)) linkedJourneys.add(journey);
        }
      }
    }

    if (linkedJourneys.size > 0 || linkedDomains.size > 0) {
      item.linkStatus = 'LINKED';
      item.linkKind = 'journey';
      item.linkedJourneys = [...linkedJourneys].sort();
      item.linkedDomains = [...linkedDomains].sort();
      continue;
    }

    if (item.classification === 'DEVELOPMENT' || item.classification === 'SUPPORT' || DATA_KINDS.has(item.kind)) {
      item.linkStatus = 'LINKED';
      item.linkKind = 'technical-wave';
      item.technicalWave = assignTechnicalWave(item);
      item.linkedJourneys = [];
      continue;
    }

    item.linkStatus = 'ORPHANED';
  }

  return items;
}

/**
 * Compara dois inventários por id + fingerprint.
 * @returns {{ added: string[], removed: string[], changed: object[] }}
 */
function diffInventories(prev, next) {
  const prevItems = new Map(((prev && prev.items) || []).map((item) => [item.id, item]));
  const nextItems = new Map(((next && next.items) || []).map((item) => [item.id, item]));
  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, item] of nextItems) {
    if (!prevItems.has(id)) {
      added.push(id);
    } else if (prevItems.get(id).fingerprint !== item.fingerprint) {
      changed.push({
        id,
        beforeFingerprint: prevItems.get(id).fingerprint,
        afterFingerprint: item.fingerprint,
      });
    }
  }
  for (const id of prevItems.keys()) {
    if (!nextItems.has(id)) removed.push(id);
  }

  return { added: added.sort(), removed: removed.sort(), changed };
}

function computeCounts(items) {
  const byKind = {};
  const byClassification = {};
  let orphaned = 0;
  for (const item of items) {
    byKind[item.kind] = (byKind[item.kind] || 0) + 1;
    byClassification[item.classification] = (byClassification[item.classification] || 0) + 1;
    if (item.linkStatus === 'ORPHANED') orphaned += 1;
  }
  return { total: items.length, byKind, byClassification, orphaned };
}

/**
 * Executa os três scanners, aplica linking e fingerprints e monta o
 * documento `config/system-inventory.json`.
 *
 * @param {{ rootDir: string, journeyContractsPath?: string,
 *   meshRegistryPath?: string, now?: Date }} options
 */
function buildInventory({ rootDir, journeyContractsPath, meshRegistryPath, now } = {}) {
  if (!rootDir) throw new Error('buildInventory: rootDir é obrigatório');

  const api = scanApiRoutes({ rootDir });
  const frontend = scanFrontendRoutes({ rootDir });
  const models = scanModels({ rootDir });

  const journeyContracts = journeyContractsPath === null ? null
    : loadJsonIfExists(journeyContractsPath || path.join(rootDir, 'config', 'journey-contracts.json'));
  const meshRegistry = meshRegistryPath === null ? null
    : loadJsonIfExists(meshRegistryPath || path.join(rootDir, 'qa-mesh', 'meshRegistry.json'));

  const items = [...api.items, ...frontend.items, ...models.items];
  findOrphanedItems(items, { journeyContracts, meshRegistry });

  for (const item of items) {
    item.fingerprint = fingerprintObject(structuralFields(item));
  }
  items.sort((a, b) => a.id.localeCompare(b.id));

  return {
    version: INVENTORY_VERSION,
    generatedAt: (now || new Date()).toISOString(),
    counts: computeCounts(items),
    items,
  };
}

module.exports = {
  buildInventory,
  diffInventories,
  findOrphanedItems,
  structuralFields,
  INVENTORY_VERSION,
};
