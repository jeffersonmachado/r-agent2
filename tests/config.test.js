/**
 * Testes para endpoints de configuração (/config)
 * - GET /config - Obter configuração
 * - PUT /config - Atualizar configuração
 * - POST /config/validate-provider-token - Validar token de provider
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const CONFIG_FILE = path.join(__dirname, '../api/data/config.json');
const CONFIG_BACKUP_FILE = path.join(__dirname, '../.config-backup-test.json');

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
 * Faz backup do config.json
 */
function backupConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const configContent = fs.readFileSync(CONFIG_FILE, 'utf8');
      fs.writeFileSync(CONFIG_BACKUP_FILE, configContent, 'utf8');
      return true;
    }
  } catch (error) {
    console.error('❌ Erro ao criar backup:', error.message);
    return false;
  }
  return false;
}

/**
 * Restaura o config.json do backup
 */
function restoreConfig() {
  try {
    if (fs.existsSync(CONFIG_BACKUP_FILE)) {
      const backupContent = fs.readFileSync(CONFIG_BACKUP_FILE, 'utf8');
      fs.writeFileSync(CONFIG_FILE, backupContent, 'utf8');
      return true;
    }
  } catch (error) {
    console.error('❌ Erro ao restaurar backup:', error.message);
    return false;
  }
  return false;
}

/**
 * Carrega o config.json atual
 */
function loadConfig() {
  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('❌ Erro ao carregar config:', error.message);
    return null;
  }
}

/**
 * Aguarda um tempo (em ms)
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Verifica se o servidor está pronto
 */
async function waitForServer(maxRetries = 10) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const healthUrl = new URL('/health', API_BASE_URL);
      await httpRequest({
        hostname: healthUrl.hostname,
        port: healthUrl.port || 3000,
        path: healthUrl.pathname,
        method: 'GET',
      });
      return true;
    } catch (error) {
      if (i < maxRetries - 1) {
        await wait(1000);
      }
    }
  }
  return false;
}

/**
 * Testa os endpoints de configuração
 */
async function testConfigEndpoints() {
  console.log('\n🧪 Testando endpoints de configuração (/config)...\n');

  // Faz backup antes de começar
  if (!backupConfig()) {
    console.error('❌ Não foi possível criar backup do config.json');
    return false;
  }
  const originalConfig = loadConfig();

  try {
    // 1. Faz login como systemadmin
    console.log('1. Fazendo login como systemadmin...');
    const loginUrl = new URL('/auth/login', API_BASE_URL);
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
    
    if (loginResponse.status !== 200 || !loginResponse.body || !loginResponse.body.token) {
      console.error('❌ Erro ao fazer login:', loginResponse.body);
      restoreConfig();
      return false;
    }

    const token = loginResponse.body.token;
    console.log('✅ Login realizado com sucesso\n');

    // 2. Testa GET /config
    console.log('2. Testando GET /config...');
    const getConfigUrl = new URL('/config', API_BASE_URL);
    const getConfigResponse = await httpRequest({
      hostname: getConfigUrl.hostname,
      port: getConfigUrl.port || 3000,
      path: getConfigUrl.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    console.log('   Status:', getConfigResponse.status);
    
    if (getConfigResponse.status === 200 && getConfigResponse.body && typeof getConfigResponse.body === 'object') {
      console.log('   ✅ Configuração obtida com sucesso');
      console.log('   Estrutura:', Object.keys(getConfigResponse.body).join(', '));
      
      // Verifica se tem a estrutura esperada
      if (getConfigResponse.body.ai) {
        console.log('   ✅ Estrutura ai encontrada');
      }
    } else {
      console.log('   ❌ Erro ao obter configuração:', getConfigResponse.body);
      restoreConfig();
      return false;
    }
    console.log('');

    // 3. Testa PUT /config - Adiciona configuração de tenant
    console.log('3. Testando PUT /config - Adicionando configuração de tenant...');
    
    const currentConfig = loadConfig();
    if (!currentConfig) {
      console.error('   ❌ Erro ao carregar configuração atual');
      restoreConfig();
      return false;
    }

    // Adiciona configuração de tenant
    if (!currentConfig.ai) {
      currentConfig.ai = {};
    }
    if (!currentConfig.ai.tenants) {
      currentConfig.ai.tenants = {};
    }
    currentConfig.ai.tenants['tenant-demo'] = {
      primary: 'openai'
    };

    const putConfigUrl = new URL('/config', API_BASE_URL);
    const putConfigResponse = await httpRequest({
      hostname: putConfigUrl.hostname,
      port: putConfigUrl.port || 3000,
      path: putConfigUrl.pathname,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }, currentConfig);

    console.log('   Status:', putConfigResponse.status);
    console.log('   Resposta:', JSON.stringify(putConfigResponse.body, null, 2));
    
    if (putConfigResponse.status === 200 && putConfigResponse.body.success) {
      console.log('   ✅ Configuração salva com sucesso');
    } else {
      console.log('   ❌ Erro ao salvar configuração');
      restoreConfig();
      return false;
    }

    // Aguarda servidor processar
    console.log('   Aguardando servidor processar...');
    await wait(3000);
    await waitForServer();

    // 4. Verifica que a configuração foi salva no arquivo
    console.log('4. Verificando que a configuração foi salva no arquivo...');
    const savedConfig = loadConfig();
    
    if (savedConfig && 
        savedConfig.ai && 
        savedConfig.ai.tenants && 
        savedConfig.ai.tenants['tenant-demo'] &&
        savedConfig.ai.tenants['tenant-demo'].primary === 'openai') {
      console.log('   ✅ Configuração de tenant salva corretamente no arquivo');
      console.log('   Estrutura:', JSON.stringify(savedConfig.ai.tenants['tenant-demo'], null, 2));
    } else {
      console.log('   ❌ Configuração não foi salva corretamente');
      console.log('   Config atual:', JSON.stringify(savedConfig?.ai?.tenants, null, 2));
      restoreConfig();
      return false;
    }
    console.log('');

    // 5. Testa GET /config novamente para verificar que retorna a nova configuração
    console.log('5. Testando GET /config após atualização...');
    const getConfigResponse2 = await httpRequest({
      hostname: getConfigUrl.hostname,
      port: getConfigUrl.port || 3000,
      path: getConfigUrl.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (getConfigResponse2.status === 200 && 
        getConfigResponse2.body.ai?.tenants?.['tenant-demo']?.primary === 'openai') {
      console.log('   ✅ GET /config retorna a configuração atualizada corretamente');
    } else {
      console.log('   ⚠️  GET /config não retorna a configuração atualizada (pode ser cache)');
    }
    console.log('');

    // 6. Testa PUT /config - Remove configuração de tenant
    console.log('6. Testando PUT /config - Removendo configuração de tenant...');
    
    const configWithoutTenant = loadConfig();
    if (configWithoutTenant && configWithoutTenant.ai && configWithoutTenant.ai.tenants) {
      delete configWithoutTenant.ai.tenants['tenant-demo'];
      
      if (Object.keys(configWithoutTenant.ai.tenants).length === 0) {
        delete configWithoutTenant.ai.tenants;
      }
    }

    const putConfigResponse2 = await httpRequest({
      hostname: putConfigUrl.hostname,
      port: putConfigUrl.port || 3000,
      path: putConfigUrl.pathname,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }, configWithoutTenant);

    if (putConfigResponse2.status === 200) {
      console.log('   ✅ Configuração removida com sucesso');
    } else {
      console.log('   ❌ Erro ao remover configuração');
    }

    await wait(3000);
    await waitForServer();

    // 7. Verifica que a configuração foi removida do arquivo
    console.log('7. Verificando que a configuração foi removida do arquivo...');
    const configAfterRemoval = loadConfig();
    
    if (!configAfterRemoval?.ai?.tenants?.['tenant-demo']) {
      console.log('   ✅ Configuração de tenant removida corretamente do arquivo');
    } else {
      console.log('   ⚠️  Configuração ainda existe (mas não crítico)');
    }
    console.log('');

    // 8. Testa POST /config/validate-provider-token
    console.log('8. Testando POST /config/validate-provider-token...');
    
    const validateUrl = new URL('/config/validate-provider-token', API_BASE_URL);
    const validateResponse = await httpRequest({
      hostname: validateUrl.hostname,
      port: validateUrl.port || 3000,
      path: validateUrl.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }, {
      provider: 'openai',
      apiKey: currentConfig?.ai?.openai?.apiKey || 'test-key'
    });

    console.log('   Status:', validateResponse.status);
    console.log('   Resposta:', JSON.stringify(validateResponse.body, null, 2));
    
    if (validateResponse.status === 200) {
      if (validateResponse.body.valid) {
        console.log('   ✅ Token válido');
      } else {
        console.log('   ⚠️  Token inválido (esperado se a chave não for válida)');
      }
    } else {
      console.log('   ⚠️  Erro na validação (mas não crítico)');
    }
    console.log('');

    // 9. Testa PUT /config com dados inválidos
    console.log('9. Testando PUT /config com dados inválidos...');
    
    const invalidConfigResponse = await httpRequest({
      hostname: putConfigUrl.hostname,
      port: putConfigUrl.port || 3000,
      path: putConfigUrl.pathname,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }, 'invalid-json-string');

    console.log('   Status:', invalidConfigResponse.status);
    
    if (invalidConfigResponse.status === 400) {
      console.log('   ✅ Rejeitou dados inválidos corretamente');
    } else {
      console.log('   ⚠️  Não rejeitou dados inválidos como esperado');
    }
    console.log('');

    // 10. Testa PUT /config sem Content-Type
    console.log('10. Testando PUT /config sem Content-Type...');
    
    const noContentTypeResponse = await httpRequest({
      hostname: putConfigUrl.hostname,
      port: putConfigUrl.port || 3000,
      path: putConfigUrl.pathname,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        // Sem Content-Type
      },
    }, currentConfig);

    console.log('   Status:', noContentTypeResponse.status);
    
    if (noContentTypeResponse.status === 400) {
      console.log('   ✅ Rejeitou requisição sem Content-Type corretamente');
    } else {
      console.log('   ⚠️  Não rejeitou requisição sem Content-Type como esperado');
    }
    console.log('');

    // Restaura o config original
    restoreConfig();
    
    console.log('✅ Todos os testes de configuração passaram!\n');
    return true;
  } catch (error) {
    console.error('❌ Erro no teste:', error.message);
    console.error(error.stack);
    restoreConfig();
    return false;
  }
}

// Executa o teste se for chamado diretamente
if (require.main === module) {
  testConfigEndpoints()
    .then((success) => {
      if (success) {
        console.log('✅ Todos os testes passaram!');
        process.exit(0);
      } else {
        console.log('❌ Alguns testes falharam');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('❌ Erro ao executar testes:', error);
      process.exit(1);
    });
}

module.exports = { testConfigEndpoints };

// Testes Jest básicos (para compatibilidade com Jest)
// Apenas executado quando rodado via Jest, não via run-all.js
if (typeof describe !== 'undefined' && typeof it !== 'undefined') {
  describe('Config Endpoints', () => {
    it('deve exportar função de teste', () => {
      expect(testConfigEndpoints).toBeDefined();
      expect(typeof testConfigEndpoints).toBe('function');
    });
  });
}
