/**
 * Gravador de ações RPA.
 * 
 * Captura ações do usuário na interface e salva em formato JSON
 * para reprodução posterior.
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class ActionRecorder {
  constructor() {
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

    this.actions.push({
      type: 'click',
      selector,
      waitFor: options.waitFor || null,
      timeout: options.timeout || 30000,
      force: options.force || false,
      // NÃO inclui timestamp - seed é neutro em relação ao tempo
    });
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
    this.actions.push({
      type: 'fill', // ou 'type' - ação de digitação
      selector,
      value, // Texto completo - será digitado caractere a caractere no replay
      clear: options.clear !== false, // Por padrão limpa antes de preencher
      validate: options.validate || null,
      timeout: options.timeout || 30000, // Timeout é necessário para encontrar elemento
      // NÃO inclui timestamp relativo - seed é neutro em relação ao tempo
      // NÃO inclui delays ou typingSpeedMs
    });
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

    this.actions.push({
      type: 'wait',
      condition,
      timeout: options.timeout || 30000,
      state: options.state || null, // 'visible', 'hidden', 'attached', 'detached'
      // NÃO inclui timestamp - seed é neutro em relação ao tempo
    });
  }

  /**
   * Adiciona ação de assert/validação.
   * 
   * Suporta múltiplas estratégias de identificação:
   * - Validação de página completa (URL, título, landmarks, meta tags)
   * - Título simples (compatibilidade)
   * - Elemento único (compatibilidade)
   * 
   * @param {string|null|Object} selectorOrPage - Seletor CSS, null, ou objeto de validação de página
   * @param {Object} options - Opções de validação
   * @param {string} options.title - Título da página (modo simples)
   * @param {Object} options.page - Objeto de validação de página completa
   * @param {string} options.validationMode - 'all' (padrão) ou 'any'
   */
  recordAssert(selectorOrPage, options = {}) {
    if (!this.isRecording) return;

    // ============================================
    // NOVA FUNCIONALIDADE: Validação de página completa
    // ============================================
    if (options.page || (typeof selectorOrPage === 'object' && selectorOrPage !== null && !selectorOrPage.selector)) {
      const pageConfig = options.page || selectorOrPage;
      
      this.actions.push({
        type: 'assert',
        page: {
          url: pageConfig.url || null,
          title: pageConfig.title || null,
          meta: pageConfig.meta || null,
          landmarks: pageConfig.landmarks || null,
        },
        validationMode: pageConfig.validationMode || options.validationMode || 'all',
        message: pageConfig.message || options.message || null,
        timeout: pageConfig.timeout || options.timeout || 30000,
        // NÃO inclui timestamp - seed é neutro em relação ao tempo
      });
      return;
    }

    // ============================================
    // COMPATIBILIDADE: Título simples
    // ============================================
    if (options.title !== undefined) {
      this.actions.push({
        type: 'assert',
        title: options.title,
        message: options.message || null,
        timeout: options.timeout || 30000,
        // NÃO inclui timestamp - seed é neutro em relação ao tempo
      });
      return;
    }

    // ============================================
    // COMPATIBILIDADE: Validação de elemento único
    // ============================================
    const selector = typeof selectorOrPage === 'string' ? selectorOrPage : (selectorOrPage?.selector || null);
    
    if (!selector) {
      throw new Error('recordAssert requer selector, title ou page config');
    }

    this.actions.push({
      type: 'assert',
      selector,
      exists: options.exists !== undefined ? options.exists : true,
      visible: options.visible !== undefined ? options.visible : true,
      text: options.text || null,
      value: options.value || null,
      count: options.count || null,
      message: options.message || null,
      timeout: options.timeout || 30000,
      // NÃO inclui timestamp - seed é neutro em relação ao tempo
    });
  }

  /**
   * Adiciona ação customizada.
   * 
   * @param {string} type - Tipo da ação
   * @param {Object} data - Dados da ação
   */
  recordCustom(type, data = {}) {
    if (!this.isRecording) return;

    this.actions.push({
      type,
      ...data,
      // NÃO inclui timestamp automaticamente - seed é neutro em relação ao tempo
    });
  }

  /**
   * Salva gravação em arquivo.
   * 
   * @param {string} filename - Nome do arquivo (sem extensão)
   * @param {Object} data - Dados adicionais para incluir
   */
  save(filename, data = {}) {
    // UNIFICADO: Tudo salva em /seeds/ agora
    const seedsDir = path.join(__dirname, 'seeds');
    
    // Cria diretório se não existir
    if (!fs.existsSync(seedsDir)) {
      fs.mkdirSync(seedsDir, { recursive: true });
    }

    const recording = {
      ...this.metadata,
      steps: this.actions,
      data: {
        ...data,
      },
      // Adiciona flag de origem (manual ou automatic)
      source: data.source || this.metadata.source || 'manual',
    };

    const filepath = path.join(seedsDir, `${filename}.json`);
    fs.writeFileSync(filepath, JSON.stringify(recording, null, 2), 'utf8');

    return filepath;
  }

  /**
   * Carrega gravação de arquivo.
   * 
   * @param {string} filename - Nome do arquivo (sem extensão)
   */
  static load(filename) {
    // UNIFICADO: Tudo está em /seeds/
    const seedsFile = path.join(__dirname, 'seeds', `${filename}.json`);
    
    if (!fs.existsSync(seedsFile)) {
      throw new Error(`Gravação não encontrada: ${filename}`);
    }

    const content = fs.readFileSync(seedsFile, 'utf8');
    return JSON.parse(content);
  }

  /**
   * Lista todas as gravações disponíveis.
   */
  static list() {
    const seedsDir = path.join(__dirname, 'seeds');
    
    const seeds = fs.existsSync(seedsDir)
      ? fs.readdirSync(seedsDir)
          .filter(f => f.endsWith('.json'))
          .map(f => f.replace('.json', ''))
      : [];
    
    return seeds;
  }
}

module.exports = { ActionRecorder };

