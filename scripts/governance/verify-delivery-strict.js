#!/usr/bin/env node
'use strict';

/**
 * verify-delivery-strict.js — juiz fail-closed da ENTREGA (usado pelo selo).
 *
 * Substitui o padrão defeituoso do `seal-release.sh`:
 *
 *     timeout 900 npm run verify:delivered-release > log 2>&1   # exit DESCARTADO
 *     if grep -qE 'DELIVERED_RELEASE_VERIFIED|DELIVERED_PENDING_SCORECARD' log; then ok ...
 *
 * Aqui: o verificador roda, o EXIT CODE é capturado, o relatório ESTRUTURADO é lido,
 * a cadeia é RECALCULADA e o veredito vem de `lib/delivery-verification.js`. O texto
 * do log entra só como diagnóstico. Exit 0 = entrega verificada; 1 = qualquer outra
 * coisa (com o código do motivo impresso).
 *
 * Uso: node scripts/governance/verify-delivery-strict.js [--json] [--no-run]
 *   --no-run: não executa o verificador; avalia o relatório já existente.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { avaliarEntrega } = require('./lib/delivery-verification');

const ROOT = path.resolve(__dirname, '..', '..');
const RELATORIO = path.join(ROOT, 'governance/delivered-release-verification-report.json');

function lerJson(abs) {
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (_) {
    return null;
  }
}

function main() {
  const semExecucao = process.argv.includes('--no-run');
  let exitCode = null;
  let logText = '';

  if (!semExecucao) {
    const r = spawnSync('npm', ['run', '--silent', 'verify:delivered-release'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: process.env,
      timeout: 900000,
    });
    exitCode = typeof r.status === 'number' ? r.status : null;
    logText = `${r.stdout || ''}${r.stderr || ''}`;
  } else {
    exitCode = 0; // avaliação do relatório existente: o exit é irrelevante por opção explícita
  }

  const relatorio = lerJson(RELATORIO);
  const run = lerJson(path.join(ROOT, 'governance/.current-run.json'));
  const identidadeAtual = run
    ? { runId: run.runId, sourceCommit: run.sourceCommit, sourceFingerprint: run.sourceFingerprint }
    : null;

  let cadeia = null;
  try {
    const { loadChain, verifyChain } = require('../../governance/governance-chain');
    const persistida = loadChain();
    if (!persistida) {
      cadeia = { valid: false, motivo: 'CADEIA_AUSENTE', failures: [] };
    } else {
      const v = verifyChain(persistida);
      cadeia = v && v.valid === true
        ? { valid: true, motivo: 'CADEIA_RECOMPUTADA_INTEGRA', failures: [] }
        : { valid: false, motivo: 'CADEIA_RECOMPUTADA_INVALIDA', failures: (v && v.failures) || [] };
    }
  } catch (err) {
    cadeia = { valid: false, motivo: `CADEIA_NAO_VERIFICAVEL:${err.message}`, failures: [] };
  }

  const veredito = avaliarEntrega({ exitCode, relatorio, identidadeAtual, cadeia, logText });

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ ...veredito, exitCode, cadeia: cadeia && cadeia.motivo }, null, 2)}\n`);
  } else if (veredito.ok) {
    process.stdout.write(`[verify-delivery-strict] PASS code=${veredito.code} decisao=${veredito.decisao} exit=${exitCode}\n`);
  } else {
    process.stderr.write(`[verify-delivery-strict] FAIL code=${veredito.code} motivo=${veredito.motivo}\n`);
    process.stderr.write(`  exit do verificador=${exitCode} | cadeia=${cadeia ? cadeia.motivo : 'n/a'}\n`);
    for (const d of veredito.diagnosticos) process.stderr.write(`  diagnostico: ${d}\n`);
    process.stderr.write('  a entrega exige exit 0 + relatorio estruturado + decisao permitida + identidade correspondente + cadeia integra + gates PASS\n');
  }

  return veredito.ok ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = { main };
