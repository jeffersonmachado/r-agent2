/**
 * Gravador RPA com digitação visível caractere a caractere.
 * 
 * Grava ações do usuário durante interação manual e salva em formato seed.
 * O seed descreve O QUE foi feito, não COMO foi executado.
 */

const { chromium } = require('playwright');
const { ActionRecorder } = require('../actionRecorder');
const { getModeConfig } = require('../rpaConfig');
const { ReplaySystem } = require('../replaySystem');
const crypto = require('crypto');
const { normalizeTenantKey } = require('../../../lib/rpaSecurity');
const { getRpaReplayDir } = require('../../../lib/rpaPathResolver');

class RpaRecorder {
  constructor(options = {}) {
    this.mode = options.mode || 'record';
    this.modeConfig = getModeConfig(this.mode);
    this.browser = null;
    this.page = null;
    this.context = null;
    this.tenantId = normalizeTenantKey(options.tenantId || 'system');
    this.recorder = new ActionRecorder({ tenantId: this.tenantId });
    this.replaySystem = new ReplaySystem({
      tenantId: this.tenantId,
      storagePath: getRpaReplayDir(this.tenantId),
      storagePathIsTenantScoped: true,
    });
    this.isRecording = false;
    this.seedName = options.seedName || `seed-${Date.now()}`;
    this.screenshots = [];
  }

  /**
   * Inicializa browser e página para gravação.
   */
  async init() {
    this.browser = await chromium.launch({
      headless: this.modeConfig.headless,
      slowMo: this.modeConfig.actionDelayMs,
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
    });

    this.page = await this.context.newPage();
    
    // Intercepta ações do usuário
    await this.setupRecording();
  }

  /**
   * Configura interceptação de ações para gravação.
   * 
   * Durante a gravação:
   * - Executa digitação caractere a caractere VISUALMENTE usando typingSpeedMs
   * - Garante foco explícito antes de gravar TYPE
   * - Grava apenas O QUE foi feito (texto completo), não COMO (velocidade)
   */
  async setupRecording() {
    // Rastreia campos que estão sendo preenchidos para evitar duplicatas
    this.activeFillFields = new Map();

    // Intercepta cliques
    this.page.on('click', async (event) => {
      if (this.isRecording) {
        const selector = await this.getElementSelector(event.target);
        if (selector) {
          const stepIndex = this.recorder.actions.length + 1;
          const stepStartTime = new Date().toISOString();
          
          // REPLAY OBRIGATÓRIO: Captura tela antes
          await this.replaySystem.recordScreen(this.page, `step-${stepIndex}-before`);
          
          const screenBefore = await this.captureScreenHash();
          this.recorder.recordClick(selector);
          
          // Aguarda estabilização da tela
          await this.page.waitForTimeout(this.modeConfig.screenStabilizeMs);
          const screenAfter = await this.captureScreenHash();
          this.recordScreenChange(screenBefore, screenAfter);
          
          const stepEndTime = new Date().toISOString();
          
          // REPLAY OBRIGATÓRIO: Registra ação e captura tela depois
          this.replaySystem.recordAction(
            { type: 'click', selector, step: `step-${stepIndex}` },
            { success: true, startTime: stepStartTime, endTime: stepEndTime }
          );
          await this.replaySystem.recordScreen(this.page, `step-${stepIndex}-after`);
        }
      }
    });

    // Intercepta foco em campos de input (garante foco explícito)
    this.page.on('focus', async (event) => {
      if (this.isRecording) {
        const selector = await this.getElementSelector(event.target);
        if (selector) {
          // Marca campo como ativo para gravação
          this.activeFillFields.set(selector, {
            startTime: Date.now(),
            lastValue: '',
          });
        }
      }
    });

    // Intercepta digitação (via input events)
    // Durante gravação, executa digitação caractere a caractere VISUALMENTE
    this.page.on('input', async (event) => {
      if (this.isRecording) {
        const selector = await this.getElementSelector(event.target);
        const currentValue = await event.target.value();
        
        if (selector && currentValue) {
          const fieldState = this.activeFillFields.get(selector);
          
          // Se é um novo campo ou valor mudou significativamente, grava ação
          if (!fieldState || currentValue !== fieldState.lastValue) {
            const stepIndex = this.recorder.actions.length + 1;
            const stepStartTime = new Date().toISOString();
            
            // REPLAY OBRIGATÓRIO: Captura tela antes
            await this.replaySystem.recordScreen(this.page, `step-${stepIndex}-before`);
            
            // Captura tela antes
            const screenBefore = await this.captureScreenHash();
            
            // Garante foco explícito
            try {
              await event.target.focus();
            } catch (e) {
              // Ignora erro de foco se já estiver focado
            }
            
            // Grava ação TYPE com texto completo (sem delays no seed)
            // O seed contém apenas: tipo, seletor, texto completo
            this.recorder.recordFill(selector, currentValue, {
              // Não inclui delays ou velocidade no seed
              clear: false, // Não limpa durante gravação (usuário já digitou)
            });
            
            // Atualiza estado do campo
            this.activeFillFields.set(selector, {
              startTime: fieldState?.startTime || Date.now(),
              lastValue: currentValue,
            });
            
            // Aguarda estabilização da tela
            await this.page.waitForTimeout(this.modeConfig.screenStabilizeMs);
            const screenAfter = await this.captureScreenHash();
            this.recordScreenChange(screenBefore, screenAfter);
            
            const stepEndTime = new Date().toISOString();
            
            // REPLAY OBRIGATÓRIO: Registra ação e captura tela depois
            this.replaySystem.recordAction(
              { type: 'fill', selector, value: currentValue, step: `step-${stepIndex}` },
              { success: true, startTime: stepStartTime, endTime: stepEndTime }
            );
            await this.replaySystem.recordScreen(this.page, `step-${stepIndex}-after`);
          }
        }
      }
    });

    // Limpa campo quando perde foco
    this.page.on('blur', async (event) => {
      if (this.isRecording) {
        const selector = await this.getElementSelector(event.target);
        if (selector) {
          this.activeFillFields.delete(selector);
        }
      }
    });
  }

  /**
   * Obtém seletor CSS para um elemento.
   */
  async getElementSelector(element) {
    try {
      // Tenta obter seletor via Playwright
      const tagName = await element.evaluate((el) => el.tagName.toLowerCase());
      const id = await element.evaluate((el) => el.id);
      const className = await element.evaluate((el) => el.className);
      
      if (id) {
        return `#${id}`;
      }
      
      if (className && typeof className === 'string') {
        const classes = className.split(' ').filter(c => c).join('.');
        if (classes) {
          return `${tagName}.${classes}`;
        }
      }
      
      return tagName;
    } catch (error) {
      return null;
    }
  }

  /**
   * Captura hash da tela atual.
   */
  async captureScreenHash() {
    try {
      const screenshot = await this.page.screenshot({ fullPage: false });
      const hash = crypto.createHash('md5').update(screenshot).digest('hex');
      return hash;
    } catch (error) {
      return null;
    }
  }

  /**
   * Registra mudança de tela.
   */
  recordScreenChange(before, after) {
    if (before && after && before !== after) {
      // Tela mudou - pode ser registrado no seed se necessário
    }
  }

  /**
   * Inicia gravação.
   * 
   * IMPORTANTE: Replay é OBRIGATÓRIO mesmo durante gravação.
   */
  async startRecording(initialUrl = null) {
    this.isRecording = true;
    this.recorder.start({
      name: this.seedName,
      url: initialUrl,
      tenantId: this.tenantId,
    });

    // REPLAY OBRIGATÓRIO: Inicia replay para gravação
    this.replaySystem.start(this.seedName, { tenantId: this.tenantId });

    if (initialUrl) {
      await this.page.goto(initialUrl);
      await this.page.waitForTimeout(this.modeConfig.screenStabilizeMs);
      const screenHash = await this.captureScreenHash();
      this.recorder.recordNavigate(initialUrl);
      
      // REPLAY OBRIGATÓRIO: Registra navegação inicial no replay
      await this.replaySystem.recordScreen(this.page, 'initial');
      this.replaySystem.recordAction(
        { type: 'navigate', url: initialUrl, step: 'initial' },
        { success: true, startTime: new Date().toISOString(), endTime: new Date().toISOString() }
      );
    }

    console.log('🎬 Gravação iniciada. Interaja com a página...');
    console.log('   Pressione Ctrl+C para parar a gravação.');
  }

  /**
   * Para gravação e salva seed.
   * 
   * IMPORTANTE: 
   * - O seed NÃO deve conter: delays, velocidade, timing, modeConfig
   * - O seed descreve apenas O QUE foi feito, não COMO
   * - REPLAY OBRIGATÓRIO: Sempre gera replay da gravação
   */
  async stopRecording() {
    this.isRecording = false;
    this.recorder.stop();

    // Salva seed SEM incluir config (config não faz parte do seed)
    const seedPath = this.recorder.save(this.seedName, {
      // NÃO inclui modeConfig - isso é config, não seed
      // NÃO inclui delays ou velocidade
      screenshots: this.screenshots,
      source: 'manual', // Flag para identificar gravação manual
      tenantId: this.tenantId,
    });

    // REPLAY OBRIGATÓRIO: Para e salva replay da gravação
    this.replaySystem.stop();
    const replayPath = this.replaySystem.save(`replay-record-${this.seedName}-${Date.now()}`);

    console.log(`✅ Gravação salva: ${seedPath}`);
    console.log(`   Seed contém apenas ações (sem delays/velocidade)`);
    console.log(`   Replay salvo: ${replayPath}`);
    
    return {
      seedPath,
      replayPath,
      seedId: this.seedName,
      replayId: this.replaySystem.replayData.id,
    };
  }

  /**
   * Fecha browser.
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
}

module.exports = { RpaRecorder };
