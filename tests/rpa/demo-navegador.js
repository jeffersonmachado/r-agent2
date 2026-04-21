/**
 * Demonstração RPA com Navegador Real
 * 
 * Abre o navegador, acessa páginas e executa ações
 * Execute: node tests/rpa/demo-navegador.js
 */

const { RpaTestRunner } = require('../../core/rpa/rpaTestRunner');

async function demonstrarComNavegador() {
  console.log('🌐 Sistema RPA - Demonstração com Navegador Real\n');
  console.log('='.repeat(70));
  console.log('⚠️  ATENÇÃO: Esta demonstração abrirá um navegador real!');
  console.log('='.repeat(70));
  console.log('\n🚀 Iniciando...\n');

  const runner = new RpaTestRunner({
    headless: false, // Mostra o navegador
    slowMo: 500,     // Delay de 500ms entre ações para visualizar
  });

  try {
    console.log('1️⃣  Inicializando navegador...');
    await runner.init();
    console.log('✅ Navegador aberto!\n');

    // ============================================
    // Demonstração 1: Acessar Example.com
    // ============================================
    console.log('2️⃣  Acessando https://example.com...\n');
    
    const gravação1 = {
      id: 'demo-example-com',
      name: 'Acesso ao Example.com',
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
          title: 'Example Domain',
          message: 'Título da página deve ser "Example Domain"',
        },
      ],
      data: {},
    };

    const resultado1 = await runner.playback(gravação1);
    
    console.log('📊 Resultado:');
    console.log(`   - Sucesso: ${resultado1.success ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`   - Steps executados: ${resultado1.steps.length}`);
    console.log(`   - Erros: ${resultado1.errors.length}\n`);

    if (resultado1.steps.length > 0) {
      console.log('📝 Steps executados:');
      resultado1.steps.forEach((step, index) => {
        const icon = step.success ? '✅' : '❌';
        console.log(`   ${icon} ${index + 1}. ${step.action.toUpperCase()}`);
        if (step.selector) console.log(`      Seletor: ${step.selector}`);
        if (step.url) console.log(`      URL: ${step.url}`);
      });
    }

    // ============================================
    // Demonstração 2: Acessar Google e pesquisar
    // ============================================
    console.log('\n3️⃣  Acessando Google e fazendo pesquisa...\n');
    
    const gravação2 = {
      id: 'demo-google-search',
      name: 'Pesquisa no Google',
      version: '1.0.0',
      steps: [
        {
          type: 'navigate',
          url: 'https://www.google.com',
          waitFor: 'input[name="q"]',
          timeout: 30000,
        },
        {
          type: 'wait',
          condition: 1000,
        },
        {
          type: 'fill',
          selector: 'input[name="q"]',
          value: 'RPA automation testing',
          clear: true,
          timeout: 30000,
        },
        {
          type: 'wait',
          condition: 1000,
        },
        {
          type: 'assert',
          selector: 'input[name="q"]',
          exists: true,
          value: 'RPA automation testing',
          message: 'Campo de pesquisa deve conter o texto digitado',
        },
      ],
      data: {},
    };

    const resultado2 = await runner.playback(gravação2);
    
    console.log('📊 Resultado:');
    console.log(`   - Sucesso: ${resultado2.success ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`   - Steps executados: ${resultado2.steps.length}`);
    console.log(`   - Erros: ${resultado2.errors.length}\n`);

    if (resultado2.steps.length > 0) {
      console.log('📝 Steps executados:');
      resultado2.steps.forEach((step, index) => {
        const icon = step.success ? '✅' : '❌';
        console.log(`   ${icon} ${index + 1}. ${step.action.toUpperCase()}`);
        if (step.selector) console.log(`      Seletor: ${step.selector}`);
        if (step.value) console.log(`      Valor: ${step.value}`);
      });
    }

    // Aguarda um pouco antes de fechar
    console.log('\n⏳ Aguardando 3 segundos antes de fechar...\n');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // ============================================
    // Relatório Final
    // ============================================
    console.log('\n📊 Relatório Final:\n');
    const report = runner.generateReport();
    console.log(`   - Total de execuções: ${report.summary.total}`);
    console.log(`   - Passou: ${report.summary.passed}`);
    console.log(`   - Falhou: ${report.summary.failed}`);
    console.log(`   - Taxa de sucesso: ${report.summary.successRate}\n`);

  } catch (error) {
    console.error('\n❌ Erro durante execução:', error.message);
    
    if (error.message.includes('Cannot find module')) {
      console.error('\n💡 Solução:');
      console.error('   1. Instale Playwright: npx playwright install chromium');
      console.error('   2. Execute novamente: node tests/rpa/demo-navegador.js\n');
    } else {
      console.error('\nStack:', error.stack);
    }
  } finally {
    console.log('🔒 Fechando navegador...');
    await runner.close();
    console.log('✅ Navegador fechado!\n');
  }

  console.log('='.repeat(70));
  console.log('✨ Demonstração concluída!\n');
}

// Executa demonstração
if (require.main === module) {
  demonstrarComNavegador().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });
}

module.exports = { demonstrarComNavegador };

