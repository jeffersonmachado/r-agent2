#!/usr/bin/env node

/**
 * CLI para RPA de teste.
 * 
 * Modos:
 * - record: Grava interação humana
 * - playback: Reproduz seed visualmente
 * - ci: Reproduz seed em modo headless/rápido
 */

const { RpaRecorder } = require('./recorder/rpaRecorder');
const { RpaPlayer } = require('./player/rpaPlayer');
const path = require('path');

const rpaConfig = require('./rpaConfig');

const mode = process.argv[2];
const seedName = process.argv[3];
const initialUrl = process.argv[4] || rpaConfig.urls.frontend;

async function runRecord(seedName, initialUrl) {
  console.log('🎬 Modo RECORD - Gravação de interação');
  console.log(`   Seed: ${seedName}`);
  console.log(`   URL inicial: ${initialUrl}\n`);

  const recorder = new RpaRecorder({
    mode: 'record',
    seedName,
  });

  try {
    await recorder.init();
    await recorder.startRecording(initialUrl);
    
    // Aguarda interação do usuário
    console.log('\n⏸️  Pressione Ctrl+C para parar a gravação...\n');
    
    // Mantém processo vivo até Ctrl+C
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Parando gravação...');
      await recorder.stopRecording();
      await recorder.close();
      process.exit(0);
    });

    // Mantém processo vivo
    await new Promise(() => {});
  } catch (error) {
    console.error('❌ Erro na gravação:', error.message);
    await recorder.close();
    process.exit(1);
  }
}

async function runPlayback(seedName) {
  console.log('▶️  Modo PLAYBACK - Reprodução visual');
  console.log(`   Seed: ${seedName}\n`);

  const player = new RpaPlayer({
    mode: 'playback',
  });

  try {
    const result = await player.play(seedName);
    
    if (result.success) {
      console.log(`\n✅ Seed executado com sucesso!`);
      console.log(`   Replay: ${result.replayPath}`);
      process.exit(0);
    } else {
      console.error(`\n❌ Seed falhou!`);
      console.error(`   Erros: ${result.errors.length}`);
      result.errors.forEach((err, i) => {
        console.error(`   ${i + 1}. Step ${err.step}: ${err.error}`);
      });
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Erro na execução:', error.message);
    process.exit(1);
  }
}

async function runCI(seedName) {
  console.log('🚀 Modo CI - Execução headless/rápida');
  console.log(`   Seed: ${seedName}\n`);

  const player = new RpaPlayer({
    mode: 'ci',
  });

  try {
    const result = await player.play(seedName);
    
    if (result.success) {
      console.log(`\n✅ Seed executado com sucesso!`);
      console.log(`   Replay: ${result.replayPath}`);
      process.exit(0);
    } else {
      console.error(`\n❌ Seed falhou!`);
      console.error(`   Erros: ${result.errors.length}`);
      result.errors.forEach((err, i) => {
        console.error(`   ${i + 1}. Step ${err.step}: ${err.error}`);
      });
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Erro na execução:', error.message);
    process.exit(1);
  }
}

// Main
if (!mode || !['record', 'playback', 'ci'].includes(mode)) {
  console.log('Uso: node cli.js <mode> <seedName> [initialUrl]');
  console.log('');
  console.log('Modos:');
  console.log('  record <seedName> [initialUrl]  - Grava interação humana');
  console.log('  playback <seedName>            - Reproduz seed visualmente');
  console.log('  ci <seedName>                  - Reproduz seed em modo CI');
  console.log('');
  console.log('Exemplos:');
  console.log('  node cli.js record login-flow http://localhost:5173');
  console.log('  node cli.js playback login-flow');
  console.log('  node cli.js ci login-flow');
  process.exit(1);
}

if (mode === 'record') {
  if (!seedName) {
    console.error('❌ Erro: seedName é obrigatório no modo record');
    process.exit(1);
  }
  runRecord(seedName, initialUrl);
} else if (mode === 'playback') {
  if (!seedName) {
    console.error('❌ Erro: seedName é obrigatório no modo playback');
    process.exit(1);
  }
  runPlayback(seedName);
} else if (mode === 'ci') {
  if (!seedName) {
    console.error('❌ Erro: seedName é obrigatório no modo ci');
    process.exit(1);
  }
  runCI(seedName);
}

