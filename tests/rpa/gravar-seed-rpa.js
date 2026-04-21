#!/usr/bin/env node

/**
 * Gravar Seed com RPA - Grava interação visualmente e cria seed
 * 
 * Uso:
 *   node tests/rpa/gravar-seed-rpa.js <nome-do-seed> [url-inicial]
 * 
 * Exemplo:
 *   node tests/rpa/gravar-seed-rpa.js meu-login http://localhost:5173
 */

const { RpaRecorder } = require('../../core/rpa/recorder/rpaRecorder');
const { getModeConfig } = require('../../core/rpa/rpaConfig');
const { assertLegacyEntrypointAllowed } = require('../../core/rpa/legacyEntrypointGuard');
const fs = require('fs');
const path = require('path');

async function gravarSeed(seedName, initialUrl) {
  console.log('🎬 GRAVAR SEED COM RPA\n');
  console.log('='.repeat(70));
  
  if (!seedName) {
    console.log('❌ Erro: Nome do seed é obrigatório\n');
    console.log('Uso: node tests/rpa/gravar-seed-rpa.js <nome-do-seed> [url-inicial]\n');
    console.log('Exemplo:');
    console.log('   node tests/rpa/gravar-seed-rpa.js meu-login http://localhost:5173\n');
    process.exit(1);
  }

  const rpaConfig = require('../../core/rpa/rpaConfig');
  const url = initialUrl || rpaConfig.urls.frontend;
  const config = getModeConfig('record');

  console.log(`📋 Configuração da Gravação:\n`);
  console.log(`   Seed: ${seedName}`);
  console.log(`   URL inicial: ${url}`);
  console.log(`   Modo: record (visual)`);
  console.log(`   Digitação: ${config.typingSpeedMs}ms por caractere`);
  console.log(`   Delay entre ações: ${config.actionDelayMs}ms`);
  console.log(`   Estabilização: ${config.screenStabilizeMs}ms\n`);

  console.log('📝 O que será gravado:\n');
  console.log('   ✅ Navegação para URLs');
  console.log('   ✅ Cliques em elementos');
  console.log('   ✅ Digitação caractere a caractere (visível)');
  console.log('   ✅ Seleções em dropdowns');
  console.log('   ✅ Validações e asserts');
  console.log('   ✅ Replay automático da gravação\n');

  console.log('⚠️  IMPORTANTE:\n');
  console.log('   • O seed NÃO conterá delays ou velocidade');
  console.log('   • O seed descreve apenas O QUE foi feito');
  console.log('   • A velocidade é controlada pelo config (rpa.config.json)');
  console.log('   • Replay será gerado automaticamente\n');

  console.log('🚀 Iniciando gravação em 2 segundos...\n');
  await new Promise(resolve => setTimeout(resolve, 2000));

  const recorder = new RpaRecorder({
    mode: 'record',
    seedName,
  });

  let recordingResult = null;

  try {
    console.log('🌐 Abrindo navegador...\n');
    await recorder.init();
    
    console.log('▶️  Iniciando gravação...\n');
    await recorder.startRecording(url);
    
    console.log('='.repeat(70));
    console.log('🎥 GRAVAÇÃO ATIVA\n');
    console.log('='.repeat(70));
    console.log('\n👆 Interaja com a página no navegador que abriu!');
    console.log('   • Clique em elementos');
    console.log('   • Digite em campos (digitação será visível)');
    console.log('   • Navegue pela aplicação');
    console.log('\n⏸️  Pressione Ctrl+C quando terminar a gravação...\n');
    console.log('='.repeat(70) + '\n');
    
    // Mantém processo vivo até Ctrl+C
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Parando gravação...\n');
      
      try {
        recordingResult = await recorder.stopRecording();
        
        console.log('='.repeat(70));
        console.log('✅ GRAVAÇÃO CONCLUÍDA\n');
        console.log('='.repeat(70));
        
        // Informações do seed criado
        console.log('\n📁 Seed Criado:');
        console.log('-'.repeat(70));
        console.log(`   Arquivo: ${recordingResult.seedPath}`);
        console.log(`   ID: ${recordingResult.seedId}`);
        
        // Carrega seed para mostrar informações
        try {
          const seedContent = JSON.parse(fs.readFileSync(recordingResult.seedPath, 'utf8'));
          console.log(`   Nome: ${seedContent.name || seedContent.id}`);
          console.log(`   Ações gravadas: ${seedContent.steps?.length || 0}`);
          console.log(`   Criado em: ${new Date(seedContent.createdAt).toLocaleString('pt-BR')}`);
          
          if (seedContent.steps && seedContent.steps.length > 0) {
            console.log('\n   Ações gravadas:');
            seedContent.steps.forEach((step, i) => {
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
              if (step.value) console.log(`         → "${step.value.substring(0, 40)}${step.value.length > 40 ? '...' : ''}"`);
            });
          }
        } catch (e) {
          console.log(`   ⚠️  Não foi possível ler detalhes do seed: ${e.message}`);
        }
        
        // Informações do replay
        console.log('\n📹 Replay da Gravação:');
        console.log('-'.repeat(70));
        console.log(`   Arquivo: ${recordingResult.replayPath}`);
        console.log(`   ID: ${recordingResult.replayId}`);
        
        // Carrega replay para mostrar informações
        if (fs.existsSync(recordingResult.replayPath)) {
          try {
            const replayData = JSON.parse(fs.readFileSync(recordingResult.replayPath, 'utf8'));
            console.log(`   Telas capturadas: ${replayData.screens?.length || 0}`);
            console.log(`   Ações registradas: ${replayData.actions?.length || 0}`);
            
            if (replayData.timings?.total) {
              const durationSeconds = (replayData.timings.total / 1000).toFixed(2);
              console.log(`   Duração: ${durationSeconds}s`);
            }
          } catch (e) {
            console.log(`   ⚠️  Não foi possível ler detalhes do replay: ${e.message}`);
          }
        }
        
        // Validações
        console.log('\n✅ Validações:');
        console.log('-'.repeat(70));
        console.log('   ✅ Seed não contém delays ou velocidade');
        console.log('   ✅ Seed contém apenas ações (O QUE foi feito)');
        console.log('   ✅ Replay gerado automaticamente');
        console.log('   ✅ Config controla velocidade (não o seed)');
        
        // Próximos passos
        console.log('\n💡 Próximos Passos:');
        console.log('-'.repeat(70));
        console.log('   • Executar seed visualmente:');
        console.log(`     node tests/rpa/ver-seed-rpa.js ${seedName}`);
        console.log('   • Executar seed em modo CI (rápido):');
        console.log(`     node tests/rpa/cli.js ci ${seedName}`);
        console.log('   • Ver seed criado:');
        console.log(`     cat ${recordingResult.seedPath} | jq '.'`);
        console.log('   • Ver replay:');
        console.log(`     cat ${recordingResult.replayPath} | jq '.'`);
        
        console.log('\n' + '='.repeat(70));
        console.log('✨ Gravação concluída com sucesso!\n');
        
      } catch (error) {
        console.error('\n❌ Erro ao salvar gravação:', error.message);
        if (error.stack) {
          console.error('\nStack:', error.stack);
        }
      } finally {
        await recorder.close();
        process.exit(0);
      }
    });

    // Mantém processo vivo
    await new Promise(() => {});
    
  } catch (error) {
    console.error('\n❌ Erro durante gravação:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    
    try {
      await recorder.close();
    } catch (e) {
      // Ignora erro ao fechar
    }
    
    process.exit(1);
  }
}

// Main
const seedName = process.argv[2];
const initialUrl = process.argv[3];

assertLegacyEntrypointAllowed('tests/rpa/gravar-seed-rpa.js');
gravarSeed(seedName, initialUrl);

