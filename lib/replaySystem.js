/**
 * Sistema de Replay - Módulo Reutilizável
 * 
 * Este módulo fornece funcionalidades de gravação, armazenamento e análise
 * de execuções para qualquer tipo de processo automatizado.
 * 
 * Pode ser usado em:
 * - Testes RPA (Playwright)
 * - Testes de API
 * - Processos de geração (IA, fluxos, etc.)
 * - Execuções de workflows
 * - Qualquer processo que precise ser rastreado e reproduzido
 * 
 * @module replaySystem
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { redactDeep } = require('./rpaSecurity');
const { signReplayArtifact, validateReplayIntegrity } = require('./replayIntegrity');

/**
 * Resolve um storagePath efetivo por tenant (quando tenantId é fornecido).
 * Mantém compatibilidade: se tenantId não existir, retorna baseStoragePath.
 *
 * @param {string} baseStoragePath
 * @param {string|null|undefined} tenantId
 * @returns {string}
 */
function resolveTenantStoragePath(baseStoragePath, tenantId) {
  if (!tenantId) return baseStoragePath;
  const safeTenant = sanitizeFilename(String(tenantId), 'tenant');
  return path.join(baseStoragePath, safeTenant);
}

/**
 * Sanitiza um nome para uso seguro como filename (sem extensão).
 * Evita path traversal e caracteres inválidos em diferentes SOs.
 *
 * @param {string} input
 * @param {string} fallback
 * @returns {string}
 */
function sanitizeFilename(input, fallback = 'replay') {
  const raw = (input == null) ? '' : String(input);
  let name = raw.trim();
  if (!name) name = fallback;

  // Remove separadores de path e caracteres problemáticos (Windows/POSIX)
  // Também remove controles e normaliza espaços.
  name = name
    .replace(/[\\/]/g, '-')                 // evita criação de subpastas
    .replace(/[:*?"<>|]/g, '-')             // inválidos no Windows
    .replace(/[\u0000-\u001F\u007F]/g, '-') // controles
    .replace(/\s+/g, ' ')
    .trim();

  // Evita nomes especiais e pontos finais
  name = name.replace(/^\.+/, '').replace(/\.+$/, '');
  if (!name) name = fallback;

  // Limita tamanho para evitar paths enormes
  if (name.length > 180) {
    name = name.slice(0, 180).trim();
  }

  return name || fallback;
}

/**
 * Gera assinatura única baseada em dados fornecidos.
 * Útil para comparar estados entre execuções.
 * 
 * @param {Object} data - Dados para gerar assinatura
 * @returns {Object} Hash e dados da assinatura
 */
function generateSignature(data) {
  try {
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex')
      .substring(0, 16);
    
    return {
      hash,
      data,
    };
  } catch (error) {
    return {
      hash: 'error',
      data: { error: error.message },
    };
  }
}

/**
 * Gera assinatura de tela baseada em elementos visíveis (Playwright).
 * 
 * @param {Object} page - Página do Playwright (opcional)
 * @returns {Promise<Object>} Assinatura da tela
 */
async function generateScreenSignature(page) {
  if (!page) {
    return generateSignature({ type: 'no-page' });
  }

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
    
    return generateSignature({
      title,
      url,
      elements: visibleElements,
    });
  } catch (error) {
    return {
      hash: 'error',
      data: { error: error.message },
    };
  }
}

/**
 * Classe principal do Sistema de Replay.
 * 
 * @class ReplaySystem
 */
class ReplaySystem {
  /**
   * Cria uma instância do Sistema de Replay.
   * 
   * @param {Object} options - Opções de configuração
   * @param {string} options.storagePath - Caminho para armazenar replays (padrão: ./replays)
   * @param {boolean} options.enableScreenshots - Habilitar captura de screenshots (padrão: true)
   * @param {boolean} options.enableActions - Habilitar registro de ações (padrão: true)
   * @param {boolean} options.enableTimings - Habilitar registro de timings (padrão: true)
   * @param {string} options.context - Contexto do replay (ex: 'rpa', 'api', 'generation')
   */
  constructor(options = {}) {
    const baseStoragePath = options.storagePath || path.join(process.cwd(), 'replays');
    const tenantId = options.tenantId || null;

    this.options = {
      baseStoragePath,
      tenantId,
      storagePath: options.storagePathIsTenantScoped
        ? baseStoragePath
        : resolveTenantStoragePath(baseStoragePath, tenantId),
      storagePathIsTenantScoped: options.storagePathIsTenantScoped === true,
      enableScreenshots: options.enableScreenshots !== false,
      enableActions: options.enableActions !== false,
      enableTimings: options.enableTimings !== false,
      context: options.context || 'generic',
    };

    this.replayData = {
      id: null,
      recordingId: null,
      context: this.options.context,
      startTime: null,
      endTime: null,
      screens: [],
      actions: [],
      events: [], // Eventos genéricos
      timings: {},
      errors: [],
      metadata: {}, // Metadados customizados
    };
    
    this.isRecording = false;
    this.autoScreenMonitoring = false;
    this.monitoredPage = null;
    this.lastScreenSignature = null;
    this.screenChangeListeners = [];
  }

  /**
   * Inicia registro de replay.
   * 
   * @param {string} recordingId - ID da gravação/processo sendo executado
   * @param {Object} metadata - Metadados adicionais (opcional)
   */
  start(recordingId, metadata = {}) {
    this.isRecording = true;
    
    // Se recordingId não for fornecido, gera um automático
    const finalRecordingId = recordingId || `replay-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Se o tenantId não foi definido no construtor, tenta inferir do metadata.
    // Isso permite que chamadores antigos passem tenantId apenas no start().
    const inferredTenantId =
      this.options.tenantId ||
      metadata.tenantId ||
      metadata.tenant_key ||
      metadata.tenant ||
      null;

    if (inferredTenantId && !this.options.tenantId) {
      this.options.tenantId = String(inferredTenantId);
      if (!this.options.storagePathIsTenantScoped) {
        this.options.storagePath = resolveTenantStoragePath(this.options.baseStoragePath, this.options.tenantId);
      }
    }
    
    this.replayData = {
      id: finalRecordingId, // Usa recordingId como id
      recordingId: finalRecordingId, // Mantém compatibilidade
      context: this.options.context,
      startTime: new Date().toISOString(),
      endTime: null,
      screens: [],
      actions: [],
      events: [],
      timings: {
        total: null,
        steps: {},
      },
      errors: [],
      metadata: {
        tenantId: (metadata.tenantId || this.options.tenantId || null),
        ...metadata,
        version: '1.0.0',
        createdAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Para registro de replay.
   */
  stop() {
    this.isRecording = false;
    
    // Para monitoramento automático de tela se estiver ativo
    if (this.autoScreenMonitoring) {
      this.stopAutoScreenMonitoring();
    }
    
    this.replayData.endTime = new Date().toISOString();
    
    if (this.replayData.startTime) {
      const start = new Date(this.replayData.startTime);
      const end = new Date(this.replayData.endTime);
      this.replayData.timings.total = end - start;
    }
  }

  /**
   * Registra uma tela/estado (com suporte a Playwright).
   * 
   * @param {Object|string} pageOrData - Página do Playwright ou dados do estado
   * @param {string} stepName - Nome do step
   * @param {Object} additionalData - Dados adicionais (opcional)
   * @param {boolean} force - Força registro mesmo se assinatura for igual (padrão: false)
   */
  async recordScreen(pageOrData, stepName, additionalData = {}, force = false) {
    if (!this.isRecording) return;

    let signature;
    let screenshot = null;

    // Se for página do Playwright
    if (pageOrData && typeof pageOrData.screenshot === 'function') {
      try {
        signature = await generateScreenSignature(pageOrData);
      } catch (error) {
        // Se falhar ao gerar assinatura, cria uma assinatura básica
        signature = generateSignature({ step: stepName, timestamp: Date.now() });
      }
      
      // REGRA: Se force = true, SEMPRE captura (mesmo que assinatura seja igual)
      // Se force = false, só captura se a tela mudou
      if (!force && this.lastScreenSignature && this.lastScreenSignature === signature.hash) {
        // Tela não mudou e não é forçado, não registra
        return;
      }
      
      // Atualiza última assinatura (mesmo quando force = true, para manter histórico)
      this.lastScreenSignature = signature.hash;
      
      if (this.options.enableScreenshots) {
        try {
          const screenshotBuffer = await pageOrData.screenshot({ 
            type: 'png',
            fullPage: false,
          });
          screenshot = screenshotBuffer ? screenshotBuffer.toString('base64') : null;
        } catch (error) {
          // Log erro mas continua (pode ser que a página não esteja pronta)
          if (force) {
            // Se é forçado, tenta novamente após um delay
            await new Promise(resolve => setTimeout(resolve, 200));
            try {
              const screenshotBuffer = await pageOrData.screenshot({ 
                type: 'png',
                fullPage: false,
              });
              screenshot = screenshotBuffer ? screenshotBuffer.toString('base64') : null;
            } catch (retryError) {
              // Ignora erro na segunda tentativa também
            }
          }
        }
      }
    } else {
      // Dados genéricos
      signature = generateSignature(pageOrData || { step: stepName });
      
      // Verifica se mudou
      if (!force && this.lastScreenSignature && this.lastScreenSignature === signature.hash) {
        return;
      }
      
      this.lastScreenSignature = signature.hash;
    }

    // Adiciona screenId baseado no step para facilitar identificação
    const screenId = stepName || `screen-${this.replayData.screens.length + 1}`;
    
    // REGRA: Sempre adiciona a tela ao array, mesmo se screenshot for null
    // Isso garante que temos um registro de tela para cada ação
    this.replayData.screens.push({
      screenId,
      step: stepName,
      timestamp: new Date().toISOString(),
      signature: signature.hash,
      signatureData: signature.data,
      screenshot,
      ...additionalData,
    });
  }

  /**
   * Inicia monitoramento automático de mudanças de tela.
   * Captura screenshot automaticamente sempre que a tela mudar.
   * 
   * @param {Object} page - Página do Playwright para monitorar
   * @param {Object} options - Opções de monitoramento
   * @param {number} options.checkInterval - Intervalo em ms para verificar mudanças (padrão: 500)
   * @param {boolean} options.captureOnNavigation - Captura screenshot em navegações (padrão: true)
   * @param {boolean} options.captureOnDOMChange - Captura screenshot em mudanças de DOM (padrão: true)
   */
  async startAutoScreenMonitoring(page, options = {}) {
    if (!page || typeof page.screenshot !== 'function') {
      throw new Error('startAutoScreenMonitoring requer uma página do Playwright');
    }

    if (this.autoScreenMonitoring) {
      // Já está monitorando, para antes de reiniciar
      this.stopAutoScreenMonitoring();
    }

    this.autoScreenMonitoring = true;
    this.monitoredPage = page;
    
    const {
      checkInterval = 500,
      captureOnNavigation = true,
      captureOnDOMChange = true,
    } = options;

    // Captura tela inicial
    await this.recordScreen(page, 'auto-initial', { auto: true }, true);

    // Listener para mudanças de navegação
    if (captureOnNavigation) {
      const navigationHandler = async () => {
        if (this.isRecording && this.autoScreenMonitoring) {
          try {
            // Aguarda um pouco para a página carregar
            await page.waitForTimeout(1000);
            await this.recordScreen(page, 'auto-navigation', { 
              auto: true,
              url: page.url(),
              trigger: 'navigation'
            });
          } catch (error) {
            // Ignora erros silenciosamente
          }
        }
      };

      page.on('framenavigated', navigationHandler);
      this.screenChangeListeners.push({ type: 'navigation', handler: navigationHandler });
    }

    // Monitoramento periódico de mudanças de DOM
    // Usa verificação periódica comparando assinaturas de tela
    if (captureOnDOMChange) {
      this.periodicCheckInterval = setInterval(async () => {
        if (this.isRecording && this.autoScreenMonitoring && this.monitoredPage) {
          try {
            // Verifica se a tela mudou comparando assinaturas
            await this.recordScreen(this.monitoredPage, 'auto-dom-change', { 
              auto: true,
              url: this.monitoredPage.url(),
              trigger: 'periodic-check'
            });
          } catch (error) {
            // Ignora erros silenciosamente
          }
        }
      }, checkInterval);

      this.screenChangeListeners.push({ type: 'periodic-check', handler: null });
    }
  }

  /**
   * Para monitoramento automático de mudanças de tela.
   */
  stopAutoScreenMonitoring() {
    if (!this.autoScreenMonitoring) return;

    this.autoScreenMonitoring = false;

    // Limpa intervalos
    if (this.periodicCheckInterval) {
      clearInterval(this.periodicCheckInterval);
      this.periodicCheckInterval = null;
    }

    if (this.domChangeTimeout) {
      clearTimeout(this.domChangeTimeout);
      this.domChangeTimeout = null;
    }

    // Remove listeners
    if (this.monitoredPage) {
      // Remove event listeners de navegação
      this.screenChangeListeners.forEach(({ type, handler }) => {
        if (type === 'navigation' && handler) {
          try {
            this.monitoredPage.off('framenavigated', handler);
          } catch (error) {
            // Ignora erros ao remover listener
          }
        }
      });
    }

    this.screenChangeListeners = [];
    this.monitoredPage = null;
    this.lastScreenSignature = null;
  }

  /**
   * Registra uma ação executada.
   * 
   * @param {Object} action - Ação executada
   * @param {string} action.type - Tipo da ação (ex: 'navigate', 'click', 'fill', 'api_call')
   * @param {string} action.selector - Seletor ou identificador (opcional)
   * @param {*} action.value - Valor usado (opcional)
   * @param {Object} result - Resultado da ação
   * @param {boolean} result.success - Se a ação foi bem-sucedida
   * @param {string} result.error - Mensagem de erro (se houver)
   * @param {string} result.startTime - Timestamp de início (opcional)
   * @param {string} result.endTime - Timestamp de fim (opcional)
   * @param {Object} result.page - Página do Playwright para capturar tela após ação (opcional)
   * @param {boolean} result.captureScreen - Se deve capturar tela após ação (padrão: true se page fornecida)
   */
  async recordAction(action, result = {}) {
    if (!this.isRecording || !this.options.enableActions) return;

    const actionStart = result.startTime || new Date().toISOString();
    const actionEnd = result.endTime || new Date().toISOString();
    const duration = new Date(actionEnd) - new Date(actionStart);

    // Preserva o step da ação para uso na captura de tela
    const actionStep = action.step || action.metadata?.step || null;
    
    this.replayData.actions.push(redactDeep({
      type: action.type,
      selector: action.selector || action.url || action.endpoint || null,
      value: action.value || null,
      step: actionStep, // Preserva o step
      timestamp: actionStart,
      duration: this.options.enableTimings ? duration : null,
      success: result.success !== false,
      error: result.error || null,
      expected: action.expected || null,
      actual: result.actual || null,
      classification: result.classification || action.metadata?.classification || null,
      owner: result.owner || action.metadata?.owner || null,
      recoveryPlan: result.recoveryPlan || action.metadata?.recoveryPlan || null,
      strategiesAttempted: result.strategiesAttempted || action.metadata?.strategiesAttempted || [],
      selectorRepairCandidates:
        result.selectorRepairCandidates || action.metadata?.selectorRepairCandidates || [],
      finalDecision: result.finalDecision || action.metadata?.finalDecision || null,
      severity: result.severity || action.metadata?.severity || null,
      evidenceArtifacts: result.evidenceArtifacts || action.metadata?.evidenceArtifacts || null,
      metadata: {
        ...(action.metadata || {}),
        step: actionStep, // Também no metadata para compatibilidade
      },
    }));

    // Registra timing
    if (this.options.enableTimings && action.step) {
      this.replayData.timings.steps[action.step] = duration;
    }

    // REGRA: Sempre captura tela ANTES e DEPOIS de cada ação (obrigatório)
    // Se página fornecida, captura tela automaticamente antes e depois da ação
    if (result.page && this.options.enableScreenshots) {
      try {
        // Obtém o step da ação (pode estar em action.step ou action.metadata.step)
        const actionStep = action.step || action.metadata?.step || `action-${this.replayData.actions.length}`;
        
        // 1. CAPTURA ANTES: Estado imediato (antes de qualquer processamento adicional)
        let currentUrl = null;
        try {
          currentUrl = typeof result.page.url === 'function' ? result.page.url() : result.page.url;
        } catch (e) {
          // Ignora erro ao obter URL
        }
        
        await this.recordScreen(
          result.page,
          `before-${action.type}-${actionStep}`,
          {
            auto: true,
            actionType: action.type,
            actionStep: actionStep,
            trigger: 'before-action',
            url: currentUrl,
            actionId: this.replayData.actions.length - 1, // ID da ação que acabou de ser registrada
            relatedAction: {
              type: action.type,
              step: actionStep,
              timestamp: actionStart,
            },
          },
          true // force = true para SEMPRE capturar
        );
        
        // 2. Aguarda para a tela atualizar após a ação (animações, redirecionamentos, etc.)
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 3. CAPTURA DEPOIS: Estado após processamento completo
        try {
          currentUrl = typeof result.page.url === 'function' ? result.page.url() : result.page.url;
        } catch (e) {
          // Ignora erro ao obter URL
        }
        
        await this.recordScreen(
          result.page,
          `after-${action.type}-${actionStep}`,
          {
            auto: true,
            actionType: action.type,
            actionStep: actionStep,
            trigger: 'after-action',
            url: currentUrl,
            actionId: this.replayData.actions.length - 1, // ID da ação relacionada
            relatedAction: {
              type: action.type,
              step: actionStep,
              timestamp: actionStart,
            },
          },
          true // force = true para SEMPRE capturar após ação (regra obrigatória)
        );
      } catch (error) {
        // Log erro mas não quebra o fluxo
        console.warn('[ReplaySystem] Erro ao capturar telas antes/depois da ação:', error.message);
      }
    } else if (!result.page && this.options.enableScreenshots) {
      // Se não há página mas screenshots estão habilitados, registra aviso
      console.warn('[ReplaySystem] Ação registrada sem página - tela não será capturada:', action.type);
    }
  }

  /**
   * Registra um evento genérico.
   * Útil para eventos que não são ações específicas.
   * 
   * @param {string} eventType - Tipo do evento
   * @param {Object} eventData - Dados do evento
   */
  recordEvent(eventType, eventData = {}) {
    if (!this.isRecording) return;

    this.replayData.events.push({
      type: eventType,
      timestamp: new Date().toISOString(),
      data: eventData,
    });
  }

  /**
   * Registra um erro.
   * 
   * @param {Error|Object|string} error - Erro ocorrido
   * @param {string} stepName - Nome do step onde ocorreu (opcional)
   * @param {Object} context - Contexto adicional (opcional)
   */
  recordError(error, stepName = null, context = {}) {
    if (!this.isRecording) return;

    const errorData = {
      step: stepName,
      timestamp: new Date().toISOString(),
      message: error?.message || String(error),
      code: error?.code || null,
      stack: error?.stack || null,
      ...context,
    };

    this.replayData.errors.push(redactDeep(errorData));
  }

  /**
   * Adiciona metadados customizados.
   * 
   * @param {Object} metadata - Metadados a adicionar
   */
  addMetadata(metadata) {
    this.replayData.metadata = {
      ...this.replayData.metadata,
      ...metadata,
    };
  }

  /**
   * Salva replay em arquivo.
   * 
   * @param {string} filename - Nome do arquivo (sem extensão)
   * @returns {string} Caminho do arquivo salvo
   */
  save(filename) {
    // Garante que stop foi chamado
    if (this.isRecording) {
      this.stop();
    }

    // Cria diretório se não existir
    if (!fs.existsSync(this.options.storagePath)) {
      fs.mkdirSync(this.options.storagePath, { recursive: true });
    }

    const fallback = this.replayData?.id ? String(this.replayData.id) : 'replay';
    const finalFilename = sanitizeFilename(filename || this.replayData.id, sanitizeFilename(fallback, 'replay'));
    const filepath = path.join(this.options.storagePath, `${finalFilename}.json`);
    const tenantId = this.replayData?.metadata?.tenantId || this.options.tenantId || 'system';
    const safeReplay = redactDeep({ ...this.replayData, tenantId });
    const governance = {
      goNoGo: safeReplay.errors?.length ? 'NO_GO' : 'GO',
      isOperational: safeReplay.errors?.length === 0,
      blockers: safeReplay.errors?.map((entry) => ({ reason: entry.code || 'rpa_replay_error' })) || [],
    };
    const signedReplay = signReplayArtifact(safeReplay, { governance, tenantId });
    this.replayData = signedReplay;
    const temporaryPath = `${filepath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(signedReplay, null, 2), 'utf8');
    fs.renameSync(temporaryPath, filepath);

    return filepath;
  }

  /**
   * Carrega replay de arquivo.
   * 
   * @param {string} filenameOrPath - Nome do arquivo (sem extensão) ou caminho completo
   * @param {string} storagePath - Caminho de armazenamento (opcional, usado apenas se filename não for caminho completo)
   * @returns {Object|null} Dados do replay ou null se não encontrado
   */
  static load(filenameOrPath, storagePath = null) {
    let filepath;
    
    // Se for um caminho completo (contém / ou \), usa diretamente
    if (filenameOrPath.includes(path.sep) || filenameOrPath.includes('/') || filenameOrPath.includes('\\')) {
      filepath = filenameOrPath.endsWith('.json') ? filenameOrPath : `${filenameOrPath}.json`;
    } else {
      // Caso contrário, trata como filename e constrói o caminho
      const basePath = storagePath || path.join(process.cwd(), 'replays');
      filepath = path.join(basePath, `${filenameOrPath}.json`);
    }
    
    if (!fs.existsSync(filepath)) {
      return null; // Retorna null ao invés de lançar erro
    }

    try {
      const content = fs.readFileSync(filepath, 'utf8');
      const replay = JSON.parse(content);
      const hasIntegrity = Boolean(replay.replayHash || replay.replayChecksum || replay.governanceSignature);
      if (hasIntegrity || process.env.NODE_ENV === 'production') {
        // Frescor é uma política de gate, não de retenção/leitura. Replays
        // assinados permanecem legíveis durante os 90 dias de retenção, mas
        // continuam sendo rejeitados se hash/checksum/HMAC não conferirem.
        const validation = validateReplayIntegrity(
          replay,
          replay.governance || replay.governanceResult || {},
          { maxAgeMs: -1 },
        );
        if (!validation.valid) return null;
      }
      return replay;
    } catch (error) {
      return null;
    }
  }

  /**
   * Lista todos os replays disponíveis.
   * 
   * @param {string} storagePath - Caminho de armazenamento (opcional)
   * @param {string} context - Filtrar por contexto (opcional)
   * @returns {Array} Lista de replays
   */
  static list(storagePath = null, context = null) {
    const basePath = storagePath || path.join(process.cwd(), 'replays');
    
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
          
          return {
            filename: f.replace('.json', ''),
            path: filepath,
            ...data,
            size: stats.size,
            modified: stats.mtime,
          };
        } catch (error) {
          return null;
        }
      })
      .filter(f => f !== null);

    // Filtra por contexto se especificado
    if (context) {
      return files.filter(f => f.context === context);
    }

    return files;
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
      events: [],
      timings: {},
      errors: [],
      metadata: {},
    };

    // Diff de telas
    const maxScreens = Math.max(expected.screens?.length || 0, actual.screens?.length || 0);
    for (let i = 0; i < maxScreens; i++) {
      const expectedScreen = expected.screens?.[i];
      const actualScreen = actual.screens?.[i];

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
    const maxActions = Math.max(expected.actions?.length || 0, actual.actions?.length || 0);
    for (let i = 0; i < maxActions; i++) {
      const expectedAction = expected.actions?.[i];
      const actualAction = actual.actions?.[i];

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
      }
    }

    // Diff de timings
    if (expected.timings?.total !== actual.timings?.total) {
      diff.timings.total = {
        expected: expected.timings?.total,
        actual: actual.timings?.total,
        difference: (actual.timings?.total || 0) - (expected.timings?.total || 0),
      };
    }

    // Diff de erros
    if ((actual.errors?.length || 0) > (expected.errors?.length || 0)) {
      diff.errors = actual.errors.slice(expected.errors?.length || 0);
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
    lines.push('📹 RELATÓRIO DE REPLAY');
    lines.push('='.repeat(70));
    lines.push('');
    lines.push(`ID: ${replay.id}`);
    lines.push(`Contexto: ${replay.context || 'N/A'}`);
    lines.push(`Gravação: ${replay.recordingId}`);
    lines.push(`Início: ${new Date(replay.startTime).toLocaleString('pt-BR')}`);
    lines.push(`Fim: ${new Date(replay.endTime).toLocaleString('pt-BR')}`);
    lines.push(`Duração: ${replay.timings?.total || 0}ms`);
    lines.push('');

    // Telas
    if (replay.screens && replay.screens.length > 0) {
      lines.push('📺 TELAS REGISTRADAS:');
      lines.push('-'.repeat(70));
      replay.screens.forEach((screen, index) => {
        lines.push(`${index + 1}. Step: ${screen.step}`);
        lines.push(`   Assinatura: ${screen.signature}`);
        lines.push(`   Timestamp: ${new Date(screen.timestamp).toLocaleString('pt-BR')}`);
        lines.push('');
      });
    }

    // Ações
    if (replay.actions && replay.actions.length > 0) {
      lines.push('🎬 AÇÕES EXECUTADAS:');
      lines.push('-'.repeat(70));
      replay.actions.forEach((action, index) => {
        lines.push(`${index + 1}. ${action.type.toUpperCase()}`);
        lines.push(`   Seletor: ${action.selector || 'N/A'}`);
        lines.push(`   Sucesso: ${action.success ? '✅' : '❌'}`);
        if (action.duration) {
          lines.push(`   Duração: ${action.duration}ms`);
        }
        if (action.error) {
          lines.push(`   Erro: ${action.error}`);
        }
        lines.push('');
      });
    }

    // Eventos
    if (replay.events && replay.events.length > 0) {
      lines.push('📅 EVENTOS:');
      lines.push('-'.repeat(70));
      replay.events.forEach((event, index) => {
        lines.push(`${index + 1}. ${event.type}`);
        lines.push(`   Timestamp: ${new Date(event.timestamp).toLocaleString('pt-BR')}`);
        lines.push('');
      });
    }

    // Erros
    if (replay.errors && replay.errors.length > 0) {
      lines.push('❌ ERROS:');
      lines.push('-'.repeat(70));
      replay.errors.forEach((error, index) => {
        lines.push(`${index + 1}. Step: ${error.step || 'N/A'}`);
        lines.push(`   Mensagem: ${error.message}`);
        lines.push('');
      });
    }

    lines.push('='.repeat(70));
    
    return lines.join('\n');
  }

  /**
   * Obtém dados do replay atual.
   * 
   * @returns {Object} Dados do replay
   */
  getData() {
    return { ...this.replayData };
  }
}

module.exports = {
  ReplaySystem,
  generateScreenSignature,
  generateSignature,
};
