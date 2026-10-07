'use strict';
/**
 * Auditoria CONTROLADA do pool — v3. SOMENTE LEITURA.
 * Coortes REAIS identificadas por evidencia (nao por suposicao):
 *   A) created_by = 'cc1fbca6-...'  -> as tasks das minhas missoes de engenharia (INC-1..INC-3)
 *   B) created_by = 'SYSTEM:BUG_LOOP_WORKER' -> trabalho autonomo real do bug loop
 * Excluidas com justificativa: jest-review / jest-natural* / jest-regression-governance-test /
 *   TEST / verify-real-task-recovery / RECOVERY:* / repro / diag / sanity / debug-e2e
 *   (jobs de teste/verificacao: patch_validation ausente ou nome de rotina de teste).
 */
const fs = require('fs');
const { Client } = require('/opt/results/ria/r-agent2/node_modules/pg');
function loadEnv() {
  const raw = fs.readFileSync('/opt/results/ria/r-agent2/.env', 'utf8');
  const env = {};
  for (const line of raw.split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  return env;
}
const COHORT_A = 'cc1fbca6-d8cb-4ac8-a858-2d221244a8b3';
const COHORT_B = 'SYSTEM:BUG_LOOP_WORKER';
const pc = (a, b) => (b > 0 ? (Math.round((a / b) * 1000) / 10) + '%' : 'n/a');
const R = (a, b) => (b > 0 ? a / b : null);

const PROVIDER_SUB = (text) => {
  const t = String(text || '');
  if (/429|credits|quota|balance/i.test(t)) return 'QUOTA_429';
  if (/TIMEOUT|excedeu \d+ms|timeout/i.test(t)) return 'TIMEOUT';
  if (/SEM conte|empty|truncat|reasoning/i.test(t)) return 'EMPTY_OR_REASONING';
  return 'OTHER';
};

(async () => {
  const env = loadEnv();
  const c = new Client(env.DATABASE_URL ? { connectionString: env.DATABASE_URL } : {
    host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 5432), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
  });
  await c.connect();

  const rows = (await c.query(`
    select a.id attempt_id, a.task_id, a.status, a.coder_provider||':'||a.coder_model model,
           coalesce(a.error->>'code', a.failure_bundle->>'code') code,
           coalesce(a.error->>'message', a.failure_bundle->>'stderr','') errtext,
           length(coalesce(a.patch_diff,'')) patch_len,
           coalesce((a.patch_validation->>'ok')::boolean,false) validation_ok,
           t.task_type, t.status task_status, t.created_by, t.created_at,
           extract(epoch from (a.completed_at-a.started_at))*1000 wall_ms,
           (select count(*)::int from engineering_test_runs tr where tr.attempt_id=a.id) test_runs,
           (select count(*)::int from engineering_test_runs tr where tr.attempt_id=a.id and tr.status='PASS') test_pass_runs
      from engineering_attempts a join engineering_tasks t on t.id=a.task_id
     where t.created_by in ($1,$2)
     order by a.created_at`, [COHORT_A, COHORT_B])).rows;

  const greenTasks = new Set((await c.query(
    `select id from engineering_tasks where created_by in ($1,$2) and status='GREEN'`, [COHORT_A, COHORT_B],
  )).rows.map((r) => r.id));
  const tel = (await c.query(`
    select e.provider||':'||e.model model, e.role, e.input_tokens in_t, e.output_tokens out_t,
           e.latency_ms, e.estimated_cost cost
      from engineering_telemetry_events e join engineering_tasks t on t.id=e.task_id
     where t.created_by in ($1,$2)`, [COHORT_A, COHORT_B])).rows;
  const revs = (await c.query(`
    select r.attempt_id, r.decision from engineering_reviews r join engineering_attempts a on a.id=r.attempt_id
      join engineering_tasks t on t.id=a.task_id where t.created_by in ($1,$2)`, [COHORT_A, COHORT_B])).rows;
  const regs = (await c.query(`
    select rr.task_id, rr.result from engineering_regression_runs rr join engineering_tasks t on t.id=rr.task_id
     where t.created_by in ($1,$2)`, [COHORT_A, COHORT_B])).rows;
  const revByAtt = new Map(); for (const r of revs) { const a = revByAtt.get(r.attempt_id) || []; a.push(r.decision); revByAtt.set(r.attempt_id, a); }
  const regByTask = new Map(); for (const r of regs) { const a = regByTask.get(r.task_id) || []; a.push(r.result); regByTask.set(r.task_id, a); }

  console.log('=== COORTES REAIS ===');
  for (const [name, cb] of [['A (minhas missoes)', COHORT_A], ['B (bug loop autonomo)', COHORT_B]]) {
    const s = await c.query(`select count(distinct id)::int tasks from engineering_tasks where created_by=$1`, [cb]);
    const a = rows.filter((r) => r.created_by === cb);
    console.log(`  ${name}: tasks=${s.rows[0].tasks} attempts=${a.length} periodo=${a.length ? a[0].created_at.toISOString().slice(0, 10) + ' .. ' + a[a.length - 1].created_at.toISOString().slice(0, 10) : '-'}`);
  }

  const lastDone = new Map();
  for (const r of rows) if (r.status === 'DONE') lastDone.set(r.task_id, r.model);
  const greenByModel = {};
  for (const [tid, model] of lastDone) if (greenTasks.has(tid)) greenByModel[model] = (greenByModel[model] || 0) + 1;

  const stage = (r) => {
    const code = r.code;
    if (code === 'PROVIDER_UNAVAILABLE' || code === 'invalid_request_error') return 'S0_dispatch';
    if (['PATCH_INVALID_FORMAT', 'PATCH_REJECTED', 'PATCH_BODY_MISSING_PREFIX', 'NO_PATCH_SCOPE'].includes(code)) return 'S2_patch_estrutural';
    if (code === 'PATCH_APPLY_FAILED') return 'S3_nao_aplicou';
    if (['TEST_FAIL', 'TEST_TIMEOUT', 'TEST_BLOCKED'].includes(code)) return 'S4_teste_falhou';
    if (['RESUME_ABANDONED_INCOMPLETE_PHASE', 'FAILED', 'TEST_INFRA_ERROR'].includes(code)) return 'S3_nao_aplicou';
    if (r.status === 'DONE') return 'S6_passou_teste';
    return 'S1_sem_patch';
  };

  const STAGES = ['S0_dispatch', 'S1_sem_patch', 'S2_patch_estrutural', 'S3_nao_aplicou', 'S4_teste_falhou', 'S6_passou_teste'];
  const agg = {};
  for (const r of rows) {
    const m = (agg[r.model] = agg[r.model] || { model: r.model, n: 0, st: {}, tasks: new Set(), wall: [], reviewRej: 0, regFail: 0, provSub: {} });
    m.n += 1; m.tasks.add(r.task_id); const s = stage(r); m.st[s] = (m.st[s] || 0) + 1;
    if (r.wall_ms > 0 && r.wall_ms < 3600000) m.wall.push(Number(r.wall_ms));
    if (r.code === 'PROVIDER_UNAVAILABLE') { const k = PROVIDER_SUB(r.errtext); m.provSub[k] = (m.provSub[k] || 0) + 1; }
    const dd = revByAtt.get(r.attempt_id) || []; if (dd.some((d) => /REJECT/i.test(String(d)))) m.reviewRej += 1;
    const rr = regByTask.get(r.task_id) || []; if (rr.some((x) => /FAIL/i.test(String(x)))) m.regFail += 1;
  }
  const tok = {};
  for (const t of tel) { if (t.role !== 'CODER') continue; const x = (tok[t.model] = tok[t.model] || { i: 0, o: 0, cost: 0 }); if (t.in_t) x.i += +t.in_t; if (t.out_t) x.o += +t.out_t; if (t.cost && !/unknown/i.test(t.cost)) x.cost += 1; }
  const qq = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };

  console.log('\n=== FUNIL POR MODELO (coortes A+B, execucao real) ===');
  console.log('estagios: S0=provider falhou  S1=respondeu sem patch  S2=patch estrutural invalido  S3=patch valido mas nao aplicou  S4=aplicou e teste falhou  S6=passou teste');
  const out = [];
  for (const m of Object.values(agg).sort((a, b) => b.n - a.n)) {
    const g = greenByModel[m.model] || 0;
    const st = (k) => m.st[k] || 0;
    const responded = m.n - st('S0_dispatch');
    const patchOk = st('S3_nao_aplicou') + st('S4_teste_falhou') + st('S6_passou_teste');
    const applied = st('S4_teste_falhou') + st('S6_passou_teste');
    const totalWall = m.wall.reduce((a, b) => a + b, 0);
    const o = {
      model: m.model, dispatches: m.n, tasks: m.tasks.size, greens: g,
      S0_provider: st('S0_dispatch'), S1_noPatch: st('S1_sem_patch'), S2_structInvalid: st('S2_patch_estrutural'),
      S3_notApplied: st('S3_nao_aplicou'), S4_testFailed: st('S4_teste_falhou'), S6_testPassed: st('S6_passou_teste'),
      reviewRejected: m.reviewRej, regressionFail: m.regFail, providerSubclass: m.provSub,
      P_runtimeResponse: R(responded, m.n), P_validPatch_givenResponse: R(patchOk, responded),
      P_applied_givenValid: R(applied, patchOk), P_testPass_givenApplied: R(st('S6_passou_teste'), applied),
      P_GREEN_givenDispatch: R(g, m.n),
      p50Ms: qq(m.wall, 0.5), p95Ms: qq(m.wall, 0.95), totalTimeMs: totalWall,
      E_timePerGreenMs: g > 0 ? Math.round(totalWall / g) : null,
      tokensIn: (tok[m.model] || {}).i || 0, tokensOut: (tok[m.model] || {}).o || 0,
      costKnownEvents: (tok[m.model] || {}).cost || 0,
    };
    out.push(o);
    console.log(`\n  ${m.model}  dispatch=${m.n} tasks=${m.tasks.size} GREENs=${g}`);
    console.log(`    S0=${o.S0_provider} S1=${o.S1_noPatch} S2=${o.S2_structInvalid} S3=${o.S3_notApplied} S4=${o.S4_testFailed} S6=${o.S6_testPassed} review_rej=${o.reviewRejected} reg_fail=${o.regressionFail}`);
    console.log(`    provider_fail_subclasse=${JSON.stringify(m.provSub)}`);
    console.log(`    P(resp)=${pc(responded, m.n)} P(patch_valido|resp)=${pc(patchOk, responded)} P(aplicado|valido)=${pc(applied, patchOk)} P(teste_ok|aplicado)=${pc(st('S6_passou_teste'), applied)} P(GREEN|dispatch)=${pc(g, m.n)}`);
    console.log(`    p50=${o.p50Ms}ms p95=${o.p95Ms}ms tokens=${o.tokensIn}/${o.tokensOut} custo_conhecido=${o.costKnownEvents} E[tempo/GREEN]=${o.E_timePerGreenMs || 'n/a'}`);
  }

  console.log('\n=== CLASSIFICACAO DAS FALHAS (coortes A+B) ===');
  const cls = {};
  for (const r of rows) {
    const code = r.code || (r.status === 'DONE' ? 'OK_DONE' : r.status);
    const map = {
      PROVIDER_UNAVAILABLE: 'PROVIDER_FAILURE', invalid_request_error: 'PROVIDER_FAILURE',
      PATCH_INVALID_FORMAT: 'PATCH_FORMAT_FAILURE', PATCH_REJECTED: 'PATCH_FORMAT_FAILURE',
      PATCH_BODY_MISSING_PREFIX: 'PATCH_FORMAT_FAILURE', NO_PATCH_SCOPE: 'PATCH_FORMAT_FAILURE',
      PATCH_APPLY_FAILED: 'PATCH_APPLY_FAILURE', TEST_FAIL: 'TEST_FAILURE', TEST_TIMEOUT: 'TEST_FAILURE',
      TEST_BLOCKED: 'TEST_FAILURE', RESUME_ABANDONED_INCOMPLETE_PHASE: 'APPLICATION_CODE_FAILURE',
      FAILED: 'APPLICATION_CODE_FAILURE', TEST_INFRA_ERROR: 'APPLICATION_CODE_FAILURE',
    };
    const k = code === 'OK_DONE' ? 'OK_DONE' : (map[code] || 'APPLICATION_CODE_FAILURE');
    cls[`${k}:${code}`] = (cls[`${k}:${code}`] || 0) + 1;
  }
  Object.entries(cls).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(52)} ${v}`));

  fs.writeFileSync('/tmp/audit-final.json', JSON.stringify({ generatedAt: new Date().toISOString(), cohorts: { A: COHORT_A, B: COHORT_B }, sample: { attempts: rows.length, tasks: new Set(rows.map((r) => r.task_id)).size }, perModel: out, failures: cls }, null, 2));
  console.log('\nJSON: /tmp/audit-final.json');
  await c.end();
})();
