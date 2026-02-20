#!/usr/bin/env node

/**
 * Teste de Endpoints de Mensagens Falhadas
 * Valida os endpoints /api/support/dashboard e /api/support/failed-messages
 */

const http = require('http');

const API_HOST = 'localhost';
const API_PORT = 3001;
const TIMEOUT = 5000;

let testsPassed = 0;
let testsFailed = 0;

// Cores para output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function testRequest(method, path, headers = {}, timeout = TIMEOUT) {
  return new Promise((resolve) => {
    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...headers,
      },
      timeout,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null,
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data,
            parseError: true,
          });
        }
      });
    });

    req.on('error', (err) => {
      resolve({
        error: err.message,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        error: 'Request timeout',
      });
    });

    req.end();
  });
}

async function test(name, fn) {
  try {
    process.stdout.write(`${colors.blue}⏳ ${name}... ${colors.reset}`);
    await fn();
    log('green', '✅ PASSOU');
    testsPassed++;
  } catch (err) {
    log('red', `❌ FALHOU: ${err.message}`);
    testsFailed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runTests() {
  log('blue', '\n╔════════════════════════════════════════════════════════════╗');
  log('blue', '║     TESTE DE ENDPOINTS DE MENSAGENS FALHADAS              ║');
  log('blue', '╚════════════════════════════════════════════════════════════╝\n');

  // Teste 1: Health Check
  await test('1. Health check do servidor', async () => {
    const res = await testRequest('GET', '/health');
    assert(!res.error, `Servidor não respondeu: ${res.error}`);
    assert(res.status === 200, `Status esperado 200, recebido ${res.status}`);
    assert(res.body?.status === 'ok', 'Status do health check não é "ok"');
  });

  // Teste 2: Endpoint sem autenticação (deve retornar 401)
  await test('2. GET /api/support/dashboard sem token (401)', async () => {
    const res = await testRequest('GET', '/api/support/dashboard');
    assert(!res.error, `Erro de conexão: ${res.error}`);
    assert(res.status === 401, `Status esperado 401, recebido ${res.status}`);
  });

  // Teste 3: Endpoint sem autenticação (deve retornar 401)
  await test('3. GET /api/support/failed-messages sem token (401)', async () => {
    const res = await testRequest('GET', '/api/support/failed-messages');
    assert(!res.error, `Erro de conexão: ${res.error}`);
    assert(res.status === 401, `Status esperado 401, recebido ${res.status}`);
  });

  // Teste 4: Login para obter token
  let authToken = null;
  await test('4. Obter token de autenticação', async () => {
    // Tenta login com credenciais padrão
    const body = JSON.stringify({
      username: 'admin',
      password: 'admin',
    });

    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path: '/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': body.length,
      },
      timeout: TIMEOUT,
    };

    const res = await new Promise((resolve) => {
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode,
              body: JSON.parse(data),
            });
          } catch (e) {
            resolve({
              status: res.statusCode,
              body: data,
            });
          }
        });
      });

      req.on('error', (err) => {
        resolve({ error: err.message });
      });

      req.end(body);
    });

    // Se login falhar, log mas não falha o teste
    if (res.status === 401) {
      log('yellow', '⚠️  Login com credenciais padrão falhou (use token do navegador)');
      authToken = process.env.AUTH_TOKEN || null;
      if (!authToken) {
        throw new Error('AuthToken não fornecido via ENV ou login falhou. Use: AUTH_TOKEN=seu_token node test-failed-messages.js');
      }
    } else {
      assert(res.body?.token, 'Token não retornado');
      authToken = res.body.token;
    }
  });

  // Teste 5: Endpoint com autenticação
  if (authToken) {
    await test('5. GET /api/support/dashboard com token (200)', async () => {
      const res = await testRequest('GET', '/api/support/dashboard', {
        'Authorization': `Bearer ${authToken}`,
      });
      assert(!res.error, `Erro de conexão: ${res.error}`);
      assert(res.status === 200, `Status esperado 200, recebido ${res.status}`);
      assert(res.body, 'Corpo da resposta vazio');
      assert(typeof res.body.outboundPendingCount === 'number', 'outboundPendingCount não é número');
      assert(typeof res.body.outboundFailedCount === 'number', 'outboundFailedCount não é número');
      assert(Array.isArray(res.body.recentErrors), 'recentErrors não é array');
    });

    await test('6. GET /api/support/failed-messages com token (200)', async () => {
      const res = await testRequest('GET', '/api/support/failed-messages?limit=10&offset=0', {
        'Authorization': `Bearer ${authToken}`,
      });
      assert(!res.error, `Erro de conexão: ${res.error}`);
      assert(res.status === 200, `Status esperado 200, recebido ${res.status}`);
      assert(res.body, 'Corpo da resposta vazio');
      assert(Array.isArray(res.body.messages), 'messages não é array');
      assert(typeof res.body.total === 'number', 'total não é número');
      assert(typeof res.body.limit === 'number', 'limit não é número');
      assert(typeof res.body.offset === 'number', 'offset não é número');
    });

    await test('7. Filtro por canal (WhatsApp)', async () => {
      const res = await testRequest('GET', '/api/support/failed-messages?channel=whatsapp&limit=10', {
        'Authorization': `Bearer ${authToken}`,
      });
      assert(!res.error, `Erro de conexão: ${res.error}`);
      assert(res.status === 200, `Status esperado 200, recebido ${res.status}`);
      assert(Array.isArray(res.body.messages), 'messages não é array');
    });

    await test('8. Filtro por status (pending)', async () => {
      const res = await testRequest('GET', '/api/support/failed-messages?status=pending&limit=10', {
        'Authorization': `Bearer ${authToken}`,
      });
      assert(!res.error, `Erro de conexão: ${res.error}`);
      assert(res.status === 200, `Status esperado 200, recebido ${res.status}`);
      assert(Array.isArray(res.body.messages), 'messages não é array');
    });

    await test('9. Ordenação por attempts', async () => {
      const res = await testRequest('GET', '/api/support/failed-messages?sortBy=attempts&limit=10', {
        'Authorization': `Bearer ${authToken}`,
      });
      assert(!res.error, `Erro de conexão: ${res.error}`);
      assert(res.status === 200, `Status esperado 200, recebido ${res.status}`);
      assert(Array.isArray(res.body.messages), 'messages não é array');
    });

    await test('10. Paginação (offset=10)', async () => {
      const res = await testRequest('GET', '/api/support/failed-messages?limit=10&offset=10', {
        'Authorization': `Bearer ${authToken}`,
      });
      assert(!res.error, `Erro de conexão: ${res.error}`);
      assert(res.status === 200, `Status esperado 200, recebido ${res.status}`);
      assert(res.body.offset === 10, 'offset não corresponde ao esperado');
      assert(res.body.page === 2, 'page não é 2');
    });
  }

  // Resultado final
  log('blue', '\n╔════════════════════════════════════════════════════════════╗');
  log('blue', '║                    RESULTADO DOS TESTES                    ║');
  log('blue', '╚════════════════════════════════════════════════════════════╝\n');

  log('green', `✅ PASSOU: ${testsPassed}`);
  if (testsFailed > 0) {
    log('red', `❌ FALHOU: ${testsFailed}`);
  }

  const total = testsPassed + testsFailed;
  const percentage = Math.round((testsPassed / total) * 100);
  log('blue', `\n📊 Taxa de sucesso: ${percentage}% (${testsPassed}/${total})`);

  if (testsFailed === 0) {
    log('green', '\n🎉 TODOS OS TESTES PASSARAM!\n');
  } else {
    log('red', `\n⚠️  ${testsFailed} TESTE(S) FALHOU(RAM)\n`);
  }

  process.exit(testsFailed > 0 ? 1 : 0);
}

// Executar testes
runTests().catch((err) => {
  log('red', `Erro ao executar testes: ${err.message}`);
  process.exit(1);
});
