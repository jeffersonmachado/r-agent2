/**
 * Sistema de Gravação - Módulo Reutilizável
 * 
 * Este módulo fornece funcionalidades de gravação de ações/operações
 * para qualquer tipo de processo automatizado.
 * 
 * Pode ser usado em:
 * - Testes RPA (gravação de ações do usuário)
 * - Testes de API (gravação de requisições/respostas)
 * - Processos de geração (gravação de passos)
 * - Execuções de workflows (gravação de etapas)
 * - Qualquer processo que precise ser gravado e reproduzido
 * 
 * @module recordingSystem
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * Sistema de Gravação genérico e reutilizável.
 * 
 * Grava ações/operações em formato estruturado para reprodução posterior.
 * Diferente do ReplaySystem, este foca em gravar O QUE foi feito (ações),
 * não COMO foi executado (timing, screenshots, etc.).
 */
class RecordingSystem {
  /**
   * @param {Object} options - Opções de configuração
   * @param {string} options.storagePath - Caminho para salvar gravações
   * @param {string} options.context - Contexto da gravação (ex: 'rpa', 'api', 'generation')
   * @param {boolean} options.enableTimestamps - Incluir timestamps nas ações (default: false)
   */
  constructor(options = {}) {
    this.options = {
      storagePath: options.storagePath || path.join(process.cwd(), 'recordings'),
      context: options.context || 'generic',
      enableTimestamps: options.enableTimestamps || false,
    };

    this.recordingData = {
      id: null,
      name: null,
      version: '1.0.0',
      context: this.options.context,
      createdAt: null,
      steps: [],
      metadata: {},
      data: {},
    };

    this.isRecording = false;
  }

  /**
   * Inicia gravação.
   * 
   * @param {string} recordingId - ID da gravação (opcional, gera automático se não fornecido)
   * @param {Object} metadata - Metadados adicionais (nome, descrição, etc.)
   */
  start(recordingId, metadata = {}) {
    this.isRecording = true;
    
    const finalRecordingId = recordingId || `recording-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    this.recordingData = {
      id: finalRecordingId,
      name: metadata.name || finalRecordingId,
      version: metadata.version || '1.0.0',
      context: this.options.context,
      createdAt: new Date().toISOString(),
      steps: [],
      metadata: {
        ...metadata,
        description: metadata.description || null,
        source: metadata.source || 'automatic',
      },
      data: metadata.data || {},
    };
  }

  /**
   * Para gravação.
   */
  stop() {
    this.isRecording = false;
  }

  /**
   * Registra uma ação/operação.
   * 
   * @param {Object} action - Ação executada
   * @param {string} action.type - Tipo da ação (ex: 'navigate', 'click', 'fill', 'api_call', 'generate')
   * @param {string} action.step - Nome/identificador do passo
   * @param {string} [action.selector] - Seletor ou identificador (opcional)
   * @param {*} [action.value] - Valor usado (opcional)
   * @param {Object} [action.options] - Opções adicionais (opcional)
   */
  recordAction(action) {
    if (!this.isRecording) return;

    const step = {
      type: action.type,
      step: action.step || `step-${this.recordingData.steps.length + 1}`,
      ...(action.selector && { selector: action.selector }),
      ...(action.value !== undefined && { value: action.value }),
      ...(action.options && { options: action.options }),
      ...(action.url && { url: action.url }),
      ...(action.method && { method: action.method }),
      ...(action.endpoint && { endpoint: action.endpoint }),
      ...(action.body && { body: action.body }),
      ...(action.params && { params: action.params }),
    };

    // Adiciona timestamp se habilitado
    if (this.options.enableTimestamps) {
      step.timestamp = new Date().toISOString();
    }

    this.recordingData.steps.push(step);
  }

  /**
   * Registra ação de navegação.
   * 
   * @param {string} url - URL para navegar
   * @param {Object} options - Opções adicionais
   */
  recordNavigate(url, options = {}) {
    this.recordAction({
      type: 'navigate',
      step: options.step || 'navigate',
      url,
      options: {
        waitFor: options.waitFor || null,
        timeout: options.timeout || 30000,
      },
    });
  }

  /**
   * Registra ação de clique.
   * 
   * @param {string} selector - Seletor CSS ou identificador
   * @param {Object} options - Opções adicionais
   */
  recordClick(selector, options = {}) {
    this.recordAction({
      type: 'click',
      step: options.step || 'click',
      selector,
      options: {
        waitFor: options.waitFor || null,
        timeout: options.timeout || 30000,
        force: options.force || false,
      },
    });
  }

  /**
   * Registra ação de preenchimento.
   * 
   * @param {string} selector - Seletor CSS ou identificador
   * @param {*} value - Valor para preencher
   * @param {Object} options - Opções adicionais
   */
  recordFill(selector, value, options = {}) {
    this.recordAction({
      type: 'fill',
      step: options.step || 'fill',
      selector,
      value,
      options: {
        clear: options.clear !== false,
        validate: options.validate || null,
        timeout: options.timeout || 30000,
      },
    });
  }

  /**
   * Registra ação de seleção.
   * 
   * @param {string} selector - Seletor CSS ou identificador
   * @param {string} value - Valor para selecionar
   * @param {Object} options - Opções adicionais
   */
  recordSelect(selector, value, options = {}) {
    this.recordAction({
      type: 'select',
      step: options.step || 'select',
      selector,
      value,
      options: {
        timeout: options.timeout || 30000,
      },
    });
  }

  /**
   * Registra ação de espera.
   * 
   * @param {string|number} condition - Condição de espera (seletor ou tempo em ms)
   * @param {Object} options - Opções adicionais
   */
  recordWait(condition, options = {}) {
    this.recordAction({
      type: 'wait',
      step: options.step || 'wait',
      value: condition,
      options: {
        timeout: options.timeout || 30000,
        state: options.state || null,
      },
    });
  }

  /**
   * Registra ação de assert/validação.
   * 
   * @param {string|null|Object} selectorOrPage - Seletor CSS, null, ou objeto de validação de página
   * @param {Object} options - Opções de validação
   */
  recordAssert(selectorOrPage, options = {}) {
    // Validação de página completa
    if (options.page || (typeof selectorOrPage === 'object' && selectorOrPage !== null && !selectorOrPage.selector)) {
      const pageConfig = options.page || selectorOrPage;
      
      this.recordAction({
        type: 'assert',
        step: options.step || 'assert',
        value: {
          page: {
            url: pageConfig.url || null,
            title: pageConfig.title || null,
            meta: pageConfig.meta || null,
            landmarks: pageConfig.landmarks || null,
          },
          validationMode: pageConfig.validationMode || options.validationMode || 'all',
          message: pageConfig.message || options.message || null,
        },
        options: {
          timeout: pageConfig.timeout || options.timeout || 30000,
        },
      });
      return;
    }

    // Título simples
    if (options.title !== undefined) {
      this.recordAction({
        type: 'assert',
        step: options.step || 'assert',
        value: { title: options.title },
        options: {
          message: options.message || null,
          timeout: options.timeout || 30000,
        },
      });
      return;
    }

    // Validação de elemento único
    const selector = typeof selectorOrPage === 'string' ? selectorOrPage : (selectorOrPage?.selector || null);
    
    if (!selector) {
      throw new Error('recordAssert requer selector, title ou page config');
    }

    this.recordAction({
      type: 'assert',
      step: options.step || 'assert',
      selector,
      value: {
        exists: options.exists !== undefined ? options.exists : true,
        visible: options.visible !== undefined ? options.visible : true,
        text: options.text || null,
        value: options.value || null,
        count: options.count || null,
      },
      options: {
        message: options.message || null,
        timeout: options.timeout || 30000,
      },
    });
  }

  /**
   * Registra chamada de API.
   * 
   * @param {string} method - Método HTTP (GET, POST, etc.)
   * @param {string} endpoint - Endpoint da API
   * @param {Object} options - Opções (body, params, headers, etc.)
   */
  recordApiCall(method, endpoint, options = {}) {
    this.recordAction({
      type: 'api_call',
      step: options.step || 'api-call',
      method,
      endpoint,
      body: options.body,
      params: options.params,
      headers: options.headers,
      options: {
        timeout: options.timeout || 30000,
      },
    });
  }

  /**
   * Registra ação de geração (IA, fluxo, etc.).
   * 
   * @param {string} generatorType - Tipo de gerador (ex: 'flow', 'rpa', 'seed')
   * @param {Object} input - Input para geração
   * @param {Object} options - Opções adicionais
   */
  recordGeneration(generatorType, input, options = {}) {
    this.recordAction({
      type: 'generate',
      step: options.step || `generate-${generatorType}`,
      value: {
        generatorType,
        input,
        options: options.generationOptions || {},
      },
    });
  }

  /**
   * Registra ação customizada.
   * 
   * @param {string} type - Tipo da ação
   * @param {Object} data - Dados da ação
   */
  recordCustom(type, data = {}) {
    this.recordAction({
      type,
      step: data.step || `custom-${type}`,
      ...data,
    });
  }

  /**
   * Adiciona metadados à gravação.
   * 
   * @param {Object} metadata - Metadados adicionais
   */
  addMetadata(metadata) {
    this.recordingData.metadata = {
      ...this.recordingData.metadata,
      ...metadata,
    };
  }

  /**
   * Adiciona dados à gravação.
   * 
   * @param {Object} data - Dados adicionais
   */
  addData(data) {
    this.recordingData.data = {
      ...this.recordingData.data,
      ...data,
    };
  }

  /**
   * Salva gravação em arquivo.
   * 
   * @param {string} filename - Nome do arquivo (sem extensão, opcional)
   * @returns {string} Caminho do arquivo salvo
   */
  save(filename = null) {
    if (!fs.existsSync(this.options.storagePath)) {
      fs.mkdirSync(this.options.storagePath, { recursive: true });
    }

    const finalFilename = filename || this.recordingData.id;
    const filepath = path.join(this.options.storagePath, `${finalFilename}.json`);

    fs.writeFileSync(
      filepath,
      JSON.stringify(this.recordingData, null, 2),
      'utf8'
    );

    return filepath;
  }

  /**
   * Carrega gravação de arquivo.
   * 
   * @param {string} filenameOrPath - Nome do arquivo (sem extensão) ou caminho completo
   * @param {string} storagePath - Caminho de armazenamento (opcional, usado apenas se filename não for caminho completo)
   * @returns {Object|null} Dados da gravação ou null se não encontrado
   */
  static load(filenameOrPath, storagePath = null) {
    let filepath;
    
    // Se for um caminho completo (contém / ou \), usa diretamente
    if (filenameOrPath.includes(path.sep) || filenameOrPath.includes('/') || filenameOrPath.includes('\\')) {
      filepath = filenameOrPath.endsWith('.json') ? filenameOrPath : `${filenameOrPath}.json`;
    } else {
      // Caso contrário, trata como filename e constrói o caminho
      const basePath = storagePath || path.join(process.cwd(), 'recordings');
      filepath = path.join(basePath, `${filenameOrPath}.json`);
    }
    
    if (!fs.existsSync(filepath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filepath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  /**
   * Lista todas as gravações disponíveis.
   * 
   * @param {string} storagePath - Caminho de armazenamento (opcional)
   * @param {string} context - Filtrar por contexto (opcional)
   * @returns {Array} Lista de gravações
   */
  static list(storagePath = null, context = null) {
    const basePath = storagePath || path.join(process.cwd(), 'recordings');
    
    if (!fs.existsSync(basePath)) {
      return [];
    }

    const files = fs.readdirSync(basePath)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const filepath = path.join(basePath, f);
          const content = fs.readFileSync(filepath, 'utf8');
          const data = JSON.parse(content);
          const stats = fs.statSync(filepath);
          
          // Filtra por contexto se fornecido
          if (context && data.context !== context) {
            return null;
          }
          
          return {
            id: data.id || f.replace('.json', ''),
            name: data.name || f.replace('.json', ''),
            context: data.context || 'generic',
            stepsCount: data.steps?.length || 0,
            createdAt: data.createdAt,
            modified: stats.mtime.toISOString(),
            size: stats.size,
            filepath,
          };
        } catch (error) {
          return null;
        }
      })
      .filter(r => r !== null)
      .sort((a, b) => {
        const timeA = new Date(a.modified || a.createdAt || 0).getTime();
        const timeB = new Date(b.modified || b.createdAt || 0).getTime();
        return timeB - timeA; // Mais recentes primeiro
      });

    return files;
  }

  /**
   * Obtém dados da gravação atual.
   * 
   * @returns {Object} Dados da gravação
   */
  getData() {
    return { ...this.recordingData };
  }

  /**
   * Obtém passos da gravação.
   * 
   * @returns {Array} Lista de passos
   */
  getSteps() {
    return [...this.recordingData.steps];
  }

  /**
   * Limpa passos da gravação atual.
   */
  clearSteps() {
    this.recordingData.steps = [];
  }
}

module.exports = {
  RecordingSystem,
};
