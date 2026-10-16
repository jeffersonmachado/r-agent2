#!/usr/bin/env node
'use strict';

/**
 * Grava AI_MEMORY/evidence/aggregate-enforcement-last-run.json a partir do LOG
 * REAL de uma execução do gate agregado — porque o alias
 * `validate:governance-enforcement` é uma cadeia de `npm run && ...` e NÃO
 * persiste veredito próprio (+ `reports/governance-enforcement-full-report.json`
 * é escrito por `run-all-validators.js`, que o alias não usa).
 *
 * Nada é escrito à mão: exit code, contagens, hashes e datas são derivados do log.
 *
 * Uso:
 *   node tools/audit/record-aggregate-run.js --log /tmp/agg7.log --head 602a00a1c
 *
 * Posição: `tools/audit/` — fora de SOURCE_ROOTS, não altera o sourceFingerprint.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const DESTINO = path.join(ROOT, 'AI_MEMORY/evidence/aggregate-enforcement-last-run.json');
const AGREGADO = 'npm run validate:governance-enforcement';

function arg(nome, padrao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const logRel = arg('log');
if (!logRel) {
  console.error('uso: node tools/audit/record-aggregate-run.js --log <caminho> [--head <sha>] [--exit <code>]');
  process.exit(2);
}
const logAbs = path.isAbsolute(logRel) ? logRel : path.join(ROOT, logRel);
if (!fs.existsSync(logAbs)) {
  console.error(`log nao encontrado: ${logAbs}`);
  process.exit(2);
}

const conteudo = fs.readFileSync(logAbs, 'utf8');
const linhas = conteudo.split('\n');

// Exit code: --exit explícito > `*_EXIT=<n>` no log > `AGG_EXIT=<n>` genérico.
const doLog = linhas.map((l) => /^[A-Z0-9_]*EXIT=(\d+)$/.exec(l.trim())).filter(Boolean).pop();
const exitCode = arg('exit') !== null ? Number(arg('exit')) : doLog ? Number(doLog[1]) : null;

const contagem = (re) => linhas.filter((l) => re.test(l)).length;

const headAtRun = arg('head');
const sha256 = crypto.createHash('sha256').update(conteudo).digest('hex');
const st = fs.statSync(logAbs);

const doc = {
  artifactType: 'aggregate-enforcement-last-run',
  artifactVersion: '1.0.0',
  generatedBy: 'tools/audit/record-aggregate-run.js',
  recordedAt: new Date().toISOString(),
  command: AGREGADO,
  // O que PROVA o agregado é o exit 0 da cadeia `&&` (um único passo vermelho
  // tornaria o exit diferente de zero). As contagens abaixo são diagnóstico,
  // NÃO o veredito: cada gate formata seu próprio "PASS", então a contagem de
  // linhas não corresponde 1:1 ao número de passos.
  veredito: exitCode === 0 ? 'PASS' : exitCode === null ? 'DESCONHECIDO' : 'FAIL',
  exitCode,
  semanticaDoVeredito:
    'exit 0 numa cadeia && encadeada prova que TODOS os passos passaram. Contagem de linhas status=PASS é diagnóstico de formatação, não veredito.',
  diagnostico: {
    passLines: contagem(/status=PASS/),
    failLines: contagem(/status=FAIL/),
    noGoLines: contagem(/status=NO_GO/),
    totalLines: linhas.length,
  },
  execucao: {
    logPath: path.relative(ROOT, logAbs).split(path.sep).join('/'),
    logSha256: sha256,
    logBytes: st.size,
    logFinishedAt: st.mtime.toISOString(),
    headAtRun,
    headSource: headAtRun ? 'explicit (informado na gravacao)' : 'nao informado',
  },
};

fs.writeFileSync(DESTINO, JSON.stringify(doc, null, 2) + '\n');
console.log(`[aggregate-run] veredito=${doc.veredito} exit=${exitCode}`);
console.log(`[aggregate-run] passLines=${doc.diagnostico.passLines} failLines=${doc.diagnostico.failLines}`);
console.log(`[aggregate-run] escrito: ${path.relative(ROOT, DESTINO)}`);
