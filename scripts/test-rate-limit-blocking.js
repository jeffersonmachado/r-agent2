#!/usr/bin/env node
/**
 * Script para testar se o rate limiting está bloqueando corretamente.
 * Faz múltiplas requisições BOOTSTRAP para verificar se bloqueia após o limite.
 */

const http = require('http');
const config = require('../api/utils/config');

const API_PORT = Number(config.get('api.port', 3000));
const API_HOST = config.get('api.host', 'localhost');

function makeRequest(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path: '/system/generate-and-validate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 10000,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            body: data ? JSON.parse(data) : null,
          });
        } catch (err) {
          resolve({
            statusCode: res.statusCode,
            body: data,
          });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.write(body);
    req.end();
  });
}

async function testBlocking() {
  console.log('🧪 Testando Bloqueio de Rate Limiting');
  console.log('='.repeat(50));
  console.log('📝 Política BOOTSTRAP: 1 execução a cada 5 minutos (300 segundos)');
  console.log('');

  // Primeiro, limpa o cache e Redis
  console.log('1️⃣  Limpando cache e chaves do Redis...');
  try {
    await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: API_HOST,
        port: API_PORT,
        path: '/admin/rate-limit/clear-cache',
        method: 'POST',
      }, (res) => {
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.end();
    });
    console.log('   ✅ Cache limpo');
  } catch (err) {
    console.log('   ⚠️  Erro ao limpar cache:', err.message);
  }

  // Limpa Redis também
  const { execSync } = require('child_process');
  try {
    execSync('npm run rate-limit:clear', { stdio: 'ignore' });
    console.log('   ✅ Chaves do Redis limpas');
  } catch (err) {
    console.log('   ⚠️  Erro ao limpar Redis:', err.message);
  }

  await new Promise(resolve => setTimeout(resolve, 1000));

  const payload = {
    name: 'teste-bloqueio',
    bootstrap: true,
    executionMode: 'dry-run',
  };

  console.log('\n2️⃣  Fazendo primeira requisição BOOTSTRAP...');
  try {
    const result1 = await makeRequest(payload);
    console.log(`   Status: ${result1.statusCode}`);
    
    if (result1.statusCode === 429) {
      console.log('   ⚠️  Primeira requisição já foi bloqueada');
      console.log('   💡 Isso indica que há uma chave no Redis ainda ativa');
      if (result1.body?.retryAfter) {
        console.log(`   ⏱️  Aguarde ${result1.body.retryAfter} segundos ou limpe o Redis`);
      }
      return;
    } else if (result1.statusCode === 200) {
      console.log('   ✅ Primeira requisição aceita');
    } else {
      console.log(`   ⚠️  Status inesperado: ${result1.statusCode}`);
    }
  } catch (err) {
    console.log('   ❌ Erro:', err.message);
    return;
  }

  console.log('\n3️⃣  Fazendo segunda requisição BOOTSTRAP imediatamente...');
  try {
    const result2 = await makeRequest(payload);
    console.log(`   Status: ${result2.statusCode}`);
    
    if (result2.statusCode === 429) {
      console.log('   ✅ Rate limiting bloqueou corretamente!');
      console.log('   ✅ Sistema funcionando perfeitamente!');
      if (result2.body?.retryAfter) {
        console.log(`   ⏱️  Retry After: ${result2.body.retryAfter} segundos`);
      }
    } else if (result2.statusCode === 200) {
      console.log('   ⚠️  Segunda requisição não foi bloqueada');
      console.log('   💡 Isso pode acontecer se:');
      console.log('      - O rate limiter está usando memória e não está compartilhando estado');
      console.log('      - Há um delay na criação da chave no Redis');
      console.log('      - A política permite múltiplas execuções simultâneas');
    } else {
      console.log(`   ⚠️  Status inesperado: ${result2.statusCode}`);
    }
  } catch (err) {
    console.log('   ❌ Erro:', err.message);
  }

  console.log('\n4️⃣  Verificando chaves no Redis...');
  try {
    const redis = require('ioredis');
    const client = new redis('redis://localhost:6379');
    await client.connect();
    
    const keys = await client.keys('rl:BOOTSTRAP:*');
    console.log(`   📋 Chaves encontradas: ${keys.length}`);
    if (keys.length > 0) {
      console.log('   Chaves:');
      keys.slice(0, 5).forEach(key => console.log(`     - ${key}`));
      if (keys.length > 5) {
        console.log(`     ... e mais ${keys.length - 5} chave(s)`);
      }
    } else {
      console.log('   ⚠️  Nenhuma chave encontrada (pode estar usando memória)');
    }
    
    await client.quit();
  } catch (err) {
    console.log('   ⚠️  Erro ao verificar Redis:', err.message);
  }
}

testBlocking()
  .then(() => {
    console.log('\n✅ Teste concluído');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Erro:', err);
    process.exit(1);
  });

