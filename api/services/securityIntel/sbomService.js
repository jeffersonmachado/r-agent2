'use strict';

/**
 * sbomService — geração, validação e persistência do SBOM.
 *
 * O SBOM é derivado do inventário REAL (descoberta), não de uma lista escrita à
 * mão. O documento é validado estruturalmente antes de ser aceito como
 * evidência: um SBOM inválido nunca é persistido como snapshot.
 *
 * Reprodutibilidade: o snapshot é identificado pelo SHA-256 da serialização
 * canônica. Repetir a geração sobre o mesmo inventário devolve o MESMO snapshot
 * (idempotente) — o que torna o SBOM comparável entre releases.
 */

const path = require('path');

const logger = require('../../utils/logger');
const { readJson } = require('./manifestReaders');
const { discoverComponents } = require('./componentDiscoveryService');
const { createDefaultProbes } = require('./probes');
const {
  buildSbom,
  validateSbom,
  serializeSbom,
  SPEC_VERSION,
} = require('../../../engine/securityIntel/sbomBuilder');
const { sha256 } = require('../../../engine/securityIntel/componentIdentity');
const { ENGINE_VERSION } = require('./inventoryStoreService');

const TOOL = Object.freeze({
  vendor: 'Results',
  name: 'rap-version-security-intelligence',
  version: ENGINE_VERSION,
});

/** Lê nome/versão do projeto para o componente raiz do SBOM. */
function resolveRootComponent(rootDir) {
  const manifest = readJson(path.join(rootDir, 'package.json'));
  const value = manifest.ok ? manifest.value : {};
  return {
    name: value.name || path.basename(rootDir),
    version: value.version || null,
  };
}

/** Consolida arestas (mesmo ref visto em mais de um serviço) em uma entrada. */
function buildDependencyList(edges = []) {
  const byRef = new Map();
  for (const edge of edges) {
    if (!edge || !edge.from) continue;
    const current = byRef.get(edge.from) || new Set();
    for (const target of edge.targets || []) current.add(target);
    byRef.set(edge.from, current);
  }
  return [...byRef.entries()]
    .map(([ref, targets]) => ({ ref, dependsOn: [...targets].sort() }))
    .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
}

/**
 * Gera o SBOM a partir de uma descoberta (nova ou reaproveitada).
 *
 * @param {object} input
 * @param {string} input.rootDir
 * @param {string} input.now
 * @param {object} [input.probes]
 * @param {object} [input.discovery] descoberta já executada (evita recoletar)
 * @param {boolean} [input.persist]
 * @param {string} [input.tenantKey]
 */
async function generateSbom({
  rootDir,
  now,
  probes,
  discovery,
  persist = false,
  tenantKey = 'system',
  runId = null,
} = {}) {
  if (!rootDir) throw new Error('sbom_root_dir_required');
  if (!now) throw new Error('sbom_now_required');

  let effectiveDiscovery = discovery;
  if (!effectiveDiscovery) {
    effectiveDiscovery = await discoverComponents({
      rootDir,
      now,
      probes: probes || createDefaultProbes({ rootDir }),
    });
  }

  const root = resolveRootComponent(rootDir);
  const sbom = buildSbom({
    components: effectiveDiscovery.components,
    root,
    now,
    tool: TOOL,
    dependencies: buildDependencyList(effectiveDiscovery.dependencyEdges),
    properties: [
      { name: 'discoveryGeneratedAt', value: effectiveDiscovery.generatedAt },
      { name: 'coveragePercent', value: effectiveDiscovery.coverage?.coveragePercent ?? 0 },
      { name: 'sourcesRead', value: effectiveDiscovery.counts?.sourcesRead ?? 0 },
      { name: 'sourcesMissing', value: effectiveDiscovery.counts?.sourcesMissing ?? 0 },
      { name: 'unavailableProbes', value: (effectiveDiscovery.unavailable || []).length },
      { name: 'driftFindings', value: (effectiveDiscovery.drift || []).filter((entry) => entry.verdict === 'drift').length },
      { name: 'requirements', value: (effectiveDiscovery.requirements || []).length },
    ],
  });

  const validation = validateSbom(sbom);
  const serialized = serializeSbom(sbom);
  const digest = sha256(serialized);

  const result = {
    sbom,
    serialized,
    sha256: digest,
    validation,
    specVersion: SPEC_VERSION,
    componentCount: sbom.components.length,
    root,
    tenantKey,
    snapshotId: null,
    persisted: false,
  };

  if (!validation.valid) {
    logger.error('[SecurityIntel] SBOM inválido — não será persistido como evidência', {
      issues: validation.issues.slice(0, 10),
    });
    return result;
  }

  if (persist) {
    result.snapshotId = await persistSbomSnapshot({
      sbom,
      serialized,
      sha256: digest,
      validation,
      root,
      tenantKey,
      runId,
      now,
    });
    result.persisted = Boolean(result.snapshotId);
  }

  return result;
}

async function persistSbomSnapshot({
  sbom,
  serialized,
  sha256: digest,
  validation,
  root,
  tenantKey,
  runId,
  now,
}) {
  const { connect, getSequelize } = require('../../db/sequelize');
  const getSecuritySbomSnapshot = require('../../db/models/SecuritySbomSnapshot');
  if (!getSequelize()) await connect(3, 500);
  const Snapshot = getSecuritySbomSnapshot();
  const existing = await Snapshot.findOne({ where: { tenant_key: tenantKey, sha256: digest } });
  if (existing) {
    logger.info('[SecurityIntel] snapshot de SBOM idêntico já existe (idempotente)', {
      snapshotId: existing.id,
      sha256: digest,
    });
    return existing.id;
  }
  const created = await Snapshot.create({
    tenant_key: tenantKey,
    serial_number: sbom.serialNumber,
    sbom_format: sbom.bomFormat,
    spec_version: sbom.specVersion,
    sha256: digest,
    component_count: sbom.components.length,
    root_name: root.name,
    root_version: root.version,
    generated_at: new Date(now),
    run_id: runId,
    validation,
    sbom,
  });
  logger.info('[SecurityIntel] snapshot de SBOM persistido', {
    snapshotId: created.id,
    sha256: digest,
    components: sbom.components.length,
    bytes: serialized.length,
  });
  return created.id;
}

/** Último snapshot persistido (fonte para o gate de release e para a UI). */
async function getLatestSbomSnapshot({ tenantKey = 'system' } = {}) {
  const { connect, getSequelize } = require('../../db/sequelize');
  const getSecuritySbomSnapshot = require('../../db/models/SecuritySbomSnapshot');
  if (!getSequelize()) await connect(3, 500);
  const Snapshot = getSecuritySbomSnapshot();
  return Snapshot.findOne({
    where: { tenant_key: tenantKey },
    order: [['generated_at', 'DESC'], ['created_at', 'DESC']],
  });
}

/** Lista o histórico de snapshots (comparação entre releases). */
async function listSbomSnapshots({ tenantKey = 'system', limit = 20 } = {}) {
  const { connect, getSequelize } = require('../../db/sequelize');
  const getSecuritySbomSnapshot = require('../../db/models/SecuritySbomSnapshot');
  if (!getSequelize()) await connect(3, 500);
  const Snapshot = getSecuritySbomSnapshot();
  return Snapshot.findAll({
    where: { tenant_key: tenantKey },
    attributes: [
      'id', 'serial_number', 'sha256', 'component_count', 'root_name', 'root_version',
      'generated_at', 'validation', 'spec_version',
    ],
    order: [['generated_at', 'DESC'], ['created_at', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 20, 1), 100),
  });
}

module.exports = {
  TOOL,
  resolveRootComponent,
  buildDependencyList,
  generateSbom,
  persistSbomSnapshot,
  getLatestSbomSnapshot,
  listSbomSnapshots,
};
