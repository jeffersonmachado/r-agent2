#!/usr/bin/env node
/**
 * Script completo de teste de integração WhatsApp
 * Executa todos os testes em sequência
 */

const { spawn } = require('child_process');
const path = require('path');

const scripts = [
  { name: 'Setup do Fluxo de Teste', file: 'setup-test-flow.js' },
  { name: 'Verificação do Webhook', file: 'test-whatsapp-webhook.js' },
  { name: 'Criação de Ticket', file: 'test-ticket-creation.js' },
  { name: 'Recebimento de Mensagem', file: 'test-whatsapp-receive.js' },
];

const results = [];

console.log('🚀 Executando Testes de Integração WhatsApp\n');
console.log('='.repeat(60));
console.log('');

function runTest(index) {
  if (index >= scripts.length) {
    printSummary();
    return;
  }

  const script = scripts[index];
  const scriptPath = path.join(__dirname, script.file);

  console.log(`\n📋 Teste ${index + 1}/${scripts.length}: ${script.name}`);
  console.log('-'.repeat(60));

  const child = spawn('node', [scriptPath], {
    stdio: 'inherit',
    cwd: __dirname
  });

  child.on('close', (code) => {
    results.push({
      name: script.name,
      passed: code === 0
    });

    if (code === 0) {
      console.log(`\n✅ ${script.name}: PASSOU\n`);
    } else {
      console.log(`\n❌ ${script.name}: FALHOU\n`);
    }

    // Aguarda um pouco antes do próximo teste
    setTimeout(() => {
      runTest(index + 1);
    }, 1000);
  });

  child.on('error', (err) => {
    console.error(`\n❌ Erro ao executar ${script.name}:`, err.message);
    results.push({
      name: script.name,
      passed: false
    });
    runTest(index + 1);
  });
}

function printSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMO DOS TESTES');
  console.log('='.repeat(60) + '\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  results.forEach((result, index) => {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${index + 1}. ${result.name}`);
  });

  console.log('\n' + '-'.repeat(60));
  console.log(`Total: ${results.length} | Passou: ${passed} | Falhou: ${failed}`);
  console.log('-'.repeat(60) + '\n');

  if (failed === 0) {
    console.log('🎉 Todos os testes passaram!');
    process.exit(0);
  } else {
    console.log('⚠️  Alguns testes falharam. Verifique os logs acima.');
    process.exit(1);
  }
}

// Verifica se o servidor está rodando
const http = require('http');
const config = require('../api/utils/config');
const PORT = config.get('api.port', 3000);

console.log('🔍 Verificando se o servidor está rodando...\n');

http.get(`http://localhost:${PORT}/health`, (res) => {
  if (res.statusCode === 200) {
    console.log('✅ Servidor está rodando!\n');
    runTest(0);
  } else {
    console.error('❌ Servidor não está respondendo corretamente');
    console.error(`   Status: ${res.statusCode}`);
    console.error('\n💡 Inicie o servidor primeiro:');
    console.error('   cd api && npm start');
    process.exit(1);
  }
}).on('error', (err) => {
  console.error('❌ Servidor não está rodando!');
  console.error(`   Erro: ${err.message}`);
  console.error('\n💡 Inicie o servidor primeiro:');
  console.error('   cd api && npm start');
  process.exit(1);
});

