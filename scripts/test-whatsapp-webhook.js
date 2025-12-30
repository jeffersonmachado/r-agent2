#!/usr/bin/env node
/**
 * Script de teste para verificação do webhook do WhatsApp
 */

const http = require('http');
const config = require('../api/utils/config');

const PORT = config.get('api.port', 3000);
const VERIFY_TOKEN = config.get('whatsapp.verifyToken', 'test_token');

console.log('🧪 Teste de Verificação do Webhook WhatsApp\n');
console.log(`Porta: ${PORT}`);
console.log(`Token: ${VERIFY_TOKEN}\n`);

const testChallenge = '1234567890';
const url = `http://localhost:${PORT}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=${testChallenge}`;

console.log(`📡 Testando: ${url}\n`);

http.get(url, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    if (res.statusCode === 200 && data === testChallenge) {
      console.log('✅ Webhook verificado com sucesso!');
      console.log(`   Status: ${res.statusCode}`);
      console.log(`   Challenge retornado: ${data}`);
      process.exit(0);
    } else {
      console.log('❌ Falha na verificação do webhook');
      console.log(`   Status: ${res.statusCode}`);
      console.log(`   Resposta: ${data}`);
      process.exit(1);
    }
  });
}).on('error', (err) => {
  console.error('❌ Erro ao conectar:', err.message);
  console.error('\n💡 Certifique-se de que o servidor está rodando:');
  console.error('   npm start (na pasta api/)');
  process.exit(1);
});

