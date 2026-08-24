const { RpaTestRunner } = require('../../core/rpa/rpaTestRunner');
const { ActionRecorder } = require('../../core/rpa/actionRecorder');
const { autoLoginBeforeSteps } = require('../../core/rpa/utils/autoLoginFlow');
const { recordStepFailure } = require('../../core/rpa/stepFailurePolicy');
// Usa versão de produção do normalizador, que vive em `api/utils`
const { normalizeRpaTestUrls } = require('../utils/urlNormalizer');
const {
  partitionPageErrors,
  partitionConsoleErrors,
  createNetworkRecoveryTracker,
} = require('../utils/transientNetworkRecovery');
const logger = require('../utils/logger');
const { resolveRuntimePath } = require('../utils/runtimePaths');
const {
  persistExecutionArtifacts,
  indexExecutionInRag,
} = require('./rpaArtifactPersistence');
const {
  safeToString,
  safeTrim,
  safeTrimLower,
  safeErrorMessage,
} = require('../utils/defensiveCoercion');
const path = require('path');
const fs = require('fs');
const {
  getRpaFlowReadDirs,
  getRpaSeedReadDirs,
  getRpaSeedWriteDir,
  normalizeJsonName,
  uniquePaths,
} = require('../../lib/rpaPathResolver');
const {
  belongsToTenant,
  isSensitiveSelector,
  normalizeTenantKey,
  redactDeep,
  redactUrl,
  stripInternalFilesystemPaths,
} = require('../../lib/rpaSecurity');

// Importação lazy do overlayInjector (apenas quando necessário para evitar erros de sintaxe)
let INJECTABLE_SCRIPT = null;
function getInjectableScript() {
  if (INJECTABLE_SCRIPT === null) {
    try {
      const overlayInjector = require('../../core/rpa/overlayInjector');
      INJECTABLE_SCRIPT = overlayInjector.INJECTABLE_SCRIPT;
    } catch (error) {
      logger.warn('Não foi possível carregar overlayInjector', { error: safeErrorMessage(error) });
      INJECTABLE_SCRIPT = ''; // Fallback vazio
    }
  }
  return INJECTABLE_SCRIPT;
}

// Armazena execuções em andamento
const activeExecutions = new Map();

// Armazena gravações manuais em andamento
const activeRecordings = new Map();

/**
 * Remove arquivos transitórios de RPA após persistência bem-sucedida no
 * artifact store. O blob store passa a ser a cópia durável; manter o ZIP de
 * trace em `rpa/traces/` e os PNGs em disco duplicava os bytes (o mesmo
 * conteúdo ficava em disco E no blob store, crescendo sem limite).
 */
function cleanupTransientRpaFiles(tracePath, resultsObj, outcome) {
  if (outcome && outcome.trace && tracePath && fs.existsSync(tracePath)) {
    try {
      fs.unlinkSync(tracePath);
    } catch (error) {
      logger.warn('[rpaService] Falha ao remover trace transitório', {
        tracePath,
        error: safeErrorMessage(error),
      });
    }
  }

  if (outcome && outcome.screenshots > 0) {
    const screenshotPaths = Array.isArray(resultsObj && resultsObj.screenshots)
      ? resultsObj.screenshots
      : [];
    for (const shotPath of screenshotPaths) {
      const filePath = typeof shotPath === 'string'
        ? shotPath
        : (shotPath && (shotPath.path || shotPath.filePath));
      if (!filePath || typeof filePath !== 'string') continue;
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (error) {
        logger.warn('[rpaService] Falha ao remover screenshot transitório', {
          filePath,
          error: safeErrorMessage(error),
        });
      }
    }
  }
}

// Barramento em processo para mudanças de estado das execuções RPA.
// Consumidores (adapter do QA Mesh) assinam eventos em vez de fazer polling.
const { EventEmitter } = require('events');
const rpaExecutionEvents = new EventEmitter();
rpaExecutionEvents.setMaxListeners(200);

function emitRpaExecutionEvent(execution) {
  if (!execution || !execution.id) return;
  rpaExecutionEvents.emit('updated', stripInternalFilesystemPaths(redactDeep({
    id: execution.id,
    tenantId: execution.tenantId,
    status: execution.status,
    progress: execution.progress,
    currentStep: execution.currentStep,
    totalSteps: execution.totalSteps,
    error: execution.error || null,
    // Logs recentes mantêm a UI viva sem polling REST.
    logs: Array.isArray(execution.logs) ? execution.logs.slice(-50) : [],
  })));
}

// Ponte WebSocket: propaga mudanças de estado em tempo real para o frontend,
// eliminando polling. Todo evento carrega tenant e o servidor WebSocket faz
// a segregação; o cliente nunca é responsável por impedir vazamento.
let wsEmitCached;
function getWsEmit() {
  if (wsEmitCached === undefined) {
    try {
      wsEmitCached = require('./websocketService').emitEvent || null;
    } catch (error) {
      wsEmitCached = null;
    }
  }
  return wsEmitCached;
}

rpaExecutionEvents.on('updated', (event) => {
  const emit = getWsEmit();
  if (!emit) return;
  try {
    if (!event.tenantId) {
      logger.error('[RPA] Evento de execução descartado sem tenant', { executionId: event.id });
      return;
    }
    emit('rpa.execution.updated', event, { tenantId: event.tenantId });
  } catch (error) {
    logger.warn('[RPA] Falha ao emitir evento WebSocket de execução', { error: safeErrorMessage(error) });
  }
});

function emitRecordingWsEvent(recordingId, status, tenantId, extra = {}) {
  const emit = getWsEmit();
  if (!emit) return;
  try {
    if (!tenantId) {
      logger.error('[RPA] Evento de gravação descartado sem tenant', { recordingId });
      return;
    }
    emit(
      'rpa.recording.updated',
      stripInternalFilesystemPaths(redactDeep({ recordingId, status, tenantId, ...extra })),
      { tenantId }
    );
  } catch (error) {
    logger.warn('[RPA] Falha ao emitir evento WebSocket de gravação', { error: safeErrorMessage(error) });
  }
}

const { isIgnorablePageNoise } = require('../utils/rpaPageNoiseFilters');

/**
 * Lista todas as gravações RPA disponíveis.
 * UNIFICADO: Tudo está em /seeds/
 */
function listRecordings(tenantId = 'system') {
  try {
    const scopedTenantId = normalizeTenantKey(tenantId);
    const candidateDirs = uniquePaths([
      ...getRpaSeedReadDirs(scopedTenantId),
      ...getRpaFlowReadDirs(scopedTenantId),
    ]);
    const recordings = [];

    function pushRecording(filePath, source) {
      const file = path.basename(filePath);
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) return;

      const content = fs.readFileSync(filePath, 'utf8');
      const recording = JSON.parse(content);
      if (!belongsToTenant(recording, scopedTenantId)) return;
      const fileNameId = file.replace('.json', '');

      recordings.push({
        id: recording.id || fileNameId,
        internalId: recording.id || null,
        fileNameId,
        name: recording.name || fileNameId,
        description: recording.description,
        version: recording.version,
        steps: recording.steps || [],
        data: recording.data || {},
        source: recording.source || source || 'manual',
        recording,
      });
    }

    const existingDirs = candidateDirs.filter((dirPath) => {
      try {
        return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
      } catch (_) {
        return false;
      }
    });

    if (existingDirs.length === 0) {
      logger.warn('Diretório de gravações RPA não encontrado', {
        triedPaths: candidateDirs,
        cwd: process.cwd(),
        __dirname: __dirname,
      });
      return [];
    }

    for (const dirPath of existingDirs) {
      try {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
          if (file.endsWith('.json')) {
            try {
              const normalizedDir = dirPath.replace(/\\/g, '/');
              const source = normalizedDir.endsWith('/flows') ? 'flow' : 'seed';
              pushRecording(path.join(dirPath, file), source);
            } catch (error) {
              logger.warn(`Erro ao ler gravação ${file}`, { error: safeErrorMessage(error), path: dirPath });
            }
          }
        }
      } catch (error) {
        logger.warn('Erro ao ler diretório RPA', { error: safeErrorMessage(error), path: dirPath });
      }
    }

    logger.debug('Gravações RPA listadas', { count: recordings.length, directories: existingDirs });
    return recordings;
  } catch (error) {
    logger.error('Erro ao listar gravações RPA', { 
      error: safeErrorMessage(error), 
      stack: error.stack,
      cwd: process.cwd(),
      __dirname: __dirname
    });
    // Retorna array vazio em caso de erro para não quebrar a API
    return [];
  }
}

function hasExecutableRecordingShape(recording) {
  return Boolean(recording && typeof recording === 'object' && Array.isArray(recording.steps));
}

function assertExecutableRecording(recording, recordingId) {
  if (!recording) {
    throw new Error(`Gravação não encontrada: ${recordingId}`);
  }
  if (!hasExecutableRecordingShape(recording)) {
    throw new Error(`Gravação inválida ou sem steps executáveis: ${recordingId}`);
  }
}

/**
 * Executa uma gravação RPA com configurações personalizadas.
 * 
 * @param {string} recordingId - ID da gravação
 * @param {Object} config - Configurações de execução
 * @param {Object} data - Dados adicionais
 * @returns {Promise<Object>} Resultado da execução
 */
async function executeRecording(recordingId, config = {}, data = {}, authToken = null, tenantId = 'system') {
  const scopedTenantId = normalizeTenantKey(tenantId);
  recordingId = normalizeJsonName(recordingId);
  const executionId = `rpa-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Cria runner com configurações
  // Por padrão mantemos o navegador visível (útil para execução manual),
  // mas permitimos headless quando explicitamente solicitado (ex: validações automáticas/CI).
  const resolvedHeadless = config.headless !== undefined ? config.headless : false;
  const runner = new RpaTestRunner({
    tenantId: scopedTenantId,
    headless: resolvedHeadless,
    slowMo: config.slowMo || 500,
    timeout: config.timeout || 30000,
    screenshotOnFailure: config.screenshotOnFailure !== undefined ? config.screenshotOnFailure : true,
    // Devtools em headless só atrapalha (e pode causar instabilidade)
    devtools: config.devtools !== undefined ? config.devtools : !resolvedHeadless,
    // Trace visual SEMPRE gerado, em diretório de runtime fora do workspace.
    traceDir: resolveRuntimePath('rpa', 'traces'),
  });

  // Armazena execução
  const execution = {
    id: executionId,
    tenantId: scopedTenantId,
    recordingId,
    status: 'running',
    progress: 0,
    startTime: new Date().toISOString(),
    runner,
    logs: [],
    currentStep: null,
    totalSteps: 0,
    stepByStep: config.stepByStep || false,
    paused: false,
    continuePromise: null,
    continueResolve: null,
    continueWithoutPause: false, // Flag para continuar sem pausas
    currentStepIndex: 0, // Índice do step atual
  };
  activeExecutions.set(executionId, execution);
  emitRpaExecutionEvent(execution);

  // Função para adicionar log
  const addLog = (level, message, details = {}) => {
    const logEntry = redactDeep({
      timestamp: new Date().toISOString(),
      level, // 'info', 'success', 'error', 'warning'
      message,
      ...details,
    });
    execution.logs.push(logEntry);
    // Mantém apenas os últimos 1000 logs
    if (execution.logs.length > 1000) {
      execution.logs.shift();
    }
  };

  // Executa de forma assíncrona
  (async () => {
    try {
      addLog('info', '🚀 Iniciando execução RPA...', { step: 'init' });
      addLog('info', `📋 Gravação: ${recordingId}`, { step: 'init' });
      
      await runner.init();
      addLog('success', '✅ Browser inicializado', { step: 'init' });
      
      // Detecta quando o navegador é fechado pelo usuário e cancela a execução
      const handleBrowserClosed = async () => {
        // Navegador foi fechado pelo usuário
        if (execution.status === 'running' || execution.status === 'paused') {
          addLog('warning', '⚠️ Navegador fechado pelo usuário - Cancelando execução...', {
            step: 'browser_closed',
          });
          
          // Remove overlay se estiver pausado
          try {
            const page = runner.executor?.page;
            if (page && !page.isClosed()) {
              await page.evaluate(() => {
                if (window.rpaOverlay) {
                  window.rpaOverlay.remove();
                }
              }).catch(() => {
                // Ignora erro se a página já foi fechada
              });
            }
          } catch (overlayError) {
            // Ignora erro ao remover overlay (página pode ter sido fechada)
            if (!overlayError.message?.includes('Target page, context or browser has been closed')) {
              // Log apenas se não for erro de página fechada
            }
          }
          
          // Resolve promise se estiver aguardando continuação
          if (execution.continueResolve) {
            execution.continueResolve();
          }
          
          // Marca execução como cancelada
          execution.status = 'cancelled';
          execution.endTime = new Date().toISOString();
          execution.error = 'Navegador fechado pelo usuário';
          emitRpaExecutionEvent(execution);
          
          // Tenta fechar o runner (pode falhar se já estiver fechado)
          try {
            await runner.close();
          } catch (closeError) {
            // Ignora erro se já estiver fechado
          }
        }
      };
      
      // Listener no browser para detectar desconexão
      const browser = runner.executor?.browser;
      if (browser) {
        browser.on('disconnected', handleBrowserClosed);
      }
      
      // Listener na página para detectar fechamento
      const page = runner.executor?.page;
      if (page) {
        page.on('close', handleBrowserClosed);
      }
      
      // Carrega gravação usando ActionRecorder
      // Primeiro tenta encontrar o arquivo pelo ID ou pelo nome
      let recording;
      try {
        // Tenta carregar pelo ID primeiro
        recording = ActionRecorder.load(recordingId, scopedTenantId);
        if (recording && !belongsToTenant(recording, scopedTenantId)) {
          const forbidden = new Error(`Gravação não encontrada: ${recordingId}`);
          forbidden.code = 'NOT_FOUND';
          throw forbidden;
        }
        if (!hasExecutableRecordingShape(recording)) {
          throw new Error(`Gravação inválida ou sem steps executáveis: ${recordingId}`);
        }
      } catch (error) {
        // Se não encontrar pelo ID, tenta encontrar pelo nome do arquivo
        // Lista todas as gravações e procura pelo ID
        const recordings = listRecordings(scopedTenantId);
        const foundRecording = recordings.find((r) => r.id === recordingId || r.fileNameId === recordingId);
        if (foundRecording) {
          if (foundRecording.fileNameId) {
            try {
              recording = ActionRecorder.load(foundRecording.fileNameId, scopedTenantId);
            } catch (_) {
              recording = foundRecording.recording || null;
            }
          } else if (foundRecording.recording) {
            recording = foundRecording.recording;
          }

          assertExecutableRecording(recording, recordingId);
          addLog('info', `📦 Gravação resolvida via catálogo: ${foundRecording.fileNameId}`, {
            step: 'init',
          });
        } else {
          throw error;
        }
      }

      assertExecutableRecording(recording, recordingId);
      
      // Normaliza URLs no recording (corrige URLs inválidas de testes antigos)
      normalizeRpaTestUrls(recording);
      
      execution.totalSteps = recording.steps?.length || 0;
      addLog('info', `📝 Total de ações: ${execution.totalSteps}`, { step: 'init' });

      // Artefatos são parte do resultado, não telemetria opcional. Uma
      // execução sem manifesto/replay verificável não pode permanecer verde.
      const finalizeArtifacts = async (executionId, resultsObj, tracePath, finalStatus = execution.status) => {
        try {
          const outcome = await persistExecutionArtifacts({
            recording,
            recordingId,
            executionId,
            results: resultsObj,
            tracePath,
            tenantKey: scopedTenantId,
            startedAt: execution.startTime,
            finishedAt: execution.endTime || null,
            status: finalStatus,
          });
          execution.artifactPersistence = outcome;
          // Higiene de disco: após persistir no artifact store (blob store),
          // os arquivos transitórios locais (trace ZIP + screenshots PNG) não
          // são mais necessários. Remover evita duplicar bytes em disco.
          cleanupTransientRpaFiles(tracePath, resultsObj, outcome);
          const incomplete = Boolean(outcome.error)
            || outcome.executionManifest !== true
            || (resultsObj != null && outcome.replay !== true);
          if (incomplete) {
            const persistenceError = outcome.error || 'rpa_artifact_persistence_incomplete';
            execution.status = 'failed';
            execution.error = persistenceError;
            if (resultsObj) {
              resultsObj.success = false;
              resultsObj.errors = Array.isArray(resultsObj.errors) ? resultsObj.errors : [];
              resultsObj.errors.push({
                step: 'artifact_persistence',
                action: 'persist_evidence',
                error: persistenceError,
              });
            }
            emitRpaExecutionEvent(execution);
            return outcome;
          }

          execution.status = finalStatus;
          emitRpaExecutionEvent(execution);

          if (resultsObj != null) {
            await indexExecutionInRag({
              recording,
              recordingId,
              executionId,
              results: resultsObj,
              tenantKey: scopedTenantId,
            });
          }
          return outcome;
        } catch (error) {
          const persistenceError = safeErrorMessage(error) || 'rpa_artifact_persistence_failed';
          execution.status = 'failed';
          execution.error = persistenceError;
          execution.artifactPersistence = { error: persistenceError };
          if (resultsObj) {
            resultsObj.success = false;
            resultsObj.errors = Array.isArray(resultsObj.errors) ? resultsObj.errors : [];
            resultsObj.errors.push({
              step: 'artifact_persistence',
              action: 'persist_evidence',
              error: persistenceError,
            });
          }
          emitRpaExecutionEvent(execution);
          return { error: persistenceError };
        }
      };

      // Mescla dados
      const mergedData = {
        ...recording.data,
        ...data,
      };

      const toTimestamp = (value) => {
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : Date.now();
      };

      const pageConsoleEvents = [];
      const pageNetworkEvents = [];
      // Rastreador dedicado de recuperação de rede: imune ao cap de 1000
      // eventos do buffer principal (execuções longas descartam eventos
      // antigos e a recuperação deixava de ser detectada).
      const networkRecoveryTracker = createNetworkRecoveryTracker();
      const activePage = runner.executor?.page;
      if (activePage) {
        activePage.on('console', (msg) => {
          let locationUrl = '';
          try {
            locationUrl = (msg.location() && msg.location().url) || '';
          } catch (_) {
            locationUrl = '';
          }
          pageConsoleEvents.push({
            timestamp: Date.now(),
            level: msg.type(),
            text: msg.text(),
            url: locationUrl,
          });
          if (pageConsoleEvents.length > 1000) pageConsoleEvents.shift();
        });

        activePage.on('request', (request) => {
          pageNetworkEvents.push({
            timestamp: Date.now(),
            type: 'request',
            method: request.method(),
            url: request.url(),
          });
          if (pageNetworkEvents.length > 1000) pageNetworkEvents.shift();
        });

        activePage.on('response', (response) => {
          try {
            const req = response.request();
            const headers = typeof response.headers === 'function' ? response.headers() : {};
            pageNetworkEvents.push({
              timestamp: Date.now(),
              type: 'response',
              method: req.method(),
              status: response.status(),
              url: response.url(),
              contentType: headers['content-type'] || headers['Content-Type'] || null,
            });
            if (pageNetworkEvents.length > 1000) pageNetworkEvents.shift();
            networkRecoveryTracker.onResponse({ url: response.url(), status: response.status() });
          } catch (_) {
            // noop
          }
        });

        // requestfailed entra na trilha de rede para permitir distinguir
        // blip transitório recuperado (mesma URL responde < 400 depois) de
        // falha real — ver api/utils/transientNetworkRecovery.js.
        activePage.on('requestfailed', (request) => {
          try {
            const failure = (request.failure() && request.failure().errorText) || null;
            pageNetworkEvents.push({
              timestamp: Date.now(),
              type: 'request_failed',
              method: request.method(),
              url: request.url(),
              failure,
            });
            if (pageNetworkEvents.length > 1000) pageNetworkEvents.shift();
            networkRecoveryTracker.onRequestFailed({
              url: request.url(),
              method: request.method(),
              failure,
            });
          } catch (_) {
            // noop
          }
        });
      }

      let tracingStartWarning = null;
      try {
        if (runner.executor?.startTracing) {
          await runner.executor.startTracing({
            // Snapshots do DOM permanecem (essencial para o replay visual
            // auditável). Screenshots e sources ficam desligados por padrão
            // no executor (ver actionExecutor.startTracing): o uiTrace já
            // embute capturas ANTES/DEPOIS e os sources não são necessários.
            snapshots: true,
          });
        }
      } catch (traceStartError) {
        tracingStartWarning = safeErrorMessage(traceStartError);
        addLog('warning', `⚠️ Falha ao iniciar tracing: ${tracingStartWarning}`, {
          step: 'trace_start',
        });
      }

      if (runner.executor?.page) {
        const config = require('../utils/config');
        const authResult = await autoLoginBeforeSteps(runner.executor.page, {
          firstStep: recording.steps?.[0],
          autoLogin: recording?.metadata?.autoLogin !== false && mergedData.autoLogin !== false,
          templateData: mergedData,
          // Permite que a gravação escolha a estratégia de login (ex.: "ui" para
          // telas que exigem perfil com permissões completas, como /dev/qa-waves)
          authOptions: recording?.metadata?.authOptions && typeof recording.metadata.authOptions === 'object'
            ? recording.metadata.authOptions
            : {},
          frontendBaseUrl: process.env.TEST_FRONTEND_URL || process.env.FRONTEND_URL || config.get('frontend.url') || 'http://localhost:5173',
          apiBaseUrl: process.env.TEST_API_URL || process.env.API_URL || process.env.API_BASE_URL || config.get('api.baseUrl') || `http://localhost:${Number(config.get('api.port', 3001))}`,
        });

        if (!authResult.success) {
          addLog('warning', `⚠️ Auto-login não aplicado: ${authResult.error}`, { step: 'init' });
        } else if (authResult.loggedIn) {
          addLog('success', '✅ Login automático realizado com sucesso', { step: 'init' });
        } else if (authResult.skipped) {
          addLog('info', `ℹ️ Auto-login não aplicado (${authResult.skipReason})`, { step: 'init' });
        }
      }

      // Executa playback com logging customizado
      addLog('info', '▶️ Iniciando execução das ações...', { step: 'playback' });
      
      // Executa manualmente para capturar logs
      const results = {
        recordingId: recording.id,
        recordingName: recording.name,
        success: true,
        finalDecision: 'PASS',
        steps: [],
        errors: [],
        warnings: [],
        screenshots: [],
        startTime: new Date().toISOString(),
        reliabilityMetrics: null,
      };

      try {
        // Executa cada step
        for (let i = 0; i < recording.steps.length; i++) {
          const step = recording.steps[i];
          const stepNumber = i + 1;
          const totalSteps = recording.steps.length;
          
          // Atualiza progresso
          execution.progress = Math.round((stepNumber / totalSteps) * 100);
          execution.currentStep = `Ação ${stepNumber}/${totalSteps}: ${step.type}`;
          emitRpaExecutionEvent(execution);
          
          // Log da ação
          const actionNames = {
            navigate: '🌐 Navegar',
            fill: '✏️ Preencher',
            click: '🖱️ Clicar',
            wait: '⏳ Aguardar',
            select: '📋 Selecionar',
            assert: '✅ Validar',
          };
          const actionName = actionNames[step.type] || step.type;
          
          let stepDetails = '';
          if (step.type === 'navigate') {
            stepDetails = `URL: ${redactUrl(step.url || step.value || '(não especificada)')}`;
          } else if (step.selector) {
            stepDetails = `Seletor: ${step.selector}`;
            const rawStepValue = safeToString(step.value, '');
            if (rawStepValue && !rawStepValue.includes('***')) {
              const visibleValue = isSensitiveSelector(step.selector, step.inputType || step.autocomplete)
                ? '[REDACTED]'
                : rawStepValue;
              stepDetails += ` | Valor: ${visibleValue.substring(0, 50)}${visibleValue.length > 50 ? '...' : ''}`;
            }
          } else if (step.condition) {
            stepDetails = `Condição: ${step.condition}`;
          }
          
          addLog('info', `${actionName} - ${stepDetails}`, {
            step: stepNumber,
            action: step.type,
            details: stepDetails,
          });

          // Atualiza índice do step atual
          execution.currentStepIndex = i;

          // Se step-by-step está ativo e não foi solicitado continuar sem pausas, pausa antes de executar
          logger.info(`[RPA Overlay] Verificando se deve injetar overlay: stepByStep=${execution.stepByStep}, continueWithoutPause=${execution.continueWithoutPause}`);
          if (execution.stepByStep && !execution.continueWithoutPause) {
            logger.info(`[RPA Overlay] ✅ Condição atendida! Injetando overlay...`);
            execution.paused = true;
            execution.status = 'paused';
            emitRpaExecutionEvent(execution);
            addLog('info', `⏸️ Pausado - Aguardando confirmação para continuar...`, {
              step: stepNumber,
              action: 'pause',
            });
            
            // Injeta overlay no navegador
            try {
              const page = runner.executor?.page;
              logger.info(`[RPA Overlay] Página do Puppeteer: ${page ? 'disponível' : 'NÃO disponível'}`);
              if (page) {
                // Obtém URL base da API
                // Prioridade: API_BASE_URL > config.json > fallback
                const config = require('../utils/config');
                const apiBaseUrl = process.env.TEST_API_URL ||
                                   process.env.API_URL ||
                                   process.env.API_BASE_URL || 
                                   config.get('api.baseUrl') ||
                                   config.get('scripts.apiUrl') ||
                                   `http://localhost:${Number(config.get('api.port', 3001))}`;
                
                logger.info(`[RPA Overlay] Injetando overlay para execução ${executionId}`);
                
                // Configura listener para capturar logs do console do navegador
                // Remove listeners anteriores para evitar duplicação
                page.removeAllListeners('console');
                
                // Flag para verificar se o listener capturou a mensagem de teste
                let testMessageCaptured = false;
                let testMessagePromiseResolve = null;
                
                const consoleHandler = (msg) => {
                  try {
                    const text = msg.text();
                    const type = msg.type();
                    // Log todas as mensagens do console para debug (temporário)
                    logger.info(`[RPA Overlay] [CONSOLE RAW] type=${type}, text=${text}`);
                    // Captura todos os logs do overlay e também erros
                    if (text.includes('[RPA Overlay]') || text.includes('rpaOverlay') || type === 'error') {
                      logger.info(`[RPA Overlay] [BROWSER CONSOLE ${type.toUpperCase()}] ${text}`);
                      // Marca que a mensagem de teste foi capturada
                      if (text.includes('[RPA Overlay] [TEST] Teste de listener do console')) {
                        testMessageCaptured = true;
                        if (testMessagePromiseResolve) {
                          testMessagePromiseResolve();
                          testMessagePromiseResolve = null;
                        }
                      }
                    }
                  } catch (error) {
                    logger.error(`[RPA Overlay] Erro no consoleHandler: ${safeErrorMessage(error)}`);
                  }
                };
                page.on('console', consoleHandler);
                logger.info('[RPA Overlay] Listener de console registrado');
                
                // Captura erros da página também
                page.on('pageerror', error => {
                  logger.error(`[RPA Overlay] [PAGE ERROR] ${safeErrorMessage(error)}`);
                });
                
                // Aguarda um pouco para garantir que o listener esteja totalmente registrado
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Testa se o listener está funcionando
                // Usa uma Promise para garantir que o listener tenha tempo de processar
                const testPromise = new Promise((resolve) => {
                  testMessagePromiseResolve = resolve;
                  // Timeout de 500ms para dar mais tempo
                  setTimeout(() => {
                    if (!testMessageCaptured) {
                      logger.warn('[RPA Overlay] Mensagem de teste não foi capturada pelo listener após 500ms');
                    }
                    if (testMessagePromiseResolve === resolve) {
                      testMessagePromiseResolve = null;
                    }
                    resolve();
                  }, 500);
                });
                
                // Executa o teste
                logger.info('[RPA Overlay] Executando teste do listener...');
                await page.evaluate(() => {
                  console.log('[RPA Overlay] [TEST] Teste de listener do console');
                });
                logger.info('[RPA Overlay] Teste executado, aguardando captura...');
                
                // Aguarda a captura da mensagem ou timeout
                await testPromise;
                
                if (testMessageCaptured) {
                  logger.info('[RPA Overlay] ✅ Listener de console configurado e testado com sucesso');
                } else {
                  logger.warn('[RPA Overlay] ⚠️ Listener de console configurado, mas mensagem de teste não foi capturada');
                }
                
                // Injeta script do overlay usando uma função para garantir execução correta
                try {
                  const injectResult = await page.evaluate((script) => {
                    try {
                      console.log('[RPA Overlay] [INJECT] Iniciando injeção do script...');
                      console.log('[RPA Overlay] [INJECT] Tamanho do script:', script.length);
                      
                      // Executa o script como código
                      let evalError = null;
                      try {
                        eval(script);
                      } catch (e) {
                        evalError = e;
                        console.error('[RPA Overlay] [INJECT] ERRO no eval():', e);
                        console.error('[RPA Overlay] [INJECT] Mensagem:', e.message);
                        console.error('[RPA Overlay] [INJECT] Stack:', e.stack);
                        // Não retorna ainda, tenta verificar se window.rpaOverlay foi criado mesmo com erro
                      }
                      
                      // Aguarda um pouco para garantir que o script foi processado
                      // (alguns scripts podem ter setTimeout ou async operations)
                      // Não podemos usar await dentro de page.evaluate, então fazemos verificação síncrona primeiro
                      let exists = typeof window.rpaOverlay !== 'undefined';
                      let hasCreate = exists && typeof window.rpaOverlay.create === 'function';
                      let hasInit = exists && typeof window.rpaOverlay.init === 'function';
                      
                      // Se não existe, aguarda um pouco e verifica novamente
                      if (!exists) {
                        // Usa uma verificação síncrona com loop (não ideal, mas necessário)
                        const startTime = Date.now();
                        while (!exists && (Date.now() - startTime) < 500) {
                          // Pequeno delay síncrono
                          const end = Date.now() + 10;
                          while (Date.now() < end) {
                            // Loop vazio para delay
                          }
                          exists = typeof window.rpaOverlay !== 'undefined';
                          if (exists) {
                            hasCreate = typeof window.rpaOverlay.create === 'function';
                            hasInit = typeof window.rpaOverlay.init === 'function';
                            break;
                          }
                        }
                      }
                      
                      const checkResult = { exists, hasCreate, hasInit };
                      
                      // Verifica se window.rpaOverlay foi criado
                      if (!checkResult.exists) {
                        console.error('[RPA Overlay] [INJECT] ERRO: window.rpaOverlay não foi criado após eval()');
                        if (evalError) {
                          return { success: false, error: `Erro no eval: ${evalError.message}`, stack: evalError.stack };
                        }
                        return { success: false, error: 'window.rpaOverlay não foi criado' };
                      }
                      
                      // Verifica se tem os métodos necessários
                      if (!checkResult.hasCreate && !checkResult.hasInit) {
                        console.error('[RPA Overlay] [INJECT] ERRO: window.rpaOverlay não tem create() nem init()');
                        return { success: false, error: 'window.rpaOverlay não tem métodos necessários' };
                      }
                      
                      console.log('[RPA Overlay] [INJECT] ✅ Script injetado com sucesso');
                      console.log('[RPA Overlay] [INJECT] Métodos disponíveis:', {
                        hasCreate: checkResult.hasCreate,
                        hasInit: checkResult.hasInit,
                        hasRemove: typeof window.rpaOverlay.remove === 'function',
                        hasDebug: typeof window.rpaOverlay.debug === 'function'
                      });
                      
                      return { 
                        success: true, 
                        hasCreate: checkResult.hasCreate, 
                        hasInit: checkResult.hasInit,
                        evalError: evalError ? evalError.message : null
                      };
                    } catch (error) {
                      console.error('[RPA Overlay] [INJECT] ERRO ao executar script:', error);
                      console.error('[RPA Overlay] [INJECT] Stack completo:', error.stack);
                      return { success: false, error: safeErrorMessage(error), stack: error.stack };
                    }
                  }, getInjectableScript());
                  
                  if (!injectResult || !injectResult.success) {
                    const errorMsg = injectResult?.error || 'Erro desconhecido ao injetar script';
                    logger.error(`[RPA Overlay] ERRO ao injetar script: ${errorMsg}`);
                    if (injectResult?.stack) {
                      logger.error(`[RPA Overlay] Stack trace: ${injectResult.stack}`);
                    }
                    throw new Error(`Falha ao injetar script do overlay: ${errorMsg}`);
                  }
                  
                  logger.info('[RPA Overlay] Script injetado via page.evaluate() com sucesso');
                  logger.info(`[RPA Overlay] Métodos disponíveis: create=${injectResult.hasCreate}, init=${injectResult.hasInit}`);
                } catch (evalError) {
                  logger.error(`[RPA Overlay] ERRO ao injetar script: ${evalError.message}`);
                  logger.error(`[RPA Overlay] Stack: ${evalError.stack}`);
                  throw evalError;
                }
                
                // Verifica novamente se o script foi injetado corretamente
                const scriptInjected = await page.evaluate(() => {
                  const exists = typeof window.rpaOverlay !== 'undefined';
                  const hasCreate = exists && typeof window.rpaOverlay.create === 'function';
                  const hasInit = exists && typeof window.rpaOverlay.init === 'function';
                  const hasDebug = exists && typeof window.rpaOverlay.debug === 'function';
                  
                  console.log('[RPA Overlay] [VERIFY] Verificação pós-injeção:', {
                    exists,
                    hasCreate,
                    hasInit,
                    hasDebug
                  });
                  
                  return { exists, hasCreate, hasInit, hasDebug };
                });
                
                if (!scriptInjected.exists) {
                  logger.error('[RPA Overlay] ERRO: window.rpaOverlay não foi criado após injeção do script');
                  logger.error('[RPA Overlay] Tentando injetar novamente...');
                  
                  // Tenta injetar novamente
                  try {
                    await page.evaluate((script) => {
                      try {
                        eval(script);
                        console.log('[RPA Overlay] [RETRY] Script re-injetado');
                      } catch (error) {
                        console.error('[RPA Overlay] [RETRY] ERRO:', error);
                      }
                    }, getInjectableScript());
                    
                    // Verifica novamente
                    const retryCheck = await page.evaluate(() => {
                      return typeof window.rpaOverlay !== 'undefined';
                    });
                    
                    if (!retryCheck) {
                      throw new Error('Falha ao injetar script do overlay após tentativa de retry');
                    }
                    logger.info('[RPA Overlay] Script injetado com sucesso após retry');
                  } catch (retryError) {
                    logger.error(`[RPA Overlay] ERRO no retry: ${retryError.message}`);
                    throw new Error('Falha ao injetar script do overlay');
                  }
                } else {
                  logger.info(`[RPA Overlay] ✅ window.rpaOverlay verificado: create=${scriptInjected.hasCreate}, init=${scriptInjected.hasInit}, debug=${scriptInjected.hasDebug}`);
                }
                
                logger.info('[RPA Overlay] Script injetado com sucesso, criando overlay...');
                
                // Aguarda um pouco para garantir que o script foi totalmente carregado
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Verifica novamente se rpaOverlay está disponível antes de chamar init()
                const doubleCheck = await page.evaluate(() => {
                  return {
                    exists: typeof window.rpaOverlay !== 'undefined',
                    hasInit: window.rpaOverlay && typeof window.rpaOverlay.init === 'function',
                    hasCreate: window.rpaOverlay && typeof window.rpaOverlay.create === 'function'
                  };
                });
                logger.info(`[RPA Overlay] Verificação dupla: ${JSON.stringify(doubleCheck)}`);
                
                if (!doubleCheck.exists) {
                  logger.error('[RPA Overlay] ERRO: window.rpaOverlay não existe na verificação dupla!');
                  throw new Error('window.rpaOverlay não está disponível');
                }
                
                // Cria overlay com botões usando init() que lida melhor com timing do DOM
                // Primeiro chama init() para configurar
                logger.info(`[RPA Overlay] Chamando init() com apiBaseUrl=${apiBaseUrl}, executionId=${executionId}`);
                logger.info(`[RPA Overlay] Page URL: ${page.url()}`);
                logger.info(`[RPA Overlay] Page isClosed: ${page.isClosed()}`);
                
                let initResult;
                try {
                  logger.info('[RPA Overlay] Executando page.evaluate() para chamar init()...');
                  // Playwright/Puppeteer só aceita 1 argumento além da função, então envolvemos em um objeto
                  initResult = await page.evaluate(({ apiUrl, execId, token }) => {
                    console.log('[RPA Overlay] [SERVER] Chamando init()...');
                    
                    try {
                      if (window.rpaOverlay && window.rpaOverlay.init) {
                        const result = window.rpaOverlay.init(apiUrl, execId, token);
                        console.log('[RPA Overlay] [SERVER] init() retornou:', result);
                        return { success: true, method: 'init', result: result };
                      } else if (window.rpaOverlay && window.rpaOverlay.create) {
                        console.log('[RPA Overlay] [SERVER] init() não disponível, usando create()...');
                        const result = window.rpaOverlay.create(apiUrl, execId, token);
                        console.log('[RPA Overlay] [SERVER] create() retornou:', result !== null);
                        return { success: true, method: 'create', result: result !== null };
                      } else {
                        console.error('[RPA Overlay] [SERVER] ERRO: window.rpaOverlay não tem init() nem create()');
                        return { success: false, error: 'window.rpaOverlay não tem init() nem create()' };
                      }
                    } catch (error) {
                      console.error('[RPA Overlay] [SERVER] ERRO ao chamar init/create:', error);
                      return { success: false, error: safeErrorMessage(error), stack: error.stack };
                    }
                  }, { apiUrl: apiBaseUrl, execId: executionId, token: authToken });
                  
                  logger.info('[RPA Overlay] page.evaluate() concluído, resultado recebido');
                } catch (evaluateError) {
                  logger.error(`[RPA Overlay] ERRO ao executar page.evaluate() para init(): ${safeErrorMessage(evaluateError)}`);
                  initResult = { success: false, error: safeErrorMessage(evaluateError) };
                }
                
                logger.info(`[RPA Overlay] Resultado do init(): ${JSON.stringify(initResult)}`);
                
                if (!initResult || !initResult.success) {
                  const errorMsg = initResult?.error || 'Resultado indefinido';
                  logger.error(`[RPA Overlay] ERRO ao chamar init(): ${errorMsg}`);
                  
                  // Tenta usar create() diretamente como fallback
                  logger.info('[RPA Overlay] Tentando usar create() diretamente como fallback...');
                  try {
                    const createResult = await page.evaluate(({ apiUrl, execId, token }) => {
                      console.log('[RPA Overlay] [FALLBACK] Tentando create() diretamente...');
                      if (window.rpaOverlay && window.rpaOverlay.create) {
                        console.log('[RPA Overlay] [FALLBACK] Chamando create()...');
                        const result = window.rpaOverlay.create(apiUrl, execId, token);
                        console.log('[RPA Overlay] [FALLBACK] create() retornou:', result !== null);
                        return result !== null;
                      }
                      console.error('[RPA Overlay] [FALLBACK] window.rpaOverlay.create não está disponível');
                      return false;
                    }, { apiUrl: apiBaseUrl, execId: executionId, token: authToken });
                    
                    if (createResult) {
                      logger.info('[RPA Overlay] ✅ create() executado com sucesso como fallback');
                      // Aguarda um pouco para o overlay ser criado
                      await new Promise(resolve => setTimeout(resolve, 500));
                    } else {
                      logger.error('[RPA Overlay] ❌ create() também falhou');
                    }
                  } catch (fallbackError) {
                    logger.error(`[RPA Overlay] ERRO no fallback create(): ${fallbackError.message}`);
                  }
                } else {
                  logger.info(`[RPA Overlay] ✅ init() executado com sucesso usando método: ${initResult.method}`);
                  // Aguarda um pouco para o overlay ser criado após init()
                  await new Promise(resolve => setTimeout(resolve, 300));
                }
                
                // Aguarda um pouco para o overlay ser criado e tenta múltiplas vezes
                let overlayCreated = null;
                let attempts = 0;
                const maxAttempts = 10; // Aumentado para dar mais tempo
                
                while (attempts < maxAttempts && (!overlayCreated || !overlayCreated.success)) {
                  await new Promise(resolve => setTimeout(resolve, 300));
                  attempts++;
                  
                  // Verifica se o overlay foi criado e tenta forçar visibilidade se necessário
                  overlayCreated = await page.evaluate(() => {
                  try {
                    const overlayElement = document.getElementById('rpa-replay-overlay');
                    const boxElement = document.getElementById('rpa-replay-control-box');
                    
                    if (!overlayElement || !boxElement) {
                      return {
                        success: false,
                        overlayExists: !!overlayElement,
                        boxExists: !!boxElement
                      };
                    }
                    
                    // Força visibilidade se necessário
                    const boxComputed = window.getComputedStyle(boxElement);
                    const boxRect = boxElement.getBoundingClientRect();
                    const isVisible = boxRect.width > 0 && boxRect.height > 0 && 
                                     boxComputed.display !== 'none' && 
                                     boxComputed.visibility !== 'hidden' && 
                                     parseFloat(boxComputed.opacity) > 0;
                    
                    if (!isVisible) {
                      console.warn('[RPA Overlay] Overlay não está visível, forçando...');
                      boxElement.style.cssText += ' display: block !important; visibility: visible !important; opacity: 1 !important;';
                      overlayElement.style.cssText += ' display: block !important; visibility: visible !important; opacity: 1 !important;';
                    }
                    
                    // Verifica novamente após forçar
                    const finalRect = boxElement.getBoundingClientRect();
                    const finalComputed = window.getComputedStyle(boxElement);
                    const finalVisible = finalRect.width > 0 && finalRect.height > 0 && 
                                        finalComputed.display !== 'none' && 
                                        finalComputed.visibility !== 'hidden' && 
                                        parseFloat(finalComputed.opacity) > 0;
                    
                    return {
                      success: finalVisible,
                      overlayExists: true,
                      boxExists: true,
                      boxVisible: finalVisible,
                      boxWidth: finalRect.width,
                      boxHeight: finalRect.height
                    };
                  } catch (error) {
                    console.error('[RPA Overlay] ERRO ao verificar overlay:', error);
                    return { success: false, error: safeErrorMessage(error) };
                  }
                });
                  
                  logger.info(`[RPA Overlay] Tentativa ${attempts}/${maxAttempts}: Overlay: ${overlayCreated?.overlayExists}, Box: ${overlayCreated?.boxExists}, Visível: ${overlayCreated?.boxVisible}, Na viewport: ${overlayCreated?.boxInViewport}`);
                  
                  if (overlayCreated?.success) {
                    break;
                  }
                  
                  // Se ainda não foi criado, tenta forçar criação novamente
                  if (attempts === 3 || attempts === 6) {
                    logger.info(`[RPA Overlay] Tentando forçar criação do overlay na tentativa ${attempts}...`);
                    try {
                      await page.evaluate(({ apiUrl, execId, token }) => {
                        if (window.rpaOverlay && window.rpaOverlay.create) {
                          console.log('[RPA Overlay] [FORÇA] Chamando create() novamente...');
                          return window.rpaOverlay.create(apiUrl, execId, token);
                        }
                        return null;
                      }, { apiUrl: apiBaseUrl, execId: executionId, token: authToken });
                    } catch (forceError) {
                      logger.warn(`[RPA Overlay] Erro ao forçar criação: ${forceError.message}`);
                    }
                  }
                }
                
                if (overlayCreated?.success) {
                  logger.info(`[RPA Overlay] ✅ Overlay criado com sucesso após ${attempts} tentativa(s)!`);
                  logger.info(`[RPA Overlay] Detalhes: Overlay: ${overlayCreated.overlayExists}, Box: ${overlayCreated.boxExists}, Visível: ${overlayCreated.boxVisible}`);
                  
                  // Força visibilidade uma última vez para garantir
                  try {
                    await page.evaluate(() => {
                      if (window.rpaOverlay && window.rpaOverlay.forceVisible) {
                        window.rpaOverlay.forceVisible();
                      } else {
                        // Fallback: força manualmente
                        const overlay = document.getElementById('rpa-replay-overlay');
                        const box = document.getElementById('rpa-replay-control-box');
                        if (overlay && box) {
                          overlay.style.cssText = 'position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; background: rgba(0, 0, 0, 0.5) !important; z-index: 2147483647 !important; pointer-events: auto !important; display: block !important; visibility: visible !important; opacity: 1 !important;';
                          box.style.cssText += ' display: block !important; visibility: visible !important; opacity: 1 !important; top: 12px !important; left: 12px !important;';
                        }
                      }
                    });
                    logger.info('[RPA Overlay] Visibilidade forçada novamente');
                  } catch (forceError) {
                    logger.warn(`[RPA Overlay] Erro ao forçar visibilidade: ${forceError.message}`);
                  }
                } else {
                  const errorDetails = overlayCreated?.error || 'Falha ao criar overlay';
                  logger.error(`[RPA Overlay] ❌ ERRO ao criar overlay após ${attempts} tentativas: ${errorDetails}`);
                  logger.error(`[RPA Overlay] Estado final: ${JSON.stringify(overlayCreated, null, 2)}`);
                  
                  // Tenta forçar criação uma última vez
                  try {
                    logger.info('[RPA Overlay] Tentando forçar criação do overlay uma última vez...');
                    await page.evaluate(({ apiUrl, execId, token }) => {
                      if (window.rpaOverlay && window.rpaOverlay.create) {
                        const result = window.rpaOverlay.create(apiUrl, execId, token);
                        if (result && window.rpaOverlay.forceVisible) {
                          setTimeout(() => window.rpaOverlay.forceVisible(), 200);
                        }
                        return result !== null;
                      }
                      return false;
                    }, { apiUrl: apiBaseUrl, execId: executionId, token: authToken });
                    
                    // Aguarda um pouco e verifica novamente
                    await new Promise(resolve => setTimeout(resolve, 500));
                    const finalCheck = await page.evaluate(() => {
                      const overlay = document.getElementById('rpa-replay-overlay');
                      const box = document.getElementById('rpa-replay-control-box');
                      if (overlay && box) {
                        // Força visibilidade
                        overlay.style.cssText = 'position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; background: rgba(0, 0, 0, 0.5) !important; z-index: 2147483647 !important; pointer-events: auto !important; display: block !important; visibility: visible !important; opacity: 1 !important;';
                        box.style.cssText += ' display: block !important; visibility: visible !important; opacity: 1 !important; top: 12px !important; left: 12px !important;';
                        return true;
                      }
                      return false;
                    });
                    
                    if (finalCheck) {
                      logger.info('[RPA Overlay] ✅ Overlay criado após tentativa final!');
                    } else {
                      logger.warn('[RPA Overlay] Continuando execução mesmo sem overlay visível');
                    }
                  } catch (finalError) {
                    logger.warn(`[RPA Overlay] Erro na tentativa final: ${finalError.message}`);
                  }
                }
              } else {
                logger.warn('[RPA Overlay] Página do Puppeteer não encontrada (page é null)');
                logger.warn('[RPA Overlay] runner.executor:', runner.executor ? 'existe' : 'não existe');
                logger.warn('[RPA Overlay] runner:', runner ? 'existe' : 'não existe');
              }
            } catch (overlayError) {
              logger.error('[RPA Overlay] ❌ ERRO ao injetar overlay:', overlayError);
              logger.error('[RPA Overlay] Stack trace:', overlayError.stack);
              logger.error('[RPA Overlay] Mensagem de erro:', overlayError.message);
              // Continua mesmo se o overlay falhar
            }
            
            // Cria uma Promise que será resolvida quando o usuário clicar em "Continuar" ou "Próximo"
            execution.continuePromise = new Promise((resolve) => {
              execution.continueResolve = resolve;
            });
            
            // Aguarda confirmação do usuário
            await execution.continuePromise;
            
            // Remove overlay do navegador
            try {
              const page = runner.executor?.page;
              if (page && !page.isClosed()) {
                await page.evaluate(() => {
                  if (window.rpaOverlay) {
                    window.rpaOverlay.remove();
                  }
                }).catch(() => {
                  // Ignora erro se a página foi fechada durante a execução
                });
              }
            } catch (overlayError) {
              // Ignora erros ao remover overlay (página pode ter sido fechada)
              if (!overlayError.message?.includes('Target page, context or browser has been closed')) {
                logger.warn('Erro ao remover overlay:', overlayError);
              }
            }
            
            // Continua execução
            execution.paused = false;
            execution.status = 'running';
            emitRpaExecutionEvent(execution);
            execution.continuePromise = null;
            execution.continueResolve = null;
            
            // Se continueWithoutPause foi ativado, não pausa mais
            if (execution.continueWithoutPause) {
              addLog('info', `▶️ Continuando execução sem pausas...`, {
                step: stepNumber,
                action: 'continue',
              });
            } else {
              addLog('info', `▶️ Executando próximo passo...`, {
                step: stepNumber,
                action: 'continue',
              });
            }
          } else {
            logger.info(`[RPA Overlay] ⏭️ Condição NÃO atendida - overlay não será injetado (stepByStep=${execution.stepByStep}, continueWithoutPause=${execution.continueWithoutPause})`);
          }

          const stepStartedAtIso = new Date().toISOString();
          const stepStartedAtMs = toTimestamp(stepStartedAtIso);
          let screenshotBefore = null;
          try {
            screenshotBefore = await runner.executor.captureScreenshot(`before-step-${stepNumber}-${Date.now()}`);
          } catch (_) {
            screenshotBefore = null;
          }

          const stepResult = await runner.executor.executeAction(step, mergedData);
          const stepFinishedAtIso = new Date().toISOString();
          const stepFinishedAtMs = toTimestamp(stepFinishedAtIso);
          let screenshotAfter = null;
          try {
            screenshotAfter = await runner.executor.captureScreenshot(`after-step-${stepNumber}-${Date.now()}`);
          } catch (_) {
            screenshotAfter = null;
          }

          let domSnapshot = null;
          try {
            const currentPage = runner.executor?.page;
            if (currentPage && !currentPage.isClosed()) {
              domSnapshot = await currentPage.content();
            }
          } catch (_) {
            domSnapshot = null;
          }

          const consoleLogs = pageConsoleEvents
            .filter((entry) => entry.timestamp >= stepStartedAtMs && entry.timestamp <= stepFinishedAtMs)
            .map((entry) => ({
              level: entry.level,
              text: entry.text,
              at: new Date(entry.timestamp).toISOString(),
            }));

          const networkEvents = pageNetworkEvents
            .filter((entry) => entry.timestamp >= stepStartedAtMs && entry.timestamp <= stepFinishedAtMs)
            .map((entry) => ({
              ...entry,
              at: new Date(entry.timestamp).toISOString(),
            }));

          const normalizedStatus = stepResult.success ? 'success' : 'failed';
          const inputValue = step.value !== undefined ? step.value : (step.input !== undefined ? step.input : null);
          const expectedValue = step.expected !== undefined ? step.expected : (step.condition !== undefined ? step.condition : null);
          const actualValue = stepResult.actual !== undefined ? stepResult.actual : (stepResult.success ? 'ok' : stepResult.error || null);

          results.steps.push({
            id: step.id || `step-${stepNumber}`,
            step: stepNumber,
            index: stepNumber,
            name: step.name || `Passo ${stepNumber}`,
            action: step.type,
            selector: step.selector || step.url || null,
            input: inputValue,
            expected: expectedValue,
            actual: actualValue,
            status: normalizedStatus,
            success: stepResult.success,
            error: stepResult.error || null,
            timestamp: stepStartedAtIso,
            startedAt: stepStartedAtIso,
            finishedAt: stepFinishedAtIso,
            durationMs: Math.max(0, stepFinishedAtMs - stepStartedAtMs),
            screenshotBefore: screenshotBefore || screenshotAfter || null,
            screenshotAfter: screenshotAfter || null,
            domSnapshot,
            consoleLogs,
            networkEvents,
            debug: stepResult.debug || null,
            finalDecision: stepResult.finalDecision || null,
            bugResolution: stepResult.bugResolution || null,
          });

          if (stepResult.success) {
            addLog('success', `✅ Ação ${stepNumber} concluída com sucesso`, {
              step: stepNumber,
              action: step.type,
            });
          } else {
            // Política canônica (core/rpa/stepFailurePolicy): falha em step
            // não-crítico (ex.: wait soft de toast efêmero) é evidência, não
            // erro fatal — vira warning e a execução segue. A prova durável
            // fica nos asserts/landmarks críticos subsequentes.
            const failure = recordStepFailure(results, {
              step,
              stepNumber,
              error: stepResult.error,
              debug: stepResult.debug || null,
            });
            const isCritical = failure.critical;
            addLog(isCritical ? 'error' : 'warning', `${isCritical ? '❌ Ação' : '⚠️ Ação (não-crítica)'} ${stepNumber} falhou: ${stepResult.error}`, {
              step: stepNumber,
              action: step.type,
              error: stepResult.error,
              critical: isCritical,
              // Log detalhado vai no payload do results.steps para não explodir execution.logs,
              // mas deixamos um resumo aqui quando disponível.
              debugSummary: stepResult?.debug?.diagnostics
                ? {
                    kind: stepResult.debug.diagnostics.kind,
                    selectorsTried: stepResult.debug.diagnostics.selectorsTried,
                  }
                : null,
            });

            // Captura screenshot em caso de erro
            if (runner.options.screenshotOnFailure) {
              const screenshot = await runner.executor.captureScreenshot(
                `error-step-${stepNumber}-${Date.now()}`
              );
              if (screenshot) {
                results.screenshots.push(screenshot);
                addLog('warning', `📸 Screenshot capturado: ${screenshot}`, {
                  step: stepNumber,
                  screenshot,
                });
              }
            }

            // Para execução se erro crítico
            if (isCritical) {
              addLog('error', '🛑 Execução interrompida devido a erro crítico', {
                step: stepNumber,
              });
              break;
            }
          }
        }

        results.endTime = new Date().toISOString();
        results.duration = new Date(results.endTime) - new Date(results.startTime);

        try {
          results.reliabilityMetrics = runner.executor.getReliabilityMetrics?.() || null;
        } catch (_) {}

        const failedStepWithDecision = [...results.steps]
          .reverse()
          .find((entry) => entry && entry.success === false && entry.finalDecision);
        if (failedStepWithDecision) {
          results.finalDecision = failedStepWithDecision.finalDecision;
        } else {
          const hasRecoveryPass = results.steps.some(
            (entry) => entry && entry.success && entry.finalDecision === 'PASS_WITH_RECOVERY'
          );
          const hasRetryPass = results.steps.some(
            (entry) => entry && entry.success && entry.finalDecision === 'PASS_WITH_RETRY'
          );
          if (hasRecoveryPass) results.finalDecision = 'PASS_WITH_RECOVERY';
          else if (hasRetryPass) results.finalDecision = 'PASS_WITH_RETRY';
          else results.finalDecision = 'PASS';
        }

        // Adiciona erros coletados da página
        const pageErrors = runner.executor.getErrors();
        const relevantPageErrorsRaw = pageErrors.filter((entry) => !isIgnorablePageNoise(entry));
        // Blip de rede transitório RECUPERADO (mesma URL respondeu < 400
        // depois, via retry da própria aplicação) não é erro crítico de
        // página — é evidência de resiliência. Falha sem recuperação
        // continua reprovando a execução. Os blips ficam registrados em
        // results.transientNetworkRecovery (transparência, não silêncio).
        const recoveredFailedUrls = networkRecoveryTracker.recoveredUrls();
        const pageErrorPartition = partitionPageErrors(relevantPageErrorsRaw, recoveredFailedUrls);
        const relevantPageErrors = pageErrorPartition.relevant;
        const recoveredTransientRequests = pageErrorPartition.recoveredTransient;
        if (recoveredTransientRequests.length > 0) {
          addLog('info', `🔁 ${recoveredTransientRequests.length} falha(s) de rede transitória(s) recuperada(s) via retry da aplicação`, {
            recovered: recoveredTransientRequests.map((entry) => entry.url),
          });
        }
        if (relevantPageErrors.length > 0) {
          results.pageErrors = relevantPageErrors;
          addLog('warning', `⚠️ ${relevantPageErrors.length} erro(s) detectado(s) na página`, {
            errors: relevantPageErrors,
          });

          // Erros críticos de runtime tornam a execução inválida (sem falso positivo).
          results.success = false;
          results.errors.push({
            step: 'page_error',
            action: 'runtime_validation',
            error: `${relevantPageErrors.length} erro(s) críticos detectados na página`,
            details: relevantPageErrors,
          });
        }

        const htmlApiResponses = pageNetworkEvents.filter((event) => {
          const type = String(event?.type || '').toLowerCase();
          const contentType = String(event?.contentType || '').toLowerCase();
          const url = String(event?.url || '');
          const isApiLike = url.includes('/api/') || url.includes('/workspace/');
          return type === 'response' && isApiLike && contentType.includes('text/html');
        });

        if (htmlApiResponses.length > 0) {
          results.success = false;
          results.errors.push({
            step: 'api_contract',
            action: 'validate_json_response',
            error: 'API retornou HTML ao invés de JSON',
            details: htmlApiResponses.slice(0, 5),
          });
          addLog('error', '🛑 API retornou HTML ao invés de JSON em endpoint crítico', {
            htmlResponses: htmlApiResponses.slice(0, 3),
          });
        }

        const criticalConsoleErrorsRaw = pageConsoleEvents.filter(
          (entry) => String(entry?.level || '').toLowerCase() === 'error' && !isIgnorablePageNoise(entry)
        );
        // Assinaturas transitórias ("Failed to fetch", "API temporariamente
        // indisponível") são consequência dos blips recuperados acima: só
        // saem da lista crítica quando houve falha de rede recuperada na
        // mesma execução. Erros funcionais permanecem críticos sempre.
        const consolePartition = partitionConsoleErrors(
          criticalConsoleErrorsRaw,
          recoveredTransientRequests.length > 0,
        );
        const criticalConsoleErrors = consolePartition.relevant;
        if (recoveredTransientRequests.length > 0 || consolePartition.suppressed.length > 0) {
          results.transientNetworkRecovery = {
            recoveredRequests: recoveredTransientRequests.slice(-20),
            suppressedConsoleErrors: consolePartition.suppressed.slice(-20),
          };
        }
        if (criticalConsoleErrors.length > 0) {
          results.success = false;
          results.errors.push({
            step: 'console',
            action: 'critical_console_errors',
            error: `${criticalConsoleErrors.length} erro(s) de console detectados`,
            details: criticalConsoleErrors.slice(-20),
          });
        }

        // Adiciona screenshots
        const screenshots = runner.executor.getScreenshots();
        if (screenshots.length > 0) {
          results.screenshots.push(...screenshots);
        }

        try {
          if (runner.executor?.stopTracing) {
            results.tracePath = await runner.executor.stopTracing(`rpa-trace-${recordingId}-${Date.now()}`);
          }
        } catch (traceStopError) {
          addLog('warning', `⚠️ Falha ao finalizar tracing: ${safeErrorMessage(traceStopError)}`, {
            step: 'trace_stop',
          });
        }

        if (tracingStartWarning) {
          results.traceWarning = tracingStartWarning;
        }

        // Atualiza status
        const finalStatus = results.success ? 'completed' : 'failed';
        execution.status = 'finalizing';
        execution.progress = 100;
        execution.endTime = new Date().toISOString();
        execution.results = results;
        execution.tracePath = results.tracePath || null;
        execution.currentStep = null;
        emitRpaExecutionEvent(execution);

        if (results.success) {
          addLog('success', '🎉 Execução concluída com sucesso!', {
            totalSteps: results.steps.length,
            duration: results.duration,
          });
        } else {
          addLog('error', '❌ Execução concluída com erros', {
            errors: results.errors.length,
          });
        }

        await runner.close();
        addLog('info', '🔒 Browser fechado', { step: 'cleanup' });

        await finalizeArtifacts(executionId, results, results.tracePath || null, finalStatus);
      } catch (stepError) {
        // Erro durante execução dos steps
        addLog('error', `💥 Erro durante execução: ${stepError.message}`, {
          error: stepError.message,
          stack: stepError.stack,
        });
        
        results.success = false;
        results.errors.push({
          step: 'unknown',
          action: 'unknown',
          error: stepError.message,
        });
        
        execution.status = 'failed';
        execution.error = stepError.message;
        execution.endTime = new Date().toISOString();
        execution.tracePath = results.tracePath || null;
        execution.currentStep = null;
        emitRpaExecutionEvent(execution);

        try {
          if (runner.executor?.stopTracing) {
            results.tracePath = await runner.executor.stopTracing(`rpa-trace-${recordingId}-error-${Date.now()}`);
          }
        } catch (_) {
          // noop
        }
        
        try {
          await runner.close();
        } catch (closeError) {
          // Ignora erros ao fechar
        }

        await finalizeArtifacts(executionId, results, results.tracePath || null);
      }
    } catch (error) {
      // Erro geral (init, load, etc)
      addLog('error', `💥 Erro fatal: ${safeErrorMessage(error)}`, {
        error: safeErrorMessage(error),
        stack: error.stack,
      });
      
      execution.status = 'failed';
      execution.error = safeErrorMessage(error);
      execution.endTime = new Date().toISOString();
      execution.currentStep = null;
      emitRpaExecutionEvent(execution);

      // Finaliza trace em aberto e tenta materializar o manifesto da falha.
      let fatalTracePath = null;
      try {
        if (runner.executor?.stopTracing) {
          fatalTracePath = await runner.executor.stopTracing(`rpa-trace-${recordingId}-fatal-${Date.now()}`);
        }
      } catch (_) {
        // noop
      }

      try {
        await runner.close();
      } catch (closeError) {
        // Ignora erros ao fechar
      }

      try {
        execution.artifactPersistence = await persistExecutionArtifacts({
          recording: null,
          recordingId,
          executionId,
          results: null,
          tracePath: fatalTracePath,
          tenantKey: scopedTenantId,
          startedAt: execution.startTime,
          finishedAt: execution.endTime,
          status: execution.status,
        });
      } catch (persistenceError) {
        execution.artifactPersistence = {
          error: safeErrorMessage(persistenceError) || 'rpa_artifact_persistence_failed',
        };
        emitRpaExecutionEvent(execution);
      }
    }
  })();

  return stripInternalFilesystemPaths(redactDeep({
    executionId,
    status: 'running',
    message: 'Execução iniciada',
  }));
}

/**
 * Obtém o status de uma execução.
 */
function getExecutionStatus(executionId, tenantId = 'system') {
  const scopedTenantId = normalizeTenantKey(tenantId);
  const execution = activeExecutions.get(executionId);
  
  if (!execution || execution.tenantId !== scopedTenantId) {
    return null;
  }

  return stripInternalFilesystemPaths(redactDeep({
    id: execution.id,
    tenantId: execution.tenantId,
    recordingId: execution.recordingId,
    status: execution.status,
    progress: execution.progress,
    startTime: execution.startTime,
    endTime: execution.endTime,
    error: execution.error,
    results: execution.results,
    currentStep: execution.currentStep,
    totalSteps: execution.totalSteps,
    logs: execution.logs || [],
    paused: execution.paused || false,
    stepByStep: execution.stepByStep || false,
  }));
}

/**
 * Continua uma execução pausada em modo step-by-step.
 * Se continueWithoutPause for true, desativa o modo step-by-step e continua sem pausas.
 */
async function continueExecution(executionId, continueWithoutPause = false, tenantId = 'system') {
  const scopedTenantId = normalizeTenantKey(tenantId);
  const execution = activeExecutions.get(executionId);
  
  if (!execution || execution.tenantId !== scopedTenantId) {
    return { success: false, error: 'Execução não encontrada' };
  }

  if (!execution.stepByStep) {
    return { success: false, error: 'Execução não está em modo step-by-step' };
  }

  if (!execution.paused) {
    return { success: false, error: 'Execução não está pausada' };
  }

  if (execution.status !== 'paused' && execution.status !== 'running') {
    return { success: false, error: 'Execução já finalizada' };
  }

  // Remove overlay do navegador
  try {
    const page = execution.runner?.executor?.page;
    if (page && !page.isClosed()) {
      await page.evaluate(() => {
        if (window.rpaOverlay) {
          window.rpaOverlay.remove();
        }
      }).catch(() => {
        // Ignora erro se a página foi fechada durante a execução
      });
    }
  } catch (overlayError) {
    // Ignora erros ao remover overlay (página pode ter sido fechada)
    if (!overlayError.message?.includes('Target page, context or browser has been closed')) {
      logger.warn('Erro ao remover overlay ao continuar:', overlayError);
    }
  }

  // Se continuar sem pausas, desativa o modo step-by-step
  if (continueWithoutPause) {
    execution.continueWithoutPause = true;
  }

  // Resolve a Promise que está aguardando continuação
  if (execution.continueResolve) {
    execution.continueResolve();
    return { success: true, message: continueWithoutPause ? 'Execução continuada sem pausas' : 'Execução continuada' };
  }

  return { success: false, error: 'Nenhuma Promise de continuação encontrada' };
}

/**
 * Executa apenas o próximo step e pausa novamente.
 */
function nextStep(executionId, tenantId = 'system') {
  return continueExecution(executionId, false, tenantId);
}

/**
 * Cancela uma execução.
 */
async function cancelExecution(executionId, tenantId = 'system') {
  const scopedTenantId = normalizeTenantKey(tenantId);
  const execution = activeExecutions.get(executionId);
  
  if (!execution || execution.tenantId !== scopedTenantId) {
    return { success: false, error: 'Execução não encontrada' };
  }

  if (execution.status !== 'running' && execution.status !== 'paused') {
    return { success: false, error: 'Execução já finalizada' };
  }

  try {
    // Remove overlay se estiver pausado
    if (execution.paused) {
      try {
        const page = execution.runner?.executor?.page;
        if (page && !page.isClosed()) {
          await page.evaluate(() => {
            if (window.rpaOverlay) {
              window.rpaOverlay.remove();
            }
          }).catch(() => {
            // Ignora erro se a página foi fechada durante a execução
          });
        }
      } catch (overlayError) {
        // Ignora erros ao remover overlay (página pode ter sido fechada)
        if (!overlayError.message?.includes('Target page, context or browser has been closed')) {
          logger.warn('Erro ao remover overlay ao cancelar:', overlayError);
        }
      }
      
      // Resolve promise se estiver aguardando
      if (execution.continueResolve) {
        execution.continueResolve();
      }
    }
    
    await execution.runner.close();
    execution.status = 'cancelled';
    execution.endTime = new Date().toISOString();
    emitRpaExecutionEvent(execution);
    return { success: true };
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
}

/**
 * Remove uma gravação RPA.
 * Procura primeiro em seeds, depois em recordings (mesmo padrão do ActionRecorder).
 * 
 * @param {string} recordingId - ID da gravação a ser removida
 * @returns {{success: boolean, message: string, deletedId?: string}}
 */
function deleteRecording(recordingId, tenantId = 'system') {
  if (!recordingId || typeof recordingId !== 'string' || safeTrim(recordingId) === '') {
    return {
      success: false,
      message: 'ID da gravação é obrigatório',
    };
  }

  const sanitizedId = normalizeJsonName(safeTrim(recordingId));
  const scopedTenantId = normalizeTenantKey(tenantId);
  const writableSeedsDir = getRpaSeedWriteDir(scopedTenantId);
  const legacySearchDirs = getRpaSeedReadDirs(scopedTenantId).filter((dirPath) => dirPath !== writableSeedsDir);
  
  // Tenta primeiro pelo nome do arquivo (caso mais comum)
  let recordingFile = null;
  let foundFileName = null;
  
  if (fs.existsSync(writableSeedsDir)) {
    const seedsFile = path.join(writableSeedsDir, `${sanitizedId}.json`);
    if (fs.existsSync(seedsFile)) {
      recordingFile = seedsFile;
      foundFileName = sanitizedId;
    }
  }

  // Se não encontrou pelo nome do arquivo, procura pelo UUID interno
  if (!recordingFile) {
    const searchDirs = legacySearchDirs.filter((dirPath) => fs.existsSync(dirPath));

    for (const dir of searchDirs) {
      const files = fs.readdirSync(dir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(dir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const recording = JSON.parse(content);
            
            // Verifica se o ID interno corresponde (comparação case-insensitive e sem espaços)
            const recordingIdNormalized = recording.id ? safeTrimLower(recording.id) : '';
            const searchIdNormalized = safeTrimLower(sanitizedId);
            const originalIdNormalized = safeTrimLower(recordingId);
            
            if ((recordingIdNormalized === searchIdNormalized || recordingIdNormalized === originalIdNormalized)
                && belongsToTenant(recording, scopedTenantId)) {
              recordingFile = filePath;
              foundFileName = file.replace('.json', '');
              break;
            }
          } catch (error) {
            // Ignora arquivos inválidos e continua procurando
            continue;
          }
        }
      }
      if (recordingFile) break;
    }
    
  }

  // Verifica se o arquivo existe antes de tentar ler seu conteúdo.
  if (!recordingFile) {
    return {
      success: false,
      message: `Gravação "${sanitizedId}" não encontrada`,
    };
  }

  try {
    const candidate = JSON.parse(fs.readFileSync(recordingFile, 'utf8'));
    if (!belongsToTenant(candidate, scopedTenantId)) {
      return { success: false, message: `Gravação "${sanitizedId}" não encontrada` };
    }
  } catch (error) {
    return { success: false, message: `Gravação "${sanitizedId}" inválida` };
  }

  try {
    // Remove o arquivo
    fs.unlinkSync(recordingFile);
    
    return {
      success: true,
      deletedId: foundFileName || sanitizedId,
      message: `Gravação "${foundFileName || sanitizedId}" removida com sucesso`,
    };
  } catch (err) {
    logger.error('Erro ao remover gravação:', err);
    return {
      success: false,
      message: `Erro ao remover gravação: ${safeErrorMessage(err)}`,
    };
  }
}

/**
 * Limpa execuções antigas (mais de 1 hora).
 */
function cleanupOldExecutions() {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  
  for (const [id, execution] of activeExecutions.entries()) {
    const startTime = new Date(execution.startTime).getTime();
    if (startTime < oneHourAgo) {
      activeExecutions.delete(id);
    }
  }
}

// Limpa execuções antigas a cada 30 minutos
const cleanupInterval = setInterval(cleanupOldExecutions, 30 * 60 * 1000);
if (typeof cleanupInterval.unref === 'function') {
  cleanupInterval.unref();
}

/**
 * Inicia gravação manual de seed RPA.
 * 
 * @param {string} seedName - Nome do seed a ser gravado
 * @param {string} initialUrl - URL inicial para navegação
 * @returns {Promise<{success: boolean, recordingId: string, message: string}>}
 */
function activeRecordingKey(recordingId, tenantId) {
  return `${normalizeTenantKey(tenantId)}\u0000${normalizeJsonName(recordingId)}`;
}

async function startManualRecording(seedName, initialUrl, tenantId = 'system') {
  try {
    if (!seedName || safeTrim(seedName) === '') {
      return {
        success: false,
        error: 'Nome do seed é obrigatório',
      };
    }

    const scopedTenantId = normalizeTenantKey(tenantId);
    const safeSeedName = normalizeJsonName(seedName);
    const mapKey = activeRecordingKey(safeSeedName, scopedTenantId);

    // Verifica se já existe uma gravação com esse nome no mesmo tenant
    if (activeRecordings.has(mapKey)) {
      return {
        success: false,
        error: `Gravação "${seedName}" já está em andamento`,
      };
    }

    const { RpaRecorder } = require('../../core/rpa/recorder/rpaRecorder');
    const rpaConfig = require('../../core/rpa/rpaConfig');
    
    const url = initialUrl || rpaConfig.urls.frontend;
    
    const recorder = new RpaRecorder({
      mode: 'record',
      seedName: safeSeedName,
      tenantId: scopedTenantId,
    });

    await recorder.init();
    await recorder.startRecording(url);

    // Armazena o recorder
    activeRecordings.set(mapKey, {
      recorder,
      seedName: safeSeedName,
      tenantId: scopedTenantId,
      startTime: new Date().toISOString(),
      status: 'recording',
    });

    logger.info('Gravação manual iniciada', { seedName: safeSeedName, tenantId: scopedTenantId, url });
    emitRecordingWsEvent(safeSeedName, 'recording', scopedTenantId, { seedName: safeSeedName });

    return {
      success: true,
      recordingId: safeSeedName,
      message: `Gravação "${safeSeedName}" iniciada. Interaja com o navegador e chame /rpa/record/stop quando terminar.`,
    };
  } catch (error) {
    logger.error('Erro ao iniciar gravação manual', { error: safeErrorMessage(error), stack: error.stack });
    return {
      success: false,
      error: safeErrorMessage(error) || 'Erro ao iniciar gravação manual',
    };
  }
}

/**
 * Para gravação manual e salva o seed.
 * 
 * @param {string} recordingId - ID da gravação (nome do seed)
 * @returns {Promise<{success: boolean, seedPath?: string, replayPath?: string, message?: string, error?: string}>}
 */
async function stopManualRecording(recordingId, tenantId = 'system') {
  try {
    if (!recordingId || safeTrim(recordingId) === '') {
      return {
        success: false,
        error: 'ID da gravação é obrigatório',
      };
    }

    const scopedTenantId = normalizeTenantKey(tenantId);
    const safeRecordingId = normalizeJsonName(recordingId);
    const mapKey = activeRecordingKey(safeRecordingId, scopedTenantId);
    const recording = activeRecordings.get(mapKey);
    if (!recording) {
      return {
        success: false,
        error: `Gravação "${recordingId}" não encontrada ou já foi finalizada`,
      };
    }

    const { recorder } = recording;
    
    // Para e salva a gravação
    const result = await recorder.stopRecording();
    await recorder.close();

    // Remove da lista de gravações ativas
    activeRecordings.delete(mapKey);

    logger.info('Gravação manual finalizada', {
      recordingId: safeRecordingId,
      tenantId: scopedTenantId,
      seedId: result.seedId || safeRecordingId,
      replayId: result.replayId || null,
    });
    emitRecordingWsEvent(safeRecordingId, 'completed', scopedTenantId, {
      seedId: result.seedId || safeRecordingId,
      replayId: result.replayId || null,
    });

    return {
      success: true,
      seedId: result.seedId,
      replayId: result.replayId || null,
      message: `Gravação "${recordingId}" salva com sucesso`,
    };
  } catch (error) {
    logger.error('Erro ao parar gravação manual', { error: safeErrorMessage(error), stack: error.stack });
    
    // Remove da lista mesmo em caso de erro
    const safeTenantId = (() => { try { return normalizeTenantKey(tenantId); } catch (_) { return null; } })();
    const safeId = (() => { try { return normalizeJsonName(recordingId); } catch (_) { return null; } })();
    if (safeTenantId && safeId) activeRecordings.delete(activeRecordingKey(safeId, safeTenantId));
    if (safeTenantId) emitRecordingWsEvent(safeId || String(recordingId), 'failed', safeTenantId, { error: safeErrorMessage(error) || null });
    
    return {
      success: false,
      error: safeErrorMessage(error) || 'Erro ao parar gravação manual',
    };
  }
}

/**
 * Obtém status de uma gravação manual em andamento.
 * 
 * @param {string} recordingId - ID da gravação
 * @returns {{success: boolean, status?: string, seedName?: string, startTime?: string, error?: string}}
 */
function getRecordingStatus(recordingId, tenantId = 'system') {
  try {
    if (!recordingId || safeTrim(recordingId) === '') {
      return {
        success: false,
        error: 'ID da gravação é obrigatório',
      };
    }

    const scopedTenantId = normalizeTenantKey(tenantId);
    const safeRecordingId = normalizeJsonName(recordingId);
    const recording = activeRecordings.get(activeRecordingKey(safeRecordingId, scopedTenantId));
    if (!recording) {
      return {
        success: false,
        error: `Gravação "${recordingId}" não encontrada`,
      };
    }

    return {
      success: true,
      status: recording.status,
      seedName: recording.seedName,
      startTime: recording.startTime,
    };
  } catch (error) {
    logger.error('Erro ao obter status da gravação', { error: safeErrorMessage(error) });
    return {
      success: false,
      error: safeErrorMessage(error) || 'Erro ao obter status da gravação',
    };
  }
}

module.exports = {
  listRecordings,
  executeRecording,
  getExecutionStatus,
  cancelExecution,
  continueExecution,
  nextStep,
  deleteRecording,
  startManualRecording,
  stopManualRecording,
  getRecordingStatus,
  rpaExecutionEvents,
};
