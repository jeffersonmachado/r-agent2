#!/usr/bin/env node
'use strict';

/**
 * validate-model-field-contracts.js — gate bloqueante de integridade
 * model ↔ domínio ↔ migration.
 *
 * Problema que resolve: o `wave:db-integrity` verifica "toda coluna do model
 * existe no banco". Ele NÃO detecta o inverso, que é a falha silenciosa real:
 * o domínio escreve/lê um campo que o model Sequelize não declara — o Sequelize
 * descarta a escrita, a API responde sucesso e o dado nunca é persistido.
 *
 * Como resolve (determinístico, sem heurística e sem banco):
 *  1. Introspecção REAL dos models (`modelAttributesIntrospector`), capturando
 *     exatamente os atributos entregues a `sequelize.define`.
 *  2. Contrato declarado em `config/model-field-contracts.json`: quais campos
 *     persistidos são obrigatórios por model e quais arquivos os usam.
 *  3. Para cada campo do contrato: precisa existir no model (coluna física) e
 *     precisa estar referenciado nos arquivos `usedBy` (contrato não pode
 *     apodrecer).
 *  4. Para cada `allowlist` declarada (ex.: campos aceitos por uma rota): todo
 *     item exportado precisa estar no contrato E no model — nenhum campo aceito
 *     pela API pode ser descartado.
 *  5. Contraprova de migration: o campo precisa ser criado/alterado por alguma
 *     migration (createTable/addColumn), senão o contrato aponta para coluna
 *     que não existe no DDL.
 *
 * Saída: `reports/model-field-contract-report.json` (versionado) + exit 1 em
 * qualquer violação. Zero violações ⇒ PASS.
 *
 * Uso: node scripts/governance/validate-model-field-contracts.js [--json]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { introspectModels } = require('../../api/services/qa/inventory/modelAttributesIntrospector');

const ROOT_DIR = path.join(__dirname, '..', '..');
const CONTRACT_PATH = path.join(ROOT_DIR, 'config', 'model-field-contracts.json');
const MIGRATIONS_DIR = path.join(ROOT_DIR, 'api', 'db', 'migrations');
const DDL_DIR = path.join(ROOT_DIR, 'migrations');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'model-field-contract-report.json');

const VIOLATION_CODES = Object.freeze({
  CONTRACT_PARSE_ERROR: 'contract_parse_error',
  CONTRACT_EMPTY: 'contract_empty',
  MODEL_UNKNOWN: 'model_unknown',
  MODEL_INTROSPECTION_ERROR: 'model_introspection_error',
  TABLE_MISMATCH: 'table_mismatch',
  SOURCE_MISSING: 'model_source_missing',
  FIELD_NOT_IN_MODEL: 'field_not_in_model',
  FIELDS_DECLARED_EMPTY: 'fields_declared_empty',
  FIELD_NOT_IN_MIGRATIONS: 'field_not_in_migrations',
  USEDBY_FILE_MISSING: 'usedby_file_missing',
  USEDBY_REFERENCE_MISSING: 'usedby_reference_missing',
  ALLOWLIST_FILE_MISSING: 'allowlist_file_missing',
  ALLOWLIST_EXPORT_MISSING: 'allowlist_export_missing',
  ALLOWLIST_FIELD_NOT_IN_CONTRACT: 'allowlist_field_not_in_contract',
  ALLOWLIST_FIELD_NOT_IN_MODEL: 'allowlist_field_not_in_model',
});

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** Lê migrations Umzug (.js) + DDL versionado (.sql). */
function loadMigrationSources() {
  const sources = [];
  for (const dir of [MIGRATIONS_DIR, DDL_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      if (!/\.(js|sql)$/.test(name)) continue;
      sources.push({ file: path.relative(ROOT_DIR, path.join(dir, name)), content: fs.readFileSync(path.join(dir, name), 'utf8') });
    }
  }
  return sources;
}

/** Remove comentários de linha/bloco para não capturar colunas citadas em prosa. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * Colunas declaradas por migration para uma tabela.
 * Reconhece:
 *  - createTable('<t>', {...}) / createTableIfNotExists(qi, '<t>', {...})
 *  - addColumn('<t>', '<col>') / addColumn("<t>", "<col>")
 *  - ALTER TABLE <t> ADD [COLUMN] <col> (SQL bruto)
 *  - descritores de coluna `{ name: '<col>' }` em array consumido por um
 *    `addColumn('<t>', col.name)` (padrão usado quando o nome da coluna é
 *    iterado dinamicamente — o nome literal fica no array). Só é considerado
 *    quando a migration referencia a tabela, mantendo a extração conservadora.
 */
function collectMigrationColumns(tableName, sources) {
  const columns = new Set();
  const files = new Set();
  const createNeedles = [
    `createTable('${tableName}'`,
    `createTable("${tableName}"`,
    `createTableIfNotExists(queryInterface, '${tableName}'`,
    `createTableIfNotExists(queryInterface, "${tableName}"`,
  ];
  const tableReference = new RegExp(`['"\`]${tableName}['"\`]`);
  const addColumnRegex = new RegExp(`addColumn\\(\\s*['"\`]${tableName}['"\`]\\s*,\\s*['"\`]([A-Za-z0-9_]+)['"\`]`, 'g');
  const alterRegex = new RegExp(`alter\\s+table\\s+["'\`]?${tableName}["'\`]?\\s+add\\s+(?:column\\s+)?["'\`]?([A-Za-z0-9_]+)`, 'gi');
  const descriptorRegex = /name:\s*['"`]([A-Za-z0-9_]+)['"`]/g;

  for (const { file, content: raw } of sources) {
    const content = stripComments(raw);
    let touched = false;
    const referencesTable = tableReference.test(content);

    for (const needle of createNeedles) {
      const idx = content.indexOf(needle);
      if (idx === -1) continue;
      touched = true;
      const start = content.indexOf('{', idx);
      if (start === -1) continue;
      let depth = 0;
      let end = -1;
      for (let i = start; i < content.length; i += 1) {
        const ch = content[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) { end = i; break; }
        }
      }
      if (end === -1) continue;
      const body = content.slice(start + 1, end);
      // chaves de topo do objeto de atributos
      let localDepth = 0;
      let token = '';
      for (let i = 0; i < body.length; i += 1) {
        const ch = body[i];
        if (ch === '{' || ch === '[' || ch === '(') localDepth += 1;
        else if (ch === '}' || ch === ']' || ch === ')') localDepth -= 1;
        if (localDepth === 0 && ch === ':') {
          const key = token.trim().split(/[\s,]+/).pop();
          token = '';
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) columns.add(key);
        } else if (localDepth === 0 && ch === ',') {
          token = '';
        } else {
          token += ch;
        }
      }
    }

    let match;
    // eslint-disable-next-line no-cond-assign
    while ((match = addColumnRegex.exec(content))) { columns.add(match[1]); touched = true; }
    // eslint-disable-next-line no-cond-assign
    while ((match = alterRegex.exec(content))) { columns.add(match[1]); touched = true; }

    if (referencesTable && /addColumn\(\s*['"`]/.test(content) && /,\s*col\.(name|column|field)/.test(content)) {
      touched = true;
      // eslint-disable-next-line no-cond-assign
      while ((match = descriptorRegex.exec(content))) columns.add(match[1]);
    }

    if (touched) files.add(file);
  }

  return { columns, files: [...files] };
}

function readContract() {
  if (!fs.existsSync(CONTRACT_PATH)) {
    return { contract: null, error: `contrato ausente: ${path.relative(ROOT_DIR, CONTRACT_PATH)}` };
  }
  try {
    return { contract: JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')), error: null };
  } catch (error) {
    return { contract: null, error: `contrato inválido: ${error.message}` };
  }
}

/**
 * Valida uma allowlist exportada por um módulo do domínio.
 *
 * Dois modos:
 * - allowlist de COLUNAS (default): cada item exportado precisa ser uma coluna
 *   do contrato e do model — garante que nenhum campo aceito pela API seja
 *   descartado pelo model.
 * - allowlist ANINHADA (`storageField` presente): os itens são chaves dentro de
 *   uma coluna JSONB declarada (ex.: `config`). Nesse caso a garantia é que a
 *   coluna de armazenamento exista no contrato e no model.
 */
function evaluateAllowlist({ allowlist, entry, model, addViolation }) {
  const absFile = path.join(ROOT_DIR, allowlist.file || '');
  if (!allowlist.file || !fs.existsSync(absFile)) {
    addViolation(VIOLATION_CODES.ALLOWLIST_FILE_MISSING, { model: entry.modelName, file: allowlist.file || null });
    return { fields: [], storageField: allowlist.storageField || null };
  }
  let exported;
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(absFile);
    exported = mod[allowlist.export];
  } catch (error) {
    addViolation(VIOLATION_CODES.ALLOWLIST_EXPORT_MISSING, { model: entry.modelName, file: allowlist.file, export: allowlist.export, detail: error.message });
    return { fields: [], storageField: allowlist.storageField || null };
  }
  if (!Array.isArray(exported) || exported.length === 0) {
    addViolation(VIOLATION_CODES.ALLOWLIST_EXPORT_MISSING, { model: entry.modelName, file: allowlist.file, export: allowlist.export });
    return { fields: [], storageField: allowlist.storageField || null };
  }

  const declared = new Set(Object.keys(entry.persistedFields || {}));
  const modelColumns = new Set(model.physicalColumns);

  if (allowlist.storageField) {
    // Chaves aninhadas em coluna JSONB: valida a coluna, não cada chave.
    if (!declared.has(allowlist.storageField)) {
      addViolation(VIOLATION_CODES.ALLOWLIST_FIELD_NOT_IN_CONTRACT, {
        model: entry.modelName, field: allowlist.storageField, file: allowlist.file, nested: true,
      });
    }
    if (!modelColumns.has(allowlist.storageField)) {
      addViolation(VIOLATION_CODES.ALLOWLIST_FIELD_NOT_IN_MODEL, {
        model: entry.modelName, field: allowlist.storageField, file: allowlist.file, nested: true,
      });
    }
    return { fields: exported, storageField: allowlist.storageField };
  }

  for (const field of exported) {
    if (!declared.has(field)) {
      addViolation(VIOLATION_CODES.ALLOWLIST_FIELD_NOT_IN_CONTRACT, { model: entry.modelName, field, file: allowlist.file });
    }
    if (!modelColumns.has(field)) {
      addViolation(VIOLATION_CODES.ALLOWLIST_FIELD_NOT_IN_MODEL, { model: entry.modelName, field, file: allowlist.file });
    }
  }
  return { fields: exported, storageField: null };
}

function run({ contract, introspection, migrationSources }) {
  const violations = [];
  const addViolation = (code, detail) => violations.push({ code, ...detail });

  const entries = Object.entries(contract || {}).filter(([key]) => !key.startsWith('_'));
  if (entries.length === 0) {
    addViolation(VIOLATION_CODES.CONTRACT_EMPTY, {});
  }

  const models = {};
  const summary = [];

  for (const [modelName, rawEntry] of entries) {
    const entry = { ...rawEntry, modelName };
    const model = introspection.models[modelName];
    if (!model) {
      addViolation(VIOLATION_CODES.MODEL_UNKNOWN, { model: modelName });
      continue;
    }
    models[modelName] = model;

    if (entry.table && model.tableName !== entry.table) {
      addViolation(VIOLATION_CODES.TABLE_MISMATCH, { model: modelName, expected: entry.table, actual: model.tableName });
    }
    if (!entry.source || !fs.existsSync(path.join(ROOT_DIR, entry.source))) {
      addViolation(VIOLATION_CODES.SOURCE_MISSING, { model: modelName, source: entry.source || null });
    }

    const persistedFields = entry.persistedFields || {};
    if (Object.keys(persistedFields).length === 0) {
      addViolation(VIOLATION_CODES.FIELDS_DECLARED_EMPTY, { model: modelName });
    }

    const modelColumns = new Set(model.physicalColumns);
    const { columns: migrationColumns, files: migrationFiles } = collectMigrationColumns(model.tableName, migrationSources);

    for (const [field, spec] of Object.entries(persistedFields)) {
      if (!modelColumns.has(field)) {
        addViolation(VIOLATION_CODES.FIELD_NOT_IN_MODEL, { model: modelName, field, table: model.tableName });
      }
      if (!migrationColumns.has(field)) {
        addViolation(VIOLATION_CODES.FIELD_NOT_IN_MIGRATIONS, { model: modelName, field, table: model.tableName });
      }
      for (const usedBy of spec.usedBy || []) {
        const abs = path.join(ROOT_DIR, usedBy);
        if (!fs.existsSync(abs)) {
          addViolation(VIOLATION_CODES.USEDBY_FILE_MISSING, { model: modelName, field, file: usedBy });
          continue;
        }
        const content = fs.readFileSync(abs, 'utf8');
        if (!content.includes(field)) {
          addViolation(VIOLATION_CODES.USEDBY_REFERENCE_MISSING, { model: modelName, field, file: usedBy });
        }
      }
    }

    const allowlists = (entry.allowlists || []).map((allowlist) => ({
      ...allowlist,
      ...evaluateAllowlist({ allowlist, entry, model, addViolation }),
    }));

    summary.push({
      model: modelName,
      table: model.tableName,
      persistedFields: Object.keys(persistedFields).length,
      modelColumns: model.physicalColumns.length,
      migrationFiles,
      allowlists: allowlists.map((a) => ({ file: a.file, export: a.export, fields: a.fields.length })),
    });
  }

  return { violations, summary, models };
}

function main() {
  const { contract, error } = readContract();
  const introspection = introspectModels();

  const violations = [];
  if (error) {
    violations.push({ code: VIOLATION_CODES.CONTRACT_PARSE_ERROR, detail: error });
  }
  for (const err of introspection.errors) {
    violations.push({ code: VIOLATION_CODES.MODEL_INTROSPECTION_ERROR, model: err.file, detail: err.error });
  }

  const result = contract
    ? run({ contract, introspection, migrationSources: loadMigrationSources() })
    : { violations: [], summary: [] };

  const allViolations = [...violations, ...result.violations];
  const report = {
    reportType: 'model-field-contract',
    generatedAt: new Date().toISOString(),
    commit: gitCommit(),
    status: allViolations.length === 0 ? 'PASS' : 'FAIL',
    contractPath: path.relative(ROOT_DIR, CONTRACT_PATH),
    modelsIntrospected: Object.keys(introspection.models).length,
    modelFilesLoaded: introspection.loadedFiles.length,
    modelsWithContract: result.summary.length,
    violations: allViolations,
    summary: result.summary,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `[model-field-contracts] status=${report.status} models=${report.modelsIntrospected} `
      + `contratos=${report.modelsWithContract} violações=${allViolations.length}\n`,
    );
    for (const v of allViolations) {
      process.stdout.write(`  - ${v.code}: ${JSON.stringify(v)}\n`);
    }
  }
  process.exit(allViolations.length === 0 ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  run,
  collectMigrationColumns,
  loadMigrationSources,
  stripComments,
  VIOLATION_CODES,
  CONTRACT_PATH,
  REPORT_PATH,
};
