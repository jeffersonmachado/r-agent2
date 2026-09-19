#!/usr/bin/env node
'use strict';

/**
 * record-semantic-version.js — registra a versão do pipeline semântico em uma
 * amostra de vertical, DEPOIS de reprocessá-la.
 *
 * Este é o produtor legítimo do campo exigido pelo gate
 * CERTIFIED_SAMPLE_SEMANTIC_VERSION_CURRENT. Sem ele, o gate é um beco sem
 * saída: ninguém consegue certificar, e o único jeito de ficar verde passaria a
 * ser editar o JSON à mão — exatamente o tipo de atalho que o gate existe para
 * impedir.
 *
 * O QUE ESTE SCRIPT NÃO FAZ
 *   - Não reprocessa nada por conta própria. Ele REGISTRA um reprocessamento
 *     que já aconteceu, e exige o runId que o executou.
 *   - Não inventa versão: deriva do conteúdo dos módulos agora, e falha se o
 *     run informado não existir no banco. Uma certificação sem run é uma
 *     afirmação sem dono.
 *
 * Uso:
 *   node --env-file-if-exists=.env scripts/benchmark/record-semantic-version.js \
 *     --vertical fitness --run rap-governed-20260919...
 *   (adicione --dry-run para apenas mostrar o que seria gravado)
 */

const fs = require('fs');
const path = require('path');

const {
  getSemanticPipelineVersion,
} = require('../../api/services/benchmark/semantic/semanticPipelineVersion');

const ROOT_DIR = path.join(__dirname, '..', '..');
const SAMPLES_DIR = path.join(ROOT_DIR, 'config', 'benchmarks');

const EXIT = Object.freeze({
  OK: 0,
  USAGE: 2,
  SAMPLE_MISSING: 3,
  RUN_UNKNOWN: 4,
  RUN_NOT_FOUND: 5,
  WRITE_FAILED: 6,
});

function parseArgs(argv) {
  const args = { vertical: null, run: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--vertical') { args.vertical = argv[i + 1]; i += 1; }
    else if (token === '--run') { args.run = argv[i + 1]; i += 1; }
    else if (token === '--dry-run') args.dryRun = true;
  }
  return args;
}

async function assertRunExists(runId) {
  const { connect, close } = require('../../api/db/sequelize');
  const getRun = require('../../api/db/models/GovernanceRun');
  await connect();
  try {
    const row = await getRun().findOne({ where: { run_id: runId } });
    return row ? { found: true, sourceFingerprint: row.source_fingerprint, startedAt: row.started_at } : { found: false };
  } finally {
    await close().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.vertical || !args.run) {
    console.error('uso: record-semantic-version.js --vertical <v> --run <runId> [--dry-run]');
    process.exitCode = EXIT.USAGE;
    return;
  }

  const samplePath = path.join(SAMPLES_DIR, `${args.vertical}.json`);
  if (!fs.existsSync(samplePath)) {
    console.error(`[record-semantic-version] amostra ausente: ${path.relative(ROOT_DIR, samplePath)}`);
    process.exitCode = EXIT.SAMPLE_MISSING;
    return;
  }

  let run;
  try {
    run = await assertRunExists(args.run);
  } catch (error) {
    console.error(`[record-semantic-version] não foi possível conferir o run: ${error.message}`);
    process.exitCode = EXIT.RUN_UNKNOWN;
    return;
  }
  if (!run.found) {
    // Fail-closed: certificar exige um run que exista. Sem isso, a versão
    // gravada aponta para um reprocessamento que ninguém pode auditar.
    console.error(`[record-semantic-version] run desconhecido: ${args.run}`);
    process.exitCode = EXIT.RUN_NOT_FOUND;
    return;
  }

  const { version, formatVersion, components } = getSemanticPipelineVersion();
  const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  const previous = sample.semanticPipelineVersion || null;

  const next = {
    ...sample,
    semanticPipelineVersion: version,
    semanticPipelineFormatVersion: formatVersion,
    semanticPipelineComponents: components.map((c) => c.name),
    semanticReprocessRunId: args.run,
    semanticReprocessedAt: new Date().toISOString(),
  };

  if (args.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      sample: path.relative(ROOT_DIR, samplePath),
      previousVersion: previous,
      nextVersion: version,
      runId: args.run,
      runSourceFingerprint: run.sourceFingerprint,
    }, null, 2));
    return;
  }

  try {
    fs.writeFileSync(samplePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error(`[record-semantic-version] falha ao gravar: ${error.message}`);
    process.exitCode = EXIT.WRITE_FAILED;
    return;
  }

  console.log(JSON.stringify({
    sample: path.relative(ROOT_DIR, samplePath),
    previousVersion: previous,
    semanticPipelineVersion: version,
    semanticReprocessRunId: args.run,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { EXIT, parseArgs };
