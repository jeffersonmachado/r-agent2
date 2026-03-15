'use strict';

const fs = require('fs');

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const DEFAULT_TENANT_ID = process.env.TEST_TENANT_ID || 'tenant-demo';
const ADMIN_USERNAME = process.env.TEST_ADMIN_USERNAME || 'systemadmin';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'Admin123!';
const REPORT_PATH = '/tmp/scheduling_support_smoke_report.md';
const SKIP_IF_API_UNREACHABLE = String(process.env.SMOKE_SKIP_IF_API_UNREACHABLE || '').trim().toLowerCase() === 'true';

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { response, body };
}

async function isApiReachable() {
  try {
    const response = await fetch(`${BASE_URL}/`, { method: 'GET' });
    return response && response.status > 0;
  } catch {
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeReport(lines) {
  fs.writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`, 'utf8');
}

async function authenticate(report) {
  const rpaTokenResult = await fetchJson(`${BASE_URL}/auth/rpa/token`);
  if (rpaTokenResult.response.ok && rpaTokenResult.body?.token) {
    const loginResult = await fetchJson(`${BASE_URL}/auth/rpa/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: rpaTokenResult.body.token,
        tenantId: DEFAULT_TENANT_ID,
      }),
    });

    if (loginResult.response.ok && loginResult.body?.token) {
      report.push('- Auth mode: RPA token');
      return {
        token: loginResult.body.token,
        tenantId: DEFAULT_TENANT_ID,
        agent: loginResult.body.agent || null,
      };
    }
  }

  const loginResult = await fetchJson(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  });
  assert(loginResult.response.ok, `Falha no login admin fallback: ${loginResult.response.status}`);
  assert(loginResult.body?.token, 'Resposta de /auth/login sem token');
  report.push(`- Auth mode: admin fallback (${ADMIN_USERNAME})`);

  return {
    token: loginResult.body.token,
    tenantId: loginResult.body?.agent?.tenantId || DEFAULT_TENANT_ID,
    agent: loginResult.body?.agent || null,
  };
}

(async () => {
  const report = [];
  report.push('# Scheduling Support API Smoke Report');
  report.push(`- Date: ${new Date().toISOString()}`);
  report.push(`- API Base URL: ${BASE_URL}`);
  report.push(`- Tenant (default): ${DEFAULT_TENANT_ID}`);

  try {
    const reachable = await isApiReachable();
    if (!reachable && SKIP_IF_API_UNREACHABLE) {
      report.push('- Result: SKIPPED');
      report.push(`- Reason: API unreachable at ${BASE_URL}`);
      writeReport(report);
      console.log('Scheduling Support API smoke skipped (API unreachable and skip flag enabled).');
      console.log(`Report: ${REPORT_PATH}`);
      process.exit(0);
    }

    const auth = await authenticate(report);
    const authHeaders = {
      authorization: `Bearer ${auth.token}`,
      'x-tenant-id': auth.tenantId || DEFAULT_TENANT_ID,
    };

    const meResult = await fetchJson(`${BASE_URL}/auth/me`, { headers: authHeaders });
    assert(meResult.response.ok, `GET /auth/me falhou: ${meResult.response.status}`);
    const agent = meResult.body?.agent || auth.agent;
    assert(agent?.id || agent?.username, 'Auth sem agente com id/username');

    const usersResult = await fetchJson(`${BASE_URL}/api/users/search?limit=5`, { headers: authHeaders });
    assert(usersResult.response.ok, `GET /api/users/search falhou: ${usersResult.response.status}`);
    assert(Array.isArray(usersResult.body?.items), 'users/search sem items[]');
    report.push(`- users/search OK: ${usersResult.body.items.length} item(s)`);

    const teamsResult = await fetchJson(`${BASE_URL}/api/teams/search?limit=5`, { headers: authHeaders });
    assert(teamsResult.response.ok, `GET /api/teams/search falhou: ${teamsResult.response.status}`);
    assert(Array.isArray(teamsResult.body?.items), 'teams/search sem items[]');
    report.push(`- teams/search OK: ${teamsResult.body.items.length} item(s)`);

    const purposesResult = await fetchJson(`${BASE_URL}/api/schedule-purposes?limit=10`, { headers: authHeaders });
    assert(purposesResult.response.ok, `GET /api/schedule-purposes falhou: ${purposesResult.response.status}`);
    assert(Array.isArray(purposesResult.body?.items), 'schedule-purposes sem items[]');
    report.push(`- schedule-purposes OK: ${purposesResult.body.items.length} item(s)`);

    const crmResult = await fetchJson(`${BASE_URL}/api/crm/contacts?limit=5&offset=0`, { headers: authHeaders });
    assert(crmResult.response.ok, `GET /api/crm/contacts falhou: ${crmResult.response.status}`);
    assert(Array.isArray(crmResult.body?.items), 'crm/contacts sem items[]');
    report.push(`- crm/contacts OK: ${crmResult.body.items.length} item(s)`);

    const now = new Date();
    const in1h = new Date(now.getTime() + 60 * 60 * 1000);
    const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const startIso = in1h.toISOString();
    const endIso = in2h.toISOString();
    const resourceId = String(agent.id || agent.username);

    const calendarMeResult = await fetchJson(
      `${BASE_URL}/api/calendar/me?start=${encodeURIComponent(now.toISOString())}&end=${encodeURIComponent(new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString())}`,
      { headers: authHeaders },
    );
    assert(calendarMeResult.response.ok, `GET /api/calendar/me falhou: ${calendarMeResult.response.status}`);
    assert(Array.isArray(calendarMeResult.body?.items), 'calendar/me sem items[]');
    report.push(`- calendar/me OK: ${calendarMeResult.body.items.length} item(s)`);

    const createBlockResult = await fetchJson(`${BASE_URL}/api/calendar/resource/${encodeURIComponent(resourceId)}/blocks`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        startAt: startIso,
        endAt: endIso,
        reason: 'smoke-test',
      }),
    });
    assert(createBlockResult.response.status === 201, `POST block falhou: ${createBlockResult.response.status}`);
    const createdId = createBlockResult.body?.item?.id;
    assert(createdId, 'POST block retornou sem item.id');
    report.push(`- create block OK: ${createdId}`);

    const resourceCalResult = await fetchJson(
      `${BASE_URL}/api/calendar/resource/${encodeURIComponent(resourceId)}?start=${encodeURIComponent(now.toISOString())}&end=${encodeURIComponent(new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString())}`,
      { headers: authHeaders },
    );
    assert(resourceCalResult.response.ok, `GET calendar/resource falhou: ${resourceCalResult.response.status}`);
    assert(Array.isArray(resourceCalResult.body?.items), 'calendar/resource sem items[]');
    const hasCreatedBlock = resourceCalResult.body.items.some((item) => item && item.id === createdId);
    assert(hasCreatedBlock, 'block criado nao apareceu em calendar/resource');
    report.push('- calendar/resource OK: block visivel');

    const deleteBlockResult = await fetchJson(`${BASE_URL}/api/calendar/resource/${encodeURIComponent(resourceId)}/blocks/${encodeURIComponent(createdId)}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    assert(deleteBlockResult.response.ok, `DELETE block falhou: ${deleteBlockResult.response.status}`);
    assert(deleteBlockResult.body?.ok === true, 'DELETE block sem ok=true');
    report.push('- delete block OK');

    report.push('');
    report.push('## Samples');
    report.push(`- users/search sample: ${JSON.stringify(usersResult.body.items[0] || null)}`);
    report.push(`- teams/search sample: ${JSON.stringify(teamsResult.body.items[0] || null)}`);
    report.push(`- schedule-purposes sample: ${JSON.stringify(purposesResult.body.items[0] || null)}`);
    report.push(`- crm/contacts sample: ${JSON.stringify(crmResult.body.items[0] || null)}`);
    report.push(`- calendar/me sample: ${JSON.stringify(calendarMeResult.body.items[0] || null)}`);
    report.push('- Result: SUCCESS');

    writeReport(report);
    console.log('Scheduling Support API smoke succeeded.');
    console.log(`Report: ${REPORT_PATH}`);
  } catch (err) {
    writeReport([
      '# Scheduling Support API Smoke Report',
      `- Date: ${new Date().toISOString()}`,
      '- Result: FAILED',
      `- Error: ${err.message}`,
    ]);
    console.error('Scheduling Support API smoke failed:', err.message);
    console.error(`Report: ${REPORT_PATH}`);
    process.exitCode = 1;
  }
})();
