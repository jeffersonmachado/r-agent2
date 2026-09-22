'use strict';

/**
 * ER-V1-FINAL-001 — Execution Sandbox.
 *
 * RED reproduzido (ver ENGINEERING_ROUTER_V1_FINAL_CLOSURE.md): antes desta correção,
 * `testRunnerService.runOneCommand` executava testCommands via `child_process.spawn` puro do
 * host — isolamento só em nível de aplicação, zero em nível de SO/kernel. Reprodução real (fora
 * deste teste, documentada no relatório de closure) confirmou que um `testCommand` malicioso
 * (`node scripts/**|tests/**`, permitido pela allowlist estrutural) conseguia: ler /etc/passwd
 * do HOST, abrir conexão TCP para rede externa, acessar o socket do Docker do host, escrever
 * arquivo fora do workspace, corromper fisicamente o `node_modules` real do repositório (via o
 * symlink gravável que existia em patchApplyService.materializeWorktree) e spawnar processos
 * filho sem qualquer limite de PIDs.
 *
 * Este teste roda o pipeline REAL (`runTestCommands`) com as MESMAS fixtures maliciosas usadas
 * na reprodução, através do sandbox Docker real (executionSandbox.js) — non-root, sem rede,
 * sem docker socket, filesystem raiz read-only, node_modules bind read-only, limites de
 * CPU/memória/PIDs — e prova por execução real (não mock) que cada vetor está bloqueado.
 *
 * Requer Docker disponível (mesmo daemon usado pelo resto do repositório para
 * docker-compose*.yml) — se indisponível, os testes falham explicitamente (skip não é usado:
 * um ambiente sem Docker não pode alegar SANDBOX_RUNTIME=PASS).
 */

const fs = require('fs');
const path = require('path');
const { runTestCommands } = require('../../api/services/engineeringRouter/testRunnerService');
const { isSandboxAvailable } = require('../../api/services/engineeringRouter/executionSandbox');
const { createWorkspace, destroyWorkspace } = require('../../api/services/engineeringRouter/patchApplyService');

// Cada teste envolve `docker run` real (overhead de alguns segundos) + git worktree real;
// sob a suíte completa (paralelismo pesado, múltiplos workers Jest competindo por Docker/CPU)
// o default de 10s do projeto (jest.config.cjs) estourou de verdade em execução real.
jest.setTimeout(30000);

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUTSIDE_MARKER = '/tmp/er-v1-final-001-escape-probe-marker.txt';
const NODE_MODULES_MARKER = path.join(REPO_ROOT, 'node_modules', '.er-v1-final-001-marker');

/**
 * Workspace REAL — mesmo `createWorkspace` de produção (patchApplyService.js): snapshot
 * commit do estado ATUAL do repositório (staged+unstaged+untracked, inclui os fixtures deste
 * blocker mesmo antes de qualquer commit) materializado como git worktree real, fiel ao
 * comportamento de uma EngineeringTask de verdade — jest.config.cjs, .git apontando pro
 * repositório principal, tudo presente, exercitando exatamente o que o sandbox precisa suportar.
 */
let workspaceCounter = 0;
async function buildWorkspace() {
  workspaceCounter += 1;
  return createWorkspace(`er-v1-final-001-sandbox`, workspaceCounter);
}

describe('ER-V1-FINAL-001 — Execution Sandbox', () => {
  if (!isSandboxAvailable()) {
    test('Docker indisponível — sandbox não pode ser certificado neste ambiente', () => {
      throw new Error('SANDBOX_UNAVAILABLE: Docker daemon inacessível neste ambiente de teste — ER-V1-FINAL-001 exige runtime real, não pode ser certificado sem ele.');
    });
    return;
  }

  let workspace;

  beforeEach(async () => {
    workspace = await buildWorkspace();
    fs.rmSync(OUTSIDE_MARKER, { force: true });
    fs.rmSync(NODE_MODULES_MARKER, { force: true });
  }, 30000);

  afterEach(async () => {
    await destroyWorkspace(workspace);
    fs.rmSync(OUTSIDE_MARKER, { force: true });
    fs.rmSync(NODE_MODULES_MARKER, { force: true });
  }, 30000);

  test('não acessa rede externa (--network none)', async () => {
    const { results } = await runTestCommands({
      taskId: 'er-v1-final-001-network',
      attemptNumber: 1,
      commands: ['node tests/fixtures/engineering-router-sandbox/networkAccessProbe.js'],
      cwd: workspace,
    });
    expect(results[0].exitCode).toBe(0);
    expect(results[0].stdoutExcerpt).toContain('NETWORK_ACCESS_BLOCKED');
    expect(results[0].stdoutExcerpt).not.toContain('NETWORK_ACCESS_OK');
  });

  test('não acessa o socket do Docker do host', async () => {
    const { results } = await runTestCommands({
      taskId: 'er-v1-final-001-docker-socket',
      attemptNumber: 1,
      commands: ['node tests/fixtures/engineering-router-sandbox/dockerSocketProbe.js'],
      cwd: workspace,
    });
    expect(results[0].exitCode).toBe(0);
    expect(results[0].stdoutExcerpt).toContain('DOCKER_SOCKET_ACCESS_BLOCKED');
    expect(results[0].stdoutExcerpt).not.toContain('DOCKER_SOCKET_ACCESS_OK');
  });

  test('não escreve fora do workspace (filesystem raiz read-only)', async () => {
    const { results } = await runTestCommands({
      taskId: 'er-v1-final-001-write-outside',
      attemptNumber: 1,
      commands: ['node tests/fixtures/engineering-router-sandbox/writeOutsideWorkspaceProbe.js'],
      cwd: workspace,
    });
    expect(results[0].exitCode).toBe(0);
    expect(results[0].stdoutExcerpt).toContain('WRITE_OUTSIDE_WORKSPACE_BLOCKED');
    expect(fs.existsSync(OUTSIDE_MARKER)).toBe(false);
  });

  test('não corrompe o node_modules real do repositório (bind read-only)', async () => {
    const { results } = await runTestCommands({
      taskId: 'er-v1-final-001-write-node-modules',
      attemptNumber: 1,
      commands: ['node tests/fixtures/engineering-router-sandbox/writeNodeModulesProbe.js'],
      cwd: workspace,
    });
    expect(results[0].exitCode).toBe(0);
    expect(results[0].stdoutExcerpt).toContain('WRITE_NODE_MODULES_BLOCKED');
    expect(fs.existsSync(NODE_MODULES_MARKER)).toBe(false);
  });

  test('limite de PIDs bloqueia excesso de processos filho concorrentes', async () => {
    const { results } = await runTestCommands({
      taskId: 'er-v1-final-001-fork-limit',
      attemptNumber: 1,
      commands: ['node tests/fixtures/engineering-router-sandbox/forkBombProbe.js'],
      cwd: workspace,
    });
    // O probe tenta 200 processos filho concorrentes; --pids-limit=64 do sandbox faz o kernel
    // recusar fork() (EAGAIN) muito antes de 200 — o probe morre com exceção não tratada
    // (exitCode != 0), que É a prova de que o limite bloqueou.
    expect(results[0].exitCode).not.toBe(0);
    expect(`${results[0].stdoutExcerpt}${results[0].stderrExcerpt}`).not.toContain('FORK_ATTEMPTS_SPAWNED:200/200');
  });

  test('/etc/passwd lido é o do container, nunca o do host', async () => {
    const hostPasswdContent = fs.readFileSync('/etc/passwd', 'utf8');
    const { results } = await runTestCommands({
      taskId: 'er-v1-final-001-etc-passwd',
      attemptNumber: 1,
      commands: ['node tests/fixtures/engineering-router-sandbox/readEtcPasswdProbe.js'],
      cwd: workspace,
    });
    expect(results[0].exitCode).toBe(0);
    // O container tem seu PRÓPRIO /etc/passwd (Debian slim mínimo) — não é uma vulnerabilidade
    // ler o arquivo do CONTAINER; a prova real é que o conteúdo tem um tamanho muito menor que
    // o /etc/passwd real do host (que tem todos os usuários do sistema real).
    const match = results[0].stdoutExcerpt.match(/ETC_PASSWD_READ_OK:(\d+)/);
    expect(match).not.toBeNull();
    const readLength = Number(match[1]);
    expect(readLength).toBeLessThan(hostPasswdContent.length);
  });

  test('caso positivo: script legítimo sob tests/ roda normalmente dentro do sandbox', async () => {
    const { results } = await runTestCommands({
      taskId: 'er-v1-final-001-positive-node',
      attemptNumber: 1,
      commands: ['node tests/fixtures/engineering-router-sandbox/printEnvProbe.js'],
      cwd: workspace,
    });
    expect(results[0].status).toBe('PASS');
    expect(results[0].exitCode).toBe(0);
  });

  test('caso positivo: git status roda normalmente dentro do worktree real via sandbox', async () => {
    const { results } = await runTestCommands({
      taskId: 'er-v1-final-001-positive-git',
      attemptNumber: 1,
      commands: ['git status'],
      cwd: workspace,
    });
    expect(results[0].status).toBe('PASS');
    expect(results[0].exitCode).toBe(0);
    // Prova de que ensureWorkspaceReadableBySandbox (chmod go+rX) não introduz mudanças falsas
    // de modo detectadas pelo git — o worktree é checkout exato do snapshot commit, deve estar
    // limpo (working tree igual ao commit).
    expect(results[0].stdoutExcerpt).toContain('nothing to commit');
  });

  test('recusa explicitamente rodar com cwd = repositório principal (nunca chmod/mount sobre o código real)', async () => {
    // Achado real durante a implementação: um cwd == ROOT fazia ensureWorkspaceReadableBySandbox
    // tentar `chmod -R` recursivo sobre TODO o código-fonte do projeto (inclusive
    // frontend/node_modules) antes de sequer montar o container. Prova de que isso nunca mais
    // acontece: o comando é rejeitado ANTES de qualquer chmod/docker run.
    const { results } = await runTestCommands({
      taskId: 'er-v1-final-001-reject-root-cwd',
      attemptNumber: 1,
      commands: ['node tests/fixtures/engineering-router-sandbox/printEnvProbe.js'],
      cwd: REPO_ROOT,
    });
    expect(results[0].status).toBe('SANDBOX_INVALID_WORKSPACE');
    expect(results[0].exitCode).toBeNull();
  });

  test('caso positivo: npx jest (suíte real do projeto) executa e reporta PASS', async () => {
    // tests/fixtures/engineering-router-sandbox/ está em testPathIgnorePatterns do
    // jest.config.cjs real do projeto (são fixtures de segurança, não testes) — usa um teste
    // unitário real e pequeno para provar que o sandbox roda jest de ponta a ponta.
    const { results, allPass } = await runTestCommands({
      taskId: 'er-v1-final-001-positive-npm-test',
      attemptNumber: 1,
      commands: ['npx jest tests/unit/processComplexity.test.js'],
      cwd: workspace,
    });
    expect(results[0].status).toBe('PASS');
    expect(allPass).toBe(true);
  }, 30000);
});
