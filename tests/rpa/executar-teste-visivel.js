/**
 * Executa teste RPA de forma visível usando a aplicação real
 * 
 * Execute: node tests/rpa/executar-teste-visivel.js
 */

const { RpaTestRunner } = require('./rpaTestRunner');
const { ActionRecorder } = require('./actionRecorder');

async function executarTesteVisivel() {
  console.log('🤖 Executando Teste RPA Visível\n');
  console.log('='.repeat(70));
  console.log('👀 O navegador será aberto e você verá a execução!');
  console.log('='.repeat(70));
  console.log('\n🚀 Iniciando em 2 segundos...\n');
  
  await new Promise(resolve => setTimeout(resolve, 2000));

  const runner = new RpaTestRunner({
    headless: false,  // Navegador visível
    slowMo: 500,      // Delay de 500ms entre ações para visualizar
  });

  try {
    console.log('1️⃣  Abrindo navegador...');
    await runner.init();
    console.log('✅ Navegador aberto!\n');

    // ============================================
    // Teste 1: Validação de página com nova funcionalidade
    // ============================================
    console.log('2️⃣  Testando validação de página em camadas...\n');
    
    const teste1 = {
      id: 'teste-validacao-pagina',
      name: 'Teste de Validação de Página',
      version: '1.0.0',
      steps: [
        {
          type: 'navigate',
          url: 'http://localhost:5173/login',
          waitFor: 'input[type="text"], input[type="email"]',
          timeout: 30000,
        },
        {
          type: 'wait',
          condition: 2000,
        },
        {
          type: 'assert',
          page: {
            url: {
              contains: '/login',
            },
            landmarks: [
              {
                selector: 'input[type="text"], input[type="email"], input[type="password"]',
                exists: true,
              },
            ],
          },
          validationMode: 'all',
          message: 'Página de login carregada corretamente',
          timeout: 30000,
        },
      ],
      data: {
        urls: {
          frontend: 'http://localhost:5173',
        },
      },
    };

    const resultado1 = await runner.playback(teste1);
    
    console.log('📊 Resultado do Teste 1:');
    console.log(`   - Sucesso: ${resultado1.success ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`   - Steps executados: ${resultado1.steps.length}`);
    console.log(`   - Erros: ${resultado1.errors.length}\n`);

    if (resultado1.steps.length > 0) {
      console.log('📝 Detalhes dos Steps:');
      resultado1.steps.forEach((step, index) => {
        const icon = step.success ? '✅' : '❌';
        console.log(`   ${icon} Step ${index + 1}: ${step.action}`);
        if (step.url) console.log(`      URL: ${step.url}`);
        if (step.selector) console.log(`      Seletor: ${step.selector}`);
        if (!step.success && step.error) {
          console.log(`      Erro: ${step.error}`);
        }
      });
      console.log('');
    }

    if (resultado1.errors.length > 0) {
      console.log('⚠️  Erros encontrados:');
      resultado1.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error.error}`);
      });
      console.log('');
    }

    // ============================================
    // Teste 2: Validação simples de título (se aplicável)
    // ============================================
    console.log('3️⃣  Testando validação simples...\n');
    
    // Aguarda um pouco antes do próximo teste
    await new Promise(resolve => setTimeout(resolve, 2000));

    const teste2 = {
      id: 'teste-simples',
      name: 'Teste Simples',
      version: '1.0.0',
      steps: [
        {
          type: 'navigate',
          url: 'http://localhost:5173',
          waitFor: 'body',
          timeout: 30000,
        },
        {
          type: 'wait',
          condition: 2000,
        },
        {
          type: 'assert',
          page: {
            url: {
              contains: 'localhost:5173',
            },
            landmarks: [
              {
                selector: 'body',
                exists: true,
              },
            ],
          },
          validationMode: 'any',
          message: 'Aplicação carregada',
          timeout: 30000,
        },
      ],
      data: {},
    };

    const resultado2 = await runner.playback(teste2);
    
    console.log('📊 Resultado do Teste 2:');
    console.log(`   - Sucesso: ${resultado2.success ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`   - Steps executados: ${resultado2.steps.length}`);
    console.log(`   - Erros: ${resultado2.errors.length}\n`);

    // ============================================
    // Relatório Final
    // ============================================
    console.log('📊 Relatório Final:\n');
    const report = runner.generateReport();
    console.log(`   Total de execuções: ${report.summary.total}`);
    console.log(`   Passou: ${report.summary.passed}`);
    console.log(`   Falhou: ${report.summary.failed}`);
    console.log(`   Taxa de sucesso: ${report.summary.successRate}\n`);

    // Aguarda um pouco antes de fechar
    console.log('⏳ Aguardando 3 segundos antes de fechar...\n');
    await new Promise(resolve => setTimeout(resolve, 3000));

  } catch (error) {
    console.error('\n❌ Erro durante execução:', error.message);
    
    if (error.message.includes('Cannot find module')) {
      console.error('\n💡 Solução:');
      console.error('   1. Instale Playwright: npx playwright install chromium');
      console.error('   2. Execute novamente: node tests/rpa/executar-teste-visivel.js\n');
    } else if (error.message.includes('net::ERR_CONNECTION_REFUSED') || error.message.includes('Navigation failed')) {
      console.error('\n💡 Solução:');
      console.error('   1. Certifique-se de que a aplicação está rodando em http://localhost:5173');
      console.error('   2. Inicie o servidor: npm run dev (ou comando equivalente)');
      console.error('   3. Execute novamente: node tests/rpa/executar-teste-visivel.js\n');
    } else {
      console.error('\nStack:', error.stack);
    }
  } finally {
    console.log('🔒 Fechando navegador...');
    await runner.close();
    console.log('✅ Navegador fechado!\n');
  }

  console.log('='.repeat(70));
  console.log('✨ Teste concluído!\n');
}

// Executa teste
if (require.main === module) {
  executarTesteVisivel().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });
}

module.exports = { executarTesteVisivel };

