/**
 * Serviço de motivos de encerramento (DB-only) com cache.
 */

'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { CloseReason: CloseReasonGetter } = require('../db/models');

/** @type {Map<string, any>} */
const reasons = new Map(); // id -> reason

function dbAvailable() {
  return !!getSequelize();
}

function newId() {
  return `cr-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function fromDbRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_key,
    name: row.name,
    active: row.active !== false,
    createdBy: row.created_by || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : (row.createdAt?.toISOString?.() || null),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : (row.updatedAt?.toISOString?.() || null),
  };
}

async function seedDefaultsIfEmpty() {
  const defaults = [
    { id: 'cr-001', name: 'Resolvido' },
    { id: 'cr-002', name: 'Dúvida sanada' },
    { id: 'cr-003', name: 'Sem resposta do cliente' },
    { id: 'cr-004', name: 'Encaminhado para outro canal' },
  ];

  for (const d of defaults) {
    const item = {
      id: d.id,
      tenantId: 'tenant-demo',
      name: d.name,
      active: true,
      createdBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    reasons.set(item.id, item);
    // best-effort persist
    persistBestEffort(item);
  }
}

async function initialize() {
  if (!dbAvailable()) return;
  try {
    const Model = typeof CloseReasonGetter === 'function' ? CloseReasonGetter() : CloseReasonGetter;
    const rows = await Model.findAll();
    reasons.clear();
    for (const row of rows) {
      const r = fromDbRow(row);
      reasons.set(r.id, r);
    }
    if (reasons.size === 0) {
      await seedDefaultsIfEmpty();
      logger.info('[CloseReasons] Nenhum motivo encontrado. Defaults criados.', { count: reasons.size });
    } else {
      logger.info('[CloseReasons] Cache inicializado do PostgreSQL', { count: reasons.size });
    }
  } catch (err) {
    logger.warn('[CloseReasons] Falha ao inicializar cache do PostgreSQL', { error: err.message });
  }
}

function listCloseReasons(filters = {}) {
  let list = Array.from(reasons.values());
  if (filters.tenantId) list = list.filter(r => r.tenantId === filters.tenantId);
  if (filters.activeOnly !== false) list = list.filter(r => r.active !== false);
  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function getCloseReason(id) {
  return reasons.get(id) || null;
}

async function persistBestEffort(reason) {
  if (!dbAvailable()) return;
  const Model = typeof CloseReasonGetter === 'function' ? CloseReasonGetter() : CloseReasonGetter;
  const now = new Date();
  setImmediate(() => {
    Model.findByPk(reason.id).then((existing) => {
      if (existing) {
        return existing.update({
          tenant_key: reason.tenantId,
          name: reason.name,
          active: reason.active !== false,
          created_by: reason.createdBy || null,
          updated_at: now,
        });
      }
      return Model.create({
        id: reason.id,
        tenant_key: reason.tenantId,
        name: reason.name,
        active: reason.active !== false,
        created_by: reason.createdBy || null,
        created_at: now,
        updated_at: now,
      });
    }).catch(() => {});
  });
}

async function createCloseReason({ tenantId, name, createdBy = null }) {
  if (!tenantId) return { success: false, error: 'tenantId é obrigatório' };
  if (!name || !String(name).trim()) return { success: false, error: 'name é obrigatório' };

  const id = newId();
  const now = new Date().toISOString();
  const reason = {
    id,
    tenantId,
    name: String(name).trim(),
    active: true,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
  reasons.set(id, reason);
  await persistBestEffort(reason);
  return { success: true, reason };
}

module.exports = {
  initialize,
  listCloseReasons,
  getCloseReason,
  createCloseReason,
};

