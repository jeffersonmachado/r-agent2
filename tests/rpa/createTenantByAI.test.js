/**
 * Teste RPA para criar tenant por IA a partir de um site
 * 
 * Este teste automatiza:
 * 1. Navegação para o site alvo (https://studiooly.com.br/)
 * 2. Extração de informações do site
 * 3. Geração de descrição para IA
 * 4. Chamada à API para gerar tenant por IA
 * 5. Criação do tenant com os dados gerados
 * 6. Verificação do tenant criado
 */

const { RpaTestRunner } = require('./rpaTestRunner');
const { ReplaySystem } = require('./replaySystem');
const path = require('path');
const fs = require('fs');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const API_URL = process.env.API_URL || 'http://localhost:3000';
const USERNAME = process.env.TEST_USERNAME || 'systemadmin';
const PASSWORD = process.env.TEST_PASSWORD || 'Admin123!';
const TARGET_URL = process.env.TARGET_URL || 'https://studiooly.com.br/';
const SHOULD_RUN = process.env.RUN_RPA_CREATE_TENANT_BY_AI === '1';

/**
 * Extrai informações do site usando scraping básico
 */
async function extractSiteInfo(page) {
  console.log('   📄 Extraindo informações do site...');
  
  try {
    // Aguarda o conteúdo carregar
    try {
      await page.waitForLoadState('networkidle', { timeout: 10000 });
    } catch (e) {
      // Se waitForLoadState não funcionar, tenta waitForTimeout
      await page.waitForTimeout(2000);
    }
    await page.waitForTimeout(2000);
    
    // Extrai título da página
    const title = await page.title().catch(() => '');
    
    // Extrai meta description
    const metaDescription = await page.$eval('meta[name="description"]', el => el.content).catch(() => '');
    
    // Extrai texto principal da página
    const mainText = await page.evaluate(() => {
      // Remove scripts e styles
      const scripts = document.querySelectorAll('script, style, noscript');
      scripts.forEach(el => el.remove());
      
      // Tenta encontrar conteúdo principal
      const mainSelectors = ['main', 'article', '[role="main"]', '.content', '#content', 'body'];
      let text = '';
      
      for (const selector of mainSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          text = element.innerText || element.textContent || '';
          if (text.length > 100) break;
        }
      }
      
      // Limpa o texto
      return text
        .replace(/\s+/g, ' ')
        .replace(/\n+/g, ' ')
        .trim()
        .substring(0, 2000); // Limita a 2000 caracteres
    }).catch(() => '');
    
    // Extrai informações de contato se disponíveis
    const contactInfo = await page.evaluate(() => {
      const phoneRegex = /(\(?\d{2}\)?\s?)?(\d{4,5}[-.\s]?\d{4})/g;
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      
      const bodyText = document.body.innerText || '';
      const phones = bodyText.match(phoneRegex) || [];
      const emails = bodyText.match(emailRegex) || [];
      
      return {
        phones: [...new Set(phones)].slice(0, 3),
        emails: [...new Set(emails)].slice(0, 3),
      };
    }).catch(() => ({ phones: [], emails: [] }));
    
    // Extrai palavras-chave principais (h1, h2)
    const headings = await page.evaluate(() => {
      const h1 = Array.from(document.querySelectorAll('h1')).map(el => el.textContent.trim()).filter(t => t);
      const h2 = Array.from(document.querySelectorAll('h2')).map(el => el.textContent.trim()).filter(t => t);
      return { h1, h2 };
    }).catch(() => ({ h1: [], h2: [] }));
    
    return {
      url: page.url(),
      title,
      metaDescription,
      mainText,
      contactInfo,
      headings,
    };
  } catch (error) {
    console.log(`   ⚠️  Erro ao extrair informações: ${error.message}`);
    return {
      url: page.url(),
      title: '',
      metaDescription: '',
      mainText: '',
      contactInfo: { phones: [], emails: [] },
      headings: { h1: [], h2: [] },
    };
  }
}

/**
 * Gera descrição para IA baseada nas informações extraídas
 */
function generateDescriptionForAI(siteInfo) {
  let description = `Site: ${siteInfo.url}\n`;
  
  if (siteInfo.title) {
    description += `Título: ${siteInfo.title}\n`;
  }
  
  if (siteInfo.metaDescription) {
    description += `Descrição: ${siteInfo.metaDescription}\n`;
  }
  
  if (siteInfo.headings.h1.length > 0) {
    description += `Títulos principais: ${siteInfo.headings.h1.join(', ')}\n`;
  }
  
  if (siteInfo.headings.h2.length > 0) {
    description += `Subtítulos: ${siteInfo.headings.h2.slice(0, 5).join(', ')}\n`;
  }
  
  if (siteInfo.mainText) {
    const textPreview = siteInfo.mainText.substring(0, 500);
    description += `Conteúdo: ${textPreview}...\n`;
  }
  
  if (siteInfo.contactInfo.phones.length > 0) {
    description += `Telefones: ${siteInfo.contactInfo.phones.join(', ')}\n`;
  }
  
  if (siteInfo.contactInfo.emails.length > 0) {
    description += `Emails: ${siteInfo.contactInfo.emails.join(', ')}\n`;
  }
  
  return description;
}

/**
 * Testa o fluxo completo de criação de tenant por IA
 */
async function testCreateTenantByAI() {
  console.log('\n🤖 Teste RPA: Criar Tenant por IA do Site\n');
  console.log(`Frontend: ${FRONTEND_URL}`);
  console.log(`API: ${API_URL}`);
  console.log(`Site alvo: ${TARGET_URL}`);
  console.log(`Usuário: ${USERNAME}\n`);

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
    
    // Inicia gravação de replay
    replaySystem = new ReplaySystem();
    replayId = `create-tenant-ai-${Date.now()}`;
    replaySystem.start(replayId);

    // Inicia monitoramento automático de mudanças de tela
    await replaySystem.startAutoScreenMonitoring(page, {
      checkInterval: 500,
      captureOnNavigation: true,
      captureOnDOMChange: true,
    });

    // 1. Faz login no sistema
    console.log('1. Fazendo login no sistema...');
    const navStartTime = new Date().toISOString();
    await page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const navEndTime = new Date().toISOString();
    
    await replaySystem.recordAction(
      { type: 'navigate', step: 'navigate-to-login', value: { url: `${FRONTEND_URL}/login` } },
      { success: true, startTime: navStartTime, endTime: navEndTime, page }
    );
    await replaySystem.recordScreen(page, 'login-page-initial');
    
    // Preenche credenciais
    const usernameSelectors = [
      'input[type="text"]',
      'input[name="username"]',
      'input[placeholder*="usuário" i]',
      'input:first-of-type'
    ];
    
    let usernameFilled = false;
    for (const selector of usernameSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 2000 });
        const fillStartTime = new Date().toISOString();
        await page.fill(selector, USERNAME);
        const fillEndTime = new Date().toISOString();
        usernameFilled = true;
        
        await replaySystem.recordAction(
          { type: 'fill', step: 'fill-username', selector, value: USERNAME },
          { success: true, startTime: fillStartTime, endTime: fillEndTime, page }
        );
        break;
      } catch (e) {
        continue;
      }
    }
    
    if (!usernameFilled) {
      throw new Error('Não foi possível encontrar campo de username');
    }
    
    const passwordSelectors = ['input[type="password"]', 'input[name="password"]'];
    let passwordFilled = false;
    for (const selector of passwordSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 2000 });
        const fillStartTime = new Date().toISOString();
        await page.fill(selector, PASSWORD);
        const fillEndTime = new Date().toISOString();
        passwordFilled = true;
        
        await replaySystem.recordAction(
          { type: 'fill', step: 'fill-password', selector, value: '***' },
          { success: true, startTime: fillStartTime, endTime: fillEndTime, page }
        );
        break;
      } catch (e) {
        continue;
      }
    }
    
    if (!passwordFilled) {
      throw new Error('Não foi possível encontrar campo de password');
    }
    
    // Submete formulário
    const submitButton = await page.$('button[type="submit"]').catch(() => null);
    if (submitButton) {
      const clickStartTime = new Date().toISOString();
      await submitButton.click();
      const clickEndTime = new Date().toISOString();
      
      await replaySystem.recordAction(
        { type: 'click', step: 'submit-login', selector: 'button[type="submit"]' },
        { success: true, startTime: clickStartTime, endTime: clickEndTime, page }
      );
    } else {
      await page.press('input[type="password"]', 'Enter');
      await replaySystem.recordAction(
        { type: 'press', step: 'submit-login', value: 'Enter' },
        { success: true, page }
      );
    }
    
    await page.waitForTimeout(3000);
    await replaySystem.recordScreen(page, 'after-login');
    console.log('   ✅ Login realizado\n');

    // Aguarda um pouco mais para garantir que o token seja salvo
    await page.waitForTimeout(1000);
    
    // Verifica se há modal de seleção de tenant (super-admin)
    const hasModal = await page.$('[role="dialog"], .modal').then(el => el !== null).catch(() => false);
    if (hasModal) {
      console.log('   📋 Modal de tenant detectado, selecionando tenant...');
      await page.waitForTimeout(2000);
      
      // Tenta selecionar um tenant (pode precisar ajustar o seletor)
      const tenantButton = await page.$('button:has-text("tenant-demo"), button:has-text("Tenant Demo")').catch(() => null);
      if (tenantButton) {
        await tenantButton.click();
        await page.waitForTimeout(500);
        
        const accessButton = await page.$('button:has-text("Acessar"), button:has-text("Access")').catch(() => null);
        if (accessButton) {
          await accessButton.click();
          await page.waitForTimeout(2000);
        }
      }
    }

    // 2. Navega para o site alvo
    console.log(`2. Navegando para o site: ${TARGET_URL}...`);
    const siteNavStartTime = new Date().toISOString();
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000); // Aguarda conteúdo carregar
    const siteNavEndTime = new Date().toISOString();
    
    await replaySystem.recordAction(
      { type: 'navigate', step: 'navigate-to-target-site', value: { url: TARGET_URL } },
      { success: true, startTime: siteNavStartTime, endTime: siteNavEndTime, page }
    );
    await replaySystem.recordScreen(page, 'target-site-loaded');
    console.log('   ✅ Site carregado\n');

    // 3. Extrai informações do site
    console.log('3. Extraindo informações do site...');
    const siteInfo = await extractSiteInfo(page);
    
    await replaySystem.recordAction(
      { type: 'extract', step: 'extract-site-info', value: { url: siteInfo.url, title: siteInfo.title } },
      { success: true, page }
    );
    
    console.log(`   📄 Título: ${siteInfo.title}`);
    console.log(`   📝 Texto extraído: ${siteInfo.mainText.substring(0, 100)}...`);
    console.log(`   📧 Contatos: ${siteInfo.contactInfo.emails.length} emails, ${siteInfo.contactInfo.phones.length} telefones\n`);

    // 4. Gera descrição para IA
    console.log('4. Gerando descrição para IA...');
    const description = generateDescriptionForAI(siteInfo);
    console.log(`   📋 Descrição gerada (${description.length} caracteres)\n`);

    // 5. Navega para a página de tenants
    console.log('5. Navegando para página de tenants...');
    const tenantsNavStartTime = new Date().toISOString();
    await page.goto(`${FRONTEND_URL}/tenants`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const tenantsNavEndTime = new Date().toISOString();
    
    await replaySystem.recordAction(
      { type: 'navigate', step: 'navigate-to-tenants', value: { url: `${FRONTEND_URL}/tenants` } },
      { success: true, startTime: tenantsNavStartTime, endTime: tenantsNavEndTime, page }
    );
    await replaySystem.recordScreen(page, 'tenants-page');
    console.log('   ✅ Página de tenants carregada\n');

    // 6. Configura provider de IA para tenant "system" (se necessário)
    console.log('6. Verificando/configurando provider de IA para tenant "system"...');
    
    // Obtém token de autenticação do localStorage (chave: auth_token)
    const token = await page.evaluate(() => {
      return localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token') || null;
    }).catch(() => null);
    
    if (!token) {
      throw new Error('Token de autenticação não encontrado');
    }
    
    // Verifica se o tenant "system" tem provider configurado
    const systemAiConfig = await page.evaluate(async ({ apiUrl, token }) => {
      try {
        const response = await fetch(`${apiUrl}/tenants/system/ai-config`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });
        
        if (response.ok) {
          return await response.json();
        }
        return null;
      } catch (e) {
        return null;
      }
    }, { apiUrl: API_URL, token }).catch(() => null);
    
    // Se não tiver provider configurado, tenta configurar um padrão (OpenAI)
    if (!systemAiConfig || !systemAiConfig.config || !systemAiConfig.config.primary) {
      console.log('   ⚠️  Provider de IA não configurado para tenant "system"');
      console.log('   💡 Tentando configurar provider padrão...');
      
      // Tenta configurar OpenAI como provider padrão (sem API key - pode falhar, mas tenta)
      const configResult = await page.evaluate(async ({ apiUrl, token }) => {
        try {
          const response = await fetch(`${apiUrl}/tenants/system/ai-config`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
              primary: 'openai',
              configured: false, // Indica que precisa de API key
            }),
          });
          
          if (response.ok) {
            return await response.json();
          }
          const error = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
          return { error: error.message || `HTTP ${response.status}` };
        } catch (e) {
          return { error: e.message };
        }
      }, { apiUrl: API_URL, token }).catch(() => ({ error: 'Erro ao configurar' }));
      
      if (configResult.error) {
        console.log(`   ⚠️  Não foi possível configurar provider: ${configResult.error}`);
        console.log('\n   📋 INSTRUÇÕES PARA CONFIGURAR PROVIDER DE IA:');
        console.log('   1. Acesse: http://localhost:5173/config?tab=ai');
        console.log('   2. Configure um provider de IA (OpenAI, Anthropic, etc.)');
        console.log('   3. Adicione a API key do provider');
        console.log('   4. Execute o teste novamente\n');
        throw new Error('Provider de IA não configurado para tenant "system". Configure em /config?tab=ai');
      } else {
        console.log('   ✅ Configuração de provider salva');
        console.log('   ⚠️  Nota: Você ainda precisa adicionar a API key do provider');
        console.log('   💡 Acesse: /config?tab=ai para adicionar a API key\n');
      }
    } else {
      console.log(`   ✅ Provider de IA já configurado: ${systemAiConfig.config.primary}\n`);
    }

    // 7. Chama API para gerar tenant por IA
    console.log('7. Gerando tenant por IA via API...');
    
    // Faz requisição à API
    const generateResponse = await page.evaluate(async ({ apiUrl, token, description }) => {
      const response = await fetch(`${apiUrl}/tenants/generate-by-ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ description }),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(error.message || `HTTP ${response.status}`);
      }
      
      return await response.json();
    }, { apiUrl: API_URL, token, description }).catch(error => {
      console.error(`   ❌ Erro ao gerar tenant por IA: ${error.message}`);
      
      // Mensagem mais clara se for erro de provider não configurado
      if (error.message.includes('Nenhum provider de IA configurado')) {
        console.error('\n   📋 PRÉ-REQUISITO NÃO ATENDIDO:');
        console.error('   Você precisa configurar um provider de IA antes de executar este teste.');
        console.error('\n   📝 INSTRUÇÕES:');
        console.error('   1. Acesse: http://localhost:5173/config?tab=ai');
        console.error('   2. Selecione um provider de IA (OpenAI, Anthropic, etc.)');
        console.error('   3. Adicione a API key do provider');
        console.error('   4. Salve a configuração');
        console.error('   5. Execute o teste novamente\n');
      }
      
      throw error;
    });
    
    await replaySystem.recordAction(
      { type: 'api-call', step: 'generate-tenant-by-ai', value: { description: description.substring(0, 100) } },
      { success: true, page }
    );
    
    if (!generateResponse.tenant) {
      throw new Error('Resposta da API não contém dados do tenant');
    }
    
    console.log(`   ✅ Tenant gerado por IA: ${generateResponse.tenant.name}`);
    console.log(`   🌐 Site: ${generateResponse.tenant.site}`);
    console.log(`   🏢 Ramo: ${generateResponse.tenant.ramo_atividade?.substring(0, 50)}...\n`);

    // 8. Cria o tenant usando os dados gerados
    console.log('8. Criando tenant no sistema...');
    
    const createResponse = await page.evaluate(async ({ apiUrl, token, tenantData }) => {
      const response = await fetch(`${apiUrl}/tenants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...tenantData,
          plan: 'trial',
          active: true,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(error.message || `HTTP ${response.status}`);
      }
      
      return await response.json();
    }, { apiUrl: API_URL, token, tenantData: generateResponse.tenant }).catch(error => {
      console.error(`   ❌ Erro ao criar tenant: ${error.message}`);
      throw error;
    });
    
    await replaySystem.recordAction(
      { type: 'api-call', step: 'create-tenant', value: { tenantName: createResponse.tenant?.name } },
      { success: true, page }
    );
    
    if (!createResponse.tenant) {
      throw new Error('Tenant não foi criado corretamente');
    }
    
    console.log(`   ✅ Tenant criado com sucesso!`);
    console.log(`   🆔 ID: ${createResponse.tenant.id}`);
    console.log(`   📛 Nome: ${createResponse.tenant.name}\n`);

    // 8. Verifica se o tenant aparece na lista
    console.log('8. Verificando tenant na lista...');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    await replaySystem.recordScreen(page, 'tenants-list-after-creation');
    
    // Verifica se o tenant aparece na página
    const tenantInList = await page.evaluate((tenantName) => {
      const bodyText = document.body.innerText || '';
      return bodyText.includes(tenantName);
    }, createResponse.tenant.name).catch(() => false);
    
    if (tenantInList) {
      console.log('   ✅ Tenant encontrado na lista!\n');
    } else {
      console.log('   ⚠️  Tenant pode não estar visível na lista (pode precisar de scroll ou filtro)\n');
    }

    // 10. Screenshot final
    console.log('10. Capturando screenshot final...');
    const screenshotPath = path.join(__dirname, 'screenshots', `create-tenant-ai-${Date.now()}.png`);
    const screenshotsDir = path.dirname(screenshotPath);
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    await page.screenshot({ path: screenshotPath, fullPage: true });
    
    await replaySystem.recordScreen(page, 'final-state');
    replaySystem.recordEvent('test_completed', { 
      success: true, 
      tenantId: createResponse.tenant.id,
      tenantName: createResponse.tenant.name,
      finalUrl: page.url() 
    });
    
    console.log(`   ✅ Screenshot salvo: ${screenshotPath}\n`);

    console.log('✅ Teste RPA de criação de tenant por IA concluído com sucesso!\n');
    
    // Finaliza e salva replay
    if (replaySystem && replayId) {
      replaySystem.stop();
      replayPath = replaySystem.save(replayId);
      console.log(`📹 Replay salvo: ${replayPath}\n`);
      console.log(`   📊 Ações registradas: ${replaySystem.getData().actions.length}`);
      console.log(`   📸 Telas registradas: ${replaySystem.getData().screens.length}\n`);
    }
    
    return { 
      success: true, 
      tenant: createResponse.tenant,
      siteInfo,
      replayPath 
    };

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
        const screenshotPath = path.join(__dirname, 'screenshots', `create-tenant-ai-error-${Date.now()}.png`);
        const screenshotsDir = path.dirname(screenshotPath);
        if (!fs.existsSync(screenshotsDir)) {
          fs.mkdirSync(screenshotsDir, { recursive: true });
        }
        await runner.executor.page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`   Screenshot do erro salvo: ${screenshotPath}`);
        
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

// Executa se for chamado diretamente
if (require.main === module) {
  testCreateTenantByAI()
    .then((result) => {
      if (result.success) {
        console.log('\n🎉 Teste concluído com sucesso!');
        console.log(`   Tenant criado: ${result.tenant.name} (${result.tenant.id})`);
        process.exit(0);
      } else {
        console.error('\n❌ Teste falhou:', result.error);
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('❌ Erro ao executar teste:', error);
      process.exit(1);
    });
}

module.exports = {
  testCreateTenantByAI,
  extractSiteInfo,
  generateDescriptionForAI,
};

describe('RPA - Criar tenant por IA', () => {
  const maybeTest = SHOULD_RUN ? test : test.skip;
  maybeTest(
    'executa fluxo completo quando habilitado',
    async () => {
      const result = await testCreateTenantByAI();
      expect(result.success).toBe(true);
    },
    300000
  );
});
