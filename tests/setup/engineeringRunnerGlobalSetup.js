'use strict';

/**
 * ER-V1-SEAL-003 (Dedicated Execution Runner) — globalSetup do Jest.
 *
 * Sobe o Engineering Runner REAL (services/engineering-runner/src/index.js) como processo
 * SEPARADO antes de toda a suíte de testes — a mesma separação de processo que existe em
 * produção (API principal nunca chama `executionSandbox.js` diretamente; fala com o runner via
 * HTTP). `ENGINEERING_RUNNER_URL`/`ENGINEERING_RUNNER_TOKEN` setados aqui em `process.env` são
 * herdados pelos workers do Jest (mesmo processo principal do Jest CLI que spawna os workers).
 *
 * PID do processo do runner é persistido em disco (o globalSetup roda e termina antes da suíte
 * — não sobrevive para o globalTeardown localizar o processo por referência em memória).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * REGIME ÚNICO DE AMBIENTE — o `.env` é carregado UMA vez aqui, antes de o runner subir e antes
 * de os workers do Jest serem criados (eles herdam este `process.env`).
 *
 * DEFEITO REAL, medido em 2026-10-02: `npm run test:unit` falhava 3/3 em
 * `tests/unit/engineeringRouterSafeEnvironment.test.js` com `exitCode: null` e excerpts
 * `undefined`, enquanto a MESMA suíte passava no runner autoritativo. A causa não era a suíte: o
 * contrato do Engineering Runner exige que o cwd da execução esteja sob
 * `ENGINEERING_ROUTER_WORKSPACE_ROOT`, chave que vive no `.env`. Sem `.env` carregado o teste
 * cria o workspace no TMPDIR do host, o runner recusa com `cwd_not_allowed` e o veredito passa a
 * depender de QUEM INVOCA — medido: sem a chave 0/3, com a chave 3/3.
 *
 * O mesmo defeito já tinha sido diagnosticado (e corrigido) em
 * `scripts/governance/lib/loadEnvFile.js` — mas apenas nos COLETORES de governança. A origem do
 * regime é a sessão de teste: corrigir aqui faz `npm run test:unit`, `npx jest`, o runner do
 * manifesto e o selo verem o MESMO ambiente, em vez de cada invocador produzir um veredito
 * próprio. O ambiente já presente VENCE (o operador pode sobrescrever sem editar o arquivo).
 */
const { loadEnvFile } = require(path.join(ROOT, 'scripts', 'governance', 'lib', 'loadEnvFile'));
const envLoad = loadEnvFile(ROOT);
process.stdout.write(`[jest-global-setup] .env ${envLoad.loaded ? `carregado (${envLoad.keys} chave(s) aplicada(s); ambiente explícito vence)` : `não aplicado: ${envLoad.reason}`}\n`);

const PID_FILE = path.join(ROOT, '.jest-engineering-runner.pid');
const RUNNER_PORT = Number(process.env.ENGINEERING_RUNNER_TEST_PORT || 8097);
const RUNNER_TOKEN = 'jest-test-engineering-runner-token';
const READY_TIMEOUT_MS = 15000;

function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) { resolve(); return; }
        retry();
      });
      req.on('error', retry);
    };
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Engineering Runner não respondeu /health dentro de ${timeoutMs}ms`));
        return;
      }
      setTimeout(attempt, 200);
    };
    attempt();
  });
}

/**
 * Achado real (ER-V1-SEAL-004, ao rodar o pilot real do Router: um `testCommand` da task é, ele
 * mesmo, um `npx jest --testPathPattern=...` — ex.: `RegressionPlan`/promoção rodando o teste do
 * fixture `mathUtils.test.js`). Esse `npx jest` ANINHADO roda DENTRO do workspace isolado
 * materializado por `git worktree add --detach` (ver `patchApplyService.js::materializeWorktree`)
 * e, sem `--config` explícito no `testCommand`, resolve o MESMO `jest.config.cjs` do repositório
 * (copiado para dentro do worktree) — que também aponta para este `globalSetup`. Isso tentava
 * subir um SEGUNDO Engineering Runner recursivamente a partir de dentro do sandbox, e crashava
 * com `EACCES` ao escrever `.jest-engineering-runner.pid` (o worktree/sandbox não tem essa
 * permissão), derrubando o `npx jest` aninhado inteiro ANTES de rodar qualquer teste — o que por
 * sua vez derrubava a task inteira do Router (RED->FIX repetido, nunca chegando a GREEN).
 *
 * Um worktree vinculado (`git worktree add`, nunca o repositório principal) sempre tem `.git`
 * como ARQUIVO (contém `gitdir: ...`), nunca como diretório — sinal confiável e já nativo do
 * git para detectar "estou rodando dentro de um workspace isolado do Engineering Router" sem
 * precisar de nenhuma env var nova. Nesse caso, pula o spawn: o `npx jest` aninhado não executa
 * nenhum código do próprio Router (é só o teste do fixture sendo validado), então nunca precisa
 * do Engineering Runner — e, se algum dia precisar, o fail-closed pré-existente
 * (`SANDBOX_UNAVAILABLE`, sem `ENGINEERING_RUNNER_URL`) já cobre isso corretamente.
 */
function isInsideLinkedGitWorktree() {
  try {
    return fs.statSync(path.join(ROOT, '.git')).isFile();
  } catch (_) {
    return false;
  }
}

module.exports = async function engineeringRunnerGlobalSetup() {
  if (isInsideLinkedGitWorktree()) {
    process.stderr.write('[jest-global-setup] rodando dentro de um git worktree isolado (workspace do Engineering Router) — pulando spawn do Engineering Runner (aninhamento não suportado/não necessário aqui).\n');
    return;
  }

  const child = spawn(process.execPath, [path.join(ROOT, 'services', 'engineering-runner', 'src', 'index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      ENGINEERING_RUNNER_TOKEN: RUNNER_TOKEN,
      ENGINEERING_RUNNER_PORT: String(RUNNER_PORT),
    },
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: false,
  });

  fs.writeFileSync(PID_FILE, String(child.pid));

  await waitForHealth(`http://127.0.0.1:${RUNNER_PORT}/health`, READY_TIMEOUT_MS);

  process.env.ENGINEERING_RUNNER_URL = `http://127.0.0.1:${RUNNER_PORT}`;
  process.env.ENGINEERING_RUNNER_TOKEN = RUNNER_TOKEN;

  // stderr, nunca stdout: globalSetup roda no MESMO processo CLI que produz a saída de
  // `--json`/`--silent` do Jest (usada por scripts/governance/collect-engineering-router-runtime-evidence.js
  // para parsear resultados estruturados) — qualquer console.log aqui contamina esse stdout e
  // quebra o JSON.parse do coletor (achado real: os 25 itens de runtime evidence quebravam com
  // "saída do Jest não pôde ser parseada como JSON" até esta correção).
  process.stderr.write(`[jest-global-setup] Engineering Runner real (pid ${child.pid}) pronto em http://127.0.0.1:${RUNNER_PORT}\n`);
};

module.exports.PID_FILE = PID_FILE;
module.exports.RUNNER_PORT = RUNNER_PORT;
module.exports.RUNNER_TOKEN = RUNNER_TOKEN;
