'use strict';

const fs = require('fs');

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const TENANT_ID = process.env.TEST_TENANT_ID || 'tenant-demo';
const REPORT_PATH = '/tmp/market_intelligence_smoke_report.md';
const ADMIN_USERNAME = process.env.TEST_ADMIN_USERNAME || 'systemadmin';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'Admin123!';

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeReport(lines) {
  fs.writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`, 'utf8');
}

(async () => {
  const report = [];
  report.push('# Market Intelligence API Smoke Report');
  report.push(`- Date: ${new Date().toISOString()}`);
  report.push(`- API Base URL: ${BASE_URL}`);
  report.push(`- Tenant: ${TENANT_ID}`);

  try {
    let authToken = null;
    let authMode = null;

    const rpaTokenResult = await fetchJson(`${BASE_URL}/auth/rpa/token`);
    if (rpaTokenResult.response.ok && rpaTokenResult.body?.token) {
      const loginResult = await fetchJson(`${BASE_URL}/auth/rpa/login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          token: rpaTokenResult.body.token,
          tenantId: TENANT_ID,
        }),
      });

      if (loginResult.response.ok && loginResult.body?.token) {
        authToken = loginResult.body.token;
        authMode = 'rpa';
        report.push('- Auth mode: RPA token');
      }
    }

    if (!authToken) {
      const loginResult = await fetchJson(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          username: ADMIN_USERNAME,
          password: ADMIN_PASSWORD,
        }),
      });
      assert(loginResult.response.ok, `Falha no login admin fallback: ${loginResult.response.status}`);
      assert(loginResult.body?.token, 'Resposta de /auth/login sem token');
      authToken = loginResult.body.token;
      authMode = 'admin_fallback';
      report.push(`- Auth mode: admin fallback (${ADMIN_USERNAME})`);
    }

    const authHeaders = {
      authorization: `Bearer ${authToken}`,
      'x-tenant-id': TENANT_ID,
    };

    const benchmarkResult = await fetchJson(
      `${BASE_URL}/api/market/benchmarks?tenant_key=${encodeURIComponent(TENANT_ID)}&metric_key=cancellation_rate&metric_key=no_show_rate&metric_key=conversion_rate`,
      { headers: authHeaders },
    );
    assert(benchmarkResult.response.ok, `Benchmarks falhou: ${benchmarkResult.response.status}`);
    assert(Array.isArray(benchmarkResult.body?.items), 'Benchmarks sem items');
    assert(benchmarkResult.body.items.length >= 3, 'Benchmarks retornou menos de 3 itens esperados');
    assert(benchmarkResult.body.items.some((item) => item.metricKey === 'cancellation_rate'), 'Benchmarks sem cancellation_rate');
    report.push(`- Benchmarks OK: ${benchmarkResult.body.items.length} item(s)`);

    const patternResult = await fetchJson(
      `${BASE_URL}/api/market/patterns?tenant_key=${encodeURIComponent(TENANT_ID)}&vertical=beauty`,
      { headers: authHeaders },
    );
    assert(patternResult.response.ok, `Patterns falhou: ${patternResult.response.status}`);
    assert(Array.isArray(patternResult.body?.items), 'Patterns sem items');
    assert(patternResult.body.items.length >= 1, 'Patterns retornou vazio');
    report.push(`- Patterns OK: ${patternResult.body.items.length} item(s)`);

    const predictionResult = await fetchJson(
      `${BASE_URL}/api/market/predictions?tenant_key=${encodeURIComponent(TENANT_ID)}&metric_key=attendance_rate&metric_key=cancellation_rate&refresh=true`,
      { headers: authHeaders },
    );
    assert(predictionResult.response.ok, `Predictions falhou: ${predictionResult.response.status}`);
    assert(Array.isArray(predictionResult.body?.items), 'Predictions sem items');
    assert(predictionResult.body.items.some((item) => item.targetMetric === 'attendance_rate'), 'Predictions sem attendance_rate');
    report.push(`- Predictions OK: ${predictionResult.body.items.length} item(s)`);

    const playbookResult = await fetchJson(
      `${BASE_URL}/api/market/playbooks?tenant_key=${encodeURIComponent(TENANT_ID)}&vertical=beauty`,
      { headers: authHeaders },
    );
    assert(playbookResult.response.ok, `Playbooks falhou: ${playbookResult.response.status}`);
    assert(Array.isArray(playbookResult.body?.items), 'Playbooks sem items');
    assert(playbookResult.body.items.length >= 1, 'Playbooks retornou vazio');
    report.push(`- Playbooks OK: ${playbookResult.body.items.length} item(s)`);

    report.push('');
    report.push('## Samples');
    report.push(`- Benchmarks sample: \`${JSON.stringify(benchmarkResult.body.items[0])}\``);
    report.push(`- Pattern sample: \`${JSON.stringify(patternResult.body.items[0])}\``);
    report.push(`- Prediction sample: \`${JSON.stringify(predictionResult.body.items[0])}\``);
    report.push(`- Playbook sample: \`${JSON.stringify(playbookResult.body.items[0])}\``);
    report.push('- Result: SUCCESS');

    writeReport(report);
    console.log('Market Intelligence API smoke succeeded.');
    console.log(`Report: ${REPORT_PATH}`);
  } catch (err) {
    writeReport([
      '# Market Intelligence API Smoke Report',
      `- Date: ${new Date().toISOString()}`,
      '- Result: FAILED',
      `- Error: ${err.message}`,
    ]);
    console.error('Market Intelligence API smoke failed:', err.message);
    console.error(`Report: ${REPORT_PATH}`);
    process.exitCode = 1;
  }
})();
