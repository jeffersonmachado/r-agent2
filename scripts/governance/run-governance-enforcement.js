#!/usr/bin/env node
'use strict';

/**
 * GATE AGREGADO COM VEREDITO PRÓPRIO (P1 — HARDENING-ENG-GOV-RELEASE-AGREGADO-SEM-RELATORIO-PROPRIO).
 *
 * DEFEITO MEDIDO
 * --------------
 * `npm run validate:governance-enforcement` era uma cadeia `&&` do npm: o único
 * registro do resultado era o exit code do processo que a invocou. Nada no disco
 * dizia "o gate agregado do run X, sobre o commit Y, com o fingerprint Z, passou
 * (ou falhou) em N passos, e falhou no passo W". Um veredito sem registro próprio
 * não é auditável: quem lê o repositório (ou o auditor externo que só vê git) não
 * consegue distinguir "nunca rodou" de "rodou e passou" nem de "rodou e falhou".
 *
 * O QUE ESTE WRAPPER FAZ
 * ----------------------
 * - executa a MESMA cadeia (lida de `validate:governance-enforcement:chain` em
 *   package.json — uma única fonte, sem lista duplicada);
 * - preserva fail-fast: para no primeiro passo que falhar (mesmo comportamento);
 * - propaga o exit code real (0 só se TODOS passarem);
 * - grava `reports/governance-enforcement-verdict.json` com identidade do run
 *   (runId/sourceCommit/sourceFingerprint), lista de passos com exit code,
 *   duração e sha256 da saída, e o veredito final.
 *
 * FAIL-CLOSED: sem identidade de run completa o veredito é `BLOCKED`, nunca PASS.
 *
 * Uso:
 *   node scripts/governance/run-governance-enforcement.js [--json] [--out <path>]
 *                                                          [--somente-passos]
 */

const { spawnSync, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SAIDA_PADRAO = path.join(ROOT, 'reports', 'governance-enforcement-verdict.json');

const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

function lerCadeia() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const bruta = pkg.scripts['validate:governance-enforcement:chain'];
  if (!bruta) {
    const erro = new Error('CHAIN_SCRIPT_AUSENTE: package.json sem validate:governance-enforcement:chain');
    erro.code = 'CHAIN_SCRIPT_AUSENTE';
    throw erro;
  }
  return bruta.split('&&').map((s) => s.trim()).filter(Boolean);
}

function identidade() {
  const ler = (k) => (process.env[k] && String(process.env[k]).trim()) || null;
  let commit = ler('GOVERNANCE_SOURCE_COMMIT');
  if (!commit) {
    try {
      commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch (_) { commit = null; }
  }
  return {
    runId: ler('GOVERNANCE_RUN_ID'),
    sourceFingerprint: ler('GOVERNANCE_SOURCE_FINGERPRINT'),
    sourceCommit: commit,
    sourceTree: ler('GOVERNANCE_SOURCE_TREE'),
  };
}

function identidadeCompleta(id) {
  const faltantes = [];
  if (!id.runId) faltantes.push('runId');
  if (!id.sourceFingerprint) faltantes.push('sourceFingerprint');
  if (!id.sourceCommit || !/^[0-9a-f]{40}$/i.test(String(id.sourceCommit))) faltantes.push('sourceCommit');
  return { completa: faltantes.length === 0, faltantes };
}

/**
 * Executa a cadeia e devolve o veredito (sem I/O de disco além dos subprocessos).
 * @param {{cadeia?: string[], executor?: Function, id?: object}} [opcoes]
 */
function executarCadeia(opcoes = {}) {
  const cadeia = opcoes.cadeia || lerCadeia();
  const id = opcoes.id || identidade();
  const executor = opcoes.executor || ((comando) => {
    const inicio = Date.now();
    const r = spawnSync(comando, {
      cwd: ROOT, encoding: 'utf8', shell: true, env: process.env,
      maxBuffer: 64 * 1024 * 1024,
    });
    const saida = `${r.stdout || ''}${r.stderr || ''}`;
    return {
      exitCode: r.status === null ? null : r.status,
      duracaoMs: Date.now() - inicio,
      sha256Saida: sha256(saida),
      saidaFinal: saida.trim().split('\n').slice(-6).join('\n'),
    };
  });

  const idCheck = identidadeCompleta(id);
  const passos = [];
  let interrompidoEm = null;

  for (const comando of cadeia) {
    const resultado = executor(comando);
    passos.push({ comando, ...resultado });
    const falhou = resultado.exitCode === null || resultado.exitCode !== 0;
    if (falhou) {
      interrompidoEm = comando;
      break; // fail-fast: mesmo comportamento da cadeia `&&`
    }
  }

  const todosPassaram = passos.length === cadeia.length && passos.every((p) => p.exitCode === 0);
  let status;
  if (!idCheck.completa) status = 'BLOCKED';
  else if (todosPassaram) status = 'PASS';
  else status = 'FAIL';

  return {
    schemaVersion: 1,
    kind: 'governance-enforcement-verdict',
    generatedAt: new Date().toISOString(),
    status,
    identidade: id,
    identidadeFaltantes: idCheck.faltantes,
    totalPassos: cadeia.length,
    passosExecutados: passos.length,
    interrompidoEm,
    passos,
    // Verdade explícita: PASS só com 100% dos passos verdes E identidade completa.
    motivo: status === 'PASS'
      ? null
      : (!idCheck.completa
        ? `identidade de run incompleta (${idCheck.faltantes.join(',')}) — veredito não é certificável`
        : `passo falhou: ${interrompidoEm}`),
  };
}

function main(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const somente = argv.includes('--somente-passos');
  const iOut = argv.indexOf('--out');
  const saida = iOut >= 0 ? path.resolve(ROOT, argv[iOut + 1]) : SAIDA_PADRAO;

  const veredito = executarCadeia();

  if (!somente) {
    fs.mkdirSync(path.dirname(saida), { recursive: true });
    fs.writeFileSync(saida, `${JSON.stringify(veredito, null, 2)}\n`, 'utf8');
  }

  if (json) process.stdout.write(`${JSON.stringify(veredito, null, 2)}\n`);
  else {
    process.stdout.write(
      `[agg] status=${veredito.status} passos=${veredito.passosExecutados}/${veredito.totalPassos}`
      + `${veredito.interrompidoEm ? ` interrompido=${veredito.interrompidoEm}` : ''}\n`
    );
    if (veredito.motivo) process.stdout.write(`[agg] motivo: ${veredito.motivo}\n`);
    process.stdout.write(`[agg] veredito: ${path.relative(ROOT, saida)}\n`);
  }

  return veredito.status === 'PASS' ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, executarCadeia, lerCadeia, identidadeCompleta };
