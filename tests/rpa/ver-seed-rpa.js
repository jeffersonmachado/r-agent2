#!/usr/bin/env node

/**
 * Ver Seed com RPA - Executa uma seed visualmente com detalhes completos
 * 
 * Uso:
 *   node tests/rpa/ver-seed-rpa.js                    # Lista seeds disponíveis
 *   node tests/rpa/ver-seed-rpa.js <nome-do-seed>      # Executa seed visualmente
 * 
 * Exemplo:
 *   node tests/rpa/ver-seed-rpa.js example-login
 */

const { RpaPlayer } = require('../../core/rpa/player/rpaPlayer');
const { ActionRecorder } = require('../../core/rpa/actionRecorder');
const fs = require('fs');
const path = require('path');

async function verSeed(seedName) {
  console.log('🌱 VER SEED COM RPA\n');
  console.log('='.repeat(70));
  
  // Lista seeds disponíveis se não especificado
  if (!seedName) {
    console.log('📁 Seeds Disponíveis:\n');
    const recordings = ActionRecorder.list();
    
    if (recordings.length === 0) {
      console.log('   ⚠️  Nenhum seed encontrado');
      console.log('\n   Para criar um seed:');
      console.log('      node tests/rpa/cli.js record meu-seed http://localhost:5173\n');
      process.exit(1);
    }
    
    recordings.forEach((seed, i) => {
      // Tenta carregar seed para mostrar informações
      try {
        const seedData = ActionRecorder.load(seed);
        const stepsCount = seedData.steps?.length || 0;
        console.log(`   ${i + 1}. ${seed}`);
        console.log(`      📝 ${stepsCount} ações | Criado: ${new Date(seedData.createdAt).toLocaleDateString('pt-BR')}`);
      } catch (e) {
        console.log(`   ${i + 1}. ${seed}`);
      }
    });
    
    console.log('\n   Use: node tests/rpa/ver-seed-rpa.js <nome-do-seed>\n');
    process.exit(0);
  }

  console.log(`📋 Seed: ${seedName}`);
  console.log('='.repeat(70));
  console.log('\n👀 Você verá o navegador executar a seed visualmente!');
  console.log('   ✨ Digitação caractere a caractere');
  console.log('   ✨ Ações visíveis em tempo real');
  console.log('   ✨ Replay será gerado automaticamente\n');
  
  // Tenta carregar seed para mostrar preview
  try {
    const seedData = ActionRecorder.load(seedName);
    console.log('📝 Preview do Seed:\n');
    console.log(`   Nome: ${seedData.name || seedData.id}`);
    console.log(`   Versão: ${seedData.version || 'N/A'}`);
    console.log(`   Ações: ${seedData.steps?.length || 0}`);
    console.log(`   Criado: ${new Date(seedData.createdAt).toLocaleString('pt-BR')}`);
    
    if (seedData.steps && seedData.steps.length > 0) {
      console.log('\n   Ações que serão executadas:');
      seedData.steps.slice(0, 5).forEach((step, i) => {
        const actionName = {
          navigate: '🌐 NAVEGAR',
          fill: '✏️  PREENCHER',
          click: '🖱️  CLICAR',
          wait: '⏳ AGUARDAR',
          assert: '✅ VALIDAR',
          select: '📋 SELECIONAR',
        }[step.type] || step.type.toUpperCase();
        
        console.log(`      ${i + 1}. ${actionName}`);
        if (step.url) console.log(`         → ${step.url}`);
        if (step.selector) console.log(`         → ${step.selector}`);
        if (step.value) console.log(`         → "${step.value.substring(0, 30)}${step.value.length > 30 ? '...' : ''}"`);
      });
      if (seedData.steps.length > 5) {
        console.log(`      ... e mais ${seedData.steps.length - 5} ação(ões)`);
      }
    }
    console.log('');
  } catch (error) {
    console.log(`   ⚠️  Não foi possível carregar preview: ${error.message}\n`);
  }

  console.log('🚀 Iniciando execução em 2 segundos...\n');
  await new Promise(resolve => setTimeout(resolve, 2000));

  const player = new RpaPlayer({
    mode: 'playback', // Modo visual com digitação visível
  });

  try {
    console.log('▶️  Executando seed...\n');
    
    const result = await player.play(seedName);
    
    console.log('\n' + '='.repeat(70));
    console.log('📊 RESULTADO DA EXECUÇÃO\n');
    console.log('='.repeat(70));
    
    // Status geral
    if (result.success) {
      console.log('✅ Seed executado com SUCESSO!\n');
    } else {
      console.log('❌ Seed executado com ERROS!\n');
    }
    
    // Informações gerais
    console.log('📋 Informações Gerais:');
    console.log(`   Seed ID: ${result.seedId}`);
    console.log(`   Modo: ${result.mode}`);
    console.log(`   Velocidade: ${result.config?.speedMultiplier || 1.0}x`);
    console.log(`   Typing Speed: ${result.config?.typingSpeedMs || 50}ms por caractere`);
    console.log(`   Action Delay: ${result.config?.actionDelayMs || 300}ms entre ações`);
    console.log(`   Steps executados: ${result.steps.length}`);
    console.log(`   Erros: ${result.errors.length}`);
    
    // Detalhes dos steps
    if (result.steps.length > 0) {
      console.log('\n📝 Detalhes dos Steps Executados:');
      console.log('-'.repeat(70));
      
      result.steps.forEach((step, i) => {
        const icon = step.success ? '✅' : '❌';
        const actionName = {
          navigate: '🌐 NAVEGAR',
          fill: '✏️  PREENCHER',
          click: '🖱️  CLICAR',
          wait: '⏳ AGUARDAR',
          assert: '✅ VALIDAR',
          select: '📋 SELECIONAR',
        }[step.action] || step.action.toUpperCase();
        
        console.log(`\n   ${icon} Step ${i + 1}: ${actionName}`);
        
        if (step.selector) {
          console.log(`      Seletor: ${step.selector}`);
        }
        if (step.url) {
          console.log(`      URL: ${step.url}`);
        }
        if (step.error) {
          console.log(`      ⚠️  Erro: ${step.error}`);
        }
      });
    }
    
    // Erros detalhados
    if (result.errors.length > 0) {
      console.log('\n❌ Erros Encontrados:');
      console.log('-'.repeat(70));
      result.errors.forEach((err, i) => {
        console.log(`\n   ${i + 1}. Step ${err.step} (${err.action})`);
        console.log(`      Erro: ${err.error}`);
        if (err.code) {
          console.log(`      Código: ${err.code}`);
        }
      });
    }
    
    // Informações do Replay
    console.log('\n📹 Replay Gerado:');
    console.log('-'.repeat(70));
    console.log(`   Arquivo: ${result.replayPath}`);
    console.log(`   ID: ${result.replayId}`);
    
    // Carrega e mostra detalhes do replay
    if (fs.existsSync(result.replayPath)) {
      try {
        const replayData = JSON.parse(fs.readFileSync(result.replayPath, 'utf8'));
        
        console.log(`   Telas capturadas: ${replayData.screens?.length || 0}`);
        console.log(`   Ações registradas: ${replayData.actions?.length || 0}`);
        
        if (replayData.timings?.total) {
          const durationSeconds = (replayData.timings.total / 1000).toFixed(2);
          console.log(`   Duração total: ${durationSeconds}s (${replayData.timings.total}ms)`);
        }
        
        if (replayData.startTime && replayData.endTime) {
          const start = new Date(replayData.startTime).toLocaleString('pt-BR');
          const end = new Date(replayData.endTime).toLocaleString('pt-BR');
          console.log(`   Início: ${start}`);
          console.log(`   Fim: ${end}`);
        }
        
        if (replayData.errors && replayData.errors.length > 0) {
          console.log(`   Erros no replay: ${replayData.errors.length}`);
        }
      } catch (e) {
        console.log(`   ⚠️  Não foi possível ler detalhes do replay: ${e.message}`);
      }
    }
    
    // Estatísticas
    if (result.steps.length > 0) {
      const successCount = result.steps.filter(s => s.success).length;
      const failCount = result.steps.filter(s => !s.success).length;
      const successRate = ((successCount / result.steps.length) * 100).toFixed(1);
      
      console.log('\n📈 Estatísticas:');
      console.log('-'.repeat(70));
      console.log(`   Taxa de sucesso: ${successRate}%`);
      console.log(`   Ações bem-sucedidas: ${successCount}/${result.steps.length}`);
      console.log(`   Ações com erro: ${failCount}/${result.steps.length}`);
    }
    
    // Próximos passos
    console.log('\n💡 Próximos Passos:');
    console.log('-'.repeat(70));
    console.log('   • Ver replay completo:');
    console.log(`     cat ${result.replayPath} | jq '.'`);
    console.log('   • Executar em modo CI (rápido):');
    console.log(`     node tests/rpa/cli.js ci ${seedName}`);
    console.log('   • Ver screenshots (se houver erros):');
    console.log('     ls -la tests/rpa/screenshots/');
    
    console.log('\n' + '='.repeat(70));
    console.log('✨ Execução concluída!\n');
    
    if (result.success) {
      process.exit(0);
    } else {
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ Erro ao executar seed:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Main
const seedName = process.argv[2];
verSeed(seedName);

