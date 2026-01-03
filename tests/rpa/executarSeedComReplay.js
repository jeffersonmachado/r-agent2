/**
 * Executa Seed Completo e Mostra Replay
 * 
 * Executa o seed e mostra o replay detalhado
 * Execute: node tests/rpa/executarSeedComReplay.js
 */

const { seedPlatform } = require('./seedPlatformRPA');
const { gerarReplayDetalhado } = require('./gerarReplayDetalhado');
const { verReplaySeed } = require('./verReplaySeed');

async function executarSeedComReplay() {
  console.log('🌱 Executando Seed Completo com Replay\n');
  console.log('='.repeat(70));
  console.log('📹 Este script executará o seed e mostrará o replay completo');
  console.log('='.repeat(70));
  console.log('\n🚀 Iniciando execução...\n');

  try {
    // Executa seed
    const results = await seedPlatform();

    // Aguarda um pouco
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Mostra replay detalhado da gravação
    console.log('\n' + '='.repeat(70));
    console.log('📹 REPLAY DA GRAVAÇÃO DE LOGIN\n');
    console.log('='.repeat(70));
    gerarReplayDetalhado();

    // Mostra replay dos resultados
    console.log('\n' + '='.repeat(70));
    console.log('📊 REPLAY DOS RESULTADOS DA EXECUÇÃO\n');
    console.log('='.repeat(70));
    verReplaySeed();

    // Resumo final
    console.log('\n' + '='.repeat(70));
    console.log('✅ EXECUÇÃO CONCLUÍDA\n');
    console.log('='.repeat(70));
    
    const total = {
      flows: results.flows?.length || 0,
      queues: results.queues?.length || 0,
      departments: results.departments?.length || 0,
      agents: results.agents?.length || 0,
    };
    
    const sucesso = {
      flows: results.flows?.filter(f => f.success).length || 0,
      queues: results.queues?.filter(q => q.success).length || 0,
      departments: results.departments?.filter(d => d.success).length || 0,
      agents: results.agents?.filter(a => a.success).length || 0,
    };

    console.log('\n📈 RESUMO FINAL:\n');
    console.log(`   ✅ Login: ${results.login?.success ? 'SUCESSO' : 'FALHOU'}`);
    console.log(`   📝 Fluxos: ${sucesso.flows}/${total.flows}`);
    console.log(`   📋 Filas: ${sucesso.queues}/${total.queues}`);
    console.log(`   🏢 Departamentos: ${sucesso.departments}/${total.departments}`);
    console.log(`   👤 Agentes: ${sucesso.agents}/${total.agents}`);
    console.log(`   ❌ Erros: ${results.errors?.length || 0}\n`);

    console.log('📁 Arquivos gerados:');
    console.log('   - Relatórios em: tests/rpa/reports/');
    console.log('   - Screenshots em: tests/rpa/screenshots/');
    console.log('   - Replay detalhado em: tests/rpa/reports/replay-detalhado-*.txt\n');

  } catch (error) {
    console.error('\n❌ Erro durante execução:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
    process.exit(1);
  }
}

// Executa se chamado diretamente
if (require.main === module) {
  executarSeedComReplay();
}

module.exports = { executarSeedComReplay };

