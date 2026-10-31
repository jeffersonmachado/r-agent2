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
 *   node scripts/governance/recover-bug-closure-journal.js --reparar [--forcar] [--json]
 *   node scripts/governance/recover-bug-closure-journal.js --quebrar-lock --confirmar [--json]
 *
 * `--reparar` é o reparo CANÔNICO de um diário com cadeia quebrada: mantém o maior prefixo
 * válido e descarta a cauda, nunca truncando o livro. Recusa-se a descartar registro cujo
 * `transitionId` já tem evento no livro (evidência de efeito aplicado) sem `--forcar`.
 *
 * `--quebrar-lock --confirmar` quebra um lock ÓRFÃO (processo dono morto). O caminho automático
 * de remoção foi removido (TOCTOU do Alert 1 da 6ª passada); a quebra é sempre explícita.
 *
 * Exit codes: 0 = nada pendente; 1 = há operação pendente (certificação bloqueada);
 *             2 = erro de leitura; 3 = reparo recusado; 4 = quebra de lock recusada.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const jornal = require(path.join(ROOT, 'governance', 'bug-closure', 'transition-journal'));

const flag = (nome) => process.argv.includes(nome);

/**
 * Diagnóstico do livro (contagem de eventos) para a SAÍDA do CLI. Não é usado como snapshot do
 * guardião de evidência: quem decide o descarte é `repararDiario`, que lê o livro do próprio
 * root DENTRO do lock (alert 1 da 7ª passada).
 */
function eventosDoLivro() {
  try {
    const ledger = require(path.join(ROOT, 'governance', 'bug-closure', 'transition-ledger'));
    const lido = ledger.verificarLivro(ROOT);
    const eventos = Array.isArray(lido.eventos) ? lido.eventos : [];
    // Mesma régua do guardião (`lerLivro`): livro vazio NÃO é verificável.
    return { eventos, verificavel: lido.existe !== false && lido.integridadeOk !== false && eventos.length > 0 };
  } catch (_) {
    return { eventos: [], verificavel: false };
  }
}

function quebrar() {
  const resultado = jornal.quebrarLock(ROOT, { confirmar: flag('--confirmar') });
  if (flag('--json')) process.stdout.write(`${JSON.stringify({ kind: 'bug-closure-journal-lock-break', ...resultado }, null, 2)}\n`);
  else if (resultado.ok) process.stdout.write(`[lock] ${resultado.nadaAQuebrar ? 'nenhum lock presente' : `lock removido (dono pid=${resultado.donoPid ?? 'desconhecido'})`}\n`);
  else process.stdout.write(`[lock] RECUSADO: ${resultado.erro}${resultado.donoPid ? ` (dono pid=${resultado.donoPid})` : ''}\n`);
  return resultado.ok ? 0 : 4;
}

function reparar() {
  // O guardião de evidência lê o livro DENTRO do lock, do mesmo root (alert 1 da 7ª passada):
  // nada de snapshot antecipado aqui.
  const resultado = jornal.repararDiario(ROOT, { forcar: flag('--forcar') });
  const livro = eventosDoLivro();
  const saida = {
    kind: 'bug-closure-journal-repair',
    generatedAt: new Date().toISOString(),
    authoritative: false,
    livroDiagnostico: { eventos: livro.eventos.length, verificavel: livro.verificavel },
    ...resultado,
  };
  if (flag('--json')) process.stdout.write(`${JSON.stringify(saida, null, 2)}\n`);
  else if (!resultado.ok) {
    process.stdout.write(`[reparo] RECUSADO: ${resultado.erro}\n`);
    for (const d of resultado.descartados || []) {
      process.stdout.write(`[reparo]   descartaria ${d.transitionId || '(ilegivel)'} status=${d.status || '?'}\n`);
    }
  } else if (resultado.nadaDescartado) {
    process.stdout.write(`[reparo] cadeia íntegra: nada a reparar (${resultado.mantidos} registro(s)) | livro: ${saida.livroDiagnostico.eventos} evento(s)${saida.livroDiagnostico.verificavel ? '' : ' (NÃO verificável)'}\n`);
  } else {
    process.stdout.write(`[reparo] mantidos=${resultado.mantidos} descartados=${resultado.descartados.length} motivo=${resultado.motivo}\n`);
    if (resultado.forcado) {
      process.stdout.write(`[reparo] FORÇADO (--forcar): guardião contornado | livroVerificavel=${resultado.livroVerificavel} perdeEvidencia=${resultado.perdeEvidencia}\n`);
    }
  }
  if (!resultado.ok) return 3;
  return 0;
}

function main() {
  if (flag('--quebrar-lock')) return quebrar();
  if (flag('--reparar')) return reparar();
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
