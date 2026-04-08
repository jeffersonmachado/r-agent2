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

const REPLAY_DIR = path.join(process.cwd(), 'tests', 'rpa', 'replay');

function assignDeterministicTimestamp(collection, clock, label) {
  if (!clock || !Array.isArray(collection) || collection.length < 1) return;
  const item = collection[collection.length - 1];
  item.timestamp = clock.next(label);
}

// Wrapper para compatibilidade - usa storagePath padrão do RPA
class ReplaySystem extends CoreReplaySystem {
  constructor(options = {}) {
    // Define storagePath padrão para RPA se não especificado
    const defaultStoragePath = REPLAY_DIR;
    
    super({
      storagePath: options.storagePath || defaultStoragePath,
      context: options.context || 'rpa',
      enableScreenshots: options.enableScreenshots !== false,
      enableActions: options.enableActions !== false,
      enableTimings: options.enableTimings !== false,
      ...options,
    });

    this.clock = options.clock || null;
  }

  setClock(clock) {
    this.clock = clock || null;
  }

  start(recordingId, metadata = {}) {
    super.start(recordingId, metadata);
    if (this.clock) {
      this.replayData.startTime = this.clock.next('replay-start');
      this.replayData.metadata = {
        ...(this.replayData.metadata || {}),
        deterministic: true,
      };
    }
  }

  stop() {
    super.stop();
    if (this.clock) {
      this.replayData.endTime = this.clock.next('replay-stop');
      if (this.replayData.startTime && this.replayData.endTime) {
        this.replayData.timings.total = new Date(this.replayData.endTime) - new Date(this.replayData.startTime);
      }
    }
  }

  async recordScreen(...args) {
    const value = await super.recordScreen(...args);
    assignDeterministicTimestamp(this.replayData.screens, this.clock, 'replay-screen');
    return value;
  }

  recordAction(...args) {
    const value = super.recordAction(...args);
    assignDeterministicTimestamp(this.replayData.actions, this.clock, 'replay-action');
    return value;
  }

  recordError(...args) {
    const value = super.recordError(...args);
    assignDeterministicTimestamp(this.replayData.errors, this.clock, 'replay-error');
    return value;
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
    const defaultStoragePath = REPLAY_DIR;
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
