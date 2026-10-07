'use strict';
/**
 * Subclassificacao dos PATCH_APPLY_FAILED — SOMENTE LEITURA do banco; escrita apenas em /tmp.
 * Reproduz cada falha contra um worktree do source_commit da task e classifica pela causa raiz.
 * NAO repara nada, NAO aplica nada no workspace real.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Client } = require('/opt/results/ria/r-agent2/node_modules/pg');
const { normalizeHunkHeaders } = require('/opt/results/ria/r-agent2/engine/engineeringRouter/hunkNormalizer');

function loadEnv() {
  const raw = fs.readFileSync('/opt/results/ria/r-agent2/.env', 'utf8');
  const env = {};
  for (const line of raw.split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  return env;
}
const COHORTS = ['cc1fbca6-d8cb-4ac8-a858-2d221244a8b3', 'SYSTEM:BUG_LOOP_WORKER'];

const classify = (stderr, extra = {}) => {
  const s = String(stderr || '');
  if (/fragment without header|without header/i.test(s)) return 'HEADER_DE_ARQUIVO_AUSENTE';
  if (/corrompido|corrupt|malformed/i.test(s)) return 'CONTAGEM_DE_HUNK_INCONSISTENTE';
  if (/does not exist|No such file|Arquivo ou diret..rio inexistente/i.test(s)) return 'PATH_INVALIDO';
  if (/already exists|j. existe/i.test(s)) return 'CONFLITO_ARQUIVO_EXISTENTE';
  if (/reversed|already applied|previously applied/i.test(s)) return 'JA_APLICADO';
  if (/patch does not apply|falha no patch/i.test(s)) return extra.fileExists === false ? 'SOURCE_STALE_OU_PATH' : 'CONTEXTO_NAO_ENCONTRADO';
  if (/invalid|inv.lid/i.test(s)) return 'DIFF_ESTRUTURALMENTE_INVALIDO';
  return 'INDETERMINADO';
};

(async () => {
  const env = loadEnv();
  const c = new Client(env.DATABASE_URL ? { connectionString: env.DATABASE_URL } : {
    host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 5432), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
  });
  await c.connect();
  const rows = (await c.query(`
    select a.id, a.attempt_number, a.coder_provider||':'||a.coder_model model, t.source_commit,
           a.patch_diff, coalesce(a.error->>'stderr', a.failure_bundle->>'stderr','') stderr
      from engineering_attempts a join engineering_tasks t on t.id=a.task_id
     where t.created_by = any($1) and coalesce(a.error->>'code', a.failure_bundle->>'code')='PATCH_APPLY_FAILED'
       and length(coalesce(a.patch_diff,'')) > 0
     order by a.created_at`, [COHORTS])).rows;
  console.log(`PATCH_APPLY_FAILED com patch presente: ${rows.length}`);

  const shas = [...new Set(rows.map((r) => r.source_commit).filter(Boolean))];
  console.log(`source_commits distintos: ${shas.length}`);
  const wt = {};
  for (const sha of shas) {
    const dir = `/tmp/applychk-${String(sha).slice(0, 10)}`;
    if (!fs.existsSync(dir)) {
      try {
        execFileSync('git', ['-C', '/opt/results/ria/r-agent2', 'worktree', 'add', '--detach', dir, sha], { stdio: 'pipe' });
      } catch (e) { console.log(`  worktree falhou para ${sha}: ${String(e.stderr || e.message).slice(0, 120)}`); continue; }
    }
    wt[sha] = dir;
  }

  const results = [];
  for (const r of rows) {
    const dir = wt[r.source_commit];
    if (!dir) { results.push({ ...r, causa: 'SEM_WORKTREE', gitErr: '', sourceCommit: r.source_commit }); continue; }
    const target = /^\+\+\+ b\/(.+)$/m.exec(r.patch_diff);
    const file = target ? target[1].trim() : null;
    const fileExists = file ? fs.existsSync(path.join(dir, file)) : null;

    const pf = `/tmp/patch-${r.id}.diff`;
    const norm = (() => { try { return normalizeHunkHeaders(r.patch_diff); } catch (e) { return r.patch_diff; } })();
    const pn = `/tmp/patchn-${r.id}.diff`;
    fs.writeFileSync(pf, r.patch_diff.endsWith('\n') ? r.patch_diff : `${r.patch_diff}\n`);
    fs.writeFileSync(pn, norm.endsWith('\n') ? norm : `${norm}\n`);

    const tryApply = (f) => { try { execFileSync('git', ['apply', '--check', f], { cwd: dir, stdio: 'pipe' }); return { ok: true, err: '' }; } catch (e) { return { ok: false, err: `${e.stdout || ''}${e.stderr || ''}` }; } };
    const raw = tryApply(pf);
    const nrm = tryApply(pn);
    const changedByNormalizer = raw.err !== nrm.err;
    results.push({
      id: r.id, att: r.attempt_number, model: r.model, file, fileExists,
      causa: classify(r.stderr || raw.err, { fileExists }),
      stderrDb: (r.stderr || '').slice(0, 160), rawErr: raw.err.slice(0, 160), normErr: nrm.err.slice(0, 160),
      rawOk: raw.ok, normOk: nrm.ok, changedByNormalizer,
    });
    try { fs.unlinkSync(pf); fs.unlinkSync(pn); } catch (e) { /* noop */ }
  }

  console.log('\n=== CAUSA RAIZ DOS PATCH_APPLY_FAILED (reproduzido com git apply --check) ===');
  const byCause = {};
  for (const r of results) byCause[r.causa] = (byCause[r.causa] || 0) + 1;
  Object.entries(byCause).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(34)} ${v}`));

  console.log('\n=== por modelo ===');
  const byModel = {};
  for (const r of results) { const k = `${r.model} | ${r.causa}`; byModel[k] = (byModel[k] || 0) + 1; }
  Object.entries(byModel).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(64)} ${v}`));

  console.log('\n=== commits NAO resolviveis (patch nao reprocessado) ===');
  const missing = [...new Set(results.filter((r) => r.causa === 'SEM_WORKTREE').map((r) => r.sourceCommit))];
  missing.forEach((s) => console.log(`  source_commit=${s} | ${results.filter((r) => r.sourceCommit === s).length} attempts | modelos=${[...new Set(results.filter((r) => r.sourceCommit === s).map((r) => r.model))].join(', ')}`));
  for (const sha of missing) {
    const t = execFileSync('git', ['-C', '/opt/results/ria/r-agent2', 'cat-file', '-t', String(sha)], { stdio: 'pipe' }) && 'existe';
    const inRemote = (() => { try { execFileSync('git', ['-C', '/opt/results/ria/r-agent2', 'merge-base', '--is-ancestor', String(sha), 'HEAD'], { stdio: 'pipe' }); return 'ancestral do HEAD'; } catch (e) { return 'NAO ancestral do HEAD'; } })();
    console.log(`     ${sha} -> ${t}, ${inRemote}`);
  }

  console.log('\n=== detalhe (causa, stderr do banco, se o normalizador mudou o resultado) ===');
  for (const r of results) {
    console.log(`  [${r.causa}] ${r.model} att=${r.att} arquivo=${r.file} existe_no_source=${r.fileExists} normMudou=${r.changedByNormalizer}`);
    console.log(`      db: ${JSON.stringify(String(r.stderrDb || '').slice(0, 120))}`);
    if (r.rawErr && r.rawErr !== r.stderrDb) console.log(`      repro: ${JSON.stringify(String(r.rawErr).slice(0, 120))}`);
  }

  fs.writeFileSync('/tmp/audit-apply-causes.json', JSON.stringify({ total: results.length, byCause, byModel, results }, null, 2));
  console.log('\nJSON: /tmp/audit-apply-causes.json');
  await c.end();
})();
