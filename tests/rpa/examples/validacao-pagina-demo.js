/**
 * Demonstração de Validação de Página em Camadas
 * 
 * Este exemplo mostra como usar a nova funcionalidade de identificação
 * robusta de páginas usando múltiplas estratégias.
 */

const { ActionRecorder } = require('../actionRecorder');
const { RpaTestRunner } = require('../rpaTestRunner');

async function demonstrarValidacaoPagina() {
  console.log('🔍 Demonstração: Validação de Página em Camadas\n');
  console.log('='.repeat(70));

  const runner = new RpaTestRunner({
    headless: false,
    slowMo: 300,
  });

  try {
    await runner.init();
    console.log('✅ Browser inicializado\n');

    // ============================================
    // Exemplo 1: Validação simples de título
    // ============================================
    console.log('📄 Exemplo 1: Validação simples de título\n');
    
    const exemplo1 = {
      id: 'exemplo-titulo-simples',
      name: 'Validação de Título Simples',
      version: '1.0.0',
      steps: [
        {
          type: 'navigate',
          url: 'https://example.com',
          waitFor: 'h1',
        },
        {
          type: 'assert',
          title: 'Example Domain',
          message: 'Título deve ser Example Domain',
        },
      ],
      data: {},
    };

    const resultado1 = await runner.playback(exemplo1);
    console.log(`   Resultado: ${resultado1.success ? '✅ PASSOU' : '❌ FALHOU'}\n`);

    // ============================================
    // Exemplo 2: Validação de página SPA (URL + Landmark)
    // ============================================
    console.log('🌐 Exemplo 2: Validação de SPA (URL + Landmark)\n');
    
    const exemplo2 = {
      id: 'exemplo-spa',
      name: 'Validação de SPA',
      version: '1.0.0',
      steps: [
        {
          type: 'navigate',
          url: (() => {
            const rpaConfig = require('../rpaConfig');
            return `${rpaConfig.urls.frontend}/support`;
          })(),
          waitFor: '.support-page',
        },
        {
          type: 'wait',
          condition: 2000,
        },
        {
          type: 'assert',
          page: {
            url: {
              contains: '/support',
            },
            landmarks: [
              {
                selector: '.support-page',
                exists: true,
                visible: true,
              },
            ],
          },
          validationMode: 'all',
          message: 'Página deve ser a de suporte',
        },
      ],
      data: {},
    };

    const resultado2 = await runner.playback(exemplo2);
    console.log(`   Resultado: ${resultado2.success ? '✅ PASSOU' : '❌ FALHOU'}\n`);

    // ============================================
    // Exemplo 3: Validação completa (múltiplas estratégias)
    // ============================================
    console.log('🎯 Exemplo 3: Validação completa (múltiplas estratégias)\n');
    
    const exemplo3 = {
      id: 'exemplo-completo',
      name: 'Validação Completa',
      version: '1.0.0',
      steps: [
        {
          type: 'navigate',
          url: 'https://example.com',
          waitFor: 'h1',
        },
        {
          type: 'wait',
          condition: 2000,
        },
        {
          type: 'assert',
          page: {
            url: {
              exact: 'https://example.com/',
            },
            title: {
              exact: 'Example Domain',
            },
            landmarks: [
              {
                selector: 'h1',
                text: 'Example Domain',
                exists: true,
              },
            ],
          },
          validationMode: 'all',
          message: 'Página deve ser example.com (todas as estratégias)',
        },
      ],
      data: {},
    };

    const resultado3 = await runner.playback(exemplo3);
    console.log(`   Resultado: ${resultado3.success ? '✅ PASSOU' : '❌ FALHOU'}\n`);

    // ============================================
    // Exemplo 4: Validação flexível (modo "any")
    // ============================================
    console.log('🔀 Exemplo 4: Validação flexível (modo "any")\n');
    
    const exemplo4 = {
      id: 'exemplo-flexivel',
      name: 'Validação Flexível',
      version: '1.0.0',
      steps: [
        {
          type: 'navigate',
          url: 'https://example.com',
          waitFor: 'h1',
        },
        {
          type: 'wait',
          condition: 2000,
        },
        {
          type: 'assert',
          page: {
            url: {
              contains: '/dashboard', // Não vai passar
            },
            title: {
              contains: 'Example', // Vai passar
            },
            landmarks: [
              {
                selector: 'h1',
                exists: true, // Vai passar
              },
            ],
          },
          validationMode: 'any', // Qualquer estratégia pode passar
          message: 'Página deve ser example.com (qualquer estratégia)',
        },
      ],
      data: {},
    };

    const resultado4 = await runner.playback(exemplo4);
    console.log(`   Resultado: ${resultado4.success ? '✅ PASSOU' : '❌ FALHOU'}\n`);

    // ============================================
    // Exemplo 5: Usando ActionRecorder programaticamente
    // ============================================
    console.log('📝 Exemplo 5: Usando ActionRecorder programaticamente\n');
    
    const recorder = new ActionRecorder();
    recorder.start({
      name: 'exemplo-programatico',
      url: 'https://example.com',
    });

    recorder.recordNavigate('https://example.com', {
      waitFor: 'h1',
    });

    recorder.recordWait(2000);

    // Nova forma: validação de página completa
    recorder.recordAssert(null, {
      page: {
        url: {
          contains: 'example.com',
        },
        title: {
          exact: 'Example Domain',
        },
        landmarks: [
          {
            selector: 'h1',
            text: 'Example Domain',
            exists: true,
          },
        ],
      },
      validationMode: 'all',
      message: 'Página validada com sucesso',
    });

    recorder.stop();
    const filepath = recorder.save('exemplo-programatico');
    console.log(`   ✅ Gravação salva em: ${filepath}\n`);

    // ============================================
    // Relatório Final
    // ============================================
    console.log('📊 Relatório Final:\n');
    const report = runner.generateReport();
    console.log(`   Total: ${report.summary.total}`);
    console.log(`   Passou: ${report.summary.passed}`);
    console.log(`   Falhou: ${report.summary.failed}`);
    console.log(`   Taxa de sucesso: ${report.summary.successRate}\n`);

  } catch (error) {
    console.error('\n❌ Erro durante demonstração:', error.message);
    console.error(error.stack);
  } finally {
    await runner.close();
    console.log('✅ Browser fechado\n');
  }

  console.log('='.repeat(70));
  console.log('✨ Demonstração concluída!\n');
}

// Executa demonstração
if (require.main === module) {
  demonstrarValidacaoPagina().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });
}

module.exports = { demonstrarValidacaoPagina };

