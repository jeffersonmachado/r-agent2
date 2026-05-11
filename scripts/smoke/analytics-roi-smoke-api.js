'use strict';

const fs = require('fs');

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const DEFAULT_TENANT_ID = process.env.TEST_TENANT_ID || 'tenant-demo';
const DEFAULT_LOCATION_ID = process.env.TEST_LOCATION_ID || 'system';
const ADMIN_USERNAME = process.env.TEST_ADMIN_USERNAME || 'systemadmin';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'Admin123!';
const REPORT_PATH = '/tmp/analytics_roi_smoke_report.md';
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

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNullableNumber(value) {
  return value == null || Number.isFinite(Number(value));
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
  };
}

function assertRoiPayload(body) {
  assert(body?.ok === true, 'ROI sem ok=true');
  assert(isObject(body.orders), 'ROI sem orders válido');
  assert(isObject(body.leads), 'ROI sem leads válido');
  assert(Array.isArray(body.orderSources), 'ROI sem orderSources[]');
  assert(isObject(body.operationalCosts), 'ROI sem operationalCosts válido');
  assert(isNullableNumber(body.orders.total), 'ROI orders.total inválido');
  assert(isNullableNumber(body.orders.totalRevenue), 'ROI orders.totalRevenue inválido');
  assert(isNullableNumber(body.leads.total), 'ROI leads.total inválido');
}

function assertFunnelPayload(body, expectedLocationId) {
  assert(body?.ok === true, 'Funil sem ok=true');
  assert(body.locationId === expectedLocationId, 'Funil sem locationId esperado');
  assert(isObject(body.locationScope), 'Funil sem locationScope');
  assert(body.locationScope.requested === true, 'Funil deveria marcar requested=true');
  assert(body.locationScope.mode === 'strict_column', 'Funil deveria estar em strict_column');
  assert(body.locationScope.field === 'location_id', 'Funil deveria expor field=location_id');
  assert(isObject(body.locationScope.coverage), 'Funil sem coverage');
  assert(isObject(body.locationScope.coverage.leads), 'Funil sem coverage.leads');
  assert(isObject(body.locationScope.coverage.submissions), 'Funil sem coverage.submissions');
  assert(Array.isArray(body.stages), 'Funil sem stages[]');
  assert(isObject(body.totals), 'Funil sem totals');
  assert(isObject(body.conversionRates), 'Funil sem conversionRates');
  assert(Array.isArray(body.channels), 'Funil sem channels[]');
  assert(Array.isArray(body.orderSources), 'Funil sem orderSources[]');

  ['total', 'withLocation', 'withoutLocation'].forEach((key) => {
    assert(isNullableNumber(body.locationScope.coverage.leads[key]), `Funil coverage.leads.${key} inválido`);
    assert(isNullableNumber(body.locationScope.coverage.submissions[key]), `Funil coverage.submissions.${key} inválido`);
  });
  assert(isNullableNumber(body.locationScope.coverage.leads.rate), 'Funil coverage.leads.rate inválido');
  assert(isNullableNumber(body.locationScope.coverage.submissions.rate), 'Funil coverage.submissions.rate inválido');
}

(async () => {
  const report = [];
  report.push('# Analytics ROI/Funnel API Smoke Report');
  report.push(`- Date: ${new Date().toISOString()}`);
  report.push(`- API Base URL: ${BASE_URL}`);
  report.push(`- Tenant (default): ${DEFAULT_TENANT_ID}`);
  report.push(`- LocationId (target): ${DEFAULT_LOCATION_ID}`);

  try {
    const reachable = await isApiReachable();
    if (!reachable && SKIP_IF_API_UNREACHABLE) {
      report.push('- Result: SKIPPED');
      report.push(`- Reason: API unreachable at ${BASE_URL}`);
      writeReport(report);
      console.log('Analytics ROI/Funnel API smoke skipped (API unreachable and skip flag enabled).');
      console.log(`Report: ${REPORT_PATH}`);
      process.exit(0);
    }

    const auth = await authenticate(report);
    const authHeaders = {
      authorization: `Bearer ${auth.token}`,
      'x-tenant-id': auth.tenantId || DEFAULT_TENANT_ID,
    };

    const roiResult = await fetchJson(
      `${BASE_URL}/analytics/roi?windowDays=30&locationId=${encodeURIComponent(DEFAULT_LOCATION_ID)}`,
      { headers: authHeaders },
    );
    assert(roiResult.response.ok, `GET /analytics/roi falhou: ${roiResult.response.status}`);
    assertRoiPayload(roiResult.body);
    report.push(`- ROI OK: orders=${Number(roiResult.body?.orders?.total || 0)} revenue=${Number(roiResult.body?.orders?.totalRevenue || 0)}`);

    const funnelResult = await fetchJson(
      `${BASE_URL}/analytics/funnel?windowDays=30&locationId=${encodeURIComponent(DEFAULT_LOCATION_ID)}`,
      { headers: authHeaders },
    );
    assert(funnelResult.response.ok, `GET /analytics/funnel falhou: ${funnelResult.response.status}`);
    assertFunnelPayload(funnelResult.body, DEFAULT_LOCATION_ID);
    report.push(`- Funnel OK: leadsCoverage=${String(funnelResult.body?.locationScope?.coverage?.leads?.withLocation || 0)}/${String(funnelResult.body?.locationScope?.coverage?.leads?.total || 0)}`);
    report.push(`- Funnel submissions coverage: ${String(funnelResult.body?.locationScope?.coverage?.submissions?.withLocation || 0)}/${String(funnelResult.body?.locationScope?.coverage?.submissions?.total || 0)}`);

    report.push('');
    report.push('## Samples');
    report.push(`- ROI summary: ${JSON.stringify({ orders: roiResult.body.orders, leads: roiResult.body.leads, locationId: roiResult.body.locationId || null })}`);
    report.push(`- Funnel locationScope: ${JSON.stringify(funnelResult.body.locationScope)}`);
    report.push(`- Funnel totals: ${JSON.stringify(funnelResult.body.totals)}`);
    report.push('- Result: SUCCESS');

    writeReport(report);
    console.log('Analytics ROI/Funnel API smoke succeeded.');
    console.log(`Report: ${REPORT_PATH}`);
  } catch (err) {
    writeReport([
      '# Analytics ROI/Funnel API Smoke Report',
      `- Date: ${new Date().toISOString()}`,
      '- Result: FAILED',
      `- Error: ${err.message}`,
    ]);
    console.error('Analytics ROI/Funnel API smoke failed:', err.message);
    console.error(`Report: ${REPORT_PATH}`);
    process.exitCode = 1;
  }
})();