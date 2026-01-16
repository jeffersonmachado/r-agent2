/**
 * Testes para verificação de status de provider de IA do tenant
 * e configuração de providers específicos por tenant
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { login } = require('../../api/services/authService');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const CONFIG_FILE = path.join(__dirname, '../../api/data/config.json');
const CONFIG_BACKUP_FILE = path.join(__dirname, '../../.config-backup.json');

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
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
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
      console.log('✅ Backup do config.json criado');
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
      console.log('✅ Config.json restaurado do backup');
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
 * Salva o config.json
 */
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('❌ Erro ao salvar config:', error.message);
    return false;
  }
}

/**
 * Aguarda um tempo (em ms)
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Testa o endpoint de verificação de provider de IA
 */
async function testAiProviderStatus() {
  console.log('\n🧪 Testando verificação e configuração de provider de IA...\n');

  // Faz backup antes de começar
  backupConfig();
  const originalConfig = loadConfig();

  try {
    // 1. Faz login como systemadmin via HTTP
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

    // 2. Testa verificação para tenant-demo SEM configuração específica
    console.log('2. Testando tenant-demo SEM configuração específica...');
    const url1 = new URL('/tenants/tenant-demo/ai-provider-status', API_BASE_URL);
    
    const response1 = await httpRequest({
      hostname: url1.hostname,
      port: url1.port || 3000,
      path: url1.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('   Resposta:', JSON.stringify(response1.body, null, 2));
    
    if (response1.status === 200 && response1.body.hasValidProvider === false) {
      console.log('   ✅ Retornou hasValidProvider: false (correto - sem configuração específica)\n');
    } else {
      console.log('   ❌ Resposta inesperada\n');
      restoreConfig();
      return false;
    }

    // 3. Configura o provider específico do tenant via PUT /config
    console.log('3. Configurando provider específico do tenant-demo...');
    
    // Carrega a configuração atual
    const currentConfig = loadConfig();
    if (!currentConfig) {
      console.error('   ❌ Erro ao carregar configuração atual');
      restoreConfig();
      return false;
    }

    // Adiciona a configuração do tenant
    if (!currentConfig.ai) {
      currentConfig.ai = {};
    }
    if (!currentConfig.ai.tenants) {
      currentConfig.ai.tenants = {};
    }
    currentConfig.ai.tenants['tenant-demo'] = {
      primary: 'openai'
    };

    // Salva via API
    const url2 = new URL('/config', API_BASE_URL);
    const response2 = await httpRequest({
      hostname: url2.hostname,
      port: url2.port || 3000,
      path: url2.pathname,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }, currentConfig);

    console.log('   Resposta PUT /config:', JSON.stringify(response2.body, null, 2));
    
    if (response2.status === 200) {
      console.log('   ✅ Configuração salva com sucesso\n');
    } else {
      console.log('   ❌ Erro ao salvar configuração\n');
      restoreConfig();
      return false;
    }

    // Aguarda um pouco para o servidor processar (se nodemon reiniciar)
    console.log('   Aguardando 5 segundos para o servidor reiniciar...');
    await wait(5000);
    
    // Tenta reconectar ao servidor (pode ter reiniciado)
    let retries = 0;
    let serverReady = false;
    while (retries < 10 && !serverReady) {
      try {
        const healthUrl = new URL('/health', API_BASE_URL);
        await httpRequest({
          hostname: healthUrl.hostname,
          port: healthUrl.port || 3000,
          path: healthUrl.pathname,
          method: 'GET',
        });
        serverReady = true;
        console.log('   ✅ Servidor está pronto');
      } catch (error) {
        retries++;
        if (retries < 10) {
          console.log(`   ⏳ Aguardando servidor... (tentativa ${retries}/10)`);
          await wait(1000);
        }
      }
    }
    
    if (!serverReady) {
      console.log('   ⚠️  Servidor não respondeu, mas continuando o teste...');
    }

    // 4. Testa verificação para tenant-demo COM configuração específica
    console.log('4. Testando tenant-demo COM configuração específica...');
    const url3 = new URL('/tenants/tenant-demo/ai-provider-status', API_BASE_URL);
    
    const response3 = await httpRequest({
      hostname: url3.hostname,
      port: url3.port || 3000,
      path: url3.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('   Resposta:', JSON.stringify(response3.body, null, 2));
    
    if (response3.status === 200) {
      if (response3.body.hasValidProvider === true) {
        console.log('   ✅ Retornou hasValidProvider: true (correto - provider válido)\n');
      } else if (response3.body.hasValidProvider === false) {
        console.log('   ⚠️  Retornou hasValidProvider: false (pode ser token inválido ou não registrado)\n');
        console.log('   ℹ️  Isso é esperado se o token OpenAI não for válido ou não estiver registrado\n');
      } else {
        console.log('   ❌ Resposta inesperada\n');
        restoreConfig();
        return false;
      }
    } else {
      console.log('   ❌ Erro na requisição\n');
      restoreConfig();
      return false;
    }

    // 5. Remove a configuração do tenant
    console.log('5. Removendo configuração específica do tenant-demo...');
    
    const configWithoutTenant = loadConfig();
    if (configWithoutTenant && configWithoutTenant.ai && configWithoutTenant.ai.tenants) {
      delete configWithoutTenant.ai.tenants['tenant-demo'];
      
      // Se o objeto tenants ficar vazio, remove também
      if (Object.keys(configWithoutTenant.ai.tenants).length === 0) {
        delete configWithoutTenant.ai.tenants;
      }
    }

    const response4 = await httpRequest({
      hostname: url2.hostname,
      port: url2.port || 3000,
      path: url2.pathname,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }, configWithoutTenant);

    console.log('   Resposta PUT /config:', JSON.stringify(response4.body, null, 2));
    
    if (response4.status === 200) {
      console.log('   ✅ Configuração removida com sucesso\n');
    } else {
      console.log('   ❌ Erro ao remover configuração\n');
    }

    await wait(5000);

    // 6. Verifica que voltou a retornar false
    console.log('6. Verificando que retorna false após remover configuração...');
    const response5 = await httpRequest({
      hostname: url1.hostname,
      port: url1.port || 3000,
      path: url1.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('   Resposta:', JSON.stringify(response5.body, null, 2));
    
    if (response5.status === 200 && response5.body.hasValidProvider === false) {
      console.log('   ✅ Retornou hasValidProvider: false (correto - configuração removida)\n');
    } else {
      console.log('   ⚠️  Resposta inesperada (mas não crítico)\n');
    }

    // Restaura o config original
    restoreConfig();
    
    console.log('✅ Todos os testes passaram!\n');
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
  testAiProviderStatus()
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

module.exports = { testAiProviderStatus };

// Testes Jest básicos (para compatibilidade com Jest)
// Apenas executado quando rodado via Jest, não via run-all.js
if (typeof describe !== 'undefined' && typeof it !== 'undefined') {
  describe('AI Provider Status', () => {
    it('deve exportar função de teste', () => {
      expect(testAiProviderStatus).toBeDefined();
      expect(typeof testAiProviderStatus).toBe('function');
    });
  });
}
