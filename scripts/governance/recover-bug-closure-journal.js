#!/usr/bin/env node
'use strict';

/**
 * recover-bug-closure-journal.js — recuperação canônica do diário de transições.
 *
 * Missão Codex, A4: uma operação de fechamento mexe em três artefatos (livro append-only,
 * prova, fila). Se o processo morre no meio, o diário fica em `INTENT` ou em `ABORTED` com
 * efeito parcial. O livro NÃO é truncado — a reconciliação é explícita e determinística:
 *
 *   EFEITO_COMPLETO → COMMITTED (a operação vale)
 *   SEM_EFEITO      → ABORTED   (nada foi aplicado; o estado governado está intacto)
 *   EFEITO_PARCIAL  → PENDENTE  (exige decisão humana; certificação permanece NEGADA)
 *
 * Uso:
 *   node scripts/governance/recover-bug-closure-journal.js [--json] [--strict]
 *
 * Exit codes: 0 = nada pendente; 1 = há operação pendente (certificação bloqueada);
 *             2 = erro de leitura.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const jornal = require(path.join(ROOT, 'governance', 'bug-closure', 'transition-journal'));

const flag = (nome) => process.argv.includes(nome);

function main() {
  const queuePath = path.join(ROOT, 'AI_MEMORY', 'hardening-queue.json');
  const relatorio = jornal.recuperar(ROOT, { queuePath });
  const saida = {
    kind: 'bug-closure-journal-recovery',
    generatedAt: new Date().toISOString(),
    authoritative: false,
    queuePath: path.relative(ROOT, queuePath),
    ...relatorio,
    veredito: relatorio.pendentes.length === 0 ? 'RECUPERADO' : 'PENDENTE_DE_DECISAO_HUMANA',
    certificacao: relatorio.bloqueiaCertificacao ? 'NEGADA' : 'NAO_BLOQUEADA_POR_RECUPERACAO',
  };

  const destino = path.join(ROOT, 'reports', 'bug-closure-journal-recovery.json');
  try {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, `${JSON.stringify(saida, null, 2)}\n`, 'utf8');
  } catch (_) { /* relatório é conveniência; o veredito vai no stdout */ }

  if (flag('--json')) process.stdout.write(`${JSON.stringify(saida, null, 2)}\n`);
  else {
    process.stdout.write(`[recovery] completados=${saida.completados.length} abortados(sem efeito)=${saida.abortados.length} pendentes=${saida.pendentes.length}\n`);
    process.stdout.write(`[recovery] certificação: ${saida.certificacao}\n`);
    for (const p of saida.pendentes) {
      process.stdout.write(`[recovery]   PENDENTE ${p.defectId} (${p.transitionId}) evento=${p.evento} prova=${p.prova} fila=${p.fila}${p.motivo ? ` motivo=${p.motivo}` : ''}\n`);
    }
  }
  return relatorio.pendentes.length === 0 ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (e) {
  process.stderr.write(`[recovery] ERRO: ${e.message}\n`);
  process.exitCode = 2;
}
