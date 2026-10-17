#!/usr/bin/env node
'use strict';

/**
 * FECHAMENTO DE RUN GOVERNADO ÓRFÃO (defeito H20, 2026-10-17).
 *
 * PROBLEMA MEDIDO
 * ---------------
 * Um ciclo de selagem interrompido entre `create-governed-run` e a fase que
 * regenera a projeção deixa o estado local assim:
 *
 *   governance/.current-run.json      runId=…111858007  (createdAt 11:18:58Z)
 *   dev/platform-readiness/latest.json runId=…053314590 (generatedAt 11:12:00Z)
 *   mesmo sourceCommit (aa2db65fb)
 *
 * O run fica "aberto" para sempre: nada o encerra, nada declara que o ciclo
 * falhou, e o invariante "projeção pertence ao run corrente" passa a depender de
 * onde o ciclo parou. Não é drift ambiental — é ausência de um estado explícito.
 *
 * SOLUÇÃO
 * -------
 * Um run governado precisa poder ser ENCERRADO sem ser certificado. Este comando
 * grava, no próprio run-context:
 *
 *   status: SUPERSEDED | ABANDONED
 *   closedAt / closedBy / closedReason   (obrigatórios)
 *   closedEvidence                       (obrigatório: o que prova o fechamento)
 *
 * A partir daí o run NÃO é "corrente": ele é histórico auditável. O gate e o teste
 * de lineage passam a exigir coerência só para run ABERTO, e exigem que run
 * fechado DECLARE como/o porquê foi fechado (fechar não pode esconder divergência).
 *
 * Uso:
 *   node scripts/governance/close-run-context.js --reason "..." --evidence "..."
 *        [--status SUPERSEDED|ABANDONED] [--by <ator>] [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const RUN_CONTEXT = path.join(ROOT, 'governance', '.current-run.json');

const ESTADOS_DE_FECHAMENTO = Object.freeze(['SUPERSEDED', 'ABANDONED']);

function arg(argv, nome, curto) {
  const i = argv.findIndex((a) => a === nome || (curto && a === curto));
  return i >= 0 ? argv[i + 1] : null;
}

function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const status = String(arg(argv, '--status') || 'ABANDONED').toUpperCase();
  const reason = arg(argv, '--reason');
  const evidence = arg(argv, '--evidence');
  const by = arg(argv, '--by') || process.env.USER || 'operador';

  if (!ESTADOS_DE_FECHAMENTO.includes(status)) {
    process.stderr.write(`[close-run] --status deve ser ${ESTADOS_DE_FECHAMENTO.join('|')}\n`);
    return 2;
  }
  if (!reason || String(reason).trim() === '') {
    process.stderr.write('[close-run] --reason é obrigatório: fechar sem motivo é apagar prova\n');
    return 2;
  }
  if (!evidence || String(evidence).trim() === '') {
    process.stderr.write('[close-run] --evidence é obrigatório (caminho/hash do que prova o fechamento)\n');
    return 2;
  }

  // Caminho injetável (testes e runs de outro runtime); default é o canônico.
  const contexto = arg(argv, '--context') || RUN_CONTEXT;
  if (!fs.existsSync(contexto)) {
    process.stderr.write(`[close-run] nenhum run governado para fechar (${contexto} ausente)\n`);
    return 1;
  }

  const run = JSON.parse(fs.readFileSync(contexto, 'utf8'));
  if (!run.runId) {
    process.stderr.write('[close-run] run-context sem runId — malformado, não fecho às cegas\n');
    return 1;
  }

  const fechado = {
    ...run,
    status,
    closedAt: new Date().toISOString(),
    closedBy: String(by),
    closedReason: String(reason),
    closedEvidence: String(evidence),
  };

  process.stdout.write(
    `[close-run] ${dryRun ? 'DRY-RUN' : 'FECHANDO'} run=${run.runId} status=${status} by=${by}\n`
  );
  if (!dryRun) {
    fs.writeFileSync(contexto, `${JSON.stringify(fechado, null, 2)}\n`, 'utf8');
  }
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, ESTADOS_DE_FECHAMENTO };
