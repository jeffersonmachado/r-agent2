'use strict';
/**
 * Auditoria controlada do pool do Engineering Router — SOMENTE LEITURA.
 * Separa: disponibilidade de provider, confiabilidade de geracao de patch e sucesso de tarefa.
 * Nao altera codigo funcional nem dado algum.
 */
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

const WINDOW_START = process.env.AUDIT_WINDOW_START || '2026-10-06T00:00:00Z';
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const q = (v) => (v === null || v === undefined ? 'n/a' : v);

(async () => {
  const env = loadEnv();
  const c = new Client(env.DATABASE_URL ? { connectionString: env.DATABASE_URL } : {
    host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 5432),
    user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
  });
  await c.connect();

  console.log('=== JANELA ===');
  console.log(`created_at >= ${WINDOW_START} (classe: CODE_GENERATION/BUG_FIX/COMPLEX_BUG_FIX)`);
  const win = await c.query(
    `select count(*)::int n, min(created_at) mn, max(created_at) mx from engineering_tasks where created_at >= $1`, [WINDOW_START],
  );
  console.log(`tasks na janela: ${win.rows[0].n} (de ${win.rows[0].mn} a ${win.rows[0].mx})`);

  console.log('\n=== 1) DISTRIBUICAO DE RESULTADO POR ATTEMPT (janela, CODER) ===');
  const dist = await c.query(`
    select a.coder_provider || ':' || a.coder_model as model,
           coalesce(a.error->>'code', a.failure_bundle->>'code', a.status) as code,
           count(*)::int as n
      from engineering_attempts a
      join engineering_tasks t on t.id = a.task_id
     where t.created_at >= $1
       and t.task_type in ('CODE_GENERATION','BUG_FIX','COMPLEX_BUG_FIX')
     group by 1,2 order by 1, 3 desc`, [WINDOW_START]);
  for (const r of dist.rows) console.log(`  ${r.model.padEnd(34)} ${String(r.code).padEnd(22)} ${r.n}`);

  console.log('\n=== 2) FUNIL POR MODELO (janela, CODER) ===');
  const funnel = await c.query(`
    with base as (
      select a.coder_provider || ':' || a.coder_model as model,
             a.id, a.status,
             coalesce(a.error->>'code', a.failure_bundle->>'code') as code,
             (a.patch_diff is not null and length(a.patch_diff) > 0) as has_diff,
             coalesce((a.patch_validation->>'ok')::boolean, false) as validation_ok,
             (a.started_at is not null and a.completed_at is not null) as has_timing,
             extract(epoch from (a.completed_at - a.started_at)) * 1000 as wall_ms
        from engineering_attempts a
        join engineering_tasks t on t.id = a.task_id
       where t.created_at >= $1
         and t.task_type in ('CODE_GENERATION','BUG_FIX','COMPLEX_BUG_FIX'))
    select model,
           count(*)::int dispatched,
           count(*) filter (where has_diff)::int com_diff,
           count(*) filter (where validation_ok)::int diff_valido,
           count(*) filter (where code = 'PATCH_APPLY_FAILED')::int apply_fail,
           count(*) filter (where code = 'PATCH_BODY_MISSING_PREFIX')::int body_sem_prefixo,
           count(*) filter (where code = 'PATCH_INVALID_FORMAT')::int formato_invalido,
           count(*) filter (where code = 'TEST_FAIL')::int test_fail,
           count(*) filter (where code is null and status = 'DONE')::int done_sem_erro,
           count(*) filter (where code = 'PROVIDER_UNAVAILABLE')::int provider_unavail,
           percentile_disc(0.5) within group (order by wall_ms)::int as p50_ms,
           percentile_disc(0.95) within group (order by wall_ms)::int as p95_ms
      from base group by model order by dispatched desc`, [WINDOW_START]);
  for (const r of funnel.rows) {
    console.log(`  ${r.model}`);
    console.log(`     dispatched=${r.dispatched} com_diff=${r.com_diff} diff_valido=${r.diff_valido} apply_fail=${r.apply_fail} body_sem_prefixo=${r.body_sem_prefixo} formato_invalido=${r.formato_invalido} test_fail=${r.test_fail} done=${r.done_sem_erro} provider_unavail=${r.provider_unavail}`);
    console.log(`     p50=${r.p50_ms}ms p95=${r.p95_ms}ms`);
  }

  console.log('\n=== 3) TELEMETRIA POR MODELO/ROLE (janela) ===');
  const tel = await c.query(`
    select e.role, e.provider || ':' || e.model as model, count(*)::int events,
           count(*) filter (where e.input_tokens is not null)::int com_tokens,
           sum(e.input_tokens)::bigint in_tok, sum(e.output_tokens)::bigint out_tok,
           count(*) filter (where e.estimated_cost not in ('UNKNOWN', 'unknown'))::int com_custo,
           avg(e.latency_ms) filter (where e.latency_ms is not null)::int avg_lat,
           count(*) filter (where e.test_pass is true)::int test_pass_true,
           count(*) filter (where e.test_pass is false)::int test_pass_false,
           count(*) filter (where e.review_result is not null)::int com_review
      from engineering_telemetry_events e
      join engineering_tasks t on t.id = e.task_id
     where t.created_at >= $1
     group by 1,2 order by events desc`, [WINDOW_START]);
  for (const r of tel.rows) {
    console.log(`  [${r.role}] ${r.model.padEnd(32)} events=${r.events} tokens=${q(r.in_tok)}/${q(r.out_tok)} com_custo=${r.com_custo} avg_lat=${q(r.avg_lat)}ms testPass=${r.test_pass_true}/${r.test_pass_false}`);
  }

  console.log('\n=== 4) test_runs NA JANELA (por status) ===');
  const tr = await c.query(`
    select tr.status, count(*)::int n, avg(tr.duration_ms)::int avg_ms
      from engineering_test_runs tr
      join engineering_attempts a on a.id = tr.attempt_id
      join engineering_tasks t on t.id = a.task_id
     where t.created_at >= $1 group by 1 order by n desc`, [WINDOW_START]);
  for (const r of tr.rows) console.log(`  ${String(r.status).padEnd(12)} ${r.n} (avg ${r.avg_ms}ms)`);

  console.log('\n=== 5) REVIEWS NA JANELA (por decisao) ===');
  const rv = await c.query(`
    select coalesce(r.decision, 'NULL') decision, r.reviewer_provider || ':' || r.reviewer_model as reviewer, count(*)::int n
      from engineering_reviews r
      join engineering_attempts a on a.id = r.attempt_id
      join engineering_tasks t on t.id = a.task_id
     where t.created_at >= $1 group by 1,2 order by n desc`, [WINDOW_START]);
  for (const r of rv.rows) console.log(`  ${r.decision.padEnd(14)} ${String(r.reviewer).padEnd(30)} ${r.n}`);

  console.log('\n=== 6) REGRESSAO NA JANELA (por resultado) ===');
  const rg = await c.query(`
    select coalesce(rr.result,'NULL') result, count(*)::int n
      from engineering_regression_runs rr
      join engineering_tasks t on t.id = rr.task_id
     where t.created_at >= $1 group by 1 order by n desc`, [WINDOW_START]);
  for (const r of rg.rows) console.log(`  ${String(r.result).padEnd(16)} ${r.n}`);

  console.log('\n=== 7) RESULTADO FINAL DAS TASKS NA JANELA ===');
  const tk = await c.query(`
    select task_type, status, count(*)::int n from engineering_tasks
     where created_at >= $1 group by 1,2 order by 1,3 desc`, [WINDOW_START]);
  for (const r of tk.rows) console.log(`  ${r.task_type.padEnd(18)} ${r.status.padEnd(12)} ${r.n}`);

  console.log('\n=== 8) MISSAO DO INC-2/INC-3 (ca56cbdc) — janela DA CLASSE ===');
  const inc = await c.query(`
    select t.id, t.task_type, t.status, t.mission_version,
           (select count(*)::int from engineering_attempts a where a.task_id = t.id) attempts,
           (select string_agg(distinct a.coder_provider || ':' || a.coder_model, ', ')
              from engineering_attempts a where a.task_id = t.id) modelos
      from engineering_tasks t
     where t.mission_id = 'ca56cbdc-3280-4be8-beff-f9301199fc9f'
     order by t.created_at`, []);
  for (const r of inc.rows) console.log(`  v${String(r.mission_version).padEnd(3)} ${r.task_type.padEnd(16)} ${r.status.padEnd(12)} att=${String(r.attempts).padEnd(3)} ${String(r.modelos || '').slice(0, 90)}`);

  await c.end();
})();
