const { RpaTestRunner } = require('../../tests/rpa/rpaTestRunner');
const { ActionRecorder } = require('../../tests/rpa/actionRecorder');
const { INJECTABLE_SCRIPT } = require('../../tests/rpa/overlayInjector');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

// Armazena execuções em andamento
const activeExecutions = new Map();

/**
 * Lista todas as gravações RPA disponíveis.
 */
function listRecordings() {
  // Tenta múltiplos caminhos possíveis
  const possiblePaths = [
    path.join(__dirname, '../../tests/rpa/recordings'), // De api/services
    path.join(process.cwd(), 'tests/rpa/recordings'), // Do diretório raiz do projeto
    path.resolve(__dirname, '../../tests/rpa/recordings'), // Resolvido
  ];
  
  let recordingsDir = null;
  for (const dirPath of possiblePaths) {
    if (fs.existsSync(dirPath)) {
      recordingsDir = dirPath;
      break;
    }
  }
  
  if (!recordingsDir) {
    console.error('❌ Diretório de gravações não encontrado. Tentou:', possiblePaths);
    return [];
  }

  const files = fs.readdirSync(recordingsDir);
  const recordings = [];

  for (const file of files) {
    if (file.endsWith('.json')) {
      try {
        const filePath = path.join(recordingsDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const recording = JSON.parse(content);
        
        recordings.push({
          id: recording.id || file.replace('.json', ''),
          name: recording.name || file.replace('.json', ''),
          description: recording.description,
          version: recording.version,
          steps: recording.steps || [],
          data: recording.data || {},
        });
      } catch (error) {
        // Ignora arquivos inválidos
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`⚠️ Erro ao ler gravação ${file}:`, error.message);
        }
      }
    }
  }

  // Usa console.log ao invés de logger.debug para evitar manter processo aberto
  if (process.env.NODE_ENV !== 'production') {
    console.log(`📋 Total de gravações encontradas: ${recordings.length}`);
  }
  return recordings;
}

/**
 * Executa uma gravação RPA com configurações personalizadas.
 * 
 * @param {string} recordingId - ID da gravação
 * @param {Object} config - Configurações de execução
 * @param {Object} data - Dados adicionais
 * @returns {Promise<Object>} Resultado da execução
 */
async function executeRecording(recordingId, config = {}, data = {}, authToken = null) {
  const executionId = `rpa-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Cria runner com configurações
  // headless sempre false para sempre mostrar o navegador
  const runner = new RpaTestRunner({
    headless: false, // SEMPRE false - navegador sempre visível
    slowMo: config.slowMo || 500,
    timeout: config.timeout || 30000,
    screenshotOnFailure: config.screenshotOnFailure !== undefined ? config.screenshotOnFailure : true,
    devtools: config.devtools !== undefined ? config.devtools : true,
  });

  // Armazena execução
  const execution = {
    id: executionId,
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

  // Função para adicionar log
  const addLog = (level, message, details = {}) => {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level, // 'info', 'success', 'error', 'warning'
      message,
      ...details,
    };
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
        recording = ActionRecorder.load(recordingId);
      } catch (error) {
        // Se não encontrar pelo ID, tenta encontrar pelo nome do arquivo
        // Lista todas as gravações e procura pelo ID
        const recordings = listRecordings();
        const foundRecording = recordings.find(r => r.id === recordingId);
        if (foundRecording) {
          // Tenta carregar pelo nome do arquivo (que pode ser diferente do ID)
          // O nome do arquivo geralmente é baseado no nome da gravação ou ID
          const recordingsDir = path.join(__dirname, '../../tests/rpa/recordings');
          const files = fs.readdirSync(recordingsDir);
          let recordingFile = null;
          
          for (const file of files) {
            if (file.endsWith('.json')) {
              try {
                const filePath = path.join(recordingsDir, file);
                const content = fs.readFileSync(filePath, 'utf8');
                const rec = JSON.parse(content);
                if (rec.id === recordingId) {
                  recordingFile = file.replace('.json', '');
                  break;
                }
              } catch (e) {
                // Continua procurando
              }
            }
          }
          
          if (recordingFile) {
            recording = ActionRecorder.load(recordingFile);
          } else {
            throw new Error(`Gravação não encontrada: ${recordingId}`);
          }
        } else {
          throw error;
        }
      }
      execution.totalSteps = recording.steps?.length || 0;
      addLog('info', `📝 Total de ações: ${execution.totalSteps}`, { step: 'init' });

      // Mescla dados
      const mergedData = {
        ...recording.data,
        ...data,
      };

      // Executa playback com logging customizado
      addLog('info', '▶️ Iniciando execução das ações...', { step: 'playback' });
      
      // Executa manualmente para capturar logs
      const results = {
        recordingId: recording.id,
        recordingName: recording.name,
        success: true,
        steps: [],
        errors: [],
        screenshots: [],
        startTime: new Date().toISOString(),
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
            stepDetails = `URL: ${step.url}`;
          } else if (step.selector) {
            stepDetails = `Seletor: ${step.selector}`;
            if (step.value && !step.value.includes('***')) {
              stepDetails += ` | Valor: ${step.value.substring(0, 50)}${step.value.length > 50 ? '...' : ''}`;
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
            addLog('info', `⏸️ Pausado - Aguardando confirmação para continuar...`, {
              step: stepNumber,
              action: 'pause',
            });
            
            // Injeta overlay no navegador
            try {
              const page = runner.executor?.page;
              logger.info(`[RPA Overlay] Página do Puppeteer: ${page ? 'disponível' : 'NÃO disponível'}`);
              if (page) {
                // Obtém URL base da API (assume que está rodando na mesma origem ou usa variável de ambiente)
                const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
                
                logger.info(`[RPA Overlay] Injetando overlay para execução ${executionId}`);
                
                // Configura listener para capturar logs do console do navegador
                // Remove listeners anteriores para evitar duplicação
                page.removeAllListeners('console');
                const consoleHandler = (msg) => {
                  const text = msg.text();
                  const type = msg.type();
                  // Captura todos os logs do overlay e também erros
                  if (text.includes('[RPA Overlay]') || text.includes('rpaOverlay') || type === 'error') {
                    logger.info(`[RPA Overlay] [BROWSER CONSOLE ${type.toUpperCase()}] ${text}`);
                  }
                };
                page.on('console', consoleHandler);
                
                // Captura erros da página também
                page.on('pageerror', error => {
                  logger.error(`[RPA Overlay] [PAGE ERROR] ${error.message}`);
                });
                
                // Testa se o listener está funcionando
                await page.evaluate(() => {
                  console.log('[RPA Overlay] [TEST] Teste de listener do console');
                });
                logger.info('[RPA Overlay] Listener de console configurado e testado');
                
                // Injeta script do overlay usando uma função para garantir execução correta
                try {
                  await page.evaluate((script) => {
                    // Executa o script como código
                    eval(script);
                  }, INJECTABLE_SCRIPT);
                  logger.info('[RPA Overlay] Script injetado via page.evaluate()');
                } catch (evalError) {
                  logger.error(`[RPA Overlay] ERRO ao injetar script: ${evalError.message}`);
                  throw evalError;
                }
                
                // Verifica se o script foi injetado corretamente
                const scriptInjected = await page.evaluate(() => {
                  return typeof window.rpaOverlay !== 'undefined';
                });
                
                if (!scriptInjected) {
                  logger.error('[RPA Overlay] ERRO: window.rpaOverlay não foi criado após injeção do script');
                  throw new Error('Falha ao injetar script do overlay');
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
                    console.log('[RPA Overlay] [SERVER] ========== INÍCIO page.evaluate() ==========');
                    console.log('[RPA Overlay] [SERVER] Tentando chamar init()...', {
                      hasRpaOverlay: typeof window.rpaOverlay !== 'undefined',
                      hasInit: window.rpaOverlay && typeof window.rpaOverlay.init === 'function',
                      hasCreate: window.rpaOverlay && typeof window.rpaOverlay.create === 'function',
                      apiUrl: apiUrl,
                      execId: execId,
                      readyState: document.readyState,
                      hasBody: !!document.body
                    });
                    
                    try {
                      if (window.rpaOverlay && window.rpaOverlay.init) {
                        console.log('[RPA Overlay] [SERVER] Chamando window.rpaOverlay.init()...');
                        const result = window.rpaOverlay.init(apiUrl, execId, token);
                        console.log('[RPA Overlay] [SERVER] init() retornou:', result);
                        return { success: true, method: 'init', result: result };
                      } else if (window.rpaOverlay && window.rpaOverlay.create) {
                        console.log('[RPA Overlay] [SERVER] init() não disponível, usando create()...');
                        const result = window.rpaOverlay.create(apiUrl, execId, token);
                        console.log('[RPA Overlay] [SERVER] create() retornou:', result);
                        return { success: true, method: 'create', result: result };
                      } else {
                        console.error('[RPA Overlay] [SERVER] ERRO: window.rpaOverlay não tem init() nem create()');
                        return { success: false, error: 'window.rpaOverlay não tem init() nem create()' };
                      }
                    } catch (error) {
                      console.error('[RPA Overlay] [SERVER] ERRO ao chamar init/create:', error);
                      return { success: false, error: error.message, stack: error.stack };
                    }
                  }, { apiUrl: apiBaseUrl, execId: executionId, token: authToken });
                  
                  logger.info('[RPA Overlay] page.evaluate() concluído, resultado recebido');
                } catch (evaluateError) {
                  logger.error(`[RPA Overlay] ERRO ao executar page.evaluate() para init(): ${evaluateError.message}`);
                  initResult = { success: false, error: evaluateError.message };
                }
                
                logger.info(`[RPA Overlay] Resultado do init(): ${JSON.stringify(initResult)}`);
                
                if (!initResult || !initResult.success) {
                  const errorMsg = initResult?.error || 'Resultado indefinido';
                  logger.error(`[RPA Overlay] ERRO ao chamar init(): ${errorMsg}`);
                  
                  // Tenta usar create() diretamente como fallback
                  logger.info('[RPA Overlay] Tentando usar create() diretamente como fallback...');
                  try {
                    const createResult = await page.evaluate(({ apiUrl, execId, token }) => {
                      if (window.rpaOverlay && window.rpaOverlay.create) {
                        return window.rpaOverlay.create(apiUrl, execId, token);
                      }
                      return null;
                    }, { apiUrl: apiBaseUrl, execId: executionId, token: authToken });
                    
                    if (createResult) {
                      logger.info('[RPA Overlay] ✅ create() executado com sucesso como fallback');
                    } else {
                      logger.error('[RPA Overlay] ❌ create() também falhou');
                    }
                  } catch (fallbackError) {
                    logger.error(`[RPA Overlay] ERRO no fallback create(): ${fallbackError.message}`);
                  }
                } else {
                  logger.info(`[RPA Overlay] ✅ init() executado com sucesso usando método: ${initResult.method}`);
                }
                
                // Aguarda um pouco para o overlay ser criado e tenta múltiplas vezes
                let overlayCreated = null;
                let attempts = 0;
                const maxAttempts = 5;
                
                while (attempts < maxAttempts && (!overlayCreated || !overlayCreated.success)) {
                  await new Promise(resolve => setTimeout(resolve, 500));
                  attempts++;
                  
                  // Verifica se o overlay foi criado
                  overlayCreated = await page.evaluate(() => {
                  try {
                    const overlayElement = document.getElementById('rpa-replay-overlay');
                    const boxElement = document.getElementById('rpa-replay-control-box');
                    
                    console.log('[RPA Overlay] Verificação do overlay:', {
                      overlayElementExists: !!overlayElement,
                      boxElementExists: !!boxElement,
                      viewportWidth: window.innerWidth,
                      viewportHeight: window.innerHeight,
                      readyState: document.readyState
                    });
                    
                    if (boxElement) {
                      const rect = boxElement.getBoundingClientRect();
                      console.log('[RPA Overlay] Posição da caixa:', {
                        top: boxElement.style.top,
                        left: boxElement.style.left,
                        width: rect.width,
                        height: rect.height,
                        display: window.getComputedStyle(boxElement).display,
                        visibility: window.getComputedStyle(boxElement).visibility,
                        opacity: window.getComputedStyle(boxElement).opacity,
                        zIndex: window.getComputedStyle(boxElement).zIndex
                      });
                    }
                    
                    return {
                      success: !!overlayElement && !!boxElement,
                      overlayExists: !!overlayElement,
                      boxExists: !!boxElement
                    };
                  } catch (error) {
                    console.error('[RPA Overlay] ERRO ao verificar overlay:', error);
                    return { success: false, error: error.message };
                  }
                });
                  
                  logger.info(`[RPA Overlay] Tentativa ${attempts}/${maxAttempts}: Overlay: ${overlayCreated?.overlayExists}, Box: ${overlayCreated?.boxExists}`);
                  
                  if (overlayCreated?.success) {
                    break;
                  }
                }
                
                if (overlayCreated?.success) {
                  logger.info(`[RPA Overlay] ✅ Overlay criado com sucesso após ${attempts} tentativa(s)! Overlay: ${overlayCreated.overlayExists}, Box: ${overlayCreated.boxExists}`);
                } else {
                  logger.error(`[RPA Overlay] ERRO ao criar overlay: ${overlayCreated.error}`);
                  throw new Error(overlayCreated.error || 'Falha ao criar overlay');
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

          const stepResult = await runner.executor.executeAction(step, mergedData);

          results.steps.push({
            step: stepNumber,
            action: step.type,
            selector: step.selector || step.url || null,
            success: stepResult.success,
            error: stepResult.error || null,
            timestamp: new Date().toISOString(),
          });

          if (stepResult.success) {
            addLog('success', `✅ Ação ${stepNumber} concluída com sucesso`, {
              step: stepNumber,
              action: step.type,
            });
          } else {
            addLog('error', `❌ Ação ${stepNumber} falhou: ${stepResult.error}`, {
              step: stepNumber,
              action: step.type,
              error: stepResult.error,
            });
            
            results.success = false;
            results.errors.push({
              step: stepNumber,
              action: step.type,
              error: stepResult.error,
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
            if (step.critical !== false) {
              addLog('error', '🛑 Execução interrompida devido a erro crítico', {
                step: stepNumber,
              });
              break;
            }
          }
        }

        results.endTime = new Date().toISOString();
        results.duration = new Date(results.endTime) - new Date(results.startTime);

        // Adiciona erros coletados da página
        const pageErrors = runner.executor.getErrors();
        if (pageErrors.length > 0) {
          results.pageErrors = pageErrors;
          addLog('warning', `⚠️ ${pageErrors.length} erro(s) detectado(s) na página`, {
            errors: pageErrors,
          });
        }

        // Adiciona screenshots
        const screenshots = runner.executor.getScreenshots();
        if (screenshots.length > 0) {
          results.screenshots.push(...screenshots);
        }

        // Atualiza status
        execution.status = results.success ? 'completed' : 'failed';
        execution.progress = 100;
        execution.endTime = new Date().toISOString();
        execution.results = results;
        execution.currentStep = null;

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
        execution.currentStep = null;
        
        try {
          await runner.close();
        } catch (closeError) {
          // Ignora erros ao fechar
        }
      }
    } catch (error) {
      // Erro geral (init, load, etc)
      addLog('error', `💥 Erro fatal: ${error.message}`, {
        error: error.message,
        stack: error.stack,
      });
      
      execution.status = 'failed';
      execution.error = error.message;
      execution.endTime = new Date().toISOString();
      execution.currentStep = null;
      
      try {
        await runner.close();
      } catch (closeError) {
        // Ignora erros ao fechar
      }
    }
  })();

  return {
    executionId,
    status: 'running',
    message: 'Execução iniciada',
  };
}

/**
 * Obtém o status de uma execução.
 */
function getExecutionStatus(executionId) {
  const execution = activeExecutions.get(executionId);
  
  if (!execution) {
    return null;
  }

  return {
    id: execution.id,
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
  };
}

/**
 * Continua uma execução pausada em modo step-by-step.
 * Se continueWithoutPause for true, desativa o modo step-by-step e continua sem pausas.
 */
async function continueExecution(executionId, continueWithoutPause = false) {
  const execution = activeExecutions.get(executionId);
  
  if (!execution) {
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
function nextStep(executionId) {
  return continueExecution(executionId, false);
}

/**
 * Cancela uma execução.
 */
async function cancelExecution(executionId) {
  const execution = activeExecutions.get(executionId);
  
  if (!execution) {
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
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
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
setInterval(cleanupOldExecutions, 30 * 60 * 1000);

module.exports = {
  listRecordings,
  executeRecording,
  getExecutionStatus,
  cancelExecution,
  continueExecution,
  nextStep,
};

