'use strict';

/**
 * GUARDA DE INVARIANTE (não é teste de comportamento).
 *
 * Defeito real (2026-09-14, ciclo `r-agent2-20260914-125012`): a consolidação do
 * release falhou porque `validate:coverage-gate` reprovava com
 * `ragDomainSegregationViolations: actual=6 threshold=0`
 * (`internalTokenMissing=1`, `runtimeChecksFailed=1`, probes `skipped`).
 *
 * Causa: o gate invoca o gerador do relatório RAG num processo FILHO
 * (`execFileSync`) que NÃO herda o `--env-file` do npm script pai. O gerador lê
 * `RAG_INTERNAL_TOKEN` de `process.env`, recebia vazio, pulava os probes
 * autenticados — e o relatório saía FAIL **mesmo com o token presente no `.env`**.
 * Ou seja: o gate agregado dependia de a variável estar exportada no shell de
 * quem o executa, e o ciclo de selagem (que roda em terminal novo) não a tinha.
 *
 * O que esta guarda prova: os dois lados do invariante continuam no lugar —
 *   1. o gerador carrega o `.env` do projeto por conta própria;
 *   2. o gate passa `--env-file-if-exists` ao processo filho.
 * O que ela NÃO prova: que o relatório sai PASS (isso exige o serviço RAG vivo e
 * é exercido por `npm run validate:coverage-gate`).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('invariante: processos filhos dos gates recebem o ambiente do projeto', () => {
  test('o runtime suporta loadEnvFile (base do carregamento do .env)', () => {
    expect(typeof process.loadEnvFile).toBe('function');
  });

  test('o gerador do relatório RAG carrega o .env por conta própria', () => {
    const source = read('scripts/governance/rag-domain-segregation-report.js');
    expect(source).toMatch(/process\.loadEnvFile\(/);
    expect(source).toContain(".env");
  });

  test('o gate de cobertura passa --env-file-if-exists ao processo filho', () => {
    const source = read('scripts/governance/validate-coverage-gate.js');
    expect(source).toMatch(/--env-file-if-exists=/);
    // e o caminho deve ser ABSOLUTO (o filho pode rodar com cwd diferente)
    expect(source).toMatch(/path\.join\(ROOT_DIR, '\.env'\)/);
  });

  test('loadEnvFile não sobrescreve variável já exportada no ambiente', () => {
    // Semântica confirmada no Node 22.12: um token exportado explicitamente
    // continua vencendo o arquivo — o carregamento é complementar, não autoritário.
    const tmp = path.join(os.tmpdir(), 'ragent2-env-guard-test.env');
    const dir = path.dirname(tmp);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, 'GUARD_ENV_PROBE=from_file\n', 'utf8');
    const previous = process.env.GUARD_ENV_PROBE;
    process.env.GUARD_ENV_PROBE = 'from_env';
    try {
      process.loadEnvFile(tmp);
      expect(process.env.GUARD_ENV_PROBE).toBe('from_env');
    } finally {
      if (previous === undefined) delete process.env.GUARD_ENV_PROBE;
      else process.env.GUARD_ENV_PROBE = previous;
      fs.rmSync(tmp, { force: true });
    }
  });
});
