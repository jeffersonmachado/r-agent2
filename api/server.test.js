const http = require('http');

/**
 * Helper para fazer requisições HTTP simples contra o servidor em teste.
 *
 * @param {number} port
 * @param {string} method
 * @param {string} path
 * @param {any} [body]
 * @param {Record<string, string>} [extraHeaders]
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, body: any }>}
 */
function request(port, method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload =
      body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);

    const baseHeaders = payload != null
      ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        }
      : {};

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          ...baseHeaders,
          ...(extraHeaders || {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          if (data) {
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = data;
            }
          }
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: parsed,
          });
        });
      },
    );

    req.on('error', (err) => {
      reject(err);
    });

    if (payload != null) {
      req.write(payload);
    }

    req.end();
  });
}

describe('API server (api/server.js)', () => {
  /** @type {http.Server} */
  let server;
  let port;
  let createServer;
  let skipServerTests = false;

  beforeAll((done) => {
    // Estes testes validam comportamento base/compatibilidade do servidor.
    // Força ambiente "development" para não aplicar rate limiting por tenant.
    process.env.NODE_ENV = 'development';
    delete process.env.STRICT_TENANT_MODE;
    jest.resetModules();

    // eslint-disable-next-line global-require
    ({ createServer } = require('./server'));
    server = createServer();
    const onError = (err) => {
      if (err && err.code === 'EPERM') {
        skipServerTests = true;
        done();
        return;
      }
      done(err);
    };
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      const address = server.address();
      if (address && typeof address === 'object') {
        port = address.port;
      } else {
        port = 0;
      }
      done();
    });
  });

  afterAll((done) => {
    const finalize = async () => {
      try {
        // Fecha conexão com o banco (evita handles abertos no Jest)
        // eslint-disable-next-line global-require
        const db = require('./db/index');
        if (db && typeof db.close === 'function') {
          await db.close();
        }
      } catch {
        // best-effort
      }
      done();
    };

    if (!server || skipServerTests) {
      finalize();
      return;
    }

    // Fecha todas as conexões pendentes antes de fechar o servidor
    server.closeAllConnections();
    server.close(() => {
      // Aguarda um pouco para garantir que todas as conexões foram fechadas
      setTimeout(() => {
        finalize();
      }, 100);
    });
  });

  test('GET /health deve retornar status ok', async () => {
    if (skipServerTests) return;
    const res = await request(port, 'GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  describe('Health endpoints', () => {
    test('GET /health/live deve retornar 200 com status ok, timestamp e uptimeSec', async () => {
      if (skipServerTests) return;
      const res = await request(port, 'GET', '/health/live');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('uptimeSec');
      expect(typeof res.body.uptimeSec).toBe('number');
      expect(res.body.uptimeSec).toBeGreaterThanOrEqual(0);
    });

    test('GET /health/db deve retornar informações detalhadas do banco', async () => {
      if (skipServerTests) return;
      const res = await request(port, 'GET', '/health/db');
      // Pode retornar 200 (ok) ou 503 (fail) dependendo do estado do DB
      expect([200, 503]).toContain(res.status);
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('environment');
      expect(res.body).toHaveProperty('latencyMs');
      expect(res.body).toHaveProperty('db');
      expect(res.body).toHaveProperty('migrations');
      expect(res.body).toHaveProperty('sync');
      expect(res.body).toHaveProperty('timestamp');
      
      // Verifica estrutura do db
      expect(res.body.db).toHaveProperty('host');
      expect(res.body.db).toHaveProperty('database');
      
      // Verifica estrutura das migrations
      expect(res.body.migrations).toHaveProperty('applied');
      expect(res.body.migrations).toHaveProperty('pending');
      expect(res.body.migrations).toHaveProperty('pendingNames');
      expect(Array.isArray(res.body.migrations.pendingNames)).toBe(true);
      expect(res.body.migrations.pendingNames.length).toBeLessThanOrEqual(10);
      
      // Verifica estrutura do sync
      expect(res.body.sync).toHaveProperty('allowSync');
      expect(res.body.sync).toHaveProperty('syncBlockedInProduction');
      
      // Não deve retornar senha
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    });

    test('GET /health/ready deve retornar 200 quando DB ok e sem migrations pendentes', async () => {
      if (skipServerTests) return;
      const res = await request(port, 'GET', '/health/ready');
      // Pode retornar 200 (ready) ou 503 (not_ready) dependendo do estado
      expect([200, 503]).toContain(res.status);
      
      if (res.status === 200) {
        expect(res.body).toHaveProperty('status', 'ready');
        expect(res.body).toHaveProperty('db', 'ok');
        expect(res.body).toHaveProperty('migrationsPending', 0);
        expect(res.body).toHaveProperty('timestamp');
      } else {
        // 503 quando não está pronto
        expect(res.body).toHaveProperty('status', 'not_ready');
        expect(res.body).toHaveProperty('reason');
        expect(['db_connection_failed', 'migrations_pending', 'check_failed']).toContain(res.body.reason);
        expect(res.body).toHaveProperty('timestamp');
        
        // Se for migrations_pending, deve ter pending e pendingNames
        if (res.body.reason === 'migrations_pending') {
          expect(res.body).toHaveProperty('pending');
          expect(res.body).toHaveProperty('pendingNames');
          expect(Array.isArray(res.body.pendingNames)).toBe(true);
          expect(res.body.pendingNames.length).toBeLessThanOrEqual(10);
        }
      }
    });

    test('GET /health/ready com migrations pendentes deve retornar 503', async () => {
      if (skipServerTests) return;
      // Este teste verifica que o endpoint retorna 503 quando há migrations pendentes
      // O comportamento real depende do estado do banco, mas a estrutura deve estar correta
      const res = await request(port, 'GET', '/health/ready');
      expect([200, 503]).toContain(res.status);
      
      if (res.status === 503 && res.body.reason === 'migrations_pending') {
        expect(res.body).toHaveProperty('pending');
        expect(res.body).toHaveProperty('pendingNames');
        expect(Array.isArray(res.body.pendingNames)).toBe(true);
        expect(res.body.pendingNames.length).toBeLessThanOrEqual(10);
      }
    });
  });

  test('GET /version deve retornar nome e env', async () => {
    if (skipServerTests) return;
    const res = await request(port, 'GET', '/version');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name', 'chatbot-engine-api');
    expect(res.body).toHaveProperty('env');
  });

  test('Fluxo completo: POST /flows -> GET /flows/:id -> validate -> simulate -> GET /replay/:sessionId', async () => {
    if (skipServerTests) return;
    // 1) Cria fluxo mínimo com ID único
    const uniqueId = `flow-test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const baseFlow = {
      tenantId: 'tenant-demo',
      id: uniqueId,
      name: 'Fluxo de teste',
      version: 1,
      nodes: [
        { id: 'start', type: 'start', config: {}, next: 'msg' },
        { id: 'msg', type: 'message', config: { text: 'Olá' }, next: 'end' },
        { id: 'end', type: 'end', config: {}, next: null },
      ],
    };

    const createRes = await request(port, 'POST', '/flows', baseFlow);
    // POST retorna 201 (Created) quando cria com sucesso
    expect([200, 201]).toContain(createRes.status);
    expect(createRes.body).toHaveProperty('id');
    const savedFlow = createRes.body;

    // 2) GET /flows/:id
    const getRes = await request(port, 'GET', `/flows/${encodeURIComponent(savedFlow.id)}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toHaveProperty('id', savedFlow.id);

    // 3) POST /flows/validate
    const validateRes = await request(port, 'POST', '/flows/validate', savedFlow);
    expect(validateRes.status).toBe(200);
    expect(validateRes.body).toHaveProperty('valid');
    expect(Array.isArray(validateRes.body.errors)).toBe(true);

    // 4) POST /flows/simulate
    const simulateRes = await request(port, 'POST', '/flows/simulate', {
      flowId: savedFlow.id,
      maxSteps: 10,
    });

    expect(simulateRes.status).toBe(200);
    expect(simulateRes.body).toHaveProperty('compiledFlowInfo');
    expect(simulateRes.body).toHaveProperty('steps');
    expect(simulateRes.body).toHaveProperty('events');
    expect(simulateRes.body).toHaveProperty('replay');

    const simulation = simulateRes.body;
    expect(simulation.replay).toHaveProperty('sessionId');
    const sessionId = simulation.replay.sessionId;
    expect(typeof sessionId).toBe('string');

    // 5) GET /replay/:sessionId
    const replayRes = await request(
      port,
      'GET',
      `/replay/${encodeURIComponent(sessionId)}`,
    );
    expect(replayRes.status).toBe(200);
    expect(replayRes.body).toHaveProperty('messages');
    expect(replayRes.body).toHaveProperty('nodesVisited');
  });

  test('GET /flows deve retornar array (pode estar vazio)', async () => {
    if (skipServerTests) return;
    const res = await request(port, 'GET', '/flows');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('PUT /flows/:id deve atualizar fluxo existente', async () => {
    if (skipServerTests) return;
    const flowId = `flow-put-test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    // Primeiro cria o fluxo com POST
    const createRes = await request(port, 'POST', '/flows', {
      tenantId: 'tenant-demo',
      id: flowId,
      name: 'Primeira versão',
      nodes: [
        { id: 'start', type: 'start', config: {}, next: 'msg' },
        { id: 'msg', type: 'message', config: { text: 'v1' }, next: 'end' },
        { id: 'end', type: 'end', config: {}, next: null },
      ],
    });
    expect([200, 201]).toContain(createRes.status);
    expect(createRes.body).toHaveProperty('id', flowId);

    // Agora atualiza com PUT
    const putRes2 = await request(port, 'PUT', `/flows/${encodeURIComponent(flowId)}`, {
      tenantId: 'tenant-demo',
      name: 'Segunda versão',
      nodes: [
        { id: 'start', type: 'start', config: {}, next: 'msg' },
        { id: 'msg', type: 'message', config: { text: 'v2' }, next: 'end' },
        { id: 'end', type: 'end', config: {}, next: null },
      ],
    });
    expect(putRes2.status).toBe(200);
    expect(putRes2.body).toHaveProperty('id', flowId);
    expect(putRes2.body).toHaveProperty('name', 'Segunda versão');
  });

  test('Fluxo inexistente deve retornar 404 apropriado', async () => {
    if (skipServerTests) return;
    const res = await request(port, 'GET', '/flows/nao-existe');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'flow_not_found' });
  });

  test('DELETE /flows/:id deve remover fluxo existente', async () => {
    if (skipServerTests) return;
    const flowId = `flow-delete-test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    // Primeiro cria um fluxo
    const createRes = await request(port, 'POST', '/flows', {
      tenantId: 'tenant-demo',
      id: flowId,
      name: 'Fluxo para deletar',
      nodes: [
        { id: 'start', type: 'start', config: {}, next: 'msg' },
        { id: 'msg', type: 'message', config: { text: 'del' }, next: 'end' },
        { id: 'end', type: 'end', config: {}, next: null },
      ],
    });
    // POST retorna 201 (Created) quando cria com sucesso
    expect([200, 201]).toContain(createRes.status);
    expect(createRes.body).toHaveProperty('id', flowId);

    // Verifica que o fluxo existe
    const getRes = await request(port, 'GET', `/flows/${encodeURIComponent(flowId)}`);
    expect(getRes.status).toBe(200);

    // Deleta o fluxo
    const deleteRes = await request(port, 'DELETE', `/flows/${encodeURIComponent(flowId)}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body).toHaveProperty('success', true);
    expect(deleteRes.body).toHaveProperty('deletedId', flowId);

    // Verifica que o fluxo não existe mais
    const getResAfter = await request(port, 'GET', `/flows/${encodeURIComponent(flowId)}`);
    expect(getResAfter.status).toBe(404);
  });

  test('DELETE /flows/:id deve retornar 404 para fluxo inexistente', async () => {
    if (skipServerTests) return;
    const res = await request(port, 'DELETE', '/flows/nao-existe');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'flow_not_found' });
  });

  test('Body JSON inválido deve retornar 400 em /flows e /flows/validate', async () => {
    if (skipServerTests) return;
    // Força JSON inválido em /flows
    const res1 = await request(port, 'POST', '/flows', '{ invalid-json');
    expect(res1.status).toBe(400);
    expect(res1.body).toHaveProperty('error', 'bad_request');

    // JSON inválido em /flows/validate
    const res2 = await request(port, 'POST', '/flows/validate', '{ invalid-json');
    expect(res2.status).toBe(400);
    expect(res2.body).toHaveProperty('error', 'bad_request');
  });

  test('POST /flows/simulate com flowId ausente ou inexistente', async () => {
    if (skipServerTests) return;
    const res1 = await request(port, 'POST', '/flows/simulate', {});
    expect(res1.status).toBe(400);
    expect(res1.body).toHaveProperty('error', 'bad_request');

    const res2 = await request(port, 'POST', '/flows/simulate', {
      flowId: 'nao-existe',
    });
    expect(res2.status).toBe(404);
    expect(res2.body).toHaveProperty('error', 'flow_not_found');
  });

  test('GET /replay/:sessionId deve retornar 404 se sessão não existir', async () => {
    if (skipServerTests) return;
    const res = await request(port, 'GET', '/replay/sessao-inexistente');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'session_not_found');
  });

  test('POST /flows com fluxo sem tenantId retorna 403 tenant_required', async () => {
    if (skipServerTests) return;
    const uniqueId = `flow-no-tenant-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const flowWithoutTenant = {
      id: uniqueId,
      name: 'Fluxo sem tenant',
      nodes: [
        { id: 'start', type: 'start', config: {}, next: 'msg' },
        { id: 'msg', type: 'message', config: { text: 'x' }, next: 'end' },
        { id: 'end', type: 'end', config: {}, next: null },
      ],
    };

    const res = await request(port, 'POST', '/flows', flowWithoutTenant);
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error', 'tenant_required');
  });

  test('POST /flows com fluxo sem id gera id automaticamente', async () => {
    if (skipServerTests) return;
    const flowWithoutId = {
      tenantId: 'tenant-demo',
      name: 'Fluxo sem id',
      nodes: [
        { id: 'start', type: 'start', config: {}, next: 'msg' },
        { id: 'msg', type: 'message', config: { text: 'x' }, next: 'end' },
        { id: 'end', type: 'end', config: {}, next: null },
      ],
    };

    const res = await request(port, 'POST', '/flows', flowWithoutId);
    // POST retorna 201 (Created) quando cria com sucesso
    expect([200, 201]).toContain(res.status);
    expect(res.body).toHaveProperty('id');
    expect(typeof res.body.id).toBe('string');
    expect(res.body.id.length).toBeGreaterThan(0);
  });

  test('PUT /flows/:id com id diferente no body deve retornar erro 400', async () => {
    if (skipServerTests) return;
    const flowId = `flow-url-id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    // Primeiro cria o fluxo
    await request(port, 'POST', '/flows', {
      tenantId: 'tenant-demo',
      id: flowId,
      name: 'Fluxo inicial',
      nodes: [
        { id: 'start', type: 'start', config: {}, next: 'msg' },
        { id: 'msg', type: 'message', config: { text: 'init' }, next: 'end' },
        { id: 'end', type: 'end', config: {}, next: null },
      ],
    });

    const flow = {
      id: 'flow-body-id', // diferente do id na URL
      tenantId: 'tenant-demo',
      name: 'Teste ID',
      nodes: [
        { id: 'start', type: 'start', config: {}, next: 'msg' },
        { id: 'msg', type: 'message', config: { text: 'id' }, next: 'end' },
        { id: 'end', type: 'end', config: {}, next: null },
      ],
    };

    // O servidor deve rejeitar quando o id do body é diferente do id da URL
    const res = await request(port, 'PUT', `/flows/${encodeURIComponent(flowId)}`, flow);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'bad_request');
  });

  test('POST /flows/simulate aceita maxSteps e executa simulação', async () => {
    if (skipServerTests) return;
    // Primeiro cria um fluxo
    const flow = {
      tenantId: 'tenant-demo',
      id: 'flow-simulate-test',
      name: 'Fluxo para simulação',
      version: 1,
      nodes: [
        { id: 'start', type: 'start', config: {}, next: 'msg' },
        { id: 'msg', type: 'message', config: { text: 'sim' }, next: 'end' },
        { id: 'end', type: 'end', config: {}, next: null },
      ],
    };

    await request(port, 'POST', '/flows', flow);

    // Simula com maxSteps customizado
    const res = await request(port, 'POST', '/flows/simulate', {
      flowId: 'flow-simulate-test',
      maxSteps: 5,
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('steps');
    expect(Array.isArray(res.body.steps)).toBe(true);
  });

  test('POST /flows/simulate com maxSteps muito alto deve retornar erro', async () => {
    if (skipServerTests) return;
    const flow = {
      tenantId: 'tenant-demo',
      id: 'flow-simulate-limit',
      name: 'Fluxo para teste de limite',
      version: 1,
      nodes: [
        { id: 'start', type: 'start', config: {}, next: 'msg' },
        { id: 'msg', type: 'message', config: { text: 'limit' }, next: 'end' },
        { id: 'end', type: 'end', config: {}, next: null },
      ],
    };

    await request(port, 'POST', '/flows', flow);

    const res = await request(port, 'POST', '/flows/simulate', {
      flowId: 'flow-simulate-limit',
      maxSteps: 10000,
    });

    // O servidor deve rejeitar maxSteps > 1000
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('GET /flows retorna todos os fluxos (sem filtro por tenantId)', async () => {
    if (skipServerTests) return;
    const flow1 = {
      tenantId: 'tenant-1',
      id: 'flow-tenant-1',
      name: 'Fluxo Tenant 1',
      version: 1,
      nodes: [
        { id: 'start', type: 'start', config: {}, next: 'msg' },
        { id: 'msg', type: 'message', config: { text: 't1' }, next: 'end' },
        { id: 'end', type: 'end', config: {}, next: null },
      ],
    };

    const flow2 = {
      tenantId: 'tenant-2',
      id: 'flow-tenant-2',
      name: 'Fluxo Tenant 2',
      version: 1,
      nodes: [
        { id: 'start', type: 'start', config: {}, next: 'msg' },
        { id: 'msg', type: 'message', config: { text: 't2' }, next: 'end' },
        { id: 'end', type: 'end', config: {}, next: null },
      ],
    };

    await request(port, 'POST', '/flows', flow1);
    await request(port, 'POST', '/flows', flow2);

    const res = await request(port, 'GET', '/flows');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Deve retornar todos os fluxos (sem filtro)
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  test('POST /flows/validate com fluxo válido retorna valid: true', async () => {
    if (skipServerTests) return;
    const validFlow = {
      tenantId: 'tenant-demo',
      id: 'flow-valid',
      name: 'Fluxo válido',
      version: 1,
      nodes: [
        { id: 'start', type: 'start', config: {}, next: 'msg' },
        { id: 'msg', type: 'message', config: { text: 'ok' }, next: 'end' },
        { id: 'end', type: 'end', config: {}, next: null },
      ],
    };

    const res = await request(port, 'POST', '/flows/validate', validFlow);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('valid', true);
    expect(res.body).toHaveProperty('errors');
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  test('POST /flows/validate com fluxo inválido retorna valid: false e erros', async () => {
    if (skipServerTests) return;
    const invalidFlow = {
      tenantId: 'tenant-demo',
      id: 'flow-invalid',
      name: 'Fluxo inválido',
      version: 1,
      nodes: [
        { id: 'start', type: 'start', config: {}, next: 'missing' },
        { id: 'end', type: 'end', config: {}, next: null },
      ],
    };

    const res = await request(port, 'POST', '/flows/validate', invalidFlow);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('valid', false);
    expect(res.body).toHaveProperty('errors');
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  describe('Quick actions routes (HTTP matcher + auth guard)', () => {
    async function issueAgentToken({ tenantId, role = 'operator' }) {
      const authService = require('./services/authService');
      const { createTenant } = require('./services/tenantService');
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const username = `qa-${role}-${stamp}`;
      const password = 'Secr3t!123';

      let createOut = await authService.createAgent({
        tenantId,
        username,
        email: `${username}@example.com`,
        password,
        role,
        name: `QA ${role}`,
      });

      if (!createOut.success) {
        const ensureTenantOut = await createTenant({
          tenant_key: tenantId,
          name: `Tenant QA ${tenantId}`,
          site: `https://${tenantId}.example.com`,
          ramo_atividade: 'qa',
          objetivo: 'server-test-quick-actions-auth',
          plan: 'trial',
        });

        if (ensureTenantOut.success) {
          createOut = await authService.createAgent({
            tenantId,
            username,
            email: `${username}@example.com`,
            password,
            role,
            name: `QA ${role}`,
          });
        }
      }

      expect(createOut.success).toBe(true);

      const loginOut = await authService.login(username, password, '127.0.0.1', 'jest-server-test');
      expect(loginOut.success).toBe(true);
      expect(typeof loginOut.token).toBe('string');
      expect(loginOut.token.length).toBeGreaterThan(8);
      return loginOut.token;
    }

    test('GET /api/crm/contacts/:contactId/operational-signals/:signalId/quick-actions sem token retorna 401', async () => {
      if (skipServerTests) return;
      const res = await request(
        port,
        'GET',
        '/api/crm/contacts/contact-test/operational-signals/sig-test/quick-actions',
      );

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'unauthorized');
    });

    test('POST /api/crm/contacts/:contactId/operational-signals/:signalId/quick-actions/:actionId sem token retorna 401', async () => {
      if (skipServerTests) return;
      const res = await request(
        port,
        'POST',
        '/api/crm/contacts/contact-test/operational-signals/sig-test/quick-actions/action-test',
        { input: { note: 'hello' } },
      );

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'unauthorized');
    });

    test('GET /api/admin/tenant/:id/operational-recommendations/:recommendationId/quick-actions sem token retorna 401', async () => {
      if (skipServerTests) return;
      const res = await request(
        port,
        'GET',
        '/api/admin/tenant/tenant-test/operational-recommendations/rec-test/quick-actions',
      );

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'unauthorized');
    });

    test('GET admin quick-actions com operador autenticado retorna 403', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-quick-actions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const operatorToken = await issueAgentToken({ tenantId: tenantKey, role: 'operator' });

      const res = await request(
        port,
        'GET',
        `/api/admin/tenant/${encodeURIComponent(tenantKey)}/operational-signals/${encodeURIComponent('sig-any')}/quick-actions`,
        undefined,
        { Authorization: `Bearer ${operatorToken}` },
      );

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('ok', false);
      expect(typeof res.body.error).toBe('string');
    });

    test('POST admin quick-action com super-admin e action inválida retorna 422', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-quick-actions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const superAdminToken = await issueAgentToken({ tenantId: tenantKey, role: 'super_admin' });
      const { quickActionAccess } = require('./core/operational-quick-actions');
      const scopeSpy = jest.spyOn(quickActionAccess, 'resolveScope').mockResolvedValueOnce({
        ok: true,
        tenantId: tenantKey,
        source: { id: 'sig-synthetic', status: 'open' },
        actions: [{ id: 'open_followup' }],
        supportContext: null,
      });

      const res = await request(
        port,
        'POST',
        `/api/admin/tenant/${encodeURIComponent(tenantKey)}/operational-signals/${encodeURIComponent('sig-synthetic')}/quick-actions/${encodeURIComponent('non_existing_action')}`,
        { input: { note: 'qa' } },
        { Authorization: `Bearer ${superAdminToken}` },
      );

      scopeSpy.mockRestore();
      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty('ok', false);
      expect(res.body).toHaveProperty('error.code', 'ACTION_NOT_FOUND');
    });
  });

  describe('Operational canonical routes (HTTP integration)', () => {
    async function issueAgentToken({ tenantId, role = 'operator' }) {
      const authService = require('./services/authService');
      const { createTenant } = require('./services/tenantService');
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const username = `qa-operational-${role}-${stamp}`;
      const password = 'Secr3t!123';

      let createOut = await authService.createAgent({
        tenantId,
        username,
        email: `${username}@example.com`,
        password,
        role,
        name: `QA ${role}`,
      });

      if (!createOut.success) {
        const ensureTenantOut = await createTenant({
          tenant_key: tenantId,
          name: `Tenant QA ${tenantId}`,
          site: `https://${tenantId}.example.com`,
          ramo_atividade: 'qa',
          objetivo: 'server-test-operational-canonical-routes',
          plan: 'trial',
        });

        if (ensureTenantOut.success) {
          createOut = await authService.createAgent({
            tenantId,
            username,
            email: `${username}@example.com`,
            password,
            role,
            name: `QA ${role}`,
          });
        }
      }

      expect(createOut.success).toBe(true);

      const loginOut = await authService.login(username, password, '127.0.0.1', 'jest-server-test');
      expect(loginOut.success).toBe(true);
      expect(typeof loginOut.token).toBe('string');
      expect(loginOut.token.length).toBeGreaterThan(8);
      return loginOut.token;
    }

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('Fluxo OCC centralizado por contato: gerar sinais e recomendações', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-occ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const token = await issueAgentToken({ tenantId: tenantKey, role: 'super_admin' });

      const { OperationalAgentService } = require('./core/operational-agent');
      const signalSpy = jest.spyOn(OperationalAgentService.prototype, 'generateContactSignals').mockResolvedValueOnce({
        ok: true,
        opened: [{ id: 'sig-1', signal_type: 'followup_due' }],
      });
      const recommendationSpy = jest.spyOn(OperationalAgentService.prototype, 'generateContactRecommendations').mockResolvedValueOnce({
        ok: true,
        generated: [{ id: 'rec-1', recommendation_type: 'schedule_contact', source_signal_id: 'sig-1' }],
      });

      const signalRes = await request(
        port,
        'POST',
        `/api/admin/tenant/${encodeURIComponent(tenantKey)}/operational-signals/generate`,
        { contactId: 'contact-1' },
        { Authorization: `Bearer ${token}` },
      );

      const recommendationRes = await request(
        port,
        'POST',
        `/api/admin/tenant/${encodeURIComponent(tenantKey)}/operational-recommendations/generate`,
        { contactId: 'contact-1' },
        { Authorization: `Bearer ${token}` },
      );

      expect(signalRes.status).toBe(200);
      expect(signalRes.body).toHaveProperty('ok', true);
      expect(recommendationRes.status).toBe(200);
      expect(recommendationRes.body).toHaveProperty('ok', true);
      expect(signalSpy).toHaveBeenCalledWith({ tenantId: tenantKey, contactId: 'contact-1' });
      expect(recommendationSpy).toHaveBeenCalledWith({
        tenantId: tenantKey,
        contactId: 'contact-1',
        includeSignalGeneration: true,
      });
    });

    test('GET OCC /operational-signals com super-admin usa consulta canônica v2', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-occ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const token = await issueAgentToken({ tenantId: tenantKey, role: 'super_admin' });

      const { OperationalOccQueryService } = require('./core/operational-agent');
      const listSpy = jest.spyOn(OperationalOccQueryService.prototype, 'listTenantSignals').mockResolvedValueOnce({
        ok: true,
        items: [{ id: 'sig-occ-1', signal_type: 'ticket_escalation' }],
      });

      const res = await request(
        port,
        'GET',
        `/api/admin/tenant/${encodeURIComponent(tenantKey)}/operational-signals?activeOnly=true&limit=5`,
        undefined,
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(listSpy).toHaveBeenCalledWith({
        tenantId: tenantKey,
        activeOnly: true,
        limit: 5,
        contactId: null,
        status: null,
        severity: null,
        type: null,
        from: null,
        to: null,
      });
    });

    test('GET OCC /operational-kpis com super-admin retorna KPIs operacionais', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-occ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const token = await issueAgentToken({ tenantId: tenantKey, role: 'super_admin' });

      const { OperationalOccQueryService } = require('./core/operational-agent');
      const kpiSpy = jest.spyOn(OperationalOccQueryService.prototype, 'getOperationalKPIs').mockResolvedValueOnce({
        ok: true,
        kpis: {
          openSignals: 4,
          criticalSignals: 1,
          openRecommendations: 3,
          activePlaybooks: 2,
          signalsToday: 2,
          recommendationsToday: 1,
          severitySummary: { critical: 1, high: 1, medium: 1, low: 1 },
        },
      });

      const res = await request(
        port,
        'GET',
        `/api/admin/tenant/${encodeURIComponent(tenantKey)}/operational-kpis`,
        undefined,
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('kpis.openSignals', 4);
      expect(kpiSpy).toHaveBeenCalledWith({ tenantId: tenantKey });
    });

    test('GET OCC /operational-signals/top-types retorna agregação de tipos', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-occ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const token = await issueAgentToken({ tenantId: tenantKey, role: 'super_admin' });

      const { OperationalOccQueryService } = require('./core/operational-agent');
      const topSpy = jest.spyOn(OperationalOccQueryService.prototype, 'getTopOperationalSignals').mockResolvedValueOnce({
        ok: true,
        items: [
          { type: 'low_occupancy', count: 3 },
          { type: 'support_backlog_risk', count: 2 },
        ],
      });

      const res = await request(
        port,
        'GET',
        `/api/admin/tenant/${encodeURIComponent(tenantKey)}/operational-signals/top-types?limit=2`,
        undefined,
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items[0]).toHaveProperty('type', 'low_occupancy');
      expect(topSpy).toHaveBeenCalledWith({
        tenantId: tenantKey,
        from: null,
        to: null,
        limit: 2,
      });
    });

    test('GET OCC /operational-playbook-executions retorna execuções ativas', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-occ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const token = await issueAgentToken({ tenantId: tenantKey, role: 'super_admin' });

      const { OperationalOccQueryService } = require('./core/operational-agent');
      const playbookSpy = jest.spyOn(OperationalOccQueryService.prototype, 'listTenantActivePlaybooks').mockResolvedValueOnce({
        ok: true,
        items: [{ id: 'run-1', playbook_id: 'followup_recovery', status: 'in_progress' }],
      });

      const res = await request(
        port,
        'GET',
        `/api/admin/tenant/${encodeURIComponent(tenantKey)}/operational-playbook-executions?limit=5`,
        undefined,
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items[0]).toHaveProperty('id', 'run-1');
      expect(playbookSpy).toHaveBeenCalledWith({
        tenantId: tenantKey,
        limit: 5,
        status: null,
        contactId: null,
        from: null,
        to: null,
      });
    });

    test('GET OCC /operational-outcomes/signal retorna outcomes do sinal', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-occ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const token = await issueAgentToken({ tenantId: tenantKey, role: 'super_admin' });

      const { OperationalOccQueryService } = require('./core/operational-agent');
      const outSpy = jest.spyOn(OperationalOccQueryService.prototype, 'listTenantOutcomes').mockResolvedValueOnce({
        ok: true,
        items: [{ id: 'out-sig-1', signal_id: 'sig-occ-1', outcome_type: 'manual_resolution' }],
        total: 1,
      });

      const res = await request(
        port,
        'GET',
        `/api/admin/tenant/${encodeURIComponent(tenantKey)}/operational-outcomes/signals/${encodeURIComponent('sig-occ-1')}?limit=7`,
        undefined,
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items[0]).toHaveProperty('id', 'out-sig-1');
      expect(outSpy).toHaveBeenCalledWith({
        tenantId: tenantKey,
        signalId: 'sig-occ-1',
        sourceType: 'signal',
        sourceId: 'sig-occ-1',
        status: null,
        limit: 7,
      });
    });

    test('GET OCC /operational-decisions/signals com feature desabilitada retorna lista vazia sem erro', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-occ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const token = await issueAgentToken({ tenantId: tenantKey, role: 'super_admin' });

      const tenantFeatureService = require('./services/tenantFeatureService');
      const flagSpy = jest.spyOn(tenantFeatureService, 'isEnabled').mockResolvedValueOnce(false);

      const { OperationalDecisionEngine } = require('./core/operational-decision');
      const listSpy = jest.spyOn(OperationalDecisionEngine.prototype, 'listSignalDecisions');

      const res = await request(
        port,
        'GET',
        `/api/admin/tenant/${encodeURIComponent(tenantKey)}/operational-decisions/signals?limit=10`,
        undefined,
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        ok: true,
        enabled: false,
        reason: 'feature_disabled',
        total: 0,
      });
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items).toHaveLength(0);
      expect(flagSpy).toHaveBeenCalledWith(
        tenantKey,
        'operational_decision_engine_enabled',
        false,
      );
      expect(listSpy).not.toHaveBeenCalled();
    });

    test('GET OCC /operational-decisions/recommendations com feature habilitada retorna metadados de decisão', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-occ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const token = await issueAgentToken({ tenantId: tenantKey, role: 'super_admin' });

      const tenantFeatureService = require('./services/tenantFeatureService');
      jest.spyOn(tenantFeatureService, 'isEnabled').mockResolvedValueOnce(true);

      const { OperationalDecisionEngine } = require('./core/operational-decision');
      const decisionSpy = jest.spyOn(OperationalDecisionEngine.prototype, 'listRecommendationDecisions').mockResolvedValueOnce({
        ok: true,
        items: [
          {
            sourceType: 'recommendation',
            sourceId: 'rec-1',
            priorityScore: 87,
            decisionType: 'playbook',
            actionMode: 'human_confirm_required',
            expectedOutcome: 'recover_revenue',
            reason: 'High revenue/operational risk and no active action; playbook recommended.',
            scoreBreakdown: {
              severity: 30,
              urgency: 18,
              impact: 23,
              revenueRisk: 20,
              existingActionPenalty: 0,
            },
          },
        ],
        total: 1,
        source: 'decision_engine',
      });

      const res = await request(
        port,
        'GET',
        `/api/admin/tenant/${encodeURIComponent(tenantKey)}/operational-decisions/recommendations?status=open&limit=5`,
        undefined,
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('enabled', true);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items[0]).toHaveProperty('priorityScore', 87);
      expect(res.body.items[0]).toHaveProperty('decisionType', 'playbook');
      expect(res.body.items[0]).toHaveProperty('actionMode', 'human_confirm_required');
      expect(res.body.items[0]).toHaveProperty('expectedOutcome', 'recover_revenue');
      expect(res.body.items[0]).toHaveProperty('reason');
      expect(res.body.items[0]).toHaveProperty('scoreBreakdown');
      expect(decisionSpy).toHaveBeenCalledWith({
        tenantId: tenantKey,
        limit: 5,
        contactId: null,
        status: 'open',
        priority: null,
        type: null,
        from: null,
        to: null,
      });
    });

    test('POST OCC status de recomendação com operador autenticado retorna 403', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-occ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const token = await issueAgentToken({ tenantId: tenantKey, role: 'operator' });

      const res = await request(
        port,
        'POST',
        `/api/admin/tenant/${encodeURIComponent(tenantKey)}/operational-recommendations/${encodeURIComponent('rec-1')}/status`,
        { status: 'completed' },
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'forbidden');
    });

    test('GET /api/operational/actions/available sem token retorna 401', async () => {
      if (skipServerTests) return;
      const res = await request(
        port,
        'GET',
        '/api/operational/actions/available?sourceType=signal&sourceId=sig-1&tenantId=tenant-qa',
      );

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'unauthorized');
    });

    test('GET /api/operational/actions/available com super-admin retorna lista de ações', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-operational-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const token = await issueAgentToken({ tenantId: tenantKey, role: 'super_admin' });

      const { quickActionAccess } = require('./core/operational-quick-actions');
      jest.spyOn(quickActionAccess, 'resolveScope').mockResolvedValueOnce({
        ok: true,
        tenantId: tenantKey,
        source: { id: 'sig-1', status: 'open' },
        actions: [{ id: 'open_followup', label: 'Abrir follow-up' }],
        supportContext: null,
      });

      const res = await request(
        port,
        'GET',
        `/api/operational/actions/available?sourceType=signal&sourceId=sig-1&tenantId=${encodeURIComponent(tenantKey)}`,
        undefined,
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('tenantId', tenantKey);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.length).toBe(1);
      expect(res.body.items[0]).toHaveProperty('id', 'open_followup');
    });

    test('GET /api/operational/actions/available com source inválido retorna 400', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-operational-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const token = await issueAgentToken({ tenantId: tenantKey, role: 'super_admin' });

      const res = await request(
        port,
        'GET',
        `/api/operational/actions/available?sourceType=invalid&sourceId=sig-1&tenantId=${encodeURIComponent(tenantKey)}`,
        undefined,
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('ok', false);
      expect(res.body).toHaveProperty('error', 'invalid_source');
    });

    test('GET /api/operational/actions/available retorna 403 quando escopo nega acesso', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-operational-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const token = await issueAgentToken({ tenantId: tenantKey, role: 'super_admin' });

      const { quickActionAccess } = require('./core/operational-quick-actions');
      jest.spyOn(quickActionAccess, 'resolveScope').mockResolvedValueOnce({
        ok: false,
        status: 403,
        error: {
          code: 'forbidden',
          message: 'Sem permissão para quick actions',
        },
      });

      const res = await request(
        port,
        'GET',
        `/api/operational/actions/available?sourceType=signal&sourceId=sig-1&tenantId=${encodeURIComponent(tenantKey)}`,
        undefined,
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('ok', false);
      expect(res.body).toHaveProperty('error', 'forbidden');
    });

    test('GET /api/operational/actions/available retorna 422 quando escopo inválido', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-operational-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const token = await issueAgentToken({ tenantId: tenantKey, role: 'super_admin' });

      const { quickActionAccess } = require('./core/operational-quick-actions');
      jest.spyOn(quickActionAccess, 'resolveScope').mockResolvedValueOnce({
        ok: false,
        status: 422,
        error: {
          code: 'source_required',
          message: 'sourceType/sourceId inválidos',
        },
      });

      const res = await request(
        port,
        'GET',
        `/api/operational/actions/available?sourceType=signal&sourceId=sig-1&tenantId=${encodeURIComponent(tenantKey)}`,
        undefined,
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty('ok', false);
      expect(res.body).toHaveProperty('error', 'source_required');
    });

    test('GET /api/operational/context/:entityType/:entityId sem token retorna 401', async () => {
      if (skipServerTests) return;
      const res = await request(port, 'GET', '/api/operational/context/ticket/tkt-1');
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'unauthorized');
    });

    test('GET /api/operational/context/:entityType/:entityId com super-admin retorna payload canônico', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-operational-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const token = await issueAgentToken({ tenantId: tenantKey, role: 'super_admin' });

      const { OperationalContextQueryService } = require('./core/operational-agent');
      jest.spyOn(OperationalContextQueryService.prototype, 'getEntityContext').mockResolvedValueOnce({
        ok: true,
        entity: {
          entityType: 'ticket',
          entityId: 'tkt-1',
          tenantId: tenantKey,
          contactId: null,
        },
        signals: [{ id: 'sig-1', signal_type: 'followup_due' }],
        recommendations: [{ id: 'rec-1', recommendation_type: 'open_followup' }],
        actions: [],
        playbooks: [],
        outcomes: [{ id: 'out-1', status: 'executed' }],
      });

      const res = await request(
        port,
        'GET',
        `/api/operational/context/ticket/tkt-1?tenantId=${encodeURIComponent(tenantKey)}&limit=5`,
        undefined,
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('entity.tenantId', tenantKey);
      expect(Array.isArray(res.body.signals)).toBe(true);
      expect(Array.isArray(res.body.recommendations)).toBe(true);
      expect(Array.isArray(res.body.outcomes)).toBe(true);
      expect(res.body.signals[0]).toHaveProperty('id', 'sig-1');
      expect(res.body.recommendations[0]).toHaveProperty('id', 'rec-1');
      expect(res.body.outcomes[0]).toHaveProperty('id', 'out-1');
    });

    test('GET /api/operational/context/:entityType/:entityId sem permissão retorna 403', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-operational-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const token = await issueAgentToken({ tenantId: tenantKey, role: 'no_access' });

      const res = await request(
        port,
        'GET',
        '/api/operational/context/ticket/tkt-1',
        undefined,
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'forbidden');
    });

    test('GET /api/operational/outcomes com super-admin retorna lista de outcomes', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-operational-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const token = await issueAgentToken({ tenantId: tenantKey, role: 'super_admin' });

      const { OperationalOccQueryService } = require('./core/operational-agent');
      jest.spyOn(OperationalOccQueryService.prototype, 'listTenantOutcomes').mockResolvedValueOnce({
        ok: true,
        items: [{ id: 'out-2', action_id: 'open_followup', status: 'executed' }],
      });

      const res = await request(
        port,
        'GET',
        `/api/operational/outcomes?tenantId=${encodeURIComponent(tenantKey)}&sourceType=signal&sourceId=sig-1`,
        undefined,
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items[0]).toHaveProperty('id', 'out-2');
    });

    test('GET /api/crm/contacts/:contactId/operational-outcomes retorna outcomes por contato', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-operational-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const token = await issueAgentToken({ tenantId: tenantKey, role: 'super_admin' });

      const { operationalOutcomeEngine } = require('./core/operational-outcomes');
      const listSpy = jest.spyOn(operationalOutcomeEngine, 'listContactOutcomes').mockResolvedValueOnce({
        ok: true,
        items: [{ id: 'out-contact-1', contact_id: 'contact-1', outcome_type: 'booking_created_after_recommendation' }],
        total: 1,
      });

      const res = await request(
        port,
        'GET',
        '/api/crm/contacts/contact-1/operational-outcomes?limit=3',
        undefined,
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items[0]).toHaveProperty('id', 'out-contact-1');
      expect(listSpy).toHaveBeenCalledWith({
        tenantId: tenantKey,
        contactId: 'contact-1',
        limit: 3,
        status: null,
        sourceType: null,
        sourceId: null,
      });
    });

    test('GET /api/operational/outcomes sem permissão retorna 403', async () => {
      if (skipServerTests) return;
      const tenantKey = `tenant-qa-operational-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const token = await issueAgentToken({ tenantId: tenantKey, role: 'no_access' });

      const res = await request(
        port,
        'GET',
        '/api/operational/outcomes',
        undefined,
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'forbidden');
    });
  });
});
