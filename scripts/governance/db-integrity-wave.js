#!/usr/bin/env node
'use strict';

/**
 * db-integrity-wave.js — runner da Database Integrity Wave.
 *
 * Executa a validação real dos models do inventário
 * (`config/system-inventory.json`) em dois tiers:
 *
 * - TIER ESTÁTICO (sempre): parse do model via modelScanner (sem require/DB),
 *   tableName/PK/timestamps, presença de migration que referencia a tabela e
 *   observação de tenant scope (ausência vira warning, nunca falha).
 * - TIER LIVE (com DB): conecta via api/db/sequelize.js (mesma config da API —
 *   api/data/config.json + envs; nunca credenciais hardcoded) e confere
 *   tabela, colunas e PK no information_schema.
 *
 * Sem DB disponível: dbAvailable=false, todo model fica no máximo VISITED.
 *
 * Saídas:
 * - evidências append-only em qa/evidence/db-integrity-wave.jsonl (gitignored)
 * - relatório versionado em reports/db-integrity-report.json
 *
 * Uso: RUNTIME_ROOT=/tmp/ragent2-runtime node scripts/governance/db-integrity-wave.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { parseModelFile } = require('../../api/services/qa/inventory/modelScanner');
const { evaluateDbIntegrityWave, WAVE_ID } = require('../../qa/coverage/dbIntegrityWave');
const { createEvidenceStore } = require('../../qa/coverage/evidenceStore');
const { COVERAGE_STATES } = require('../../qa/coverage/coverageStates');

const ROOT_DIR = path.join(__dirname, '..', '..');
const INVENTORY_PATH = path.join(ROOT_DIR, 'config', 'system-inventory.json');
const MIGRATIONS_DIR = path.join(ROOT_DIR, 'api', 'db', 'migrations');
const DDL_DIR = path.join(ROOT_DIR, 'migrations');
const EXEMPTIONS_PATH = path.join(ROOT_DIR, 'config', 'db-integrity-exemptions.json');
const EVIDENCE_PATH = path.join(ROOT_DIR, 'qa', 'evidence', 'db-integrity-wave.jsonl');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'db-integrity-report.json');
const DB_CONNECT_TIMEOUT_MS = 5000;

const STATE_TO_EVIDENCE_STATUS = Object.freeze({
  [COVERAGE_STATES.VALIDATED]: 'passed',
  [COVERAGE_STATES.FAILED]: 'failed',
  [COVERAGE_STATES.VISITED]: 'passed_via_fallback',
});

function currentCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** Lê todas as migrations (Umzug .js) e o DDL versionado (.sql) uma única vez. */
function loadMigrationSources(migrationsDir = MIGRATIONS_DIR, rootDir = ROOT_DIR, ddlDir = null) {
  const effectiveDdlDir = ddlDir || path.join(rootDir, 'migrations');
  const sources = [];
  if (fs.existsSync(migrationsDir)) {
    for (const name of fs.readdirSync(migrationsDir).filter((n) => n.endsWith('.js')).sort()) {
      sources.push({
        file: path.relative(rootDir, path.join(migrationsDir, name)),
        content: fs.readFileSync(path.join(migrationsDir, name), 'utf8'),
      });
    }
  }
  // DDL versionado solto (ex.: migrations/agent-os-2026-06-11.sql) também é
  // migration legítima: tabelas criadas via CREATE TABLE em SQL bruto.
  if (fs.existsSync(effectiveDdlDir)) {
    for (const name of fs.readdirSync(effectiveDdlDir).filter((n) => n.endsWith('.sql')).sort()) {
      sources.push({
        file: path.relative(rootDir, path.join(effectiveDdlDir, name)),
        content: fs.readFileSync(path.join(effectiveDdlDir, name), 'utf8'),
      });
    }
  }
  return sources;
}

/** CREATE TABLE [IF NOT EXISTS] <table> em SQL bruto (aspas opcionais). */
function createTableRegex(tableName) {
  const escaped = String(tableName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?["'\`]?${escaped}["'\`]?(?!\\w)`, 'i');
}

/**
 * Migrations que referenciam a tabela: `createTable('<table>'` (aspas simples
 * ou duplas), qualquer ocorrência quotada do tableName, ou
 * `CREATE TABLE [IF NOT EXISTS] <table>` em SQL bruto (migrations Umzug com
 * sequelize.query ou DDL versionado em migrations/*.sql).
 */
function findMigrationMatches(tableName, migrationSources) {
  if (!tableName) return [];
  const createTableNeedles = [`createTable('${tableName}'`, `createTable("${tableName}"`];
  const quotedNeedles = [`'${tableName}'`, `"${tableName}"`];
  const rawCreateTable = createTableRegex(tableName);
  return migrationSources
    .filter(({ content }) => createTableNeedles.some((n) => content.includes(n))
      || quotedNeedles.some((n) => content.includes(n))
      || rawCreateTable.test(content))
    .map(({ file }) => file);
}

/**
 * Coleta os dados estáticos de cada item `model:` do inventário (fs apenas).
 * Exportada para testes com fixtures em tmp.
 */
function collectModelStaticData({ inventoryItems, rootDir = ROOT_DIR, migrationSources }) {
  const sources = migrationSources || loadMigrationSources(path.join(rootDir, 'api', 'db', 'migrations'), rootDir);
  return inventoryItems
    .filter((item) => item.kind === 'model')
    .map((item) => {
      const absSource = path.join(rootDir, item.source || '');
      let parsed = null;
      let timestampsDisabled = false;
      if (item.source && fs.existsSync(absSource)) {
        parsed = parseModelFile(absSource);
        const raw = fs.readFileSync(absSource, 'utf8');
        timestampsDisabled = /\btimestamps\s*:\s*false\b/.test(raw);
      }
      const tableName = parsed && !parsed.parseError ? parsed.tableName : (item.tableName || null);
      return {
        id: item.id,
        model: item.model,
        source: item.source,
        fingerprint: item.fingerprint || null,
        parsed,
        timestampsDisabled,
        migrationMatches: findMigrationMatches(tableName, sources),
      };
    });
}

/**
 * Coleta os dados estáticos de cada item `relation:` do inventário (fs apenas):
 * parse do model de origem via modelScanner. Exportada para testes.
 */
function collectRelationStaticData({ inventoryItems, rootDir = ROOT_DIR }) {
  return inventoryItems
    .filter((item) => item.kind === 'relation')
    .map((item) => {
      const absSource = path.join(rootDir, item.source || '');
      const parsed = item.source && fs.existsSync(absSource) ? parseModelFile(absSource) : null;
      return {
        id: item.id,
        model: item.model,
        field: item.field,
        references: item.references || {},
        source: item.source,
        fingerprint: item.fingerprint || null,
        parsed,
      };
    });
}

/**
 * Coleta dados do information_schema em 4 queries agregadas.
 * @returns {Map<string, {columns: string[], primaryKeyColumns: string[], foreignKeys: object[]}>}
 */
async function fetchLiveData(sequelize) {
  // NB: colunas do information_schema são sql_identifier (domain de `name`);
  // sem o cast ::text o parser do driver retorna linhas malformadas.
  const [tableRows] = await sequelize.query(
    'SELECT table_name::text AS table_name FROM information_schema.tables WHERE table_schema = current_schema()',
  );
  const [columnRows] = await sequelize.query(
    'SELECT table_name::text AS table_name, column_name::text AS column_name FROM information_schema.columns WHERE table_schema = current_schema()',
  );
  const [pkRows] = await sequelize.query(
    `SELECT tc.table_name::text AS table_name, kcu.column_name::text AS column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
        AND tc.table_name = kcu.table_name
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = current_schema()`,
  );
  const [fkRows] = await sequelize.query(
    `SELECT tc.table_name::text AS table_name, kcu.column_name::text AS column_name,
            ccu.table_name::text AS referenced_table, ccu.column_name::text AS referenced_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
        AND tc.table_name = kcu.table_name
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = current_schema()`,
  );

  const live = new Map();
  for (const row of tableRows) {
    live.set(row.table_name, { columns: [], primaryKeyColumns: [], foreignKeys: [] });
  }
  for (const row of columnRows) {
    if (live.has(row.table_name)) live.get(row.table_name).columns.push(row.column_name);
  }
  for (const row of pkRows) {
    if (live.has(row.table_name)) live.get(row.table_name).primaryKeyColumns.push(row.column_name);
  }
  for (const row of fkRows) {
    if (live.has(row.table_name)) {
      live.get(row.table_name).foreignKeys.push({
        columnName: row.column_name,
        referencedTable: row.referenced_table,
        referencedColumn: row.referenced_column,
      });
    }
  }
  return live;
}

/**
 * Tenta conectar ao banco via config do projeto, com timeout curto.
 * @returns {Promise<{dbAvailable: boolean, sequelize?: object, reason?: string}>}
 */
async function tryConnect() {
  let db;
  try {
    // eslint-disable-next-line global-require
    db = require('../../api/db/sequelize');
  } catch (error) {
    return { dbAvailable: false, reason: `falha ao carregar sequelize: ${error.message}` };
  }
  try {
    const sequelize = await Promise.race([
      db.connect(1, 500),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`timeout de ${DB_CONNECT_TIMEOUT_MS}ms`)), DB_CONNECT_TIMEOUT_MS);
      }),
    ]);
    return { dbAvailable: true, sequelize };
  } catch (error) {
    try { await db.close(); } catch { /* ignore */ }
    return { dbAvailable: false, reason: error.message };
  }
}

/** Carrega isenções justificadas (config/db-integrity-exemptions.json), se existir. */
function loadExemptions(exemptionsPath = EXEMPTIONS_PATH) {
  if (!fs.existsSync(exemptionsPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(exemptionsPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn(`[db-integrity-wave] isenções ignoradas (JSON inválido): ${error.message}`);
    return {};
  }
}

async function main() {
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  const models = collectModelStaticData({ inventoryItems: inventory.items });
  const relations = collectRelationStaticData({ inventoryItems: inventory.items });
  const exemptions = loadExemptions();
  console.log(`[db-integrity-wave] models no inventário: ${models.length} | relações: ${relations.length}`);

  const connection = await tryConnect();
  const dbAvailable = connection.dbAvailable;
  const dbUnavailableReason = connection.reason || null;
  console.log(`[db-integrity-wave] dbAvailable=${dbAvailable}${dbUnavailableReason ? ` (${dbUnavailableReason})` : ''}`);

  if (dbAvailable) {
    try {
      const liveByTable = await fetchLiveData(connection.sequelize);
      for (const modelData of models) {
        const tableName = modelData.parsed && !modelData.parsed.parseError
          ? modelData.parsed.tableName
          : null;
        const live = tableName ? liveByTable.get(tableName) : null;
        modelData.live = live
          ? { tableExists: true, columns: live.columns, primaryKeyColumns: live.primaryKeyColumns }
          : { tableExists: false, columns: [], primaryKeyColumns: [] };
      }
      for (const relationData of relations) {
        const sourceTable = relationData.parsed && !relationData.parsed.parseError
          ? relationData.parsed.tableName
          : null;
        const sourceLive = sourceTable ? liveByTable.get(sourceTable) : null;
        const referencedLive = relationData.references && relationData.references.model
          ? liveByTable.get(relationData.references.model)
          : null;
        relationData.live = {
          tableExists: Boolean(sourceLive),
          columns: sourceLive ? sourceLive.columns : [],
          referencedTableExists: Boolean(referencedLive),
          referencedColumns: referencedLive ? referencedLive.columns : [],
          foreignKeys: sourceLive ? sourceLive.foreignKeys : [],
        };
      }
    } finally {
      // eslint-disable-next-line global-require
      await require('../../api/db/sequelize').close();
    }
  }

  const result = evaluateDbIntegrityWave({ models, relations, dbAvailable, dbUnavailableReason, exemptions });
  const commit = currentCommit();
  const runId = `${WAVE_ID}-${Date.now()}`;
  const environment = process.env.CI ? 'ci' : 'local';

  // Evidências append-only (uma por model executado).
  const store = createEvidenceStore({ filePath: EVIDENCE_PATH });
  const byId = new Map(models.map((m) => [m.id, m]));
  for (const entry of result.perModel) {
    store.append({
      evidenceId: `${entry.id}:${runId}`,
      executionId: runId,
      waveId: WAVE_ID,
      journeyId: 'technical:database-integrity',
      journeyFingerprint: (byId.get(entry.id) || {}).fingerprint || 'unknown',
      commit,
      environment,
      status: STATE_TO_EVIDENCE_STATUS[entry.state] || 'failed',
      assertions: entry.assertions.map((a) => ({
        description: a.name,
        passed: a.passed,
        detail: a.detail,
      })),
      observedElements: [entry.id],
      expectedElements: [entry.id],
      timestamp: new Date().toISOString(),
      dbIntegrityState: entry.state,
      table: entry.table,
    });
  }
  // Evidências das relações (FKs) — mesma cadeia append-only.
  const relationById = new Map(relations.map((r) => [r.id, r]));
  for (const entry of result.perRelation) {
    store.append({
      evidenceId: `${entry.id}:${runId}`,
      executionId: runId,
      waveId: WAVE_ID,
      journeyId: 'technical:database-integrity',
      journeyFingerprint: (relationById.get(entry.id) || {}).fingerprint || 'unknown',
      commit,
      environment,
      status: STATE_TO_EVIDENCE_STATUS[entry.state] || 'failed',
      assertions: entry.assertions.map((a) => ({
        description: a.name,
        passed: a.passed,
        detail: a.detail,
      })),
      observedElements: [entry.id],
      expectedElements: [entry.id],
      timestamp: new Date().toISOString(),
      dbIntegrityState: entry.state,
      table: entry.table,
    });
  }
  const chain = store.verify();
  if (!chain.valid) {
    console.error(`[db-integrity-wave] ERRO: cadeia de evidências quebrada em ${chain.brokenAt}`);
    process.exit(1);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    commit,
    dbAvailable,
    ...(dbUnavailableReason ? { dbUnavailableReason } : {}),
    totals: result.totals,
    relationTotals: result.relationTotals,
    exemptions: result.exemptions,
    perModel: result.perModel.map((entry) => ({
      id: entry.id,
      table: entry.table,
      state: entry.state,
      assertions: entry.assertions.map((a) => ({
        name: a.name, passed: a.passed, detail: a.detail,
        ...(a.notApplicable ? { notApplicable: true } : {}),
      })),
    })),
    perRelation: result.perRelation.map((entry) => ({
      id: entry.id,
      table: entry.table,
      state: entry.state,
      assertions: entry.assertions.map((a) => ({
        name: a.name, passed: a.passed, detail: a.detail,
      })),
    })),
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  const { totals, relationTotals } = result;
  console.log(`[db-integrity-wave] validated=${totals.validated} visited=${totals.visited} `
    + `failed=${totals.failed} warnings=${totals.warnings} (models=${totals.models})`);
  console.log(`[db-integrity-wave] relações: validated=${relationTotals.validated} visited=${relationTotals.visited} `
    + `failed=${relationTotals.failed} (relations=${relationTotals.relations})`);
  const failedRelations = result.perRelation.filter((r) => r.state === COVERAGE_STATES.FAILED);
  for (const entry of failedRelations.slice(0, 5)) {
    console.log(`[db-integrity-wave] FAILED ${entry.id}: ${entry.failedAssertions.join(', ')}`);
  }
  const failed = result.perModel.filter((m) => m.state === COVERAGE_STATES.FAILED);
  for (const entry of failed.slice(0, 5)) {
    console.log(`[db-integrity-wave] FAILED ${entry.id} (${entry.table || 'sem tabela'}): `
      + `${entry.failedAssertions.join(', ')}`);
  }
  if (failed.length > 5) console.log(`[db-integrity-wave] … e mais ${failed.length - 5} FAILED`);
  if (result.exemptions.applied.length > 0) {
    console.log(`[db-integrity-wave] isenções NOT_APPLICABLE aplicadas: ${result.exemptions.applied.length} `
      + `(${result.exemptions.applied.map((e) => `${e.model}:${e.assertion}`).join(', ')})`);
  }
  for (const ignored of result.exemptions.ignored) {
    console.warn(`[db-integrity-wave] isenção IGNORADA ${ignored.model}:${ignored.exemption.assertion || '?'} — ${ignored.reason}`);
  }
  console.log(`[db-integrity-wave] evidências: ${path.relative(ROOT_DIR, EVIDENCE_PATH)} `
    + `(${result.perModel.length + result.perRelation.length} appends, cadeia íntegra)`);
  console.log(`[db-integrity-wave] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[db-integrity-wave] erro fatal: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  collectModelStaticData,
  collectRelationStaticData,
  findMigrationMatches,
  loadMigrationSources,
  loadExemptions,
  fetchLiveData,
  ROOT_DIR,
  INVENTORY_PATH,
  MIGRATIONS_DIR,
  DDL_DIR,
  EXEMPTIONS_PATH,
  EVIDENCE_PATH,
  REPORT_PATH,
};
