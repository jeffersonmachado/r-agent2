#!/usr/bin/env node
/**
 * Script para limpar cache de rate limiters em memória via API.
 * 
 * Este script chama o endpoint /admin/rate-limit/clear-cache que limpa
 * o cache de limiters sem precisar reiniciar o servidor.
 * 
 * Uso:
 *   node scripts/clear-rate-limit-cache.js
 */

const http = require('http');
const config = require('../api/utils/config');

const API_PORT = Number(config.get('api.port', 3000));
const API_HOST = config.get('api.host', 'localhost');

function clearCache() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path: '/admin/rate-limit/clear-cache',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (res.statusCode === 200) {
            console.log('✅ Cache de rate limiters limpo com sucesso!');
            console.log(`   ${result.message || 'Cache limpo'}`);
            resolve(result);
          } else {
            console.error(`❌ Erro ao limpar cache: ${result.message || 'Erro desconhecido'}`);
            reject(new Error(result.message || 'Erro ao limpar cache'));
          }
        } catch (err) {
          console.error('❌ Erro ao processar resposta:', err.message);
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      console.error(`❌ Erro ao conectar ao servidor (${API_HOST}:${API_PORT}):`, err.message);
      console.error('   Certifique-se de que o servidor está rodando.');
      reject(err);
    });

    req.end();
  });
}

// Executa
clearCache()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Erro:', err.message);
    process.exit(1);
  });

