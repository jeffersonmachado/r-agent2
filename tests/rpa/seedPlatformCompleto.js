/**
 * Seed Completo da Plataforma via RPA
 * 
 * Versão expandida que cria todos os tipos de dados
 * Execute: node tests/rpa/seedPlatformCompleto.js
 */

const { seedPlatform, SEED_DATA } = require('./seedPlatformRPA');
const config = require('./rpaConfig');

// Dados expandidos
const SEED_DATA_COMPLETO = {
  ...SEED_DATA,
  // Adiciona mais dados se necessário
  quickReplies: [
    { title: 'Saudação Inicial', message: 'Olá! Como posso ajudá-lo hoje?' },
    { title: 'Despedida', message: 'Obrigado por entrar em contato!' },
  ],
};

async function seedCompleto() {
  console.log('🌱 Seed Completo da Plataforma via RPA\n');
  console.log('='.repeat(70));
  console.log('📦 Este seed criará TODOS os dados da plataforma');
  console.log('='.repeat(70));
  console.log('\n📊 Dados a serem criados:');
  console.log(`   📝 Fluxos: ${SEED_DATA_COMPLETO.flows.length}`);
  console.log(`   👤 Agentes: ${SEED_DATA_COMPLETO.agents.length}`);
  console.log(`   📋 Filas: ${SEED_DATA_COMPLETO.queues.length}`);
  console.log(`   🏢 Departamentos: ${SEED_DATA_COMPLETO.departments.length}`);
  console.log(`   💬 Respostas Rápidas: ${SEED_DATA_COMPLETO.quickReplies?.length || 0}\n`);

  const confirm = process.argv.includes('--yes') || process.argv.includes('-y');
  
  if (!confirm) {
    console.log('⚠️  ATENÇÃO: Esta operação criará dados na plataforma!');
    console.log('   Use --yes para confirmar automaticamente\n');
    console.log('   Pressione Ctrl+C para cancelar ou aguarde 5 segundos...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  try {
    const results = await seedPlatform();
    
    // Estatísticas finais
    const total = {
      flows: results.flows.length,
      agents: results.agents.length,
      queues: results.queues.length,
      departments: results.departments.length,
    };
    
    const sucesso = {
      flows: results.flows.filter(f => f.success).length,
      agents: results.agents.filter(a => a.success).length,
      queues: results.queues.filter(q => q.success).length,
      departments: results.departments.filter(d => d.success).length,
    };

    console.log('\n' + '='.repeat(70));
    console.log('📈 Estatísticas Finais:\n');
    console.log(`   📝 Fluxos: ${sucesso.flows}/${total.flows} criados`);
    console.log(`   👤 Agentes: ${sucesso.agents}/${total.agents} criados`);
    console.log(`   📋 Filas: ${sucesso.queues}/${total.queues} criadas`);
    console.log(`   🏢 Departamentos: ${sucesso.departments}/${total.departments} criados`);
    console.log(`   ❌ Total de erros: ${results.errors.length}\n`);

    const taxaSucesso = (
      (sucesso.flows + sucesso.agents + sucesso.queues + sucesso.departments) /
      (total.flows + total.agents + total.queues + total.departments) * 100
    ).toFixed(2);

    console.log(`   📊 Taxa de sucesso geral: ${taxaSucesso}%\n`);

    if (results.errors.length > 0) {
      console.log('⚠️  Erros encontrados:');
      results.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. [${error.type}] ${error.name || error.error}`);
      });
      console.log('');
    }

    // Exit code baseado em sucesso
    const todosSucesso = results.errors.length === 0 && 
      sucesso.flows === total.flows &&
      sucesso.queues === total.queues &&
      sucesso.departments === total.departments;

    process.exit(todosSucesso ? 0 : 1);
  } catch (error) {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  }
}

// Executa se chamado diretamente
if (require.main === module) {
  seedCompleto();
}

module.exports = { seedCompleto, SEED_DATA_COMPLETO };

