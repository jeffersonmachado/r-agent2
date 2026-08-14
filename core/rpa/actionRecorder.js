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
const { RecordingSystem } = require('../../lib/recordingSystem');
const {
  getRecordingSearchPaths,
  getRpaFlowReadDirs,
  getRpaSeedReadDirs,
  getRpaSeedWriteDir,
} = require('../../lib/rpaPathResolver');
const {
  isSensitiveSelector,
  normalizeJsonName,
  protectRecordingSecrets,
  redactDeep,
  resolveContainedJsonPath,
  secretTemplateFor,
} = require('../../lib/rpaSecurity');

function getRecordingDirectories(tenantId = 'system') {
  return [...getRpaSeedReadDirs(tenantId), ...getRpaFlowReadDirs(tenantId)]
    .filter((dirPath, index, all) => all.indexOf(dirPath) === index);
}

/**
 * ActionRecorder - Wrapper de compatibilidade
 * 
 * Mantém interface original para compatibilidade retroativa.
 * Internamente usa RecordingSystem genérico.
 */
class ActionRecorder {
  constructor(options = {}) {
    this.tenantId = options.tenantId || 'system';
    this.seedsDir = getRpaSeedWriteDir(this.tenantId);
    // Usa RecordingSystem internamente
    this.recordingSystem = new RecordingSystem({
      storagePath: this.seedsDir,
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
      tenantId: this.tenantId,
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
      tenantId: options.tenantId || this.tenantId,
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
    const sensitive = options.sensitive === true || isSensitiveSelector(selector, options.inputType || options.autocomplete);
    const persistedValue = sensitive ? secretTemplateFor(options.fieldName || selector) : value;
    const action = {
      type: 'fill', // ou 'type' - ação de digitação
      selector,
      value: persistedValue,
      sensitive,
      clear: options.clear !== false, // Por padrão limpa antes de preencher
      validate: options.validate || null,
      timeout: options.timeout || 30000, // Timeout é necessário para encontrar elemento
      // NÃO inclui timestamp relativo - seed é neutro em relação ao tempo
      // NÃO inclui delays ou typingSpeedMs
    };
    
    this.actions.push(action);
    
    // Também registra no RecordingSystem
    this.recordingSystem.recordFill(selector, persistedValue, { ...options, sensitive });
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
      
      const action = {
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
      };
      
      this.actions.push(action);
      this.recordingSystem.recordAssert(selectorOrPage, options);
      return;
    }

    // ============================================
    // COMPATIBILIDADE: Título simples
    // ============================================
    if (options.title !== undefined) {
      const action = {
        type: 'assert',
        title: options.title,
        message: options.message || null,
        timeout: options.timeout || 30000,
        // NÃO inclui timestamp - seed é neutro em relação ao tempo
      };
      
      this.actions.push(action);
      this.recordingSystem.recordAssert(selectorOrPage, options);
      return;
    }

    // ============================================
    // COMPATIBILIDADE: Validação de elemento único
    // ============================================
    const selector = typeof selectorOrPage === 'string' ? selectorOrPage : (selectorOrPage?.selector || null);
    
    if (!selector) {
      throw new Error('recordAssert requer selector, title ou page config');
    }

    const action = {
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
    };
    
    this.actions.push(action);
    this.recordingSystem.recordAssert(selectorOrPage, options);
  }

  /**
   * Adiciona ação customizada.
   * 
   * @param {string} type - Tipo da ação
   * @param {Object} data - Dados da ação
   */
  recordCustom(type, data = {}) {
    if (!this.isRecording) return;

    const action = {
      type,
      ...data,
      // NÃO inclui timestamp automaticamente - seed é neutro em relação ao tempo
    };
    
    this.actions.push(action);
    
    // Também registra no RecordingSystem
    this.recordingSystem.recordCustom(type, data);
  }

  /**
   * Salva gravação em arquivo.
   * 
   * @param {string} filename - Nome do arquivo (sem extensão)
   * @param {Object} data - Dados adicionais para incluir
   */
  save(filename, data = {}) {
    const safeFilename = normalizeJsonName(filename || this.metadata.name);
    // Adiciona dados ao RecordingSystem
    if (data && Object.keys(data).length > 0) {
      this.recordingSystem.addData(data);
    }
    
    // Adiciona metadados
    if (data.source) {
      this.recordingSystem.addMetadata({ source: data.source });
    }
    
    // Sincroniza dados do RecordingSystem com formato antigo
    const recordingSystemData = this.recordingSystem.getData();
    
    // UNIFICADO: Tudo salva em /seeds/ agora
    const seedsDir = this.seedsDir;
    
    // Cria diretório se não existir
    if (!fs.existsSync(seedsDir)) {
      fs.mkdirSync(seedsDir, { recursive: true });
    }

    // Garante que metadata.name está definido (usa o nome do arquivo se não estiver definido)
    if (!this.metadata.name && filename) {
      this.metadata.name = safeFilename;
    }

    // Garante que metadata.name está definido (usa o nome do arquivo se não estiver definido)
    if (!this.metadata.name && filename) {
      this.metadata.name = safeFilename;
    }

    // Mantém formato compatível
    const recording = protectRecordingSecrets({
      ...this.metadata,
      name: this.metadata.name || safeFilename, // Garante que name está definido
      steps: this.actions,
      data: {
        ...redactDeep(data),
      },
      // Adiciona flag de origem (manual ou automatic)
      source: data.source || this.metadata.source || 'manual',
    });

    const filepath = resolveContainedJsonPath(seedsDir, safeFilename);
    const temporaryPath = `${filepath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(recording, null, 2), 'utf8');
    fs.renameSync(temporaryPath, filepath);

    // NÃO chama recordingSystem.save() aqui porque ele sobrescreve o arquivo com dados vazios
    // O recordingSystem é usado apenas para gravação em tempo real, não para persistência

    return filepath;
  }

  /**
   * Carrega gravação de arquivo.
   * 
   * @param {string} filename - Nome do arquivo (sem extensão)
   */
  static load(filename, tenantId = 'system') {
    for (const filePath of getRecordingSearchPaths(filename, tenantId)) {
      if (!fs.existsSync(filePath)) {
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }

    return null; // Retorna null em vez de lançar erro para compatibilidade com testes
  }

  /**
   * Lista todas as gravações disponíveis.
   */
  static list(tenantId = 'system') {
    const seen = new Set();
    const recordings = [];

    for (const dirPath of getRecordingDirectories(tenantId)) {
      if (!fs.existsSync(dirPath)) {
        continue;
      }

      for (const fileName of fs.readdirSync(dirPath)) {
        if (!fileName.endsWith('.json')) {
          continue;
        }

        const normalized = fileName.replace(/\.json$/, '');
        if (seen.has(normalized)) {
          continue;
        }

        seen.add(normalized);
        recordings.push(normalized);
      }
    }

    return recordings;
  }
}

module.exports = { ActionRecorder };
