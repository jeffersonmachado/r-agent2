'use strict';
/**
 * Mede o ENVENENAMENTO DA EVIDENCIA do ranking do Router.
 * Compara a evidencia que o Router REALMENTE usa (200 tasks mais recentes do task_type, SEM filtro de origem)
 * com a evidencia LIMPA (somente coortes de execucao real).
 * Usa o modulo REAL do ranking. Somente leitura.
 */
const fs = require('fs');
const { Client } = require('/opt/results/ria/r-agent2/node_modules/pg');
const { aggregateEvidenceFromAttempts } = require('/opt/results/ria/r-agent2/engine/engineeringRouter/modelDecision');

function loadEnv() {
  const raw = fs.readFileSync('/opt/results/ria/r-agent2/.env', 'utf8');
  const env = {};
  for (const line of raw.split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  return env;
}
const COHORTS = ['cc1fbca6-d8cb-4ac8-a858-2d221244a8b3', 'SYSTEM:BUG_LOOP_WORKER'];

(async () => {
  const env = loadEnv();
  const c = new Client(env.DATABASE_URL ? { connectionString: env.DATABASE_URL } : {
    host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 5432), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
  });
  await c.connect();

  async function buildEvidence(filterSql, params) {
    const tasks = (await c.query(`
      select t.id, t.status from engineering_tasks t
       where t.task_type in ('CODE_GENERATION','BUG_FIX','COMPLEX_BUG_FIX') ${filterSql}
       order by t.created_at desc limit 200`, params)).rows;
    const ids = tasks.map((t) => t.id);
    if (!ids.length) return { evidence: new Map(), tasks: 0 };
    const atts = (await c.query(`
      select a.task_id, a.status, a.coder_provider, a.coder_model, a.error, a.started_at, a.completed_at
        from engineering_attempts a where a.task_id = any($1) order by a.created_at asc`, [ids])).rows;
    return { evidence: aggregateEvidenceFromAttempts({ tasks, attempts: atts }), tasks: tasks.length, attempts: atts.length };
  }

  // (1) como o Router faz hoje: 200 mais recentes do task_type, SEM filtro de origem
  const asIs = await buildEvidence('', []);
  // (2) evidencia limpa: apenas coortes de execucao REAL
  const clean = await buildEvidence('and t.created_by = any($1)', [COHORTS]);

  console.log('=== AMOSTRAS ===');
  console.log(`  como o Router usa hoje: tasks=${asIs.tasks} attempts=${asIs.attempts}`);
  console.log(`  evidencia limpa:        tasks=${clean.tasks} attempts=${clean.attempts}`);

  const keys = [...new Set([...asIs.evidence.keys(), ...clean.evidence.keys()])].sort();
  console.log('\n=== EVIDENCIA POR MODELO: hoje (contaminada) vs limpa ===');
  console.log('modelo | hoje: tier/P(applied)/timeoutRate/invalidRate/n | limpa: tier/P(applied)/timeoutRate/invalidRate/n');
  const cmp = [];
  for (const k of keys) {
    const a = asIs.evidence.get(k);
    const b = clean.evidence.get(k);
    const fmt = (e) => (e ? `${e.reliabilityTier || e.tier || '?'}/${e.probabilityOfApplied !== undefined ? Math.round(e.probabilityOfApplied * 100) + '%' : '?'}/${e.timeoutRate !== undefined ? Math.round(e.timeoutRate * 100) + '%' : '?'}/${e.invalidOutputRate !== undefined ? Math.round(e.invalidOutputRate * 100) + '%' : '?'}/${e.sampleSize || e.attempts || 0}` : '(ausente)');
    cmp.push({ model: k, hoje: a || null, limpa: b || null });
    console.log(`  ${k.padEnd(34)} ${fmt(a).padEnd(30)} ${fmt(b)}`);
  }

  console.log('\n=== QUEM O RANKING ESCOLHERIA (menor expectedCostPerGreen / melhor tier) ===');
  const rank = (ev, label) => {
    const rows = [...ev.entries()].map(([k, e]) => ({ k, e })).sort((x, y) => {
      const tx = x.e.reliabilityTier ?? 9; const ty = y.e.reliabilityTier ?? 9;
      if (tx !== ty) return tx - ty;
      const cx = x.e.expectedCostPerGreen ?? 1e9; const cy = y.e.expectedCostPerGreen ?? 1e9;
      return cx - cy;
    });
    console.log(`  -- ${label}: ${rows.slice(0, 6).map((r) => `${r.k}(tier=${r.e.reliabilityTier ?? '?'},ECG=${r.e.expectedCostPerGreen !== undefined && r.e.expectedCostPerGreen !== null ? r.e.expectedCostPerGreen.toFixed(2) : '?'})`).join('  >  ')}`);
  };
  rank(asIs.evidence, 'hoje (contaminada)');
  rank(clean.evidence, 'limpa (coortes reais)');

  fs.writeFileSync('/tmp/audit-evidence.json', JSON.stringify({ asIs: [...asIs.evidence.entries()], clean: [...clean.evidence.entries()] }, null, 2));
  console.log('\nJSON: /tmp/audit-evidence.json');
  await c.end();
})();
