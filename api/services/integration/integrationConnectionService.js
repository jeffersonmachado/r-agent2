'use strict';

/**
 * IntegrationConnectionService — ciclo de vida da conexão tenant ↔ provider.
 *
 * Garantias de segurança:
 * - credencial SEMPRE cifrada em repouso (`api/utils/crypto`, AES-256-GCM);
 * - credencial NUNCA devolvida por API: `toPublicConnection` remove o campo
 *   cifrado e expõe apenas `credential_hint` (fingerprint sha256 não reversível);
 * - `getDecryptedCredentials` é interno (sync/webhook), nunca rota;
 * - resolução de tenant por `opaque_key` server-side (webhook nunca confia em
 *   tenant vindo do payload/query);
 * - erros e logs passam por sanitização.
 */

const crypto = require('crypto');
const { getSequelize } = require('../../db/sequelize');
const { IntegrationConnection } = require('../../db/models');
const { encrypt, decrypt } = require('../../utils/crypto');
const logger = require('../../utils/logger');
const { IntegrationError, INTEGRATION_ERROR_CODES, sanitizeError } = require('./integrationRedaction');
const { getProvider, hasProvider } = require('./integrationRegistry');
const {
  makeId, dbAvailable, isUniqueViolation, sha256Hex, optionalString,
} = require('./integrationDb');

const CONNECTION_STATUS = Object.freeze({
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
});

/** Campos de `config` aceitos (não secretos). Nada mais é persistido. */
const ALLOWED_CONFIG_KEYS = Object.freeze([
  'baseUrl',
  'unitLabel',
  'timezone',
  'overlapSeconds',
  'pageSize',
  'syncEnabled',
  // Modo laboratório explícito: permite chamar host não certificado. Fica
  // registrado na conexão e é auditável (nunca ligado por padrão).
  'allowUnverifiedEndpoints',
]);

function requireDb() {
  if (!dbAvailable()) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.DB_UNAVAILABLE, 'banco indisponível para integração');
  }
}

function requireTenant(tenantId) {
  if (!tenantId || String(tenantId).trim() === '') {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.TENANT_REQUIRED, 'tenantId é obrigatório');
  }
  return String(tenantId);
}

function normalizeConfig(config) {
  const out = {};
  for (const key of ALLOWED_CONFIG_KEYS) {
    if (config && config[key] !== undefined && config[key] !== null) out[key] = config[key];
  }
  return out;
}

/** Fingerprint não reversível das credenciais (para diagnóstico sem vazar segredo). */
function buildCredentialHint(credentials) {
  return sha256Hex(JSON.stringify(credentials || {})).slice(0, 16);
}

/** Gera a chave pública opaca da conexão (URL de webhook). */
function generateOpaqueKey() {
  return crypto.randomBytes(24).toString('base64url');
}

/** Projeção pública: nunca contém `credentials_encrypted`. */
function toPublicConnection(row) {
  if (!row) return null;
  const plain = row.toJSON ? row.toJSON() : row;
  const {
    credentials_encrypted: _omit, // eslint-disable-line camelcase
    ...rest
  } = plain;
  return {
    ...rest,
    hasCredentials: Boolean(plain.credentials_encrypted),
    connected: plain.status === CONNECTION_STATUS.CONNECTED,
  };
}

async function createConnection({
  tenantId,
  provider,
  label = null,
  externalUnitId = null,
  unitLabel = null,
  config = {},
  credentials = null,
  status = CONNECTION_STATUS.DISCONNECTED,
  metadata = {},
} = {}) {
  const tenant = requireTenant(tenantId);
  requireDb();
  const providerId = String(provider || '').trim().toLowerCase();
  if (!hasProvider(providerId)) {
    getProvider(providerId); // lança integration_provider_unknown com a lista disponível
  }
  if (credentials) {
    const adapter = getProvider(providerId);
    // A validação usa a MESMA config de conexão (baseUrl) que será persistida:
    // sem isso o provider cairia no baseUrl default do contrato.
    const validation = await adapter.validateConnection({ credentials, connection: { config: normalizeConfig(config) } });
    if (!validation || validation.ok !== true) {
      throw new IntegrationError(
        INTEGRATION_ERROR_CODES.CREDENTIALS_INVALID,
        'credenciais rejeitadas pelo provider',
        { providerId, detail: validation && validation.detail ? validation.detail : null },
      );
    }
  }

  const Model = IntegrationConnection();
  const id = makeId('iconn');
  const payload = {
    id,
    tenant_key: tenant,
    provider: providerId,
    label: optionalString(label, 160),
    external_unit_id: optionalString(externalUnitId, 160),
    unit_label: optionalString(unitLabel, 160),
    opaque_key: generateOpaqueKey(),
    status,
    config: normalizeConfig(config),
    credentials_encrypted: credentials ? encrypt(JSON.stringify(credentials)) : null,
    credential_hint: credentials ? buildCredentialHint(credentials) : null,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  };

  try {
    const row = await Model.create(payload);
    return toPublicConnection(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await Model.findOne({ where: { tenant_key: tenant, provider: providerId } });
      if (existing) return toPublicConnection(existing);
    }
    throw error;
  }
}

async function listConnections({ tenantId, provider = null } = {}) {
  const tenant = requireTenant(tenantId);
  if (!dbAvailable()) return { items: [], total: 0 };
  const where = { tenant_key: tenant };
  if (provider) where.provider = String(provider).trim().toLowerCase();
  const rows = await IntegrationConnection().findAll({ where, order: [['created_at', 'DESC']] });
  const items = rows.map(toPublicConnection);
  return { items, total: items.length };
}

async function getConnectionRow({ tenantId, connectionId = null, provider = null } = {}) {
  const tenant = requireTenant(tenantId);
  if (!dbAvailable()) return null;
  const where = { tenant_key: tenant };
  if (connectionId) where.id = String(connectionId);
  if (provider) where.provider = String(provider).trim().toLowerCase();
  return IntegrationConnection().findOne({ where, order: [['created_at', 'DESC']] });
}

async function getConnection(params = {}) {
  const row = await getConnectionRow(params);
  return toPublicConnection(row);
}

/** Resolve a conexão pelo `opaque_key` — ÚNICA forma segura de rotear webhook. */
async function getConnectionByOpaqueKey(opaqueKey) {
  const key = optionalString(opaqueKey, 64);
  if (!key) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.OPAQUE_KEY_REQUIRED, 'opaque connection key é obrigatória');
  }
  if (!dbAvailable()) return null;
  return IntegrationConnection().findOne({ where: { opaque_key: key } });
}

/**
 * Credenciais em claro — uso INTERNO (sync/webhook). Nunca exposta por rota.
 * @returns {object} credenciais do provider
 */
async function getDecryptedCredentials({ tenantId, connectionId }) {
  const row = await getConnectionRow({ tenantId, connectionId });
  if (!row) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.CONNECTION_NOT_FOUND, 'conexão não encontrada', { connectionId });
  }
  const plain = row.toJSON ? row.toJSON() : row;
  if (!plain.credentials_encrypted) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.CREDENTIALS_MISSING, 'conexão sem credenciais', { connectionId });
  }
  try {
    return JSON.parse(decrypt(plain.credentials_encrypted));
  } catch (error) {
    throw new IntegrationError(
      INTEGRATION_ERROR_CODES.CREDENTIALS_INVALID,
      'credenciais ilegíveis (chave de criptografia divergente ou registro corrompido)',
      { connectionId, cause: sanitizeError(error).code },
    );
  }
}

async function setCredentials({ tenantId, connectionId, credentials }) {
  const tenant = requireTenant(tenantId);
  requireDb();
  const row = await getConnectionRow({ tenantId: tenant, connectionId });
  if (!row) throw new IntegrationError(INTEGRATION_ERROR_CODES.CONNECTION_NOT_FOUND, 'conexão não encontrada', { connectionId });
  const adapter = getProvider(row.provider);
  const validation = await adapter.validateConnection({
    credentials,
    connection: { config: normalizeConfig(row.config) },
  });
  if (!validation || validation.ok !== true) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.CREDENTIALS_INVALID, 'credenciais rejeitadas pelo provider', {
      providerId: row.provider,
      detail: validation && validation.detail ? validation.detail : null,
    });
  }
  await row.update({
    credentials_encrypted: encrypt(JSON.stringify(credentials)),
    credential_hint: buildCredentialHint(credentials),
    status: CONNECTION_STATUS.CONNECTED,
    last_error: null,
  });
  return toPublicConnection(row);
}

async function updateConnection({ tenantId, connectionId, patch = {} }) {
  const tenant = requireTenant(tenantId);
  requireDb();
  const row = await getConnectionRow({ tenantId: tenant, connectionId });
  if (!row) throw new IntegrationError(INTEGRATION_ERROR_CODES.CONNECTION_NOT_FOUND, 'conexão não encontrada', { connectionId });

  const update = {};
  if (patch.label !== undefined) update.label = optionalString(patch.label, 160);
  if (patch.externalUnitId !== undefined) update.external_unit_id = optionalString(patch.externalUnitId, 160);
  if (patch.unitLabel !== undefined) update.unit_label = optionalString(patch.unitLabel, 160);
  if (patch.config !== undefined) update.config = normalizeConfig(patch.config);
  if (patch.status !== undefined) update.status = String(patch.status);
  if (patch.metadata !== undefined) update.metadata = patch.metadata && typeof patch.metadata === 'object' ? patch.metadata : {};

  await row.update(update);
  return toPublicConnection(row);
}

async function markConnectionStatus({ tenantId, connectionId, status, error = null, syncedAt = null }) {
  if (!dbAvailable()) return null;
  const row = await getConnectionRow({ tenantId, connectionId });
  if (!row) return null;
  const update = { status };
  if (error !== null) update.last_error = error ? String(error).slice(0, 1000) : null;
  if (syncedAt) update.last_sync_at = syncedAt;
  await row.update(update);
  return toPublicConnection(row);
}

async function disconnectConnection({ tenantId, connectionId }) {
  return markConnectionStatus({ tenantId, connectionId, status: CONNECTION_STATUS.DISCONNECTED });
}

/** Marca a conexão como saudável após uma operação bem-sucedida. */
async function markHealthy({ tenantId, connectionId, syncedAt = new Date() }) {
  return markConnectionStatus({ tenantId, connectionId, status: CONNECTION_STATUS.CONNECTED, error: '', syncedAt });
}

async function markFailed({ tenantId, connectionId, error }) {
  const sanitized = sanitizeError(error);
  logger.warn('[Integration] conexão marcada com erro', { connectionId, code: sanitized.code });
  return markConnectionStatus({ tenantId, connectionId, status: CONNECTION_STATUS.ERROR, error: sanitized.message });
}

module.exports = {
  CONNECTION_STATUS,
  ALLOWED_CONFIG_KEYS,
  createConnection,
  listConnections,
  getConnection,
  getConnectionRow,
  getConnectionByOpaqueKey,
  getDecryptedCredentials,
  setCredentials,
  updateConnection,
  disconnectConnection,
  markHealthy,
  markFailed,
  toPublicConnection,
  generateOpaqueKey,
  buildCredentialHint,
  normalizeConfig,
};
