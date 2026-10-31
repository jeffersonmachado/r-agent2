#!/usr/bin/env node
'use strict';

/**
 * assert-ci-budget-unblocked.js — PROBE de que o bloqueio de BUDGET do GitHub Actions nao se
 * manifesta mais.
 *
 * Contexto (missão L-1 FINAL §2): o item `MISSAO-B9-CI-GITHUB-ACTIONS` nasceu de uma medição em
 * que os workflows disparavam e falhavam em 3-5 s **sem iniciar job**, com a anotação literal
 * "The job was not started because an Actions budget is preventing further use."
 *
 * A única prova honesta de que isso acabou é um run REAL em que os jobs iniciaram e executaram
 * passos. Este probe consulta a API do GitHub pelo `gh` e exige:
 *   1. existir ao menos um run recente concluído;
 *   2. esse run ter jobs com passos executados (startedAt preenchido e pelo menos um step com
 *      `startedAt`), o que é impossível quando o budget impede o início do job.
 *
 * FAIL-CLOSED: sem `gh` autenticado, sem rede ou sem run verificável, o exit é diferente de 0 e o
 * item permanece BLOCKED. Nunca "assume" que o budget foi liberado.
 *
 * Uso: node scripts/governance/assert-ci-budget-unblocked.js [--limit 5] [--json]
 * Exit: 0 = budget não bloqueia (jobs executam) · 1 = ainda bloqueado · 2 = não foi possível medir
 */

const { execFileSync } = require('child_process');

const ROOT = require('path').join(__dirname, '..', '..');
const argDe = (nome, padrao) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : padrao;
};
const LIMIT = Number(argDe('--limit', '5')) || 5;
const JSON_OUT = process.argv.includes('--json');

function gh(args) {
  return execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
}

function medir() {
  const runs = JSON.parse(gh(['run', 'list', '--limit', String(LIMIT), '--json', 'databaseId,status,conclusion,createdAt']));
  if (!Array.isArray(runs) || runs.length === 0) {
    return { medivel: false, motivo: 'SEM_RUNS_VISIVEIS' };
  }
  const concluidos = runs.filter((r) => r.status === 'completed');
  if (concluidos.length === 0) {
    return { medivel: false, motivo: 'SEM_RUN_CONCLUIDO', runs: runs.length };
  }
  for (const run of concluidos) {
    let jobs;
    try {
      jobs = JSON.parse(gh(['run', 'view', String(run.databaseId), '--json', 'jobs'])).jobs || [];
    } catch (_) {
      continue;
    }
    const comPassos = jobs.filter((j) => j && j.startedAt
      && Array.isArray(j.steps)
      && j.steps.some((s) => s && s.status === 'completed'));
    if (comPassos.length > 0) {
      return {
        medivel: true,
        bloqueadoPorBudget: false,
        runId: run.databaseId,
        conclusion: run.conclusion,
        jobsComPassosExecutados: comPassos.length,
        jobsTotal: jobs.length,
      };
    }
    // Nenhum job iniciou: é exatamente a assinatura do bloqueio de budget.
    if (jobs.length > 0) {
      return {
        medivel: true,
        bloqueadoPorBudget: true,
        runId: run.databaseId,
        conclusion: run.conclusion,
        jobsComPassosExecutados: 0,
        jobsTotal: jobs.length,
        motivo: 'JOBS_NAO_INICIARAM',
      };
    }
  }
  return { medivel: false, motivo: 'NENHUM_RUN_COM_JOBS_LEGIVEIS' };
}

function main() {
  let resultado;
  try {
    resultado = medir();
  } catch (err) {
    const detalhe = { medivel: false, motivo: `GH_INDISPONIVEL:${String(err.message).split('\n')[0]}` };
    if (JSON_OUT) console.log(JSON.stringify(detalhe));
    else console.error(`[ci-budget-probe] NAO MEDIVEL — ${detalhe.motivo}`);
    process.exitCode = 2;
    return;
  }
  if (JSON_OUT) console.log(JSON.stringify(resultado));
  else if (!resultado.medivel) console.error(`[ci-budget-probe] NAO MEDIVEL — ${resultado.motivo}`);
  else if (resultado.bloqueadoPorBudget) console.error(`[ci-budget-probe] AINDA BLOQUEADO — run ${resultado.runId}: ${resultado.jobsComPassosExecutados}/${resultado.jobsTotal} jobs com passos executados`);
  else console.log(`[ci-budget-probe] OK — run ${resultado.runId} executou ${resultado.jobsComPassosExecutados}/${resultado.jobsTotal} jobs com passos reais (conclusão: ${resultado.conclusion})`);

  if (!resultado.medivel) process.exitCode = 2;
  else process.exitCode = resultado.bloqueadoPorBudget ? 1 : 0;
}

if (require.main === module) main();

module.exports = { medir };
