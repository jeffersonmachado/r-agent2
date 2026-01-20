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
      // Blindagem: não cria defaults automáticos em produção (multi-tenant obrigatório)
      logger.info('[CloseReasons] Nenhum motivo encontrado. Nenhum default será criado automaticamente.', { count: 0 });
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

function getCloseReasonByName(tenantId, name) {
  if (!tenantId || !name) return null;
  const t = String(tenantId);
  const n = String(name).trim().toLowerCase();
  if (!n) return null;
  for (const r of reasons.values()) {
    if (!r) continue;
    if (r.tenantId !== t) continue;
    if (String(r.name || '').trim().toLowerCase() === n) return r;
  }
  return null;
}

async function ensureDefaultsForTenant(tenantId) {
  if (!tenantId) return;
  const t = String(tenantId);
  const existing = Array.from(reasons.values()).filter(r => r && r.tenantId === t);
  if (existing.length > 0) return;

  const defaults = [
    'Resolvido',
    'Dúvida sanada',
    'Sem resposta do cliente',
    'Encaminhado para outro canal',
    // Padrão de compatibilidade para integrações antigas (quando não vem motivo)
    'Sem motivo informado',
  ];

  for (const name of defaults) {
    // eslint-disable-next-line no-await-in-loop
    const found = getCloseReasonByName(t, name);
    if (found) continue;
    // eslint-disable-next-line no-await-in-loop
    await createCloseReason({ tenantId: t, name, createdBy: 'system' });
  }
}

async function getOrCreateCloseReasonByName({ tenantId, name, createdBy = null }) {
  if (!tenantId) return { success: false, error: 'tenantId é obrigatório' };
  if (!name || !String(name).trim()) return { success: false, error: 'name é obrigatório' };

  await ensureDefaultsForTenant(tenantId);
  const existing = getCloseReasonByName(tenantId, name);
  if (existing) return { success: true, reason: existing, created: false };

  const created = await createCloseReason({ tenantId, name, createdBy });
  if (!created.success) return created;
  return { success: true, reason: created.reason, created: true };
}

module.exports = {
  initialize,
  listCloseReasons,
  getCloseReason,
  createCloseReason,
  ensureDefaultsForTenant,
  getOrCreateCloseReasonByName,
};

