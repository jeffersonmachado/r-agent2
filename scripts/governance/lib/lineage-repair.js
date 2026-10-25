#!/usr/bin/env node
'use strict';

/**
 * REPARO DE LINEAGE COM ALLOWLIST — P1 da missão 2026-10-25 (§5).
 *
 * DEFEITO MEDIDO em `scripts/governance/seal-release.sh` (`phase_verify_delivery`): quando o juiz
 * estrito reprovava a entrega, o reparo fazia
 *
 *     node scripts/governance/stamp-report-lineage.js
 *     git add -A                       # <-- TUDO o que estivesse sujo no worktree
 *     git commit -m "fix(governance): re-stampa lineage clobberado…"
 *     git push origin "$branch_atual"
 *
 * Consequências reais: (a) qualquer alteração alheia ao reparo (arquivo de trabalho, resíduo de run,
 * relatório de outra fase) entrava no commit com mensagem de reparo de lineage — atribuição falsa;
 * (b) o push publicava esse conteúdo sem que ninguém tivesse decidido publicá-lo; (c) com worktree
 * sujo por outro motivo, o "reparo" virava um commit largo e o defeito ficava invisível no histórico.
 *
 * REGRA: o reparo só pode tocar os artefatos que o próprio estampador escreve — lista derivada da
 * MESMA taxonomia canônica (`config/runtime-evidence-artifacts.json` via `listAuthoritativeArtifacts`)
 * mais o ponteiro do run corrente. Qualquer caminho fora dessa lista bloqueia o reparo inteiro:
 * nada é staged, nada é commitado, nada é empurrado.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');

/** Ponteiro do run governado corrente: escrito por `create-governed-run`, lido pelo estampador. */
const PONTEIRO_DO_RUN = 'governance/.current-run.json';

/**
 * Caminhos que o reparo de lineage pode legitimamente tocar.
 * @returns {string[]} caminhos relativos à raiz, ordenados
 */
function listarAllowlistDeReparo() {
  const { listAuthoritativeArtifacts } = require('./runtime-evidence-artifacts');
  const artefatos = listAuthoritativeArtifacts();
  const lista = new Set(artefatos);
  lista.add(PONTEIRO_DO_RUN);
  return [...lista].sort();
}

/**
 * Normaliza saída de `git status --porcelain=v1` em pares `{ status, caminho }`.
 * Renomeações (`R  antigo -> novo`) contam os DOIS lados: o antigo também foi mexido.
 */
function parseStatusPorcelain(saida) {
  return String(saida || '')
    .split('\n')
    .map((linha) => linha.replace(/\s+$/, ''))
    .filter((linha) => linha.length > 3)
    .flatMap((linha) => {
      const status = linha.slice(0, 2);
      const resto = linha.slice(3);
      const seta = resto.indexOf(' -> ');
      if (seta >= 0) return [{ status, caminho: resto.slice(0, seta) }, { status, caminho: resto.slice(seta + 4) }];
      return [{ status, caminho: resto }];
    });
}

/**
 * Subconjunto da allowlist que o git RASTREIA.
 *
 * Descoberto na revisão adversarial de 2026-10-25: 37 dos 62 caminhos da allowlist são IGNORADOS por
 * `.gitignore` (artefatos derivados). `git add` recusa caminho ignorado com exit 1 — o reparo
 * falharia SEMPRE, e falharia na última fase do selo (depois da publicação). Artefato ignorado não é
 * versionado: não há o que persistir nele, e forçá-lo com `git add -f` contrariaria a política de
 * ignore. Portanto o reparo commita apenas o que é rastreado.
 */
function listarRastreados(lista = null, raiz = ROOT) {
  const alvo = lista || listarAllowlistDeReparo();
  try {
    const saida = execFileSync('git', ['ls-files', '-z', '--', ...alvo], {
      cwd: raiz,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    return saida.split('\0').filter(Boolean).sort();
  } catch (_) {
    return [];
  }
}

/**
 * Decide se o reparo pode acontecer.
 *
 * @param {string} saidaStatus saída de `git status --porcelain=v1`
 * @param {string[]} allowlist caminhos permitidos (relativos à raiz)
 * @param {string[]} [rastreados] subconjunto versionado da allowlist (default: consulta o git)
 * @returns {{ok:boolean, motivo:string|null, naoAutorizados:string[], paraCommitar:string[],
 *            ignoradosForaDoCommit:string[], staged:boolean}}
 */
function avaliarWorktreeParaReparo(saidaStatus, allowlist = listarAllowlistDeReparo(), rastreados = null) {
  const permitidos = new Set(allowlist);
  const versionados = new Set(rastreados || listarRastreados(allowlist));
  const entradas = parseStatusPorcelain(saidaStatus);

  // Arquivo NÃO rastreado (`??`) nunca é permitido: o estampador só reescreve arquivo existente.
  const naoAutorizados = entradas
    .filter((e) => !permitidos.has(e.caminho))
    .map((e) => e.caminho)
    .sort();

  const permitidosSujos = entradas.filter((e) => permitidos.has(e.caminho)).map((e) => e.caminho).sort();
  const paraCommitar = permitidosSujos.filter((caminho) => versionados.has(caminho));
  const ignoradosForaDoCommit = permitidosSujos.filter((caminho) => !versionados.has(caminho));

  if (naoAutorizados.length > 0) {
    return {
      ok: false,
      motivo: `WORKTREE_COM_ARQUIVO_NAO_AUTORIZADO:${naoAutorizados.join(',')}`,
      naoAutorizados,
      paraCommitar,
      ignoradosForaDoCommit,
      staged: false,
    };
  }
  if (paraCommitar.length === 0) {
    return {
      ok: true,
      motivo: ignoradosForaDoCommit.length > 0 ? 'APENAS_ARTEFATOS_IGNORADOS' : 'NADA_A_REPARAR',
      naoAutorizados: [],
      paraCommitar: [],
      ignoradosForaDoCommit,
      staged: false,
    };
  }
  return { ok: true, motivo: null, naoAutorizados: [], paraCommitar, ignoradosForaDoCommit, staged: true };
}

/** Executa `git status --porcelain=v1` na raiz informada. */
function statusAtual(raiz = ROOT) {
  try {
    return execFileSync('git', ['status', '--porcelain=v1'], { cwd: raiz, encoding: 'utf8' });
  } catch (_) {
    return '';
  }
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--allowlist')) {
    process.stdout.write(`${listarAllowlistDeReparo().join('\n')}\n`);
    return 0;
  }
  if (argv.includes('--rastreados')) {
    // Só o que o git rastreia: artefato ignorado não é persistível (ver `listarRastreados`).
    process.stdout.write(`${listarRastreados().join('\n')}\n`);
    return 0;
  }
  const raiz = argv.includes('--raiz') ? argv[argv.indexOf('--raiz') + 1] : ROOT;
  const decisao = avaliarWorktreeParaReparo(statusAtual(raiz));
  process.stdout.write(`${JSON.stringify(decisao, null, 2)}\n`);
  return decisao.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  PONTEIRO_DO_RUN,
  listarAllowlistDeReparo,
  listarRastreados,
  parseStatusPorcelain,
  avaliarWorktreeParaReparo,
  statusAtual,
  main,
};
