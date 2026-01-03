#!/usr/bin/env node

/**
 * Script para testar e visualizar capacidades do sistema CDR
 * 
 * Uso:
 *   node scripts/test-capabilities.js
 *   node scripts/test-capabilities.js --list
 *   node scripts/test-capabilities.js --check ai_processing
 *   node scripts/test-capabilities.js --action processar_ia
 */

const { 
  listActiveCapabilities, 
  getCapability,
  hasCapability,
  checkActionAllowed,
  loadCapabilities
} = require('../engine/utils/capabilityValidator');

const args = process.argv.slice(2);

function listAll() {
  console.log('\n📋 Capacidades Ativas do Sistema\n');
  console.log('='.repeat(60));
  
  const capabilities = listActiveCapabilities();
  
  if (capabilities.length === 0) {
    console.log('❌ Nenhuma capacidade ativa encontrada.');
    return;
  }
  
  capabilities.forEach((cap, index) => {
    console.log(`\n${index + 1}. ${cap.name} (${cap.id})`);
    console.log(`   ${cap.description}`);
  });
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total: ${capabilities.length} capacidades ativas\n`);
}

function checkCapability(capabilityId) {
  console.log(`\n🔍 Verificando capacidade: ${capabilityId}\n`);
  console.log('='.repeat(60));
  
  const exists = hasCapability(capabilityId);
  console.log(`Status: ${exists ? '✅ ATIVA' : '❌ NÃO ENCONTRADA OU INATIVA'}`);
  
  if (exists) {
    const cap = getCapability(capabilityId);
    console.log('\nDetalhes:');
    console.log(JSON.stringify(cap, null, 2));
  }
  
  console.log('='.repeat(60) + '\n');
}

function checkAction(action) {
  console.log(`\n🔍 Verificando ação: ${action}\n`);
  console.log('='.repeat(60));
  
  const result = checkActionAllowed(action);
  
  if (result.allowed) {
    console.log(`✅ AÇÃO PERMITIDA`);
    console.log(`   Via capacidade: ${result.capability}`);
    if (result.capabilityInfo) {
      console.log(`   Nome: ${result.capabilityInfo.name}`);
      console.log(`   Descrição: ${result.capabilityInfo.description}`);
    }
  } else {
    console.log(`❌ AÇÃO NÃO PERMITIDA`);
    console.log(`   Motivo: ${result.reason}`);
  }
  
  console.log('='.repeat(60) + '\n');
}

function showSummary() {
  console.log('\n📊 Resumo do Sistema CDR\n');
  console.log('='.repeat(60));
  
  const allCaps = loadCapabilities();
  if (!allCaps) {
    console.log('❌ Não foi possível carregar capabilities.json');
    return;
  }
  
  const total = Object.keys(allCaps.capabilities || {}).length;
  const active = listActiveCapabilities().length;
  const inactive = total - active;
  
  console.log(`Total de capacidades: ${total}`);
  console.log(`  ✅ Ativas: ${active}`);
  console.log(`  ⚠️  Inativas: ${inactive}`);
  console.log(`\nVersão: ${allCaps.version || 'N/A'}`);
  console.log(`Última atualização: ${allCaps.lastUpdated || 'N/A'}`);
  
  console.log('\n' + '='.repeat(60) + '\n');
}

// Processa argumentos
if (args.length === 0 || args.includes('--list') || args.includes('-l')) {
  listAll();
  showSummary();
} else if (args.includes('--check') || args.includes('-c')) {
  const index = args.indexOf('--check') !== -1 ? args.indexOf('--check') : args.indexOf('-c');
  const capabilityId = args[index + 1];
  if (capabilityId) {
    checkCapability(capabilityId);
  } else {
    console.log('❌ Erro: Especifique o ID da capacidade');
    console.log('Uso: node scripts/test-capabilities.js --check <capability_id>');
  }
} else if (args.includes('--action') || args.includes('-a')) {
  const index = args.indexOf('--action') !== -1 ? args.indexOf('--action') : args.indexOf('-a');
  const action = args[index + 1];
  if (action) {
    checkAction(action);
  } else {
    console.log('❌ Erro: Especifique a ação');
    console.log('Uso: node scripts/test-capabilities.js --action <action_name>');
  }
} else if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Uso: node scripts/test-capabilities.js [opções]

Opções:
  --list, -l              Lista todas as capacidades ativas (padrão)
  --check <id>, -c <id>   Verifica uma capacidade específica
  --action <action>, -a   Verifica se uma ação é permitida
  --help, -h              Mostra esta ajuda

Exemplos:
  node scripts/test-capabilities.js
  node scripts/test-capabilities.js --check ai_processing
  node scripts/test-capabilities.js --action processar_ia
  `);
} else {
  console.log('❌ Opção não reconhecida. Use --help para ver opções disponíveis.');
}

