#!/usr/bin/env node
'use strict';

/**
 * certification-ladder.js — executa a escada de certificação na ORDEM oficial e diz, para cada
 * degrau, PASSOU / FALHOU / BLOQUEADO (com o pré-requisito que faltou).
 *
 * POR QUE EXISTE
 * --------------
 * A certificação falha em CADEIA (âncora → fechamento → execução autoritativa → required-tests →
 * waves → cobertura → agregado). Rodar cada gate isolado mostra o vermelho, não a ORDEM. Este script
 * transforma o diagnóstico em checklist executável: nunca marca BLOCKED como PASS, e só tenta um
 * degrau depois que os pré-requisitos passaram (quem decide se PODE rodar continua sendo o gate).
 *
 * SEGURANÇA: não imprime valor de segredo; só presença/ausência dos nomes. Não liga override de
 * política. `--only <id>` roda um degrau (respeitando pré-requisitos).
 *
 * Uso:
 *   node scripts/governance/certification-ladder.js [--json] [--only <id>] [--timeout-ms N]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ESTADOS, DEGRAUS, executarEscada } = require('../../governance/certification-ladder');

const ROOT = path.join(__dirname, '..', '..');
const RELATORIO = path.join(ROOT, 'reports', 'certification-ladder-report.json');

const arg = (nome, padrao = null) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};
const flag = (nome) => process.argv.includes(nome);
const TIMEOUT = Number(arg('--timeout-ms', '1800000')) || 1800000;
const SOMENTE = arg('--only');

function rodarComando(comando) {
  const inicio = Date.now();
  const r = spawnSync(comando, {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    timeout: TIMEOUT,
    env: { ...process.env, CI: process.env.CI || '' },
  });
  const saida = `${r.stdout || ''}${r.stderr || ''}`;
  const ultimaLinha = saida.trim().split('\n').filter(Boolean).slice(-1)[0] || '';
  return {
    ok: r.status === 0,
    exitCode: r.status,
    duracaoMs: Date.now() - inicio,
    detail: ultimaLinha.slice(0, 300),
  };
}

async function principal() {
  const runners = {};
  for (const d of DEGRAUS) {
    runners[d.id] = async (passo) => rodarComando(passo.comando);
  }

  let escada = DEGRAUS;
  if (SOMENTE) {
    escada = DEGRAUS.filter((d) => d.id === SOMENTE);
    if (escada.length === 0) {
      process.stderr.write(`[escada] degrau desconhecido: ${SOMENTE}\n`);
      return 2;
    }
  }

  const resultado = await executarEscada({
    runners,
    // `--only` executa só o degrau pedido; os demais não entram como SKIPPED.
    ...(SOMENTE ? { resultados: {} } : {}),
  });

  const trilha = SOMENTE
    ? resultado.trilha.filter((t) => t.id === SOMENTE)
    : resultado.trilha;

  if (flag('--json')) {
    process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), trilha, resumo: resultado.resumo, certificavel: resultado.certificavel }, null, 2)}\n`);
  } else {
    process.stdout.write('[escada] ordem oficial de certificação\n');
    for (const t of trilha) {
      const passo = DEGRAUS.find((d) => d.id === t.id);
      const marca = { PASS: 'OK  ', FAIL: 'FALHA', BLOCKED: 'BLOQ ', SKIPPED: 'PULA ' }[t.state] || t.state;
      const extra = t.state === ESTADOS.BLOCKED
        ? ` (falta: ${(t.blockedBy || []).join(', ')})`
        : (t.detail ? ` — ${t.detail}` : '');
      process.stdout.write(`  ${marca} ${t.id.padEnd(24)} ${passo ? passo.comando : ''}${extra}\n`);
      if (t.state === ESTADOS.FAIL && passo && passo.corrige) {
        process.stdout.write(`        corrige: ${passo.corrige}${passo.dono ? ' (AÇÃO DE DONO)' : ''}\n`);
      }
    }
    process.stdout.write(`[escada] resumo=${JSON.stringify(resultado.resumo)} certificavel=${resultado.certificavel}\n`);
    process.stdout.write(`[escada] relatório: ${path.relative(ROOT, RELATORIO)}\n`);
  }

  fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
  fs.writeFileSync(RELATORIO, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    trilha,
    resumo: resultado.resumo,
    certificavel: resultado.certificavel,
  }, null, 2)}\n`);

  return resultado.certificavel ? 0 : 1;
}

if (require.main === module) {
  principal().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`[escada] erro fatal: ${error && error.message}\n`);
    process.exitCode = 2;
  });
}

module.exports = { rodarComando };
