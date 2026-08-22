#!/usr/bin/env node
'use strict';

/**
 * verify-no-mutable-json-state.js — enforcement de eliminação de estado mutável
 * em JSON/filesystem (RAP-078).
 *
 * Invariante RAP: o banco é a fonte canônica de STATE/RELATIONSHIPS/LINEAGE/
 * STATUS/HISTORY/DECISIONS. Nenhum componente crítico pode usar JSON local como
 * banco de estado mutável quando esse estado exige concorrência, versionamento,
 * histórico, lineage, consulta, multi-node, recovery, tenant isolation ou
 * consistência transacional.
 *
 * Regras verificadas:
 *   1. Todo alvo de escrita JSON em runtime path deve estar classificado no
 *      inventário governance/json-persistence-audit.json (0 UNKNOWN).
 *   2. Nenhum alvo classificado como DB_CANONICAL_STATE (estado mutável em
 *      arquivo) pode continuar sendo escrito em runtime — deve ter sido migrado
 *      para o banco (reclassificado DB_CANONICAL_JSON_EXPORT após a migração).
 *   3. Nenhum alvo DEPRECATED pode ser escrito.
 *
 * Saída: governance/mutable-json-state-validation-report.json (EXPORT do DB).
 * Sucesso: MUTABLE_FILESYSTEM_STATE_OK + exit 0.
 * Falha:   MUTABLE_FILESYSTEM_STATE_VIOLATION + exit 1.
 *
 * Uso:
 *   node governance/verify-no-mutable-json-state.js [--strict]
 */

const fs = require('fs');
const path = require('path');
const { buildAudit } = require('./json-persistence-audit');
const { connect, close } = require('../api/db/sequelize');
const getRun = require('../api/db/models/GovernanceRun');

const ROOT = process.cwd();

function verify({ strict = false, run = null } = {}) {
  const audit = buildAudit();
  const violations = [];
  const unknown = audit.entries.filter((e) => e.category === 'UNKNOWN');
  const deprecated = audit.entries.filter((e) => e.category === 'DEPRECATED');
  const dbCanonicalState = audit.entries.filter((e) => e.category === 'DB_CANONICAL_STATE');

  for (const e of unknown) {
    violations.push({ type: 'MUTABLE_FILESYSTEM_STATE_VIOLATION', subtype: 'UNKNOWN_JSON_WRITE_TARGET', writer: e.writer, target: e.target, message: `JSON write target sem classificação: ${e.target} (${e.writer})` });
  }
  for (const e of deprecated) {
    violations.push({ type: 'MUTABLE_FILESYSTEM_STATE_VIOLATION', subtype: 'DEPRECATED_JSON_WRITE', writer: e.writer, target: e.target, message: `JSON write em path DEPRECATED: ${e.target} (${e.writer})` });
  }
  for (const e of dbCanonicalState) {
    violations.push({ type: 'MUTABLE_FILESYSTEM_STATE_VIOLATION', subtype: 'DB_CANONICAL_STATE_WRITE', writer: e.writer, target: e.target, message: `JSON usado como banco de estado mutável: ${e.target} (${e.writer}) — migrar para o banco` });
  }

  const pass = violations.length === 0;
  return {
    artifactType: 'mutable-json-state-validation-report',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    runId: run?.run_id || null,
    sourceFingerprint: run?.source_fingerprint || null,
    status: pass ? 'PASS' : 'FAIL',
    decision: pass ? 'MUTABLE_FILESYSTEM_STATE_OK' : 'MUTABLE_FILESYSTEM_STATE_VIOLATION',
    summary: {
      totalWriteTargets: audit.summary.totalWriteTargets,
      unknown: unknown.length,
      deprecated: deprecated.length,
      dbCanonicalStateWrites: dbCanonicalState.length,
      violations: violations.length,
      status: pass ? 'PASS' : 'FAIL',
    },
    violations,
    inventory: audit.summary.byCategory,
  };
}

function readCurrentRunFromJson() {
  try {
    const current = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance', '.current-run.json'), 'utf8'));
    return {
      run_id: current.runId || null,
      source_fingerprint: current.sourceFingerprint || null,
      policy_fingerprint: current.policyFingerprint || null,
    };
  } catch (_) {
    return null;
  }
}

async function main() {
  let run = null;
  try {
    await connect();
    run = await getRun().findOne({ order: [['created_at', 'DESC']] });
  } catch (_) {
    run = null;
  }
  // DB-free fallback: em extração limpa (DELIVERED) o .current-run.json commitado
  // carrega a lineage do run — o verifier permanece dependency-light e reproduzível.
  if (!run) run = readCurrentRunFromJson();
  const result = verify({ run });
  fs.mkdirSync(path.join(ROOT, 'governance'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'governance', 'mutable-json-state-validation-report.json'), `${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'PASS') console.log('MUTABLE_FILESYSTEM_STATE_OK');
  else {
    console.log('MUTABLE_FILESYSTEM_STATE_VIOLATION');
    for (const v of result.violations) console.log(`  - ${v.subtype}: ${v.target} (${v.writer})`);
  }
  console.log(JSON.stringify(result.summary));
  process.exitCode = result.status === 'PASS' ? 0 : 1;
  await close().catch(() => {});
}

if (require.main === module) main();

module.exports = { verify };
