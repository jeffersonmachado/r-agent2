#!/usr/bin/env node
/**
 * Script para limpar rate limit do Redis.
 * 
 * ATENÇÃO: Use apenas em desenvolvimento!
 * 
 * Uso:
 *   node scripts/clear-rate-limit.js
 *   node scripts/clear-rate-limit.js --operation BOOTSTRAP
 *   node scripts/clear-rate-limit.js --user admin-001
 */

const { clearRedisRateLimitKeys, clearLimitersCache } = require('../infra/rate-limit');
const { getRateLimitClient } = require('../infra/redis/rateLimitClient');
const logger = require('../api/utils/logger');
const http = require('http');
const config = require('../api/utils/config');

/**
 * Chama o endpoint da API para limpar cache de limiters em memória.
 */
async function clearCacheViaAPI() {
  return new Promise((resolve, reject) => {
    const API_PORT = Number(config.get('api.port', 3000));
    const API_HOST = config.get('api.host', 'localhost');
    
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
          if (res.statusCode === 200) {
            const result = JSON.parse(data);
            console.log('✅ Cache de limiters em memória limpo via API');
            resolve(result);
          } else {
            // Não é um erro crítico, apenas avisa
            console.log('⚠️  Não foi possível limpar cache via API (servidor pode não estar rodando)');
            resolve(null);
          }
        } catch (err) {
          // Não é um erro crítico
          console.log('⚠️  Não foi possível limpar cache via API:', err.message);
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      // Não é um erro crítico se o servidor não estiver rodando
      console.log('⚠️  Servidor não está rodando, pulando limpeza de cache via API');
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      console.log('⚠️  Timeout ao limpar cache via API');
      resolve(null);
    });

    req.end();
  });
}

async function clearRateLimit(options = {}) {
  const { operationType, userId } = options;
  
  try {
    // Aguarda conexão do Redis
    const redisClient = getRateLimitClient();
    if (!redisClient) {
      console.error('❌ Redis não está disponível');
      process.exit(1);
    }

    // Aguarda conexão se necessário
    if (redisClient.status !== 'ready') {
      console.log('⏳ Aguardando conexão com Redis...');
      await new Promise((resolve, reject) => {
        if (redisClient.status === 'ready') {
          resolve();
          return;
        }
        
        const timeout = setTimeout(() => {
          reject(new Error('Timeout ao conectar ao Redis'));
        }, 5000);

        redisClient.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        redisClient.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        // Tenta conectar se ainda não conectou
        if (redisClient.status === 'end' || redisClient.status === 'close') {
          redisClient.connect().catch(() => {
            // Ignora erro, já temos listener
          });
        }
      });
    }

    // Busca todas as chaves (o cliente já adiciona prefixo rl:)
    // Mas também busca chaves com duplo prefixo rl:rl:
    const allKeys1 = await redisClient.keys('*');
    // Cria um cliente temporário sem prefixo para buscar chaves com rl:rl:
    const tempClient = redisClient.duplicate();
    tempClient.options.keyPrefix = '';
    await tempClient.connect();
    const allKeys2 = await tempClient.keys('rl:*');
    await tempClient.quit();
    
    // Combina e remove duplicatas
    const allKeys = [...new Set([...allKeys1, ...allKeys2])];
    console.log(`📋 Total de chaves no Redis: ${allKeys.length}`);
    
    if (allKeys.length === 0) {
      console.log('✅ Nenhuma chave encontrada no Redis para limpar');
      
      // Mesmo sem chaves no Redis, tenta limpar cache de limiters em memória
      // (pode estar usando RateLimiterMemory)
      console.log('\n🔄 Tentando limpar cache de limiters em memória...');
      await clearCacheViaAPI();
      
      // Também limpa o cache localmente
      try {
        clearLimitersCache();
        console.log('✅ Cache de limiters limpo localmente');
      } catch (err) {
        // Ignora erro
      }
      
      console.log('\n💡 Dica: Se o rate limit ainda estiver bloqueando, o servidor pode estar usando');
      console.log('   limiters em memória. Tente reiniciar o servidor ou aguarde o TTL expirar.');
      
      return;
    }

    // Lista todas as chaves para debug
    if (allKeys.length <= 20) {
      console.log('   Chaves encontradas:');
      allKeys.forEach(key => console.log(`     - ${key}`));
    }

    // Filtra chaves de rate limiting
    // As chaves podem ter formato: rl:OPERATION:... ou rl:rl:OPERATION:... (duplo prefixo)
    const rateLimitKeys = allKeys.filter(key => {
      const keyStr = String(key);
      // Remove prefixos rl: duplicados para análise
      const normalized = keyStr.replace(/^rl:rl:/, 'rl:').replace(/^rl:/, '');
      return normalized.includes('BOOTSTRAP') || 
             normalized.includes('GENERATION') || 
             normalized.includes('DRY_RUN') ||
             normalized.includes('SCRAPING') ||
             normalized.includes('SYSTEM_VALIDATE') ||
             normalized.includes('execution:');
    });

    if (operationType) {
      // Busca diretamente por padrão específico do tipo de operação
      // O RateLimiterRedis usa prefixo rl:OPERATION_TYPE:, então busca rl:OPERATION_TYPE:*
      const tempClientForSearch = redisClient.duplicate();
      tempClientForSearch.options.keyPrefix = '';
      await tempClientForSearch.connect();
      
      // Busca padrões específicos
      const pattern1 = `rl:${operationType}:*`;
      const pattern2 = `rl:rl:${operationType}:*`;
      const keys1 = await tempClientForSearch.keys(pattern1);
      const keys2 = await tempClientForSearch.keys(pattern2);
      await tempClientForSearch.quit();
      
      // Combina e remove duplicatas
      const directKeys = [...new Set([...keys1, ...keys2])];
      
      // Também filtra das chaves já encontradas
      const filtered = rateLimitKeys.filter(key => {
        const keyStr = String(key);
        return keyStr.includes(operationType);
      });
      
      // Combina ambas as buscas
      const allFiltered = [...new Set([...filtered, ...directKeys])];
      
      if (allFiltered.length === 0) {
        console.log(`✅ Nenhuma chave encontrada para o tipo ${operationType}`);
        // Mostra estatísticas de chaves encontradas
        const stats = {};
        rateLimitKeys.forEach(key => {
          const keyStr = String(key);
          if (keyStr.includes('BOOTSTRAP')) stats.BOOTSTRAP = (stats.BOOTSTRAP || 0) + 1;
          if (keyStr.includes('DRY_RUN')) stats.DRY_RUN = (stats.DRY_RUN || 0) + 1;
          if (keyStr.includes('GENERATION')) stats.GENERATION_REAL = (stats.GENERATION_REAL || 0) + 1;
          if (keyStr.includes('SCRAPING')) stats.SCRAPING = (stats.SCRAPING || 0) + 1;
        });
        if (Object.keys(stats).length > 0) {
          console.log('📊 Chaves encontradas por tipo:');
          Object.entries(stats).forEach(([type, count]) => {
            console.log(`   - ${type}: ${count}`);
          });
        }
        return;
      }
      
      console.log(`🗑️  Deletando ${allFiltered.length} chave(s) do tipo ${operationType}...`);
      
      // Separa chaves com duplo prefixo das normais
      const keysWithDoublePrefix = allFiltered.filter(k => String(k).startsWith('rl:rl:'));
      const keysNormal = allFiltered.filter(k => !String(k).startsWith('rl:rl:'));
      
      // Deleta chaves normais usando o cliente com prefixo
      if (keysNormal.length > 0) {
        await redisClient.del(...keysNormal);
      }
      
      // Deleta chaves com duplo prefixo usando cliente sem prefixo
      if (keysWithDoublePrefix.length > 0) {
        // Para chaves com duplo prefixo, usa o nome completo da chave
        // pois o cliente sem prefixo precisa do nome exato como está no Redis
        const keysToDelete = keysWithDoublePrefix.map(k => String(k));
        const tempClient2 = redisClient.duplicate();
        tempClient2.options.keyPrefix = '';
        await tempClient2.connect();
        // Deleta usando o nome completo da chave (rl:rl:...)
        await tempClient2.del(...keysToDelete);
        await tempClient2.quit();
      }
      
      console.log(`✅ Limpas ${allFiltered.length} chave(s)`);
      
      // Tenta limpar cache de limiters em memória via API
      console.log('\n🔄 Tentando limpar cache de limiters em memória...');
      await clearCacheViaAPI();
      
      // Também limpa o cache localmente
      try {
        clearLimitersCache();
        console.log('✅ Cache de limiters limpo localmente');
      } catch (err) {
        // Ignora erro
      }
      
      return;
    }

    if (userId) {
      // Filtra por usuário
      const filtered = rateLimitKeys.filter(key => {
        const keyStr = String(key);
        return keyStr.includes(userId);
      });
      
      if (filtered.length === 0) {
        console.log(`✅ Nenhuma chave encontrada para o usuário ${userId}`);
        return;
      }
      
      console.log(`🗑️  Deletando ${filtered.length} chave(s) do usuário ${userId}...`);
      await redisClient.del(...filtered);
      console.log(`✅ Limpas ${filtered.length} chave(s)`);
      
      // Tenta limpar cache de limiters em memória via API
      console.log('\n🔄 Tentando limpar cache de limiters em memória...');
      await clearCacheViaAPI();
      
      // Também limpa o cache localmente
      try {
        clearLimitersCache();
        console.log('✅ Cache de limiters limpo localmente');
      } catch (err) {
        // Ignora erro
      }
      
      return;
    }

    // Limpa todas as chaves de rate limiting
    if (rateLimitKeys.length === 0) {
      console.log('✅ Nenhuma chave de rate limiting encontrada');
      return;
    }

    console.log(`🗑️  Deletando ${rateLimitKeys.length} chave(s) de rate limiting...`);
    if (rateLimitKeys.length <= 10) {
      rateLimitKeys.forEach(key => console.log(`   - ${key}`));
    }
    
    // Para chaves com duplo prefixo, precisa usar cliente sem prefixo
    const keysWithDoublePrefix = rateLimitKeys.filter(k => String(k).startsWith('rl:rl:'));
    const keysNormal = rateLimitKeys.filter(k => !String(k).startsWith('rl:rl:'));
    
    if (keysNormal.length > 0) {
      await redisClient.del(...keysNormal);
    }
    
    if (keysWithDoublePrefix.length > 0) {
      // Para chaves com duplo prefixo, usa o nome completo da chave
      // pois o cliente sem prefixo precisa do nome exato como está no Redis
      const keysToDelete = keysWithDoublePrefix.map(k => String(k));
      const tempClient2 = redisClient.duplicate();
      tempClient2.options.keyPrefix = '';
      await tempClient2.connect();
      // Deleta usando o nome completo da chave (rl:rl:...)
      await tempClient2.del(...keysToDelete);
      await tempClient2.quit();
    }
    
    console.log(`✅ Limpas ${rateLimitKeys.length} chave(s) de rate limiting`);
    
    // Tenta limpar cache de limiters em memória via API
    console.log('\n🔄 Tentando limpar cache de limiters em memória...');
    await clearCacheViaAPI();
    
    // Também limpa o cache localmente (se o módulo estiver carregado)
    try {
      clearLimitersCache();
      console.log('✅ Cache de limiters limpo localmente');
    } catch (err) {
      // Ignora erro se não conseguir limpar localmente
      console.log('⚠️  Não foi possível limpar cache localmente (normal se servidor não estiver rodando)');
    }
  } catch (err) {
    console.error('❌ Erro ao limpar rate limit:', err.message);
    process.exit(1);
  }
}

// Parse argumentos
const args = process.argv.slice(2);
const options = {};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--operation' && args[i + 1]) {
    options.operationType = args[i + 1];
    i++;
  } else if (args[i] === '--user' && args[i + 1]) {
    options.userId = args[i + 1];
    i++;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
Uso: node scripts/clear-rate-limit.js [opções]

Opções:
  --operation TYPE    Limpa apenas chaves de um tipo específico (ex: BOOTSTRAP)
  --user USER_ID      Limpa apenas chaves de um usuário específico
  --help, -h          Mostra esta ajuda

Exemplos:
  node scripts/clear-rate-limit.js
  node scripts/clear-rate-limit.js --operation BOOTSTRAP
  node scripts/clear-rate-limit.js --user admin-001
    `);
    process.exit(0);
  }
}

// Executa
clearRateLimit(options)
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Erro:', err);
    process.exit(1);
  });

