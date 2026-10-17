#!/usr/bin/env node
'use strict';

/**
 * DEMONSTRAÇÃO A–D do mecanismo BUG CLOSURE FIRST (missão 2026-10-17 §16).
 *
 * Roda os quatro cenários exigidos contra o motor REAL e imprime o resultado
 * medido. Nada aqui é narrativa: cada linha é o retorno de
 * `evaluateExecutionEligibility` / `evaluateExecutionEligibility`.
 *
 * Uso: node tools/audit/demo-bug-closure.js
 */

const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { evaluateExecutionEligibility, OPERACOES } = require(path.join(ROOT, 'governance', 'bug-closure', 'eligibility'));
const { carregarInventario } = require(path.join(ROOT, 'governance', 'bug-closure', 'defect-registry'));
const { ESTADOS } = require(path.join(ROOT, 'governance', 'bug-closure', 'defect-states'));
const { headSha } = require(path.join(ROOT, 'governance', 'bug-closure', 'require-eligibility'));

const COMMIT = 'a'.repeat(40);
const base = (defeitos, extra = {}) => ({
  commit: COMMIT,
  actor: { id: 'demo-bug-closure' },
  defects: defeitos,
  ...extra,
});

function linha(rotulo, op, decisao) {
  const motivos = decisao.reasonCodes.filter((c) => c !== 'BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO');
  process.stdout.write(
    `${rotulo.padEnd(58)} | ${String(op).padEnd(24)} | ${decisao.decision.padEnd(22)} | ${motivos.join(', ') || '—'}\n`
  );
}

process.stdout.write('=== DEMONSTRAÇÃO A–D — BUG CLOSURE FIRST ===\n');
process.stdout.write(`${'cenário'.padEnd(58)} | ${'operação'.padEnd(24)} | ${'decisão'.padEnd(22)} | motivos\n`);
process.stdout.write(`${'-'.repeat(58)}-+-${'-'.repeat(24)}-+-${'-'.repeat(22)}-+--------\n`);

// ── A: P0 aberto e reproduceível ⇒ QA Wave completa RECUSADA ────────────────
const p0Aberto = [{ id: 'P0-A', title: 'P0 reproduceível', severity: 'P0', state: ESTADOS.REPRODUCED }];
linha('A) P0 aberto (reproduced)', OPERACOES.QA_WAVES_COMPLETA, evaluateExecutionEligibility(base(p0Aberto), OPERACOES.QA_WAVES_COMPLETA));

// ── B: P0 corrigido, regressão ainda NÃO validada ⇒ fase seguinte RECUSADA ──
const p0CorrigidoSemTeste = [{ id: 'P0-A', severity: 'P0', state: ESTADOS.FIXED_PENDING_VERIFICATION }];
linha(
  'B) P0 corrigido, regressão não validada',
  OPERACOES.L0_COMPLETO,
  evaluateExecutionEligibility(base(p0CorrigidoSemTeste, { activeDefectIds: ['P0-A'] }), OPERACOES.L0_COMPLETO)
);

// ── B (contraprova): correção do próprio defeito continua liberada ─────────
linha('B contrap.) correção de código com P0 aberto', OPERACOES.CORRECAO_CODIGO, evaluateExecutionEligibility(base(p0Aberto), OPERACOES.CORRECAO_CODIGO));

// ── C: P0 resolvido + teste direcionado aprovado ⇒ fase seguinte AUTORIZADA
const p0Resolvido = [{ id: 'P0-A', severity: 'P0', state: ESTADOS.RESOLVED, targetedTestPassing: true }];
linha(
  'C) P0 resolvido + teste direcionado aprovado',
  OPERACOES.L0_COMPLETO,
  evaluateExecutionEligibility(base(p0Resolvido, { activeDefectIds: ['P0-A'] }), OPERACOES.L0_COMPLETO)
);

// ── D: regressão reabre o P0 ⇒ certificação IMEDIATAMENTE bloqueada ────────
const p0Reaberto = [{ id: 'P0-A', severity: 'P0', state: ESTADOS.OPEN }];
linha('D) regressão reabriu o P0', OPERACOES.SELO_FINAL, evaluateExecutionEligibility(base(p0Reaberto), OPERACOES.SELO_FINAL));

// ── Estado REAL da fila (não sintético) ───────────────────────────────────
const inv = carregarInventario();
process.stdout.write('\n=== ESTADO REAL DA FILA OFICIAL (AI_MEMORY/hardening-queue.json) ===\n');
process.stdout.write(`total=${inv.resumo.total} abertos=${inv.resumo.abertos} bloqueantes=${inv.resumo.bloqueantesParaCertificacao} semSeveridade=${inv.resumo.semSeveridadeAbertos}\n`);
const real = evaluateExecutionEligibility(
  { commit: headSha(), actor: { id: 'demo-bug-closure' }, defects: inv.defeitos },
  OPERACOES.SELO_FINAL
);
process.stdout.write(`SELO_FINAL com a fila real: ${real.decision} — ${real.reasonCodes.join(', ')}\n`);
process.stdout.write(`defeitos nomeados: ${real.blockingFindings.slice(0, 8).map((f) => `${f.severity}:${f.defectId}`).join(' ')}\n`);
