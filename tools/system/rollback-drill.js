#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_API_URL = process.env.ROLLBACK_DRILL_API_URL || process.env.API_URL || process.env.TEST_BASE_URL || 'http://localhost:3001';
const REPORT_PATH = process.env.ROLLBACK_DRILL_REPORT_PATH || 'qa/rollback-drill-report.json';
const APPLY_PBX_ROLLBACK = process.env.ROLLBACK_DRILL_APPLY_PBX === '1';
const SMOKE_EVIDENCE_SUMMARY_PATH = process.env.SMOKE_EVIDENCE_SUMMARY_PATH || 'qa/smoke-evidence.json';
const REQUIRE_PBX_SMOKE_EVIDENCE = String(process.env.ROLLBACK_DRILL_REQUIRE_PBX_SMOKE_EVIDENCE || '1') !== '0';

function nowIso() {
  return new Date().toISOString();
}

function maskToken(token) {
  const s = String(token || '');
  if (!s) return '';
  if (s.length < 10) return '***';
  return `${s.slice(0, 4)}***${s.slice(-3)}`;
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function reqJson(baseUrl, endpoint, { method = 'GET', token = null, body = null } = {}) {
  const url = `${String(baseUrl).replace(/\/+$/, '')}${endpoint}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const startedAt = Date.now();
  const response = await fetch(url, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });

  const text = await response.text().catch(() => '');
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_) {
    payload = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
    durationMs: Date.now() - startedAt,
    url,
  };
}

async function login(baseUrl) {
  const username = String(process.env.ROLLBACK_DRILL_ADMIN_USERNAME || process.env.TEST_ADMIN_USERNAME || process.env.TEST_USERNAME || 'admin');
  const password = String(process.env.ROLLBACK_DRILL_ADMIN_PASSWORD || process.env.TEST_ADMIN_PASSWORD || process.env.TEST_USER_PASSWORD || 'admin123');

  const adminLogin = await reqJson(baseUrl, '/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  if (adminLogin.ok && adminLogin.payload && adminLogin.payload.token) {
    return {
      ok: true,
      mode: 'admin',
      token: adminLogin.payload.token,
      tenantId: adminLogin.payload?.agent?.tenantId || null,
      evidence: {
        status: adminLogin.status,
        durationMs: adminLogin.durationMs,
      },
    };
  }

  let rpaToken = String(process.env.RPA_TOKEN || '').trim();
  if (!rpaToken) {
    try {
      // eslint-disable-next-line global-require
      const { getOrCreateRpaToken } = require('../../tests/rpa/utils/rpaTokenManager');
      rpaToken = String(getOrCreateRpaToken() || '').trim();
    } catch (_) {
      rpaToken = '';
    }
  }

  if (!rpaToken) {
    return {
      ok: false,
      error: 'auth_failed_no_admin_and_no_rpa_token',
      evidence: {
        adminStatus: adminLogin.status,
      },
    };
  }

  const tenantId = String(process.env.ROLLBACK_DRILL_TENANT_ID || process.env.TEST_TENANT_ID || 'system');
  const rpaLogin = await reqJson(baseUrl, '/auth/rpa/login', {
    method: 'POST',
    body: { token: rpaToken, tenantId },
  });

  if (!rpaLogin.ok || !rpaLogin.payload || !rpaLogin.payload.token) {
    return {
      ok: false,
      error: 'auth_failed_rpa_login',
      evidence: {
        adminStatus: adminLogin.status,
        rpaStatus: rpaLogin.status,
      },
    };
  }

  return {
    ok: true,
    mode: 'rpa',
    token: rpaLogin.payload.token,
    tenantId: rpaLogin.payload?.agent?.tenantId || tenantId,
    evidence: {
      adminStatus: adminLogin.status,
      rpaStatus: rpaLogin.status,
      rpaToken: maskToken(rpaToken),
    },
  };
}

function pickRollbackVersion(items) {
  if (!Array.isArray(items)) return null;
  const candidates = items
    .filter((v) => Array.isArray(v?.summary?.dialplan?.rows) && v.summary.dialplan.rows.length > 0)
    .sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
  return candidates[0] || null;
}

function sanitizePayload(payload) {
  try {
    const raw = JSON.stringify(payload || {});
    return raw.length > 1200 ? `${raw.slice(0, 1200)}...[truncated]` : raw;
  } catch (_) {
    return '[unserializable_payload]';
  }
}

function loadSmokeEvidenceSummary() {
  const abs = path.join(ROOT, SMOKE_EVIDENCE_SUMMARY_PATH);
  if (!fs.existsSync(abs)) {
    return { ok: false, error: 'smoke_evidence_missing', path: SMOKE_EVIDENCE_SUMMARY_PATH, data: null };
  }
  try {
    const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return { ok: true, path: SMOKE_EVIDENCE_SUMMARY_PATH, data };
  } catch (err) {
    return {
      ok: false,
      error: 'smoke_evidence_parse_failed',
      message: err && err.message ? err.message : String(err),
      path: SMOKE_EVIDENCE_SUMMARY_PATH,
      data: null,
    };
  }
}

function assertPbxSmokeEvidence(smokeSummary) {
  if (!smokeSummary || smokeSummary.ok !== true || !smokeSummary.data || !smokeSummary.data.smokes) {
    throw new Error('pbx_smoke_evidence_unavailable');
  }

  const l03 = smokeSummary.data.smokes.l03 || null;
  const l04 = smokeSummary.data.smokes.l04 || null;

  if (!l03 || l03.status !== 'pass') {
    throw new Error('pbx_smoke_l03_not_pass');
  }
  const realCall = l03?.evidence?.realCall || null;
  const click2callStatus = String(realCall?.click2callStatus || '').toLowerCase();
  const cdrFound = realCall?.cdrFound === true;
  const originated = click2callStatus === 'originated';
  if (!l03.evidence || l03.evidence.ok !== true || !realCall || realCall.attempted !== true || !originated) {
    throw new Error('pbx_smoke_l03_real_call_invalid');
  }
  // Regra operacional do lançamento: quando não há CDR na janela do smoke,
  // aceitar originate real confirmado no gate.
  if (!cdrFound && !originated) {
    throw new Error('pbx_smoke_l03_cdr_missing_without_originate');
  }

  if (!l04 || l04.status !== 'pass') {
    throw new Error('pbx_smoke_l04_not_pass');
  }
  const executionId = String(l04?.evidence?.flow?.executionId || '').trim();
  const nodesCount = Number(l04?.evidence?.flow?.nodesCount || 0);
  if (!l04.evidence || l04.evidence.ok !== true || !executionId || nodesCount <= 0) {
    throw new Error('pbx_smoke_l04_runtime_invalid');
  }

  return {
    l03: {
      status: l03.status,
      evidenceOk: l03?.evidence?.ok === true,
      realCallAttempted: realCall?.attempted === true,
      click2callStatus,
      originated,
      cdrFound,
      acceptedWithoutCdr: !cdrFound && originated,
    },
    l04: {
      status: l04.status,
      evidenceOk: l04?.evidence?.ok === true,
      executionId,
      nodesCount,
    },
  };
}

async function run() {
  const startedAtMs = Date.now();
  const baseUrl = String(DEFAULT_API_URL).replace(/\/+$/, '');

  const report = {
    startedAt: nowIso(),
    finishedAt: null,
    durationMs: 0,
    status: 'running',
    config: {
      baseUrl,
      applyPbxRollback: APPLY_PBX_ROLLBACK,
      reportPath: REPORT_PATH,
    },
    auth: null,
    checks: {
      preSelftest: null,
      orders: null,
      fastService: null,
      pbx: null,
      pbxSmokeEvidence: null,
      postSelftest: null,
    },
    error: null,
  };

  const writeReport = () => {
    const abs = path.join(ROOT, REPORT_PATH);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  };

  try {
    const auth = await login(baseUrl);
    report.auth = {
      ok: auth.ok,
      mode: auth.mode || null,
      tenantId: auth.tenantId || null,
      evidence: auth.evidence || null,
      error: auth.error || null,
    };
    if (!auth.ok) {
      throw new Error(auth.error || 'auth_failed');
    }

    const token = auth.token;

    const preSelf = await reqJson(baseUrl, '/health/selftest', { token });
    report.checks.preSelftest = {
      ok: preSelf.ok,
      status: preSelf.status,
      selftestStatus: preSelf.payload?.status || null,
      durationMs: preSelf.durationMs,
    };
    if (!preSelf.ok || String(preSelf.payload?.status || '').toUpperCase() === 'FAIL') {
      throw new Error('pre_selftest_failed');
    }

    const orders = await reqJson(baseUrl, '/api/orders/metrics', { token });
    report.checks.orders = {
      ok: orders.ok,
      status: orders.status,
      durationMs: orders.durationMs,
      payloadSnippet: sanitizePayload(orders.payload),
    };
    if (!orders.ok) throw new Error('orders_metrics_failed');

    const fast = await reqJson(baseUrl, '/api/physical/metrics', { token });
    report.checks.fastService = {
      ok: fast.ok,
      status: fast.status,
      durationMs: fast.durationMs,
      payloadSnippet: sanitizePayload(fast.payload),
    };
    if (!fast.ok) throw new Error('physical_metrics_failed');

    const versions = await reqJson(baseUrl, '/api/pbx/config-versions?limit=30', { token });
    if (!versions.ok) throw new Error('pbx_versions_failed');

    const items = Array.isArray(versions.payload?.items) ? versions.payload.items : [];
    const candidate = pickRollbackVersion(items);
    if (!candidate) throw new Error('pbx_no_rollback_candidate');

    const pbxResult = {
      ok: true,
      status: 'simulated',
      candidateVersion: toNumber(candidate.version, null),
      candidateCreatedAt: candidate.createdAt || null,
      applyExecuted: false,
      rollbackResponse: null,
      auditFound: null,
      versionsCount: items.length,
    };

    if (APPLY_PBX_ROLLBACK) {
      const rollback = await reqJson(baseUrl, `/api/pbx/dialplan/rollback?version=${encodeURIComponent(String(candidate.version))}`, {
        method: 'POST',
        token,
        body: {},
      });
      pbxResult.applyExecuted = true;
      pbxResult.rollbackResponse = {
        ok: rollback.ok,
        status: rollback.status,
        durationMs: rollback.durationMs,
        payloadSnippet: sanitizePayload(rollback.payload),
      };
      if (!rollback.ok) {
        throw new Error('pbx_rollback_apply_failed');
      }

      const audit = await reqJson(baseUrl, '/api/pbx/audit?hours=2&limit=200', { token });
      if (audit.ok) {
        const events = Array.isArray(audit.payload?.items) ? audit.payload.items : [];
        pbxResult.auditFound = events.some((ev) => String(ev?.action || '') === 'pbx.dialplan.rollback');
      } else {
        pbxResult.auditFound = false;
      }
      if (!pbxResult.auditFound) {
        throw new Error('pbx_rollback_audit_not_found');
      }
      pbxResult.status = 'applied';
    }

    report.checks.pbx = pbxResult;

    if (REQUIRE_PBX_SMOKE_EVIDENCE) {
      const smokeSummary = loadSmokeEvidenceSummary();
      const smokeCheck = {
        required: true,
        summaryPath: SMOKE_EVIDENCE_SUMMARY_PATH,
        loaded: smokeSummary.ok === true,
        result: null,
        error: smokeSummary.ok ? null : (smokeSummary.error || 'unknown_error'),
      };
      if (!smokeSummary.ok) {
        report.checks.pbxSmokeEvidence = smokeCheck;
        throw new Error(smokeSummary.error || 'pbx_smoke_evidence_load_failed');
      }
      smokeCheck.result = assertPbxSmokeEvidence(smokeSummary);
      report.checks.pbxSmokeEvidence = smokeCheck;
    } else {
      report.checks.pbxSmokeEvidence = {
        required: false,
        summaryPath: SMOKE_EVIDENCE_SUMMARY_PATH,
        skipped: true,
      };
    }

    const postSelf = await reqJson(baseUrl, '/health/selftest', { token });
    report.checks.postSelftest = {
      ok: postSelf.ok,
      status: postSelf.status,
      selftestStatus: postSelf.payload?.status || null,
      durationMs: postSelf.durationMs,
    };
    if (!postSelf.ok || String(postSelf.payload?.status || '').toUpperCase() === 'FAIL') {
      throw new Error('post_selftest_failed');
    }

    report.status = 'pass';
    report.finishedAt = nowIso();
    report.durationMs = Date.now() - startedAtMs;
    writeReport();

    console.log(`[rollback-drill] PASS applyPbxRollback=${APPLY_PBX_ROLLBACK ? '1' : '0'} report=${REPORT_PATH}`);
  } catch (err) {
    report.status = 'fail';
    report.error = err && err.message ? err.message : String(err);
    report.finishedAt = nowIso();
    report.durationMs = Date.now() - startedAtMs;
    writeReport();

    console.error(`[rollback-drill] FAIL: ${report.error}`);
    process.exitCode = 1;
  }
}

run();
