#!/usr/bin/env node
'use strict';

/**
 * Smoke de WhatsApp QR (conexão + evento + status).
 *
 * Valida:
 * - autenticação RPA
 * - criação de conexão QR
 * - geração de QR
 * - ingestão de evento "connected"
 * - leitura de status "connected"
 * - disconnect e status final "disconnected"
 */

const { getOrCreateRpaToken } = require('../tests/rpa/utils/rpaTokenManager');

function apiBaseUrl() {
  return String(process.env.TEST_BASE_URL || process.env.TEST_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
}

async function reqJson(url, { method = 'GET', token = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const timeoutMs = Math.max(3000, Number(process.env.WA_QR_HTTP_TIMEOUT_MS || 20000));
  const retries = Math.max(1, Number(process.env.WA_QR_HTTP_RETRIES || 2));
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers,
        signal: controller.signal,
        body: body == null ? undefined : JSON.stringify(body),
      });
      const text = await res.text().catch(() => '');
      let payload = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch (_) {
        payload = { raw: text };
      }
      clearTimeout(timeout);
      return { ok: res.ok, status: res.status, payload };
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err;
      if (attempt < retries) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(250 * attempt);
      }
    }
  }
  throw lastErr || new Error('request_failed');
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loginRpa(base) {
  const rpaToken = getOrCreateRpaToken();
  const login = await reqJson(`${base}/auth/rpa/login`, {
    method: 'POST',
    body: { token: rpaToken, tenantId: process.env.TEST_TENANT_ID || 'system' },
  });
  expect(login.ok && login.payload?.token, `rpa_login_failed:${login.status}`);
  return login.payload.token;
}

async function main() {
  const base = apiBaseUrl();
  const token = await loginRpa(base);
  const ts = Date.now();
  const connName = `WA QR Smoke ${ts}`;

  const created = await reqJson(`${base}/whatsapp/connections`, {
    method: 'POST',
    token,
    body: { name: connName, provider: 'whatsapp-qr' },
  });
  expect(created.ok && created.payload?.connection?.id, `wa_conn_create_failed:${created.status}`);
  const connectionId = created.payload.connection.id;

  const qr = await reqJson(`${base}/whatsapp/connections/${encodeURIComponent(connectionId)}/qr`, {
    method: 'POST',
    token,
  });
  const hasImmediateQr = Boolean(qr.payload?.qr?.text);
  const isPendingAsyncQr = qr.payload?.pending === true;
  expect(qr.ok && (hasImmediateQr || isPendingAsyncQr), `wa_qr_generate_failed:${qr.status}`);

  const connectedEvent = await reqJson(`${base}/whatsapp/connections/${encodeURIComponent(connectionId)}/events`, {
    method: 'POST',
    token,
    body: {
      eventType: 'connected',
      metadata: {
        providerSessionId: `smoke-${ts}`,
      },
    },
  });
  expect(connectedEvent.ok && connectedEvent.payload?.connection?.status === 'connected', `wa_event_connected_failed:${connectedEvent.status}`);

  const statusConnected = await reqJson(`${base}/whatsapp/connections/${encodeURIComponent(connectionId)}/status`, {
    method: 'GET',
    token,
  });
  expect(statusConnected.ok && statusConnected.payload?.status === 'connected', `wa_status_connected_failed:${statusConnected.status}`);

  const disconnected = await reqJson(`${base}/whatsapp/connections/${encodeURIComponent(connectionId)}/disconnect`, {
    method: 'POST',
    token,
  });
  expect(disconnected.ok, `wa_disconnect_failed:${disconnected.status}`);

  const statusDisconnected = await reqJson(`${base}/whatsapp/connections/${encodeURIComponent(connectionId)}/status`, {
    method: 'GET',
    token,
  });
  expect(statusDisconnected.ok && statusDisconnected.payload?.status === 'disconnected', `wa_status_disconnected_failed:${statusDisconnected.status}`);

  // eslint-disable-next-line no-console
  console.log(`[wa-qr-smoke] OK connectionId=${connectionId} status=disconnected`);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[wa-qr-smoke] FAIL', err?.message || err);
    process.exit(1);
  });
}

module.exports = { main };
