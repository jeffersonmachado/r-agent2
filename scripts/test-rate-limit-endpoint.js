#!/usr/bin/env node
/**
 * Script para testar se o rate limiting está funcionando após limpar o cache.
 * Faz uma requisição de teste ao endpoint generate-and-validate.
 */

const http = require('http');
const config = require('../api/utils/config');

const API_PORT = Number(config.get('api.port', 3000));
const API_HOST = config.get('api.host', 'localhost');

function testGenerateAndValidate() {
  return new Promise((resolve, reject) => {
    console.log(`🔍 Testando endpoint: http://${API_HOST}:${API_PORT}/system/generate-and-validate`);
    console.log('📝 Payload: { name: "teste", bootstrap: true, executionMode: "dry-run" }');
    
    const payload = JSON.stringify({
      name: 'teste',
      bootstrap: true,
      executionMode: 'dry-run',
    });

    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path: '/system/generate-and-validate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 10000,
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = data ? JSON.parse(data) : null;
          console.log(`📊 Status Code: ${res.statusCode}`);
          
          if (res.statusCode === 429) {
            console.log('⚠️  Rate limit excedido (esperado se já foi usado recentemente)');
            console.log('📦 Resposta:', JSON.stringify(result, null, 2));
            if (result?.retryAfter) {
              console.log(`⏱️  Retry After: ${result.retryAfter} segundos`);
            }
            resolve({ success: true, rateLimited: true, result });
          } else if (res.statusCode === 200) {
            console.log('✅ Requisição aceita! Rate limiting está funcionando.');
            console.log('📦 Resposta:', JSON.stringify(result, null, 2).substring(0, 200) + '...');
            resolve({ success: true, rateLimited: false, result });
          } else {
            console.log('❌ Status inesperado:', res.statusCode);
            console.log('📦 Resposta:', JSON.stringify(result, null, 2));
            resolve({ success: false, statusCode: res.statusCode, result });
          }
        } catch (err) {
          console.error('❌ Erro ao processar resposta:', err.message);
          console.log('📦 Resposta raw:', data.substring(0, 200));
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        console.error(`❌ Erro: Não foi possível conectar ao servidor em ${API_HOST}:${API_PORT}`);
        console.error('   Certifique-se de que o servidor está rodando.');
      } else {
        console.error(`❌ Erro ao fazer requisição:`, err.message);
      }
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      console.error('❌ Timeout: Servidor não respondeu em 10 segundos');
      reject(new Error('Timeout'));
    });

    req.write(payload);
    req.end();
  });
}

// Executa teste
console.log('🧪 Testando rate limiting após limpeza de cache...\n');
testGenerateAndValidate()
  .then((result) => {
    if (result.rateLimited) {
      console.log('\n⚠️  Rate limit está ativo (isso é normal se já foi usado).');
      console.log('💡 Execute: npm run rate-limit:clear-cache para limpar o cache novamente.');
    } else {
      console.log('\n✅ Rate limiting está funcionando corretamente!');
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Teste falhou:', err.message);
    process.exit(1);
  });

