'use strict';

/**
 * inventoryStoreService — persistência do inventário de componentes.
 *
 * O Postgres é a fonte AUTORITATIVA (não há fallback em memória: falha de
 * persistência vira erro explícito `persistence_required`, conforme a regra da
 * plataforma). JSON/artefato é apenas export/evidência.
 *
 * Eficiência: a gravação é feita em LOTE (partição criar/atualizar + 1
 * re-leitura), não componente a componente — o inventário real tem ~1700 itens
 * e uma gravação por linha seria lenta e frágil sob concorrência.
 *
 * Idempotência: o `idempotency_key` da execução é derivado do CONTEÚDO da
 * descoberta (fingerprints + fontes + indisponibilidades), de modo que repetir
 * a coleta do mesmo estado não cria uma execução nova nem infla o histórico.
 */

const crypto = require('crypto');
const { Op } = require('sequelize');

const logger = require('../../utils/logger');
const { connect, getSequelize } = require('../../db/sequelize');
const getSecurityComponent = require('../../db/models/SecurityComponent');
const getSecurityComponentVersion = require('../../db/models/SecurityComponentVersion');
const getSecurityDiscoveryRun = require('../../db/models/SecurityDiscoveryRun');
const { sha256 } = require('../../../engine/securityIntel/componentIdentity');

const ENGINE_VERSION = '1.0.0';
const UPSERT_CHUNK_SIZE = 500;

async function ensureConnected() {
  if (getSequelize()) return getSequelize();
  try {
    return await connect(3, 500);
  } catch (error) {
    const wrapped = new Error(`persistence_required:${error.message}`);
    wrapped.code = 'persistence_required';
    wrapped.cause = error;
    throw wrapped;
  }
}

function requireSequelize() {
  const sequelize = getSequelize();
  if (!sequelize) {
    const error = new Error('persistence_required');
    error.code = 'persistence_required';
    throw error;
  }
  return sequelize;
}

/** Chave idempotente derivada do conteúdo do inventário (não do relógio). */
function computeDiscoveryIdempotencyKey(discovery) {
  const content = JSON.stringify({
    components: discovery.components.map((component) => `${component.bomRef}|${component.fingerprint}`).sort(),
    requirements: discovery.requirements
      .map((requirement) => `${requirement.ecosystem}:${requirement.name}${requirement.range}`)
      .sort(),
    unavailable: discovery.unavailable.map((entry) => `${entry.source}:${entry.reason}`).sort(),
    drift: discovery.drift.map((entry) => `${entry.kind}:${entry.key}:${entry.verdict}`).sort(),
    sources: discovery.sources.map((source) => `${source.id}:${source.status}:${source.itemCount}`).sort(),
  });
  return `discovery:${sha256(content)}`;
}

function componentRowFrom(component, { tenantKey, runId }) {
  return {
    tenant_key: tenantKey,
    bom_ref: component.bomRef,
    ecosystem: component.ecosystem,
    name: component.name,
    namespace: component.namespace || null,
    version: component.version || null,
    version_class: component.versionClass || 'RESOLVED',
    purl: component.purl || null,
    kind: component.kind || null,
    service: component.service || null,
    source: component.source || null,
    sources: component.sources || (component.source ? [component.source] : []),
    install_path: component.installPath || null,
    direct: component.direct === undefined ? null : component.direct,
    dev: component.dev === undefined ? null : component.dev,
    optional: component.optional === undefined ? null : component.optional,
    built_locally: component.builtLocally === undefined ? null : component.builtLocally,
    pinned_by_digest: component.pinnedByDigest === undefined ? null : component.pinnedByDigest,
    fingerprint: component.fingerprint,
    integrity: component.integrity || null,
    license_name: component.licenseName || null,
    metadata: {
      evidenceOrigin: component.evidenceOrigin || null,
      declaredVersion: component.declaredVersion || null,
      imageReference: component.imageReference || null,
      imageTag: component.imageTag || null,
      imageDigest: component.imageDigest || null,
      resolvedFrom: component.resolvedFrom || null,
      extras: component.extras || null,
      environmentMarker: component.environmentMarker || null,
    },
    last_seen_at: new Date(),
    last_run_id: runId,
  };
}

async function chunkedBulkCreate(model, rows, options) {
  let created = 0;
  for (let index = 0; index < rows.length; index += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + UPSERT_CHUNK_SIZE);
    await model.bulkCreate(chunk, options);
    created += chunk.length;
  }
  return created;
}

/**
 * Persiste uma execução de descoberta + componentes + observações de versão.
 *
 * @param {object} input
 * @param {object} input.discovery       resultado de `discoverComponents`
 * @param {string} [input.tenantKey]
 * @param {string} [input.actor]
 * @param {number} [input.durationMs]
 * @returns {Promise<{runId:string, components:number, versionsAppended:number, idempotent:boolean}>}
 */
async function persistDiscovery({
  discovery,
  tenantKey = 'system',
  actor = null,
  durationMs = null,
  engineVersion = ENGINE_VERSION,
} = {}) {
  if (!discovery || !Array.isArray(discovery.components)) {
    throw new Error('security_intel_discovery_required');
  }
  await ensureConnected();
  requireSequelize();

  const Component = getSecurityComponent();
  const ComponentVersion = getSecurityComponentVersion();
  const DiscoveryRun = getSecurityDiscoveryRun();

  const idempotencyKey = computeDiscoveryIdempotencyKey(discovery);
  const existingRun = await DiscoveryRun.findOne({ where: { idempotency_key: idempotencyKey } });
  if (existingRun) {
    logger.info('[SecurityIntel] descoberta idempotente reutilizada', {
      runId: existingRun.id,
      components: discovery.components.length,
    });
    return {
      runId: existingRun.id,
      components: discovery.components.length,
      versionsAppended: 0,
      idempotent: true,
    };
  }

  const runId = crypto.randomUUID();

  // ── Componentes: 1 leitura + 1 upsert em lote ────────────────────────────
  const existing = await Component.findAll({
    where: { tenant_key: tenantKey },
    attributes: ['id', 'bom_ref', 'fingerprint'],
    raw: true,
  });
  const existingByRef = new Map(existing.map((row) => [row.bom_ref, row]));

  const newRows = [];
  const updateRows = [];
  for (const component of discovery.components) {
    const row = componentRowFrom(component, { tenantKey, runId });
    const current = existingByRef.get(row.bom_ref);
    if (!current) {
      newRows.push(row);
      continue;
    }
    if (current.fingerprint !== row.fingerprint) {
      updateRows.push({ ...row, updated_at: new Date() });
    } else {
      // Mesmo conteúdo: só marca "visto agora" (não infla histórico).
      updateRows.push({ ...row, first_seen_at: undefined, updated_at: new Date() });
    }
  }
  if (newRows.length > 0) {
    await chunkedBulkCreate(Component, newRows, { returning: false });
  }
  if (updateRows.length > 0) {
    await chunkedBulkCreate(Component, updateRows, {
      updateOnDuplicate: [
        'version', 'version_class', 'fingerprint', 'purl', 'service', 'source', 'sources',
        'install_path', 'direct', 'dev', 'optional', 'built_locally', 'pinned_by_digest',
        'integrity', 'license_name', 'metadata', 'last_seen_at', 'last_run_id',
      ],
    });
  }

  const persisted = await Component.findAll({
    where: { tenant_key: tenantKey },
    attributes: ['id', 'bom_ref'],
    raw: true,
  });
  const idByRef = new Map(persisted.map((row) => [row.bom_ref, row.id]));

  // ── Observações de versão (append-only, idempotente por fingerprint) ─────
  const componentIds = [...idByRef.values()];
  const existingObservations = componentIds.length === 0 ? [] : await ComponentVersion.findAll({
    where: { component_id: { [Op.in]: componentIds } },
    attributes: ['component_id', 'version', 'version_class', 'fingerprint'],
    raw: true,
  });
  const observationKey = (componentId, version, versionClass, fingerprint) =>
    `${componentId}|${version}|${versionClass}|${fingerprint}`;
  const knownObservations = new Set(
    existingObservations.map((row) => observationKey(row.component_id, row.version, row.version_class, row.fingerprint))
  );

  const driftByRef = new Map();
  for (const entry of discovery.drift || []) {
    if (entry.verdict !== 'drift') continue;
    if (!driftByRef.has(entry.key)) driftByRef.set(entry.key, []);
    driftByRef.get(entry.key).push(entry);
  }

  const versionRows = [];
  for (const component of discovery.components) {
    const componentId = idByRef.get(component.bomRef);
    if (!componentId) continue;
    const key = observationKey(componentId, component.version || null, component.versionClass, component.fingerprint);
    if (knownObservations.has(key)) continue;
    knownObservations.add(key);
    const logicalKey = `${component.ecosystem}:${component.name}`;
    versionRows.push({
      tenant_key: tenantKey,
      component_id: componentId,
      bom_ref: component.bomRef,
      version: component.version || null,
      version_class: component.versionClass,
      source: component.source || null,
      evidence_origin: component.evidenceOrigin || null,
      integrity: component.integrity || null,
      fingerprint: component.fingerprint,
      observed_at: new Date(),
      run_id: runId,
      drift: driftByRef.get(logicalKey) || null,
    });
  }
  if (versionRows.length > 0) {
    await chunkedBulkCreate(ComponentVersion, versionRows, { ignoreDuplicates: true });
  }

  // ── Execução da descoberta ───────────────────────────────────────────────
  await DiscoveryRun.create({
    id: runId,
    tenant_key: tenantKey,
    status: (discovery.identityConflicts || []).length > 0 ? 'DEGRADED' : 'PASS',
    started_at: discovery.generatedAt ? new Date(discovery.generatedAt) : new Date(),
    finished_at: new Date(),
    duration_ms: durationMs,
    counts: discovery.counts || {},
    coverage: discovery.coverage || {},
    sources: discovery.sources || [],
    unavailable: discovery.unavailable || [],
    drift: discovery.drift || [],
    warnings: discovery.warnings || [],
    identity_conflicts: discovery.identityConflicts || [],
    engine_version: engineVersion,
    actor,
    idempotency_key: idempotencyKey,
  });

  logger.info('[SecurityIntel] descoberta persistida', {
    runId,
    components: discovery.components.length,
    versionsAppended: versionRows.length,
  });

  return {
    runId,
    components: discovery.components.length,
    versionsAppended: versionRows.length,
    idempotent: false,
  };
}

/** Consulta o inventário corrente com filtros. */
async function getInventory({
  tenantKey = 'system',
  service,
  ecosystem,
  versionClass,
  search,
  limit = 100,
  offset = 0,
} = {}) {
  await ensureConnected();
  requireSequelize();
  const Component = getSecurityComponent();
  const where = { tenant_key: tenantKey };
  if (service) where.service = service;
  if (ecosystem) where.ecosystem = ecosystem;
  if (versionClass) where.version_class = versionClass;
  if (search) where.name = { [Op.iLike]: `%${String(search).slice(0, 120)}%` };
  const boundedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);

  const { rows, count } = await Component.findAndCountAll({
    where,
    order: [['service', 'ASC'], ['name', 'ASC'], ['version', 'ASC']],
    limit: boundedLimit,
    offset: Math.max(Number(offset) || 0, 0),
  });
  return { total: count, limit: boundedLimit, offset: Math.max(Number(offset) || 0, 0), items: rows };
}

/** Resumo agregado do inventário (contadores por classe/ecossistema/serviço). */
async function getInventorySummary({ tenantKey = 'system' } = {}) {
  await ensureConnected();
  requireSequelize();
  const Component = getSecurityComponent();
  const sequelize = requireSequelize();

  const [byVersionClass, byEcosystem, byService, totals] = await Promise.all([
    Component.findAll({
      where: { tenant_key: tenantKey },
      attributes: ['version_class', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['version_class'],
      raw: true,
    }),
    Component.findAll({
      where: { tenant_key: tenantKey },
      attributes: ['ecosystem', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['ecosystem'],
      raw: true,
    }),
    Component.findAll({
      where: { tenant_key: tenantKey },
      attributes: ['service', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['service'],
      raw: true,
    }),
    Component.count({ where: { tenant_key: tenantKey } }),
  ]);

  return {
    tenantKey,
    total: totals,
    byVersionClass: Object.fromEntries(byVersionClass.map((row) => [row.version_class, Number(row.count)])),
    byEcosystem: Object.fromEntries(byEcosystem.map((row) => [row.ecosystem, Number(row.count)])),
    byService: Object.fromEntries(byService.map((row) => [row.service || 'unknown', Number(row.count)])),
  };
}

/** Última execução de descoberta (a base da "idade da informação"). */
async function getLatestDiscoveryRun({ tenantKey = 'system' } = {}) {
  await ensureConnected();
  requireSequelize();
  const DiscoveryRun = getSecurityDiscoveryRun();
  return DiscoveryRun.findOne({
    where: { tenant_key: tenantKey },
    order: [['started_at', 'DESC'], ['created_at', 'DESC']],
  });
}

/** Histórico de versões de um componente (linha do tempo do que foi observado). */
async function getComponentVersions({ bomRef, tenantKey = 'system', limit = 50 } = {}) {
  if (!bomRef) throw new Error('security_intel_bom_ref_required');
  await ensureConnected();
  requireSequelize();
  const ComponentVersion = getSecurityComponentVersion();
  return ComponentVersion.findAll({
    where: { tenant_key: tenantKey, bom_ref: bomRef },
    order: [['observed_at', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
  });
}

module.exports = {
  ENGINE_VERSION,
  computeDiscoveryIdempotencyKey,
  persistDiscovery,
  getInventory,
  getInventorySummary,
  getLatestDiscoveryRun,
  getComponentVersions,
};
