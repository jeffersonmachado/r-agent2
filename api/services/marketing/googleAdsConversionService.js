'use strict';

const crypto = require('crypto');
const { MarketingAdConversion, MarketingLead, Tenant, TenantAICredential } = require('../../db/models');
const { getSequelize } = require('../../db/sequelize');
const tenantSettingsService = require('../tenantSettingsService');
const { encrypt, decrypt } = require('../../utils/crypto');

const SETTINGS_KEY = 'google_ads';

function dbAvailable() {
  return !!getSequelize();
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function safeStr(value, fallback = '') {
  return safeToString(value, fallback).trim();
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function parsePaging({ limit = 100, offset = 0 } = {}) {
  return {
    limit: Math.min(Math.max(Number(limit) || 100, 1), 1000),
    offset: Math.max(Number(offset) || 0, 0),
  };
}

function normalizeCurrency(value) {
  const code = safeStr(value || 'BRL').toUpperCase();
  return code || 'BRL';
}

function normalizeCustomerId(value) {
  return safeStr(value).replace(/\D+/g, '');
}

function normalizeConversionTime(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const parsed = new Date(safeToString(value));
  if (Number.isNaN(parsed.getTime())) return new Date();
  return parsed;
}

function toFloatOrNull(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSettings(value) {
  const raw = safeObject(value) || {};
  return {
    enabled: raw.enabled === true,
    customerId: normalizeCustomerId(raw.customerId),
    loginCustomerId: normalizeCustomerId(raw.loginCustomerId),
    defaultConversionActionId: safeStr(raw.defaultConversionActionId),
    defaultConversionName: safeStr(raw.defaultConversionName || 'customer'),
    defaultCurrencyCode: normalizeCurrency(raw.defaultCurrencyCode || 'BRL'),
    dryRun: raw.dryRun !== false,
    autoUpload: raw.autoUpload === true,
    uploader: safeStr(raw.uploader || 'google_ads_api'),
  };
}

function normalizeSecrets(value) {
  const raw = safeObject(value) || {};
  return {
    developerToken: safeStr(raw.developerToken),
    clientId: safeStr(raw.clientId),
    clientSecret: safeStr(raw.clientSecret),
    refreshToken: safeStr(raw.refreshToken),
  };
}

function splitSettingsPayload(value) {
  const raw = safeObject(value) || {};
  const publicSettings = normalizeSettings(raw);
  const secureSettings = normalizeSecrets(raw);
  return { publicSettings, secureSettings };
}

function hasSecrets(value) {
  const secrets = normalizeSecrets(value);
  return !!(secrets.developerToken || secrets.clientId || secrets.clientSecret || secrets.refreshToken);
}

function settingsForResponse(value) {
  const normalized = normalizeSettings(value && value.publicSettings ? value.publicSettings : value);
  const secrets = normalizeSecrets(value && value.secureSettings ? value.secureSettings : {});
  return {
    ...normalized,
    hasDeveloperToken: !!secrets.developerToken,
    hasClientId: !!secrets.clientId,
    hasClientSecret: !!secrets.clientSecret,
    hasRefreshToken: !!secrets.refreshToken,
  };
}

function getFetchFn() {
  if (typeof global.fetch === 'function') return global.fetch;
  // eslint-disable-next-line global-require
  return require('node-fetch');
}

function ensureGoogleAdsSettingsReady(settings) {
  if (!settings.enabled) return { ok: false, error: 'integration_disabled' };
  if (!settings.customerId) return { ok: false, error: 'customer_id_required' };
  if (!settings.defaultConversionActionId) return { ok: false, error: 'default_conversion_action_id_required' };
  if (!settings.developerToken) return { ok: false, error: 'developer_token_required' };
  if (!settings.clientId) return { ok: false, error: 'client_id_required' };
  if (!settings.clientSecret) return { ok: false, error: 'client_secret_required' };
  if (!settings.refreshToken) return { ok: false, error: 'refresh_token_required' };
  return { ok: true };
}

function formatGoogleAdsDateTime(value) {
  const dt = normalizeConversionTime(value);
  const pad = (n) => String(n).padStart(2, '0');
  const year = dt.getFullYear();
  const month = pad(dt.getMonth() + 1);
  const day = pad(dt.getDate());
  const hours = pad(dt.getHours());
  const minutes = pad(dt.getMinutes());
  const seconds = pad(dt.getSeconds());
  const offsetMinutes = -dt.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const offsetHours = pad(Math.floor(abs / 60));
  const offsetRemainder = pad(abs % 60);
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetRemainder}`;
}

async function requestAccessToken(settings) {
  const fetchFn = getFetchFn();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
    refresh_token: settings.refreshToken,
  });

  const response = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !safeStr(payload.access_token)) {
    throw new Error(`google_oauth_failed:${response.status}:${safeStr(payload.error_description || payload.error || 'token_unavailable')}`);
  }
  return payload.access_token;
}

function buildGoogleClickConversionPayload({ settings, conversion }) {
  const conversionActionId = safeStr(conversion.conversionActionId) || settings.defaultConversionActionId;
  const payload = {
    conversionAction: `customers/${settings.customerId}/conversionActions/${conversionActionId}`,
    conversionDateTime: formatGoogleAdsDateTime(conversion.conversionTime),
    currencyCode: normalizeCurrency(conversion.currencyCode || settings.defaultCurrencyCode),
  };

  if (conversion.clickIdType === 'gclid') payload.gclid = conversion.clickId;
  if (conversion.clickIdType === 'gbraid') payload.gbraid = conversion.clickId;
  if (conversion.clickIdType === 'wbraid') payload.wbraid = conversion.clickId;
  if (conversion.conversionValue != null && conversion.conversionValue !== '') payload.conversionValue = Number(conversion.conversionValue);

  const metadata = safeObject(conversion.metadata) || {};
  const orderId = safeStr(metadata.orderId || metadata.idempotencyKey || metadata.leadId || '');
  if (orderId) payload.orderId = orderId.slice(0, 64);
  return payload;
}

async function googleAdsApiUploader({ settings, conversion }) {
  const readiness = ensureGoogleAdsSettingsReady(settings);
  if (!readiness.ok) throw new Error(readiness.error);

  const token = await requestAccessToken(settings);
  const fetchFn = getFetchFn();
  const response = await fetchFn(`https://googleads.googleapis.com/v17/customers/${settings.customerId}:uploadClickConversions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'developer-token': settings.developerToken,
      ...(settings.loginCustomerId ? { 'login-customer-id': settings.loginCustomerId } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      conversions: [buildGoogleClickConversionPayload({ settings, conversion })],
      partialFailure: true,
      validateOnly: settings.dryRun === true,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`google_ads_upload_failed:${response.status}:${safeStr(payload.error?.message || payload.message || 'unknown_error')}`);
  }
  const partialFailure = safeStr(payload.partialFailureError?.message || payload.partial_failure_error?.message || '');
  if (partialFailure) {
    throw new Error(`google_ads_partial_failure:${partialFailure}`);
  }
  return {
    uploadId: safeStr(payload.jobId || payload.job_id || '') || `google-ads-${Date.now()}`,
    response: payload,
  };
}

function pickClickIdFromAttributes(attributes) {
  const attrs = safeObject(attributes) || {};
  const last = safeObject(attrs.lastAttribution) || {};
  const sources = [last, attrs];
  for (const source of sources) {
    const gclid = safeStr(source.gclid);
    if (gclid) return { clickIdType: 'gclid', clickId: gclid };
    const gbraid = safeStr(source.gbraid);
    if (gbraid) return { clickIdType: 'gbraid', clickId: gbraid };
    const wbraid = safeStr(source.wbraid);
    if (wbraid) return { clickIdType: 'wbraid', clickId: wbraid };
  }
  return { clickIdType: '', clickId: '' };
}

async function getGoogleAdsSettings({ tenantId }) {
  const out = await tenantSettingsService.getSetting({ tenantId, key: SETTINGS_KEY });
  if (!out.ok) return out;
  const secretsOut = await getGoogleAdsSecrets({ tenantId });
  if (!secretsOut.ok && secretsOut.error !== 'tenant_not_found') return secretsOut;
  const rawValue = safeObject(out.value) || {};
  const fallbackSecrets = normalizeSecrets(rawValue);
  return {
    ok: true,
    value: settingsForResponse({
      publicSettings: rawValue,
      secureSettings: secretsOut.ok ? secretsOut.value : fallbackSecrets,
    }),
  };
}

async function upsertGoogleAdsSettings({ tenantId, value }) {
  const { publicSettings, secureSettings } = splitSettingsPayload(value);
  const out = await tenantSettingsService.upsertSetting({ tenantId, key: SETTINGS_KEY, value: publicSettings });
  if (!out.ok) return out;
  if (hasSecrets(value)) {
    const secretOut = await upsertGoogleAdsSecrets({ tenantId, value: secureSettings });
    if (!secretOut.ok) return secretOut;
  }
  return getGoogleAdsSettings({ tenantId });
}

async function getGoogleAdsSettingsForUpload({ tenantId }) {
  const out = await tenantSettingsService.getSetting({ tenantId, key: SETTINGS_KEY });
  if (!out.ok) return out;
  const publicSettings = normalizeSettings(out.value);
  const secretsOut = await getGoogleAdsSecrets({ tenantId });
  const secureSettings = secretsOut.ok ? secretsOut.value : normalizeSecrets(out.value);
  return { ok: true, value: { ...publicSettings, ...secureSettings } };
}

async function resolveTenantRow(tenantId) {
  const TenantModel = Tenant();
  const tenantKey = safeStr(tenantId);
  if (!tenantKey) return null;
  let row = await TenantModel.findOne({ where: { tenant_key: tenantKey }, attributes: ['id', 'tenant_key'] }).catch(() => null);
  if (row) return row;
  row = await TenantModel.findOne({ where: { id: tenantKey }, attributes: ['id', 'tenant_key'] }).catch(() => null);
  return row;
}

async function getGoogleAdsSecrets({ tenantId }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const tenant = await resolveTenantRow(tenantId);
  if (!tenant) return { ok: false, error: 'tenant_not_found' };
  const CredentialModel = TenantAICredential();
  const row = await CredentialModel.findOne({ where: { tenant_id: tenant.id, provider: 'google_ads' } }).catch(() => null);
  if (!row) return { ok: true, value: normalizeSecrets({}) };
  try {
    const decrypted = decrypt(row.api_key_encrypted);
    const parsed = JSON.parse(decrypted);
    return { ok: true, value: normalizeSecrets(parsed) };
  } catch (err) {
    return { ok: false, error: 'secrets_decrypt_failed', details: safeToString(err && err.message ? err.message : err) };
  }
}

async function upsertGoogleAdsSecrets({ tenantId, value }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const tenant = await resolveTenantRow(tenantId);
  if (!tenant) return { ok: false, error: 'tenant_not_found' };
  const normalized = normalizeSecrets(value);
  const encrypted = encrypt(JSON.stringify(normalized));
  const CredentialModel = TenantAICredential();
  const existing = await CredentialModel.findOne({ where: { tenant_id: tenant.id, provider: 'google_ads' } }).catch(() => null);
  if (existing) {
    await existing.update({ api_key_encrypted: encrypted });
  } else {
    await CredentialModel.create({
      tenant_id: tenant.id,
      provider: 'google_ads',
      api_key_encrypted: encrypted,
    });
  }
  return { ok: true, value: settingsForResponse({ secureSettings: normalized }) };
}

async function resolveLeadAttribution({ tenantId, leadId }) {
  if (!leadId || !dbAvailable()) return { lead: null, clickIdType: '', clickId: '' };
  const Model = MarketingLead();
  const row = await Model.findOne({ where: { tenant_key: safeStr(tenantId), id: safeStr(leadId) } }).catch(() => null);
  const lead = row ? (row.toJSON ? row.toJSON() : row) : null;
  const picked = pickClickIdFromAttributes(lead && lead.attributes);
  return { lead, ...picked };
}

async function registerOfflineConversion({
  tenantId,
  leadId = null,
  clickId = null,
  clickIdType = null,
  conversionName,
  conversionActionId = null,
  conversionTime = null,
  conversionValue = null,
  currencyCode = 'BRL',
  idempotencyKey = null,
  metadata = {},
} = {}) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const tenantKey = safeStr(tenantId);
  const name = safeStr(conversionName);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };
  if (!name) return { ok: false, error: 'conversion_name_required' };

  const Model = MarketingAdConversion();
  const resolved = await resolveLeadAttribution({ tenantId: tenantKey, leadId });
  const finalClickId = safeStr(clickId) || resolved.clickId;
  const finalClickIdType = safeStr(clickIdType) || resolved.clickIdType;
  if (!finalClickId || !finalClickIdType) return { ok: false, error: 'click_id_missing' };

  const normalizedIdempotencyKey = safeStr(idempotencyKey) || null;
  if (normalizedIdempotencyKey) {
    const existing = await Model.findOne({ where: { tenant_key: tenantKey, idempotency_key: normalizedIdempotencyKey } }).catch(() => null);
    if (existing) {
      const json = existing.toJSON ? existing.toJSON() : existing;
      return { ok: true, conversion: json, deduplicated: true };
    }
  }

  const row = await Model.create({
    id: newId('madsconv'),
    tenant_key: tenantKey,
    lead_id: safeStr(leadId) || null,
    platform: 'google_ads',
    click_id_type: finalClickIdType,
    click_id: finalClickId,
    conversion_name: name,
    conversion_action_id: safeStr(conversionActionId) || null,
    conversion_time: normalizeConversionTime(conversionTime),
    conversion_value: toFloatOrNull(conversionValue),
    currency_code: normalizeCurrency(currencyCode),
    status: 'pending',
    idempotency_key: normalizedIdempotencyKey,
    metadata: {
      ...(safeObject(metadata) || {}),
      ...(resolved.lead ? { leadSnapshot: { id: resolved.lead.id, email: resolved.lead.email || null, stage: resolved.lead.stage || null } } : {}),
    },
  });

  return { ok: true, conversion: row.toJSON ? row.toJSON() : row, deduplicated: false };
}

async function listOfflineConversions({ tenantId, status = null, limit = 100, offset = 0 } = {}) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const Model = MarketingAdConversion();
  const where = { tenant_key: safeStr(tenantId), platform: 'google_ads' };
  if (status) where.status = safeStr(status);
  const paging = parsePaging({ limit, offset });
  const { count, rows } = await Model.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    limit: paging.limit,
    offset: paging.offset,
  });
  return { ok: true, total: count, items: rows.map((row) => (row.toJSON ? row.toJSON() : row)), ...paging };
}

async function uploadPendingConversions({ tenantId, limit = 50, uploader } = {}) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const effectiveUploader = typeof uploader === 'function' ? uploader : googleAdsApiUploader;

  const settingsOut = await getGoogleAdsSettingsForUpload({ tenantId });
  if (!settingsOut.ok) return settingsOut;
  const settings = settingsOut.value;
  if (!settings.enabled) return { ok: false, error: 'integration_disabled' };

  const Model = MarketingAdConversion();
  const rows = await Model.findAll({
    where: {
      tenant_key: safeStr(tenantId),
      platform: 'google_ads',
      status: 'pending',
    },
    order: [['created_at', 'ASC']],
    limit: Math.min(Math.max(Number(limit) || 50, 1), 500),
  });

  let uploaded = 0;
  let failed = 0;

  for (const row of rows) {
    const conversion = row.toJSON ? row.toJSON() : row;
    const payload = {
      customerId: settings.customerId,
      loginCustomerId: settings.loginCustomerId,
      conversionActionId: safeStr(conversion.conversion_action_id) || settings.defaultConversionActionId,
      clickIdType: conversion.click_id_type,
      clickId: conversion.click_id,
      conversionName: conversion.conversion_name,
      conversionTime: conversion.conversion_time,
      conversionValue: conversion.conversion_value,
      currencyCode: conversion.currency_code,
      metadata: safeObject(conversion.metadata) || {},
      dryRun: settings.dryRun,
    };

    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await effectiveUploader({ tenantId: safeStr(tenantId), settings, conversion: payload, record: conversion });
      // eslint-disable-next-line no-await-in-loop
      await row.update({
        status: 'uploaded',
        attempts: Number(conversion.attempts || 0) + 1,
        uploaded_at: new Date(),
        external_upload_id: safeStr(result && (result.uploadId || result.id)) || null,
        last_error: null,
      });
      uploaded += 1;
    } catch (err) {
      // eslint-disable-next-line no-await-in-loop
      await row.update({
        status: 'failed',
        attempts: Number(conversion.attempts || 0) + 1,
        last_error: safeToString(err && err.message ? err.message : err).slice(0, 4000),
      });
      failed += 1;
    }
  }

  return { ok: true, uploaded, failed, attempted: rows.length };
}

module.exports = {
  SETTINGS_KEY,
  getGoogleAdsSettings,
  getGoogleAdsSettingsForUpload,
  upsertGoogleAdsSettings,
  getGoogleAdsSecrets,
  upsertGoogleAdsSecrets,
  registerOfflineConversion,
  listOfflineConversions,
  uploadPendingConversions,
  googleAdsApiUploader,
};