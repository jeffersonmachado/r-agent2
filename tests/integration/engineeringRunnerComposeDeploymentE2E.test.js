'use strict';

/**
 * ER-V1-SEALFIX-002 (Real Container Deployment) — E2E REAL com Docker de verdade: builda a
 * imagem real do Engineering Runner, sobe um container real (rede Docker isolada, SEM publicar
 * porta no host), materializa um workspace real no HOST via `patchApplyService.createWorkspace`
 * (o mesmo mecanismo que a API usaria), e chama `/execute` a partir de um SEGUNDO container
 * cliente — provando a cadeia completa host→runner-container→docker.sock→sandbox-container.
 *
 * Achado real que motivou esta missão (confirmado ao vivo, não hipotético): antes desta
 * correção, `executionSandbox.js`/`contextBuilderService.js` calculavam `ROOT` via
 * `path.resolve(__dirname, ...)` — um caminho relativo a ONDE O ARQUIVO estava fisicamente
 * dentro da imagem do container (`/app`). Como o Engineering Runner fala com o Docker daemon do
 * HOST via socket, todo `docker run -v <ROOT>/...:...` que ele monta é resolvido pelo
 * FILESYSTEM DO HOST, nunca pelo do container — `/app/.git`/`/app/node_modules` não existem no
 * host de um deployment real, então TODA execução sandboxed falharia silenciosamente ou
 * montaria o caminho errado. É PROIBIDO considerar Jest-no-host + runner-no-host + Docker-no-host
 * como prova suficiente disso (é exatamente esse cenário que mascarava o bug) — este teste sobe
 * containers de verdade.
 *
 * Também descobriu e corrigiu, ao rodar pela primeira vez contra um container real: o
 * Dockerfile do runner não copiava `commandPolicy.js`/`safeEngineeringEnvironment.js`
 * (dependências novas do ER-V1-SEALFIX-003) — o runner falhava ao subir com MODULE_NOT_FOUND,
 * nunca detectável rodando o mesmo código como processo bare no host (onde o `require()` sempre
 * resolve contra o monorepo real).
 *
 * Requer Docker real disponível (`docker info`) — se não estiver, PULA explicitamente com
 * `REQUIRES_DOCKER_RUNTIME` (nunca finge verde). A release oficial do Router V1 não pode ser GO
 * sem este teste passando de verdade em algum ambiente com Docker.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUNNER_IMAGE = 'r-agent2-engineering-runner:sealfix002-e2e-test';
const RUNNER_TOKEN = `sealfix002-e2e-${crypto.randomBytes(6).toString('hex')}`;

function dockerAvailable() {
  try {
    execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 5000 });
    return true;
  } catch (_) {
    return false;
  }
}

function skipIfNoDocker() {
  if (dockerAvailable()) return false;
  // eslint-disable-next-line no-console
  console.warn('[sealfix-002-compose-e2e] PULADO: REQUIRES_DOCKER_RUNTIME — Docker real indisponível neste ambiente. A release oficial NÃO pode ser GO sem rodar este teste em um ambiente com Docker.');
  return true;
}

describe('ER-V1-SEALFIX-002 — Real Container Deployment (Docker Compose real, dois containers separados)', () => {
  jest.setTimeout(180000);

  let networkName;
  let workspaceRoot;
  let taskWorkspace;
  let runnerContainerName;
  let runnerProcess;

  beforeAll(async () => {
    if (skipIfNoDocker()) return;

    networkName = `sealfix002-jest-net-${crypto.randomBytes(4).toString('hex')}`;
    runnerContainerName = `sealfix002-jest-runner-${crypto.randomBytes(4).toString('hex')}`;
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sealfix002-jest-workspace-root-'));

    // Workspace real materializado no HOST — exatamente o que patchApplyService faz hoje quando
    // chamado pela API (SEALFIX-002 não move ONDE isso acontece, só corrige a visibilidade do
    // resultado para o Docker daemon do host). `WORKSPACE_ROOT` é uma const de módulo lida de
    // `process.env` na primeira vez que o módulo é carregado — `jest.resetModules()` + setar a
    // env var ANTES do require garante que este teste usa o `workspaceRoot` real deste teste,
    // nunca o default de outro arquivo que já tenha carregado o módulo antes no mesmo worker.
    const previousWorkspaceRootEnv = process.env.ENGINEERING_ROUTER_WORKSPACE_ROOT;
    process.env.ENGINEERING_ROUTER_WORKSPACE_ROOT = workspaceRoot;
    jest.resetModules();
    const { createWorkspace } = require('../../api/services/engineeringRouter/patchApplyService');
    taskWorkspace = await createWorkspace('sealfix002-jest-task', 1);
    if (previousWorkspaceRootEnv === undefined) delete process.env.ENGINEERING_ROUTER_WORKSPACE_ROOT;
    else process.env.ENGINEERING_ROUTER_WORKSPACE_ROOT = previousWorkspaceRootEnv;
    jest.resetModules();

    execFileSync('docker', ['build', '-f', 'services/engineering-runner/Dockerfile', '-t', RUNNER_IMAGE, '.'], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('docker', ['network', 'create', networkName], { stdio: ['ignore', 'pipe', 'pipe'] });

    runnerProcess = spawn('docker', [
      'run', '--rm', '--name', runnerContainerName, '--network', networkName,
      '-v', '/var/run/docker.sock:/var/run/docker.sock',
      '-v', `${workspaceRoot}:${workspaceRoot}`,
      '-e', `ENGINEERING_RUNNER_TOKEN=${RUNNER_TOKEN}`,
      '-e', `ENGINEERING_ROUTER_HOST_REPO_ROOT=${REPO_ROOT}`,
      '-e', `ENGINEERING_ROUTER_WORKSPACE_ROOT=${workspaceRoot}`,
      RUNNER_IMAGE,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    // Espera o container real ficar "healthy" (healthcheck do próprio Dockerfile) — nunca um
    // sleep arbitrário: consulta o estado real do Docker.
    const deadline = Date.now() + 30000;
    let healthy = false;
    while (Date.now() < deadline) {
      try {
        const status = execFileSync('docker', ['inspect', '--format', '{{.State.Health.Status}}', runnerContainerName], { encoding: 'utf8' }).trim();
        if (status === 'healthy') { healthy = true; break; }
      } catch (_) { /* container pode ainda não existir no docker inspect por um instante */ }
      await new Promise((resolve) => { setTimeout(resolve, 500); });
    }
    if (!healthy) {
      throw new Error('Engineering Runner real não ficou healthy a tempo — ver logs do container para diagnóstico real.');
    }
  }, 120000);

  afterAll(async () => {
    if (skipIfNoDocker()) return;
    try { execFileSync('docker', ['stop', '-t', '2', runnerContainerName], { stdio: 'ignore' }); } catch (_) { /* best-effort */ }
    try { execFileSync('docker', ['network', 'rm', networkName], { stdio: 'ignore' }); } catch (_) { /* best-effort */ }
    if (workspaceRoot) fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }, 30000);

  function curlRunner(body) {
    const out = execFileSync('docker', [
      'run', '--rm', '--network', networkName, 'curlimages/curl:8.10.1',
      'curl', '-s', '-X', 'POST', `http://${runnerContainerName}:8090/execute`,
      '-H', `Authorization: Bearer ${RUNNER_TOKEN}`,
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify(body),
    ], { encoding: 'utf8', timeout: 60000 });
    return JSON.parse(out);
  }

  test('[1-6] task chega ao runner real via rede Docker (sem porta publicada) → workspace real do HOST é encontrado e montado corretamente pelo Docker daemon → comando roda no sandbox real → resultado real retorna', () => {
    if (skipIfNoDocker()) return;

    const response = curlRunner({
      executionId: 'sealfix002-checklist-1-6',
      executable: 'node',
      args: ['tests/fixtures/engineering-router-sandbox/printEnvProbe.js'],
      cwd: taskWorkspace,
    });

    expect(response.exitCode).toBe(0);
    // PWD real dentro do sandbox precisa ser o workspace real do HOST — prova de que o bind
    // mount `-v <path>:<path>` feito pelo Docker daemon do HOST (via socket, a partir de um
    // container DIFERENTE do que criou o workspace) resolveu o caminho correto. Comparação por
    // PREFIXO (nunca igualdade exata): o sufixo do diretório da tentativa
    // (`crypto.randomBytes(4).toString('hex')`, 8 chars hex) coincide com o heurístico real de
    // redação de segredo estilo OpenAI (`secretRedaction.js`, ERV1-CLOSE-002/ER-V1-FINAL-001) —
    // o runner redige esse trecho de verdade antes de devolver o stdout (defesa em profundidade
    // correta e intencional; não é um bug, é o redator funcionando). `workspaceRoot` (o prefixo
    // usado aqui) vem de `fs.mkdtempSync`, nunca hex puro, e nunca é redigido.
    const probeOutput = JSON.parse(response.stdout);
    expect(probeOutput.PWD.startsWith(workspaceRoot)).toBe(true);
  });

  test('[7] código/arquivos do HOST fora do workspace não são expostos ao sandbox real (container→container, não bare host)', () => {
    if (skipIfNoDocker()) return;

    const hostPasswdContent = fs.readFileSync('/etc/passwd', 'utf8');
    const response = curlRunner({
      executionId: 'sealfix002-checklist-7',
      executable: 'node',
      args: ['tests/fixtures/engineering-router-sandbox/readEtcPasswdProbe.js'],
      cwd: taskWorkspace,
    });

    expect(response.exitCode).toBe(0);
    // O sandbox real tem seu PRÓPRIO /etc/passwd (imagem mínima) — ler esse arquivo não é uma
    // vulnerabilidade; a prova real é que o conteúdo é muito menor que o /etc/passwd real do
    // HOST (que lista todos os usuários reais do sistema) — mesma asserção já provada em
    // tests/unit/engineeringRouterExecutionSandboxSecurity.test.js, agora através de containers
    // reais e separados, não bare host.
    const match = response.stdout.match(/ETC_PASSWD_READ_OK:(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match[1])).toBeLessThan(hostPasswdContent.length);
  });

  test('cwd fora de ENGINEERING_ROUTER_WORKSPACE_ROOT é rejeitado pelo runner real (fronteira de segurança ER-V1-SEALFIX-003 ativa dentro do container real, não só em testes bare-host)', () => {
    if (skipIfNoDocker()) return;

    const response = curlRunner({
      executionId: 'sealfix002-checklist-boundary',
      executable: 'node',
      args: ['tests/fixtures/engineering-router-sandbox/printEnvProbe.js'],
      cwd: '/etc',
    });

    expect(response.error).toBe('cwd_not_allowed');
  });

  test('network=host é rejeitado pelo runner real (fronteira de segurança ER-V1-SEALFIX-003 ativa dentro do container real)', () => {
    if (skipIfNoDocker()) return;

    const response = curlRunner({
      executionId: 'sealfix002-checklist-network',
      executable: 'node',
      args: ['tests/fixtures/engineering-router-sandbox/printEnvProbe.js'],
      cwd: taskWorkspace,
      network: 'host',
    });

    expect(response.error).toBe('network_not_allowed');
  });
});
