#!/usr/bin/env node
/**
 * Script para testar o endpoint de limpeza de cache de rate limiting.
 */

const http = require('http');
const config = require('../api/utils/config');

const API_PORT = Number(config.get('api.port', 3000));
const API_HOST = config.get('api.host', 'localhost');

function testClearCache() {
  return new Promise((resolve, reject) => {
    console.log(`🔍 Testando endpoint: http://${API_HOST}:${API_PORT}/admin/rate-limit/clear-cache`);
    
    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path: '/admin/rate-limit/clear-cache',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          console.log(`📊 Status Code: ${res.statusCode}`);
          console.log(`📦 Resposta:`, JSON.stringify(result, null, 2));
          
          if (res.statusCode === 200 && result.success) {
            console.log('✅ Teste PASSOU: Endpoint está funcionando corretamente!');
            resolve({ success: true, result });
          } else {
            console.log('❌ Teste FALHOU: Resposta inesperada');
            reject(new Error(`Status ${res.statusCode}: ${result.message || 'Erro desconhecido'}`));
          }
        } catch (err) {
          console.error('❌ Erro ao processar resposta:', err.message);
          console.log('📦 Resposta raw:', data);
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        console.error(`❌ Erro: Não foi possível conectar ao servidor em ${API_HOST}:${API_PORT}`);
        console.error('   Certifique-se de que o servidor está rodando.');
        console.error('   Execute: npm start ou npm run dev:api');
      } else {
        console.error(`❌ Erro ao fazer requisição:`, err.message);
      }
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      console.error('❌ Timeout: Servidor não respondeu em 5 segundos');
      reject(new Error('Timeout'));
    });

    req.end();
  });
}

// Executa teste
console.log('🧪 Iniciando teste do endpoint de limpeza de cache...\n');
testClearCache()
  .then(() => {
    console.log('\n✅ Todos os testes passaram!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Teste falhou:', err.message);
    process.exit(1);
  });

