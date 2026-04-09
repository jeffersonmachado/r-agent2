/**
 * Demonstração do Sistema RPA Funcionando
 * 
 * Execute: node tests/rpa/demo.js
 */

const { RpaTestRunner } = require('../../core/rpa/rpaTestRunner');
const { ActionRecorder } = require('../../core/rpa/actionRecorder');
const { assertLegacyEntrypointAllowed } = require('../../core/rpa/legacyEntrypointGuard');

async function demonstrarRPA() {
  console.log('🤖 Sistema RPA - Demonstração\n');
  console.log('='.repeat(60));
  
  // ============================================
  // 1. DEMONSTRAÇÃO: Criar Gravação
  // ============================================
  console.log('\n📹 1. Criando gravação de exemplo...\n');
  
  const recorder = new ActionRecorder();
  recorder.start({
    name: 'demo-exemplo',
    url: 'https://example.com',
    version: '1.0.0',
  });
  
  recorder.recordNavigate('https://example.com', {
    waitFor: 'h1',
    timeout: 10000,
  });
  
  recorder.recordWait(2000); // Aguarda 2 segundos
  
  recorder.recordAssert(null, {
    title: 'Example Domain',
    message: 'Título da página deve ser "Example Domain"',
  });
  
  recorder.stop();
  
  const filepath = recorder.save('demo-exemplo', {
    testData: {
      message: 'Este é um exemplo de gravação RPA',
    },
  });
  
  console.log(`✅ Gravação criada: ${filepath}`);
  console.log(`   - ${recorder.actions.length} ações gravadas`);
  
  // ============================================
  // 2. DEMONSTRAÇÃO: Executar Gravação
  // ============================================
  console.log('\n▶️  2. Executando gravação...\n');
  
  const runner = new RpaTestRunner({
    headless: true,
    slowMo: 100, // Mostra ações em câmera lenta
  });
  
  try {
    await runner.init();
    console.log('✅ Browser inicializado');
    
    const result = await runner.playback('demo-exemplo', {
      testData: {
        message: 'Dados de teste substituídos',
      },
    });
    
    console.log('\n📊 Resultado da Execução:');
    console.log('   - Sucesso:', result.success ? '✅ SIM' : '❌ NÃO');
    console.log('   - Total de steps:', result.steps.length);
    console.log('   - Erros:', result.errors.length);
    console.log('   - Duração:', result.duration, 'ms');
    
    if (result.steps.length > 0) {
      console.log('\n📝 Detalhes dos Steps:');
      result.steps.forEach((step, index) => {
        const icon = step.success ? '✅' : '❌';
        console.log(`   ${icon} Step ${step.step}: ${step.action} - ${step.selector || step.url || 'N/A'}`);
        if (!step.success && step.error) {
          console.log(`      Erro: ${step.error}`);
        }
      });
    }
    
    if (result.errors.length > 0) {
      console.log('\n⚠️  Erros encontrados:');
      result.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. Step ${error.step} (${error.action}): ${error.error}`);
      });
    }
    
    // ============================================
    // 3. DEMONSTRAÇÃO: Teste com Erro (para mostrar detecção)
    // ============================================
    console.log('\n🔍 3. Testando detecção de erros...\n');
    
    const recordingComErro = {
      id: 'demo-erro',
      name: 'Teste de Detecção de Erro',
      version: '1.0.0',
      steps: [
        {
          type: 'navigate',
          url: 'https://example.com',
        },
        {
          type: 'click',
          selector: 'button.inexistente-12345', // Elemento que não existe
          timeout: 2000,
        },
      ],
      data: {},
    };
    
    const resultadoErro = await runner.playback(recordingComErro);
    
    console.log('📊 Resultado do Teste de Erro:');
    console.log('   - Sucesso:', resultadoErro.success ? '✅ SIM' : '❌ NÃO (esperado)');
    console.log('   - Erros detectados:', resultadoErro.errors.length);
    
    if (resultadoErro.errors.length > 0) {
      console.log('\n✅ Sistema detectou erro corretamente:');
      console.log(`   - Tipo: ${resultadoErro.errors[0].action}`);
      console.log(`   - Mensagem: ${resultadoErro.errors[0].error}`);
    }
    
    // ============================================
    // 4. DEMONSTRAÇÃO: Relatório
    // ============================================
    console.log('\n📊 4. Gerando relatório...\n');
    
    const report = runner.generateReport();
    
    console.log('📈 Relatório Final:');
    console.log('   - Total de execuções:', report.summary.total);
    console.log('   - Passou:', report.summary.passed);
    console.log('   - Falhou:', report.summary.failed);
    console.log('   - Taxa de sucesso:', report.summary.successRate);
    
    const reportPath = runner.saveReport('demo-relatorio');
    console.log(`\n✅ Relatório salvo em: ${reportPath}`);
    
    // ============================================
    // 5. DEMONSTRAÇÃO: Listar Gravações
    // ============================================
    console.log('\n📁 5. Listando gravações disponíveis...\n');
    
    const gravações = ActionRecorder.list();
    console.log(`✅ ${gravações.length} gravação(ões) encontrada(s):`);
    gravações.forEach((grav, index) => {
      console.log(`   ${index + 1}. ${grav}`);
    });
    
  } catch (error) {
    console.error('\n❌ Erro durante demonstração:', error.message);
    console.error(error.stack);
  } finally {
    await runner.close();
    console.log('\n✅ Browser fechado');
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✨ Demonstração concluída!\n');
}

// Executa demonstração
if (require.main === module) {
  assertLegacyEntrypointAllowed('tests/rpa/demo.js');
  demonstrarRPA().catch(error => {
    console.error('Erro fatal:', error);
    process.exit(1);
  });
}

module.exports = { demonstrarRPA };

