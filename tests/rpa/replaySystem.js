/**
 * Sistema de Replay Determinístico de RPA
 * 
 * REGRAS:
 * - Registra telas (ou assinaturas)
 * - Registra ações executadas
 * - Registra tempos
 * - Permite replay da execução
 * - Gera diff quando falhar
 * 
 * IMPORTANTE: Replay é OBRIGATÓRIO para debug e regressão.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Gera assinatura de tela baseada em elementos visíveis.
 * 
 * @param {Object} page - Página do Playwright
 * @returns {Promise<string>} Assinatura da tela
 */
async function generateScreenSignature(page) {
  try {
    // Captura informações principais da página
    const title = await page.title();
    const url = page.url();
    
    // Captura elementos principais visíveis
    const visibleElements = await page.evaluate(() => {
      const elements = [];
      const selectors = ['h1', 'h2', 'h3', 'button', 'input', 'form', '[data-testid]'];
      
      selectors.forEach(selector => {
        const found = document.querySelectorAll(selector);
        found.forEach(el => {
          if (el.offsetParent !== null) { // Elemento visível
            elements.push({
              tag: el.tagName.toLowerCase(),
              text: el.textContent?.trim().substring(0, 50) || '',
              id: el.id || '',
              className: el.className || '',
            });
          }
        });
      });
      
      return elements;
    });
    
    // Gera hash da assinatura
    const signatureData = {
      title,
      url,
      elements: visibleElements,
    };
    
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(signatureData))
      .digest('hex')
      .substring(0, 16);
    
    return {
      hash,
      data: signatureData,
    };
  } catch (error) {
    return {
      hash: 'error',
      data: { error: error.message },
    };
  }
}

/**
 * Classe para gerenciar replay determinístico.
 */
class ReplaySystem {
  constructor() {
    this.replayData = {
      id: null,
      recordingId: null,
      startTime: null,
      endTime: null,
      screens: [],
      actions: [],
      timings: {},
      errors: [],
    };
    this.isRecording = false;
  }

  /**
   * Inicia registro de replay.
   * 
   * @param {string} recordingId - ID da gravação sendo executada
   */
  start(recordingId) {
    this.isRecording = true;
    this.replayData = {
      id: `replay-${Date.now()}`,
      recordingId,
      startTime: new Date().toISOString(),
      endTime: null,
      screens: [],
      actions: [],
      timings: {
        total: null,
        steps: {},
      },
      errors: [],
    };
  }

  /**
   * Para registro de replay.
   */
  stop() {
    this.isRecording = false;
    this.replayData.endTime = new Date().toISOString();
    
    if (this.replayData.startTime) {
      const start = new Date(this.replayData.startTime);
      const end = new Date(this.replayData.endTime);
      this.replayData.timings.total = end - start;
    }
  }

  /**
   * Registra uma tela (assinatura).
   * 
   * @param {Object} page - Página do Playwright
   * @param {string} stepName - Nome do step
   */
  async recordScreen(page, stepName) {
    if (!this.isRecording) return;

    const signature = await generateScreenSignature(page);
    const screenshot = await page.screenshot({ 
      type: 'png',
      fullPage: false,
    }).catch(() => null);

    this.replayData.screens.push({
      step: stepName,
      timestamp: new Date().toISOString(),
      signature: signature.hash,
      signatureData: signature.data,
      screenshot: screenshot ? screenshot.toString('base64') : null,
    });
  }

  /**
   * Registra uma ação executada.
   * 
   * @param {Object} action - Ação executada
   * @param {Object} result - Resultado da ação
   */
  recordAction(action, result) {
    if (!this.isRecording) return;

    const actionStart = result.startTime || new Date().toISOString();
    const actionEnd = result.endTime || new Date().toISOString();
    const duration = new Date(actionEnd) - new Date(actionStart);

    this.replayData.actions.push({
      type: action.type,
      selector: action.selector || action.url || null,
      value: action.value || null,
      timestamp: actionStart,
      duration,
      success: result.success !== false,
      error: result.error || null,
      expected: action.expected || null,
      actual: result.actual || null,
    });

    // Registra timing
    if (action.step) {
      this.replayData.timings.steps[action.step] = duration;
    }
  }

  /**
   * Registra um erro.
   * 
   * @param {Object} error - Erro ocorrido
   * @param {string} stepName - Nome do step onde ocorreu
   */
  recordError(error, stepName) {
    if (!this.isRecording) return;

    this.replayData.errors.push({
      step: stepName,
      timestamp: new Date().toISOString(),
      message: error.message || String(error),
      code: error.code || null,
      stack: error.stack || null,
    });
  }

  /**
   * Salva replay em arquivo.
   * 
   * @param {string} filename - Nome do arquivo (sem extensão)
   * @returns {string} Caminho do arquivo salvo
   */
  save(filename) {
    const replayDir = path.join(__dirname, 'replay');
    
    // Cria diretório se não existir
    if (!fs.existsSync(replayDir)) {
      fs.mkdirSync(replayDir, { recursive: true });
    }

    const filepath = path.join(replayDir, `${filename || this.replayData.id}.json`);
    
    fs.writeFileSync(
      filepath,
      JSON.stringify(this.replayData, null, 2),
      'utf8'
    );

    return filepath;
  }

  /**
   * Carrega replay de arquivo.
   * 
   * @param {string} filename - Nome do arquivo (sem extensão)
   * @returns {Object} Dados do replay
   */
  static load(filename) {
    const filepath = path.join(__dirname, 'replay', `${filename}.json`);
    
    if (!fs.existsSync(filepath)) {
      throw new Error(`Replay não encontrado: ${filename}`);
    }

    const content = fs.readFileSync(filepath, 'utf8');
    return JSON.parse(content);
  }

  /**
   * Compara dois replays e gera diff.
   * 
   * @param {Object} expected - Replay esperado (baseline)
   * @param {Object} actual - Replay atual
   * @returns {Object} Diff entre os replays
   */
  static generateDiff(expected, actual) {
    const diff = {
      screens: [],
      actions: [],
      timings: {},
      errors: [],
    };

    // Diff de telas
    const maxScreens = Math.max(expected.screens.length, actual.screens.length);
    for (let i = 0; i < maxScreens; i++) {
      const expectedScreen = expected.screens[i];
      const actualScreen = actual.screens[i];

      if (!expectedScreen && actualScreen) {
        diff.screens.push({
          step: i + 1,
          type: 'added',
          screen: actualScreen,
        });
      } else if (expectedScreen && !actualScreen) {
        diff.screens.push({
          step: i + 1,
          type: 'removed',
          screen: expectedScreen,
        });
      } else if (expectedScreen && actualScreen) {
        if (expectedScreen.signature !== actualScreen.signature) {
          diff.screens.push({
            step: i + 1,
            type: 'changed',
            expected: expectedScreen.signatureData,
            actual: actualScreen.signatureData,
          });
        }
      }
    }

    // Diff de ações
    const maxActions = Math.max(expected.actions.length, actual.actions.length);
    for (let i = 0; i < maxActions; i++) {
      const expectedAction = expected.actions[i];
      const actualAction = actual.actions[i];

      if (!expectedAction && actualAction) {
        diff.actions.push({
          step: i + 1,
          type: 'added',
          action: actualAction,
        });
      } else if (expectedAction && !actualAction) {
        diff.actions.push({
          step: i + 1,
          type: 'removed',
          action: expectedAction,
        });
      } else if (expectedAction && actualAction) {
        if (expectedAction.success !== actualAction.success) {
          diff.actions.push({
            step: i + 1,
            type: 'changed',
            expected: expectedAction,
            actual: actualAction,
            reason: 'success changed',
          });
        }
        if (expectedAction.actual !== actualAction.actual) {
          diff.actions.push({
            step: i + 1,
            type: 'changed',
            expected: expectedAction,
            actual: actualAction,
            reason: 'result changed',
          });
        }
      }
    }

    // Diff de timings
    if (expected.timings.total !== actual.timings.total) {
      diff.timings.total = {
        expected: expected.timings.total,
        actual: actual.timings.total,
        difference: actual.timings.total - expected.timings.total,
      };
    }

    // Diff de erros
    if (actual.errors.length > expected.errors.length) {
      diff.errors = actual.errors.slice(expected.errors.length);
    }

    return diff;
  }

  /**
   * Gera relatório de replay em texto.
   * 
   * @param {Object} replay - Dados do replay
   * @returns {string} Relatório formatado
   */
  static generateReport(replay) {
    const lines = [];
    
    lines.push('='.repeat(70));
    lines.push('📹 RELATÓRIO DE REPLAY DETERMINÍSTICO');
    lines.push('='.repeat(70));
    lines.push('');
    lines.push(`ID: ${replay.id}`);
    lines.push(`Gravação: ${replay.recordingId}`);
    lines.push(`Início: ${new Date(replay.startTime).toLocaleString('pt-BR')}`);
    lines.push(`Fim: ${new Date(replay.endTime).toLocaleString('pt-BR')}`);
    lines.push(`Duração: ${replay.timings.total}ms`);
    lines.push('');

    // Telas
    lines.push('📺 TELAS REGISTRADAS:');
    lines.push('-'.repeat(70));
    replay.screens.forEach((screen, index) => {
      lines.push(`${index + 1}. Step: ${screen.step}`);
      lines.push(`   Assinatura: ${screen.signature}`);
      lines.push(`   Timestamp: ${new Date(screen.timestamp).toLocaleString('pt-BR')}`);
      lines.push('');
    });

    // Ações
    lines.push('🎬 AÇÕES EXECUTADAS:');
    lines.push('-'.repeat(70));
    replay.actions.forEach((action, index) => {
      lines.push(`${index + 1}. ${action.type.toUpperCase()}`);
      lines.push(`   Seletor: ${action.selector || 'N/A'}`);
      lines.push(`   Sucesso: ${action.success ? '✅' : '❌'}`);
      lines.push(`   Duração: ${action.duration}ms`);
      if (action.error) {
        lines.push(`   Erro: ${action.error}`);
      }
      lines.push('');
    });

    // Erros
    if (replay.errors.length > 0) {
      lines.push('❌ ERROS:');
      lines.push('-'.repeat(70));
      replay.errors.forEach((error, index) => {
        lines.push(`${index + 1}. Step: ${error.step}`);
        lines.push(`   Mensagem: ${error.message}`);
        lines.push('');
      });
    }

    lines.push('='.repeat(70));
    
    return lines.join('\n');
  }
}

module.exports = {
  ReplaySystem,
  generateScreenSignature,
};

