'use strict';

const fs = require('fs');
const path = require('path');

const backendCapabilityScanner = require('./scanners/backendCapabilityScanner');
const frontendCapabilityScanner = require('./scanners/frontendCapabilityScanner');
const replayCapabilityScanner = require('./scanners/replayCapabilityScanner');
const e2eCapabilityScanner = require('./scanners/e2eCapabilityScanner');
const deviceCapabilityScanner = require('./scanners/deviceCapabilityScanner');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const CAPABILITIES_REGISTRY_PATH = path.join(ROOT_DIR, 'config', 'capabilities-registry.json');
const CAPABILITY_DEPENDENCIES_PATH = path.join(ROOT_DIR, 'config', 'capability-dependencies.json');

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJsonSafe(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function inferDomainFromCapability(capabilityId, evidence = []) {
  const text = `${capabilityId} ${evidence.join(' ')}`.toLowerCase();
  if (/fitness|checkin|turnstile|catraca|membership|attendance/.test(text)) return 'fitness';
  if (/support|ticket|atendimento/.test(text)) return 'support';
  if (/beauty|schedule|bundle/.test(text)) return 'beauty';
  if (/crm|lead|contact/.test(text)) return 'crm';
  return 'core';
}

function inferModuleFromEvidence(evidence = []) {
  const first = evidence[0] || '';
  if (!first) return 'unknown';
  const normalized = String(first).replace(/\\/g, '/');
  if (normalized.startsWith('api/modules/')) {
    return normalized.split('/')[2] || 'api-module';
  }
  if (normalized.startsWith('frontend/src/pages/')) {
    return normalized.split('/')[3] || 'frontend-page';
  }
  if (normalized.startsWith('frontend/src/components/')) {
    return normalized.split('/')[3] || 'frontend-component';
  }
  return normalized.split('/')[0] || 'unknown';
}

function toCapabilityRecord(capabilityId, candidates = []) {
  const best = candidates.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0] || { confidence: 0, evidence: [] };
  const mergedEvidence = Array.from(new Set(candidates.flatMap((item) => item.evidence || []))).slice(0, 20);
  const mergedTags = Array.from(new Set(
    [capabilityId]
      .concat(mergedEvidence.map((item) => path.basename(item).replace(/\.[^.]+$/, '')))
      .flatMap((item) => String(item).split(/[^a-zA-Z0-9]+/g))
      .filter(Boolean)
      .map((item) => item.toLowerCase())
  )).slice(0, 15);

  return {
    id: capabilityId,
    domain: inferDomainFromCapability(capabilityId, mergedEvidence),
    module: inferModuleFromEvidence(mergedEvidence),
    type: 'operational',
    required: true,
    tags: mergedTags,
    confidence: Number((best.confidence || 0).toFixed(2)),
    sources: Array.from(new Set(candidates.map((item) => item.source))).sort(),
    evidence: mergedEvidence,
  };
}

function mergeInferredCapabilities(scanResults) {
  const grouped = new Map();

  for (const result of scanResults) {
    for (const capability of result.inferredCapabilities || []) {
      const id = capability.id;
      if (!id) continue;
      const list = grouped.get(id) || [];
      list.push(capability);
      grouped.set(id, list);
    }
  }

  return Array.from(grouped.entries())
    .map(([capabilityId, candidates]) => toCapabilityRecord(capabilityId, candidates))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function mergeWithExistingRegistry(capabilities) {
  const existing = readJsonSafe(CAPABILITIES_REGISTRY_PATH, { capabilities: [] });
  const byId = new Map();

  for (const item of existing.capabilities || []) {
    if (!item?.id) continue;
    byId.set(item.id, {
      ...item,
      sources: Array.isArray(item.sources) ? item.sources : [],
      evidence: Array.isArray(item.evidence) ? item.evidence : [],
    });
  }

  for (const inferred of capabilities) {
    const prev = byId.get(inferred.id);
    if (!prev) {
      byId.set(inferred.id, inferred);
      continue;
    }

    byId.set(inferred.id, {
      ...prev,
      ...inferred,
      tags: Array.from(new Set([...(prev.tags || []), ...(inferred.tags || [])])),
      sources: Array.from(new Set([...(prev.sources || []), ...(inferred.sources || [])])),
      // Keep latest scan evidence authoritative to avoid carrying stale noise.
      evidence: Array.from(new Set([...(inferred.evidence || [])])).slice(0, 30),
      confidence: Math.max(Number(prev.confidence || 0), Number(inferred.confidence || 0)),
    });
  }

  return Array.from(byId.values()).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

// Dependencias vem do contrato mantido em config/capability-dependencies.json
// (fonte de verdade). A inferencia heuristica anterior (mapa estatico +
// substring de tags) foi removida: capability sem entrada no contrato fica
// com dependsOn vazio em vez de receber dependencias inventadas.
function inferDependencies(capabilities, options = {}) {
  const registryPath = options.registryPath || CAPABILITY_DEPENDENCIES_PATH;
  const registry = readJsonSafe(registryPath, { dependencies: {} });
  const registryDeps = registry && typeof registry.dependencies === 'object'
    ? registry.dependencies
    : {};

  const dependencies = {};
  for (const capability of capabilities) {
    const entry = registryDeps[capability.id];
    const dependsOn = Array.isArray(entry?.dependsOn)
      ? Array.from(new Set(entry.dependsOn.filter(Boolean).filter((id) => id !== capability.id)))
      : [];
    dependencies[capability.id] = { dependsOn };
  }
  return dependencies;
}

function buildOperationalGraph(capabilities, dependencies) {
  const nodes = capabilities.map((capability) => ({
    id: capability.id,
    domain: capability.domain,
    module: capability.module,
    required: capability.required !== false,
  }));

  const edges = [];
  for (const [capabilityId, depConfig] of Object.entries(dependencies)) {
    for (const dep of depConfig.dependsOn || []) {
      edges.push({ from: dep, to: capabilityId, type: 'depends_on' });
    }
  }

  return { nodes, edges };
}

function discoverSystem(options = {}) {
  const rootDir = options.rootDir || ROOT_DIR;
  const persist = options.persist !== false;

  const backend = backendCapabilityScanner.scan({ rootDir });
  const frontend = frontendCapabilityScanner.scan({ rootDir });
  const replay = replayCapabilityScanner.scan({
    rootDir,
    replayFreshnessDays: Number(options.replayFreshnessDays || 7),
  });
  const e2e = e2eCapabilityScanner.scan({ rootDir });
  const device = deviceCapabilityScanner.scan({ rootDir });

  const inferredCapabilities = mergeInferredCapabilities([backend, frontend, replay, e2e]);
  const capabilities = mergeWithExistingRegistry(inferredCapabilities);
  const dependencyGraph = inferDependencies(capabilities);
  const operationalGraph = buildOperationalGraph(capabilities, dependencyGraph);

  const discovery = {
    generatedAt: nowIso(),
    backend,
    frontend,
    devices: device.devices,
    omnichannel: device.channels,
    replay,
    e2e,
    capabilityGraph: operationalGraph,
  };

  if (persist) {
    writeJsonSafe(CAPABILITIES_REGISTRY_PATH, {
      version: 1,
      generatedAt: discovery.generatedAt,
      capabilities,
    });
    writeJsonSafe(CAPABILITY_DEPENDENCIES_PATH, {
      version: 1,
      generatedAt: discovery.generatedAt,
      dependencies: dependencyGraph,
    });
  }

  return {
    discovery,
    capabilities,
    dependencyGraph,
    operationalGraph,
  };
}

module.exports = {
  discoverSystem,
  inferDependencies,
  buildOperationalGraph,
};
