'use strict';

const googleAdsConversionService = require('./googleAdsConversionService');
const { appendEventV1 } = require('../eventLedgerService');

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

function normalizeCustomerId(value) {
  return safeStr(value).replace(/\D+/g, '');
}

function normalizeMatchType(value) {
  const normalized = safeStr(value).toUpperCase();
  if (['EXACT', 'PHRASE', 'BROAD'].includes(normalized)) return normalized;
  return 'PHRASE';
}

function getFetchFn() {
  if (typeof global.fetch === 'function') return global.fetch;
  // eslint-disable-next-line global-require
  return require('node-fetch');
}

function ensureSettingsReady(settings) {
  if (!settings || settings.enabled !== true) return { ok: false, error: 'integration_disabled' };
  if (!normalizeCustomerId(settings.customerId)) return { ok: false, error: 'customer_id_required' };
  if (!safeStr(settings.developerToken)) return { ok: false, error: 'developer_token_required' };
  if (!safeStr(settings.clientId)) return { ok: false, error: 'client_id_required' };
  if (!safeStr(settings.clientSecret)) return { ok: false, error: 'client_secret_required' };
  if (!safeStr(settings.refreshToken)) return { ok: false, error: 'refresh_token_required' };
  return { ok: true };
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

async function mutateAdGroupCriteria({ settings, operations = [], dryRun = null }) {
  const readiness = ensureSettingsReady(settings);
  if (!readiness.ok) throw new Error(readiness.error);
  const token = await requestAccessToken(settings);
  const fetchFn = getFetchFn();
  const customerId = normalizeCustomerId(settings.customerId);
  const response = await fetchFn(`https://googleads.googleapis.com/v17/customers/${customerId}/adGroupCriteria:mutate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'developer-token': settings.developerToken,
      ...(settings.loginCustomerId ? { 'login-customer-id': normalizeCustomerId(settings.loginCustomerId) } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operations,
      partialFailure: false,
      validateOnly: dryRun == null ? settings.dryRun === true : dryRun === true,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`google_ads_mutate_failed:${response.status}:${safeStr(payload.error?.message || payload.message || 'unknown_error')}`);
  }
  return payload;
}

function buildAdGroupCriterionResourceName(customerId, adGroupId, criterionId) {
  return `customers/${normalizeCustomerId(customerId)}/adGroupCriteria/${safeStr(adGroupId)}~${safeStr(criterionId)}`;
}

function buildOperationFromAction({ settings, action, payload }) {
  const normalizedAction = safeStr(action);
  const customerId = normalizeCustomerId(settings.customerId);
  const adGroupId = safeStr(payload.adGroupId);
  const campaignId = safeStr(payload.campaignId);
  const criterionId = safeStr(payload.keywordId || payload.criterionId);
  const keywordText = safeStr(payload.keywordText || payload.term);
  const matchType = normalizeMatchType(payload.matchType);

  if (!campaignId) {
    return { ok: false, error: 'campaign_id_required' };
  }

  if (normalizedAction === 'include_keyword') {
    if (!adGroupId) return { ok: false, error: 'ad_group_id_required' };
    if (!keywordText) return { ok: false, error: 'keyword_text_required' };
    return {
      ok: true,
      operation: {
        create: {
          adGroup: `customers/${customerId}/adGroups/${adGroupId}`,
          status: 'ENABLED',
          keyword: {
            text: keywordText,
            matchType,
          },
        },
      },
    };
  }

  if (normalizedAction === 'add_negative_keyword') {
    if (!adGroupId) return { ok: false, error: 'ad_group_id_required' };
    if (!keywordText) return { ok: false, error: 'keyword_text_required' };
    return {
      ok: true,
      operation: {
        create: {
          adGroup: `customers/${customerId}/adGroups/${adGroupId}`,
          negative: true,
          keyword: {
            text: keywordText,
            matchType,
          },
        },
      },
    };
  }

  if (normalizedAction === 'pause_keyword') {
    if (!adGroupId) return { ok: false, error: 'ad_group_id_required' };
    if (!criterionId) return { ok: false, error: 'keyword_id_required' };
    return {
      ok: true,
      operation: {
        update: {
          resourceName: buildAdGroupCriterionResourceName(customerId, adGroupId, criterionId),
          status: 'PAUSED',
        },
        updateMask: 'status',
      },
    };
  }

  return { ok: false, error: 'unsupported_action' };
}

async function recordActionEvent({ tenantId, action, payload, result }) {
  return appendEventV1({
    tenantId,
    type: 'MarketingGoogleAdsKeywordActionApplied',
    source: 'marketing.google_ads.keyword_actions',
    occurredAt: new Date(),
    subject: { type: 'marketing_google_ads', id: safeStr(payload.campaignId || payload.adGroupId || payload.keywordId || 'keyword_action') },
    actor: { type: 'system', id: 'marketing_google_ads' },
    idempotencyKey: payload.idempotencyKey ? `marketing-google-ads-action:${tenantId}:${safeStr(payload.idempotencyKey)}` : null,
    payload: {
      action,
      input: safeObject(payload) || {},
      result: safeObject(result) || {},
    },
  }).catch(() => null);
}

async function applyKeywordAction({ tenantId, action, payload = {} } = {}) {
  const tenantKey = safeStr(tenantId);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };
  const normalizedAction = safeStr(action || payload.action);
  if (!normalizedAction) return { ok: false, error: 'action_required' };

  const settingsOut = await googleAdsConversionService.getGoogleAdsSettingsForUpload({ tenantId: tenantKey });
  if (!settingsOut.ok) return settingsOut;
  const settings = settingsOut.value;

  const built = buildOperationFromAction({ settings, action: normalizedAction, payload });
  if (!built.ok) return built;

  const mutateResponse = await mutateAdGroupCriteria({
    settings,
    operations: [built.operation],
    dryRun: payload.dryRun,
  });

  const result = {
    ok: true,
    action: normalizedAction,
    dryRun: payload.dryRun == null ? settings.dryRun === true : payload.dryRun === true,
    result: mutateResponse,
  };

  await recordActionEvent({ tenantId: tenantKey, action: normalizedAction, payload, result });
  return result;
}

module.exports = {
  applyKeywordAction,
};