/**
 * Sistema de Replay Determinístico de RPA
 * 
 * DEPRECATED: Este arquivo mantém compatibilidade com código existente.
 * 
 * NOVO: Use lib/replaySystem.js para novos desenvolvimentos.
 * 
 * Para migrar:
 * const { ReplaySystem } = require('../lib/replaySystem');
 * 
 * Este arquivo re-exporta o módulo centralizado com compatibilidade.
 */

const path = require('path');
const { ReplaySystem: CoreReplaySystem, generateScreenSignature: coreGenerateScreenSignature } = require('../../lib/replaySystem');

// Wrapper para compatibilidade - usa storagePath padrão do RPA
class ReplaySystem extends CoreReplaySystem {
  constructor(options = {}) {
    // Define storagePath padrão para RPA se não especificado
    const defaultStoragePath = path.join(__dirname, 'replay');
    
    super({
      storagePath: options.storagePath || defaultStoragePath,
      context: options.context || 'rpa',
      enableScreenshots: options.enableScreenshots !== false,
      enableActions: options.enableActions !== false,
      enableTimings: options.enableTimings !== false,
      ...options,
    });
  }

  /**
   * Salva replay em arquivo (compatibilidade com código antigo).
   * 
   * @param {string} filename - Nome do arquivo (sem extensão)
   * @returns {string} Caminho do arquivo salvo
   */
  save(filename) {
    return super.save(filename);
  }

  /**
   * Carrega replay de arquivo (compatibilidade).
   * 
   * @param {string} filename - Nome do arquivo (sem extensão)
   * @returns {Object} Dados do replay
   */
  static load(filename) {
    const defaultStoragePath = path.join(__dirname, 'replay');
    return CoreReplaySystem.load(filename, defaultStoragePath);
  }

  /**
   * Compara dois replays e gera diff (compatibilidade).
   */
  static generateDiff(expected, actual) {
    return CoreReplaySystem.generateDiff(expected, actual);
  }

  /**
   * Gera relatório de replay em texto (compatibilidade).
   */
  static generateReport(replay) {
    return CoreReplaySystem.generateReport(replay);
  }
}

// Re-exporta generateScreenSignature
const generateScreenSignature = coreGenerateScreenSignature;

module.exports = {
  ReplaySystem,
  generateScreenSignature,
};
