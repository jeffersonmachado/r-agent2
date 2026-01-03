/**
 * Gera Replay Detalhado do Seed
 * 
 * Cria um replay completo baseado na gravação e resultados
 * Execute: node tests/rpa/gerarReplayDetalhado.js
 */

const { ActionRecorder } = require('./actionRecorder');
const fs = require('fs');
const path = require('path');

function gerarReplayDetalhado() {
  console.log('📹 Gerando Replay Detalhado do Seed\n');
  console.log('='.repeat(70));

  // Carrega gravação de login
  try {
    const loginRecording = ActionRecorder.load('seed-platform-login');
    
    console.log('\n📋 GRAVAÇÃO: Seed Plataforma - Login\n');
    console.log(`   ID: ${loginRecording.id}`);
    console.log(`   Nome: ${loginRecording.name}`);
    console.log(`   Versão: ${loginRecording.version}`);
    console.log(`   Criada em: ${new Date(loginRecording.createdAt).toLocaleString('pt-BR')}`);
    console.log(`   Total de steps: ${loginRecording.steps.length}\n`);

    console.log('📝 REPLAY DOS STEPS:\n');
    console.log('─'.repeat(70));

    loginRecording.steps.forEach((step, index) => {
      const actionNames = {
        navigate: '🌐 NAVEGAR',
        fill: '✏️  PREENCHER',
        click: '🖱️  CLICAR',
        wait: '⏳ AGUARDAR',
        assert: '✅ VALIDAR',
      };
      
      const actionName = actionNames[step.type] || step.type.toUpperCase();
      const timestamp = new Date(step.timestamp).toLocaleTimeString('pt-BR');
      
      console.log(`\n${index + 1}. ${actionName} [${timestamp}]`);
      console.log('   ──────────────────────────────────────────────────────────');
      
      switch (step.type) {
        case 'navigate':
          console.log(`   🌐 URL: ${step.url}`);
          if (step.waitFor) console.log(`   ⏳ Aguarda: ${step.waitFor}`);
          console.log(`   ⏱️  Timeout: ${step.timeout}ms`);
          break;
          
        case 'fill':
          console.log(`   🎯 Seletor: ${step.selector}`);
          console.log(`   📝 Valor: ${step.value}`);
          if (step.clear !== false) console.log(`   🧹 Limpar antes: Sim`);
          if (step.validate) console.log(`   ✅ Validação: ${JSON.stringify(step.validate)}`);
          console.log(`   ⏱️  Timeout: ${step.timeout}ms`);
          break;
          
        case 'click':
          console.log(`   🎯 Seletor: ${step.selector}`);
          if (step.waitFor) console.log(`   ⏳ Aguarda: ${step.waitFor}`);
          if (step.force) console.log(`   💪 Force: Sim`);
          console.log(`   ⏱️  Timeout: ${step.timeout}ms`);
          break;
          
        case 'wait':
          if (typeof step.condition === 'number') {
            console.log(`   ⏱️  Aguarda: ${step.condition}ms`);
          } else {
            console.log(`   ⏳ Aguarda elemento: ${step.condition}`);
            if (step.state) console.log(`   📊 Estado: ${step.state}`);
          }
          console.log(`   ⏱️  Timeout: ${step.timeout}ms`);
          break;
          
        case 'assert':
          console.log(`   🎯 Seletor: ${step.selector}`);
          if (step.exists !== undefined) console.log(`   ✅ Existe: ${step.exists}`);
          if (step.visible !== undefined) console.log(`   👁️  Visível: ${step.visible}`);
          if (step.text) console.log(`   📝 Texto: ${step.text}`);
          if (step.value) console.log(`   📝 Valor: ${step.value}`);
          if (step.count !== undefined) console.log(`   🔢 Contagem: ${step.count}`);
          if (step.message) console.log(`   💬 Mensagem: ${step.message}`);
          console.log(`   ⏱️  Timeout: ${step.timeout}ms`);
          break;
      }
    });

    // Dados da gravação
    console.log('\n' + '─'.repeat(70));
    console.log('\n💾 DADOS DA GRAVAÇÃO:\n');
    if (loginRecording.data) {
      Object.entries(loginRecording.data).forEach(([key, value]) => {
        if (typeof value === 'object') {
          console.log(`   ${key}:`);
          Object.entries(value).forEach(([k, v]) => {
            if (k === 'password') {
              console.log(`      ${k}: ***`);
            } else {
              console.log(`      ${k}: ${v}`);
            }
          });
        } else {
          console.log(`   ${key}: ${value}`);
        }
      });
    }

    // Simulação de execução
    console.log('\n' + '='.repeat(70));
    console.log('🎬 SIMULAÇÃO DE EXECUÇÃO\n');
    console.log('─'.repeat(70));
    
    let tempoAcumulado = 0;
    loginRecording.steps.forEach((step, index) => {
      tempoAcumulado += step.timeout || 1000;
      const tempoRelativo = (tempoAcumulado / 1000).toFixed(1);
      
      const actionNames = {
        navigate: '🌐 Navegando',
        fill: '✏️  Preenchendo',
        click: '🖱️  Clicando',
        wait: '⏳ Aguardando',
        assert: '✅ Validando',
      };
      
      const actionName = actionNames[step.type] || step.type;
      console.log(`[+${tempoRelativo}s] ${actionName}...`);
      
      if (step.type === 'navigate' && step.url) {
        console.log(`         → ${step.url}`);
      } else if (step.type === 'fill' && step.selector) {
        const valor = step.value.includes('{{') ? step.value : step.value.substring(0, 30);
        console.log(`         → ${step.selector} = "${valor}"`);
      } else if (step.type === 'click' && step.selector) {
        console.log(`         → ${step.selector}`);
      }
    });

    console.log('\n' + '='.repeat(70));
    console.log('✨ Replay detalhado gerado!\n');
    
    // Salva replay formatado
    const replayPath = path.join(__dirname, 'reports', `replay-detalhado-${Date.now()}.txt`);
    const replayDir = path.dirname(replayPath);
    if (!fs.existsSync(replayDir)) {
      fs.mkdirSync(replayDir, { recursive: true });
    }

    // Gera texto formatado
    let replayText = '📹 REPLAY DETALHADO - Seed Plataforma\n';
    replayText += '='.repeat(70) + '\n\n';
    replayText += `Gravação: ${loginRecording.name}\n`;
    replayText += `ID: ${loginRecording.id}\n`;
    replayText += `Versão: ${loginRecording.version}\n`;
    replayText += `Criada em: ${new Date(loginRecording.createdAt).toLocaleString('pt-BR')}\n`;
    replayText += `Total de steps: ${loginRecording.steps.length}\n\n`;
    replayText += 'STEPS:\n';
    replayText += '─'.repeat(70) + '\n\n';
    
    loginRecording.steps.forEach((step, index) => {
      replayText += `${index + 1}. ${step.type.toUpperCase()}\n`;
      replayText += `   Timestamp: ${step.timestamp}\n`;
      if (step.url) replayText += `   URL: ${step.url}\n`;
      if (step.selector) replayText += `   Seletor: ${step.selector}\n`;
      if (step.value) replayText += `   Valor: ${step.value}\n`;
      if (step.waitFor) replayText += `   Aguarda: ${step.waitFor}\n`;
      if (step.condition) replayText += `   Condição: ${step.condition}\n`;
      replayText += `   Timeout: ${step.timeout}ms\n\n`;
    });

    fs.writeFileSync(replayPath, replayText, 'utf8');
    console.log(`📄 Replay em texto salvo em: ${replayPath}\n`);

  } catch (error) {
    console.error('❌ Erro ao gerar replay:', error.message);
  }
}

// Executa se chamado diretamente
if (require.main === module) {
  gerarReplayDetalhado();
}

module.exports = { gerarReplayDetalhado };

