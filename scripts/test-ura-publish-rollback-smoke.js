#!/usr/bin/env node
'use strict';

/**
 * Smoke L-02: URA publish/rollback com trilha de auditoria.
 *
 * Valida:
 * - autenticação (admin ou RPA fallback)
 * - publish do dialplan (v1)
 * - mudança de dialplan + publish (v2)
 * - rollback para v1
 * - assinatura restaurada após rollback
 * - trilha de auditoria para publish/rollback
 */

const { getOrCreateRpaToken } = require('../core/rpa/utils/rpaTokenManager');
const fs = require('fs');
const path = require('path');

function apiBaseUrl() {
  return String(process.env.TEST_BASE_URL || process.env.TEST_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
}

async function reqJson(url, { method = 'GET', token = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const timeoutMs = Math.max(3000, Number(process.env.L02_HTTP_TIMEOUT_MS || 20000));
  const retries = Math.max(1, Number(process.env.L02_HTTP_RETRIES || 3));
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

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function evidencePath() {
  return String(process.env.URA_PUBLISH_ROLLBACK_EVIDENCE_PATH || 'qa/l02-ura-publish-rollback-evidence.json');
}

function writeEvidence(payload) {
  const out = evidencePath();
  const abs = path.resolve(process.cwd(), out);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return out;
}

async function login(baseUrl) {
  const username = String(process.env.TEST_ADMIN_USERNAME || process.env.TEST_USERNAME || 'admin');
  const password = String(process.env.TEST_ADMIN_PASSWORD || process.env.TEST_USER_PASSWORD || 'admin123');
  const adminLogin = await reqJson(`${baseUrl}/auth/login`, {
    method: 'POST',
    body: { username, password },
  });
  if (adminLogin.ok && adminLogin.payload?.token) {
    return {
      token: adminLogin.payload.token,
      tenantId: adminLogin.payload?.agent?.tenantId || process.env.TEST_TENANT_ID || 'system',
      mode: 'admin',
    };
  }

  const rpaToken = getOrCreateRpaToken();
  const rpaLogin = await reqJson(`${baseUrl}/auth/rpa/login`, {
    method: 'POST',
    body: { token: rpaToken, tenantId: process.env.TEST_TENANT_ID || 'system' },
  });
  expect(rpaLogin.ok && rpaLogin.payload?.token, `login_failed:admin=${adminLogin.status}:rpa=${rpaLogin.status}`);
  return {
    token: rpaLogin.payload.token,
    tenantId: rpaLogin.payload?.agent?.tenantId || process.env.TEST_TENANT_ID || 'system',
    mode: 'rpa',
  };
}

async function main() {
  const baseUrl = apiBaseUrl();
  const auth = await login(baseUrl);
  const ts = Date.now();

  const queueA = `900${String(ts).slice(-4)}`;
  const queueB = `901${String(ts).slice(-4)}`;

  const createQueue = async (name) => {
    const out = await reqJson(`${baseUrl}/api/pbx/queues`, {
      method: 'POST',
      token: auth.token,
      body: {
        name,
        displayName: `URA Smoke ${name}`,
        strategy: 'ringall',
        options: { timeout: 15 },
      },
    });
    expect(out.ok, `pbx_queue_create_failed:${name}:${out.status}`);
  };

  const applyDialplan = async () => {
    const out = await reqJson(`${baseUrl}/api/pbx/dialplan/apply`, {
      method: 'POST',
      token: auth.token,
      body: {},
    });
    expect(out.ok && out.payload?.ok === true && out.payload?.signature, `pbx_apply_failed:${out.status}`);
    return out.payload;
  };

  const listVersions = async () => {
    const out = await reqJson(`${baseUrl}/api/pbx/config-versions?limit=30`, {
      method: 'GET',
      token: auth.token,
    });
    expect(out.ok && out.payload?.ok === true && Array.isArray(out.payload?.items), `pbx_versions_failed:${out.status}`);
    return out.payload.items;
  };

  await createQueue(queueA);
  const firstApply = await applyDialplan();
  const sigV1 = String(firstApply.signature);

  await createQueue(queueB);
  const secondApply = await applyDialplan();
  const sigV2 = String(secondApply.signature);
  expect(sigV1 !== sigV2, 'pbx_signature_not_changed_between_versions');

  const versionsAfterApply = await listVersions();
  const v1 = versionsAfterApply.find((v) => String(v?.summary?.dialplan?.signature || '') === sigV1);
  expect(v1 && Number.isFinite(Number(v1.version)), 'pbx_version_with_sig_v1_not_found');

  const rollback = await reqJson(`${baseUrl}/api/pbx/dialplan/rollback?version=${encodeURIComponent(String(v1.version))}`, {
    method: 'POST',
    token: auth.token,
    body: {},
  });
  expect(rollback.ok && rollback.payload?.ok === true, `pbx_rollback_failed:${rollback.status}`);
  expect(String(rollback.payload?.signature || '') === sigV1, 'pbx_rollback_signature_mismatch');

  const versionsAfterRollback = await listVersions();
  const top = versionsAfterRollback[0] || null;
  expect(top && String(top?.summary?.dialplan?.signature || '') === sigV1, 'pbx_top_version_not_rolled_back');

  let publishCount = 0;
  let rollbackCount = 0;
  let auditSource = 'audit.logs';

  for (let i = 0; i < 20; i += 1) {
    const publishAudit = await reqJson(
      `${baseUrl}/audit/logs?action=${encodeURIComponent('pbx.dialplan.publish')}&resource=${encodeURIComponent('pbx_dialplan')}&limit=20`,
      { method: 'GET', token: auth.token },
    );
    const rollbackAudit = await reqJson(
      `${baseUrl}/audit/logs?action=${encodeURIComponent('pbx.dialplan.rollback')}&resource=${encodeURIComponent('pbx_dialplan')}&limit=20`,
      { method: 'GET', token: auth.token },
    );

    publishCount = publishAudit.ok && Array.isArray(publishAudit.payload?.logs) ? publishAudit.payload.logs.length : 0;
    rollbackCount = rollbackAudit.ok && Array.isArray(rollbackAudit.payload?.logs) ? rollbackAudit.payload.logs.length : 0;
    if (publishCount > 0 && rollbackCount > 0) break;
    await sleep(300);
  }

  if (!(publishCount > 0 && rollbackCount > 0)) {
    const pbxAudit = await reqJson(`${baseUrl}/api/pbx/audit?hours=24&limit=200`, {
      method: 'GET',
      token: auth.token,
    });
    expect(pbxAudit.ok && pbxAudit.payload?.ok === true, `pbx_audit_unavailable:${pbxAudit.status}`);
    publishCount = Number(pbxAudit.payload?.byAction?.['pbx.dialplan.publish'] || 0);
    rollbackCount = Number(pbxAudit.payload?.byAction?.['pbx.dialplan.rollback'] || 0);
    auditSource = 'api.pbx.audit';
  }

  expect(publishCount > 0, 'audit_publish_missing');
  expect(rollbackCount > 0, 'audit_rollback_missing');

  const evidence = {
    smoke: 'L-02',
    generatedAt: new Date().toISOString(),
    ok: true,
    authMode: auth.mode,
    tenantId: auth.tenantId,
    versions: {
      rollbackTargetVersion: Number(v1.version),
      topVersionSignature: String(top?.summary?.dialplan?.signature || ''),
    },
    signatures: {
      v1: sigV1,
      v2: sigV2,
      rollback: String(rollback.payload?.signature || ''),
    },
    audit: {
      source: auditSource,
      publishCount,
      rollbackCount,
    },
  };
  const evPath = writeEvidence(evidence);

  // eslint-disable-next-line no-console
  console.log(`[ura-publish-rollback-smoke] OK auth=${auth.mode} v1=${v1.version} sigV1=${sigV1} sigV2=${sigV2} evidence=${evPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[ura-publish-rollback-smoke] FAIL', err?.message || err);
    process.exit(1);
  });
}

module.exports = { main };
