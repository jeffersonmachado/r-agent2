#!/usr/bin/env node

/**
 * Visualiza Replays do Teste de Login RPA
 * 
 * Uso:
 *   node tests/rpa/ver-replay-login.js                    # Lista replays disponíveis
 *   node tests/rpa/ver-replay-login.js <nome-do-replay>    # Mostra replay específico
 */

const fs = require('fs');
const path = require('path');

function verReplayLogin(replayName) {
  console.log('📹 REPLAYS DO TESTE DE LOGIN RPA\n');
  console.log('='.repeat(70));

  const replayDir = path.join(__dirname, 'replay');
  const screenshotsDir = path.join(__dirname, 'screenshots');

  // Lista replays disponíveis se não especificado
  if (!replayName) {
    console.log('📁 Replays Disponíveis:\n');
    
    if (!fs.existsSync(replayDir)) {
      console.log('   ⚠️  Nenhum replay encontrado.');
      console.log('   Execute o teste primeiro: node tests/rpa/login.test.js\n');
      return;
    }

    const replays = fs.readdirSync(replayDir)
      .filter(f => f.startsWith('login-') && f.endsWith('.json'))
      .map(f => ({
        name: f,
        path: path.join(replayDir, f),
        time: fs.statSync(path.join(replayDir, f)).mtime,
      }))
      .sort((a, b) => b.time - a.time);

    if (replays.length === 0) {
      console.log('   ⚠️  Nenhum replay encontrado.');
      console.log('   Execute o teste primeiro: node tests/rpa/login.test.js\n');
      return;
    }

    replays.forEach((replay, i) => {
      try {
        const replayData = JSON.parse(fs.readFileSync(replay.path, 'utf8'));
        const duration = replayData.endTime && replayData.startTime
          ? Math.round((new Date(replayData.endTime) - new Date(replayData.startTime)) / 1000)
          : 'N/A';
        
        console.log(`   ${i + 1}. ${replay.name}`);
        console.log(`      📊 ${replayData.actions?.length || 0} ações | ⏱️  ${duration}s | 📸 ${replayData.screens?.length || 0} telas`);
        console.log(`      🕐 ${replay.time.toLocaleString('pt-BR')}`);
      } catch (e) {
        console.log(`   ${i + 1}. ${replay.name}`);
        console.log(`      🕐 ${replay.time.toLocaleString('pt-BR')}`);
      }
    });

    console.log('\n   Use: node tests/rpa/ver-replay-login.js <nome-do-replay>');
    console.log('   Exemplo: node tests/rpa/ver-replay-login.js login-flow-1768067323557\n');
    return;
  }

  // Mostra replay específico
  const replayPath = path.join(replayDir, replayName.endsWith('.json') ? replayName : `${replayName}.json`);

  if (!fs.existsSync(replayPath)) {
    console.log(`\n❌ Replay não encontrado: ${replayName}`);
    console.log('   Use: node tests/rpa/ver-replay-login.js (sem argumentos para listar)\n');
    return;
  }

  try {
    const replayData = JSON.parse(fs.readFileSync(replayPath, 'utf8'));

    console.log(`\n📋 REPLAY: ${replayName}\n`);
    console.log('='.repeat(70));

    // Informações gerais
    console.log('\n📊 INFORMAÇÕES GERAIS\n');
    console.log(`   ID: ${replayData.id || 'N/A'}`);
    console.log(`   Recording ID: ${replayData.recordingId || 'N/A'}`);
    if (replayData.startTime) {
      console.log(`   Início: ${new Date(replayData.startTime).toLocaleString('pt-BR')}`);
    }
    if (replayData.endTime) {
      console.log(`   Fim: ${new Date(replayData.endTime).toLocaleString('pt-BR')}`);
    }
    if (replayData.startTime && replayData.endTime) {
      const duration = Math.round((new Date(replayData.endTime) - new Date(replayData.startTime)) / 1000);
      console.log(`   Duração: ${duration}s`);
    }

    // Ações
    if (replayData.actions && replayData.actions.length > 0) {
      console.log(`\n🎬 AÇÕES EXECUTADAS (${replayData.actions.length})\n`);
      console.log('─'.repeat(70));
      
      replayData.actions.forEach((action, index) => {
        const actionNames = {
          navigate: '🌐 NAVEGAR',
          fill: '✏️  PREENCHER',
          click: '🖱️  CLICAR',
          wait: '⏳ AGUARDAR',
          assert: '✅ VALIDAR',
        };
        
        const actionName = actionNames[action.type] || action.type.toUpperCase();
        const timestamp = action.timestamp 
          ? new Date(action.timestamp).toLocaleTimeString('pt-BR')
          : '';
        
        console.log(`\n${index + 1}. ${actionName} ${timestamp ? `[${timestamp}]` : ''}`);
        
        if (action.url) console.log(`   🌐 URL: ${action.url}`);
        if (action.selector) console.log(`   🎯 Seletor: ${action.selector}`);
        if (action.value) console.log(`   📝 Valor: ${action.value.substring(0, 50)}${action.value.length > 50 ? '...' : ''}`);
        if (action.waitFor) console.log(`   ⏳ Aguarda: ${action.waitFor}`);
      });
    }

    // Telas
    if (replayData.screens && replayData.screens.length > 0) {
      console.log(`\n📸 TELAS CAPTURADAS (${replayData.screens.length})\n`);
      console.log('─'.repeat(70));
      
      replayData.screens.forEach((screen, index) => {
        console.log(`\n${index + 1}. Tela ${screen.step || index + 1}`);
        if (screen.signature) console.log(`   🔑 Assinatura: ${screen.signature}`);
        if (screen.signatureData?.url) console.log(`   🌐 URL: ${screen.signatureData.url}`);
        if (screen.signatureData?.title) console.log(`   📄 Título: ${screen.signatureData.title}`);
        if (screen.timestamp) {
          console.log(`   🕐 ${new Date(screen.timestamp).toLocaleTimeString('pt-BR')}`);
        }
      });
    }

    // Erros
    if (replayData.errors && replayData.errors.length > 0) {
      console.log(`\n❌ ERROS (${replayData.errors.length})\n`);
      console.log('─'.repeat(70));
      
      replayData.errors.forEach((error, index) => {
        console.log(`\n${index + 1}. ${error.type || 'Erro'}`);
        console.log(`   Mensagem: ${error.message || error.error || 'N/A'}`);
        if (error.step) console.log(`   Step: ${error.step}`);
        if (error.timestamp) {
          console.log(`   🕐 ${new Date(error.timestamp).toLocaleTimeString('pt-BR')}`);
        }
      });
    }

    // Screenshots relacionados
    if (fs.existsSync(screenshotsDir)) {
      const screenshots = fs.readdirSync(screenshotsDir)
        .filter(f => f.startsWith('login-') && f.endsWith('.png'))
        .map(f => ({
          name: f,
          path: path.join(screenshotsDir, f),
          time: fs.statSync(path.join(screenshotsDir, f)).mtime,
        }))
        .sort((a, b) => b.time - a.time)
        .slice(0, 5);

      if (screenshots.length > 0) {
        console.log(`\n📸 SCREENSHOTS RELACIONADOS (${screenshots.length})\n`);
        console.log('─'.repeat(70));
        
        screenshots.forEach((screenshot, index) => {
          const sizeKB = (fs.statSync(screenshot.path).size / 1024).toFixed(1);
          console.log(`   ${index + 1}. ${screenshot.name} (${sizeKB} KB)`);
          console.log(`      📁 ${screenshot.path}`);
        });
      }
    }

    // Resumo
    console.log('\n' + '='.repeat(70));
    console.log('📈 RESUMO\n');
    console.log(`   ✅ Ações: ${replayData.actions?.length || 0}`);
    console.log(`   📸 Telas: ${replayData.screens?.length || 0}`);
    console.log(`   ❌ Erros: ${replayData.errors?.length || 0}`);
    if (replayData.startTime && replayData.endTime) {
      const duration = Math.round((new Date(replayData.endTime) - new Date(replayData.startTime)) / 1000);
      console.log(`   ⏱️  Duração: ${duration}s`);
    }
    console.log('');

  } catch (error) {
    console.error('❌ Erro ao ler replay:', error.message);
  }

  console.log('='.repeat(70));
  console.log('✨ Replay visualizado!\n');
}

// Executa se chamado diretamente
if (require.main === module) {
  const replayName = process.argv[2];
  verReplayLogin(replayName);
}

module.exports = { verReplayLogin };
