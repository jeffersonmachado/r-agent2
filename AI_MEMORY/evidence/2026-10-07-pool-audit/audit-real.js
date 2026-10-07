'use strict';
/** Passo 4: qualificar a amostra real (nao-sintetica) antes de qualquer metrica. */
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

  console.log('=== tasks COM mission_id (trabalho de missao) vs SEM ===');
  const cross = await c.query(`
    select (mission_id is not null) as tem_missao,
           count(*)::int tasks,
           count(distinct created_by)::int criadores,
           sum(case when created_by like 'jest%' or created_by='TEST' then 1 else 0 end)::int de_teste
      from engineering_tasks group by 1`);
  for (const r of cross.rows) console.log(`  tem_missao=${r.tem_missao}  tasks=${r.tasks}  criadores=${r.criadores}  criadas_por_teste=${r.de_teste}`);

  console.log('\n=== missoes REAIS (mission_id not null) por status ===');
  const byMission = await c.query(`
    select t.mission_id, count(*)::int tasks,
           count(*) filter (where t.status='GREEN')::int green,
           count(*) filter (where t.status='RED')::int red,
           min(t.created_at) mn, max(t.created_at) mx
      from engineering_tasks t where t.mission_id is not null
     group by 1 order by mx desc limit 15`);
  for (const r of byMission.rows) console.log(`  ${String(r.mission_id).slice(0, 12)} tasks=${String(r.tasks).padStart(3)} green=${String(r.green).padStart(3)} red=${String(r.red).padStart(3)}  ${r.mn.toISOString().slice(0, 16)} .. ${r.mx.toISOString().slice(0, 16)}`);

  console.log('\n=== attempts em tasks de MISSAO (amostra candidata) ===');
  const att = await c.query(`
    select a.coder_provider || ':' || a.coder_model as model,
           coalesce(a.error->>'code', a.failure_bundle->>'code', a.status) code,
           count(*)::int n
      from engineering_attempts a join engineering_tasks t on t.id=a.task_id
     where t.mission_id is not null
     group by 1,2 order by 1,3 desc`);
  let total = 0;
  for (const r of att.rows) { total += r.n; console.log(`  ${r.model.padEnd(34)} ${String(r.code).padEnd(24)} ${r.n}`); }
  console.log('  TOTAL attempts em missoes =', total);

  console.log('\n=== attempts NAO-sinteticos (exclui jest*/TEST/criadores de teste) ===');
  const real = await c.query(`
    select a.coder_provider || ':' || a.coder_model as model,
           coalesce(a.error->>'code', a.failure_bundle->>'code', a.status) code,
           count(*)::int n
      from engineering_attempts a join engineering_tasks t on t.id=a.task_id
     where coalesce(t.created_by,'') not like 'jest%' and coalesce(t.created_by,'') <> 'TEST'
     group by 1,2 order by 1,3 desc`);
  let totalReal = 0;
  for (const r of real.rows) { totalReal += r.n; console.log(`  ${r.model.padEnd(34)} ${String(r.code).padEnd(24)} ${r.n}`); }
  console.log('  TOTAL attempts nao-sinteticos =', totalReal);

  console.log('\n=== quantas attempts tem patch_diff REAL (nao-vazio) em missoes ===');
  const pd = await c.query(`
    select count(*)::int total,
           count(*) filter (where a.patch_diff is not null and length(a.patch_diff)>0)::int com_patch,
           count(*) filter (where a.patch_validation is not null and a.patch_validation <> '{}'::jsonb)::int com_validation,
           count(*) filter (where a.context_summary is not null)::int com_contexto
      from engineering_attempts a join engineering_tasks t on t.id=a.task_id
     where t.mission_id is not null`);
  console.log('  ', JSON.stringify(pd.rows[0]));

  await c.end();
})();
