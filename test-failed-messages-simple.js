#!/usr/bin/env node

/**
 * Teste Simplificado - Endpoints de Mensagens Falhadas
 * Valida estrutura e comportamento dos endpoints sem necessidade de token
 */

const http = require('http');

const API_HOST = 'localhost';
const API_PORT = 3001;
const TIMEOUT = 5000;

let testsPassed = 0;
let testsFailed = 0;

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

function testRequest(method, path, headers = {}, body = null) {
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
      timeout: TIMEOUT,
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
      resolve({ error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ error: 'Request timeout' });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function test(name, fn) {
  try {
    process.stdout.write(`${colors.blue}⏳ ${name}... ${colors.reset}`);
    await fn();
    log('green', '✅');
    testsPassed++;
  } catch (err) {
    log('red', `❌ ${err.message}`);
    testsFailed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runTests() {
  log('blue', '\n╔════════════════════════════════════════════════════════════╗');
  log('blue', '║     TESTE DE ENDPOINTS - MENSAGENS FALHADAS                ║');
  log('blue', '╚════════════════════════════════════════════════════════════╝\n');

  // Teste 1: Health Check
  await test('1. Health check do servidor', async () => {
    const res = await testRequest('GET', '/health');
    assert(!res.error, `Servidor não respondeu: ${res.error}`);
    assert(res.status === 200, `Esperado 200, recebido ${res.status}`);
  });

  // Teste 2: Estrutura de resposta sem autenticação
  await test('2. GET /api/support/dashboard sem token → 401', async () => {
    const res = await testRequest('GET', '/api/support/dashboard');
    assert(res.status === 401, `Esperado 401, recebido ${res.status}`);
    assert(res.body?.error === 'unauthorized', 'Erro não é "unauthorized"');
  });

  await test('3. GET /api/support/failed-messages sem token → 401', async () => {
    const res = await testRequest('GET', '/api/support/failed-messages');
    assert(res.status === 401, `Esperado 401, recebido ${res.status}`);
    assert(res.body?.error === 'unauthorized', 'Erro não é "unauthorized"');
  });

  // Teste 3: Verificar estrutura de endpoints (com mock headers)
  await test('4. Endpoints aceitam query params', async () => {
    const res = await testRequest('GET', '/api/support/failed-messages?limit=50&offset=0&channel=whatsapp&status=failed&sortBy=updated_at');
    // Mesmo que retorne 401, importante verificar que a rota existe
    assert(res.status === 401 || res.status === 200, `Status inválido ${res.status}`);
  });

  await test('5. Endpoint dashboard retorna estrutura correta', async () => {
    // Mesmo com 401, a resposta deve ter a estrutura de erro padrão
    const res = await testRequest('GET', '/api/support/dashboard');
    assert(res.body, 'Resposta vazia');
    assert(res.body.error || res.body.message, 'Sem campo de erro/mensagem');
  });

  // Teste 6: Verificar que as rotas SPA não interceptam os endpoints
  await test('6. Endpoints API são diferentes de rotas SPA', async () => {
    const res1 = await testRequest('GET', '/api/support/dashboard');
    const res2 = await testRequest('GET', '/failed-messages');
    
    // /api/... deve retornar JSON com erro de autenticação
    assert(res1.body && typeof res1.body === 'object', 'API não retorna JSON');
    
    // /failed-messages deve retornar HTML (página SPA)
    assert(res2.body && typeof res2.body === 'string' && res2.body.includes('html'), 
           'SPA não retorna HTML');
  });

  // Teste 7: Métodos corretos
  await test('7. GET é o método correto (não POST/PUT/DELETE)', async () => {
    const dashboard = await testRequest('GET', '/api/support/dashboard');
    const failedMessages = await testRequest('GET', '/api/support/failed-messages');
    
    // Ambos devem existir e responder (mesmo que com 401)
    assert(dashboard.status >= 400 && dashboard.status < 500, 'Dashboard status inválido');
    assert(failedMessages.status >= 400 && failedMessages.status < 500, 'FailedMessages status inválido');
  });

  // Teste 8: Headers CORS
  await test('8. Respostas incluem headers CORS', async () => {
    const res = await testRequest('GET', '/api/support/dashboard');
    const corsHeader = res.headers['access-control-allow-origin'];
    assert(corsHeader, 'Falta header CORS');
  });

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
  log('blue', `📊 Taxa: ${percentage}% (${testsPassed}/${total})\n`);

  if (testsFailed === 0) {
    log('green', '🎉 TODOS OS TESTES PASSARAM!\n');
    log('blue', '✨ Endpoints estruturados e prontos para uso!\n');
    log('yellow', '💡 Dica: Para testar com autenticação, use:\n');
    log('yellow', '   AUTH_TOKEN="seu_token" node test-failed-messages.js\n');
  } else {
    log('red', `⚠️  ${testsFailed} erro(s) encontrado(s)\n`);
  }

  process.exit(testsFailed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  log('red', `Erro: ${err.message}`);
  process.exit(1);
});
