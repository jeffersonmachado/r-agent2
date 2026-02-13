#!/usr/bin/env node
'use strict';

/**
 * Smoke L-04: PBX call events (cdr scanner) -> event trigger -> flow runtime.
 *
 * Estratégia determinística no stack de teste:
 * - cria flow com metadata.eventTriggers para CallEnded (source=pbx.cdr)
 * - injeta 1 linha em pbx_cdr via container API (DB do compose de teste)
 * - aguarda scanner/dispatcher executarem
 * - valida execução em /api/executions (correlationId=uniqueid)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
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
  const txt = await res.text().catch(() => '');
  let payload = {};
  try {
    payload = txt ? JSON.parse(txt) : {};
  } catch (_) {
    payload = { raw: txt };
  }
  return { ok: res.ok, status: res.status, payload };
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractJsonObjects(text) {
  const src = String(text || '');
  const out = [];
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] !== '{') continue;
    let inString = false;
    let escaped = false;
    let depth = 0;
    for (let j = i; j < src.length; j += 1) {
      const ch = src[j];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = src.slice(i, j + 1);
          try {
            out.push(JSON.parse(candidate));
          } catch (_) {
            // ignora trechos que não são JSON válido.
          }
          i = j;
          break;
        }
      }
    }
  }
  return out;
}

function evidencePath() {
  return String(process.env.PBX_CALL_EVENTS_RUNTIME_EVIDENCE_PATH || 'qa/l04-pbx-call-events-runtime-evidence.json');
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

function buildEventTriggerFlow(flowId, tenantId, uniqueid) {
  return {
    id: flowId,
    tenantId,
    name: `PBX CallEvents Runtime Smoke ${uniqueid}`,
    description: 'Smoke L-04',
    nodes: [
      { id: 'start-1', type: 'start', position: { x: 80, y: 100 }, next: 'set-1' },
      {
        id: 'set-1',
        type: 'set_variable',
        position: { x: 260, y: 100 },
        next: 'end-1',
        config: {
          assignments: {
            l04_marker: uniqueid,
            l04_source: 'pbx.cdr',
            l04_trigger: 'CallEnded',
          },
        },
      },
      { id: 'end-1', type: 'end', position: { x: 460, y: 100 } },
    ],
    connections: [
      { from: 'start-1', to: 'set-1' },
      { from: 'set-1', to: 'end-1' },
    ],
    metadata: {
      environment: 'dev',
      createdBy: 'system-smoke',
      eventTriggers: [
        { type: 'CallEnded', source: 'pbx.cdr' },
      ],
    },
  };
}

async function upsertFlow(baseUrl, token, flow) {
  const create = await reqJson(`${baseUrl}/flows`, {
    method: 'POST',
    token,
    body: flow,
  });
  if (create.ok) return create.payload?.id || flow.id;
  if (create.status !== 409) throw new Error(`flow_create_failed:${create.status}`);

  const update = await reqJson(`${baseUrl}/flows/${encodeURIComponent(flow.id)}`, {
    method: 'PUT',
    token,
    body: flow,
  });
  if (!update.ok) throw new Error(`flow_update_failed:${update.status}`);
  return update.payload?.id || flow.id;
}

async function insertSyntheticCdr({ tenantId, uniqueid, cdrId }) {
  const mode = String(process.env.PBX_CALL_EVENTS_RUNTIME_INSERT_MODE || 'compose_exec').toLowerCase();
  if (mode === 'direct') {
    // Execução dentro do container API: acesso direto ao Sequelize local.
    // eslint-disable-next-line global-require
    const { connect, getSequelize, close } = require('../api/db/sequelize');
    return await (async () => {
      await connect();
      const sq = getSequelize();
      await sq.query(
        "INSERT INTO pbx_cdr (id, tenant_key, uniqueid, calldate, src, dst, disposition, duration, billsec, accountcode, userfield, extra, created_at, updated_at) VALUES (:id, :tenant, :uniqueid, NOW(), :src, :dst, :disp, :dur, :bill, :accountcode, :userfield, '{}'::jsonb, NOW(), NOW()) ON CONFLICT (id) DO NOTHING",
        {
          replacements: {
            id: cdrId,
            tenant: tenantId,
            uniqueid,
            src: '1000',
            dst: '2000',
            disp: 'ANSWERED',
            dur: 12,
            bill: 9,
            accountcode: tenantId,
            userfield: 'smoke_l04',
          },
        },
      );
      await close();
    })();
  }

  const js = `
const { connect, getSequelize, close } = require('./api/db/sequelize');
(async () => {
  await connect();
  const sq = getSequelize();
  await sq.query(
    "INSERT INTO pbx_cdr (id, tenant_key, uniqueid, calldate, src, dst, disposition, duration, billsec, accountcode, userfield, extra, created_at, updated_at) VALUES (:id, :tenant, :uniqueid, NOW(), :src, :dst, :disp, :dur, :bill, :accountcode, :userfield, '{}'::jsonb, NOW(), NOW()) ON CONFLICT (id) DO NOTHING",
    {
      replacements: {
        id: process.argv[1],
        tenant: process.argv[2],
        uniqueid: process.argv[3],
        src: '1000',
        dst: '2000',
        disp: 'ANSWERED',
        dur: 12,
        bill: 9,
        accountcode: process.argv[2],
        userfield: 'smoke_l04',
      },
    }
  );
  await close();
  process.stdout.write('ok');
})().catch(async (e) => {
  try { await close(); } catch (_) {}
  console.error(e);
  process.exit(1);
});
`.trim();

  const out = spawnSync(
    'docker',
    ['compose', '-f', 'docker-compose.test.yml', 'exec', '-T', 'api', 'node', '-e', js, cdrId, tenantId, uniqueid],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  if (out.status !== 0) {
    throw new Error(`synthetic_cdr_insert_failed:${out.status}:${(out.stderr || '').trim()}`);
  }
}

async function runPbxEventPipeline({ tenantId, uniqueid }) {
  const mode = String(process.env.PBX_CALL_EVENTS_RUNTIME_INSERT_MODE || 'compose_exec').toLowerCase();
  if (mode === 'direct') {
    // eslint-disable-next-line global-require
    const { connect, getSequelize, close } = require('../api/db/sequelize');
    // eslint-disable-next-line global-require
    const { scanPbxCdrAndEmitEvents } = require('../api/services/pbx/pbxCallEventsService');
    // eslint-disable-next-line global-require
    const { dispatchOne } = require('../api/services/eventLedgerTriggerDispatcher');
    await connect();
    const sq = getSequelize();
    const scan = await scanPbxCdrAndEmitEvents({ consumer: `pbx_cdr_l04_${Date.now()}`, batchSize: 1000 });
    const [events] = await sq.query(
      "SELECT id FROM event_ledger WHERE tenant_key = :tenant AND source = 'pbx.cdr' AND correlation_id = :cid ORDER BY received_at ASC",
      { replacements: { tenant: tenantId, cid: uniqueid } },
    );
    const evIds = (Array.isArray(events) ? events : []).map((r) => String(r.id || '')).filter(Boolean);
    for (const eventId of evIds) {
      // eslint-disable-next-line no-await-in-loop
      await dispatchOne({ tenantId, consumer: `webhooks_l04_${Date.now()}`, eventId, dispatchTargets: ['flows'] });
    }
    await close();
    return { scan, eventIds: evIds };
  }

  const marker = '__L04_PIPELINE_JSON__';
  const js = `
const { connect, getSequelize, close } = require('./api/db/sequelize');
const { scanPbxCdrAndEmitEvents } = require('./api/services/pbx/pbxCallEventsService');
const { dispatchOne } = require('./api/services/eventLedgerTriggerDispatcher');
(async () => {
  await connect();
  const sq = getSequelize();
  const tenant = process.argv[1];
  const cid = process.argv[2];
  const scan = await scanPbxCdrAndEmitEvents({ consumer: 'pbx_cdr_l04_' + Date.now(), batchSize: 1000 });
  const [events] = await sq.query(
    "SELECT id FROM event_ledger WHERE tenant_key = :tenant AND source = 'pbx.cdr' AND correlation_id = :cid ORDER BY received_at ASC",
    { replacements: { tenant, cid } }
  );
  const evIds = (Array.isArray(events) ? events : []).map((r) => String(r.id || '')).filter(Boolean);
  for (const eventId of evIds) {
    await dispatchOne({ tenantId: tenant, consumer: 'webhooks_l04_' + Date.now(), eventId, dispatchTargets: ['flows'] });
  }
  process.stdout.write('${marker}' + JSON.stringify({ scan, eventIds: evIds }));
  await close();
})().catch(async (e) => {
  try { await close(); } catch (_) {}
  console.error(e);
  process.exit(1);
});
`.trim();
  const out = spawnSync(
    'docker',
    ['compose', '-f', 'docker-compose.test.yml', 'exec', '-T', 'api', 'node', '-e', js, tenantId, uniqueid],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  if (out.status !== 0) {
    throw new Error(`pipeline_exec_failed:${out.status}:${(out.stderr || '').trim()}`);
  }
  const txt = String(out.stdout || '').trim();
  const stderrTxt = String(out.stderr || '').trim();
  try {
    const idx = txt.lastIndexOf(marker);
    if (idx >= 0) {
      const payload = txt.slice(idx + marker.length).trim();
      const parsed = extractJsonObjects(payload).find((obj) => Array.isArray(obj?.eventIds));
      if (parsed) return parsed;
    }
    const fallback = extractJsonObjects(txt).find((obj) => Array.isArray(obj?.eventIds));
    if (fallback) return fallback;
    throw new Error('payload_not_found');
  } catch (_) {
    throw new Error(
      `pipeline_output_parse_failed:stdout=${txt.slice(0, 280)}:stderr=${stderrTxt.slice(0, 180)}`,
    );
  }
}

async function waitExecution({ baseUrl, token, correlationId, flowId }) {
  const startedAt = Date.now();
  for (let i = 0; i < 120; i += 1) {
    const execList = await reqJson(
      `${baseUrl}/api/executions?correlationId=${encodeURIComponent(correlationId)}&limit=20`,
      { method: 'GET', token },
    );
    expect(execList.ok && Array.isArray(execList.payload?.items), `executions_list_failed:${execList.status}`);
    const item = execList.payload.items.find((it) => String(it?.flow_id || it?.flowId || '') === flowId);
    if (item) {
      const execId = String(item.id || '');
      const details = await reqJson(`${baseUrl}/api/executions/${encodeURIComponent(execId)}`, {
        method: 'GET',
        token,
      });
      expect(details.ok && details.payload?.ok === true, `execution_detail_failed:${details.status}`);
      return {
        found: true,
        latencyMs: Date.now() - startedAt,
        execution: details.payload?.execution || item,
        nodes: Array.isArray(details.payload?.nodes) ? details.payload.nodes : [],
      };
    }
    await sleep(1000);
  }
  return { found: false, latencyMs: Date.now() - startedAt, execution: null, nodes: [] };
}

async function main() {
  const baseUrl = apiBaseUrl();
  const auth = await login(baseUrl);
  const ts = Date.now();
  const uniqueid = `l04-${ts}`;
  const cdrId = `cdr-${uniqueid}`;
  const flowId = `flow-pbx-call-events-runtime-smoke-${ts}`;

  const flow = buildEventTriggerFlow(flowId, auth.tenantId, uniqueid);
  await upsertFlow(baseUrl, auth.token, flow);
  await insertSyntheticCdr({ tenantId: auth.tenantId, uniqueid, cdrId });

  const pipeline = await runPbxEventPipeline({
    tenantId: auth.tenantId,
    uniqueid,
  });
  expect(Array.isArray(pipeline.eventIds) && pipeline.eventIds.length > 0, 'pbx_events_not_emitted');

  const waited = await waitExecution({
    baseUrl,
    token: auth.token,
    correlationId: uniqueid,
    flowId,
  });
  expect(waited.found, 'event_trigger_execution_not_found');

  const metrics = await reqJson(`${baseUrl}/api/ops/event-ledger/metrics?windowMinutes=30`, {
    method: 'GET',
    token: auth.token,
  });
  const hasMetrics = metrics.ok && metrics.payload?.ok === true;

  const evidence = {
    smoke: 'L-04',
    generatedAt: new Date().toISOString(),
    ok: true,
    authMode: auth.mode,
    tenantId: auth.tenantId,
    cdr: {
      id: cdrId,
      uniqueid,
      source: 'synthetic_insert',
    },
    trigger: {
      type: 'CallEnded',
      source: 'pbx.cdr',
    },
    pipeline: {
      scan: pipeline.scan || null,
      eventIds: pipeline.eventIds,
    },
    flow: {
      flowId,
      executionId: String(waited.execution?.id || ''),
      status: String(waited.execution?.status || ''),
      latencyMs: waited.latencyMs,
      nodesCount: waited.nodes.length,
    },
    dispatch: {
      metricsAvailable: hasMetrics,
      doneRecent: Number(metrics.payload?.dispatch?.summary?.doneRecent || 0),
      deadRecent: Number(metrics.payload?.dispatch?.summary?.deadRecent || 0),
      flowTriggerFailuresRecent: Number(metrics.payload?.dispatch?.summary?.flowTriggerFailuresRecent || 0),
    },
  };
  const evPath = writeEvidence(evidence);
  // eslint-disable-next-line no-console
  console.log(
    `[pbx-call-events-runtime-smoke] OK auth=${auth.mode} flowId=${flowId} executionId=${evidence.flow.executionId} latencyMs=${evidence.flow.latencyMs} evidence=${evPath}`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[pbx-call-events-runtime-smoke] FAIL', err?.message || err);
    process.exit(1);
  });
}

module.exports = { main };
