#!/usr/bin/env node
/**
 * Script de teste para envio de mensagens via WhatsApp
 */

const { sendTextMessage } = require('../api/services/whatsappService');
const config = require('../api/utils/config');

const PHONE_NUMBER = process.argv[2] || '5511999999999';
const MESSAGE = process.argv[3] || 'Teste de mensagem do r-agent2';

console.log('🧪 Teste de Envio de Mensagem WhatsApp\n');
console.log(`Destinatário: ${PHONE_NUMBER}`);
console.log(`Mensagem: ${MESSAGE}\n`);

// Verifica configuração
const phoneNumberId = config.get('whatsapp.phoneNumberId');
const accessToken = config.get('whatsapp.accessToken');

if (!phoneNumberId || !accessToken) {
  console.error('❌ Credenciais do WhatsApp não configuradas!');
  console.error('\nConfigure em api/data/config.json:');
  console.error('  - whatsapp.phoneNumberId');
  console.error('  - whatsapp.accessToken');
  process.exit(1);
}

console.log('📤 Enviando mensagem...\n');

sendTextMessage(PHONE_NUMBER, MESSAGE)
  .then((result) => {
    console.log('✅ Mensagem enviada com sucesso!');
    console.log('   Resultado:', JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Erro ao enviar mensagem:');
    console.error('   ', error.message);
    
    if (error.message.includes('credentials')) {
      console.error('\n💡 Verifique as credenciais em api/data/config.json');
    } else if (error.message.includes('API error')) {
      console.error('\n💡 Verifique:');
      console.error('   - Phone Number ID está correto');
      console.error('   - Access Token está válido');
      console.error('   - Número está no formato correto (sem +, sem espaços)');
    }
    
    process.exit(1);
  });

