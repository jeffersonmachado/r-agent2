/**
 * Testes para endpoints de Tenants
 */

const http = require('http');

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
 * Testa endpoints de tenants
 */
async function testTenantsEndpoints() {
  console.log('\n🏢 Testando endpoints de Tenants...\n');

  let token = null;
  let tenantId = 'tenant-demo';

  try {
    // 1. Login
    console.log('1. Fazendo login...');
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

    if (loginResponse.status !== 200 || !loginResponse.body.token) {
      console.log('   ❌ Erro no login');
      return { success: false, error: 'Login falhou' };
    }

    token = loginResponse.body.token;
    console.log('   ✅ Login realizado\n');

    // 2. GET /tenants
    console.log('2. Testando GET /tenants...');
    const tenantsUrl = new URL('/tenants', API_BASE_URL);
    const tenantsResponse = await httpRequest({
      hostname: tenantsUrl.hostname,
      port: tenantsUrl.port || 3000,
      path: tenantsUrl.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (tenantsResponse.status === 200) {
      if (Array.isArray(tenantsResponse.body)) {
        console.log(`   ✅ Lista de tenants obtida (${tenantsResponse.body.length} tenants)`);
        if (tenantsResponse.body.length > 0 && !tenantId) {
          tenantId = tenantsResponse.body[0].id;
        }
      } else {
        console.log('   ✅ Resposta obtida (formato não array)');
      }
    } else {
      console.log('   ⚠️  Erro ou sem permissão:', tenantsResponse.status);
    }

    // 3. GET /tenants/:id
    if (tenantId) {
      console.log(`3. Testando GET /tenants/${tenantId}...`);
      const tenantUrl = new URL(`/tenants/${tenantId}`, API_BASE_URL);
      const tenantResponse = await httpRequest({
        hostname: tenantUrl.hostname,
        port: tenantUrl.port || 3000,
        path: tenantUrl.pathname,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (tenantResponse.status === 200) {
        if (tenantResponse.body && tenantResponse.body.id) {
          console.log('   ✅ Tenant específico obtido');
        } else {
          console.log('   ✅ Resposta obtida (formato diferente)');
        }
      } else {
        console.log('   ⚠️  Erro ao obter tenant:', tenantResponse.status);
      }

      // 4. GET /tenants/:id/context
      console.log(`4. Testando GET /tenants/${tenantId}/context...`);
      const contextUrl = new URL(`/tenants/${tenantId}/context`, API_BASE_URL);
      const contextResponse = await httpRequest({
        hostname: contextUrl.hostname,
        port: contextUrl.port || 3000,
        path: contextUrl.pathname,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (contextResponse.status === 200) {
        console.log('   ✅ Contexto do tenant obtido');
      } else {
        console.log('   ⚠️  Erro ao obter contexto:', contextResponse.status);
      }

      // 5. GET /tenants/:id/usage
      console.log(`5. Testando GET /tenants/${tenantId}/usage...`);
      const usageUrl = new URL(`/tenants/${tenantId}/usage`, API_BASE_URL);
      const usageResponse = await httpRequest({
        hostname: usageUrl.hostname,
        port: usageUrl.port || 3000,
        path: usageUrl.pathname,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (usageResponse.status === 200) {
        console.log('   ✅ Métricas de uso obtidas');
      } else {
        console.log('   ⚠️  Erro ao obter métricas:', usageResponse.status);
      }

      // 6. GET /tenants/:id/ai-provider-status
      console.log(`6. Testando GET /tenants/${tenantId}/ai-provider-status...`);
      const aiStatusUrl = new URL(`/tenants/${tenantId}/ai-provider-status`, API_BASE_URL);
      const aiStatusResponse = await httpRequest({
        hostname: aiStatusUrl.hostname,
        port: aiStatusUrl.port || 3000,
        path: aiStatusUrl.pathname,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (aiStatusResponse.status === 200) {
        console.log('   ✅ Status de provider de IA obtido');
        console.log(`      hasValidProvider: ${aiStatusResponse.body.hasValidProvider}`);
      } else {
        console.log('   ⚠️  Erro ao obter status:', aiStatusResponse.status);
      }
    }

    // 7. GET /super-admin/tenants (se for super-admin)
    console.log('7. Testando GET /super-admin/tenants...');
    const superAdminUrl = new URL('/super-admin/tenants', API_BASE_URL);
    const superAdminResponse = await httpRequest({
      hostname: superAdminUrl.hostname,
      port: superAdminUrl.port || 3000,
      path: superAdminUrl.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (superAdminResponse.status === 200) {
      console.log('   ✅ Lista de todos os tenants (super-admin) obtida');
    } else {
      console.log('   ⚠️  Erro ou sem permissão de super-admin:', superAdminResponse.status);
    }

    console.log('\n✅ Testes de tenants concluídos!\n');
    return { success: true };

  } catch (error) {
    console.error('❌ Erro nos testes de tenants:', error.message);
    return { success: false, error: error.message };
  }
}

// Executa se for chamado diretamente
if (require.main === module) {
  testTenantsEndpoints()
    .then((result) => {
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error('❌ Erro ao executar testes:', error);
      process.exit(1);
    });
}

module.exports = { testTenantsEndpoints };
