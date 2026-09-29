/**
 * migrationsAppliedGate.test.js — o gate de schema é FAIL-CLOSED.
 *
 * DEFEITO REAL (2026-09-28): a lista de canais obrigatórios do pipeline inclui DATABASE e
 * MIGRATIONS, mas o repositório só tinha `npm run db:migrate:status` — que termina em
 * `process.exit(0)` INCONDICIONALMENTE, inclusive com migrations pendentes. Um pipeline apoiado
 * nele declararia "banco ok" sem verificar nada (verde por construção).
 *
 * Aqui o validador é exercitado como SUBPROCESSO (mesmo caminho do pipeline), com o banco
 * inalcançável: ele precisa REPROVAR. Um gate que não consegue falhar não é gate.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');

const SCRIPT = path.join(ROOT, 'scripts', 'governance', 'validate-migrations-applied.js');
const REPORT = path.join(ROOT, 'reports', 'migrations-applied-report.json');

function runWith({ databaseUrl, dbConnectMs = 3000, timeout = 60000 }) {
  return spawnSync(process.execPath, [SCRIPT, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
      // Encurta a política DATABASE_CONNECT (envOverride do registry) para o caso adversarial
      // terminar em segundos: o que se prova aqui é o FAIL-CLOSED, não a espera.
      DB_POOL_ACQUIRE: String(dbConnectMs),
    },
  });
}

function readReport() {
  return JSON.parse(fs.readFileSync(REPORT, 'utf8'));
}

describe('validate:migrations — fail-closed', () => {
  jest.setTimeout(120000);

  test('banco INALCANÇÁVEL ⇒ exit 1 e status FAIL (nunca "não aplicável")', () => {
    const result = runWith({ databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:59999/nao_existe' });
    expect(result.status).toBe(1);
    const report = readReport();
    expect(report.status).toBe('FAIL');
    expect(report.reachable).toBe(false);
    expect(String(report.detail)).toMatch(/DB inacessível/);
  });

  test('DB que não responde ⇒ deadline CLASSIFICADO (não pendura e não vira erro genérico)', () => {
    // 10.255.255.1 é rota não utilizável: a conexão fica pendurada até o deadline da política.
    const result = runWith({
      databaseUrl: 'postgresql://postgres:postgres@10.255.255.1:5432/nao_existe',
      dbConnectMs: 2000,
    });
    expect(result.status).toBe(1);
    const report = readReport();
    expect(report.status).toBe('FAIL');
    expect(String(report.detail)).toMatch(/deadline da política DATABASE_CONNECT/);
  });

  test('o relatório declara o que foi observado (executadas/pendentes), não uma frase solta', () => {
    const report = readReport();
    expect(report.report).toBe('MIGRATIONS_APPLIED');
    expect(Array.isArray(report.pending)).toBe(true);
    expect(typeof report.executed).toBe('number');
  });

  test('o passo existe no pipeline do selo V2 (canais DATABASE/MIGRATIONS)', () => {
    const { STEPS, validateOrder } = require('../../../scripts/governance/engineering-router-v2-seal');
    const step = STEPS.find((entry) => entry.id === 'MIGRATIONS');
    expect(step).toBeDefined();
    expect(step.required).not.toBe(false);
    expect(step.command).toMatch(/validate-migrations-applied\.js/);
    expect(validateOrder(STEPS)).toEqual([]);
  });
});
