const http = require('http');

/**
 * Helper para fazer requisições HTTP simples contra o servidor em teste.
 *
 * @param {number} port
 * @param {string} method
 * @param {string} path
 * @param {any} [body]
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, body: any }>}
 */
function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload =
      body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers:
          payload != null
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {},
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

describe('POST /system/generate-and-validate (tenant safe-mode)', () => {
  /** @type {http.Server} */
  let server;
  let port;
  let skipTenantSafeModeTests = false;

  beforeAll((done) => {
    process.env.NODE_ENV = 'development';
    // O modo legado sem auth agora é opt-in explícito (default é estrito);
    // este teste exercita justamente o comportamento desse modo.
    process.env.STRICT_TENANT_MODE = 'false';

    jest.resetModules();

    const aiProviderServicePath = require.resolve('../services/aiProviderService');
    const aiProviderManagerPath = require.resolve('../services/aiProviderManager.js');
    const generateAndValidatePath = require.resolve('../services/generate-and-validate');

    // Evita dependência real de provider
    jest.doMock(aiProviderServicePath, () => ({
      ensureTenantAiConfigLoaded: async () => {},
    }));
    jest.doMock(aiProviderManagerPath, () => ({
      getAiProviderForTenant: () => ({ name: 'mock-provider' }),
    }));

    // Mock do generateAndValidate para simular "falha não-crítica" em tenantPipeline
    jest.doMock(generateAndValidatePath, () => ({
      generateAndValidate: async () => ({
        success: false,
        executionId: 'exec-mock-1',
        errors: ['MISSING_FALLBACK_NODE'],
        warnings: [],
        motivo: 'Pipeline abortado (mock)',
        rpaPassed: false,
      }),
    }));

    // eslint-disable-next-line global-require
    const { createServer } = require('../server');
    server = createServer();
    const onError = (error) => {
      if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
        skipTenantSafeModeTests = true;
        done();
        return;
      }
      done(error);
    };
    server.once('error', onError);
    try {
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError);
        const address = server.address();
        port = address && typeof address === 'object' ? address.port : 0;
        done();
      });
    } catch (error) {
      server.off('error', onError);
      if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
        skipTenantSafeModeTests = true;
        done();
        return;
      }
      done(error);
    }
  });

  afterAll((done) => {
    delete process.env.STRICT_TENANT_MODE;
    if (!server || !server.listening) {
      done();
      return;
    }
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    server.close(() => done());
  });

  test('tenantPipeline=true deve retornar 207 com success:true e warnings (não 409)', async () => {
    if (skipTenantSafeModeTests) return;
    const res = await request(port, 'POST', '/system/generate-and-validate', {
      tenantId: 'tenant-demo',
      tenantPipeline: true,
      useRag: false,
      name: 'Sistema Teste',
      description: 'Descrição de teste',
      executionMode: 'bootstrap',
    });

    expect(res.status).toBe(207);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('tenantSafeMode', true);
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(res.body.warnings.some((w) => w && w.type === 'TENANT_PIPELINE_NON_BLOCKING_ERROR')).toBe(true);
    expect(res.body).toHaveProperty('errors');
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.length).toBe(0);
  });
});
