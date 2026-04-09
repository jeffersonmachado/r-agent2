/**
 * Utilitário de autenticação para testes RPA.
 * 
 * Responsabilidades:
 * - Faz login automático usando token RPA exclusivo
 * - Suporta login via API (token RPA) ou via UI (fallback)
 * - Configurável via arquivo de token ou variáveis de ambiente
 */

const { getOrCreateRpaToken } = require('./rpaTokenManager');

async function resolveServerRpaToken(page, baseUrl) {
  try {
    const response = await page.request.get(`${baseUrl}/auth/rpa/token`);
    if (!response.ok()) {
      return null;
    }
    const payload = await response.json().catch(() => null);
    return payload && typeof payload.token === 'string' && payload.token.trim() ? payload.token : null;
  } catch {
    return null;
  }
}

/**
 * Aguarda a UI sair do estado de login (campos de login sumirem).
 * Útil para validar que autenticação via token/UI realmente "pegou" no frontend.
 *
 * @param {Object} page - Página do Playwright
 * @param {Object} options
 * @param {number} options.timeout - Timeout em ms
 * @returns {Promise<boolean>}
 */
async function waitForNotLoginPage(page, options = {}) {
  const timeout = options.timeout || 10000;
  const start = Date.now();

  // Loop simples (sem depender de APIs internas do app)
  while (Date.now() - start < timeout) {
    const isLogin = await isLoginPage(page);
    if (!isLogin) return true;
    await page.waitForTimeout(250);
  }

  return false;
}

/**
 * Se o modal de seleção de tenant estiver aberto (super-admin), seleciona e acessa.
 * No frontend atual, "system" costuma vir pré-selecionado.
 *
 * @param {Object} page - Página do Playwright
 * @param {Object} options
 * @param {number} options.timeout - Timeout em ms
 * @param {string} options.tenantId - Tenant preferido (default: system)
 * @returns {Promise<{handled: boolean, error?: string}>}
 */
async function handleTenantSelectorModalIfPresent(page, options = {}) {
  const timeout = options.timeout || 10000;
  const tenantId = options.tenantId || process.env.TEST_TENANT_ID || process.env.RPA_TENANT_ID || 'system';

  try {
    // Detecta pelo título do modal e/ou botão "Acessar"
    const modalTitle = page.locator('text=Selecione o Tenant');
    const accessButton = page.locator('button:has-text("Acessar")');

    const modalVisible = await modalTitle.isVisible({ timeout: 1500 }).catch(() => false);
    const accessVisible = await accessButton.isVisible({ timeout: 1500 }).catch(() => false);

    if (!modalVisible && !accessVisible) {
      return { handled: false };
    }

    // Aguarda carregar lista, tenta selecionar tenant desejado (se existir)
    const tenantButtonCandidates = [
      `button:has-text("${tenantId}")`,
      `button:has-text("${tenantId.toUpperCase()}")`,
      'button:has-text("System")',
      'button:has-text("system")',
    ];

    for (const selector of tenantButtonCandidates) {
      const btn = page.locator(selector).first();
      const visible = await btn.isVisible({ timeout: 800 }).catch(() => false);
      if (visible) {
        await btn.click().catch(() => null);
        break;
      }
    }

    // Clica "Acessar" (o modal pode pré-selecionar system automaticamente)
    await accessButton.click({ timeout }).catch(() => null);

    // Aguarda o modal fechar
    await modalTitle.waitFor({ state: 'detached', timeout }).catch(() => null);
    return { handled: true };
  } catch (error) {
    return { handled: false, error: error.message };
  }
}

/**
 * Faz login automático na página atual.
 * 
 * @param {Object} page - Página do Playwright
 * @param {Object} options - Opções de login
 * @param {string} options.username - Username para login (padrão: variável de ambiente)
 * @param {string} options.email - Email para login (compatibilidade, fallback)
 * @param {string} options.password - Senha para login (padrão: variável de ambiente)
 * @param {number} options.timeout - Timeout em ms (padrão: 10000)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function performLogin(page, options = {}) {
  // O frontend atual usa username/senha (não email).
  const username = options.username ||
                   process.env.TEST_USERNAME ||
                   process.env.TEST_ADMIN_USERNAME ||
                   process.env.TEST_USER_USERNAME ||
                   // Defaults alinhados com docs e seed do projeto
                   'systemadmin';
  
  const password = options.password || 
                   process.env.TEST_USER_PASSWORD || 
                   process.env.TEST_ADMIN_PASSWORD || 
                   // Defaults alinhados com docs e seed do projeto
                   'Admin123!';
  
  const timeout = options.timeout || 10000;

  try {
    // Aguarda página carregar
    await page.waitForLoadState('domcontentloaded', { timeout });

    // Seletores para campo de username
    const usernameSelectors = [
      'input[name="username"]',
      'input[id*="username" i]',
      'input[placeholder*="username" i]',
      'input[placeholder*="usuário" i]',
      'input[autocomplete="username"]',
      // Fallback conservador (primeiro input não-password)
      'input:not([type="password"])',
    ];

    // Seletores para campo de senha
    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[placeholder*="senha" i]',
      'input[placeholder*="password" i]',
      'input[id*="password" i]',
      'input[data-testid*="password" i]',
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

    // Tenta preencher username
    let usernameFilled = false;
    for (const selector of usernameSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          await element.fill(username);
          usernameFilled = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!usernameFilled) {
      return {
        success: false,
        error: 'Não foi possível encontrar o campo de username'
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

    // Aguarda redirecionamento/atualização de UI (o app pode não mudar a URL imediatamente)
    await page.waitForTimeout(1500);

    // Se for super-admin, pode abrir modal de seleção de tenant.
    const modalHandled = await handleTenantSelectorModalIfPresent(page, { timeout, tenantId: options.tenantId });
    if (modalHandled.error) {
      // Não falha por isso; só registra via retorno se ainda ficar travado
    }

    // Valida que saiu do estado de login
    const notLogin = await waitForNotLoginPage(page, { timeout });
    if (!notLogin) {
      return {
        success: false,
        error: 'Login pode ter falhado - UI ainda aparenta estar no estado de login',
      };
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
    const userField = await page.$('input[name="username"], input[placeholder*="username" i], input[placeholder*="usuário" i]').catch(() => null);
    const passwordField = await page.$('input[type="password"], input[name="password"]').catch(() => null);
    
    return !!(userField && passwordField);
  } catch (error) {
    return false;
  }
}

/**
 * Aguarda até que a UI esteja claramente em "login" (inputs visíveis) ou até timeout.
 * Isso evita condição de corrida quando a rota protegida (ex: /maintenance) renderiza
 * o componente de Login sem mudar a URL imediatamente.
 *
 * @param {Object} page
 * @param {Object} options
 * @param {number} options.timeout
 * @returns {Promise<boolean>}
 */
async function waitForLoginPage(page, options = {}) {
  const timeout = options.timeout || 4000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const isLogin = await isLoginPage(page);
    if (isLogin) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

/**
 * Verifica se a página já possui artefatos mínimos de sessão autenticada.
 * Evita tratar páginas em carregamento lento como autenticadas quando ainda não
 * existe token/agent em storage.
 *
 * @param {Object} page
 * @returns {Promise<{hasToken: boolean, hasAgent: boolean, effectiveTenantId: string | null}>}
 */
async function getStoredAuthState(page) {
  return page.evaluate(() => {
    const authToken = window.localStorage.getItem('auth_token');
    const authAgent = window.localStorage.getItem('auth_agent');
    const effectiveTenantId = window.localStorage.getItem('auth_effective_tenant_id');

    return {
      hasToken: !!(authToken && String(authToken).trim()),
      hasAgent: !!(authAgent && String(authAgent).trim()),
      effectiveTenantId: effectiveTenantId && String(effectiveTenantId).trim()
        ? String(effectiveTenantId).trim()
        : null,
    };
  });
}

/**
 * Faz login usando token RPA via API.
 * 
 * @param {Object} page - Página do Playwright
 * @param {Object} options - Opções
 * @param {string} options.apiBaseUrl - URL base da API (padrão: porta configurada da API)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function performRpaLogin(page, options = {}) {
  // Prioridade: options.apiBaseUrl > TEST_API_URL > API_URL/API_BASE_URL > rpa.config.json > config.json > fallback
  const rpaConfig = require('../rpaConfig');
  const mainConfig = require('../../../api/utils/config');
  const apiPort = Number(mainConfig.get('api.port', 3001));
  const primaryApiBaseUrl = options.apiBaseUrl || 
                            process.env.TEST_API_URL || 
                            process.env.API_URL || 
                            process.env.API_BASE_URL || 
                            rpaConfig.urls.api ||
                            mainConfig.get('tests.rpa.apiUrl') ||
                            mainConfig.get('api.baseUrl') ||
                            `http://localhost:${apiPort}`;

  const tenantId = options.tenantId ||
                   process.env.TEST_TENANT_ID ||
                   process.env.RPA_TENANT_ID ||
                   'system';

  try {
    const normalizeBaseUrl = (url) => {
      if (!url || typeof url !== 'string') return null;
      return url.endsWith('/') ? url.slice(0, -1) : url;
    };

    // Tenta primeiro a URL explicitamente configurada e só adiciona fallbacks
    // coerentes com a porta ativa do ambiente quando eles forem realmente distintos.
    const hasExplicitTestApiUrl = Boolean(process.env.TEST_API_URL);
    const candidateBaseUrls = [];
    const normalizedPrimaryApiBaseUrl = normalizeBaseUrl(primaryApiBaseUrl);
    const normalizedActivePortBaseUrl = normalizeBaseUrl(`http://localhost:${apiPort}`);

    if (normalizedPrimaryApiBaseUrl) {
      candidateBaseUrls.push(normalizedPrimaryApiBaseUrl);
    }

    if (normalizedActivePortBaseUrl) {
      candidateBaseUrls.push(normalizedActivePortBaseUrl);
    }

    if (!hasExplicitTestApiUrl) {
      const normalizedLegacyBaseUrl = normalizeBaseUrl('http://localhost:3001');
      if (normalizedLegacyBaseUrl) {
        candidateBaseUrls.push(normalizedLegacyBaseUrl);
      }
    }

    // Remove duplicados preservando ordem
    const seen = new Set();
    const uniqueCandidates = candidateBaseUrls.filter((u) => {
      if (seen.has(u)) return false;
      seen.add(u);
      return true;
    });

    let lastError = null;
    let lastStatus = null;
    let lastBaseUrl = null;
    let result = null;

    for (const baseUrl of uniqueCandidates) {
      lastBaseUrl = baseUrl;
      try {
        const rpaToken = await resolveServerRpaToken(page, baseUrl) || getOrCreateRpaToken();
        if (!rpaToken) {
          lastError = `Token RPA não disponível para ${baseUrl}`;
          continue;
        }

        // Faz login via API
        const loginUrl = `${baseUrl}/auth/rpa/login`;
        const response = await page.request.post(loginUrl, {
          data: {
            token: rpaToken,
            tenantId,
          },
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok()) {
          lastStatus = response.status();
          const errorText = await response.text().catch(() => 'Erro desconhecido');
          lastError = `Login RPA falhou em ${baseUrl}: ${response.status()} - ${errorText}`;
          continue;
        }

        const parsed = await response.json().catch(() => null);
        // Só considera sucesso se vier um token válido
        if (parsed && parsed.token) {
          result = parsed;
          break;
        }

        // Resposta 200 mas sem token => trata como inválida e tenta próxima baseUrl
        lastStatus = response.status();
        lastError = `Login RPA inválido em ${baseUrl}: resposta sem token`;
        continue;
      } catch (err) {
        lastError = `Erro ao fazer login RPA em ${baseUrl}: ${err.message}`;
        continue;
      }
    }

    if (!result || !result.token) {
      return {
        success: false,
        error: lastError || `Login RPA falhou (apiBaseUrl=${lastBaseUrl || primaryApiBaseUrl}, status=${lastStatus || 'n/a'})`,
      };
    }
    
    // Armazena token no localStorage da página (chave usada pelo frontend)
    await page.evaluate(({ token, agent, tenantId }) => {
      localStorage.setItem('auth_token', token);
      // Ajuda o frontend a ter contexto imediato (sem depender apenas de /auth/me)
      if (agent) {
        try {
          localStorage.setItem('auth_agent', JSON.stringify(agent));
        } catch (e) {
          // ignora
        }
      }
      if (tenantId && typeof tenantId === 'string' && tenantId.trim()) {
        localStorage.setItem('auth_effective_tenant_id', tenantId.trim());
      }
      // Dispara evento de autenticação se necessário
      window.dispatchEvent(new CustomEvent('rpa-authenticated', { detail: { token, agent } }));
    }, { token: result.token, agent: result.agent || null, tenantId });

    // Recarrega a página para aplicar autenticação
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Garante que o frontend realmente saiu do estado de login
    let notLogin = await waitForNotLoginPage(page, { timeout: options.timeout || 10000 });
    if (!notLogin) {
      // Fallback: força navegação para uma rota autenticada e revalida
      const rpaConfig = require('../rpaConfig');
      const frontendBaseUrl = options.frontendBaseUrl ||
        process.env.TEST_FRONTEND_URL ||
        rpaConfig.urls.frontend ||
        'http://localhost:5173';

      try {
        await page.goto(`${frontendBaseUrl}/support`, { waitUntil: 'domcontentloaded', timeout: options.timeout || 30000 });
        await page.waitForTimeout(500);
      } catch (e) {
        // ignora, vai tentar validar mesmo assim
      }

      notLogin = await waitForNotLoginPage(page, { timeout: options.timeout || 10000 });
      if (!notLogin) {
        return { success: false, error: 'Token RPA aplicado, mas UI ainda aparenta estar no estado de login (mesmo após navegar para /support)' };
      }
    }

    // Se por algum motivo abrir o modal de tenant (ex.: super-admin), resolve.
    await handleTenantSelectorModalIfPresent(page, { timeout: options.timeout || 10000, tenantId }).catch(() => null);

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
    const storedAuthState = await getStoredAuthState(page).catch(() => ({
      hasToken: false,
      hasAgent: false,
      effectiveTenantId: null,
    }));

    // Verifica se já está autenticado (não está na página de login).
    // Atenção: em rotas protegidas (ex.: /maintenance), o app pode renderizar Login
    // mantendo a URL original; e às vezes os inputs demoram a aparecer.
    let isLogin = await isLoginPage(page);
    if (!isLogin) {
      // Dá uma pequena janela para o React renderizar os inputs de login, se for o caso.
      // Se aparecer, tratamos como login e seguimos com autenticação.
      const loginSoon = await waitForLoginPage(page, { timeout: options.loginDetectTimeout || 4000 });
      if (loginSoon) {
        isLogin = true;
      }
    }

    const hasUsableSession = storedAuthState.hasToken && storedAuthState.hasAgent;

    if (!isLogin && hasUsableSession) {
      return { success: true, loggedIn: true };
    }

    const strategy = String(options.loginStrategy || 'rpa_then_ui').toLowerCase();
    const tryRpaFirst = strategy === 'rpa_then_ui' || strategy === 'rpa';
    const tryUiFirst = strategy === 'ui_then_rpa' || strategy === 'ui';

    const finalizeAuthenticatedState = async () => {
      if (page.url().includes('/login')) {
        const rpaConfig = require('../rpaConfig');
        const frontendBaseUrl = options.frontendBaseUrl ||
          process.env.TEST_FRONTEND_URL ||
          rpaConfig.urls.frontend ||
          'http://localhost:5173';
        await page.goto(`${frontendBaseUrl}/support`, { waitUntil: 'domcontentloaded', timeout: options.timeout || 30000 });
        await page.waitForTimeout(500);
      }

      await handleTenantSelectorModalIfPresent(page, {
        timeout: options.timeout || 10000,
        tenantId: options.tenantId,
      }).catch(() => null);

      return { success: true, loggedIn: true };
    };

    let rpaLoginResult = { success: false, error: 'login RPA não executado' };
    let uiLoginResult = { success: false, error: 'login UI não executado' };

    if (tryUiFirst) {
      uiLoginResult = await performLogin(page, options);
      if (uiLoginResult.success) {
        return finalizeAuthenticatedState();
      }

      if (strategy === 'ui') {
        return {
          success: false,
          loggedIn: false,
          error: `Login UI falhou: ${uiLoginResult.error}`,
        };
      }
    }

    if (tryRpaFirst || strategy === 'ui_then_rpa') {
      rpaLoginResult = await performRpaLogin(page, options);
      if (rpaLoginResult.success) {
        return finalizeAuthenticatedState();
      }

      if (strategy === 'rpa') {
        return {
          success: false,
          loggedIn: false,
          error: `Login RPA falhou: ${rpaLoginResult.error}`,
        };
      }
    }

    if (tryRpaFirst && strategy === 'rpa_then_ui') {
      console.warn(`⚠️  Login RPA falhou: ${rpaLoginResult.error}`);
      console.warn('   Tentando login via UI como fallback...');
      uiLoginResult = await performLogin(page, options);
      if (uiLoginResult.success) {
        return finalizeAuthenticatedState();
      }
    }

    if (tryUiFirst && strategy === 'ui_then_rpa') {
      console.warn(`⚠️  Login UI falhou: ${uiLoginResult.error}`);
      console.warn('   Tentando login via token RPA como fallback...');
      if (!rpaLoginResult.success) {
        rpaLoginResult = await performRpaLogin(page, options);
      }
      if (rpaLoginResult.success) {
        return finalizeAuthenticatedState();
      }
    }

    return {
      success: false,
      loggedIn: false,
      error: `Login falhou. RPA: ${rpaLoginResult.error}, UI: ${uiLoginResult.error}`,
    };
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
  waitForLoginPage,
  ensureAuthenticated,
};
