/**
 * Executor de ações RPA.
 * 
 * Executa ações gravadas usando Playwright.
 */

const { chromium } = require('playwright');
const config = require('./rpaConfig');
const { ErrorDetector } = require('./errorDetection');
const { ErrorRecovery } = require('./errorRecovery');
const { DataPopulator } = require('./dataPopulation');
const path = require('path');

class ActionExecutor {
  constructor(options = {}) {
    this.browser = null;
    this.page = null;
    this.context = null;
    this.errorDetector = new ErrorDetector();
    this.errorRecovery = new ErrorRecovery();
    this.dataPopulator = new DataPopulator();
    this.screenshots = [];
    this.errors = [];
    // Logs detalhados por step/ação (úteis para debug no backend/CI)
    this.debugLogs = [];
    this.consoleLogs = [];
    this.httpErrors = [];
    this.options = {
      headless: options.headless !== undefined ? options.headless : config.playwright.headless,
      slowMo: options.slowMo || config.playwright.slowMo,
      timeout: options.timeout || config.playwright.timeout,
      typingSpeedMs: options.typingSpeedMs || 0, // Delay por caractere (0 = preenchimento rápido)
      devtools: options.devtools !== undefined ? options.devtools : true,
      detailedLogs: options.detailedLogs !== undefined ? options.detailedLogs : (process.env.RPA_DETAILED_LOGS !== '0'),
      maxDebugEntries: options.maxDebugEntries !== undefined
        ? options.maxDebugEntries
        : (Number(process.env.RPA_MAX_DEBUG_ENTRIES) || 2000),
      maxConsoleEntries: options.maxConsoleEntries !== undefined
        ? options.maxConsoleEntries
        : (Number(process.env.RPA_MAX_CONSOLE_ENTRIES) || 500),
      captureHttpErrors: options.captureHttpErrors !== undefined
        ? options.captureHttpErrors
        : (process.env.RPA_CAPTURE_HTTP_ERRORS === '1' || process.env.RPA_CAPTURE_HTTP_ERRORS === 'true'),
      traceEnabled: options.traceEnabled !== undefined
        ? options.traceEnabled
        : (process.env.RPA_TRACE === '1' || process.env.RPA_TRACE === 'true'),
      traceDir: options.traceDir || process.env.RPA_TRACE_DIR || path.join(__dirname, 'traces'),
    };
  }

  _pushDebug(entry) {
    if (!this.options.detailedLogs) return;
    this.debugLogs.push(entry);
    if (this.debugLogs.length > this.options.maxDebugEntries) {
      this.debugLogs.shift();
    }
  }

  _pushConsole(entry) {
    if (!this.options.detailedLogs) return;
    this.consoleLogs.push(entry);
    if (this.consoleLogs.length > this.options.maxConsoleEntries) {
      this.consoleLogs.shift();
    }
  }

  _splitSelectors(selector) {
    if (!selector || typeof selector !== 'string') return [];
    return selector
      .split(',')
      .map((s) => String(s).trim())
      .filter(Boolean);
  }

  async _safeGetUrl() {
    try {
      return this.page?.url?.() || null;
    } catch (e) {
      return null;
    }
  }

  async _safeGetTitle() {
    try {
      if (!this.page) return null;
      return await this.page.title();
    } catch (e) {
      return null;
    }
  }

  async diagnoseSelector(selector) {
    if (!this.page) return { selector, error: 'page_not_initialized' };
    if (!selector || typeof selector !== 'string') return { selector, error: 'invalid_selector' };

    // Playwright suporta seletores não-CSS (ex.: text=), então usamos locator() como fonte de verdade.
    try {
      const locator = this.page.locator(selector);
      const count = await locator.count().catch(() => null);
      const firstVisible = await locator.first().isVisible().catch(() => false);
      const firstText = await locator.first().innerText().catch(() => null);
      return {
        selector,
        count,
        firstVisible,
        firstText: typeof firstText === 'string' ? firstText.slice(0, 200) : firstText,
      };
    } catch (error) {
      return { selector, error: error.message };
    }
  }

  async collectSelectorDiagnostics(selectors) {
    const diags = [];
    for (const sel of selectors) {
      // eslint-disable-next-line no-await-in-loop
      diags.push(await this.diagnoseSelector(sel));
    }
    return diags;
  }

  /**
   * Inicializa browser e página.
   */
  async init() {
    this.browser = await chromium.launch({
      headless: this.options.headless,
      slowMo: this.options.slowMo,
      devtools: this.options.devtools, // Abre DevTools se solicitado
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
    });

    // Tracing (opcional) - útil para diagnóstico em CI/stack.
    // Observação: não vira gate; apenas evidência.
    if (this.options.traceEnabled) {
      try {
        const fs = require('fs');
        if (!fs.existsSync(this.options.traceDir)) {
          fs.mkdirSync(this.options.traceDir, { recursive: true });
        }
      } catch (_) {}
    }

    this.page = await this.context.newPage();
    
    // Captura console do browser (útil para debug de travas/renders)
    if (this.options.detailedLogs) {
      this.page.on('console', (msg) => {
        try {
          // Reduz ruído: captura tudo, mas com cap e truncamento
          this._pushConsole({
            type: 'console',
            level: msg.type(),
            text: (msg.text() || '').slice(0, 2000),
            location: msg.location?.() || null,
            timestamp: new Date().toISOString(),
          });
        } catch (e) {
          // ignora
        }
      });
    }
    
    // Intercepta erros da página
    this.page.on('pageerror', (error) => {
      this.errors.push({
        type: 'page_error',
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });
    });

    // Intercepta requisições falhadas
    this.page.on('requestfailed', (request) => {
      this.errors.push({
        type: 'request_failed',
        url: request.url(),
        method: request.method(),
        timestamp: new Date().toISOString(),
      });
    });

    // Captura respostas HTTP com status >= 400 (não é gate; apenas evidência).
    if (this.options.captureHttpErrors) {
      this.page.on('response', async (response) => {
        try {
          const status = response.status();
          if (status < 400) return;
          const req = response.request();
          const url = response.url();
          const method = req.method();

          // Tenta capturar um preview do body apenas quando for texto/JSON, com limite.
          let bodyPreview = null;
          let contentType = null;
          try {
            const headers = response.headers();
            contentType = headers['content-type'] || headers['Content-Type'] || null;
          } catch (_) {}

          const isTextLike = contentType
            ? /application\/json|text\/|application\/problem\+json|application\/x-www-form-urlencoded/i.test(contentType)
            : false;
          if (isTextLike) {
            try {
              const txt = await response.text();
              if (typeof txt === 'string') bodyPreview = txt.slice(0, 2000);
            } catch (_) {
              // ignora
            }
          }

          const entry = {
            type: 'http_error',
            status,
            url,
            method,
            contentType,
            bodyPreview,
            timestamp: new Date().toISOString(),
          };
          this.httpErrors.push(entry);
          // também expõe via errors (mantém compatibilidade com report atual)
          this.errors.push(entry);
        } catch (_) {
          // ignora
        }
      });
    }
  }

  async startTracing() {
    if (!this.options.traceEnabled) return { started: false };
    if (!this.context || !this.context.tracing) return { started: false };
    try {
      await this.context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      return { started: true };
    } catch (error) {
      return { started: false, error: error.message };
    }
  }

  async stopTracing(name = `trace-${Date.now()}`) {
    if (!this.options.traceEnabled) return null;
    if (!this.context || !this.context.tracing) return null;
    try {
      const filepath = path.join(this.options.traceDir, `${name}.zip`);
      await this.context.tracing.stop({ path: filepath });
      return filepath;
    } catch (_) {
      // best-effort
      try { await this.context.tracing.stop(); } catch {}
      return null;
    }
  }

  getDebugLogs() {
    return this.debugLogs;
  }

  getConsoleLogs() {
    return this.consoleLogs;
  }

  /**
   * Fecha browser e página.
   */
  async close() {
    if (this.page) {
      await this.page.close();
    }
    if (this.context) {
      await this.context.close();
    }
    if (this.browser) {
      await this.browser.close();
    }
  }

  /**
   * Executa uma ação.
   * 
   * @param {Object} action - Ação a executar
   * @param {Object} data - Dados para substituição de variáveis
   */
  async executeAction(action, data = {}) {
    // Validação inicial
    if (!action) {
      return {
        success: false,
        error: 'Ação não fornecida (action é null ou undefined)',
        code: 'RPA_INVALID_ACTION',
      };
    }

    if (!this.page) {
      return {
        success: false,
        error: 'Página não inicializada (this.page é null)',
        code: 'RPA_PAGE_NOT_INITIALIZED',
      };
    }

    // ------------------------------------------------------------
    // Normalização de formatos legados / gerados por IA
    // ------------------------------------------------------------
    // Existem 3 formatos em circulação:
    // 1) Novo: { type: 'assert', selector, text/visible/exists/value/count, page: {...} }
    // 2) Wrapper: { type: 'assert', selector, assert: { type: 'text'|'visible'|'exists'|'url'|'value', expected }, ... }
    // 3) Legado: { action: 'assert', type: 'url'|'text'|'visible'|..., selector, expected }
    //
    // Sem normalização:
    // - asserts com "assert: {..}" viram no-op (não validam nada)
    // - steps com type="url" falham com "Tipo de ação desconhecido: url"
    const normalizeAction = (a) => {
      if (!a || typeof a !== 'object') return a;

      // Formato legado: action='assert' e type indica o tipo de assert (url/text/visible/exists/value)
      if (a.action === 'assert' && a.type && a.type !== 'assert') {
        const kind = a.type;
        const normalized = { ...a, type: 'assert' };

        if (kind === 'url') {
          const expected = a.expected || a.value || a.title;
          normalized.page = normalized.page || {};
          normalized.page.url = normalized.page.url || {};
          if (expected !== undefined) normalized.page.url.exact = expected;
          return normalized;
        }

        if (kind === 'text') {
          if (a.expected !== undefined) {
            // `body` normalmente contém MUITO texto (UI + logs). Para seeds gerados,
            // o esperado costuma ser substring, não igualdade exata.
            const selector = typeof a.selector === 'string' ? a.selector.trim() : '';
            if (selector === 'body') {
              normalized.textContains = a.expected;
            } else {
              normalized.text = a.expected;
            }
          }
          return normalized;
        }

        if (kind === 'visible') {
          if (a.expected !== undefined) normalized.visible = a.expected === true || a.expected === 'true';
          return normalized;
        }

        if (kind === 'exists') {
          if (a.expected !== undefined) normalized.exists = a.expected === true || a.expected === 'true';
          return normalized;
        }

        if (kind === 'value') {
          if (a.expected !== undefined) normalized.value = a.expected;
          return normalized;
        }

        return normalized;
      }

      // Wrapper: type='assert' com campo assert:{type, expected}
      if (a.type === 'assert' && a.assert && typeof a.assert === 'object') {
        const kind = a.assert.type;
        const expected = a.assert.expected;
        const normalized = { ...a };

        if (kind === 'url') {
          normalized.page = normalized.page || {};
          normalized.page.url = normalized.page.url || {};
          if (expected !== undefined) normalized.page.url.exact = expected;
          return normalized;
        }

        if (kind === 'text') {
          if (expected !== undefined) {
            // Mesma regra do formato legado: `body` => contains por padrão
            const selector = typeof a.selector === 'string' ? a.selector.trim() : '';
            if (selector === 'body') {
              normalized.textContains = expected;
            } else {
              normalized.text = expected;
            }
          }
          return normalized;
        }

        if (kind === 'visible') {
          if (expected !== undefined) normalized.visible = expected === true || expected === 'true';
          return normalized;
        }

        if (kind === 'exists') {
          if (expected !== undefined) normalized.exists = expected === true || expected === 'true';
          return normalized;
        }

        if (kind === 'value') {
          if (expected !== undefined) normalized.value = expected;
          return normalized;
        }

        return normalized;
      }

      // Segurança: alguns geradores produzem { type:'url', expected } (sem action='assert')
      if (a.type === 'url') {
        const expected = a.expected || a.value || a.title;
        return {
          ...a,
          type: 'assert',
          page: {
            url: {
              exact: expected,
            },
          },
        };
      }

      return a;
    };

    const normalizedAction = normalizeAction(action);
    const actionType = normalizedAction.type;

    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const urlBefore = await this._safeGetUrl();
    const titleBefore = await this._safeGetTitle();

    const debugBase = {
      startedAt,
      actionType,
      description: normalizedAction.description || action.description || null,
      urlBefore,
      titleBefore,
      // Campos mais comuns (sem vazar payload gigante)
      selector: normalizedAction.selector || null,
      url: normalizedAction.url || normalizedAction.value || null,
      valuePreview:
        typeof normalizedAction.value === 'string'
          ? normalizedAction.value.slice(0, 200)
          : (normalizedAction.value !== undefined ? normalizedAction.value : null),
      timeout: normalizedAction.timeout || this.options.timeout,
      critical: normalizedAction.critical,
    };

    let result = { success: false, error: null };

    try {
      switch (actionType) {
        case 'navigate':
          result = await this.executeNavigate(normalizedAction, data);
          break;
        case 'click':
          result = await this.executeClick(normalizedAction, data);
          break;
        case 'fill':
          result = await this.executeFill(normalizedAction, data);
          break;
        case 'select':
          result = await this.executeSelect(normalizedAction, data);
          break;
        case 'wait':
          result = await this.executeWait(normalizedAction, data);
          break;
        case 'assert':
          result = await this.executeAssert(normalizedAction, data);
          break;
        default:
          result = { success: false, error: `Tipo de ação desconhecido: ${actionType}` };
      }

      const durationMs = Date.now() - startMs;
      const urlAfter = await this._safeGetUrl();
      const titleAfter = await this._safeGetTitle();

      // Diagnóstico adicional em caso de falha (principalmente seletores)
      let diagnostics = null;
      if (!result.success && this.options.detailedLogs) {
        try {
          if (actionType === 'click' || actionType === 'fill' || actionType === 'select') {
            const selectors = this._splitSelectors(this.replaceVariables(normalizedAction.selector, data));
            diagnostics = {
              kind: 'selector',
              selectorsTried: selectors,
              selectorDiagnostics: await this.collectSelectorDiagnostics(selectors.slice(0, 10)),
            };
          } else if (actionType === 'wait') {
            const condition = normalizedAction.condition || normalizedAction.selector;
            const selectors = this._splitSelectors(this.replaceVariables(condition, data));
            diagnostics = {
              kind: 'wait',
              state: normalizedAction.state || 'visible',
              selectorsTried: selectors,
              selectorDiagnostics: await this.collectSelectorDiagnostics(selectors.slice(0, 10)),
            };
          } else if (actionType === 'assert') {
            if (normalizedAction.page?.url) {
              diagnostics = {
                kind: 'assert_url',
                expected: normalizedAction.page.url,
                actualUrl: urlAfter,
              };
            } else if (normalizedAction.selector) {
              const selectors = this._splitSelectors(this.replaceVariables(normalizedAction.selector, data));
              diagnostics = {
                kind: 'assert_selector',
                selectorsTried: selectors,
                selectorDiagnostics: await this.collectSelectorDiagnostics(selectors.slice(0, 10)),
              };
            }
          }
        } catch (diagError) {
          diagnostics = { kind: 'diagnostics_error', error: diagError.message };
        }
      }

      const debug = {
        ...debugBase,
        endedAt: new Date().toISOString(),
        durationMs,
        urlAfter,
        titleAfter,
        success: !!result.success,
        error: result.error || null,
        code: result.code || null,
        diagnostics,
      };

      // Mantém histórico interno para debug posterior
      this._pushDebug(debug);

      // Detecta erros
      if (!result.success) {
        const detectedError = this.errorDetector.detect(result.error, normalizedAction, this.page);
        if (detectedError) {
          // Tenta recuperação automática
          const recovery = await this.errorRecovery.recover(detectedError, normalizedAction, this.page);
          if (recovery.success) {
            // Tenta executar ação novamente após recuperação
            return await this.executeAction(normalizedAction, data);
          }
        }
      }

      return {
        ...result,
        debug,
      };
    } catch (error) {
      // Captura screenshot em caso de erro
      if (config.playwright.screenshot.onFailure) {
        await this.captureScreenshot(`error-${actionType}-${Date.now()}`);
      }

      const durationMs = Date.now() - startMs;
      const urlAfter = await this._safeGetUrl();
      const titleAfter = await this._safeGetTitle();
      const debug = {
        ...debugBase,
        endedAt: new Date().toISOString(),
        durationMs,
        urlAfter,
        titleAfter,
        success: false,
        error: error.message,
        code: 'RPA_ACTION_THROWN',
        diagnostics: { kind: 'exception', stack: error.stack },
      };
      this._pushDebug(debug);

      return {
        success: false,
        error: error.message,
        stack: error.stack,
        debug,
      };
    }
  }

  /**
   * Executa ação de navegação.
   */
  async executeNavigate(action, data) {
    try {
      // Tenta obter URL de action.url ou action.value (compatibilidade)
      const urlSource = action.url || action.value;
      
      // Valida se a URL existe
      if (!urlSource) {
        return {
          success: false,
          error: 'URL não especificada na ação de navegação (campos url ou value ausentes)',
          code: 'RPA_MISSING_URL',
        };
      }

      const url = this.replaceVariables(urlSource, data);
      
      // Valida se a URL resultante é uma string válida
      if (!url || typeof url !== 'string' || url.trim() === '') {
        return {
          success: false,
          error: `URL inválida após substituição de variáveis: ${urlSource}`,
          code: 'RPA_INVALID_URL',
        };
      }
      
      // Aguarda navegação com múltiplas estratégias
      await this.page.goto(url, { 
        waitUntil: 'domcontentloaded', // Mais rápido que networkidle
        timeout: action.timeout || this.options.timeout,
      });

      // Aguarda um pouco para garantir que a página renderizou
      await this.page.waitForTimeout(1000);

      if (action.waitFor) {
        const selector = this.replaceVariables(action.waitFor, data);
        // Tenta múltiplos seletores se for uma lista separada por vírgula
        const selectors = selector.split(',').map(s => s.trim());
        let found = false;
        
        for (const sel of selectors) {
          try {
            await this.page.waitForSelector(sel, { 
              timeout: 5000,
              state: 'visible',
            });
            found = true;
            break;
          } catch (e) {
            // Tenta próximo seletor
            continue;
          }
        }
        
        if (!found && selectors.length > 0) {
          // Se nenhum seletor funcionou, tenta o primeiro com timeout maior
          await this.page.waitForSelector(selectors[0], { 
            timeout: action.timeout || this.options.timeout,
          });
        }
      }

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error.message,
        code: error.code || 'RPA_ACTION_FAILED',
      };
    }
  }

  /**
   * Executa ação de clique.
   * 
   * @throws {Error} RPA_ELEMENT_NOT_FOUND se elemento não for encontrado
   * @throws {Error} RPA_ACTION_FAILED se clique falhar
   */
  async executeClick(action, data) {
    try {
      const selector = this.replaceVariables(action.selector, data);
      
      // Tenta múltiplos seletores se for uma lista separada por vírgula
      const selectors = selector.split(',').map(s => s.trim());
      let foundSelector = null;
      let lastError = null;
      
      // Tenta encontrar o primeiro seletor que funciona
      for (const sel of selectors) {
        try {
          // Tenta com locator primeiro (mais robusto)
          const locator = this.page.locator(sel);
          const count = await locator.count();
          if (count > 0) {
            const isVisible = await locator.first().isVisible().catch(() => false);
            if (isVisible) {
              foundSelector = sel;
              break;
            }
          }
          
          // Se locator não funcionou, tenta waitForSelector
          await this.page.waitForSelector(sel, {
            state: 'visible',
            timeout: 5000,
          });
          foundSelector = sel;
          break;
        } catch (e) {
          lastError = e;
          // Tenta próximo seletor
          continue;
        }
      }
      
      // Se nenhum funcionou, tenta o primeiro com timeout maior e força
      if (!foundSelector) {
        foundSelector = selectors[0];
        try {
          // Tenta com locator
          const locator = this.page.locator(foundSelector);
          const count = await locator.count();
          if (count > 0) {
            // Elemento existe, tenta clicar mesmo que não esteja visível
            await locator.first().click({ force: true, timeout: action.timeout || this.options.timeout });
          } else {
            // Tenta waitForSelector
            await this.page.waitForSelector(foundSelector, {
              state: 'visible',
              timeout: action.timeout || this.options.timeout,
            });
            await this.page.click(foundSelector, { force: action.force || false });
          }
        } catch (finalError) {
          throw new Error(`Nenhum seletor encontrado para clique: ${selectors.join(', ')}. Último erro: ${finalError.message}`);
        }
      } else {
        // Aguarda um pouco para garantir que o elemento está estável
        await this.page.waitForTimeout(300);

        // Tenta clicar
        try {
          await this.page.click(foundSelector, { force: action.force || false });
        } catch (clickError) {
          // Se clique normal falhar, tenta com force
          await this.page.click(foundSelector, { force: true });
        }
      }

      // Aguarda um pouco após o clique
      await this.page.waitForTimeout(500);

      if (action.waitFor) {
        const waitSelector = this.replaceVariables(action.waitFor, data);
        // Tenta múltiplos seletores para waitFor também
        const waitSelectors = waitSelector.split(',').map(s => s.trim());
        let foundWait = false;
        
        for (const sel of waitSelectors) {
          try {
            await this.page.waitForSelector(sel, {
              timeout: 5000,
              state: 'visible',
            });
            foundWait = true;
            break;
          } catch (e) {
            continue;
          }
        }
        
        if (!foundWait && waitSelectors.length > 0) {
          try {
            await this.page.waitForSelector(waitSelectors[0], {
              timeout: Math.min((action.timeout || this.options.timeout) / 2, 10000), // Timeout reduzido para waitFor
            });
          } catch (waitError) {
            // Se waitFor falhar, não falha a ação, apenas loga
            console.warn(`WaitFor falhou após clique: ${waitError.message}`);
          }
        }
      }

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error.message,
        code: error.code || 'RPA_ELEMENT_NOT_FOUND',
      };
    }
  }

  /**
   * Executa ação de preenchimento (TYPE).
   * 
   * IMPORTANTE:
   * - Executa digitação caractere a caractere se typingSpeedMs > 0
   * - Velocidade vem do config (passado via action.typingSpeedMs)
   * - Seed não contém velocidade, apenas texto completo
   * 
   * @throws {Error} RPA_ELEMENT_NOT_FOUND se elemento não for encontrado
   * @throws {Error} RPA_ACTION_FAILED se ação falhar
   */
  async executeFill(action, data) {
    try {
      const selector = this.replaceVariables(action.selector, data);
      let value = this.replaceVariables(action.value, data);

      // Popula dados se necessário
      if (value.startsWith('{{') && value.endsWith('}}')) {
        value = this.dataPopulator.populate(value, data);
      }

      // Tenta múltiplos seletores se for uma lista separada por vírgula
      const selectors = selector.split(',').map(s => s.trim());
      let foundSelector = null;
      let lastError = null;
      
      // Tenta encontrar o primeiro seletor que funciona
      for (const sel of selectors) {
        try {
          await this.page.waitForSelector(sel, {
            state: 'visible',
            timeout: 5000,
          });
          foundSelector = sel;
          break;
        } catch (e) {
          lastError = e;
          // Tenta próximo seletor
          continue;
        }
      }
      
      // Se nenhum funcionou, tenta o primeiro com timeout maior
      if (!foundSelector) {
        foundSelector = selectors[0];
        try {
          await this.page.waitForSelector(foundSelector, {
            state: 'visible',
            timeout: action.timeout || this.options.timeout,
          });
        } catch (e) {
          const error = new Error(`Elemento não encontrado: ${foundSelector}`);
          error.code = 'RPA_ELEMENT_NOT_FOUND';
          throw error;
        }
      }

      // Aguarda um pouco para garantir que o campo está pronto
      await this.page.waitForTimeout(100);

      // Garante foco explícito antes de digitar
      await this.page.click(foundSelector);
      await this.page.waitForTimeout(50);

      if (action.clear !== false) {
        await this.page.fill(foundSelector, '');
        await this.page.waitForTimeout(50);
      }

      // Digitação caractere a caractere usando velocidade do config
      // (não do seed - seed não contém velocidade)
      const typingSpeedMs = action.typingSpeedMs !== undefined 
        ? action.typingSpeedMs 
        : (this.options.typingSpeedMs || 0);
      
      if (typingSpeedMs > 0 && value) {
        // Digita caractere a caractere com velocidade controlada
        const element = this.page.locator(foundSelector).first();
        for (let i = 0; i < value.length; i++) {
          const char = value[i];
          await element.type(char, { delay: typingSpeedMs });
        }
      } else {
        // Preenchimento rápido (modo CI ou typingSpeedMs = 0)
        await this.page.fill(foundSelector, value);
      }
      
      await this.page.waitForTimeout(100); // Aguarda valor ser preenchido

      // Valida se necessário
      if (action.validate) {
        const actualValue = await this.page.inputValue(foundSelector);
        if (action.validate.value && actualValue !== action.validate.value) {
          const error = new Error(`Validação falhou: esperado "${action.validate.value}", recebido "${actualValue}"`);
          error.code = 'RPA_ACTION_FAILED';
          return {
            success: false,
            error: error.message,
            code: error.code,
          };
        }
      }

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error.message,
        code: error.code || 'RPA_ACTION_FAILED',
      };
    }
  }

  /**
   * Executa ação de seleção.
   */
  async executeSelect(action, data) {
    try {
      const selector = this.replaceVariables(action.selector, data);
      let value = this.replaceVariables(action.value, data);

      // Popula dados se necessário
      if (value.startsWith('{{') && value.endsWith('}}')) {
        value = this.dataPopulator.populate(value, data);
      }

      await this.page.waitForSelector(selector, {
        state: 'visible',
        timeout: action.timeout || this.options.timeout,
      });

      await this.page.selectOption(selector, value);

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error.message,
        code: error.code || 'RPA_ACTION_FAILED',
      };
    }
  }

  /**
   * Executa ação de espera.
   * 
   * @throws {Error} RPA_TIMEOUT se timeout ocorrer
   */
  async executeWait(action, data) {
    try {
      // Suporta múltiplos formatos: condition (legado), selector (novo), ou value como número
      const condition = action.condition || action.selector;
      const value = action.value;

      // Se há um seletor/condition, aguarda o seletor (value pode ser usado como timeout)
      if (condition && typeof condition === 'string' && condition.trim() !== '') {
        let selector = this.replaceVariables(condition, data);
        
        // Garante que selector é uma string válida
        if (!selector) {
          selector = condition; // Fallback para o original se replaceVariables retornar null/undefined
        }
        if (typeof selector !== 'string') {
          selector = String(selector);
        }
        
        // Valida se o seletor resultante é válido
        if (!selector || selector.trim() === '') {
          return {
            success: false,
            error: `Seletor inválido após substituição: ${condition}`,
            code: 'RPA_INVALID_SELECTOR',
          };
        }

        const state = action.state || 'visible';
        
        // Calcula timeout: action.timeout > value (se numérico) > options.timeout
        let timeout = action.timeout;
        if (!timeout && value) {
          if (typeof value === 'number') {
            timeout = value;
          } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
            timeout = parseInt(value, 10);
          }
        }
        timeout = timeout || this.options.timeout;

        // Validação final antes de chamar waitForSelector
        if (!selector || typeof selector !== 'string' || selector.trim() === '') {
          return {
            success: false,
            error: `Seletor inválido antes de waitForSelector: ${JSON.stringify({ condition, selector, value, action })}`,
            code: 'RPA_INVALID_SELECTOR',
          };
        }

        // Validação extra: garante que this.page existe e que selector é uma string válida
        if (!this.page) {
          return {
            success: false,
            error: 'Página não inicializada (this.page é null)',
            code: 'RPA_PAGE_NOT_INITIALIZED',
          };
        }

        // Garante que selector é uma string não vazia (última verificação)
        const finalSelector = String(selector).trim();
        if (!finalSelector) {
          return {
            success: false,
            error: `Seletor final vazio após todas as validações: ${JSON.stringify({ condition, selector, value })}`,
            code: 'RPA_INVALID_SELECTOR',
          };
        }

        await this.page.waitForSelector(finalSelector, {
          state,
          timeout,
        });

        return { success: true };
      }

      // Se não há seletor mas value é numérico, aguarda tempo
      if (value && typeof value === 'number') {
        await this.page.waitForTimeout(value);
        return { success: true };
      }
      
      // Se value é string numérica e não há seletor, aguarda tempo
      if (value && typeof value === 'string' && /^\d+$/.test(value.trim())) {
        await this.page.waitForTimeout(parseInt(value, 10));
        return { success: true };
      }

      // Se condition é número (formato legado), aguarda tempo
      if (condition && typeof condition === 'number') {
        await this.page.waitForTimeout(condition);
        return { success: true };
      }

      // Se nenhuma condição válida foi encontrada
      return {
        success: false,
        error: 'Ação wait requer condition/selector (string) ou value (número)',
        code: 'RPA_INVALID_WAIT',
      };
    } catch (error) {
      return { 
        success: false, 
        error: error.message,
        code: error.code || 'RPA_TIMEOUT',
      };
    }
  }

  /**
   * Valida URL da página.
   * 
   * @param {Object} urlConfig - Configuração de validação de URL
   * @param {string} actualUrl - URL atual da página
   * @param {Object} data - Dados para substituição de variáveis
   * @returns {Object} { valid: boolean, error?: string }
   */
  validateUrl(urlConfig, actualUrl, data) {
    if (urlConfig.exact !== undefined) {
      const expectedUrl = this.replaceVariables(urlConfig.exact, data);
      // Compatibilidade + robustez:
      // - Se o esperado não contém query/hash, comparamos apenas origin+pathname (ignora query/hash do atual).
      //   Ex.: esperado "http://localhost:5173/chat" deve aceitar "http://localhost:5173/chat?flowId=..."
      // - Se o esperado é apenas a base/origin (pathname "/"), aceitamos qualquer rota dentro do mesmo origin.
      // - Se o esperado contém query/hash, aí sim exigimos igualdade completa.
      const expectedHasQueryOrHash = /[?#]/.test(expectedUrl);
      if (!expectedHasQueryOrHash) {
        try {
          const expectedParsed = new URL(expectedUrl);
          const actualParsed = new URL(actualUrl);

          const expectedOrigin = expectedParsed.origin;
          const actualOrigin = actualParsed.origin;
          if (expectedOrigin !== actualOrigin) {
            return {
              valid: false,
              error: `URL esperada exata "${expectedUrl}", recebida "${actualUrl}"`,
            };
          }

          const normalizePath = (p) => {
            if (!p) return '/';
            if (p.length > 1 && p.endsWith('/')) return p.slice(0, -1);
            return p;
          };

          const expectedPath = normalizePath(expectedParsed.pathname);
          const actualPath = normalizePath(actualParsed.pathname);

          // Caso especial: esperado é só base/origin ("/") => qualquer rota do mesmo origin é válida
          if (expectedPath === '/') {
            return { valid: true };
          }

          // Caso padrão: exige pathname igual, ignora query/hash do atual
          if (expectedPath !== actualPath) {
            return {
              valid: false,
              error: `URL esperada exata "${expectedUrl}", recebida "${actualUrl}"`,
            };
          }
        } catch (e) {
          // Se URL() falhar (ex.: relativo), cai no comportamento antigo (comparação literal)
          if (actualUrl !== expectedUrl) {
            return {
              valid: false,
              error: `URL esperada exata "${expectedUrl}", recebida "${actualUrl}"`,
            };
          }
        }
      } else {
        // Expected com query/hash => igualdade literal
        if (actualUrl !== expectedUrl) {
          return {
            valid: false,
            error: `URL esperada exata "${expectedUrl}", recebida "${actualUrl}"`,
          };
        }
      }
    }

    if (urlConfig.contains !== undefined) {
      const expectedContains = this.replaceVariables(urlConfig.contains, data);
      if (!actualUrl.includes(expectedContains)) {
        return {
          valid: false,
          error: `URL deve conter "${expectedContains}", recebida "${actualUrl}"`,
        };
      }
    }

    if (urlConfig.pattern !== undefined) {
      const pattern = this.replaceVariables(urlConfig.pattern, data);
      const regex = new RegExp(pattern);
      if (!regex.test(actualUrl)) {
        return {
          valid: false,
          error: `URL não corresponde ao padrão "${pattern}", recebida "${actualUrl}"`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Valida título da página.
   * 
   * @param {Object} titleConfig - Configuração de validação de título
   * @param {string} actualTitle - Título atual da página
   * @param {Object} data - Dados para substituição de variáveis
   * @returns {Object} { valid: boolean, error?: string }
   */
  validateTitle(titleConfig, actualTitle, data) {
    if (typeof titleConfig === 'string') {
      // Compatibilidade: título simples como string
      const expectedTitle = this.replaceVariables(titleConfig, data);
      if (actualTitle.trim() !== expectedTitle.trim()) {
        return {
          valid: false,
          error: `Título esperado "${expectedTitle}", recebido "${actualTitle}"`,
        };
      }
      return { valid: true };
    }

    if (titleConfig.exact !== undefined) {
      const expectedTitle = this.replaceVariables(titleConfig.exact, data);
      if (actualTitle.trim() !== expectedTitle.trim()) {
        return {
          valid: false,
          error: `Título esperado exato "${expectedTitle}", recebido "${actualTitle}"`,
        };
      }
    }

    if (titleConfig.contains !== undefined) {
      const expectedContains = this.replaceVariables(titleConfig.contains, data);
      if (!actualTitle.includes(expectedContains)) {
        return {
          valid: false,
          error: `Título deve conter "${expectedContains}", recebido "${actualTitle}"`,
        };
      }
    }

    if (titleConfig.pattern !== undefined) {
      const pattern = this.replaceVariables(titleConfig.pattern, data);
      const regex = new RegExp(pattern);
      if (!regex.test(actualTitle)) {
        return {
          valid: false,
          error: `Título não corresponde ao padrão "${pattern}", recebido "${actualTitle}"`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Valida meta tag da página.
   * 
   * @param {Object} metaConfig - Configuração de validação de meta tag
   * @param {Object} data - Dados para substituição de variáveis
   * @returns {Promise<Object>} { valid: boolean, error?: string }
   */
  async validateMeta(metaConfig, data) {
    try {
      const property = this.replaceVariables(metaConfig.property, data);
      const expectedContent = this.replaceVariables(metaConfig.content, data);

      const actualContent = await this.page.evaluate((prop) => {
        // Tenta property primeiro (og:title, og:description, etc)
        const metaByProperty = document.querySelector(`meta[property="${prop}"]`);
        if (metaByProperty) {
          return metaByProperty.getAttribute('content');
        }

        // Tenta name como fallback
        const metaByName = document.querySelector(`meta[name="${prop}"]`);
        if (metaByName) {
          return metaByName.getAttribute('content');
        }

        return null;
      }, property);

      if (!actualContent) {
        return {
          valid: false,
          error: `Meta tag "${property}" não encontrada`,
        };
      }

      if (metaConfig.exact !== false) {
        // Por padrão, validação exata
        if (actualContent.trim() !== expectedContent.trim()) {
          return {
            valid: false,
            error: `Meta tag "${property}" esperada "${expectedContent}", recebida "${actualContent}"`,
          };
        }
      } else if (metaConfig.contains !== false) {
        // Se exact=false, tenta contains
        if (!actualContent.includes(expectedContent)) {
          return {
            valid: false,
            error: `Meta tag "${property}" deve conter "${expectedContent}", recebida "${actualContent}"`,
          };
        }
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: `Erro ao validar meta tag: ${error.message}`,
      };
    }
  }

  /**
   * Valida landmark (elemento-chave) da página.
   * 
   * @param {Object} landmark - Configuração do landmark
   * @param {Object} data - Dados para substituição de variáveis
   * @returns {Promise<Object>} { valid: boolean, error?: string }
   */
  async validateLandmark(landmark, data) {
    try {
      const selector = this.replaceVariables(landmark.selector, data);

      // Verifica existência
      if (landmark.exists !== undefined) {
        const exists = await this.page.locator(selector).count() > 0;
        if (exists !== landmark.exists) {
          return {
            valid: false,
            error: `Landmark "${selector}" ${exists ? 'existe' : 'não existe'} quando esperado ${landmark.exists ? 'existir' : 'não existir'}`,
          };
        }
      }

      // Verifica visibilidade
      if (landmark.visible !== undefined) {
        const isVisible = await this.page.locator(selector).isVisible();
        if (isVisible !== landmark.visible) {
          return {
            valid: false,
            error: `Landmark "${selector}" ${isVisible ? 'visível' : 'não visível'} quando esperado ${landmark.visible ? 'visível' : 'não visível'}`,
          };
        }
      }

      // Verifica texto
      if (landmark.text !== undefined) {
        const actualText = await this.page.locator(selector).textContent();
        const expectedText = this.replaceVariables(landmark.text, data);
        if (actualText.trim() !== expectedText.trim()) {
          return {
            valid: false,
            error: `Landmark "${selector}" texto esperado "${expectedText}", recebido "${actualText}"`,
          };
        }
      }

      // Verifica valor
      if (landmark.value !== undefined) {
        const actualValue = await this.page.locator(selector).inputValue();
        const expectedValue = this.replaceVariables(landmark.value, data);
        if (actualValue !== expectedValue) {
          return {
            valid: false,
            error: `Landmark "${selector}" valor esperado "${expectedValue}", recebido "${actualValue}"`,
          };
        }
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: `Erro ao validar landmark: ${error.message}`,
      };
    }
  }

  /**
   * Executa ação de assert/validação.
   * 
   * Suporta múltiplas estratégias de identificação de página:
   * - URL (exact, contains, pattern)
   * - Título (exact, contains, pattern)
   * - Landmarks (elementos-chave)
   * - Meta tags (para SPAs)
   * 
   * Modos de validação:
   * - "all": todas as estratégias devem passar (padrão)
   * - "any": qualquer estratégia pode passar
   * 
   * @throws {Error} RPA_ACTION_FAILED se validação falhar
   */
  async executeAssert(action, data) {
    try {
      // ============================================
      // VALIDAÇÃO DE PÁGINA COMPLETA (nova funcionalidade)
      // ============================================
      if (action.page) {
        const validationMode = action.validationMode || 'all'; // 'all' ou 'any'
        const results = [];
        const errors = [];

        // Valida URL
        if (action.page.url) {
          const actualUrl = this.page.url();
          const urlResult = this.validateUrl(action.page.url, actualUrl, data);
          results.push(urlResult.valid);
          if (!urlResult.valid) {
            errors.push(`URL: ${urlResult.error}`);
          }
        }

        // Valida Título
        if (action.page.title) {
          const actualTitle = await this.page.title();
          const titleResult = this.validateTitle(action.page.title, actualTitle, data);
          results.push(titleResult.valid);
          if (!titleResult.valid) {
            errors.push(`Título: ${titleResult.error}`);
          }
        }

        // Valida Meta Tags
        if (action.page.meta) {
          const metaResult = await this.validateMeta(action.page.meta, data);
          results.push(metaResult.valid);
          if (!metaResult.valid) {
            errors.push(`Meta: ${metaResult.error}`);
          }
        }

        // Valida Landmarks
        if (action.page.landmarks && Array.isArray(action.page.landmarks)) {
          for (const landmark of action.page.landmarks) {
            const landmarkResult = await this.validateLandmark(landmark, data);
            results.push(landmarkResult.valid);
            if (!landmarkResult.valid) {
              errors.push(`Landmark: ${landmarkResult.error}`);
            }
          }
        }

        // Avalia resultados baseado no modo
        let isValid = false;
        if (validationMode === 'any') {
          // Qualquer validação passou
          isValid = results.length > 0 && results.some(r => r === true);
        } else {
          // Todas as validações devem passar
          isValid = results.length > 0 && results.every(r => r === true);
        }

        if (!isValid) {
          return {
            success: false,
            error: action.message || `Validação de página falhou (modo: ${validationMode}):\n${errors.join('\n')}`,
            code: 'RPA_ACTION_FAILED',
          };
        }

        return { success: true };
      }

      // ============================================
      // COMPATIBILIDADE: Título simples (legado)
      // ============================================
      if (action.title !== undefined) {
        const actualTitle = await this.page.title();
        const titleResult = this.validateTitle(action.title, actualTitle, data);
        if (!titleResult.valid) {
          return {
            success: false,
            error: action.message || titleResult.error,
            code: 'RPA_ACTION_FAILED',
          };
        }
        return { success: true };
      }

      // ============================================
      // COMPATIBILIDADE: Validação de elemento (legado)
      // ============================================
      if (!action.selector) {
        return {
          success: false,
          error: action.message || 'Ação de assert requer selector, title ou page',
          code: 'RPA_ACTION_FAILED',
        };
      }

      const selector = this.replaceVariables(action.selector, data);

      // Verifica existência
      if (action.exists !== undefined) {
        // Hardening: asserts negativos com seletor genérico são frágeis e tendem a falhar sempre.
        // Ex.: "input, textarea, [contenteditable='true']"
        if (action.exists === false) {
          const norm = String(selector || '').trim().replace(/"/g, "'").replace(/\s+/g, ' ');
          const isGeneric =
            norm === 'input' ||
            norm === 'textarea' ||
            norm === "[contenteditable='true']" ||
            norm.startsWith('input,') ||
            norm.startsWith('textarea,') ||
            norm.includes('input, textarea') ||
            (norm.includes("[contenteditable='true']") && (norm.includes('input') || norm.includes('textarea')));
          if (isGeneric) {
            return {
              success: false,
              error: action.message || `Assert negativo com seletor genérico não é permitido: "${selector}"`,
              code: 'RPA_INVALID_ASSERT',
            };
          }
        }
        const exists = await this.page.locator(selector).count() > 0;
        if (exists !== action.exists) {
          return {
            success: false,
            error: action.message || `Elemento ${exists ? 'existe' : 'não existe'} quando esperado ${action.exists ? 'existir' : 'não existir'}`,
          };
        }
      }

      // Verifica visibilidade
      if (action.visible !== undefined) {
        const isVisible = await this.page.locator(selector).isVisible();
        if (isVisible !== action.visible) {
          return {
            success: false,
            error: action.message || `Elemento ${isVisible ? 'visível' : 'não visível'} quando esperado ${action.visible ? 'visível' : 'não visível'}`,
            code: 'RPA_ACTION_FAILED',
          };
        }
      }

      // Verifica texto (contém)
      // Regra: se `textContains` estiver definido, ele tem precedência e NÃO executamos
      // a validação de `text` exato (evita seeds gerados com ambos os campos).
      if (action.textContains !== undefined) {
        const actualTextRaw = await this.page.locator(selector).textContent();
        const expectedTextRaw = this.replaceVariables(action.textContains, data);

        const actualText = (actualTextRaw || '');
        const expectedText = (expectedTextRaw || '');

        const normalizeWs = (s) => String(s || '').replace(/\s+/g, ' ').trim();
        const ok =
          actualText.includes(expectedText) ||
          normalizeWs(actualText).includes(normalizeWs(expectedText));

        if (!ok) {
          return {
            success: false,
            error: action.message || `Texto deve conter "${expectedText}", recebido "${actualText}"`,
            code: 'RPA_ACTION_FAILED',
          };
        }
      }

      // Verifica texto (exato) — apenas quando `textContains` não foi solicitado
      if (action.text && action.textContains === undefined) {
        const actualText = await this.page.locator(selector).textContent();
        const expectedText = this.replaceVariables(action.text, data);
        if (actualText.trim() !== expectedText.trim()) {
          return {
            success: false,
            error: action.message || `Texto esperado "${expectedText}", recebido "${actualText}"`,
          };
        }
      }

      // Verifica valor
      if (action.value) {
        const actualValue = await this.page.locator(selector).inputValue();
        const expectedValue = this.replaceVariables(action.value, data);
        if (actualValue !== expectedValue) {
          return {
            success: false,
            error: action.message || `Valor esperado "${expectedValue}", recebido "${actualValue}"`,
          };
        }
      }

      // Verifica contagem
      if (action.count !== undefined) {
        const actualCount = await this.page.locator(selector).count();
        if (actualCount !== action.count) {
          return {
            success: false,
            error: action.message || `Contagem esperada ${action.count}, recebida ${actualCount}`,
          };
        }
      }

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error.message,
        code: error.code || 'RPA_ACTION_FAILED',
      };
    }
  }

  /**
   * Substitui variáveis em string.
   * 
   * @param {string} str - String com variáveis {{var}}
   * @param {Object} data - Dados para substituição
   */
  replaceVariables(str, data) {
    // Se não for string, retorna como está (mas valida se é undefined/null)
    if (typeof str !== 'string') {
      if (str === null || str === undefined) {
        return '';
      }
      return str;
    }

    // Se string vazia, retorna como está
    if (str.trim() === '') {
      return str;
    }

    return str.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const keys = key.trim().split('.');
      let value = data;
      
      for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
          value = value[k];
        } else {
          return match; // Retorna original se não encontrar
        }
      }
      
      return value !== undefined && value !== null ? String(value) : match;
    });
  }

  /**
   * Captura screenshot.
   * 
   * @param {string} name - Nome do screenshot
   */
  async captureScreenshot(name) {
    try {
      // Verifica se a página ainda está aberta
      if (!this.page) {
        console.warn('Não é possível capturar screenshot: página não inicializada');
        return null;
      }

      // Verifica se a página está fechada
      if (this.page.isClosed && this.page.isClosed()) {
        console.warn('Não é possível capturar screenshot: página já foi fechada');
        return null;
      }

      const screenshotsDir = path.join(__dirname, 'screenshots');
      const fs = require('fs');
      
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
      }

      const filepath = path.join(screenshotsDir, `${name}.png`);
      await this.page.screenshot({ path: filepath, fullPage: true });
      
      this.screenshots.push(filepath);
      return filepath;
    } catch (error) {
      // Verifica se o erro é porque a página foi fechada
      if (error.message && error.message.includes('Target page, context or browser has been closed')) {
        console.warn('Não é possível capturar screenshot: página, contexto ou navegador foi fechado');
        return null;
      }
      console.error('Erro ao capturar screenshot:', error);
      return null;
    }
  }

  /**
   * Retorna erros coletados.
   */
  getErrors() {
    return [...this.errors];
  }

  getHttpErrors() {
    return [...this.httpErrors];
  }

  /**
   * Retorna screenshots capturados.
   */
  getScreenshots() {
    return [...this.screenshots];
  }
}

module.exports = { ActionExecutor };

