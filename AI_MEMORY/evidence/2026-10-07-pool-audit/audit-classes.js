'use strict';
/** Consolida as 5 classes do pool com evidencia. Somente leitura. */
const fs = require('fs');
const { Client } = require('/opt/results/ria/r-agent2/node_modules/pg');
function loadEnv() {
  const raw = fs.readFileSync('/opt/results/ria/r-agent2/.env', 'utf8');
  const env = {};
  for (const line of raw.split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  return env;
}
const token = fs.readFileSync('/tmp/eng.token', 'utf8').trim();
const H = { authorization: `Bearer ${token}`, 'x-tenant-id': '3b7ec7e9-e773-420c-ae31-2c09884f70c9' };
const COHORTS = ['cc1fbca6-d8cb-4ac8-a858-2d221244a8b3', 'SYSTEM:BUG_LOOP_WORKER'];

(async () => {
  const cat = await (await fetch('http://127.0.0.1:3001/engineering/models', { headers: H })).json();
  const models = Array.isArray(cat) ? cat : (cat.models || cat.items || []);

  const c = new Client(loadEnv().DATABASE_URL ? { connectionString: loadEnv().DATABASE_URL } : (() => { const e = loadEnv(); return { host: e.DB_HOST || 'localhost', port: Number(e.DB_PORT || 5432), user: e.DB_USER, password: e.DB_PASSWORD, database: e.DB_NAME }; })());
  await c.connect();
  const rows = (await c.query(`
    select a.coder_provider||':'||a.coder_model model,
           coalesce(a.error->>'code', a.failure_bundle->>'code') code, a.status,
           coalesce((a.patch_validation->>'ok')::boolean,false) vok, t.id task_id, t.status tstatus
      from engineering_attempts a join engineering_tasks t on t.id=a.task_id
     where t.created_by = any($1)`, [COHORTS])).rows;
  const greenTasks = new Set((await c.query(`select id from engineering_tasks where created_by = any($1) and status='GREEN'`, [COHORTS])).rows.map((r) => r.id));
  await c.end();

  const stat = {};
  for (const r of rows) {
    const m = (stat[r.model] = stat[r.model] || { n: 0, responded: 0, patched: 0, green: 0 });
    m.n += 1;
    if (r.code !== 'PROVIDER_UNAVAILABLE') m.responded += 1;
    if (['PATCH_APPLY_FAILED', 'TEST_FAIL', 'TEST_TIMEOUT', 'TEST_BLOCKED'].includes(r.code) || r.status === 'DONE') m.patched += 1;
  }
  for (const r of rows) if (r.status === 'DONE' && greenTasks.has(r.task_id)) stat[r.model].green = (stat[r.model].green || 0) + 1;

  const key = (m) => `${m.providerId}:${m.modelId}`;
  const coderModels = models.filter((m) => (m.roles || []).includes('CODER'));
  const table = coderModels.map((m) => {
    const k = key(m); const s = stat[k] || { n: 0, responded: 0, patched: 0, green: 0 };
    return {
      model: k, costClass: m.costClass,
      configured: true,
      credentialed: !!m.hasCredential,
      catalogHealthy: !!m.healthy,
      runtime_available: s.n > 0 && s.responded > 0,
      patch_capable: s.patched > 0,
      task_capable: s.green > 0,
      realDispatches: s.n, realResponded: s.responded, realPatched: s.patched, realGreens: s.green,
    };
  });

  console.log('=== AS 5 CLASSES (somente modelos com papel CODER) ===');
  console.log('modelo | cost | configured | credentialed | catalog_healthy | runtime_available | patch_capable | task_capable | disp/resp/patched/GREEN reais');
  for (const t of table.sort((a, b) => (b.realDispatches - a.realDispatches))) {
    console.log(`  ${t.model.padEnd(34)} ${String(t.costClass).padEnd(6)} ${String(t.configured).padEnd(10)} ${String(t.credentialed).padEnd(13)} ${String(t.catalogHealthy).padEnd(15)} ${String(t.runtime_available).padEnd(17)} ${String(t.patch_capable).padEnd(13)} ${String(t.task_capable).padEnd(12)} ${t.realDispatches}/${t.realResponded}/${t.realPatched}/${t.realGreens}`);
  }
  const cnt = (f) => table.filter(f).length;
  console.log('\nCONTAGENS:');
  console.log(`  configured      = ${table.length}`);
  console.log(`  credentialed    = ${cnt((t) => t.credentialed)}`);
  console.log(`  runtime_available = ${cnt((t) => t.runtime_available)}`);
  console.log(`  patch_capable   = ${cnt((t) => t.patch_capable)}`);
  console.log(`  task_capable    = ${cnt((t) => t.task_capable)}`);
  console.log(`\n  discrepancia: credentialed mas NUNCA respondeu de verdade = ${table.filter((t) => t.credentialed && t.realDispatches > 0 && t.realResponded === 0).map((t) => t.model).join(', ') || '(nenhum)'}`);
  console.log(`  credentialed + NUNCA usado em execucao real = ${table.filter((t) => t.credentialed && t.realDispatches === 0).map((t) => t.model).join(', ') || '(nenhum)'}`);
  console.log(`  SEM credencial no catalogo (nao conta como capacidade) = ${table.filter((t) => !t.credentialed).map((t) => t.model).join(', ')}`);

  fs.writeFileSync('/tmp/audit-classes.json', JSON.stringify(table, null, 2));
  console.log('\nJSON: /tmp/audit-classes.json');
})();
