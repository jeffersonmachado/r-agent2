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
const { ESTADOS, DEGRAUS, executarEscada, selecionarDegraus } = require('../../governance/certification-ladder');

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
  // P1-B: a SELEÇÃO decide o que executa. Antes, `--only` filtrava só a exibição DEPOIS de rodar a
  // escada inteira — gate não selecionado rodava e produzia efeito colateral real (wave, suíte,
  // selagem) sem aparecer no relatório. Seleção inválida falha fechado sem rodar nada.
  const selecao = selecionarDegraus(SOMENTE ? [SOMENTE] : null);
  if (!selecao.ok) {
    process.stderr.write(`[escada] degrau desconhecido: ${SOMENTE}\n`);
    return 2;
  }

  // Runners só existem para os degraus selecionados: defesa em profundidade contra execução
  // acidental de algo fora do fecho de dependências.
  const runners = {};
  for (const id of selecao.ids) {
    const passo = DEGRAUS.find((d) => d.id === id);
    runners[id] = async () => rodarComando(passo.comando);
  }

  const resultado = await executarEscada({
    runners,
    apenas: SOMENTE ? [SOMENTE] : null,
  });

  const trilha = resultado.trilha;

  if (flag('--json')) {
    process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), trilha, resumo: resultado.resumo, certificavel: resultado.certificavel, problemas: resultado.problemas || [] }, null, 2)}\n`);
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
    for (const problema of resultado.problemas || []) {
      process.stdout.write(`[escada] NAO_CERTIFICAVEL ${problema.code} ${problema.id || ''} — ${problema.detail}\n`);
    }
    process.stdout.write(`[escada] relatório: ${path.relative(ROOT, RELATORIO)}\n`);
  }

  fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
  fs.writeFileSync(RELATORIO, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    trilha,
    resumo: resultado.resumo,
    certificavel: resultado.certificavel,
    problemas: resultado.problemas || [],
  }, null, 2)}\n`);

  // `--only` é diagnóstico: o exit reflete o degrau pedido, sem nunca declarar certificação.
  if (resultado.parcial) {
    const alvo = resultado.parcialResumo && resultado.parcialResumo.alvo;
    const estado = resultado.parcialResumo && resultado.parcialResumo.state;
    process.stdout.write(`[escada] execução PARCIAL (--only ${alvo}): estado=${estado} — não é certificação\n`);
    return estado === ESTADOS.PASS ? 0 : 1;
  }
  return resultado.certificavel ? 0 : 1;
}

if (require.main === module) {
  principal().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`[escada] erro fatal: ${error && error.message}\n`);
    process.exitCode = 2;
  });
}

module.exports = { rodarComando };
