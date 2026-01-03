/**
 * Player RPA - Reproduz seeds gravados.
 * 
 * Suporta modos:
 * - playback: Visual, com digitação visível
 * - ci: Headless, rápido, sem delays
 */

const { chromium } = require('playwright');
const { ActionExecutor } = require('../actionExecutor');
const { ReplaySystem } = require('../replaySystem');
const { getModeConfig } = require('../rpaConfig');
const { ActionRecorder } = require('../actionRecorder');
const { normalizeRpaTestUrls } = require('../utils/urlNormalizer');
const { ensureAuthenticated } = require('../utils/authHelper');
const path = require('path');
const fs = require('fs');

class RpaPlayer {
  constructor(options = {}) {
    this.mode = options.mode || 'playback';
    this.modeConfig = getModeConfig(this.mode);
    this.executor = null;
    this.replaySystem = new ReplaySystem();
    this.seedPath = options.seedPath;
    this.seedData = null;
  }

  /**
   * Carrega seed de arquivo.
   */
  loadSeed(seedName) {
    const seedsDir = path.join(__dirname, '..', 'seeds');
    const seedFile = path.join(seedsDir, `${seedName}.json`);
    
    // Fallback para recordings se não encontrar em seeds
    if (!fs.existsSync(seedFile)) {
      try {
        this.seedData = ActionRecorder.load(seedName);
      } catch (error) {
        throw new Error(`Seed não encontrado: ${seedName}`);
      }
    } else {
      const content = fs.readFileSync(seedFile, 'utf8');
      this.seedData = JSON.parse(content);
    }

    // Normaliza URLs no seed/recording carregado
    if (this.seedData) {
      try {
        normalizeRpaTestUrls(this.seedData);
      } catch (error) {
        console.warn(`Aviso: Erro ao normalizar URLs: ${error.message}`);
      }
    }
  }

  /**
   * Inicializa executor.
   * 
   * IMPORTANTE: Replay é OBRIGATÓRIO em todas as execuções.
   */
  async init() {
    // Calcula slowMo baseado no config (aplicado via speedMultiplier)
    const effectiveSlowMo = this.modeConfig.actionDelayMs / this.modeConfig.speedMultiplier;
    
    this.executor = new ActionExecutor({
      headless: this.modeConfig.headless,
      slowMo: effectiveSlowMo > 0 ? effectiveSlowMo : 0,
      typingSpeedMs: this.modeConfig.typingSpeedMs / this.modeConfig.speedMultiplier,
    });

    await this.executor.init();
    
    // REPLAY OBRIGATÓRIO: Inicia replay para TODA execução
    this.replaySystem.start(this.seedData.id || this.seedData.name);
  }

  /**
   * Executa digitação caractere a caractere com controle de velocidade.
   * 
   * Aplica velocidade baseada no config:
   * - typingSpeedMs: Delay entre caracteres
   * - speedMultiplier: Multiplicador de velocidade (aplica inversamente)
   * 
   * @param {string} selector - Seletor do campo
   * @param {string} text - Texto completo a digitar
   */
  async typeCharByChar(selector, text) {
    if (!text) return;

    // Calcula delay efetivo baseado no config
    const effectiveDelay = this.modeConfig.typingSpeedMs / this.modeConfig.speedMultiplier;

    // Garante foco explícito antes de digitar
    const element = this.executor.page.locator(selector).first();
    await element.click();
    await this.executor.page.waitForTimeout(100); // Pequeno delay para garantir foco
    
    // Limpa campo se necessário
    await element.fill('');
    await this.executor.page.waitForTimeout(50);

    // Digita caractere a caractere com velocidade controlada
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      // Aplica delay apenas se > 0 (modo CI usa 0)
      if (effectiveDelay > 0) {
        await element.type(char, { delay: effectiveDelay });
      } else {
        // Modo CI: digitação instantânea
        await element.type(char, { delay: 0 });
      }
    }
  }

  /**
   * Executa uma ação do seed.
   * 
   * IMPORTANTE:
   * - TYPE (fill) sempre executa caractere a caractere usando config
   * - Replay é sempre registrado
   * - Velocidade é controlada pelo config, não pelo seed
   */
  async executeAction(action, stepIndex) {
    const stepStartTime = new Date().toISOString();

    // REPLAY OBRIGATÓRIO: Captura tela antes
    await this.replaySystem.recordScreen(this.executor.page, `step-${stepIndex}-before`);

    let result;

    // Executa TYPE (fill) com digitação caractere a caractere
    // Aplica velocidade baseada no config (não no seed)
    if (action.type === 'fill' || action.type === 'type') {
      try {
        const selector = action.selector;
        const value = action.value || '';
        
        // Aguarda elemento estar visível
        await this.executor.page.waitForSelector(selector, {
          state: 'visible',
          timeout: action.timeout || 30000,
        });

        // Limpa campo se necessário
        if (action.clear !== false) {
          await this.executor.page.fill(selector, '');
          await this.executor.page.waitForTimeout(100);
        }

        // Digita caractere a caractere usando velocidade do config
        // (não do seed - seed não contém velocidade)
        await this.typeCharByChar(selector, value);

        // Aguarda estabilização (baseado no config)
        const stabilizeDelay = this.modeConfig.screenStabilizeMs / this.modeConfig.speedMultiplier;
        if (stabilizeDelay > 0) {
          await this.executor.page.waitForTimeout(stabilizeDelay);
        }

        result = { success: true };
      } catch (error) {
        result = { 
          success: false, 
          error: error.message,
          code: 'RPA_ACTION_FAILED',
        };
      }
    } else {
      // Executa outras ações normalmente
      // Passa typingSpeedMs calculado para o executor
      const actionWithConfig = {
        ...action,
        typingSpeedMs: this.modeConfig.typingSpeedMs / this.modeConfig.speedMultiplier,
      };
      result = await this.executor.executeAction(actionWithConfig);
    }

    const stepEndTime = new Date().toISOString();

    // REPLAY OBRIGATÓRIO: Registra ação no replay
    this.replaySystem.recordAction(
      { ...action, step: `step-${stepIndex}` },
      {
        ...result,
        startTime: stepStartTime,
        endTime: stepEndTime,
      }
    );

    // REPLAY OBRIGATÓRIO: Captura tela depois
    await this.replaySystem.recordScreen(this.executor.page, `step-${stepIndex}-after`);

    return result;
  }

  /**
   * Executa seed completo.
   */
  async play(seedName = null) {
    if (seedName) {
      this.loadSeed(seedName);
    }

    if (!this.seedData) {
      throw new Error('Seed não carregado. Chame loadSeed() primeiro.');
    }

    await this.init();

    // Faz login automático antes de executar os steps
    // Navega para a página inicial primeiro se necessário
    const firstStep = this.seedData.steps?.[0];
    if (firstStep && firstStep.type === 'navigate') {
      const targetUrl = firstStep.url || firstStep.value;
      if (targetUrl) {
        try {
          await this.executor.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await this.executor.page.waitForTimeout(1000);
        } catch (error) {
          // Se falhar, tenta navegar para a URL base
          const baseUrl = process.env.TEST_FRONTEND_URL || 'http://localhost:5173';
          await this.executor.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await this.executor.page.waitForTimeout(1000);
        }
      } else {
        // Se não há URL, navega para a URL base
        const baseUrl = process.env.TEST_FRONTEND_URL || 'http://localhost:5173';
        await this.executor.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.executor.page.waitForTimeout(1000);
      }
    } else {
      // Se não há step de navegação, navega para a URL base
      const baseUrl = process.env.TEST_FRONTEND_URL || 'http://localhost:5173';
      await this.executor.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.executor.page.waitForTimeout(1000);
    }

    // Garante autenticação
    const authResult = await ensureAuthenticated(this.executor.page);
    if (!authResult.success) {
      console.warn(`⚠️  Aviso: Não foi possível fazer login automático: ${authResult.error}`);
      console.warn('   O teste continuará, mas pode falhar se a página requer autenticação.');
    } else if (authResult.loggedIn) {
      console.log('✅ Login automático realizado com sucesso');
    }

    const results = {
      seedId: this.seedData.id || this.seedData.name,
      mode: this.mode,
      startTime: new Date().toISOString(),
      endTime: null,
      success: true,
      steps: [],
      errors: [],
    };

    try {
      const steps = this.seedData.steps || [];

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepResult = await this.executeAction(step, i + 1);

        results.steps.push({
          step: i + 1,
          action: step.type,
          selector: step.selector || step.url || null,
          success: stepResult.success,
          error: stepResult.error || null,
        });

        if (!stepResult.success) {
          results.success = false;
          results.errors.push({
            step: i + 1,
            action: step.type,
            error: stepResult.error,
          });

          // Em modo CI, pode continuar ou parar
          if (step.critical !== false) {
            break;
          }
        }

        // Delay entre ações (aplicado via speedMultiplier)
        if (i < steps.length - 1) {
          const delay = this.modeConfig.actionDelayMs / this.modeConfig.speedMultiplier;
          if (delay > 0) {
            await this.executor.page.waitForTimeout(delay);
          }
        }
      }

      results.endTime = new Date().toISOString();

      // REPLAY OBRIGATÓRIO: Sempre gera replay
      this.replaySystem.stop();
      const replayPath = this.replaySystem.save(`replay-${results.seedId}-${Date.now()}`);
      results.replayId = this.replaySystem.replayData.id;
      results.replayPath = replayPath;
      
      // Inclui config aplicada no replay (para diagnóstico)
      results.config = {
        mode: this.mode,
        typingSpeedMs: this.modeConfig.typingSpeedMs,
        actionDelayMs: this.modeConfig.actionDelayMs,
        speedMultiplier: this.modeConfig.speedMultiplier,
      };

      console.log(`✅ Seed executado: ${results.seedId}`);
      console.log(`   Modo: ${this.mode}`);
      console.log(`   Velocidade: ${this.modeConfig.speedMultiplier}x`);
      console.log(`   Replay salvo: ${replayPath}`);

      return results;
    } catch (error) {
      results.success = false;
      results.errors.push({
        step: 'unknown',
        error: error.message,
        code: error.code || 'RPA_ACTION_FAILED',
      });

      // REPLAY OBRIGATÓRIO: Registra erro no replay e salva
      this.replaySystem.recordError(error, 'fatal');
      this.replaySystem.stop();
      const replayPath = this.replaySystem.save(`replay-${results.seedId}-error-${Date.now()}`);
      results.replayId = this.replaySystem.replayData.id;
      results.replayPath = replayPath;
      results.endTime = new Date().toISOString();
      
      // Inclui config aplicada no replay (para diagnóstico)
      results.config = {
        mode: this.mode,
        typingSpeedMs: this.modeConfig.typingSpeedMs,
        actionDelayMs: this.modeConfig.actionDelayMs,
        speedMultiplier: this.modeConfig.speedMultiplier,
      };

      console.error(`❌ Erro ao executar seed: ${results.seedId}`);
      console.error(`   Replay salvo: ${replayPath}`);

      throw error;
    } finally {
      await this.executor.close();
    }
  }
}

module.exports = { RpaPlayer };

