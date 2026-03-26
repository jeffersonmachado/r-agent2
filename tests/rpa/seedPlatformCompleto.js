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
    const report = await seedPlatform();
    const functional = report.functionalResults || {};
    const total = {
      flows: Array.isArray(functional.flows) ? functional.flows.length : 0,
      agents: Array.isArray(functional.agents) ? functional.agents.length : 0,
      queues: Array.isArray(functional.queues) ? functional.queues.length : 0,
      departments: Array.isArray(functional.departments) ? functional.departments.length : 0,
    };
    const sucesso = {
      flows: Array.isArray(functional.flows) ? functional.flows.filter((item) => item.success !== false).length : 0,
      agents: Array.isArray(functional.agents) ? functional.agents.filter((item) => item.success !== false).length : 0,
      queues: Array.isArray(functional.queues) ? functional.queues.filter((item) => item.success !== false).length : 0,
      departments: Array.isArray(functional.departments) ? functional.departments.filter((item) => item.success !== false).length : 0,
    };

    console.log('\n' + '='.repeat(70));
    console.log('📈 Estatísticas Finais:\n');
    console.log(`   📝 Fluxos: ${sucesso.flows}/${total.flows} criados`);
    console.log(`   👤 Agentes: ${sucesso.agents}/${total.agents} criados`);
    console.log(`   📋 Filas: ${sucesso.queues}/${total.queues} criadas`);
    console.log(`   🏢 Departamentos: ${sucesso.departments}/${total.departments} criados`);
    const smokeFailures = (report.smokeResults || []).filter((item) => !item.skipped && !item.success).length;
    const hasFunctionalSkip = !!functional.skipped;
    console.log(`   ❌ Falhas de smoke: ${smokeFailures}`);
    console.log(`   ⚠️  Seed funcional pulado: ${hasFunctionalSkip ? 'SIM' : 'NAO'}\n`);

    const taxaSucesso = (
      (sucesso.flows + sucesso.agents + sucesso.queues + sucesso.departments) /
      Math.max(total.flows + total.agents + total.queues + total.departments, 1) * 100
    ).toFixed(2);

    console.log(`   📊 Taxa de sucesso geral: ${taxaSucesso}%\n`);

    if (Array.isArray(report.remainingLimitations) && report.remainingLimitations.length > 0) {
      console.log('⚠️  Pendências reais:');
      report.remainingLimitations.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
      console.log('');
    }

    const todosSucesso =
      smokeFailures === 0 &&
      !hasFunctionalSkip &&
      sucesso.flows === total.flows &&
      sucesso.queues === total.queues &&
      sucesso.departments === total.departments &&
      sucesso.agents === total.agents;

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
