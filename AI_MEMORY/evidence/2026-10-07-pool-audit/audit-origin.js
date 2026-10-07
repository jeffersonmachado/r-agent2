'use strict';
/** Passo 3: separar ORIGEM das tasks (teste sintetico vs trabalho real) e corrigir a leitura. */
const fs = require('fs');
const { Client } = require('/opt/results/ria/r-agent2/node_modules/pg');
function loadEnv() {
  const raw = fs.readFileSync('/opt/results/ria/r-agent2/.env', 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
(async () => {
  const env = loadEnv();
  const c = new Client(env.DATABASE_URL ? { connectionString: env.DATABASE_URL } : {
    host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 5432),
    user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
  });
  await c.connect();

  console.log('=== tasks por created_by (todo o historico) ===');
  const cb = await c.query(`select coalesce(created_by,'(null)') cb, count(*)::int n,
      min(created_at)::date mn, max(created_at)::date mx from engineering_tasks group by 1 order by n desc`);
  for (const r of cb.rows) console.log(`  ${String(r.cb).padEnd(28)} ${String(r.n).padStart(5)}  ${r.mn} .. ${r.mx}`);

  console.log('\n=== anthropic:claude-sonnet-5 — de onde vem? ===');
  const an = await c.query(`
    select t.created_by, t.task_type, t.status, count(*)::int n,
           min(t.created_at) mn, max(t.created_at) mx,
           string_agg(distinct t.objective, ' | ' order by t.objective) filter (where true) as objs
      from engineering_attempts a join engineering_tasks t on t.id = a.task_id
     where a.coder_provider = 'anthropic' and a.coder_model = 'claude-sonnet-5'
     group by 1,2,3 order by n desc`);
  for (const r of an.rows) console.log(`  created_by=${r.created_by} type=${r.task_type} status=${r.status} n=${r.n} (${r.mn} .. ${r.mx})`);
  if (an.rows[0]) console.log('  objetivos (amostra):', String(an.rows[0].objs).slice(0, 300));

  const anAtt = await c.query(`
    select a.status, a.attempt_number, a.error, a.patch_validation, a.promotion_status, a.regression_evidence, a.promotion_evidence
      from engineering_attempts a where a.coder_provider='anthropic' and a.coder_model='claude-sonnet-5' limit 3`);
  anAtt.rows.forEach((r, i) => console.log(`  att#${i + 1}:`, JSON.stringify(r).slice(0, 400)));

  console.log('\n=== deepseek-flash: WHO sao as 123 PATCH_INVALID_FORMAT? ===');
  const df = await c.query(`
    select t.created_by, count(*)::int n, min(t.created_at) mn, max(t.created_at) mx
      from engineering_attempts a join engineering_tasks t on t.id=a.task_id
     where a.coder_model='deepseek-flash' and coalesce(a.error->>'code', a.failure_bundle->>'code')='PATCH_INVALID_FORMAT'
     group by 1 order by n desc`);
  for (const r of df.rows) console.log(`  created_by=${r.created_by} n=${r.n} (${r.mn} .. ${r.mx})`);
  const dfSample = await c.query(`
    select a.id, a.status, a.error, a.patch_diff is not null as has_diff, length(coalesce(a.patch_diff,'')) len, t.objective
      from engineering_attempts a join engineering_tasks t on t.id=a.task_id
     where a.coder_model='deepseek-flash' and coalesce(a.error->>'code', a.failure_bundle->>'code')='PATCH_INVALID_FORMAT'
     order by a.created_at desc limit 3`);
  dfSample.rows.forEach((r, i) => console.log(`  #${i + 1}:`, JSON.stringify(r).slice(0, 380)));

  await c.end();
})();
