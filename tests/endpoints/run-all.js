#!/usr/bin/env node
/**
 * Runner para executar testes por categoria ou todos os testes
 * 
 * Uso:
 *   node tests/endpoints/run-all.js                    # Executa todos os testes
 *   node tests/endpoints/run-all.js auth               # Executa apenas testes de autenticação
 *   node tests/endpoints/run-all.js tenants            # Executa apenas testes de tenants
 *   node tests/endpoints/run-all.js tickets            # Executa apenas testes de tickets
 *   node tests/endpoints/run-all.js config             # Executa apenas testes de config
 *   node tests/endpoints/run-all.js --list             # Lista todas as categorias disponíveis
 */

const path = require('path');

// Mapeamento de categorias para arquivos de teste
const TEST_CATEGORIES = {
  'auth': {
    name: 'Autenticação',
    file: path.join(__dirname, 'auth.test.js'),
    module: 'testAuthEndpoints'
  },
  'tenants': {
    name: 'Tenants',
    file: path.join(__dirname, 'tenants.test.js'),
    module: 'testTenantsEndpoints'
  },
  'tickets': {
    name: 'Tickets',
    file: path.join(__dirname, 'tickets.test.js'),
    module: 'testTicketsEndpoints'
  },
  'config': {
    name: 'Configuração',
    file: path.join(__dirname, '../config.test.js'),
    module: 'testConfigEndpoints'
  },
  'ai-provider-status': {
    name: 'AI Provider Status',
    file: path.join(__dirname, '../tenant/aiProviderStatus.test.js'),
    module: 'testAiProviderStatus'
  },
  'frontend': {
    name: 'Frontend (Fluxo Completo)',
    file: path.join(__dirname, '../frontend/login-flow.test.js'),
    module: 'testFrontendFlows'
  },
  'rpa-login': {
    name: 'RPA Login',
    file: path.join(__dirname, '../rpa/login.test.js'),
    module: 'runLoginTests'
  }
};

/**
 * Executa um teste de categoria
 */
async function runCategory(category) {
  const categoryInfo = TEST_CATEGORIES[category];
  
  if (!categoryInfo) {
    console.error(`❌ Categoria "${category}" não encontrada`);
    console.log('\nCategorias disponíveis:');
    Object.keys(TEST_CATEGORIES).forEach(cat => {
      console.log(`  - ${cat}: ${TEST_CATEGORIES[cat].name}`);
    });
    return { success: false, error: 'Categoria não encontrada' };
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🧪 Executando testes: ${categoryInfo.name}`);
  console.log('='.repeat(60));

  try {
    const testModule = require(categoryInfo.file);
    const testFunction = testModule[categoryInfo.module];

    if (!testFunction || typeof testFunction !== 'function') {
      console.error(`❌ Função de teste "${categoryInfo.module}" não encontrada em ${categoryInfo.file}`);
      return { success: false, error: 'Função de teste não encontrada' };
    }

    const result = await testFunction();
    
    // Normaliza o resultado para aceitar tanto boolean quanto objeto
    if (typeof result === 'boolean') {
      return { success: result };
    } else if (result && typeof result === 'object') {
      return result;
    } else {
      return { success: false, error: 'Resultado inválido do teste' };
    }
  } catch (error) {
    console.error(`❌ Erro ao executar teste de ${categoryInfo.name}:`, error.message);
    console.error(error.stack);
    return { success: false, error: error.message };
  }
}

/**
 * Executa todos os testes
 */
async function runAll() {
  console.log('\n🚀 Executando TODOS os testes de endpoints...\n');
  
  const categories = Object.keys(TEST_CATEGORIES);
  const results = [];
  let totalPassed = 0;
  let totalFailed = 0;

  for (const category of categories) {
    const result = await runCategory(category);
    results.push({ category, ...result });
    
    if (result.success) {
      totalPassed++;
    } else {
      totalFailed++;
    }
  }

  // Resumo
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMO DOS TESTES');
  console.log('='.repeat(60));
  console.log(`\n✅ Testes passaram: ${totalPassed}`);
  console.log(`❌ Testes falharam: ${totalFailed}`);
  console.log(`📈 Total: ${categories.length} categorias\n`);

  results.forEach(result => {
    const icon = result.success ? '✅' : '❌';
    console.log(`${icon} ${TEST_CATEGORIES[result.category].name}: ${result.success ? 'PASSOU' : 'FALHOU'}`);
    if (result.error) {
      console.log(`   Erro: ${result.error}`);
    }
  });

  return {
    success: totalFailed === 0,
    total: categories.length,
    passed: totalPassed,
    failed: totalFailed,
    results
  };
}

/**
 * Lista todas as categorias disponíveis
 */
function listCategories() {
  console.log('\n📋 Categorias de testes disponíveis:\n');
  Object.keys(TEST_CATEGORIES).forEach(category => {
    const info = TEST_CATEGORIES[category];
    console.log(`  ${category.padEnd(20)} - ${info.name}`);
  });
  console.log('\n💡 Use: node tests/endpoints/run-all.js <categoria>');
  console.log('   Ou: node tests/endpoints/run-all.js (para executar todos)\n');
}

// Main
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--list') || args.includes('-l')) {
    listCategories();
    process.exit(0);
  }

  if (args.length === 0) {
    // Executa todos os testes
    const result = await runAll();
    process.exit(result.success ? 0 : 1);
  } else {
    // Executa categoria específica
    const category = args[0].toLowerCase();
    const result = await runCategory(category);
    process.exit(result.success ? 0 : 1);
  }
}

// Executa se for chamado diretamente
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });
}

module.exports = { runAll, runCategory, listCategories, TEST_CATEGORIES };
