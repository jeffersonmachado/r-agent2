'use strict';

/**
 * ER-V1-SEAL-003 (Dedicated Execution Runner) — servidor HTTP do Engineering Runner, real e
 * completo (porta efêmera real, requisições HTTP reais via `fetch`), provando: fail-closed sem
 * token configurado (config.js), autenticação Bearer obrigatória em /execute, /health nunca
 * autenticado, e validação estrutural do contrato (nunca aceita shell arbitrário/args fora do
 * formato esperado).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../../services/engineering-runner/src/config');
const {
  createHttpServer, validateNetworkPolicy, validateWorkspaceCwd, sanitizeExecutionEnv,
  ALLOWED_NETWORKS, RUNNER_ENV_ALLOWLIST,
} = require('../../services/engineering-runner/src/httpServer');

describe('ER-V1-SEAL-003 — services/engineering-runner/src/config.js (fail-closed)', () => {
  test('sobe sem ENGINEERING_RUNNER_TOKEN → lança explicitamente, nunca sobe anônimo', () => {
    expect(() => loadConfig({}, {})).toThrow(/ENGINEERING_RUNNER_TOKEN ausente/);
  });

  test('token vazio é tratado como ausente', () => {
    expect(() => loadConfig({ ENGINEERING_RUNNER_TOKEN: '' }, {})).toThrow(/ENGINEERING_RUNNER_TOKEN ausente/);
  });

  test('com token válido, config carrega com defaults sãos', () => {
    const config = loadConfig({ ENGINEERING_RUNNER_TOKEN: 'abc' }, {});
    expect(config.authToken).toBe('abc');
    expect(config.port).toBe(8090);
    expect(config.maxTimeoutMs).toBeGreaterThan(0);
  });

  test('ENGINEERING_RUNNER_MAX_TIMEOUT_MS fora do intervalo permitido é rejeitado', () => {
    expect(() => loadConfig({ ENGINEERING_RUNNER_TOKEN: 'abc', ENGINEERING_RUNNER_MAX_TIMEOUT_MS: '999999999' }, {})).toThrow(/ENGINEERING_RUNNER_MAX_TIMEOUT_MS/);
  });
});

describe('ER-V1-SEAL-003 — servidor HTTP do Engineering Runner (real, porta efêmera)', () => {
  let http;
  let baseUrl;
  const TOKEN = 'jest-unit-engineering-runner-token';

  beforeAll(async () => {
    const config = loadConfig({ ENGINEERING_RUNNER_TOKEN: TOKEN, ENGINEERING_RUNNER_PORT: '0' }, {});
    http = createHttpServer({ config, logger: { error: () => {} } });
    await http.start();
    const address = http.server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await http.stop();
  });

  test('GET /health nunca exige autenticação e sempre responde 200', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.sandboxAvailable).toBe('boolean');
  });

  test('POST /execute sem Authorization → 401, nunca executa nada', async () => {
    const res = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ executionId: 'x', executable: 'echo', args: ['a'], cwd: '/tmp' }),
    });
    expect(res.status).toBe(401);
  });

  test('POST /execute com Bearer token errado → 401', async () => {
    const res = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-errado' },
      body: JSON.stringify({ executionId: 'x', executable: 'echo', args: ['a'], cwd: '/tmp' }),
    });
    expect(res.status).toBe(401);
  });

  test('POST /execute autenticado mas com contrato inválido (args não é array) → 400, nunca tenta executar', async () => {
    const res = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ executionId: 'x', executable: 'echo', args: 'nao-e-array', cwd: '/tmp' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_execute_contract');
  });

  test('POST /execute autenticado, sem executionId → 400 (contrato estruturado é obrigatório, nunca inferido)', async () => {
    const res = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ executable: 'echo', args: ['a'], cwd: '/tmp' }),
    });
    expect(res.status).toBe(400);
  });

  test('POST /execute com timeoutMs acima do teto configurado → 400, nunca aceito silenciosamente', async () => {
    const res = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ executionId: 'x', executable: 'echo', args: ['a'], cwd: '/tmp', timeoutMs: 999999999 }),
    });
    expect(res.status).toBe(400);
  });

  test('corpo não é JSON válido → 400 explícito', async () => {
    const res = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: '{ isso nao é json',
    });
    expect(res.status).toBe(400);
  });

  test('rota inexistente → 404', async () => {
    const res = await fetch(`${baseUrl}/rota-que-nao-existe`);
    expect(res.status).toBe(404);
  });
});

describe('ER-V1-SEALFIX-003 — Runner Trust Boundary (funções puras de policy)', () => {
  let workspaceRoot;
  let validWorkspace;

  beforeAll(() => {
    workspaceRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sealfix-003-workspace-root-')));
    validWorkspace = path.join(workspaceRoot, 'task-1-attempt-1');
    fs.mkdirSync(validWorkspace, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  test('[network=host] => reject', () => {
    const result = validateNetworkPolicy('host');
    expect(result.ok).toBe(false);
  });

  test('[network=bridge] => reject (só "none" é permitido em V1)', () => {
    expect(validateNetworkPolicy('bridge').ok).toBe(false);
  });

  test('network="container:algum-outro-container" => reject', () => {
    expect(validateNetworkPolicy('container:vitima').ok).toBe(false);
  });

  test('network ausente => default seguro "none", nunca um valor não solicitado', () => {
    const result = validateNetworkPolicy(undefined);
    expect(result.ok).toBe(true);
    expect(result.value).toBe('none');
  });

  test('ALLOWED_NETWORKS é exclusivamente ["none"] em V1 — mudança de policy é sempre um diff explícito neste arquivo', () => {
    expect(ALLOWED_NETWORKS).toEqual(['none']);
  });

  test('[cwd=/etc] => reject', () => {
    expect(validateWorkspaceCwd('/etc', workspaceRoot).ok).toBe(false);
  });

  test('[cwd=/root] => reject', () => {
    expect(validateWorkspaceCwd('/root', workspaceRoot).ok).toBe(false);
  });

  test('[cwd=/var/run] => reject (caminho do Docker socket)', () => {
    expect(validateWorkspaceCwd('/var/run', workspaceRoot).ok).toBe(false);
  });

  test('[cwd=../workspaceEscape] => reject (fora de workspaceRoot, mesmo existindo de verdade)', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sealfix-003-outside-'));
    try {
      expect(validateWorkspaceCwd(outside, workspaceRoot).ok).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('symlink escape => reject (symlink DENTRO do workspace aponta para fora dele)', () => {
    const escapeTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'sealfix-003-escape-target-'));
    const linkPath = path.join(workspaceRoot, 'symlink-escape');
    try {
      fs.symlinkSync(escapeTarget, linkPath);
      expect(validateWorkspaceCwd(linkPath, workspaceRoot).ok).toBe(false);
    } finally {
      fs.rmSync(linkPath, { force: true });
      fs.rmSync(escapeTarget, { recursive: true, force: true });
    }
  });

  test('cwd inexistente => reject explícito (nunca tenta executar sobre um caminho que não existe)', () => {
    const result = validateWorkspaceCwd(path.join(workspaceRoot, 'nao-existe'), workspaceRoot);
    expect(result.ok).toBe(false);
  });

  test('caso positivo: cwd real dentro do workspaceRoot => aceito', () => {
    const result = validateWorkspaceCwd(validWorkspace, workspaceRoot);
    expect(result.ok).toBe(true);
  });

  test('env com secret real é descartado — só chaves da allowlist do runner sobrevivem', () => {
    const sanitized = sanitizeExecutionEnv({
      OPENAI_API_KEY: 'sk-real-secret-nao-pode-vazar',
      DATABASE_PASSWORD: 'super-secreto',
      LD_PRELOAD: '/tmp/evil.so',
      NODE_OPTIONS: '--require /tmp/evil.js',
      PATH: '/usr/bin:/bin',
    });
    expect(sanitized.OPENAI_API_KEY).toBeUndefined();
    expect(sanitized.DATABASE_PASSWORD).toBeUndefined();
    expect(sanitized.LD_PRELOAD).toBeUndefined();
    expect(sanitized.NODE_OPTIONS).toBeUndefined();
    expect(sanitized.PATH).toBe('/usr/bin:/bin');
  });

  test('env vazio/ausente não lança — resulta em objeto vazio', () => {
    expect(sanitizeExecutionEnv(undefined)).toEqual({});
    expect(sanitizeExecutionEnv({})).toEqual({});
  });

  test('RUNNER_ENV_ALLOWLIST nunca inclui nenhuma variável de credencial/segredo conhecida', () => {
    for (const dangerous of ['OPENAI_API_KEY', 'DATABASE_PASSWORD', 'JWT_SECRET', 'ENCRYPTION_KEY', 'AWS_SECRET_ACCESS_KEY', 'GROQ_API_KEY']) {
      expect(RUNNER_ENV_ALLOWLIST.has(dangerous)).toBe(false);
    }
  });
});

describe('ER-V1-SEALFIX-003 — Runner Trust Boundary (end-to-end HTTP real, prova que a policy está de fato conectada)', () => {
  let http;
  let baseUrl;
  let workspaceRoot;
  let validWorkspace;
  const TOKEN = 'jest-sealfix-003-e2e-token';

  beforeAll(async () => {
    workspaceRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sealfix-003-e2e-workspace-root-')));
    validWorkspace = path.join(workspaceRoot, 'task-1-attempt-1');
    fs.mkdirSync(validWorkspace, { recursive: true });
    const config = loadConfig({
      ENGINEERING_RUNNER_TOKEN: TOKEN,
      ENGINEERING_RUNNER_PORT: '0',
      ENGINEERING_ROUTER_WORKSPACE_ROOT: workspaceRoot,
    }, {});
    http = createHttpServer({ config, logger: { error: () => {} } });
    await http.start();
    baseUrl = `http://127.0.0.1:${http.server.address().port}`;
  });

  afterAll(async () => {
    await http.stop();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  async function execute(body) {
    return fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    });
  }

  test('POST /execute com network=host, autenticado e com contrato estrutural válido → 400 network_not_allowed, nunca chega a rodar', async () => {
    const res = await execute({ executionId: 'e2e-1', executable: 'node', args: ['tests/fixtures/x.js'], cwd: validWorkspace, network: 'host' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('network_not_allowed');
  });

  test('POST /execute com cwd=/etc, autenticado e contrato válido → 400 cwd_not_allowed, nunca chega a rodar', async () => {
    const res = await execute({ executionId: 'e2e-2', executable: 'node', args: ['tests/fixtures/x.js'], cwd: '/etc' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('cwd_not_allowed');
  });

  test('[executable=/bin/sh] não autorizado => reject (revalidado no runner, mesmo autenticado)', async () => {
    const res = await execute({ executionId: 'e2e-3', executable: '/bin/sh', args: ['-c', 'echo hi'], cwd: validWorkspace });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('command_not_allowed');
  });

  test('git push (subcomando não autorizado) => reject mesmo sendo "git", que tem subcomandos permitidos', async () => {
    const res = await execute({ executionId: 'e2e-4', executable: 'git', args: ['push', 'origin', 'main'], cwd: validWorkspace });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('command_not_allowed');
  });

  test('attempt --privileged/--cap-add/volumes/docker-socket via campos extras no corpo => impossível: contrato HTTP não tem esses campos, nunca alcançam a resposta nem a execução', async () => {
    const res = await execute({
      executionId: 'e2e-5',
      executable: 'node',
      args: ['tests/fixtures/does-not-exist-on-purpose.js'],
      cwd: validWorkspace,
      privileged: true,
      capAdd: ['SYS_ADMIN'],
      volumes: ['/:/host-root'],
      pid: 'host',
      dockerSocket: '/var/run/docker.sock',
    });
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/privileged|capAdd|SYS_ADMIN|host-root|volumes|docker\.sock/i);
  });
});
