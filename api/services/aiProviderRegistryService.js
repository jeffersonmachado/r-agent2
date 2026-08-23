'use strict';

/**
 * Registry dinâmico de providers de IA (built-ins + custom no banco).
 *
 * - Built-ins: `engine/aiProviderRegistry.js` (fonte estática e pura).
 * - Custom: tabela `ai_providers` (CRUD via interface de configuração).
 *
 * O runtime usa a MESCLA (built-ins + custom habilitados) para:
 *   - registro de providers na engine (`aiProviderService.initializeAiProviders`);
 *   - validação de credenciais (`tenantAIService` / módulos config/tenant).
 */

const { connect, getSequelize } = require('../db/sequelize');
const { AiProvider, TenantAICredential } = require('../db/models');
const { AI_PROVIDERS } = require('../../engine/aiProviderRegistry');
const logger = require('../utils/logger');

const SUPPORTED_KINDS = ['openai-sdk', 'openai-compatible', 'anthropic'];
const KEY_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;

function getModel() {
  return typeof AiProvider === 'function' ? AiProvider() : AiProvider;
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

// Cache em memória da mescla (built-ins + custom). Invalidado em create/delete.
let runtimeCache = null;
let runtimeCacheAt = 0;
const RUNTIME_CACHE_TTL_MS = 30 * 1000;

function invalidateRuntimeCache() {
  runtimeCache = null;
  runtimeCacheAt = 0;
}

function serializeProvider(row) {
  let models = [];
  try {
    const raw = row.models;
    if (Array.isArray(raw)) models = raw;
    else if (typeof raw === 'string' && raw) models = JSON.parse(raw);
  } catch {
    models = [];
  }
  return {
    id: row.key,
    key: row.key,
    label: row.label,
    kind: row.kind,
    baseUrl: row.base_url,
    defaultModel: row.default_model,
    models,
    validationModel: row.validation_model || null,
    isBuiltin: !!row.is_builtin,
    enabled: !!row.enabled,
  };
}

async function ensureConnection() {
  const sequelize = getSequelize();
  if (!sequelize) await connect();
}

/**
 * Upsert idempotente dos built-ins no banco, mantendo-os sincronizados com a
 * fonte canônica (`engine/aiProviderRegistry.js`).
 */
async function ensureBuiltinProviders() {
  try {
    await ensureConnection();
    const model = getModel();
    for (const def of Object.values(AI_PROVIDERS)) {
      const existing = await model.findOne({ where: { key: def.id } });
      const data = {
        key: def.id,
        label: def.label,
        kind: def.kind,
        base_url: def.baseUrl,
        default_model: def.defaultModel,
        models: Array.isArray(def.models) ? def.models : [],
        validation_model: def.validationModel || null,
        is_builtin: true,
        enabled: true,
      };
      if (existing) {
        await existing.update(data);
      } else {
        await model.create(data);
      }
    }
    invalidateRuntimeCache();
    logger.info(`[AiProviderRegistry] ${Object.keys(AI_PROVIDERS).length} built-ins sincronizados`);
  } catch (err) {
    // Falha aqui não deve derrubar o boot: built-ins continuam vindo do engine registry.
    logger.warn('[AiProviderRegistry] Falha ao sincronizar built-ins', { error: err.message });
  }
}

/**
 * Mescla runtime (built-ins + custom habilitados) como mapa key → def.
 * Fallback sem DB: built-ins do engine registry.
 */
async function getRuntimeProviders() {
  const now = Date.now();
  if (runtimeCache && (now - runtimeCacheAt) < RUNTIME_CACHE_TTL_MS) {
    return runtimeCache;
  }

  const map = {};
  for (const def of Object.values(AI_PROVIDERS)) {
    map[def.id] = {
      id: def.id,
      label: def.label,
      kind: def.kind,
      baseUrl: def.baseUrl,
      defaultModel: def.defaultModel,
      models: def.models || [],
      validationModel: def.validationModel || null,
      isBuiltin: true,
      enabled: true,
    };
  }

  try {
    // Leitura NÃO conecta ao banco: usa a conexão já existente (Sequelize
    // inicializado). Em testes/sem DB, cai para os built-ins do engine.
    const sequelize = getSequelize();
    if (sequelize) {
      const model = getModel();
      const rows = await model.findAll({ order: [['is_builtin', 'DESC'], ['created_at', 'ASC']] });
      for (const row of rows) {
        if (!row.enabled) continue;
        const def = serializeProvider(row);
        map[def.key] = def;
      }
    }
  } catch (err) {
    logger.warn('[AiProviderRegistry] Falha ao ler providers custom; usando built-ins', { error: err.message });
  }

  runtimeCache = map;
  runtimeCacheAt = now;
  return map;
}

async function listProviders() {
  const map = await getRuntimeProviders();
  return Object.values(map);
}

async function getProviderDef(key) {
  const map = await getRuntimeProviders();
  return map[normalizeKey(key)] || null;
}

async function isSupportedProvider(key) {
  return !!(await getProviderDef(key));
}

async function getProviderIds() {
  return Object.keys(await getRuntimeProviders());
}

function validateProviderPayload(payload) {
  const key = normalizeKey(payload && payload.key);
  const label = String((payload && payload.label) || '').trim();
  const kind = String((payload && payload.kind) || '').trim().toLowerCase();
  const baseUrl = String((payload && (payload.baseUrl || payload.base_url)) || '').trim();
  const defaultModel = String((payload && (payload.defaultModel || payload.default_model)) || '').trim();

  if (!KEY_RE.test(key)) {
    throw new Error('key inválido: use minúsculas, números, hífen ou underscore (2-64 caracteres)');
  }
  if (!label) throw new Error('label é obrigatório');
  if (!SUPPORTED_KINDS.includes(kind)) {
    throw new Error(`kind inválido. Suportados: ${SUPPORTED_KINDS.join(', ')}`);
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error('baseUrl deve começar com http:// ou https://');
  }
  if (!defaultModel) throw new Error('defaultModel é obrigatório');

  let models = [];
  if (Array.isArray(payload && payload.models)) {
    models = payload.models
      .map((m) => ({
        value: String((m && m.value) || '').trim(),
        label: String((m && (m.label || m.value)) || '').trim(),
      }))
      .filter((m) => m.value);
  }

  return {
    key,
    label,
    kind,
    base_url: baseUrl,
    default_model: defaultModel,
    models,
    validation_model: payload && payload.validationModel ? String(payload.validationModel).trim() : null,
  };
}

async function createProvider(payload) {
  const data = validateProviderPayload(payload);
  await ensureConnection();
  const model = getModel();

  const existing = await model.findOne({ where: { key: data.key } });
  if (existing) {
    throw new Error(`Provider "${data.key}" já existe`);
  }

  await model.create({ ...data, is_builtin: false, enabled: true });
  invalidateRuntimeCache();
  return getProviderDef(data.key);
}

async function deleteProvider(key) {
  const normalized = normalizeKey(key);
  await ensureConnection();
  const model = getModel();
  const row = await model.findOne({ where: { key: normalized } });
  if (!row) {
    throw new Error(`Provider "${normalized}" não encontrado`);
  }
  if (row.is_builtin) {
    const err = new Error(`Provider "${normalized}" é integrado e não pode ser removido`);
    err.code = 'BUILTIN_PROVIDER_UNDELETABLE';
    throw err;
  }

  // Remove credenciais órfãs do provider (TenantAICredential.provider = key).
  try {
    const credentialModel = typeof TenantAICredential === 'function' ? TenantAICredential() : TenantAICredential;
    if (credentialModel && typeof credentialModel.destroy === 'function') {
      await credentialModel.destroy({ where: { provider: normalized } });
    }
  } catch (err) {
    logger.warn(`[AiProviderRegistry] Falha ao limpar credenciais de ${normalized}`, { error: err.message });
  }

  await row.destroy();
  invalidateRuntimeCache();
  return { deleted: true, key: normalized };
}

module.exports = {
  ensureBuiltinProviders,
  getRuntimeProviders,
  listProviders,
  getProviderDef,
  isSupportedProvider,
  getProviderIds,
  createProvider,
  deleteProvider,
  invalidateRuntimeCache,
};
