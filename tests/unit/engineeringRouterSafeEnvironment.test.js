'use strict';

/**
 * ERV1-CLOSE-002 — environment seguro + redação de output do Test Runner.
 *
 * Bug real: `runOneCommand` passava `env: { ...process.env }` para todo subprocess de teste —
 * um patch (gerado por um LLM, não confiável) podia rodar um teste que imprime `process.env`
 * inteiro, vazando qualquer segredo real do processo pai (chaves de API, senha de banco, JWT
 * secret) para stdout/stderr — que depois vira evidência persistida em disco, excerpt no banco,
 * e pode voltar como contexto para o próximo CODER/REVIEWER.
 *
 * Este teste roda o pipeline REAL (`runTestCommands`) com fixtures reais em
 * tests/fixtures/engineering-router-sandbox/, injeta segredos falsos no `process.env` do
 * processo de teste (simulando segredos reais do host), e prova por inspeção real de
 * disco/retorno que nenhum deles aparece em nenhum lugar.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runTestCommands, EVIDENCE_ROOT } = require('../../api/services/engineeringRouter/testRunnerService');

const FAKE_SECRETS = {
  OPENAI_API_KEY: 'sk-test-secret-123456789012345678901234567890',
  JWT_SECRET: 'fake-jwt-super-secret',
  DATABASE_PASSWORD: 'fake-db-secret',
  AMI_SECRET: 'fake-ami-secret',
};

function grepRepoForSecret(value) {
  // Procura o valor bruto do segredo em todo o diretório de evidência gerado — a prova real
  // exigida pela missão: "resultado deve ser zero ocorrências fora do fixture autorizado".
  const found = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      const content = fs.readFileSync(abs, 'utf8');
      if (content.includes(value)) found.push(abs);
    }
  }
  walk(EVIDENCE_ROOT);
  return found;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('ERV1-CLOSE-002 — environment seguro + redação de output', () => {
  let workspace;
  const previousEnv = {};

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'erv1-close-002-'));
    // Reproduz o que um workspace real de tentativa (git worktree, patchApplyService) teria:
    // os arquivos de fixture versionados materializados dentro do workspace isolado — sem
    // depender do repo real como cwd, mantendo o teste isolado de verdade.
    const fixtureSrcDir = path.join(REPO_ROOT, 'tests', 'fixtures', 'engineering-router-sandbox');
    const fixtureDestDir = path.join(workspace, 'tests', 'fixtures', 'engineering-router-sandbox');
    fs.mkdirSync(fixtureDestDir, { recursive: true });
    for (const file of fs.readdirSync(fixtureSrcDir)) {
      fs.copyFileSync(path.join(fixtureSrcDir, file), path.join(fixtureDestDir, file));
    }
    for (const [key, value] of Object.entries(FAKE_SECRETS)) {
      previousEnv[key] = process.env[key];
      process.env[key] = value;
    }
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('subprocess não recebe nenhum secret real por default (env sandboxed)', async () => {
    const { results } = await runTestCommands({
      taskId: 'erv1-close-002-env',
      attemptNumber: 1,
      commands: ['node tests/fixtures/engineering-router-sandbox/printEnvProbe.js'],
      cwd: workspace,
    });

    expect(results[0].status).not.toBe('REJECTED');
    expect(results[0].exitCode).toBe(0);
    const combined = `${results[0].stdoutExcerpt}${results[0].stderrExcerpt}`;
    for (const value of Object.values(FAKE_SECRETS)) {
      expect(combined).not.toContain(value);
    }

    // Prova adicional: nenhum arquivo de evidência em disco contém qualquer um dos segredos.
    for (const value of Object.values(FAKE_SECRETS)) {
      expect(grepRepoForSecret(value)).toEqual([]);
    }
  });

  test('output que imprime segredo em formato KEY=VALUE é redigido antes de persistir', async () => {
    const { results } = await runTestCommands({
      taskId: 'erv1-close-002-redact',
      attemptNumber: 1,
      commands: ['node tests/fixtures/engineering-router-sandbox/printHardcodedSecretProbe.js'],
      cwd: workspace,
    });

    const combined = `${results[0].stdoutExcerpt}${results[0].stderrExcerpt}`;
    expect(combined).toContain('[REDACTED:');
    for (const value of Object.values(FAKE_SECRETS)) {
      expect(combined).not.toContain(value);
    }
    // A prova real exigida pela missão: nenhum arquivo de evidência em disco contém o segredo.
    for (const value of Object.values(FAKE_SECRETS)) {
      expect(grepRepoForSecret(value)).toEqual([]);
    }
  });

  test('HOME do subprocess é o workspace isolado, não o HOME real do host', async () => {
    const script = path.join(workspace, 'print-home.js');
    fs.writeFileSync(script, "console.log('HOME=' + process.env.HOME);");
    fs.mkdirSync(path.join(workspace, 'tests', 'fixtures', 'engineering-router-sandbox'), { recursive: true });
    const relScript = 'tests/fixtures/engineering-router-sandbox/print-home-probe.js';
    fs.writeFileSync(path.join(workspace, relScript), "console.log('HOME_SEEN=' + process.env.HOME);");

    const { results } = await runTestCommands({
      taskId: 'erv1-close-002-home',
      attemptNumber: 1,
      commands: [`node ${relScript}`],
      cwd: workspace,
    });

    expect(results[0].stdoutExcerpt).toContain(`HOME_SEEN=${workspace}`);
    expect(results[0].stdoutExcerpt).not.toContain(os.homedir());
  });
});
