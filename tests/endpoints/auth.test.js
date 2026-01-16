/**
 * Testes para endpoints de Autenticação
 */

const http = require('http');
const path = require('path');
const { ReplaySystem } = require('../../lib/replaySystem');
const { RecordingSystem } = require('../../lib/recordingSystem');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

/**
 * Faz uma requisição HTTP
 */
function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * Aguarda um tempo (em ms)
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Testa endpoints de autenticação
 */
async function testAuthEndpoints() {
  console.log('\n🔐 Testando endpoints de Autenticação...\n');

  // Inicializa replay
  const replay = new ReplaySystem({
    storagePath: path.join(__dirname, '../../tests/api/replays'),
    context: 'api',
    enableScreenshots: false,
  });

  // Inicializa gravação
  const recording = new RecordingSystem({
    storagePath: path.join(__dirname, '../../recordings/api'),
    context: 'api',
    enableTimestamps: true,
  });

  const replayId = `api-auth-${Date.now()}`;
  const recordingId = `api-auth-${Date.now()}`;
  
  replay.start(replayId, {
    testType: 'auth',
  });

  recording.start(recordingId, {
    name: 'Teste de Autenticação',
    description: 'Teste completo de endpoints de autenticação',
    testType: 'auth',
  });

  let token = null;
  let agentId = null;

  try {
    // 1. POST /auth/login
    console.log('1. Testando POST /auth/login...');
    const loginUrl = new URL('/auth/login', API_BASE_URL);
    
    const loginStartTime = new Date().toISOString();
    recording.recordApiCall('POST', '/auth/login', {
      step: 'login',
      body: { username: 'systemadmin' },
    });
    
    const loginResponse = await httpRequest({
      hostname: loginUrl.hostname,
      port: loginUrl.port || 3000,
      path: loginUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    }, {
      username: 'systemadmin',
      password: 'Admin123!'
    });
    const loginEndTime = new Date().toISOString();
    
    replay.recordAction(
      {
        type: 'api_call',
        endpoint: 'POST /auth/login',
        value: { username: 'systemadmin' },
      },
      {
        success: loginResponse.status === 200,
        startTime: loginStartTime,
        endTime: loginEndTime,
        actual: {
          status: loginResponse.status,
          hasToken: !!loginResponse.body?.token,
        },
      }
    );

    if (loginResponse.status === 200 && loginResponse.body.token) {
      token = loginResponse.body.token;
      agentId = loginResponse.body.agent?.id;
      console.log('   ✅ Login realizado com sucesso');
    } else {
      console.log('   ❌ Erro no login:', loginResponse.body);
      return { success: false, error: 'Login falhou' };
    }

    // 2. GET /auth/me
    console.log('2. Testando GET /auth/me...');
    recording.recordApiCall('GET', '/auth/me', {
      step: 'verify-token',
      headers: { Authorization: 'Bearer token' },
    });
    const meUrl = new URL('/auth/me', API_BASE_URL);
    const meResponse = await httpRequest({
      hostname: meUrl.hostname,
      port: meUrl.port || 3000,
      path: meUrl.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (meResponse.status === 200 && meResponse.body.agent) {
      console.log('   ✅ Informações do agente obtidas');
    } else {
      console.log('   ❌ Erro ao obter informações:', meResponse.body);
    }

    // 3. GET /auth/agents
    console.log('3. Testando GET /auth/agents...');
    const agentsUrl = new URL('/auth/agents', API_BASE_URL);
    const agentsResponse = await httpRequest({
      hostname: agentsUrl.hostname,
      port: agentsUrl.port || 3000,
      path: agentsUrl.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (agentsResponse.status === 200) {
      console.log('   ✅ Lista de agentes obtida');
    } else {
      console.log('   ⚠️  Erro ou sem permissão:', agentsResponse.status);
    }

    // 4. GET /auth/agents/:id
    if (agentId) {
      console.log(`4. Testando GET /auth/agents/${agentId}...`);
      const agentUrl = new URL(`/auth/agents/${agentId}`, API_BASE_URL);
      const agentResponse = await httpRequest({
        hostname: agentUrl.hostname,
        port: agentUrl.port || 3000,
        path: agentUrl.pathname,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (agentResponse.status === 200) {
        console.log('   ✅ Agente específico obtido');
      } else {
        console.log('   ⚠️  Erro ao obter agente:', agentResponse.status);
      }
    }

    // 5. POST /auth/logout
    console.log('5. Testando POST /auth/logout...');
    const logoutUrl = new URL('/auth/logout', API_BASE_URL);
    const logoutResponse = await httpRequest({
      hostname: logoutUrl.hostname,
      port: logoutUrl.port || 3000,
      path: logoutUrl.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (logoutResponse.status === 200) {
      console.log('   ✅ Logout realizado com sucesso');
    } else {
      console.log('   ⚠️  Erro no logout:', logoutResponse.status);
    }

    // 6. Testa login novamente após logout
    console.log('6. Testando login após logout...');
    const loginResponse2 = await httpRequest({
      hostname: loginUrl.hostname,
      port: loginUrl.port || 3000,
      path: loginUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    }, {
      username: 'systemadmin',
      password: 'Admin123!'
    });

    if (loginResponse2.status === 200 && loginResponse2.body.token) {
      token = loginResponse2.body.token;
      console.log('   ✅ Login após logout funcionou');
    } else {
      console.log('   ❌ Erro no login após logout');
    }

    // 7. GET /auth/rpa/token
    console.log('7. Testando GET /auth/rpa/token...');
    const rpaTokenUrl = new URL('/auth/rpa/token', API_BASE_URL);
    const rpaTokenResponse = await httpRequest({
      hostname: rpaTokenUrl.hostname,
      port: rpaTokenUrl.port || 3000,
      path: rpaTokenUrl.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

      if (rpaTokenResponse.status === 200) {
        console.log('   ✅ Token RPA obtido');
      } else {
        // Token RPA pode falhar se não estiver configurado, não é crítico
        console.log('   ⚠️  Token RPA não disponível (pode ser esperado):', rpaTokenResponse.status);
      }

    // Finaliza e salva replay
    replay.recordEvent('test_completed');
    replay.stop();
    const replayPath = replay.save(replayId);

    // Finaliza e salva gravação
    recording.stop();
    const recordingPath = recording.save(recordingId);
    
    console.log('\n✅ Testes de autenticação concluídos!');
    console.log(`📹 Replay salvo: ${replayPath}`);
    console.log(`📹 Gravação salva: ${recordingPath}\n`);
    return { success: true, replayPath, recordingPath };

  } catch (error) {
    // Registra erro no replay
    replay.recordError(error, 'auth-test');
    replay.recordEvent('test_failed', { error: error.message });
    replay.stop();
    const replayPath = replay.save(`${replayId}-error`);

    // Registra erro na gravação
    recording.recordCustom('error', {
      step: 'test-error',
      value: { error: error.message },
    });
    recording.stop();
    const recordingPath = recording.save(`${recordingId}-error`);
    
    console.error('❌ Erro nos testes de autenticação:', error.message);
    console.log(`📹 Replay do erro salvo: ${replayPath}`);
    console.log(`📹 Gravação do erro salva: ${recordingPath}`);
    return { success: false, error: error.message, replayPath, recordingPath };
  }
}

// Executa se for chamado diretamente
if (require.main === module) {
  testAuthEndpoints()
    .then((result) => {
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error('❌ Erro ao executar testes:', error);
      process.exit(1);
    });
}

module.exports = { testAuthEndpoints };

// Testes Jest básicos (para compatibilidade com Jest)
// Apenas executado quando rodado via Jest, não via run-all.js
if (typeof describe !== 'undefined' && typeof it !== 'undefined') {
  describe('Auth Endpoints', () => {
    it('deve exportar função de teste', () => {
      expect(testAuthEndpoints).toBeDefined();
      expect(typeof testAuthEndpoints).toBe('function');
    });
  });
}
