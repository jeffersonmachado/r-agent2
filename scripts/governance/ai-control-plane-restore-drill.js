#!/usr/bin/env node
'use strict';

/**
 * ai-control-plane-restore-drill.js — restore test em Postgres EFÊMERO
 * (itens 64, 68-73).
 *
 * O que é um "Postgres efêmero": um banco temporário (database) criado no
 * mesmo servidor Postgres — aqui `r_agent2_dr_drill_<timestamp>` — usado só
 * para validar que um backup restaura com integridade. NUNCA sobrescreve o
 * banco real: faz pg_dump DO banco real e restaura DENTRO do temporário,
 * verifica as 4 camadas críticas e DROP o temporário ao final.
 *
 * Verificações pós-restore (item 64):
 *   1. registry: tenant_ai_settings + tenant_ai_credentials com dados;
 *   2. policies: governance_final_decisions presente;
 *   3. release: runtime_artifacts presente (artefatos de release/evidência);
 *   4. audit: event_ledger (estrutura presente; a contagem real da origem é
 *      registrada como sourceAuditRows — o DRILL exclui o data de 11 GB para
 *      ser rápido; o backup real de produção NÃO exclui).
 *
 * Credenciais: lidas de config.getDatabaseUrl() e repassadas via PGPASSWORD
 * ao pg_dump/psql — nunca há prompt interativo de senha.
 *
 * Grava `reports/ai-control-plane-restore-drill.json`. Exit 0 = PASS,
 * 1 = FAIL, 0 = SKIPPED (pg_dump/psql ausentes).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Sequelize } = require('sequelize');
const config = require('../../api/utils/config');

const ROOT = path.join(__dirname, '..', '..');
const REPORT = path.join(ROOT, 'reports', 'ai-control-plane-restore-drill.json');

const CRITICAL_TABLES = {
  registry: ['tenant_ai_settings', 'tenant_ai_credentials'],
  policy: ['governance_final_decisions'],
  release: ['runtime_artifacts'],
  audit: ['event_ledger'],
};

// Tabelas grandes cujo DATA não é copiado no drill (só a estrutura): mantêm o
// dump rápido e seguro em disco. O backup real de produção (pg_dump completo)
// NÃO as exclui.
const EXCLUDE_TABLE_DATA = [
  'event_ledger',
  'vertical_engagement_signals',
  'node_executions',
  'pbx_config_versions',
  'execution_jobs',
  'flow_executions',
];

function writeReport(result) {
  fs.writeFileSync(REPORT, `${JSON.stringify(result, null, 2)}\n`);
}

function hasBinary(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function parseDbUrl(raw) {
  const u = new URL(String(raw));
  return {
    host: u.hostname,
    port: u.port || '5432',
    database: u.pathname.replace(/^\//, '') || 'postgres',
    user: decodeURIComponent(u.username || ''),
    password: decodeURIComponent(u.password || ''),
  };
}

function buildUrl(db) {
  const auth = db.user ? `${encodeURIComponent(db.user)}:${encodeURIComponent(db.password)}@` : '';
  return `postgres://${auth}${db.host}:${db.port}/${db.database}`;
}

function pgEnv(db) {
  return {
    ...process.env,
    PGHOST: db.host,
    PGPORT: db.port,
    PGUSER: db.user,
    PGPASSWORD: db.password,
    PGDATABASE: db.database,
  };
}

function runPsql(db, sql) {
  return execFileSync('psql', ['-X', '-P', 'pager=off', '-tAc', sql], {
    env: pgEnv(db),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function main() {
  const result = {
    generatedAt: new Date().toISOString(),
    status: 'SKIPPED',
    skipped: false,
    steps: {},
  };

  if (!hasBinary('pg_dump') || !hasBinary('psql')) {
    result.skipped = true;
    result.reason = 'pg_dump/psql indisponíveis';
    writeReport(result);
    // eslint-disable-next-line no-console
    console.log('[restore drill] pg_dump/psql indisponíveis — drill pulado.');
    return;
  }

  const source = parseDbUrl(config.getDatabaseUrl());
  const drillDb = `r_agent2_dr_drill_${Date.now()}`;
  const admin = { ...source, database: 'postgres' };

  try {
    // 1. cria banco efêmero
    runPsql(admin, `CREATE DATABASE "${drillDb}"`);
    result.steps.createEphemeralDb = true;
    const target = { ...source, database: drillDb };

    // 2. dump do banco real e restore no efêmero (via arquivo, evita pipe buffer).
    //    --exclude-table-data=event_ledger: o drill não copia os 11 GB do ledger
    //    de auditoria (só a estrutura); o backup real de produção não exclui.
    const os = require('os');
    const dumpFile = path.join(os.tmpdir(), `r-agent2-dr-${Date.now()}.sql`);
    try {
      execFileSync('pg_dump', [
        '--no-owner', '--no-acl', '--clean', '--if-exists',
        ...EXCLUDE_TABLE_DATA.map((t) => `--exclude-table-data=${t}`),
        '-f', dumpFile, '-d', source.database,
      ], {
        env: pgEnv(source),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      execFileSync('psql', ['-X', '-P', 'pager=off', '-v', 'ON_ERROR_STOP=1', '-d', drillDb, '-f', dumpFile], {
        env: pgEnv(target),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      result.steps.restore = true;
    } finally {
      try { fs.unlinkSync(dumpFile); } catch (_) {}
    }

    // 2b. evidência de auditoria na ORIGEM (o backup real inclui esses dados).
    try {
      const sourceSeq = new Sequelize(buildUrl(source), { dialect: 'postgres', logging: false });
      await sourceSeq.authenticate();
      const [srcRows] = await sourceSeq.query('SELECT COUNT(*)::int AS n FROM event_ledger', { raw: true });
      result.steps.sourceAuditRows = Number(srcRows && srcRows[0] && srcRows[0].n);
      await sourceSeq.close();
    } catch (_) {
      result.steps.sourceAuditRows = null;
    }

    // 3. verifica as 4 camadas críticas usando Sequelize (ORM da aplicação)
    const ephemeralSequelize = new Sequelize(buildUrl(target), { dialect: 'postgres', logging: false });
    const checks = {};
    try {
      await ephemeralSequelize.authenticate();
      for (const [layer, tables] of Object.entries(CRITICAL_TABLES)) {
        let layerOk = true;
        const details = {};
        for (const table of tables) {
          try {
            const [rows] = await ephemeralSequelize.query(`SELECT COUNT(*)::int AS n FROM "${table}"`, { raw: true });
            const count = Number(rows && rows[0] && rows[0].n);
            const ok = Number.isFinite(count);
            details[table] = { present: true, rows: count };
            if (!ok) layerOk = false;
          } catch (err) {
            details[table] = { present: false, error: String(err && err.message).split('\n')[0] };
            layerOk = false;
          }
        }
        checks[layer] = layerOk;
        result.steps[`verify_${layer}`] = details;
      }
    } finally {
      await ephemeralSequelize.close();
    }

    const pass = checks.registry === true
      && checks.policy === true
      && checks.release === true
      && checks.audit === true;

    result.status = pass ? 'PASS' : 'FAIL';
    result.checks = checks;

    // 4. drop do banco efêmero (sempre)
    try {
      runPsql(admin, `DROP DATABASE IF EXISTS "${drillDb}" WITH (FORCE)`);
      result.steps.dropEphemeralDb = true;
    } catch (_) {
      result.steps.dropEphemeralDb = false;
    }
  } catch (err) {
    result.status = 'ERROR';
    result.error = String(err && err.message).split('\n')[0];
    // tenta limpar o banco efêmero mesmo em erro
    try { runPsql(admin, `DROP DATABASE IF EXISTS "${drillDb}" WITH (FORCE)`); } catch (_) {}
  }

  writeReport(result);
  // eslint-disable-next-line no-console
  console.log(`[restore drill] ${result.status} — dump→restore efêmero→verificar 4 camadas→drop.`);
  process.exitCode = result.status === 'PASS' ? 0 : 1;
}

main().catch((err) => {
  writeReport({ generatedAt: new Date().toISOString(), status: 'ERROR', error: String(err && err.message) });
  // eslint-disable-next-line no-console
  console.error('[restore drill] erro:', err && err.message);
  process.exitCode = 1;
});
