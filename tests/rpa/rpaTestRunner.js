/**
 * Runner principal de testes RPA.
 * 
 * Executa gravações de ações e gerencia todo o ciclo de testes RPA.
 */

const { ActionExecutor } = require('./actionExecutor');
const { ActionRecorder } = require('./actionRecorder');
const { DataPopulator } = require('./dataPopulation');
const { ReplaySystem } = require('./replaySystem');
const config = require('./rpaConfig');
const path = require('path');
const fs = require('fs');
const { normalizeRpaTestUrls } = require('./utils/urlNormalizer');
const { autoLoginBeforeSteps } = require('./utils/autoLoginFlow');

class RpaTestRunner {
  constructor(options = {}) {
    this.executor = null;
    this.recorder = new ActionRecorder();
    this.dataPopulator = new DataPopulator();
    this.replaySystem = new ReplaySystem();
    this.options = {
      headless: options.headless !== undefined ? options.headless : config.playwright.headless,
      slowMo: options.slowMo || config.playwright.slowMo,
      timeout: options.timeout || config.playwright.timeout,
      screenshotOnFailure: options.screenshotOnFailure !== undefined 
        ? options.screenshotOnFailure 
        : config.playwright.screenshot.onFailure,
      enableReplay: options.enableReplay !== undefined ? options.enableReplay : true,
      devtools: options.devtools !== undefined ? options.devtools : true,
    };
    this.results = [];
  }

  /**
   * Inicializa runner.
   */
  async init() {
    this.dataPopulator.loadSeeds();
    
    this.executor = new ActionExecutor({
      headless: this.options.headless,
      slowMo: this.options.slowMo,
      timeout: this.options.timeout,
      devtools: this.options.devtools,
    });

    await this.executor.init();
  }

  /**
   * Fecha runner.
   */
  async close() {
    if (this.executor) {
      await this.executor.close();
    }
  }

  /**
   * Executa gravação (playback).
   * 
   * @param {string|Object} recording - Nome do arquivo ou objeto de gravação
   * @param {Object} data - Dados adicionais para substituição
   */
  async playback(recording, data = {}) {
    let recordingData;

    // Carrega gravação se for string
    if (typeof recording === 'string') {
      recordingData = ActionRecorder.load(recording);
    } else {
      recordingData = recording;
    }

    // Normaliza URLs no recording
    if (recordingData) {
      try {
        normalizeRpaTestUrls(recordingData);
      } catch (error) {
        console.warn(`Aviso: Erro ao normalizar URLs: ${error.message}`);
      }
    }

    // Mescla dados
    const mergedData = {
      ...recordingData.data,
      ...data,
    };

    // Valida dados
    if (config.dataPopulation.validateBeforeUse) {
      const validation = this.dataPopulator.validateData(mergedData);
      if (!validation.valid) {
        return {
          success: false,
          errors: validation.errors,
          message: 'Validação de dados falhou',
        };
      }
    }

    const results = {
      recordingId: recordingData.id,
      recordingName: recordingData.name,
      success: true,
      steps: [],
      errors: [],
      screenshots: [],
      startTime: new Date().toISOString(),
      replayId: null,
      tracePath: null,
    };

    // Inicia sistema de replay
    if (this.options.enableReplay) {
      this.replaySystem.start(recordingData.id);
    }

    try {
      // Garante que o executor está inicializado
      if (!this.executor) {
        await this.init();
      }

      // Tracing (opcional) - inicia no começo da execução do seed
      try {
        if (this.executor?.startTracing) {
          await this.executor.startTracing();
        }
      } catch (_) {}

      // Faz login automático antes de executar os steps
      if (this.executor?.page) {
        const authResult = await autoLoginBeforeSteps(this.executor.page, {
          firstStep: recordingData.steps?.[0],
          // Mantém compatibilidade com o config atual do runner
          frontendBaseUrl: process.env.TEST_FRONTEND_URL || config.urls?.frontend,
        });
        if (!authResult.success) {
          console.warn(`⚠️  Aviso: Não foi possível fazer login automático: ${authResult.error}`);
          console.warn('   O teste continuará, mas pode falhar se a página requer autenticação.');
        } else if (authResult.loggedIn) {
          console.log('✅ Login automático realizado com sucesso');
        }
      }

      // Executa cada step
      for (let i = 0; i < recordingData.steps.length; i++) {
        const step = recordingData.steps[i];
        const stepStartTime = new Date().toISOString();
        
        // Registra tela antes da ação
        if (this.options.enableReplay && this.executor.page) {
          await this.replaySystem.recordScreen(this.executor.page, `step-${i + 1}`);
        }

        const stepResult = await this.executor.executeAction(step, mergedData);
        const stepEndTime = new Date().toISOString();

        // Registra ação no replay
        if (this.options.enableReplay) {
          this.replaySystem.recordAction(
            { ...step, step: `step-${i + 1}` },
            {
              ...stepResult,
              startTime: stepStartTime,
              endTime: stepEndTime,
            }
          );
        }

        results.steps.push({
          step: i + 1,
          action: step.type,
          selector: step.selector || step.url || null,
          success: stepResult.success,
          error: stepResult.error || null,
          timestamp: stepStartTime,
          duration: new Date(stepEndTime) - new Date(stepStartTime),
          debug: stepResult.debug || null,
        });

        if (!stepResult.success) {
          results.success = false;
          const errorInfo = {
            step: i + 1,
            action: step.type,
            error: stepResult.error,
          };
          results.errors.push(errorInfo);

          // Registra erro no replay
          if (this.options.enableReplay) {
            this.replaySystem.recordError(
              new Error(stepResult.error),
              `step-${i + 1}`
            );
          }

          // Captura screenshot em caso de erro
          if (this.options.screenshotOnFailure) {
            const screenshot = await this.executor.captureScreenshot(
              `error-step-${i + 1}-${Date.now()}`
            );
            if (screenshot) {
              results.screenshots.push(screenshot);
            }
          }

          // Para execução se erro crítico
          if (step.critical !== false) {
            break;
          }
        }
      }

      // Para sistema de replay
      if (this.options.enableReplay) {
        this.replaySystem.stop();
        const replayPath = this.replaySystem.save(`replay-${recordingData.id}-${Date.now()}`);
        results.replayId = this.replaySystem.replayData.id;
        results.replayPath = replayPath;
      }

      // Para tracing (opcional)
      try {
        if (this.executor?.stopTracing) {
          results.tracePath = await this.executor.stopTracing(`rpa-trace-${recordingData.id}-${Date.now()}`);
        }
      } catch (_) {}

      results.endTime = new Date().toISOString();
      results.duration = new Date(results.endTime) - new Date(results.startTime);

      // Adiciona erros coletados da página
      const pageErrors = this.executor.getErrors();
      if (pageErrors.length > 0) {
        results.pageErrors = pageErrors;
      }

      // Adiciona evidências adicionais (não-bloqueantes): console + debug logs + httpErrors
      try {
        const consoleLogs = this.executor.getConsoleLogs?.() || [];
        if (consoleLogs.length > 0) results.consoleLogs = consoleLogs;
      } catch (_) {}

      try {
        const debugLogs = this.executor.getDebugLogs?.() || [];
        if (debugLogs.length > 0) results.debugLogs = debugLogs;
      } catch (_) {}

      try {
        const httpErrors = this.executor.getHttpErrors?.() || [];
        if (httpErrors.length > 0) results.httpErrors = httpErrors;
      } catch (_) {}

      // Gate forte: falha em pageerror e console.error (mesmo se asserts passaram).
      // Motivo: evita falsos positivos onde a UI "parece ok", mas há erro em runtime.
      try {
        const pageErrorsList = Array.isArray(results.pageErrors) ? results.pageErrors : [];
        const hasPageError = pageErrorsList.some((e) => e && e.type === 'page_error');

        const consoleLogsList = Array.isArray(results.consoleLogs) ? results.consoleLogs : [];
        const hasConsoleError = consoleLogsList.some((e) => e && String(e.level || '').toLowerCase() === 'error');

        if (hasPageError || hasConsoleError) {
          results.success = false;
          results.errors.push({
            step: 'postcheck',
            action: 'browser_runtime_gate',
            error: [
              hasPageError ? 'Detectado pageerror no browser' : null,
              hasConsoleError ? 'Detectado console.error no browser' : null,
            ].filter(Boolean).join(' | '),
          });
        }
      } catch (_) {}

      // Adiciona screenshots
      const screenshots = this.executor.getScreenshots();
      if (screenshots.length > 0) {
        results.screenshots.push(...screenshots);
      }

      this.results.push(results);
      return results;
    } catch (error) {
      // Registra erro fatal no replay
      if (this.options.enableReplay) {
        this.replaySystem.recordError(error, 'fatal');
        this.replaySystem.stop();
        const replayPath = this.replaySystem.save(`replay-${recordingData.id}-error-${Date.now()}`);
        results.replayId = this.replaySystem.replayData.id;
        results.replayPath = replayPath;
      }

      // Para tracing (opcional) mesmo em erro fatal
      try {
        if (this.executor?.stopTracing) {
          results.tracePath = await this.executor.stopTracing(`rpa-trace-${recordingData.id}-fatal-${Date.now()}`);
        }
      } catch (_) {}
      
      results.success = false;
      results.errors.push({
        step: 'unknown',
        action: 'unknown',
        error: error.message,
        stack: error.stack,
      });

      this.results.push(results);
      return results;
    }
  }

  /**
   * Inicia gravação de ações.
   * 
   * @param {Object} options - Opções de gravação
   */
  startRecording(options = {}) {
    this.recorder.start({
      name: options.name || `recording-${Date.now()}`,
      url: options.url || config.urls.base,
      version: options.version || '1.0.0',
    });
  }

  /**
   * Para gravação e salva.
   * 
   * @param {string} filename - Nome do arquivo
   * @param {Object} data - Dados adicionais
   */
  stopRecording(filename, data = {}) {
    this.recorder.stop();
    return this.recorder.save(filename, data);
  }

  /**
   * Adiciona ação à gravação atual.
   */
  recordAction(type, ...args) {
    switch (type) {
      case 'navigate':
        this.recorder.recordNavigate(...args);
        break;
      case 'click':
        this.recorder.recordClick(...args);
        break;
      case 'fill':
        this.recorder.recordFill(...args);
        break;
      case 'select':
        this.recorder.recordSelect(...args);
        break;
      case 'wait':
        this.recorder.recordWait(...args);
        break;
      case 'assert':
        this.recorder.recordAssert(...args);
        break;
      default:
        this.recorder.recordCustom(type, ...args);
    }
  }

  /**
   * Retorna resultados de todas as execuções.
   */
  getResults() {
    return [...this.results];
  }

  /**
   * Limpa resultados.
   */
  clearResults() {
    this.results = [];
  }

  /**
   * Gera relatório de resultados.
   */
  generateReport() {
    const total = this.results.length;
    const passed = this.results.filter(r => r.success).length;
    const failed = total - passed;

    const report = {
      summary: {
        total,
        passed,
        failed,
        successRate: total > 0 ? (passed / total * 100).toFixed(2) + '%' : '0%',
      },
      results: this.results.map(r => ({
        recordingId: r.recordingId,
        recordingName: r.recordingName,
        success: r.success,
        stepsCount: r.steps.length,
        errorsCount: r.errors.length,
        duration: r.duration,
      })),
      details: this.results,
    };

    return report;
  }

  /**
   * Salva relatório em arquivo.
   * 
   * @param {string} filename - Nome do arquivo
   */
  saveReport(filename) {
    const report = this.generateReport();
    const reportsDir = path.join(__dirname, 'reports');
    
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const filepath = path.join(reportsDir, `${filename}.json`);
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf8');

    return filepath;
  }
}

module.exports = { RpaTestRunner };

