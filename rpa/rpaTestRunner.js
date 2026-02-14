/**
 * Runner principal de testes RPA.
 *
 * Executa gravações de ações e gerencia todo o ciclo de testes RPA.
 */

const { ActionExecutor } = require('../tests/rpa/actionExecutor');
const { ActionRecorder } = require('./actionRecorder');
const { DataPopulator } = require('../tests/rpa/dataPopulation');
const { ReplaySystem } = require('../tests/rpa/replaySystem');
const config = require('../tests/rpa/rpaConfig');
const path = require('path');
const fs = require('fs');
const { normalizeRpaTestUrls } = require('../tests/rpa/utils/urlNormalizer');
const { autoLoginBeforeSteps } = require('../tests/rpa/utils/autoLoginFlow');

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

          // Screenshot em falha
          if (this.options.screenshotOnFailure && this.executor?.page) {
            const screenshotPath = path.join(
              config.paths?.screenshots || path.join(process.cwd(), 'tests', 'rpa', 'screenshots'),
              `error-step-${i + 1}-${Date.now()}.png`
            );
            try {
              await this.executor.page.screenshot({ path: screenshotPath, fullPage: true });
              results.screenshots.push(screenshotPath);
            } catch (err) {
              console.warn('⚠️  Não foi possível capturar screenshot:', err.message);
            }
          }

          // Para execução após falha
          break;
        }
      }

      // Finaliza replay
      if (this.options.enableReplay) {
        this.replaySystem.stop();
        const replayPath = this.replaySystem.save(recordingData.id);
        results.replayId = replayPath;
      }

      // Finaliza tracing (se habilitado)
      try {
        if (this.executor?.stopTracing) {
          const tracePath = await this.executor.stopTracing();
          if (tracePath) {
            results.tracePath = tracePath;
          }
        }
      } catch (_) {}

      results.endTime = new Date().toISOString();
      results.duration = new Date(results.endTime) - new Date(results.startTime);

      this.results.push(results);
      return results;
    } catch (error) {
      results.success = false;
      results.errors.push({ error: error.message });
      results.endTime = new Date().toISOString();
      results.duration = new Date(results.endTime) - new Date(results.startTime);

      this.results.push(results);
      return results;
    }
  }

  /**
   * Gera relatório consolidado.
   */
  generateReport() {
    return {
      totalTests: this.results.length,
      passed: this.results.filter((r) => r.success).length,
      failed: this.results.filter((r) => !r.success).length,
      results: this.results,
    };
  }

  /**
   * Salva relatório em arquivo JSON.
   */
  saveReport(filename = 'rpa-test-report') {
    const report = this.generateReport();
    const reportsDir = config.paths?.reports || path.join(process.cwd(), 'tests', 'rpa', 'reports');

    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const filepath = path.join(reportsDir, `${filename}-${Date.now()}.json`);
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));

    return filepath;
  }
}

module.exports = {
  RpaTestRunner,
};
