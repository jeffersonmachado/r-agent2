#!/usr/bin/env node
/**
 * Script de diagnóstico para investigar erros no processamento do WhatsApp
 */

const http = require('http');
const config = require('../api/utils/config');

const PORT = config.get('api.port', 3000);

console.log('🔍 Diagnóstico de Erros WhatsApp\n');
console.log('='.repeat(70));
console.log('');

// 1. Verificar se o servidor está rodando
console.log('1️⃣ Verificando servidor...');
http.get(`http://localhost:${PORT}/health`, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('   ✅ Servidor está rodando\n');
      checkFlow();
    } else {
      console.log(`   ❌ Servidor retornou status ${res.statusCode}\n`);
      process.exit(1);
    }
  });
}).on('error', (err) => {
  console.log(`   ❌ Erro: ${err.message}\n`);
  process.exit(1);
});

function checkFlow() {
  console.log('2️⃣ Verificando fluxo padrão...');
  const defaultFlowId = config.get('flows.defaultFlowId');
  
  if (!defaultFlowId) {
    console.log('   ❌ defaultFlowId não configurado em config.json\n');
    console.log('   💡 Execute: node scripts/setup-test-flow.js\n');
    process.exit(1);
  }
  
  console.log(`   📋 defaultFlowId: ${defaultFlowId}\n`);
  
  http.get(`http://localhost:${PORT}/flows/${defaultFlowId}`, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      if (res.statusCode === 200) {
        const flow = JSON.parse(data);
        console.log('   ✅ Fluxo encontrado!');
        console.log(`   📝 Nome: ${flow.name}`);
        console.log(`   📊 Nós: ${flow.nodes?.length || 0}\n`);
        checkCredentials();
      } else {
        console.log(`   ❌ Fluxo não encontrado (status: ${res.statusCode})`);
        console.log(`   💡 Execute: node scripts/setup-test-flow.js\n`);
        process.exit(1);
      }
    });
  }).on('error', (err) => {
    console.log(`   ❌ Erro: ${err.message}\n`);
    process.exit(1);
  });
}

function checkCredentials() {
  console.log('3️⃣ Verificando credenciais do WhatsApp...');
  
  const phoneNumberId = config.get('whatsapp.phoneNumberId');
  const accessToken = config.get('whatsapp.accessToken');
  const verifyToken = config.get('whatsapp.verifyToken');
  
  if (!phoneNumberId || phoneNumberId.includes('SEU_')) {
    console.log('   ⚠️  phoneNumberId não configurado ou é placeholder');
  } else {
    console.log('   ✅ phoneNumberId configurado');
  }
  
  if (!accessToken || accessToken.includes('SEU_')) {
    console.log('   ⚠️  accessToken não configurado ou é placeholder');
  } else {
    console.log('   ✅ accessToken configurado');
  }
  
  if (!verifyToken || verifyToken.includes('seu_token')) {
    console.log('   ⚠️  verifyToken não configurado ou é placeholder');
  } else {
    console.log('   ✅ verifyToken configurado');
  }
  
  console.log('\n4️⃣ Testando processamento de mensagem...\n');
  testMessageProcessing();
}

function testMessageProcessing() {
  const webhookPayload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'test_entry_id',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '5511999999999',
            phone_number_id: config.get('whatsapp.phoneNumberId', 'test_phone_id')
          },
          contacts: [{
            profile: { name: 'Teste Usuario' },
            wa_id: '5511999999999'
          }],
          messages: [{
            from: '5511999999999',
            id: `wamid.test_${Date.now()}`,
            timestamp: Math.floor(Date.now() / 1000).toString(),
            type: 'text',
            text: { body: 'Teste de diagnóstico' }
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

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('   ✅ Webhook processado com sucesso!');
        console.log(`   📄 Resposta: ${data}\n`);
        console.log('✅ Diagnóstico concluído - Sistema funcionando!\n');
        process.exit(0);
      } else {
        console.log(`   ❌ Erro ao processar (status: ${res.statusCode})`);
        console.log(`   📄 Resposta: ${data}\n`);
        
        if (res.statusCode === 500) {
          console.log('💡 Possíveis causas:');
          console.log('   1. Erro no processamento do fluxo');
          console.log('   2. Handler de nó não encontrado');
          console.log('   3. Erro na execução do nó');
          console.log('   4. Problema com credenciais do WhatsApp\n');
          console.log('💡 Verifique os logs do servidor para mais detalhes\n');
        }
        
        process.exit(1);
      }
    });
  });

  req.on('error', (err) => {
    console.log(`   ❌ Erro de conexão: ${err.message}\n`);
    process.exit(1);
  });

  req.write(payload);
  req.end();
}

