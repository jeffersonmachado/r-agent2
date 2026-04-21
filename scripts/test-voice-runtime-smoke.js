#!/usr/bin/env node
'use strict';

/**
 * Smoke de voz/PBX para stack de testes.
 *
 * Valida:
 * - autenticação RPA
 * - ingestão de evento de voz
 * - métricas de voz
 * - stats do runtime de voz
 * - selftest sem FAIL + check voiceRuntime presente
 */

const { getOrCreateRpaToken } = require('../core/rpa/utils/rpaTokenManager');

function baseUrl() {
  return String(process.env.TEST_BASE_URL || process.env.TEST_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
}

async function reqJson(url, { method = 'GET', token = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const timeoutMs = Math.max(3000, Number(process.env.VOICE_HTTP_TIMEOUT_MS || 20000));
  const retries = Math.max(1, Number(process.env.VOICE_HTTP_RETRIES || 2));
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers,
        signal: controller.signal,
        body: body ? JSON.stringify(body) : undefined,
      });
      const txt = await res.text().catch(() => '');
      let payload = {};
      try {
        payload = txt ? JSON.parse(txt) : {};
      } catch (_) {
        payload = { raw: txt };
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loginRpa(apiBase) {
  const token = getOrCreateRpaToken();
  const res = await reqJson(`${apiBase}/auth/rpa/login`, {
    method: 'POST',
    body: { token, tenantId: process.env.TEST_TENANT_ID || 'system' },
  });
  if (!res.ok || !res.payload?.token) {
    throw new Error(`rpa_login_failed:${res.status}`);
  }
  return res.payload.token;
}

async function main() {
  const apiBase = baseUrl();
  const authToken = await loginRpa(apiBase);
  const callId = `smoke-${Date.now()}`;

  const ingest = await reqJson(`${apiBase}/api/voice/events`, {
    method: 'POST',
    token: authToken,
    body: {
      eventType: 'ringing',
      callId,
      payload: { source: 'system-autotest-stack' },
    },
  });
  if (!ingest.ok || ingest.payload?.ok !== true) {
    throw new Error(`voice_ingest_failed:${ingest.status}`);
  }

  const metrics = await reqJson(`${apiBase}/api/voice/metrics?windowDays=1`, {
    method: 'GET',
    token: authToken,
  });
  if (!metrics.ok || metrics.payload?.ok !== true) {
    throw new Error(`voice_metrics_failed:${metrics.status}`);
  }

  const stats = await reqJson(`${apiBase}/api/voice/runtime/stats`, {
    method: 'GET',
    token: authToken,
  });
  if (!stats.ok || stats.payload?.ok !== true || typeof stats.payload?.totalSessions !== 'number') {
    throw new Error(`voice_runtime_stats_failed:${stats.status}`);
  }

  const selftest = await reqJson(`${apiBase}/health/selftest`, { method: 'GET' });
  const status = String(selftest.payload?.status || '').toUpperCase();
  if (!selftest.ok || !status || status === 'FAIL') {
    throw new Error(`selftest_failed:${selftest.status}:${status || 'unknown'}`);
  }
  if (!selftest.payload?.checks || !selftest.payload.checks.voiceRuntime) {
    throw new Error('selftest_missing_voice_runtime_check');
  }

  // eslint-disable-next-line no-console
  console.log(`[voice-smoke] OK callId=${callId} selftest=${status} activeSessions=${stats.payload.totalSessions}`);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[voice-smoke] FAIL', err?.message || err);
    process.exit(1);
  });
}

module.exports = { main };
