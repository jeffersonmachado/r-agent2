/**
 * Demonstração Visual RPA - Navegador Real
 * 
 * Mostra o navegador abrindo, acessando páginas e digitando
 * Execute: node tests/rpa/demo-visual.js
 */

const { RpaTestRunner } = require('./rpaTestRunner');

async function demonstrarVisual() {
  console.log('🌐 Sistema RPA - Demonstração Visual\n');
  console.log('='.repeat(70));
  console.log('👀 Você verá o navegador abrir e executar ações!');
  console.log('='.repeat(70));
  console.log('\n🚀 Iniciando em 2 segundos...\n');
  
  await new Promise(resolve => setTimeout(resolve, 2000));

  const runner = new RpaTestRunner({
    headless: false,  // Mostra o navegador
    slowMo: 800,      // Delay de 800ms entre ações para visualizar melhor
  });

  try {
    console.log('1️⃣  Abrindo navegador Chromium...');
    await runner.init();
    console.log('✅ Navegador aberto! Você deve ver a janela do navegador.\n');
    
    await new Promise(resolve => setTimeout(resolve, 1000));

    // ============================================
    // Demonstração: Acessar Example.com
    // ============================================
    console.log('2️⃣  Navegando para https://example.com...');
    console.log('   👀 Observe o navegador acessando a página...\n');
    
    const gravação = {
      id: 'demo-visual-example',
      name: 'Demonstração Visual',
      version: '1.0.0',
      steps: [
        {
          type: 'navigate',
          url: 'https://example.com',
          waitFor: 'h1',
          timeout: 30000,
        },
        {
          type: 'wait',
          condition: 2000, // Aguarda 2 segundos para visualizar
        },
        {
          type: 'assert',
          selector: 'h1',
          exists: true,
          visible: true,
          text: 'Example Domain',
          message: 'Página carregada com sucesso',
        },
      ],
      data: {},
    };

    const resultado = await runner.playback(gravação);
    
    console.log('\n📊 Resultado da navegação:');
    console.log(`   ✅ Sucesso: ${resultado.success ? 'SIM' : 'NÃO'}`);
    console.log(`   📝 Steps executados: ${resultado.steps.length}`);
    
    if (resultado.steps.length > 0) {
      console.log('\n📋 Detalhes dos steps:');
      resultado.steps.forEach((step, index) => {
        const icon = step.success ? '✅' : '❌';
        console.log(`   ${icon} Step ${index + 1}: ${step.action.toUpperCase()}`);
        if (step.url) console.log(`      🌐 URL: ${step.url}`);
        if (step.selector) console.log(`      🎯 Elemento: ${step.selector}`);
        if (step.error) console.log(`      ⚠️  Erro: ${step.error}`);
      });
    }

    console.log('\n⏳ Aguardando 3 segundos para você visualizar...\n');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // ============================================
    // Demonstração: Acessar página de teste e preencher
    // ============================================
    console.log('3️⃣  Acessando página de teste e preenchendo formulário...');
    console.log('   👀 Observe o navegador preenchendo campos...\n');
    
    const gravação2 = {
      id: 'demo-visual-form',
      name: 'Preenchimento de Formulário',
      version: '1.0.0',
      steps: [
        {
          type: 'navigate',
          url: 'https://httpbin.org/forms/post',
          waitFor: 'form',
          timeout: 30000,
        },
        {
          type: 'wait',
          condition: 2000,
        },
        {
          type: 'fill',
          selector: 'input[name="custname"]',
          value: 'João Silva',
          clear: true,
          timeout: 30000,
        },
        {
          type: 'wait',
          condition: 1000,
        },
        {
          type: 'fill',
          selector: 'input[name="custtel"]',
          value: '11987654321',
          clear: true,
          timeout: 30000,
        },
        {
          type: 'wait',
          condition: 1000,
        },
        {
          type: 'fill',
          selector: 'input[name="custemail"]',
          value: 'joao@example.com',
          clear: true,
          timeout: 30000,
        },
        {
          type: 'wait',
          condition: 2000,
        },
        {
          type: 'assert',
          selector: 'input[name="custname"]',
          exists: true,
          value: 'João Silva',
          message: 'Nome preenchido corretamente',
        },
      ],
      data: {},
    };

    const resultado2 = await runner.playback(gravação2);
    
    console.log('\n📊 Resultado do preenchimento:');
    console.log(`   ✅ Sucesso: ${resultado2.success ? 'SIM' : 'NÃO'}`);
    console.log(`   📝 Steps executados: ${resultado2.steps.length}`);
    
    if (resultado2.steps.length > 0) {
      console.log('\n📋 Ações executadas:');
      resultado2.steps.forEach((step, index) => {
        const icon = step.success ? '✅' : '❌';
        const actionName = {
          navigate: '🌐 Navegar',
          fill: '✏️  Preencher',
          wait: '⏳ Aguardar',
          assert: '✅ Validar',
        }[step.action] || step.action.toUpperCase();
        
        console.log(`   ${icon} ${index + 1}. ${actionName}`);
        if (step.selector) console.log(`      Campo: ${step.selector}`);
        if (step.value) console.log(`      Valor: "${step.value}"`);
      });
    }

    console.log('\n⏳ Aguardando 5 segundos para você visualizar o formulário preenchido...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // ============================================
    // Relatório Final
    // ============================================
    console.log('\n📊 Relatório Final:\n');
    const report = runner.generateReport();
    console.log(`   📈 Total de execuções: ${report.summary.total}`);
    console.log(`   ✅ Passou: ${report.summary.passed}`);
    console.log(`   ❌ Falhou: ${report.summary.failed}`);
    console.log(`   📊 Taxa de sucesso: ${report.summary.successRate}\n`);

  } catch (error) {
    console.error('\n❌ Erro durante execução:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
  } finally {
    console.log('🔒 Fechando navegador em 2 segundos...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    await runner.close();
    console.log('✅ Navegador fechado!\n');
  }

  console.log('='.repeat(70));
  console.log('✨ Demonstração visual concluída!');
  console.log('\n💡 Você viu o sistema RPA:');
  console.log('   ✅ Abrir o navegador');
  console.log('   ✅ Navegar para páginas');
  console.log('   ✅ Preencher campos');
  console.log('   ✅ Validar elementos');
  console.log('   ✅ Executar ações automaticamente\n');
}

// Executa demonstração
if (require.main === module) {
  demonstrarVisual().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });
}

module.exports = { demonstrarVisual };

