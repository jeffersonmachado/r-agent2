#!/usr/bin/env node
/**
 * Script de teste para criação e gerenciamento de tickets
 */

const http = require('http');
const config = require('../api/utils/config');
const { createTicket } = require('../api/services/queueService');

const PORT = config.get('api.port', 3000);
const QUEUE = process.argv[2] || 'suporte';
const SESSION_ID = process.argv[3] || 'whatsapp_5511999999999';
const MESSAGE = process.argv[4] || 'Preciso de ajuda urgente!';

console.log('🧪 Teste de Criação de Ticket\n');
console.log(`Porta: ${PORT}`);
console.log(`Fila: ${QUEUE}`);
console.log(`Sessão: ${SESSION_ID}`);
console.log(`Mensagem: ${MESSAGE}\n`);

// 1. Criar ticket usando a função diretamente
console.log('📝 Criando ticket...\n');

try {
  const ticket = createTicket({
    sessionId: SESSION_ID,
    queue: QUEUE,
    lastUserMessage: MESSAGE,
    context: {
      flowId: 'test-flow',
      escalationReason: 'user_request',
      escalationAttempt: 1,
      botHistory: [],
      variables: {},
      allowReturnToBot: true,
      safeReturnNode: null
    }
  });

  console.log('✅ Ticket criado com sucesso!');
  console.log(`   ID: ${ticket.id}`);
  console.log(`   Status: ${ticket.status}`);
  console.log(`   Fila: ${ticket.queue}\n`);

  // 2. Listar tickets da fila via API
  console.log(`📋 Listando tickets da fila "${QUEUE}"...\n`);

  http.get(`http://localhost:${PORT}/queues/${encodeURIComponent(QUEUE)}/tickets`, (listRes) => {
    let listData = '';

    listRes.on('data', (chunk) => {
      listData += chunk;
    });

    listRes.on('end', () => {
      if (listRes.statusCode === 200) {
        const tickets = JSON.parse(listData);
        console.log(`✅ Encontrados ${tickets.length} ticket(s) na fila`);
        tickets.forEach((t, i) => {
          console.log(`   ${i + 1}. ${t.id.slice(0, 20)}... - ${t.status} - ${t.lastUserMessage}`);
        });
        console.log('\n✅ Teste de tickets concluído!');
        process.exit(0);
      } else {
        console.log('❌ Erro ao listar tickets');
        console.log(`   Status: ${listRes.statusCode}`);
        console.log(`   Resposta: ${listData}`);
        process.exit(1);
      }
    });
  }).on('error', (err) => {
    console.error('❌ Erro ao listar tickets:', err.message);
    process.exit(1);
  });
} catch (error) {
  console.error('❌ Erro ao criar ticket:', error.message);
  process.exit(1);
}
