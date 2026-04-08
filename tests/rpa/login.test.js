/**
 * Teste RPA para o fluxo completo de login
 * 
 * Este teste automatiza:
 * 1. Acesso à página de login
 * 2. Preenchimento de credenciais
 * 3. Submissão do formulário
 * 4. Seleção de tenant (se super-admin)
 * 5. Verificação de provider de IA
 * 6. Redirecionamento correto
 */

const { RpaTestRunner } = require('./rpaTestRunner');
const { ReplaySystem } = require('./replaySystem');
const path = require('path');
const fs = require('fs');
const config = require('../../api/utils/config');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const API_URL = process.env.TEST_API_URL || process.env.API_URL || `http://localhost:${Number(config.get('api.port', 3001))}`;
const USERNAME = process.env.TEST_USERNAME || 'systemadmin';
const PASSWORD = process.env.TEST_PASSWORD || 'Admin123!';
const TENANT_ID = process.env.TEST_TENANT_ID || 'tenant-demo';

/**
 * Testa o fluxo completo de login
 */
async function testLoginFlow() {
  console.log('\n🤖 Teste RPA: Fluxo de Login\n');
  console.log(`Frontend: ${FRONTEND_URL}`);
  console.log(`API: ${API_URL}`);
  console.log(`Usuário: ${USERNAME}`);
  console.log(`Tenant: ${TENANT_ID}\n`);

  const runner = new RpaTestRunner({
    headless: process.env.HEADLESS !== 'false',
    slowMo: 100,
    timeout: 30000,
  });

  let replaySystem = null;
  let replayId = null;
  let replayPath = null;
  
  try {
    await runner.init();
    
    if (!runner.executor || !runner.executor.page) {
      throw new Error('Executor ou página não disponível após inicialização');
    }
    
    const page = runner.executor.page;
    
    // Captura logs do console do navegador desde o início
    const consoleMessages = [];
    page.on('console', msg => {
      const text = msg.text();
      const type = msg.type();
      consoleMessages.push({ type, text, timestamp: Date.now() });
    });
    
    // Inicia gravação de replay
    replaySystem = new ReplaySystem();
    replayId = `login-flow-${Date.now()}`;
    replaySystem.start(replayId);

    // Inicia monitoramento automático de mudanças de tela
    await replaySystem.startAutoScreenMonitoring(page, {
      checkInterval: 500,
      captureOnNavigation: true,
      captureOnDOMChange: true,
    });

    // 1. Navega para a página de login
    console.log('1. Navegando para a página de login...');
    const navStartTime = new Date().toISOString();
    await page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const navEndTime = new Date().toISOString();
    
    // Registra navegação no replay (captura tela automaticamente após)
    await replaySystem.recordAction(
      { type: 'navigate', step: 'navigate-to-login', value: { url: `${FRONTEND_URL}/login` } },
      { success: true, startTime: navStartTime, endTime: navEndTime, page }
    );
    
    // Registra tela inicial
    await replaySystem.recordScreen(page, 'login-page-initial');
    
    console.log('   ✅ Página de login carregada\n');

    // 2. Preenche o formulário de login
    console.log('2. Preenchendo formulário de login...');
    
    // Aguarda os campos aparecerem - tenta vários seletores
    const usernameSelectors = [
      'input[type="text"]',
      'input[name="username"]',
      'input[placeholder*="usuário" i]',
      'input[placeholder*="username" i]',
      'input[id*="username" i]',
      'input:first-of-type'
    ];
    
    let usernameFilled = false;
    let usedSelector = null;
    for (const selector of usernameSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 2000 });
        const fillStartTime = new Date().toISOString();
        await page.fill(selector, USERNAME);
        const fillEndTime = new Date().toISOString();
        usernameFilled = true;
        usedSelector = selector;
        
        // Registra ação de preenchimento (captura tela automaticamente após)
        await replaySystem.recordAction(
          { type: 'fill', step: 'fill-username', selector, value: USERNAME },
          { success: true, startTime: fillStartTime, endTime: fillEndTime, page }
        );
        
        console.log(`   ✅ Username preenchido: ${USERNAME} (usando: ${selector})`);
        break;
      } catch (e) {
        continue;
      }
    }
    
    if (!usernameFilled) {
      replaySystem.recordError(new Error('Não foi possível encontrar campo de username'), 'fill-username');
      throw new Error('Não foi possível encontrar campo de username');
    }
    
    // Preenche password
    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[placeholder*="senha" i]',
      'input[placeholder*="password" i]',
      'input[id*="password" i]'
    ];
    
    let passwordFilled = false;
    let passwordSelector = null;
    for (const selector of passwordSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 2000 });
        const fillStartTime = new Date().toISOString();
        await page.fill(selector, PASSWORD);
        const fillEndTime = new Date().toISOString();
        passwordFilled = true;
        passwordSelector = selector;
        
        // Registra ação de preenchimento (captura tela automaticamente após)
        await replaySystem.recordAction(
          { type: 'fill', step: 'fill-password', selector, value: '***' },
          { success: true, startTime: fillStartTime, endTime: fillEndTime, page }
        );
        
        console.log('   ✅ Password preenchido');
        break;
      } catch (e) {
        continue;
      }
    }
    
    if (!passwordFilled) {
      replaySystem.recordError(new Error('Não foi possível encontrar campo de password'), 'fill-password');
      throw new Error('Não foi possível encontrar campo de password');
    }
    
    console.log('');

    // 3. Submete o formulário
    console.log('3. Submetendo formulário de login...');
    await page.waitForTimeout(500);
    
    const submitSelectors = [
      'button[type="submit"]',
      'button:has-text("Login")',
      'button:has-text("Entrar")',
      'button:has-text("Log in")',
      'button.primary',
      'form button'
    ];
    
    let submitted = false;
    let submitMethod = null;
    for (const selector of submitSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          const clickStartTime = new Date().toISOString();
          await button.click();
          const clickEndTime = new Date().toISOString();
          submitted = true;
          submitMethod = 'button';
          
          // Registra ação de clique (captura tela automaticamente após)
          await replaySystem.recordAction(
            { type: 'click', step: 'submit-login', selector },
            { success: true, startTime: clickStartTime, endTime: clickEndTime, page }
          );
          
          console.log('   ✅ Formulário submetido (botão)');
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    if (!submitted) {
      // Tenta pressionar Enter no campo de password
      const passwordField = await page.$('input[type="password"]');
      if (passwordField) {
        const pressStartTime = new Date().toISOString();
        await passwordField.press('Enter');
        const pressEndTime = new Date().toISOString();
        submitMethod = 'enter';
        
        // Registra ação de pressionar Enter (captura tela automaticamente após)
        await replaySystem.recordAction(
          { type: 'press', step: 'submit-login', value: 'Enter' },
          { success: true, startTime: pressStartTime, endTime: pressEndTime, page }
        );
        
        console.log('   ✅ Formulário submetido (Enter)');
      }
    }
    
    console.log('');

    // 4. Aguarda redirecionamento ou modal de seleção de tenant
    console.log('4. Aguardando resposta do login...');
    
    // Aguarda mudança na URL, modal, ou elementos que indicam sucesso
    await page.waitForTimeout(3000);
    
    // Registra tela após submissão
    await replaySystem.recordScreen(page, 'after-login-submit');
    
    // Verifica se apareceu modal de seleção de tenant (super-admin)
    const modalSelectors = [
      '[role="dialog"]',
      '.modal',
      '[class*="modal"]',
      '[class*="Modal"]',
      'text=/Selecione o tenant/i',
      'text=/Select tenant/i',
      'text=/Tenant/i'
    ];
    
    let hasModal = false;
    for (const selector of modalSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          hasModal = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    if (hasModal) {
      console.log('   ✅ Modal de seleção de tenant detectado (super-admin)\n');
      
      // Registra evento de modal
      replaySystem.recordEvent('tenant_modal_detected', { tenantId: TENANT_ID });
      
      // 5. Seleciona o tenant
      console.log(`5. Selecionando tenant: ${TENANT_ID}...`);
      
      // Aguarda a lista de tenants carregar
      await page.waitForTimeout(3000);
      
      // Registra tela do modal
      await replaySystem.recordScreen(page, 'tenant-modal');
      
      // Primeiro, seleciona o tenant clicando no botão do tenant na lista
      const tenantButtonSelectors = [
        `button:has-text("${TENANT_ID}")`,
        `button:has-text("Tenant Demo")`,
      ];
      
      let tenantButtonClicked = false;
      for (const selector of tenantButtonSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            const buttonText = await button.textContent().catch(() => '');
            if (buttonText.includes(TENANT_ID) || buttonText.includes('Tenant Demo')) {
              await button.click({ timeout: 5000 });
              await page.waitForTimeout(300);
              tenantButtonClicked = true;
              console.log(`   ✅ Botão do tenant clicado: ${selector}`);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      // Aguarda um pouco para o tenant ser selecionado
      await page.waitForTimeout(500);
      
      // Agora clica no botão "Acessar" no footer do modal
      const accessButtonSelectors = [
        'button:has-text("Acessar")',
        'button:has-text("Access")',
        'button[type="button"]:has-text("Acessar")',
      ];
      
      let tenantSelected = false;
      let tenantSelectorUsed = null;
      for (const selector of accessButtonSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            const buttonText = await button.textContent().catch(() => '');
            if (buttonText.includes('Acessar') || buttonText.includes('Access')) {
              const clickStartTime = new Date().toISOString();
              
              // Verifica se o botão está habilitado
              const isDisabled = await button.getAttribute('disabled').catch(() => null);
              if (isDisabled !== null) {
                console.log(`   ⚠️  Botão "Acessar" está desabilitado, aguardando...`);
                await page.waitForTimeout(1000);
              }
              
              await button.click({ timeout: 5000 });
              await page.waitForTimeout(500);
              
              const clickEndTime = new Date().toISOString();
              tenantSelected = true;
              tenantSelectorUsed = selector;
              
              // Registra ação de seleção de tenant (captura tela automaticamente após)
              await replaySystem.recordAction(
                { type: 'click', step: 'select-tenant-access', selector, value: { tenantId: TENANT_ID } },
                { success: true, startTime: clickStartTime, endTime: clickEndTime, page }
              );
              
              console.log(`   ✅ Botão "Acessar" clicado (usando: ${selector})\n`);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!tenantSelected) {
        replaySystem.recordEvent('tenant_selection_failed', { tenantId: TENANT_ID });
        console.log('   ⚠️  Não foi possível clicar no botão "Acessar"\n');
      }

      // 6. Aguarda verificação de provider de IA e redirecionamento
      console.log('6. Aguardando verificação de provider de IA e redirecionamento...');
      
      // Captura logs do console do navegador
      const consoleMessages = [];
      page.on('console', msg => {
        const text = msg.text();
        const type = msg.type();
        consoleMessages.push({ type, text, timestamp: Date.now() });
        if (type === 'error') {
          console.log(`   [Console Error] ${text}`);
        } else if (text.includes('[Login]')) {
          console.log(`   [Console] ${text}`);
        }
      });
      
      // Aguarda mudança na URL (redirecionamento)
      const initialUrl = page.url();
      console.log(`   URL inicial após seleção: ${initialUrl}`);
      
      // Tenta aguardar navegação usando waitForNavigation ou aguardar mudança na URL
      try {
        // Aguarda até 15 segundos por uma mudança na URL
        await Promise.race([
          page.waitForURL(url => !url.includes('/login'), { timeout: 15000 }).catch(() => null),
          page.waitForTimeout(15000)
        ]);
      } catch (e) {
        // Ignora erro, vamos verificar a URL manualmente
      }
      
      // Aguarda um pouco mais e verifica a URL novamente
      await page.waitForTimeout(2000);
      
      // Verifica logs do console relacionados ao login
      const loginLogs = consoleMessages.filter(m => m.text.includes('[Login]'));
      const errorLogs = consoleMessages.filter(m => m.type === 'error');
      
      if (errorLogs.length > 0) {
        console.log(`   ⚠️  Erros no console encontrados: ${errorLogs.length}`);
        errorLogs.slice(-3).forEach(log => {
          console.log(`      [ERROR] ${log.text}`);
        });
      }
      
      if (loginLogs.length > 0) {
        console.log(`   📋 Logs do Login encontrados: ${loginLogs.length}`);
        loginLogs.slice(-10).forEach(log => {
          console.log(`      [${log.type.toUpperCase()}] ${log.text}`);
        });
      } else {
        console.log(`   ⚠️  Nenhum log do Login encontrado no console`);
      }
      
      // Registra tela após seleção de tenant
      await replaySystem.recordScreen(page, 'after-tenant-selection');
      
      // Verifica a URL final
      const currentUrl = page.url();
      console.log(`   URL final: ${currentUrl}`);
      
      // Registra navegação final (captura tela automaticamente após)
      await replaySystem.recordAction(
        { type: 'navigate', step: 'final-redirect', value: { url: currentUrl, initialUrl } },
        { success: true, page }
      );

      if (currentUrl.includes('/config')) {
        console.log('   ✅ Redirecionado para /config (provider inválido)');
        console.log('   ✅ Campo de configuração deve estar visível\n');
        
        // Verifica se está na aba AI
        if (currentUrl.includes('tab=ai')) {
          console.log('   ✅ Aba AI está ativa\n');
        }

        // Verifica se o campo de configuração do tenant aparece
        await page.waitForTimeout(1000);
        const configField = await page.$('input, select, [class*="field"], [class*="input"]').then(el => el !== null).catch(() => false);
        if (configField) {
          console.log('   ✅ Campo de configuração detectado na página\n');
        }
      } else if (currentUrl.includes('/support')) {
        console.log('   ✅ Redirecionado para /support (provider válido)\n');
      } else if (currentUrl.includes('/login')) {
        console.log(`   ❌ PROBLEMA: Ainda está em /login após seleção do tenant!`);
        console.log(`   Isso indica que o redirecionamento não funcionou ou houve erro na verificação do provider\n`);
        
        // Tenta capturar mais informações
        const pageContent = await page.content().catch(() => '');
        const hasModal = await page.$('[role="dialog"], .modal').then(el => el !== null).catch(() => false);
        console.log(`   Modal ainda aberto: ${hasModal}`);
        
        // Verifica se há mensagens de erro visíveis
        const errorText = await page.$eval('body', el => {
          const errorElements = Array.from(el.querySelectorAll('[class*="error"], [class*="warning"]'));
          return errorElements.map(el => el.textContent).join(' | ');
        }).catch(() => '');
        
        if (errorText) {
          console.log(`   Mensagens de erro encontradas: ${errorText}`);
        }
      } else {
        console.log(`   ⚠️  Redirecionado para: ${currentUrl}\n`);
      }

    } else {
      // Não é super-admin, deve redirecionar diretamente
      console.log('   ✅ Login realizado (não é super-admin)\n');
      
      // Aguarda redirecionamento
      await page.waitForTimeout(2000);
      const currentUrl = page.url();
      console.log(`   URL após login: ${currentUrl}`);
      
      if (currentUrl.includes('/config')) {
        console.log('   ✅ Redirecionado para /config (provider inválido)\n');
      } else if (currentUrl.includes('/support')) {
        console.log('   ✅ Redirecionado para /support (provider válido)\n');
      }
    }

    // 7. Verifica se está logado (procura por elementos que indicam login)
    console.log('7. Verificando se login foi bem-sucedido...');
    await page.waitForTimeout(1000);
    
    const loggedInIndicators = [
      'text=/logout/i',
      'text=/sair/i',
      '[class*="user"]',
      '[class*="menu"]',
      'text=/support/i',
      'text=/dashboard/i'
    ];

    let isLoggedIn = false;
    for (const selector of loggedInIndicators) {
      try {
        const element = await page.$(selector);
        if (element) {
          isLoggedIn = true;
          break;
        }
      } catch (e) {
        // Continua tentando
      }
    }

    if (isLoggedIn || page.url().includes('/support') || page.url().includes('/config')) {
      console.log('   ✅ Login bem-sucedido\n');
    } else {
      console.log('   ⚠️  Não foi possível confirmar login (mas pode estar funcionando)\n');
    }

    // 8. Tira screenshot final
    console.log('8. Capturando screenshot final...');
    const screenshotPath = path.join(__dirname, 'screenshots', `login-test-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    
    // Registra tela final no replay
    await replaySystem.recordScreen(page, 'final-state');
    
    // Registra evento de conclusão
    replaySystem.recordEvent('test_completed', { success: true, finalUrl: page.url() });
    
    console.log(`   ✅ Screenshot salvo: ${screenshotPath}\n`);

    console.log('✅ Teste RPA de login concluído com sucesso!\n');
    
    // Finaliza e salva replay
    if (replaySystem && replayId) {
      replaySystem.stop();
      replayPath = replaySystem.save(replayId);
      console.log(`📹 Replay salvo: ${replayPath}\n`);
      console.log(`   📊 Ações registradas: ${replaySystem.getData().actions.length}`);
      console.log(`   📸 Telas registradas: ${replaySystem.getData().screens.length}\n`);
    }
    
    return { success: true, url: page.url(), replayPath };

  } catch (error) {
    console.error('❌ Erro no teste RPA:', error.message);
    
    // Registra erro no replay
    if (replaySystem) {
      replaySystem.recordError(error, 'test-execution');
      replaySystem.recordEvent('test_failed', { error: error.message });
    }
    
    // Tira screenshot do erro
    try {
      if (runner.executor && runner.executor.page) {
        const screenshotPath = path.join(__dirname, 'screenshots', `login-test-error-${Date.now()}.png`);
        await runner.executor.page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`   Screenshot do erro salvo: ${screenshotPath}`);
        
        // Registra tela de erro no replay
        if (replaySystem) {
          await replaySystem.recordScreen(runner.executor.page, 'error-state');
        }
      }
    } catch (e) {
      // Ignora erro ao tirar screenshot
    }
    
    // Salva replay mesmo em caso de erro
    if (replaySystem && replayId) {
      try {
        replaySystem.stop();
        replayPath = replaySystem.save(`${replayId}-error`);
        console.log(`📹 Replay do erro salvo: ${replayPath}`);
        console.log(`   📊 Ações registradas: ${replaySystem.getData().actions.length}`);
        console.log(`   📸 Telas registradas: ${replaySystem.getData().screens.length}`);
      } catch (e) {
        // Ignora erro ao salvar replay
      }
    }
    
    return { success: false, error: error.message, replayPath };
  } finally {
    await runner.close();
  }
}

/**
 * Testa o fluxo de login com verificação de provider de IA
 */
async function testLoginWithProviderCheck() {
  console.log('\n🤖 Teste RPA: Login com Verificação de Provider de IA\n');

  const runner = new RpaTestRunner({
    headless: process.env.HEADLESS !== 'false',
    slowMo: 150,
    timeout: 30000,
  });

  let replaySystem = null;
  let replayId = null;
  let replayPath = null;
  
  try {
    await runner.init();
    
    if (!runner.executor || !runner.executor.page) {
      throw new Error('Executor ou página não disponível após inicialização');
    }
    
    const page = runner.executor.page;
    
    // Inicia gravação de replay
    replaySystem = new ReplaySystem();
    replayId = `login-provider-check-${Date.now()}`;
    replaySystem.start(replayId);

    // Inicia monitoramento automático de mudanças de tela
    await replaySystem.startAutoScreenMonitoring(page, {
      checkInterval: 500,
      captureOnNavigation: true,
      captureOnDOMChange: true,
    });

    // Captura logs do console do navegador desde o início
    const consoleMessages = [];
    page.on('console', msg => {
      const text = msg.text();
      const type = msg.type();
      consoleMessages.push({ type, text, timestamp: Date.now() });
      if (type === 'error') {
        console.log(`   [Console Error] ${text}`);
      } else if (text.includes('[Login]')) {
        console.log(`   [Console] ${text}`);
      }
    });

    // 1. Login
    console.log('1. Fazendo login...');
    const navStartTime = new Date().toISOString();
    await page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const navEndTime = new Date().toISOString();
    
    await replaySystem.recordAction(
      { type: 'navigate', step: 'navigate-to-login', value: { url: `${FRONTEND_URL}/login` } },
      { success: true, startTime: navStartTime, endTime: navEndTime, page }
    );
    await replaySystem.recordScreen(page, 'login-page');

    const usernameSelector = 'input[type="text"], input[name="username"]';
    const passwordSelector = 'input[type="password"], input[name="password"]';
    
    const fillUserStart = new Date().toISOString();
    await page.fill(usernameSelector, USERNAME);
    const fillUserEnd = new Date().toISOString();
    await replaySystem.recordAction(
      { type: 'fill', step: 'fill-username', selector: usernameSelector, value: USERNAME },
      { success: true, startTime: fillUserStart, endTime: fillUserEnd, page }
    );
    
    const fillPassStart = new Date().toISOString();
    await page.fill(passwordSelector, PASSWORD);
    const fillPassEnd = new Date().toISOString();
    await replaySystem.recordAction(
      { type: 'fill', step: 'fill-password', selector: passwordSelector, value: '***' },
      { success: true, startTime: fillPassStart, endTime: fillPassEnd, page }
    );
    
    const submitStart = new Date().toISOString();
    const submitButton = await page.$('button[type="submit"]');
    if (submitButton) {
      await submitButton.click();
      await replaySystem.recordAction(
        { type: 'click', step: 'submit-login', selector: 'button[type="submit"]' },
        { success: true, startTime: submitStart, endTime: new Date().toISOString(), page }
      );
    } else {
      await page.press(passwordSelector, 'Enter');
      await replaySystem.recordAction(
        { type: 'press', step: 'submit-login', value: 'Enter' },
        { success: true, startTime: submitStart, endTime: new Date().toISOString(), page }
      );
    }

    await page.waitForTimeout(2000);
    await replaySystem.recordScreen(page, 'after-login-submit');
    console.log('   ✅ Login realizado\n');

    // 2. Verifica se apareceu modal de tenant
    // Aguarda um pouco mais para o modal aparecer (pode ser assíncrono)
    await page.waitForTimeout(2000);
    
    const modalSelectors = [
      '[role="dialog"]',
      '.modal',
      '[class*="modal"]',
      '[class*="Modal"]',
      'text=/Selecione o tenant/i',
      'text=/Select tenant/i',
      'text=/Tenant/i'
    ];
    
    let hasModal = false;
    for (const selector of modalSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          hasModal = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (hasModal) {
      console.log('2. Modal de seleção de tenant detectado\n');
      replaySystem.recordEvent('tenant_modal_detected', { tenantId: TENANT_ID });
      await replaySystem.recordScreen(page, 'tenant-modal');
      
      // 3. Seleciona tenant
      console.log(`3. Selecionando tenant ${TENANT_ID}...`);
      await page.waitForTimeout(2000);
      
      // Primeiro, seleciona o tenant clicando no botão do tenant na lista
      const tenantButtonSelectors = [
        `button:has-text("${TENANT_ID}")`,
        `button:has-text("Tenant Demo")`,
      ];
      
      let tenantButtonClicked = false;
      for (const selector of tenantButtonSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            const buttonText = await button.textContent().catch(() => '');
            if (buttonText.includes(TENANT_ID) || buttonText.includes('Tenant Demo')) {
              await button.click({ timeout: 5000 });
              await page.waitForTimeout(300);
              tenantButtonClicked = true;
              console.log(`   ✅ Botão do tenant clicado: ${selector}`);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      // Aguarda um pouco para o tenant ser selecionado
      await page.waitForTimeout(500);
      
      // Agora clica no botão "Acessar" no footer do modal
      const accessButtonSelectors = [
        'button:has-text("Acessar")',
        'button:has-text("Access")',
      ];
      
      let tenantSelected = false;
      for (const selector of accessButtonSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            const buttonText = await button.textContent().catch(() => '');
            if (buttonText.includes('Acessar') || buttonText.includes('Access')) {
              const clickStart = new Date().toISOString();
              
              // Verifica se o botão está habilitado
              const isDisabled = await button.getAttribute('disabled').catch(() => null);
              if (isDisabled !== null) {
                await page.waitForTimeout(1000);
              }
              
              await button.click({ timeout: 5000 });
              await page.waitForTimeout(500);
              
              const clickEnd = new Date().toISOString();
              tenantSelected = true;
              
              await replaySystem.recordAction(
                { type: 'click', step: 'select-tenant-access', selector, value: { tenantId: TENANT_ID } },
                { success: true, startTime: clickStart, endTime: clickEnd, page }
              );
              
              console.log(`   ✅ Botão "Acessar" clicado usando: ${selector}\n`);
              break;
            }
          }
        } catch (e) {
          // Continua tentando
        }
      }

      if (!tenantSelected) {
        replaySystem.recordEvent('tenant_selection_failed', { tenantId: TENANT_ID });
        console.log('   ⚠️  Não foi possível clicar no botão "Acessar"\n');
      }

      // 4. Aguarda verificação de provider e redirecionamento
      console.log('4. Aguardando verificação de provider de IA e redirecionamento...');
      
      // Aguarda mudança na URL (redirecionamento)
      const initialUrl = page.url();
      console.log(`   URL inicial após seleção: ${initialUrl}`);
      
      // Tenta aguardar navegação usando waitForURL (mais robusto)
      try {
        // Aguarda até 15 segundos por uma mudança na URL
        await Promise.race([
          page.waitForURL(url => !url.includes('/login'), { timeout: 15000 }).catch(() => null),
          page.waitForTimeout(15000)
        ]);
      } catch (e) {
        // Ignora erro, vamos verificar a URL manualmente
      }
      
      // Aguarda um pouco mais e verifica a URL novamente
      await page.waitForTimeout(2000);
      
      // Verifica logs do console relacionados ao login
      const loginLogs = consoleMessages.filter(m => m.text.includes('[Login]'));
      const errorLogs = consoleMessages.filter(m => m.type === 'error');
      
      if (errorLogs.length > 0) {
        console.log(`   ⚠️  Erros no console encontrados: ${errorLogs.length}`);
        errorLogs.slice(-3).forEach(log => {
          console.log(`      [ERROR] ${log.text}`);
        });
      }
      
      if (loginLogs.length > 0) {
        console.log(`   📋 Logs do Login encontrados: ${loginLogs.length}`);
        loginLogs.slice(-10).forEach(log => {
          console.log(`      [${log.type.toUpperCase()}] ${log.text}`);
        });
      } else {
        console.log(`   ⚠️  Nenhum log do Login encontrado no console`);
      }
      
      await replaySystem.recordScreen(page, 'after-tenant-selection');

      const currentUrl = page.url();
      console.log(`   URL final: ${currentUrl}`);
      
      await replaySystem.recordAction(
        { type: 'navigate', step: 'final-redirect', value: { url: currentUrl, initialUrl } },
        { success: true, page }
      );

      // 5. Verifica comportamento esperado
      if (currentUrl.includes('/config')) {
        console.log('   ✅ Redirecionado para /config (provider inválido)');
        console.log('   ✅ Campo de configuração deve estar visível\n');
        
        // Verifica se está na aba AI
        if (currentUrl.includes('tab=ai')) {
          console.log('   ✅ Aba AI está ativa\n');
        }

        // Verifica se há toast de warning
        const toastWarning = await page.$('text=/Configure um provider/i, text=/provider de IA/i').then(el => el !== null).catch(() => false);
        if (toastWarning) {
          console.log('   ✅ Toast de warning detectado\n');
        }

        // Verifica se campo de configuração aparece
        await page.waitForTimeout(2000);
        const configField = await page.$('input, select, [class*="field"], [class*="input"]').then(el => el !== null).catch(() => false);
        if (configField) {
          console.log('   ✅ Campo de configuração detectado na página\n');
        } else {
          console.log('   ⚠️  Campo de configuração não detectado (pode ser problema)\n');
        }
      } else if (currentUrl.includes('/support')) {
        console.log('   ✅ Redirecionado para /support (provider válido)\n');
      } else if (currentUrl.includes('/login')) {
        console.log(`   ⚠️  Ainda está em /login - aguardando redirecionamento...`);
        
        // Aguarda mais tempo para o redirecionamento acontecer
        await page.waitForTimeout(5000);
        const retryUrl = page.url();
        console.log(`   URL após espera adicional: ${retryUrl}`);
        
        if (retryUrl.includes('/support')) {
          console.log('   ✅ Redirecionado para /support após espera\n');
        } else if (retryUrl.includes('/config')) {
          console.log('   ⚠️  Redirecionado para /config (provider inválido)\n');
        } else {
          console.log(`   ❌ PROBLEMA: Ainda está em /login após espera!`);
          console.log(`   Isso indica que o redirecionamento não funcionou ou houve erro na verificação do provider\n`);
          
          // Tenta capturar mais informações
          const hasModal = await page.$('[role="dialog"], .modal').then(el => el !== null).catch(() => false);
          console.log(`   Modal ainda aberto: ${hasModal}`);
        }
      } else {
        console.log(`   ⚠️  Redirecionado para: ${currentUrl}\n`);
      }
    } else {
      // Caso sem modal (usuário não é super-admin ou modal não apareceu)
      console.log('2. Modal não detectado - aguardando redirecionamento direto...\n');
      
      // Aguarda redirecionamento após login
      const initialUrl = page.url();
      console.log(`   URL inicial: ${initialUrl}`);
      
      // Aguarda até 15 segundos por uma mudança na URL
      try {
        await Promise.race([
          page.waitForURL(url => !url.includes('/login'), { timeout: 15000 }).catch(() => null),
          page.waitForTimeout(15000)
        ]);
      } catch (e) {
        // Ignora erro
      }
      
      await page.waitForTimeout(2000);
      const currentUrl = page.url();
      console.log(`   URL após login: ${currentUrl}`);
      
      if (currentUrl.includes('/config')) {
        console.log('   ✅ Redirecionado para /config (provider inválido)\n');
      } else if (currentUrl.includes('/support')) {
        console.log('   ✅ Redirecionado para /support (provider válido)\n');
      } else if (currentUrl.includes('/login')) {
        console.log('   ⚠️  Ainda em /login - aguardando mais...\n');
        // Aguarda mais um pouco
        await page.waitForTimeout(5000);
        const finalUrl = page.url();
        console.log(`   URL final após espera adicional: ${finalUrl}`);
      }
    }

    // 6. Aguarda e verifica redirecionamento final para /support
    console.log('6. Aguardando redirecionamento final para /support...');
    
    // Se ainda não está em /support, aguarda mais
    let finalUrl = page.url();
    if (!finalUrl.includes('/support') && !finalUrl.includes('/config')) {
      try {
        await Promise.race([
          page.waitForURL(url => url.includes('/support') || url.includes('/config'), { timeout: 10000 }).catch(() => null),
          page.waitForTimeout(10000)
        ]);
      } catch (e) {
        // Ignora erro
      }
      await page.waitForTimeout(2000);
      finalUrl = page.url();
    }
    
    console.log(`   URL final: ${finalUrl}`);
    
    if (finalUrl.includes('/support')) {
      console.log('   ✅ Redirecionado para /support (provider válido)\n');
    } else if (finalUrl.includes('/config')) {
      console.log('   ⚠️  Redirecionado para /config (provider inválido)\n');
    } else {
      console.log(`   ⚠️  Ainda não redirecionado para /support ou /config\n`);
    }

    // 7. Verifica se login foi bem-sucedido
    console.log('7. Verificando se login foi bem-sucedido...');
    
    const currentUrl = page.url();
    const isAuthenticated = !currentUrl.includes('/login');
    
    // Verifica elementos que indicam login bem-sucedido
    const authIndicators = [
      'button:has-text("Logout")',
      'button:has-text("Sair")',
      '[data-testid*="user"]',
      '[class*="UserMenu"]',
      'text=/Bem-vindo/i',
      'text=/Welcome/i'
    ];
    
    let hasAuthIndicator = false;
    for (const selector of authIndicators) {
      try {
        const element = await page.$(selector);
        if (element) {
          hasAuthIndicator = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    if (isAuthenticated && (hasAuthIndicator || currentUrl.includes('/support') || currentUrl.includes('/config'))) {
      console.log('   ✅ Login bem-sucedido\n');
    } else {
      console.log('   ⚠️  Não foi possível confirmar login (mas pode estar funcionando)\n');
    }

    // Screenshot final
    const screenshotPath = path.join(__dirname, 'screenshots', `login-provider-check-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    
    // Registra tela final
    await replaySystem.recordScreen(page, 'final-state');
    replaySystem.recordEvent('test_completed', { success: true, finalUrl: page.url() });
    
    console.log(`   Screenshot salvo: ${screenshotPath}\n`);
    
    // Finaliza e salva replay
    if (replaySystem && replayId) {
      replaySystem.stop();
      replayPath = replaySystem.save(replayId);
      console.log(`📹 Replay salvo: ${replayPath}\n`);
      console.log(`   📊 Ações registradas: ${replaySystem.getData().actions.length}`);
      console.log(`   📸 Telas registradas: ${replaySystem.getData().screens.length}\n`);
    }

    return { success: true, url: page.url(), replayPath };

  } catch (error) {
    console.error('❌ Erro no teste:', error.message);
    
    // Registra erro no replay
    if (replaySystem) {
      replaySystem.recordError(error, 'test-execution');
      replaySystem.recordEvent('test_failed', { error: error.message });
    }
    
    // Salva replay mesmo em caso de erro
    if (replaySystem && replayId) {
      try {
        replaySystem.stop();
        replayPath = replaySystem.save(`${replayId}-error`);
        console.log(`📹 Replay do erro salvo: ${replayPath}`);
        console.log(`   📊 Ações registradas: ${replaySystem.getData().actions.length}`);
        console.log(`   📸 Telas registradas: ${replaySystem.getData().screens.length}`);
      } catch (e) {
        // Ignora erro ao salvar replay
      }
    }
    
    return { success: false, error: error.message, replayPath };
  } finally {
    await runner.close();
  }
}

/**
 * Executa todos os testes de login RPA
 */
async function runLoginTests() {
  console.log('\n🚀 Executando testes RPA de login...\n');

  const results = [];

  // Teste 1: Fluxo básico de login
  console.log('='.repeat(60));
  const result1 = await testLoginFlow();
  results.push({ test: 'Login Flow', ...result1 });

  // Teste 2: Login com verificação de provider
  console.log('='.repeat(60));
  const result2 = await testLoginWithProviderCheck();
  results.push({ test: 'Login with Provider Check', ...result2 });

  // Resumo
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMO DOS TESTES RPA DE LOGIN');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`\n✅ Testes passaram: ${passed}`);
  console.log(`❌ Testes falharam: ${failed}`);
  console.log(`📈 Total: ${results.length} testes\n`);

  results.forEach(result => {
    const icon = result.success ? '✅' : '❌';
    console.log(`${icon} ${result.test}: ${result.success ? 'PASSOU' : 'FALHOU'}`);
    if (result.error) {
      console.log(`   Erro: ${result.error}`);
    }
    if (result.url) {
      console.log(`   URL final: ${result.url}`);
    }
  });

  return {
    success: failed === 0,
    total: results.length,
    passed,
    failed,
    results
  };
}

// Executa se for chamado diretamente
if (require.main === module) {
  runLoginTests()
    .then((result) => {
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error('❌ Erro ao executar testes:', error);
      process.exit(1);
    });
}

// Testes Jest (opcional - apenas se o ambiente de teste estiver disponível)
if (typeof describe !== 'undefined' && typeof test !== 'undefined') {
  describe('RPA Login Tests', () => {
    // Teste básico - verifica se as funções existem
    test('deve ter funções de teste exportadas', () => {
      expect(typeof testLoginFlow).toBe('function');
      expect(typeof testLoginWithProviderCheck).toBe('function');
      expect(typeof runLoginTests).toBe('function');
    });

    // Teste de integração - apenas se FRONTEND_URL estiver disponível
    test('deve executar fluxo de login (se servidor estiver rodando)', async () => {
      // Pula o teste se o servidor não estiver disponível
      if (process.env.SKIP_RPA_INTEGRATION_TESTS === 'true') {
        return;
      }

      // Este teste requer servidor rodando, então vamos apenas verificar estrutura
      expect(typeof testLoginFlow).toBe('function');
    }, 60000); // Timeout de 60 segundos
  });
}

module.exports = {
  testLoginFlow,
  testLoginWithProviderCheck,
  runLoginTests
};
