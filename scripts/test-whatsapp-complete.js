#!/usr/bin/env node
/**
 * Script completo de teste da integração WhatsApp
 * Executa todos os testes e gera relatório
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const scripts = [
  { name: 'Setup do Fluxo de Teste', file: 'setup-test-flow.js', required: true },
  { name: 'Verificação do Webhook', file: 'test-whatsapp-webhook.js', required: true },
  { name: 'Criação de Ticket', file: 'test-ticket-creation.js', required: true },
  { name: 'Recebimento de Mensagem', file: 'test-whatsapp-receive.js', required: false }, // Opcional - pode falhar se não houver credenciais reais
];

const results = [];
const startTime = Date.now();

console.log('🚀 Executando Testes Completos de Integração WhatsApp\n');
console.log('='.repeat(70));
console.log('');

function runTest(index) {
  if (index >= scripts.length) {
    printSummary();
    return;
  }

  const script = scripts[index];
  const scriptPath = path.join(__dirname, script.file);

  console.log(`\n📋 Teste ${index + 1}/${scripts.length}: ${script.name}`);
  console.log('-'.repeat(70));

  const child = spawn('node', [scriptPath], {
    stdio: 'inherit',
    cwd: __dirname
  });

  child.on('close', (code) => {
    const passed = code === 0;
    results.push({
      name: script.name,
      passed,
      required: script.required
    });

    if (passed) {
      console.log(`\n✅ ${script.name}: PASSOU\n`);
    } else {
      const icon = script.required ? '❌' : '⚠️';
      const status = script.required ? 'FALHOU' : 'FALHOU (opcional)';
      console.log(`\n${icon} ${script.name}: ${status}\n`);
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
      passed: false,
      required: script.required
    });
    runTest(index + 1);
  });
}

function printSummary() {
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  console.log('\n' + '='.repeat(70));
  console.log('📊 RESUMO DOS TESTES');
  console.log('='.repeat(70) + '\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const requiredFailed = results.filter(r => !r.passed && r.required).length;

  results.forEach((result, index) => {
    const icon = result.passed ? '✅' : (result.required ? '❌' : '⚠️');
    const status = result.passed ? 'PASSOU' : (result.required ? 'FALHOU' : 'FALHOU (opcional)');
    console.log(`${icon} ${index + 1}. ${result.name} - ${status}`);
  });

  console.log('\n' + '-'.repeat(70));
  console.log(`Total: ${results.length} | Passou: ${passed} | Falhou: ${failed}`);
  console.log(`Tempo de execução: ${duration}s`);
  console.log('-'.repeat(70) + '\n');

  // Salva relatório em arquivo
  const reportPath = path.join(__dirname, 'test-report.json');
  const report = {
    timestamp: new Date().toISOString(),
    duration: parseFloat(duration),
    total: results.length,
    passed,
    failed,
    requiredFailed,
    results: results.map(r => ({
      name: r.name,
      passed: r.passed,
      required: r.required
    }))
  };

  try {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`📄 Relatório salvo em: ${reportPath}\n`);
  } catch (error) {
    console.log('⚠️  Não foi possível salvar relatório\n');
  }

  if (requiredFailed === 0) {
    console.log('🎉 Todos os testes obrigatórios passaram!');
    if (failed > 0) {
      console.log('⚠️  Alguns testes opcionais falharam (normal se não houver credenciais reais do WhatsApp)');
    }
    process.exit(0);
  } else {
    console.log('⚠️  Alguns testes obrigatórios falharam. Verifique os logs acima.');
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

