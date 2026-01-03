/**
 * Utilitário de autenticação para testes RPA.
 * 
 * Responsabilidades:
 * - Faz login automático usando token RPA exclusivo
 * - Suporta login via API (token RPA) ou via UI (fallback)
 * - Configurável via arquivo de token ou variáveis de ambiente
 */

const { getOrCreateRpaToken } = require('./rpaTokenManager');

/**
 * Faz login automático na página atual.
 * 
 * @param {Object} page - Página do Playwright
 * @param {Object} options - Opções de login
 * @param {string} options.email - Email para login (padrão: variável de ambiente)
 * @param {string} options.password - Senha para login (padrão: variável de ambiente)
 * @param {number} options.timeout - Timeout em ms (padrão: 10000)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function performLogin(page, options = {}) {
  const email = options.email || 
                process.env.TEST_USER_EMAIL || 
                process.env.TEST_ADMIN_EMAIL || 
                'admin@example.com';
  
  const password = options.password || 
                   process.env.TEST_USER_PASSWORD || 
                   process.env.TEST_ADMIN_PASSWORD || 
                   'admin123';
  
  const timeout = options.timeout || 10000;

  try {
    // Aguarda página carregar
    await page.waitForLoadState('domcontentloaded', { timeout });

    // Seletores para campo de email
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[placeholder*="email" i]',
      'input[id*="email" i]',
      'input[data-testid*="email" i]',
      'input:first-of-type'
    ];

    // Seletores para campo de senha
    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[placeholder*="senha" i]',
      'input[placeholder*="password" i]',
      'input[id*="password" i]',
      'input[data-testid*="password" i]',
      'input:last-of-type'
    ];

    // Seletores para botão de login
    const buttonSelectors = [
      'button[type="submit"]',
      'button:has-text("Entrar")',
      'button:has-text("Login")',
      'button:has-text("Sign in")',
      'button:has-text("Acessar")',
      'button.primary',
      'button.btn-primary',
      'button[data-testid*="login" i]',
      'button[data-testid*="submit" i]'
    ];

    // Tenta preencher email
    let emailFilled = false;
    for (const selector of emailSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          await element.fill(email);
          emailFilled = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!emailFilled) {
      return {
        success: false,
        error: 'Não foi possível encontrar o campo de email'
      };
    }

    // Aguarda um pouco antes de preencher senha
    await page.waitForTimeout(200);

    // Tenta preencher senha
    let passwordFilled = false;
    for (const selector of passwordSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          await element.fill(password);
          passwordFilled = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!passwordFilled) {
      return {
        success: false,
        error: 'Não foi possível encontrar o campo de senha'
      };
    }

    // Aguarda um pouco antes de clicar no botão
    await page.waitForTimeout(200);

    // Tenta clicar no botão de login
    let buttonClicked = false;
    for (const selector of buttonSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          buttonClicked = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!buttonClicked) {
      return {
        success: false,
        error: 'Não foi possível encontrar o botão de login'
      };
    }

    // Aguarda redirecionamento ou mudança na página
    await page.waitForTimeout(2000);

    // Verifica se ainda está na página de login (pode indicar erro)
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      // Aguarda mais um pouco para ver se redireciona
      await page.waitForTimeout(2000);
      
      // Se ainda estiver em login, pode ter falhado
      if (page.url().includes('/login')) {
        return {
          success: false,
          error: 'Login pode ter falhado - ainda está na página de login'
        };
      }
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Erro ao fazer login: ${error.message}`
    };
  }
}

/**
 * Verifica se a página atual é uma página de login.
 * 
 * @param {Object} page - Página do Playwright
 * @returns {Promise<boolean>}
 */
async function isLoginPage(page) {
  try {
    const url = page.url();
    if (url.includes('/login')) {
      return true;
    }

    // Verifica se há campos de login na página
    const emailField = await page.$('input[type="email"], input[name="email"]').catch(() => null);
    const passwordField = await page.$('input[type="password"], input[name="password"]').catch(() => null);
    
    return !!(emailField && passwordField);
  } catch (error) {
    return false;
  }
}

/**
 * Faz login usando token RPA via API.
 * 
 * @param {Object} page - Página do Playwright
 * @param {Object} options - Opções
 * @param {string} options.apiBaseUrl - URL base da API (padrão: http://localhost:3000)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function performRpaLogin(page, options = {}) {
  const apiBaseUrl = options.apiBaseUrl || 
                     process.env.TEST_API_URL || 
                     process.env.API_BASE_URL || 
                     'http://localhost:3000';

  try {
    // Obtém token RPA
    const rpaToken = getOrCreateRpaToken();
    
    if (!rpaToken) {
      return {
        success: false,
        error: 'Token RPA não disponível'
      };
    }

    // Faz login via API
    const loginUrl = `${apiBaseUrl}/auth/rpa/login`;
    const response = await page.request.post(loginUrl, {
      data: {
        token: rpaToken,
      },
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok()) {
      const errorText = await response.text().catch(() => 'Erro desconhecido');
      return {
        success: false,
        error: `Login RPA falhou: ${response.status()} - ${errorText}`
      };
    }

    const result = await response.json();
    
    if (!result.token) {
      return {
        success: false,
        error: 'Token de sessão não recebido'
      };
    }

    // Armazena token no localStorage da página (chave usada pelo frontend)
    await page.evaluate((token) => {
      localStorage.setItem('auth_token', token);
      // Dispara evento de autenticação se necessário
      window.dispatchEvent(new CustomEvent('rpa-authenticated', { detail: { token } }));
    }, result.token);

    // Recarrega a página para aplicar autenticação
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Erro ao fazer login RPA: ${error.message}`
    };
  }
}

/**
 * Garante que está autenticado, fazendo login se necessário.
 * Prioriza login via token RPA, com fallback para login via UI.
 * 
 * @param {Object} page - Página do Playwright
 * @param {Object} options - Opções de login
 * @returns {Promise<{success: boolean, loggedIn: boolean, error?: string}>}
 */
async function ensureAuthenticated(page, options = {}) {
  try {
    // Verifica se já está autenticado (não está na página de login)
    const isLogin = await isLoginPage(page);
    
    if (!isLogin) {
      return { success: true, loggedIn: true };
    }

    // Tenta login via token RPA primeiro (método preferido)
    const rpaLoginResult = await performRpaLogin(page, options);
    
    if (rpaLoginResult.success) {
      return { success: true, loggedIn: true };
    }

    // Se login RPA falhar, tenta login via UI como fallback
    console.warn(`⚠️  Login RPA falhou: ${rpaLoginResult.error}`);
    console.warn('   Tentando login via UI como fallback...');
    
    const uiLoginResult = await performLogin(page, options);
    
    if (uiLoginResult.success) {
      return { success: true, loggedIn: true };
    } else {
      return {
        success: false,
        loggedIn: false,
        error: `Login RPA e UI falharam. RPA: ${rpaLoginResult.error}, UI: ${uiLoginResult.error}`
      };
    }
  } catch (error) {
    return {
      success: false,
      loggedIn: false,
      error: `Erro ao verificar autenticação: ${error.message}`
    };
  }
}

module.exports = {
  performLogin,
  performRpaLogin,
  isLoginPage,
  ensureAuthenticated,
};

