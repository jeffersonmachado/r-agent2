'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http2 = require('http2');
const logger = require('../../utils/logger');
const {
  listPushTokensForUser,
  removePushTokenByPlatformAndToken,
  assertPlatform,
} = require('./tokenService');

const TOKEN_EARLY_RENEW_MS = 60 * 1000;
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 300;

let cachedFcmAccessToken = null;
let cachedFcmAccessTokenExpAt = 0;
let cachedApnsJwtToken = null;
let cachedApnsJwtExpAt = 0;

function isPushEnabled() {
  const raw = String(process.env.PUSH_ENABLED || 'false').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwtRs256(payload, privateKeyPem) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const toSign = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createSign('RSA-SHA256').update(toSign).sign(privateKeyPem);
  return `${toSign}.${base64UrlEncode(signature)}`;
}

function signJwtEs256(payload, privateKeyPem, keyId) {
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const toSign = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createSign('SHA256').update(toSign).sign(privateKeyPem);
  return `${toSign}.${base64UrlEncode(signature)}`;
}

function safeTokenHash(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex').slice(0, 12);
}

function trimPreview(text, max = 120) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRequiredEnv(name) {
  const v = process.env[name];
  if (v === undefined || String(v).trim() === '') return null;
  return String(v);
}

function getFcmServiceAccount() {
  const inline = getRequiredEnv('FCM_SERVICE_ACCOUNT_JSON');
  const pathValue = getRequiredEnv('FCM_SERVICE_ACCOUNT_PATH');
  let raw = null;

  if (inline) {
    const maybeJson = inline.trim();
    if (maybeJson.startsWith('{')) {
      raw = maybeJson;
    } else {
      raw = Buffer.from(maybeJson, 'base64').toString('utf8');
    }
  } else if (pathValue) {
    raw = fs.readFileSync(pathValue, 'utf8');
  }

  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON inválido: client_email/private_key ausentes');
  }
  return parsed;
}

function getApnsPrivateKey() {
  const inline = getRequiredEnv('APNS_P8');
  if (inline) {
    if (inline.includes('BEGIN PRIVATE KEY')) return inline;
    return Buffer.from(inline, 'base64').toString('utf8');
  }
  const pathValue = getRequiredEnv('APNS_P8_PATH');
  if (!pathValue) return null;
  return fs.readFileSync(pathValue, 'utf8');
}

function getApnsHost() {
  return String(process.env.APNS_ENV || 'sandbox').toLowerCase() === 'production'
    ? 'https://api.push.apple.com'
    : 'https://api.sandbox.push.apple.com';
}

function validatePushStartupConfig() {
  if (!isPushEnabled()) return;

  const missing = [];

  if (!getRequiredEnv('FCM_PROJECT_ID')) missing.push('FCM_PROJECT_ID');
  if (!getRequiredEnv('FCM_SERVICE_ACCOUNT_JSON') && !getRequiredEnv('FCM_SERVICE_ACCOUNT_PATH')) {
    missing.push('FCM_SERVICE_ACCOUNT_JSON|FCM_SERVICE_ACCOUNT_PATH');
  }

  if (!getRequiredEnv('APNS_TEAM_ID')) missing.push('APNS_TEAM_ID');
  if (!getRequiredEnv('APNS_KEY_ID')) missing.push('APNS_KEY_ID');
  if (!getRequiredEnv('APNS_BUNDLE_ID')) missing.push('APNS_BUNDLE_ID');
  if (!getRequiredEnv('APNS_P8') && !getRequiredEnv('APNS_P8_PATH')) {
    missing.push('APNS_P8|APNS_P8_PATH');
  }

  const apnsEnv = String(process.env.APNS_ENV || 'sandbox').toLowerCase();
  if (!['sandbox', 'production'].includes(apnsEnv)) {
    missing.push('APNS_ENV(sandbox|production)');
  }

  if (missing.length > 0) {
    throw new Error(`PUSH_ENABLED=true mas faltam variáveis obrigatórias: ${missing.join(', ')}`);
  }
}

async function getFcmAccessToken() {
  const now = Date.now();
  if (cachedFcmAccessToken && now < (cachedFcmAccessTokenExpAt - TOKEN_EARLY_RENEW_MS)) {
    return cachedFcmAccessToken;
  }

  const serviceAccount = getFcmServiceAccount();
  if (!serviceAccount) {
    throw new Error('FCM não configurado (service account ausente)');
  }

  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const jwt = signJwtRs256({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: serviceAccount.token_uri || 'https://oauth2.googleapis.com/token',
    iat,
    exp,
  }, serviceAccount.private_key);

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });

  const resp = await fetch(serviceAccount.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = await resp.json();
  if (!resp.ok || !json.access_token) {
    throw new Error(`Falha ao obter token OAuth FCM: ${resp.status} ${JSON.stringify(json)}`);
  }

  cachedFcmAccessToken = json.access_token;
  cachedFcmAccessTokenExpAt = now + (Number(json.expires_in || 3600) * 1000);
  return cachedFcmAccessToken;
}

function getApnsJwtToken() {
  const now = Date.now();
  if (cachedApnsJwtToken && now < (cachedApnsJwtExpAt - TOKEN_EARLY_RENEW_MS)) {
    return cachedApnsJwtToken;
  }

  const teamId = getRequiredEnv('APNS_TEAM_ID');
  const keyId = getRequiredEnv('APNS_KEY_ID');
  const privateKey = getApnsPrivateKey();
  if (!teamId || !keyId || !privateKey) {
    throw new Error('APNs não configurado corretamente');
  }

  const iat = Math.floor(now / 1000);
  const token = signJwtEs256({ iss: teamId, iat }, privateKey, keyId);
  cachedApnsJwtToken = token;
  cachedApnsJwtExpAt = now + (50 * 60 * 1000);
  return token;
}

async function sendFcmMessage({ token, notification, data }) {
  const accessToken = await getFcmAccessToken();
  const projectId = getRequiredEnv('FCM_PROJECT_ID');
  if (!projectId) {
    throw new Error('FCM_PROJECT_ID ausente');
  }

  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token,
        notification: {
          title: String(notification?.title || ''),
          body: String(notification?.body || ''),
        },
        data: Object.fromEntries(
          Object.entries(data || {}).map(([k, v]) => [k, String(v)])
        ),
      },
    }),
  });

  const json = await response.json().catch(() => ({}));
  if (response.ok) {
    return { ok: true, response: json };
  }

  const reason = json?.error?.status || json?.error?.message || `HTTP_${response.status}`;
  const detailCodes = Array.isArray(json?.error?.details)
    ? json.error.details.map((item) => item?.errorCode || item?.reason).filter(Boolean)
    : [];

  const isInvalid = reason === 'NOT_FOUND'
    || reason === 'INVALID_ARGUMENT'
    || detailCodes.includes('UNREGISTERED')
    || detailCodes.includes('INVALID_ARGUMENT')
    || detailCodes.includes('INVALID_REGISTRATION_TOKEN')
    || detailCodes.includes('REGISTRATION_TOKEN_NOT_REGISTERED');

  const retryable = response.status >= 500 || reason === 'UNAVAILABLE';
  return {
    ok: false,
    invalidToken: isInvalid,
    retryable,
    error: { status: response.status, reason, detailCodes, raw: json },
  };
}

function sendApnsMessage({ token, notification, data }) {
  return new Promise((resolve, reject) => {
    const apnsToken = getApnsJwtToken();
    const bundleId = getRequiredEnv('APNS_BUNDLE_ID');
    const host = getApnsHost();

    const client = http2.connect(host);
    client.on('error', (err) => {
      client.close();
      reject(err);
    });

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${apnsToken}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'content-type': 'application/json',
    });

    let responseData = '';
    let status = 0;

    req.on('response', (headers) => {
      status = Number(headers[':status'] || 0);
    });
    req.on('data', (chunk) => {
      responseData += chunk;
    });
    req.on('error', (err) => {
      client.close();
      reject(err);
    });
    req.on('end', () => {
      client.close();
      let parsed = {};
      if (responseData) {
        try {
          parsed = JSON.parse(responseData);
        } catch {
          parsed = { reason: responseData };
        }
      }

      if (status >= 200 && status < 300) {
        resolve({ ok: true, response: parsed });
        return;
      }

      const reason = parsed?.reason || `HTTP_${status}`;
      const invalidToken = status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered';
      const retryable = status >= 500 || reason === 'TooManyRequests';

      resolve({
        ok: false,
        invalidToken,
        retryable,
        error: { status, reason, raw: parsed },
      });
    });

    const payload = {
      aps: {
        alert: {
          title: String(notification?.title || ''),
          body: String(notification?.body || ''),
        },
        sound: 'default',
      },
      data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
    };

    req.end(JSON.stringify(payload));
  });
}

async function withRetry(sendFn) {
  let lastResult = null;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    const result = await sendFn();
    lastResult = result;
    if (result.ok) return result;
    if (!result.retryable || attempt >= RETRY_ATTEMPTS) return result;
    await sleep(RETRY_DELAY_MS * attempt);
  }
  return lastResult;
}

async function sendToTokens({ platform, tokens, notification, data, context = {} }) {
  const normalizedPlatform = assertPlatform(platform);
  const uniqueTokens = Array.from(new Set((tokens || []).map((t) => String(t || '').trim()).filter(Boolean)));

  if (!isPushEnabled()) {
    return { ok: true, disabled: true, sent: 0, failed: 0, invalidRemoved: 0 };
  }

  logger.info('PUSH_SEND_START', {
    tenantId: context.tenantId || null,
    ticketId: context.ticketId || null,
    platform: normalizedPlatform,
    countTokens: uniqueTokens.length,
  });

  let sent = 0;
  let failed = 0;
  let invalidRemoved = 0;

  for (const token of uniqueTokens) {
    const result = await withRetry(async () => {
      if (normalizedPlatform === 'android') {
        return sendFcmMessage({ token, notification, data });
      }
      return sendApnsMessage({ token, notification, data });
    }).catch((error) => ({
      ok: false,
      retryable: false,
      invalidToken: false,
      error: { message: error?.message || String(error) },
    }));

    if (result.ok) {
      sent += 1;
      continue;
    }

    failed += 1;
    logger.warn('PUSH_SEND_FAIL', {
      tenantId: context.tenantId || null,
      ticketId: context.ticketId || null,
      platform: normalizedPlatform,
      tokenHash: safeTokenHash(token),
      reason: result?.error?.reason || result?.error?.message || 'unknown',
      status: result?.error?.status || null,
    });

    if (result.invalidToken) {
      const removed = await removePushTokenByPlatformAndToken({ platform: normalizedPlatform, token });
      if (removed) invalidRemoved += 1;
    }
  }

  logger.info('PUSH_SEND_OK', {
    tenantId: context.tenantId || null,
    ticketId: context.ticketId || null,
    platform: normalizedPlatform,
    countTokens: uniqueTokens.length,
    sent,
    failed,
    invalidRemoved,
  });

  return {
    ok: failed === 0,
    sent,
    failed,
    invalidRemoved,
  };
}

async function sendToUser({ tenantId, userId, notification, data, context = {} }) {
  if (!isPushEnabled()) {
    return { ok: true, disabled: true, sent: 0, failed: 0, invalidRemoved: 0 };
  }

  const tokens = await listPushTokensForUser({ tenantId, userId });
  if (!tokens || tokens.length === 0) {
    return { ok: true, sent: 0, failed: 0, invalidRemoved: 0 };
  }

  const grouped = {
    android: [],
    ios: [],
  };

  for (const item of tokens) {
    if (item.platform === 'android') grouped.android.push(item.token);
    if (item.platform === 'ios') grouped.ios.push(item.token);
  }

  const results = [];
  if (grouped.android.length > 0) {
    results.push(await sendToTokens({
      platform: 'android',
      tokens: grouped.android,
      notification,
      data,
      context: { ...context, tenantId },
    }));
  }
  if (grouped.ios.length > 0) {
    results.push(await sendToTokens({
      platform: 'ios',
      tokens: grouped.ios,
      notification,
      data,
      context: { ...context, tenantId },
    }));
  }

  return results.reduce((acc, item) => {
    acc.sent += Number(item.sent || 0);
    acc.failed += Number(item.failed || 0);
    acc.invalidRemoved += Number(item.invalidRemoved || 0);
    acc.ok = acc.ok && item.ok !== false;
    return acc;
  }, { ok: true, sent: 0, failed: 0, invalidRemoved: 0 });
}

module.exports = {
  sendToUser,
  sendToTokens,
  validatePushStartupConfig,
  isPushEnabled,
  trimPreview,
};
