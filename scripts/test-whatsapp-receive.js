#!/usr/bin/env node
/**
 * Script de teste para simular recebimento de mensagem do WhatsApp
 */

const http = require('http');
const config = require('../api/utils/config');

const PORT = config.get('api.port', 3000);
const PHONE_NUMBER = process.argv[2] || '5511999999999';
const MESSAGE_TEXT = process.argv[3] || 'Olá, preciso de ajuda!';

console.log('🧪 Teste de Recebimento de Mensagem WhatsApp\n');
console.log(`Porta: ${PORT}`);
console.log(`Número: ${PHONE_NUMBER}`);
console.log(`Mensagem: ${MESSAGE_TEXT}\n`);

// Simula payload do webhook do WhatsApp
const webhookPayload = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'test_entry_id',
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        metadata: {
          display_phone_number: PHONE_NUMBER,
          phone_number_id: config.get('whatsapp.phoneNumberId', 'test_phone_id')
        },
        contacts: [{
          profile: {
            name: 'Teste Usuario'
          },
          wa_id: PHONE_NUMBER
        }],
        messages: [{
          from: PHONE_NUMBER,
          id: `wamid.test_${Date.now()}`,
          timestamp: Math.floor(Date.now() / 1000).toString(),
          type: 'text',
          text: {
            body: MESSAGE_TEXT
          }
        }]
      },
      field: 'messages'
    }]
  }]
};

const payload = JSON.stringify(webhookPayload);

const options = {
  hostname: 'localhost',
  port: PORT,
  path: '/webhooks/whatsapp',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

console.log('📥 Simulando webhook do WhatsApp...\n');

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('✅ Webhook processado com sucesso!');
      console.log(`   Status: ${res.statusCode}`);
      console.log(`   Resposta: ${data}`);
      console.log('\n💡 Verifique os logs do servidor para confirmar processamento');
      process.exit(0);
    } else {
      console.log('❌ Erro ao processar webhook');
      console.log(`   Status: ${res.statusCode}`);
      console.log(`   Resposta: ${data}`);
      
      if (res.statusCode === 500) {
        console.log('\n💡 Possíveis causas do erro 500:');
        console.log('   - Erro no processamento do fluxo');
        console.log('   - Handler de nó não encontrado');
        console.log('   - Erro na execução do nó');
        console.log('   - Problema com credenciais do WhatsApp');
        console.log('\n💡 Execute o diagnóstico:');
        console.log('   node scripts/diagnose-whatsapp-error.js');
        console.log('\n⚠️  Este teste é opcional e pode falhar em ambiente de teste');
      }
      
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error('❌ Erro ao conectar:', err.message);
  console.error('\n💡 Certifique-se de que o servidor está rodando:');
  console.error('   npm start (na pasta api/)');
  process.exit(1);
});

req.write(payload);
req.end();

