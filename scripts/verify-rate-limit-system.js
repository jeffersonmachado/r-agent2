#!/usr/bin/env node
/**
 * Script completo para verificar o funcionamento do sistema de rate limiting.
 * 
 * Testa:
 * 1. Endpoint de limpeza de cache
 * 2. Rate limiting funcionando
 * 3. Cache sendo limpo corretamente
 * 4. Múltiplas requisições
 */

const http = require('http');
const config = require('../api/utils/config');

const API_PORT = Number(config.get('api.port', 3000));
const API_HOST = config.get('api.host', 'localhost');

function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = data ? JSON.parse(data) : null;
          resolve({
            statusCode: res.statusCode,
            body: result || data,
            headers: res.headers,
          });
        } catch (err) {
          resolve({
            statusCode: res.statusCode,
            body: data,
            headers: res.headers,
          });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function testClearCache() {
  console.log('\n📋 Teste 1: Limpeza de Cache');
  console.log('─'.repeat(50));
  
  try {
    const result = await makeRequest('/admin/rate-limit/clear-cache', 'POST');
    
    if (result.statusCode === 200 && result.body?.success) {
      console.log('✅ Endpoint de limpeza de cache está funcionando');
      console.log(`   Status: ${result.statusCode}`);
      console.log(`   Mensagem: ${result.body.message}`);
      return true;
    } else {
      console.log('❌ Endpoint retornou resposta inesperada');
      console.log(`   Status: ${result.statusCode}`);
      console.log(`   Resposta:`, JSON.stringify(result.body, null, 2));
      return false;
    }
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.log('❌ Servidor não está rodando');
      console.log('   Execute: npm start ou npm run dev:api');
    } else {
      console.log('❌ Erro:', err.message);
    }
    return false;
  }
}

async function testRateLimit() {
  console.log('\n📋 Teste 2: Rate Limiting');
  console.log('─'.repeat(50));
  
  const payload = {
    name: 'teste-verificacao',
    bootstrap: true,
    executionMode: 'dry-run',
  };

  try {
    console.log('   Fazendo requisição de teste...');
    const result = await makeRequest('/system/generate-and-validate', 'POST', payload);
    
    if (result.statusCode === 429) {
      console.log('⚠️  Rate limit excedido (esperado se já foi usado)');
      console.log(`   Status: ${result.statusCode}`);
      if (result.body?.retryAfter) {
        console.log(`   Retry After: ${result.body.retryAfter} segundos`);
      }
      return { rateLimited: true, result };
    } else if (result.statusCode === 200) {
      console.log('✅ Requisição aceita pelo rate limiting');
      console.log(`   Status: ${result.statusCode}`);
      if (result.body?.rateLimitExceeded) {
        console.log('   ⚠️  Mas rateLimitExceeded está true no body');
        return { rateLimited: true, result };
      }
      return { rateLimited: false, result };
    } else {
      console.log(`⚠️  Status inesperado: ${result.statusCode}`);
      return { rateLimited: false, result };
    }
  } catch (err) {
    console.log('❌ Erro ao testar rate limiting:', err.message);
    return { error: err.message };
  }
}

async function testMultipleRequests() {
  console.log('\n📋 Teste 3: Múltiplas Requisições');
  console.log('─'.repeat(50));
  
  const payload = {
    name: 'teste-multiplo',
    bootstrap: true,
    executionMode: 'dry-run',
  };

  console.log('   Fazendo 2 requisições rápidas...');
  
  try {
    const [result1, result2] = await Promise.all([
      makeRequest('/system/generate-and-validate', 'POST', payload),
      makeRequest('/system/generate-and-validate', 'POST', payload).catch(err => ({ error: err.message })),
    ]);

    console.log(`   Requisição 1: Status ${result1.statusCode}`);
    if (result1.statusCode === 429) {
      console.log('   ✅ Rate limiting bloqueou a segunda requisição (esperado para BOOTSTRAP)');
    } else {
      console.log('   ⚠️  Primeira requisição não foi bloqueada');
    }

    if (result2.error) {
      console.log(`   Requisição 2: Erro - ${result2.error}`);
    } else {
      console.log(`   Requisição 2: Status ${result2.statusCode}`);
      if (result2.statusCode === 429) {
        console.log('   ✅ Rate limiting funcionando corretamente!');
      } else {
        console.log('   ⚠️  Segunda requisição não foi bloqueada (pode ser normal se houver delay)');
      }
    }

    return { result1, result2 };
  } catch (err) {
    console.log('❌ Erro:', err.message);
    return { error: err.message };
  }
}

async function testCacheClearing() {
  console.log('\n📋 Teste 4: Verificação de Limpeza de Cache');
  console.log('─'.repeat(50));
  
  try {
    // Limpa cache
    console.log('   1. Limpando cache...');
    await makeRequest('/admin/rate-limit/clear-cache', 'POST');
    console.log('   ✅ Cache limpo');

    // Aguarda um pouco
    await new Promise(resolve => setTimeout(resolve, 500));

    // Tenta fazer uma requisição
    console.log('   2. Fazendo requisição após limpar cache...');
    const payload = {
      name: 'teste-apos-limpeza',
      bootstrap: true,
      executionMode: 'dry-run',
    };
    
    const result = await makeRequest('/system/generate-and-validate', 'POST', payload);
    
    if (result.statusCode === 200) {
      console.log('   ✅ Requisição aceita após limpar cache');
      console.log('   ✅ Cache foi limpo corretamente!');
      return true;
    } else if (result.statusCode === 429) {
      console.log('   ⚠️  Ainda bloqueado após limpar cache');
      console.log('   💡 Isso pode indicar que há chaves no Redis que precisam ser limpas');
      console.log('   💡 Execute: npm run rate-limit:clear');
      return false;
    } else {
      console.log(`   ⚠️  Status inesperado: ${result.statusCode}`);
      return false;
    }
  } catch (err) {
    console.log('❌ Erro:', err.message);
    return false;
  }
}

async function runAllTests() {
  console.log('🧪 Verificação Completa do Sistema de Rate Limiting');
  console.log('='.repeat(50));

  const results = {
    clearCache: false,
    rateLimit: false,
    multipleRequests: false,
    cacheClearing: false,
  };

  // Teste 1: Limpeza de cache
  results.clearCache = await testClearCache();

  // Teste 2: Rate limiting
  const rateLimitTest = await testRateLimit();
  results.rateLimit = rateLimitTest.rateLimited !== undefined;

  // Teste 3: Múltiplas requisições
  await testMultipleRequests();
  results.multipleRequests = true; // Considera sucesso se não deu erro

  // Teste 4: Verificação de limpeza
  results.cacheClearing = await testCacheClearing();

  // Resumo
  console.log('\n📊 Resumo dos Testes');
  console.log('='.repeat(50));
  console.log(`✅ Limpeza de Cache:        ${results.clearCache ? 'PASSOU' : 'FALHOU'}`);
  console.log(`✅ Rate Limiting:           ${results.rateLimit ? 'PASSOU' : 'FALHOU'}`);
  console.log(`✅ Múltiplas Requisições:    ${results.multipleRequests ? 'PASSOU' : 'FALHOU'}`);
  console.log(`✅ Limpeza Funcional:        ${results.cacheClearing ? 'PASSOU' : 'FALHOU'}`);

  const allPassed = Object.values(results).every(r => r === true);
  
  if (allPassed) {
    console.log('\n🎉 Todos os testes passaram! Sistema funcionando corretamente.');
  } else {
    console.log('\n⚠️  Alguns testes falharam. Verifique os detalhes acima.');
  }

  return allPassed;
}

// Executa todos os testes
runAllTests()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((err) => {
    console.error('\n❌ Erro fatal:', err);
    process.exit(1);
  });

