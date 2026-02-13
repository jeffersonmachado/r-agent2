#!/usr/bin/env node
'use strict';

/**
 * Smoke de filas fisicas (L-01):
 * - cria fila admin
 * - cria tokens publicos kiosk/panel/station
 * - cria senha no kiosk
 * - valida painel (fila de espera)
 * - call-next + start + pause + resume + finish no station
 * - valida metricas minimas admin
 */

const { getOrCreateRpaToken } = require('../tests/rpa/utils/rpaTokenManager');

function apiBaseUrl() {
  return String(process.env.TEST_BASE_URL || process.env.TEST_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
}

async function reqJson(url, { method = 'GET', token = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text().catch(() => '');
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_) {
    payload = { raw: text };
  }
  return { ok: res.ok, status: res.status, payload };
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
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
  const authToken = await loginRpa(base);
  const ts = Date.now();
  const locationId = `smoke-loc-${ts}`;
  const queueName = `Smoke Queue ${ts}`;

  const queueUpsert = await reqJson(`${base}/api/physical/queues`, {
    method: 'POST',
    token: authToken,
    body: {
      locationId,
      name: queueName,
      status: 'active',
      rules: { maxPerHour: 300 },
    },
  });
  expect(queueUpsert.ok && queueUpsert.payload?.item?.id, `physical_queue_upsert_failed:${queueUpsert.status}`);
  const queueId = queueUpsert.payload.item.id;

  const createPublicToken = async (kind) => {
    const out = await reqJson(`${base}/public-tokens`, {
      method: 'POST',
      token: authToken,
      body: {
        kind,
        locationId,
        meta: { purpose: 'physical-smoke' },
        expiresInSec: 1800,
      },
    });
    expect(out.ok && out.payload?.token?.token, `public_token_create_failed:${kind}:${out.status}`);
    return out.payload.token.token;
  };

  const kioskToken = await createPublicToken('kiosk');
  const panelToken = await createPublicToken('panel');
  const stationToken = await createPublicToken('station');

  const idempotencyKey = `phy-smoke-${ts}`;
  const kioskCreate = await reqJson(`${base}/physical/kiosk/tickets?token=${encodeURIComponent(kioskToken)}`, {
    method: 'POST',
    body: {
      queueId,
      priority: 1,
      context: { idempotencyKey },
    },
  });
  expect(kioskCreate.ok && kioskCreate.payload?.ticket?.id, `physical_kiosk_create_failed:${kioskCreate.status}`);
  const ticketId = kioskCreate.payload.ticket.id;

  const panelState = await reqJson(`${base}/physical/panel/state?token=${encodeURIComponent(panelToken)}`);
  expect(panelState.ok, `physical_panel_state_failed:${panelState.status}`);
  const waiting = Array.isArray(panelState.payload?.waiting) ? panelState.payload.waiting : [];
  expect(waiting.some((t) => t && t.id === ticketId), 'physical_panel_missing_ticket');

  const stationId = 'A1';
  const callNext = await reqJson(`${base}/physical/station/call-next?token=${encodeURIComponent(stationToken)}`, {
    method: 'POST',
    body: { stationId },
  });
  expect(callNext.ok && callNext.payload?.ticket?.id === ticketId, `physical_call_next_failed:${callNext.status}`);

  const startService = await reqJson(`${base}/physical/station/start?token=${encodeURIComponent(stationToken)}`, {
    method: 'POST',
    body: {
      ticketId,
      stationId,
      idempotencyKey: `${idempotencyKey}:start`,
    },
  });
  expect(startService.ok && startService.payload?.ticket?.status === 'in_service', `physical_start_failed:${startService.status}`);

  const pauseService = await reqJson(`${base}/physical/station/pause?token=${encodeURIComponent(stationToken)}`, {
    method: 'POST',
    body: {
      ticketId,
      stationId,
      reason: 'smoke_pause',
      idempotencyKey: `${idempotencyKey}:pause`,
    },
  });
  expect(pauseService.ok && pauseService.payload?.ticket?.status === 'paused', `physical_pause_failed:${pauseService.status}`);

  const resumeService = await reqJson(`${base}/physical/station/resume?token=${encodeURIComponent(stationToken)}`, {
    method: 'POST',
    body: {
      ticketId,
      stationId,
      idempotencyKey: `${idempotencyKey}:resume`,
    },
  });
  expect(resumeService.ok && resumeService.payload?.ticket?.status === 'in_service', `physical_resume_failed:${resumeService.status}`);

  const finishService = await reqJson(`${base}/physical/station/finish?token=${encodeURIComponent(stationToken)}`, {
    method: 'POST',
    body: { ticketId },
  });
  expect(finishService.ok && finishService.payload?.ticket?.status === 'done', `physical_finish_failed:${finishService.status}`);

  const metrics = await reqJson(`${base}/api/physical/metrics?locationId=${encodeURIComponent(locationId)}`, {
    method: 'GET',
    token: authToken,
  });
  expect(metrics.ok && metrics.payload?.ok === true, `physical_metrics_failed:${metrics.status}`);
  expect(Number(metrics.payload?.today?.doneCount || 0) >= 1, 'physical_metrics_done_count_invalid');
  expect(Number(metrics.payload?.today?.pausedCount || 0) >= 0, 'physical_metrics_paused_count_invalid');
  expect(Array.isArray(metrics.payload?.byQueue), 'physical_metrics_byqueue_missing');

  // eslint-disable-next-line no-console
  console.log(`[physical-smoke] OK queueId=${queueId} ticketId=${ticketId} locationId=${locationId}`);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[physical-smoke] FAIL', err?.message || err);
    process.exit(1);
  });
}

module.exports = { main };
