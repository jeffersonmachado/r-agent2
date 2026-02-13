/**
 * Gravador de ações RPA.
 *
 * Captura ações do usuário na interface e salva em formato JSON
 * para reprodução posterior.
 *
 * NOTA: Este módulo agora é um wrapper do RecordingSystem genérico
 * para manter compatibilidade com código existente.
 * Novos desenvolvimentos devem usar lib/recordingSystem.js diretamente.
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { RecordingSystem } = require('../lib/recordingSystem');

const SEEDS_DIR = path.join(process.cwd(), 'tests', 'rpa', 'seeds');

/**
 * ActionRecorder - Wrapper de compatibilidade
 *
 * Mantém interface original para compatibilidade retroativa.
 * Internamente usa RecordingSystem genérico.
 */
class ActionRecorder {
  constructor() {
    // Usa RecordingSystem internamente
    this.recordingSystem = new RecordingSystem({
      storagePath: SEEDS_DIR,
      context: 'rpa',
      enableTimestamps: false, // Seeds não devem ter timestamps
    });

    // Mantém propriedades para compatibilidade
    this.actions = [];
    this.metadata = {
      id: null,
      name: null,
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      url: null,
    };
    this.isRecording = false;
  }

  /**
   * Inicia gravação.
   *
   * @param {Object} options - Opções de gravação
   * @param {string} options.name - Nome da gravação
   * @param {string} options.url - URL inicial
   */
  start(options = {}) {
    this.isRecording = true;
    this.actions = [];
    this.metadata = {
      id: uuidv4(),
      name: options.name || `recording-${Date.now()}`,
      version: options.version || '1.0.0',
      createdAt: new Date().toISOString(),
      url: options.url || null,
    };
  }

  /**
   * Para gravação.
   */
  stop() {
    this.isRecording = false;
    this.recordingSystem.stop();
  }

  /**
   * Adiciona ação de navegação.
   *
   * @param {string} url - URL para navegar
   * @param {Object} options - Opções adicionais
   */
  recordNavigate(url, options = {}) {
    if (!this.isRecording) return;

    this.actions.push({
      type: 'navigate',
      url,
      waitFor: options.waitFor || null,
      timeout: options.timeout || 30000,
      // NÃO inclui timestamp - seed é neutro em relação ao tempo
    });
  }

  /**
   * Adiciona ação de clique.
   *
   * @param {string} selector - Seletor CSS
   * @param {Object} options - Opções adicionais
   */
  recordClick(selector, options = {}) {
    if (!this.isRecording) return;

    const action = {
      type: 'click',
      selector,
      waitFor: options.waitFor || null,
      timeout: options.timeout || 30000,
      force: options.force || false,
      // NÃO inclui timestamp - seed é neutro em relação ao tempo
    };

    this.actions.push(action);

    // Também registra no RecordingSystem
    this.recordingSystem.recordClick(selector, options);
  }

  /**
   * Adiciona ação de preenchimento (TYPE).
   *
   * IMPORTANTE: Grava apenas O QUE foi feito:
   * - tipo da ação
   * - seletor
   * - texto completo (string)
   *
   * NÃO grava:
   * - delays
   * - velocidade
   * - timing de execução
   *
   * @param {string} selector - Seletor CSS
   * @param {string} value - Valor para preencher (texto completo)
   * @param {Object} options - Opções adicionais
   */
  recordFill(selector, value, options = {}) {
    if (!this.isRecording) return;

    // Grava apenas dados neutros (sem delays ou velocidade)
    const action = {
      type: 'fill', // ou 'type' - ação de digitação
      selector,
      value, // Texto completo - será digitado caractere a caractere no replay
      clear: options.clear !== false, // Por padrão limpa antes de preencher
      validate: options.validate || null,
      timeout: options.timeout || 30000, // Timeout é necessário para encontrar elemento
      // NÃO inclui timestamp relativo - seed é neutro em relação ao tempo
      // NÃO inclui delays ou typingSpeedMs
    };

    this.actions.push(action);

    // Também registra no RecordingSystem
    this.recordingSystem.recordFill(selector, value, options);
  }

  /**
   * Adiciona ação de seleção.
   *
   * @param {string} selector - Seletor CSS
   * @param {string} value - Valor para selecionar
   * @param {Object} options - Opções adicionais
   */
  recordSelect(selector, value, options = {}) {
    if (!this.isRecording) return;

    this.actions.push({
      type: 'select',
      selector,
      value,
      timeout: options.timeout || 30000,
      // NÃO inclui timestamp - seed é neutro em relação ao tempo
    });
  }

  /**
   * Adiciona ação de espera.
   *
   * @param {string|number} condition - Condição de espera (seletor ou tempo em ms)
   * @param {Object} options - Opções adicionais
   */
  recordWait(condition, options = {}) {
    if (!this.isRecording) return;

    const action = {
      type: 'wait',
      condition,
      timeout: options.timeout || 30000,
      state: options.state || null, // 'visible', 'hidden', 'attached', 'detached'
      // NÃO inclui timestamp - seed é neutro em relação ao tempo
    };

    this.actions.push(action);

    // Também registra no RecordingSystem
    this.recordingSystem.recordWait(condition, options);
  }

  /**
   * Adiciona ação de assert/validação.
   *
   * Suporta múltiplas estratégias de identificação:
   * - Validação de página completa (URL, título, landmarks, meta tags)
   * - Título simples (compatibilidade)
   * - Elemento único (compatibilidade)
   *
   * @param {Object} assertion - Objeto de validação
   */
  recordAssert(assertion) {
    if (!this.isRecording) return;

    this.actions.push({
      type: 'assert',
      assertion,
      timeout: assertion.timeout || 30000,
      // NÃO inclui timestamp - seed é neutro em relação ao tempo
    });
  }

  /**
   * Finaliza gravação e salva em arquivo JSON.
   *
   * @param {string} filename - Nome do arquivo (sem extensão)
   * @returns {Object} Dados da gravação
   */
  save(filename) {
    if (!this.metadata.id) {
      this.metadata.id = uuidv4();
    }

    const data = {
      ...this.metadata,
      steps: this.actions,
      data: {},
    };

    // UNIFICADO: Tudo salva em /tests/rpa/seeds/
    const seedsDir = SEEDS_DIR;

    if (!fs.existsSync(seedsDir)) {
      fs.mkdirSync(seedsDir, { recursive: true });
    }

    const filepath = path.join(seedsDir, `${filename}.json`);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));

    return data;
  }

  /**
   * Carrega gravação do arquivo.
   *
   * @param {string} filename - Nome do arquivo (sem extensão)
   * @returns {Object} Dados da gravação
   */
  static load(filename) {
    // UNIFICADO: Tudo está em /tests/rpa/seeds/
    const seedsFile = path.join(SEEDS_DIR, `${filename}.json`);

    if (!fs.existsSync(seedsFile)) {
      throw new Error(`Gravação não encontrada: ${filename}`);
    }

    const content = fs.readFileSync(seedsFile, 'utf8');
    return JSON.parse(content);
  }

  /**
   * Lista todas as gravações disponíveis.
   *
   * @returns {string[]} Lista de nomes de gravações
   */
  static listRecordings() {
    const seedsDir = SEEDS_DIR;
    const seeds = fs.existsSync(seedsDir)
      ? fs.readdirSync(seedsDir)
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.replace('.json', ''))
      : [];

    return seeds;
  }
}

module.exports = {
  ActionRecorder,
};
