/**
 * Seed da Plataforma com Debug Detalhado
 * 
 * Versão com logs detalhados e screenshots para debug
 * Execute: node tests/rpa/seedPlatformDebug.js
 */

const { RpaTestRunner } = require('../../core/rpa/rpaTestRunner');
const config = require('../../core/rpa/rpaConfig');
const { assertLegacyEntrypointAllowed } = require('../../core/rpa/legacyEntrypointGuard');
const fs = require('fs');
const path = require('path');

async function seedPlatformDebug() {
  console.log('🌱 Seed da Plataforma via RPA - Modo Debug\n');
  console.log('='.repeat(70));
  console.log('🔍 Modo debug ativado - logs detalhados e screenshots');
  console.log('='.repeat(70));
  console.log('\n🚀 Iniciando...\n');

  const runner = new RpaTestRunner({
    headless: false, // Mostra navegador
    slowMo: 1000,    // Delay maior para visualizar
  });

  const results = {
    login: null,
    errors: [],
    screenshots: [],
  };

  try {
    console.log('1️⃣  Inicializando navegador...');
    await runner.init();
    console.log('✅ Navegador aberto!\n');
    
    // Captura screenshot inicial
    const screenshot1 = await runner.executor.captureScreenshot('01-inicial');
    if (screenshot1) {
      results.screenshots.push(screenshot1);
      console.log(`📸 Screenshot: ${screenshot1}\n`);
    }

    // 1. Login
    console.log('2️⃣  Fazendo login...\n');
    console.log(`   URL: ${config.urls.frontend}/login`);
    console.log(`   Username: admin`);
    console.log(`   Password: ${config.credentials.admin.password ? '***' : 'NÃO CONFIGURADO'}\n`);
    
    const loginRecording = require('./seeds/seed-platform-login.json');
    
    // Navega para login
    console.log('   📍 Navegando para página de login...');
    const navResult = await runner.executor.executeAction(loginRecording.steps[0], {
      urls: { frontend: config.urls.frontend },
    });
    console.log(`   ${navResult.success ? '✅' : '❌'} Navegação: ${navResult.success ? 'OK' : navResult.error}`);
    
    if (!navResult.success) {
      const screenshot = await runner.executor.captureScreenshot('02-erro-navegacao');
      if (screenshot) results.screenshots.push(screenshot);
      throw new Error(`Falha na navegação: ${navResult.error}`);
    }

    // Aguarda página carregar
    await new Promise(resolve => setTimeout(resolve, 2000));
    const screenshot2 = await runner.executor.captureScreenshot('02-pagina-login');
    if (screenshot2) {
      results.screenshots.push(screenshot2);
      console.log(`📸 Screenshot da página de login: ${screenshot2}\n`);
    }

    // Tenta encontrar campo de username
    console.log('   🔍 Procurando campo de username...');
    try {
      const page = runner.executor.page;
      const usernameSelectors = [
        'input[type="text"]',
        'input[placeholder*="username"]',
        'input[placeholder*="usuário"]',
        'input[autocomplete="username"]',
      ];
      
      let usernameFound = false;
      for (const selector of usernameSelectors) {
        try {
          const count = await page.locator(selector).count();
          if (count > 0) {
            console.log(`   ✅ Campo encontrado: ${selector}`);
            usernameFound = true;
            break;
          }
        } catch (e) {
          // Continua tentando
        }
      }
      
      if (!usernameFound) {
        console.log('   ⚠️  Campo de username não encontrado com seletores padrão');
        console.log('   📸 Capturando screenshot para análise...');
        const screenshot = await runner.executor.captureScreenshot('03-username-nao-encontrado');
        if (screenshot) results.screenshots.push(screenshot);
      }
    } catch (error) {
      console.log(`   ⚠️  Erro ao procurar campo: ${error.message}`);
    }

    // Preenche username
    console.log('   ✏️  Preenchendo username...');
    const fillUserResult = await runner.executor.executeAction(loginRecording.steps[2], {
      admin: { username: 'admin' },
    });
    console.log(`   ${fillUserResult.success ? '✅' : '❌'} Username: ${fillUserResult.success ? 'OK' : fillUserResult.error}`);
    
    if (!fillUserResult.success) {
      const screenshot = await runner.executor.captureScreenshot('03-erro-username');
      if (screenshot) results.screenshots.push(screenshot);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Preenche password
    console.log('   🔒 Preenchendo senha...');
    const fillPassResult = await runner.executor.executeAction(loginRecording.steps[3], {
      admin: { password: config.credentials.admin.password },
    });
    console.log(`   ${fillPassResult.success ? '✅' : '❌'} Senha: ${fillPassResult.success ? 'OK' : fillPassResult.error}`);
    
    if (!fillPassResult.success) {
      const screenshot = await runner.executor.captureScreenshot('04-erro-password');
      if (screenshot) results.screenshots.push(screenshot);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
    const screenshot3 = await runner.executor.captureScreenshot('04-formulario-preenchido');
    if (screenshot3) {
      results.screenshots.push(screenshot3);
      console.log(`📸 Screenshot do formulário preenchido: ${screenshot3}\n`);
    }

    // Clica em submit
    console.log('   🖱️  Clicando em Entrar...');
    const clickResult = await runner.executor.executeAction(loginRecording.steps[5], {});
    console.log(`   ${clickResult.success ? '✅' : '❌'} Clique: ${clickResult.success ? 'OK' : clickResult.error}`);
    
    if (!clickResult.success) {
      const screenshot = await runner.executor.captureScreenshot('05-erro-clique');
      if (screenshot) results.screenshots.push(screenshot);
    }

    // Aguarda redirecionamento
    console.log('   ⏳ Aguardando redirecionamento...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const screenshot4 = await runner.executor.captureScreenshot('05-apos-login');
    if (screenshot4) {
      results.screenshots.push(screenshot4);
      console.log(`📸 Screenshot após login: ${screenshot4}\n`);
    }

    // Valida login
    console.log('   ✅ Validando login...');
    const assertResult = await runner.executor.executeAction(loginRecording.steps[6], {});
    console.log(`   ${assertResult.success ? '✅' : '❌'} Validação: ${assertResult.success ? 'OK' : assertResult.error}\n`);

    results.login = {
      success: assertResult.success,
      steps: [
        { ...navResult, action: 'navigate', url: loginRecording.steps[0].url },
        { ...fillUserResult, action: 'fill', selector: loginRecording.steps[2].selector, value: 'admin' },
        { ...fillPassResult, action: 'fill', selector: loginRecording.steps[3].selector, value: '***' },
        { ...clickResult, action: 'click', selector: loginRecording.steps[5].selector },
        { ...assertResult, action: 'assert', selector: loginRecording.steps[6].selector },
      ],
      errors: [navResult, fillUserResult, fillPassResult, clickResult, assertResult]
        .filter(r => !r.success)
        .map(r => ({ error: r.error })),
      recording: {
        id: loginRecording.id,
        name: loginRecording.name,
        steps: loginRecording.steps.length,
      },
    };

    if (results.login.success) {
      console.log('✅ Login realizado com sucesso!\n');
    } else {
      console.log('❌ Falha no login. Veja os screenshots para debug.\n');
    }

    // Relatório
    console.log('\n📊 Relatório:\n');
    console.log(`   ✅ Login: ${results.login.success ? 'SUCESSO' : 'FALHOU'}`);
    console.log(`   📸 Screenshots: ${results.screenshots.length}`);
    console.log(`   ❌ Erros: ${results.login.errors.length}\n`);

    if (results.screenshots.length > 0) {
      console.log('📸 Screenshots capturados:');
      results.screenshots.forEach((screenshot, index) => {
        console.log(`   ${index + 1}. ${screenshot}`);
      });
      console.log('');
    }

    // Salva relatório
    const reportPath = path.join(__dirname, 'reports', `seed-debug-${Date.now()}.json`);
    const reportDir = path.dirname(reportPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    fs.writeFileSync(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      results,
      screenshots: results.screenshots,
      config: {
        frontendUrl: config.urls.frontend,
        hasPassword: !!config.credentials.admin.password,
      },
    }, null, 2));

    console.log(`📄 Relatório salvo em: ${reportPath}\n`);

    console.log('⏳ Aguardando 5 segundos antes de fechar...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));

  } catch (error) {
    console.error('\n❌ Erro durante seed:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
    
    // Captura screenshot de erro
    try {
      const screenshot = await runner.executor.captureScreenshot('erro-fatal');
      if (screenshot) {
        results.screenshots.push(screenshot);
        console.log(`📸 Screenshot de erro: ${screenshot}`);
      }
    } catch (e) {
      // Ignora erro ao capturar screenshot
    }
    
    results.errors.push({
      type: 'fatal',
      error: error.message,
    });
  } finally {
    console.log('🔒 Fechando navegador...');
    await runner.close();
    console.log('✅ Navegador fechado!\n');
  }

  console.log('='.repeat(70));
  console.log('✨ Seed Debug concluído!\n');
  
  return results;
}

// Executa se chamado diretamente
if (require.main === module) {
  assertLegacyEntrypointAllowed('tests/rpa/seedPlatformDebug.js');
  seedPlatformDebug().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });
}

module.exports = { seedPlatformDebug };

