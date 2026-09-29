#!/usr/bin/env node
'use strict';

/**
 * validate-migrations-applied.js — GATE fail-closed de SCHEMA (missão 2026-09-28).
 *
 * Por que existe: a lista de canais obrigatórios do pipeline do selo inclui DATABASE e MIGRATIONS.
 * O repositório tinha `npm run db:migrate:status`, mas ele **sempre sai 0** — inclusive com
 * migrations pendentes (o caminho do CLI termina em `process.exit(0)`), portanto não serve como
 * gate: um pipeline que o usasse declararia "banco ok" sem verificar nada.
 *
 * Este validador usa a MESMA autoridade de migrations do runtime (`api/db/migrate`), exige:
 *   1. DB acessível (uma query trivial);
 *   2. ZERO migrations pendentes — o código executando com schema atrasado é falha, não aviso;
 * e grava `reports/migrations-applied-report.json` com o que foi observado (executadas/pendentes),
 * para que o veredito seja auditável e não uma frase.
 *
 * O tempo de conexão é LIMITADO pela política `DATABASE_CONNECT` do registry (`runWithDeadline`):
 * medido em 2026-09-28, com host inalcançável o `db.connect()` do Sequelize fica em retry por mais
 * de 60 s — um gate que pendura não é gate, e a doutrina da arquitetura é justamente limitar a
 * operação concreta (aqui: falhar rápido e classificado).
 *
 * Uso: node --env-file-if-exists=.env scripts/governance/validate-migrations-applied.js [--json]
 * Exit: 0 = schema em dia e DB acessível; 1 = pendência ou DB inacessível.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT, 'reports', 'migrations-applied-report.json');

async function main() {
  const db = require(path.join(ROOT, 'api', 'db'));
  const { getMigrationStatus } = require(path.join(ROOT, 'api', 'db', 'migrate'));
  const { runWithDeadline, isDeadlineError, policyMs } = require(path.join(ROOT, 'api', 'utils', 'operationDeadline'));

  const report = {
    report: 'MIGRATIONS_APPLIED',
    generatedAt: new Date().toISOString(),
    status: 'FAIL',
    reachable: false,
    executed: 0,
    pending: [],
    detail: null,
  };

  try {
    await runWithDeadline('DATABASE_CONNECT', async () => {
      await db.connect();
      // Query trivial: prova ACESSO ao banco, não apenas que o módulo carregou.
      await db.getSequelize().query('SELECT 1');
    }, { operation: 'migrations-connect' });
    report.reachable = true;

    const status = await runWithDeadline('DATABASE_QUERY', () => getMigrationStatus(), { operation: 'migrations-status' });
    report.executed = (status.executed || []).length;
    report.pending = status.pending || [];
    report.status = report.pending.length === 0 ? 'PASS' : 'FAIL';
    report.detail = report.pending.length === 0
      ? `${report.executed} migration(s) aplicadas, nenhuma pendente`
      : `${report.pending.length} migration(s) PENDENTE(S): ${report.pending.slice(0, 5).join(', ')}`;
  } catch (error) {
    // DB inacessível é FAIL (fail-closed), nunca "não aplicável": sem schema não há runtime.
    // Expiração de deadline é classificada (não vira "erro genérico") e o motivo é declarado.
    report.detail = isDeadlineError(error)
      ? `DB inacessível: deadline da política DATABASE_CONNECT (${policyMs('DATABASE_CONNECT')} ms) expirou`
      : `DB inacessível: ${error.message}`;
  } finally {
    try {
      await db.close?.();
    } catch (_) { /* best-effort */ }
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`[migrations] status=${report.status} executadas=${report.executed} pendentes=${report.pending.length} — ${report.detail}\n`);
  }
  process.exit(report.status === 'PASS' ? 0 : 1);
}

main().catch((error) => {
  console.error(`[migrations] falhou: ${error.message}`);
  process.exit(1);
});
