#!/usr/bin/env node
'use strict';

/**
 * validate-vertical-registry.js (bloqueante)
 *
 * Garante que `config/verticals.json` é a fonte única de IDs de
 * verticais/domínios (HARD-009 / FASE 9):
 *
 * 1. Integridade do registry: aliases não colidem com IDs canônicos nem entre
 *    si; toda entrada tem kind/label.
 * 2. Todo ID de vertical/domínio usado nos dados/configs abaixo resolve a um
 *    ID canônico diretamente ou via alias declarado no registry:
 *    - qa/qa-waves/scenario-store.json (`vertical`, `domainSlug`)
 *    - qa-mesh/meshRegistry.json (`domain`; fallback: cenários do snapshot
 *      config/coverage-gate-baseline.json quando o registry vivo não existe
 *      no checkout, ex.: CI)
 *    - config/qa-waves-registry.json (verticalJourneys, journeyBlueprints,
 *      domainInferenceRules, journeyInferenceRules, genericFallbackDomainId,
 *      unmappedDomainId, domainAliases — chaves E valores)
 *    - config/capabilities-registry.json e config/canonical-capabilities.json
 *      (`domain` das capabilities)
 * 3. Consistência cruzada: cada entrada de `domainAliases` do
 *    qa-waves-registry aponta para um canônico do registry e a chave é alias
 *    declarado daquele canônico em config/verticals.json.
 *
 * ID não resolvível = duplicidade semântica não aliasada ou domínio não
 * registrado → exit 1. Sem afrouxamento: aliases só existem declarados.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
const VERTICALS_PATH = path.join(ROOT_DIR, 'config', 'verticals.json');
const SCENARIO_STORE_PATH = path.join(ROOT_DIR, 'qa', 'qa-waves', 'scenario-store.json');
const MESH_REGISTRY_PATH = path.join(ROOT_DIR, 'qa-mesh', 'meshRegistry.json');
const SNAPSHOT_PATH = path.join(ROOT_DIR, 'config', 'coverage-gate-baseline.json');
const QA_WAVES_REGISTRY_PATH = path.join(ROOT_DIR, 'config', 'qa-waves-registry.json');
const CAPABILITIES_REGISTRY_PATH = path.join(ROOT_DIR, 'config', 'capabilities-registry.json');
const CANONICAL_CAPABILITIES_PATH = path.join(ROOT_DIR, 'config', 'canonical-capabilities.json');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/** Monta { canonicalIds: Set, aliasToCanonical: Map } a partir do registry. */
function buildRegistryIndex(registry) {
  const domains = (registry && registry.domains) || {};
  const canonicalIds = new Set(Object.keys(domains));
  const aliasToCanonical = new Map();
  const errors = [];

  for (const [id, entry] of Object.entries(domains)) {
    if (!entry || typeof entry !== 'object') {
      errors.push(`domains.${id}: entrada inválida`);
      continue;
    }
    if (!['vertical', 'platform', 'capability'].includes(entry.kind)) {
      errors.push(`domains.${id}: kind inválido (${entry.kind || 'ausente'})`);
    }
    if (!entry.label || typeof entry.label !== 'string') {
      errors.push(`domains.${id}: label pt-BR ausente`);
    }
    for (const alias of entry.aliases || []) {
      if (canonicalIds.has(alias)) {
        errors.push(`domains.${id}: alias "${alias}" colide com ID canônico`);
      } else if (aliasToCanonical.has(alias)) {
        errors.push(`domains.${id}: alias "${alias}" já declarado em "${aliasToCanonical.get(alias)}" (duplicidade não aliasada)`);
      } else {
        aliasToCanonical.set(alias, id);
      }
    }
  }
  return { canonicalIds, aliasToCanonical, errors };
}

function createResolver(index) {
  return function resolve(id) {
    if (typeof id !== 'string' || id.length === 0) return null;
    if (index.canonicalIds.has(id)) return id;
    return index.aliasToCanonical.get(id) || null;
  };
}

/**
 * Coleta os usos de domínio/vertical de cada fonte.
 * Retorna [{ source, id, location }] — um por ocorrência de ID.
 */
function collectDomainUsages() {
  const usages = [];

  // qa/qa-waves/scenario-store.json — campo `vertical` (e domainSlug).
  const store = loadJson(SCENARIO_STORE_PATH);
  const storeScenarios = Array.isArray(store) ? store : (store.scenarios || []);
  for (const scenario of storeScenarios) {
    if (!scenario) continue;
    if (scenario.vertical) {
      usages.push({ source: 'qa/qa-waves/scenario-store.json', id: scenario.vertical, location: `scenario ${scenario.id} (vertical)` });
    }
    if (scenario.domainSlug) {
      usages.push({ source: 'qa/qa-waves/scenario-store.json', id: scenario.domainSlug, location: `scenario ${scenario.id} (domainSlug)` });
    }
  }

  // qa-mesh/meshRegistry.json (runtime, gitignored) — fallback: snapshot
  // versionado usado pelo coverage gate no CI.
  let meshScenarios = null;
  let meshSource = 'qa-mesh/meshRegistry.json';
  if (fs.existsSync(MESH_REGISTRY_PATH)) {
    const registry = loadJson(MESH_REGISTRY_PATH);
    meshScenarios = Array.isArray(registry) ? registry : (registry.scenarios || []);
  } else if (fs.existsSync(SNAPSHOT_PATH)) {
    const snapshot = loadJson(SNAPSHOT_PATH);
    meshScenarios = Array.isArray(snapshot.scenarios) ? snapshot.scenarios : [];
    meshSource = 'config/coverage-gate-baseline.json (snapshot; meshRegistry ausente)';
  }
  for (const scenario of meshScenarios || []) {
    if (scenario && scenario.domain) {
      usages.push({ source: meshSource, id: scenario.domain, location: `scenario ${scenario.id} (domain)` });
    }
  }

  // config/qa-waves-registry.json — todas as posições que carregam domain IDs.
  const waves = loadJson(QA_WAVES_REGISTRY_PATH);
  for (const vertical of Object.keys(waves.verticalJourneys || {})) {
    usages.push({ source: 'config/qa-waves-registry.json', id: vertical, location: `verticalJourneys.${vertical}` });
  }
  for (const blueprint of waves.journeyBlueprints || []) {
    if (blueprint && blueprint.id) {
      usages.push({ source: 'config/qa-waves-registry.json', id: blueprint.id, location: `journeyBlueprints.${blueprint.id}` });
    }
  }
  for (const rule of waves.domainInferenceRules || []) {
    if (rule && rule.domainId) {
      usages.push({ source: 'config/qa-waves-registry.json', id: rule.domainId, location: `domainInferenceRules.${rule.domainId}` });
    }
  }
  for (const rule of waves.journeyInferenceRules || []) {
    if (rule && rule.domainId) {
      usages.push({ source: 'config/qa-waves-registry.json', id: rule.domainId, location: `journeyInferenceRules.${rule.domainId}` });
    }
  }
  for (const key of ['genericFallbackDomainId', 'unmappedDomainId']) {
    if (waves[key]) {
      usages.push({ source: 'config/qa-waves-registry.json', id: waves[key], location: key });
    }
  }
  // domainAliases: valores devem ser canônicos; chaves são aliases legados.
  for (const [alias, target] of Object.entries(waves.domainAliases || {})) {
    usages.push({ source: 'config/qa-waves-registry.json', id: target, location: `domainAliases["${alias}"] (valor)` });
    usages.push({ source: 'config/qa-waves-registry.json', id: alias, location: `domainAliases["${alias}"] (chave)` });
  }

  // config/capabilities-registry.json — domain por capability.
  const capsRegistry = loadJson(CAPABILITIES_REGISTRY_PATH);
  const caps = Array.isArray(capsRegistry.capabilities)
    ? capsRegistry.capabilities
    : Object.values(capsRegistry.capabilities || {});
  for (const cap of caps) {
    if (cap && cap.domain) {
      usages.push({ source: 'config/capabilities-registry.json', id: cap.domain, location: `capability ${cap.id || cap.name || '?'} (domain)` });
    }
  }

  // config/canonical-capabilities.json — domain por capability (negócio + técnica).
  const canonical = loadJson(CANONICAL_CAPABILITIES_PATH);
  for (const group of ['capabilities', 'technicalCapabilities']) {
    const list = Array.isArray(canonical[group])
      ? canonical[group]
      : Object.values(canonical[group] || {});
    for (const cap of list) {
      if (cap && cap.domain) {
        usages.push({ source: 'config/canonical-capabilities.json', id: cap.domain, location: `${group}.${cap.name || '?'} (domain)` });
      }
    }
  }

  return usages;
}

/**
 * Consistência cruzada: domainAliases do qa-waves-registry devem apontar para
 * canônicos do registry e a chave deve ser alias declarado daquele canônico.
 */
function crossCheckWaveAliases(index) {
  const waves = loadJson(QA_WAVES_REGISTRY_PATH);
  const errors = [];
  for (const [alias, target] of Object.entries(waves.domainAliases || {})) {
    if (!index.canonicalIds.has(target)) {
      errors.push(`domainAliases["${alias}"] → "${target}" não é ID canônico em config/verticals.json`);
      continue;
    }
    if (index.aliasToCanonical.get(alias) !== target) {
      errors.push(`domainAliases["${alias}"] → "${target}" diverge de config/verticals.json (alias de "${index.aliasToCanonical.get(alias) || 'nenhum'}")`);
    }
  }
  return errors;
}

function main() {
  const registry = loadJson(VERTICALS_PATH);
  const index = buildRegistryIndex(registry);
  const resolve = createResolver(index);

  const violations = [...index.errors];
  violations.push(...crossCheckWaveAliases(index));

  const usages = collectDomainUsages();
  const unresolved = new Map();
  for (const usage of usages) {
    if (!resolve(usage.id)) {
      const key = `${usage.source} :: ${usage.id}`;
      if (!unresolved.has(key)) unresolved.set(key, []);
      unresolved.get(key).push(usage.location);
    }
  }
  for (const [key, locations] of unresolved) {
    violations.push(`${key} não resolve a ID canônico nem alias declarado (${locations.length}x, ex.: ${locations[0]})`);
  }

  const usedCanonical = new Set([...usages.map((u) => resolve(u.id)).filter(Boolean)]);

  if (violations.length > 0) {
    console.error(`[vertical-registry] FAIL — ${violations.length} violação(ões):`);
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exit(1);
  }

  const verticals = Object.entries(registry.domains).filter(([, e]) => e.kind === 'vertical');
  console.log(`[vertical-registry] OK — ${Object.keys(registry.domains).length} domínios canônicos `
    + `(${verticals.length} verticais), ${index.aliasToCanonical.size} aliases declarados, `
    + `${usages.length} usos verificados, ${usedCanonical.size} canônicos em uso.`);
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { buildRegistryIndex, createResolver, collectDomainUsages, crossCheckWaveAliases };
