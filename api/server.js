/**
 * Servidor HTTP mínimo para expor a engine via API.
 *
 * Importante:
 * - Não depende de nenhuma biblioteca externa (sem Express).
 * - Exponde endpoints de health/version + CRUD de fluxos, validação,
 *   simulação e replay.
 * - Fluxos são persistidos no banco de dados PostgreSQL.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./utils/config');
const { validateFlow, addUiMessage } = require('../engine/validator');
const { simulateFlow } = require('../engine/flowSimulation');
const { buildConversationReplay } = require('../engine/replay');
const { verifyWebhook, sendTextMessage } = require('./services/whatsappService');
const { processWhatsAppMessage } = require('./services/messageProcessor');
const { initializeAiProviders, generateAiResponse } = require('./services/aiProviderService');
const logger = require('./utils/logger');
const {
  login: authLogin,
  logout: authLogout,
  logoutAllSessions,
  validateToken,
  loginWithRpaToken,
  createAgent,
  listAgents,
  getAgent,
  updateAgent,
  deleteAgent,
  inviteUser,
  acceptInvitation,
  requestPasswordReset,
  resetPassword,
} = require('./services/authService');
const {
  createTenant,
  updateTenant,
  listTenants,
  getTenant,
  deleteTenant,
  suspendTenant,
  reactivateTenant,
  changePlan,
  getTenantUsage,
  getTenantContext,
  updateTenantContext,
} = require('./services/tenantService');
const { logAction, queryLogs, getAuditStats } = require('./services/auditService');
const {
  isSuperAdmin,
  listAllTenants,
  getTenantMetrics,
  impersonateUser,
  blockTenant,
  unblockTenant,
  adjustTenantPlan,
} = require('./services/superAdminService');
const {
  getOnboardingStatus,
  completeOnboardingStep,
  startOnboarding,
  createInitialTemplates,
  completeOnboarding,
} = require('./services/onboardingService');
const { requireAuth, requirePermission } = require('./middleware/auth');
const { tenantRateLimitMiddleware } = require('./middleware/tenantRateLimit');
const { canAccessTicket, canModifyTicket } = require('./services/rbacService');
const {
  listQueue,
  listQueues,
  createQueue,
  deleteQueue,
  getQueueInfo,
  getTicket,
  getTicketBySession,
  assignTicket,
  closeTicket,
  listAllTickets,
  startAutoCleanup,
  getMetrics,
  addAgentMessage,
  markMessagesAsRead,
  getTicketMessages,
} = require('./services/queueService');
const {
  listQuickReplies,
  getQuickReply,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  incrementUsage,
  searchByContext,
  getCategories,
  getTags,
} = require('./services/quickRepliesService');
const { generateFlowFromDescription } = require('./services/flowGeneratorService');
const { validateGenerationContract } = require('./utils/contractValidator');
const { orchestrateGeneration } = require('./services/generationOrchestrator');
const { registerGeneration, generateAuditReport } = require('./services/auditService');
const { generateAndValidate } = require('./services/generate-and-validate');
const { clearLimitersCache, clearRedisRateLimitKeys } = require('../infra/rate-limit');
const { executeRpaFlowPipeline, previewRpaFlowPipeline } = require('./services/rpaFlowPipelineService');
const { generateChatbotFlow } = require('../engine/ai/generateChatbotFlow');
const { generateRpaTest } = require('../engine/ai/generateRpaTest');
const rpaDependencyResolver = require('../engine/rpaDependencyResolver');
const {
  listDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  addAgentToDepartment,
  removeAgentFromDepartment,
  getDepartmentsByAgent,
  getDepartmentByQueue,
} = require('./services/departmentsService');
const {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  startCampaign,
  pauseCampaign,
  resumeCampaign,
} = require('./services/bulkMessagingService');
const {
  getGeneralMetrics,
  getAgentMetrics,
  getDepartmentMetrics,
  getQueueMetrics,
  getTrendMetrics,
  getAllMetrics,
} = require('./services/analyticsService');
const {
  exportTicketsCSV,
  exportMetricsCSV,
  exportConversationsJSON,
  exportFullReportJSON,
} = require('./services/exportService');
const {
  suggestResponse,
  rewriteMessage,
  rewriteMultipleMessages,
} = require('./services/aiSuggestionService');
const {
  transcribeAudio,
  processWhatsAppAudio,
} = require('./services/audioTranscriptionService');
const {
  verifyMessengerWebhook,
  sendMessengerMessage,
  processMessengerMessage,
  sendMessengerButtons,
} = require('./services/messengerService');
const {
  verifyInstagramWebhook,
  sendInstagramMessage,
  processInstagramMessage,
  sendInstagramMedia,
} = require('./services/instagramService');
const channelGatewayService = require('./services/channelGatewayService');
const { startWorker: startOutboundWorker } = require('./services/outboundQueueService');
const { listConversations: listChannelConversations, listConversationMessages } = require('./services/channelConversationService');
const { takeOver: takeOverTicket, returnToBot: returnTicketToBot, startAutoReturnToBot } = require('./services/handoverService');
const { autoAssign: autoAssignTicket, startAssignmentWorker } = require('./services/assignmentService');
const queueDefinitionService = require('./services/queueDefinitionService');
const closeReasonsService = require('./services/closeReasonsService');
const ticketInsightService = require('./services/ticketInsightService');
const flowTemplateMarketplaceService = require('./services/flowTemplateMarketplaceService');
const {
  getAllTags,
  getAllCategories,
  filterTickets,
  addTagToTicket,
  removeTagFromTicket,
  setTicketCategory,
  getSegmentationStats,
} = require('./services/segmentationService');
const {
  sendTemplateMessage,
  listTemplates,
  validateTemplate,
  createTemplate,
  getTemplate,
} = require('./services/whatsappTemplateService');
const {
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  reindexDocument,
  reindexAllNotIndexed,
  getDocumentsStats,
} = require('./services/ragDocumentsService');
const ragService = require('./services/ragService');
const { parseMultipartFormData } = require('./utils/multipartParser');
const {
  scrapeUrl,
  scrapeUrls,
} = require('./services/webScrapingService');
const {
  getAIConfig,
  saveAIConfig,
  saveAICredentials,
  getDecryptedAPIKey,
} = require('./services/tenantAIService');
const { connect, isConnected } = require('./db/index');
const { defineRelationships } = require('./db/models');
const {
  getLatestQaResult,
  getQaHistory,
  getQaResultById,
  runQaManual,
  getQaStatistics,
} = require('./services/qaService');
const {
  createWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  triggerWebhooks,
  getAvailableEvents,
} = require('./services/webhookService');
const {
  initializeWebSocket,
  emitEvent,
} = require('./services/websocketService');
const { validateInput, ValidationError, schemas } = require('./utils/inputValidator');

const port = Number(config.get('api.port', 3000));

// Caminho do arquivo de persistência
const dataDir = path.join(__dirname, 'data');
const configFile = path.join(dataDir, 'config.json');

/**
 * Detecta qual gerenciador de processo está sendo usado (PM2, nodemon, ou nenhum).
 * @returns {{name: string, hasProcessManager: boolean, details: object}}
 */
function detectProcessManager() {
  // Detecta PM2
  if (process.env.PM2_HOME || process.env.PM2_INSTANCE_ID !== undefined) {
    return {
      name: 'PM2',
      hasProcessManager: true,
      details: {
        pm2Home: process.env.PM2_HOME,
        instanceId: process.env.PM2_INSTANCE_ID,
        method: 'environment_variables',
      },
    };
  }

  // Detecta nodemon (verifica se o processo pai é nodemon)
  const parentProcess = process.env.nodemon || '';
  if (parentProcess || process.argv.some(arg => arg.includes('nodemon'))) {
    return {
      name: 'nodemon',
      hasProcessManager: true,
      details: {
        method: 'process_detection',
      },
    };
  }

  // Verifica processo pai (pode ser PM2 ou nodemon)
  try {
    const ppid = process.ppid;
    if (ppid) {
      // Tenta ler o nome do processo pai (limitado, mas útil)
      // Em sistemas Unix, podemos verificar via /proc
      if (process.platform !== 'win32') {
        try {
          const execSync = require('child_process').execSync;
          const parentCmd = execSync(`ps -p ${ppid} -o comm=`, { encoding: 'utf8', timeout: 1000 }).trim();
          if (parentCmd.includes('pm2') || parentCmd.includes('PM2')) {
            return {
              name: 'PM2',
              hasProcessManager: true,
              details: {
                parentProcess: parentCmd,
                method: 'parent_process_detection',
              },
            };
          }
          if (parentCmd.includes('nodemon')) {
            return {
              name: 'nodemon',
              hasProcessManager: true,
              details: {
                parentProcess: parentCmd,
                method: 'parent_process_detection',
              },
            };
          }
        } catch (err) {
          // Ignora erros ao detectar processo pai
        }
      }
    }
  } catch (err) {
    // Ignora erros
  }

  // Nenhum gerenciador detectado
  return {
    name: 'none',
    hasProcessManager: false,
    details: {
      method: 'none_detected',
      note: 'Servidor rodando diretamente com node',
    },
  };
}

/**
 * Storage em memória com persistência em arquivo JSON.
 * - flows: FlowDefinition por id
 * - sessionEvents: EngineEvent[] por sessionId
 */
const flows = new Map();
const sessionEvents = new Map();

// Limpeza periódica de sessionEvents para evitar memory leak
// Remove sessões mais antigas que 24 horas
const SESSION_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hora
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 horas

// Debounce para evitar muitas escritas em disco
let saveSessionEventsTimeout = null;
const SAVE_DEBOUNCE_MS = 2000; // Salva após 2 segundos de inatividade

/**
 * Salva conversas (sessionEvents).
 * @deprecated Migrado para banco de dados PostgreSQL. Esta função não faz mais nada.
 */
function saveSessionEventsToFile() {
  // Migrado para banco de dados - não salva mais em arquivo JSON
  logger.debug('[Conversations] saveSessionEventsToFile chamado mas ignorado (dados estão no banco de dados)');
}

/**
 * Salva conversas imediatamente.
 * @deprecated Migrado para banco de dados PostgreSQL. Esta função não faz mais nada.
 */
function saveSessionEventsToFileImmediate() {
  // Migrado para banco de dados - não salva mais em arquivo JSON
  logger.debug('[Conversations] saveSessionEventsToFileImmediate chamado mas ignorado (dados estão no banco de dados)');
}

/**
 * Carrega conversas (sessionEvents).
 * @deprecated Migrado para banco de dados PostgreSQL. Esta função não faz mais nada.
 */
function loadSessionEventsFromFile() {
  // Migrado para banco de dados - não carrega mais de arquivo JSON
  logger.debug('[Conversations] loadSessionEventsFromFile chamado mas ignorado (dados estão no banco de dados)');
  // Dados agora estão no banco de dados PostgreSQL
}

/**
 * Limpa sessões antigas do cache de eventos.
 */
function cleanupOldSessions() {
  const now = Date.now();
  let cleaned = 0;
  for (const [sessionId, events] of sessionEvents.entries()) {
    if (Array.isArray(events) && events.length > 0) {
      // Pega o timestamp do primeiro evento (mais antigo)
      const firstEvent = events[0];
      if (firstEvent && firstEvent.timestamp) {
        // Converte timestamp ISO string para número
        const eventTimestamp = new Date(firstEvent.timestamp).getTime();
        if (!Number.isNaN(eventTimestamp)) {
          const sessionAge = now - eventTimestamp;
          if (sessionAge > SESSION_MAX_AGE) {
            sessionEvents.delete(sessionId);
            cleaned++;
          }
        }
      }
    }
  }
  if (cleaned > 0) {
    logger.debug(`Limpeza de sessões: ${cleaned} sessão(ões) antiga(s) removida(s)`);
    // Salva imediatamente após limpar (sem debounce)
    saveSessionEventsToFileImmediate();
  }
}

// Inicia limpeza periódica de sessões
setInterval(cleanupOldSessions, SESSION_CLEANUP_INTERVAL);

// Inicia limpeza periódica de tickets fechados antigos
// Remove tickets fechados com mais de 7 dias, a cada 1 hora
const TICKET_CLEANUP_INTERVAL_HOURS = Number(config.get('api.ticketCleanup.intervalHours', 1));
const TICKET_MAX_AGE_DAYS = Number(config.get('api.ticketCleanup.maxAgeDays', 7));
startAutoCleanup(TICKET_CLEANUP_INTERVAL_HOURS, TICKET_MAX_AGE_DAYS);

// Inicialização de providers de IA movida para startInitialization()
// para garantir que o banco de dados esteja conectado antes de carregar configurações

/**
 * Inicializa o sistema criando o tenant 'system' e o usuário 'systemadmin' se não existirem.
 * Esta função é executada automaticamente na primeira inicialização do servidor.
 */
async function initializeSystemAdmin() {
  // Log imediato para debug
  console.log('[Init] initializeSystemAdmin() chamada');
  logger.info('[Init] initializeSystemAdmin() chamada');
  console.log('[Init] ========================================');
  logger.info('[Init] ========================================');
  console.log('[Init] Iniciando initializeSystemAdmin()...');
  logger.info('[Init] Iniciando initializeSystemAdmin()...');
  try {
    // Garante que o diretório de dados existe
    ensureDataDir();
    
    // Aguarda um pequeno delay para garantir que os módulos foram totalmente carregados
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Recarrega dados para garantir que temos a versão mais recente
    const authService = require('./services/authService');
    const tenantService = require('./services/tenantService');
    // Dados agora estão no banco de dados PostgreSQL
    
    // Aguarda mais um pouco para garantir que os dados foram carregados
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verifica se o tenant 'system' existe
    logger.info('[Init] Verificando tenant "system"...');
    let systemTenant = getTenant('system');
    
    if (!systemTenant) {
      logger.info('[Init] Tenant "system" não existe. Criando...');
      const tenantResult = await createTenant({
        id: 'system',
        name: 'Sistema',
        site: 'https://sistema.com',
        ramo_atividade: 'Sistema de Administração',
        objetivo: 'Administração global do sistema',
        plan: 'enterprise',
      });

      if (!tenantResult.success) {
        logger.error('[Init] ❌ Erro ao criar tenant system:', tenantResult.error);
        logger.error('[Init] Detalhes:', JSON.stringify(tenantResult, null, 2));
        // Tenta continuar mesmo se houver erro ao criar tenant
      } else {
        systemTenant = tenantResult.tenant;
        logger.info('[Init] ✅ Tenant "system" criado com sucesso');
      }
    } else {
      logger.info('[Init] ✅ Tenant "system" já existe');
    }

    // Verifica se o agente 'systemadmin' existe no PostgreSQL
    logger.info('[Init] Verificando se systemadmin existe no PostgreSQL...');
    
    // Usa PostgreSQL diretamente ao invés de arquivos JSON
    const { getSequelize } = require('./db/sequelize');
    const { User, TenantUser, Tenant } = require('./db/models');
    const crypto = require('crypto');
    
    // Função para hash de senha (mesma lógica do authService)
    function hashPassword(password, salt = null) {
      const actualSalt = salt || crypto.randomBytes(16).toString('hex');
      const hash = crypto
        .createHash('sha256')
        .update(password + actualSalt)
        .digest('hex');
      return { hash, salt: actualSalt };
    }
    
    const sequelize = getSequelize();
    if (!sequelize) {
      logger.error('[Init] ❌ Sequelize não está disponível. Não é possível verificar/criar systemadmin.');
      return;
    }
    
    try {
      const UserModel = User();
      const TenantUserModel = TenantUser();
      const TenantModel = Tenant();
      
      // Busca usuário pelo email
      const existingUser = await UserModel.findOne({
        where: { email: 'systemadmin@exemplo.com' },
      });
      
      let systemAdminExists = false;
      let userId = null;
      
      if (existingUser) {
        userId = existingUser.id;
        // Verifica se está associado ao tenant system
        const tenantUser = await TenantUserModel.findOne({
          where: {
            user_id: userId,
            tenant_id: systemTenant?.id || (await TenantModel.findOne({ where: { tenant_key: 'system' } }))?.id,
          },
        });
        systemAdminExists = !!tenantUser;
      }
      
      if (!systemAdminExists) {
        logger.info('[Init] systemadmin não encontrado. Criando no PostgreSQL...');
        
        // Garante que o tenant 'system' existe
        if (!systemTenant) {
          logger.warn('[Init] ⚠️  Tenant "system" não existe. Tentando criar novamente...');
          const tenantResult = await createTenant({
            id: 'system',
            name: 'Sistema',
            site: 'https://sistema.com',
            ramo_atividade: 'Sistema de Administração',
            objetivo: 'Administração global do sistema',
            plan: 'enterprise',
          });
          if (tenantResult.success) {
            systemTenant = tenantResult.tenant;
            logger.info('[Init] ✅ Tenant "system" criado na segunda tentativa');
          } else {
            logger.error('[Init] ❌ Falha ao criar tenant "system" na segunda tentativa:', tenantResult.error);
            return;
          }
        }
        
        // Busca o tenant system no banco para obter o ID UUID
        const systemTenantDb = await TenantModel.findOne({
          where: { tenant_key: 'system' },
        });
        
        if (!systemTenantDb) {
          logger.error('[Init] ❌ Tenant "system" não encontrado no banco de dados');
          return;
        }
        
        // Cria ou atualiza o usuário
        const { hash, salt } = hashPassword('Admin123!');
        const passwordHash = hash; // O banco usa password_hash, não precisa do salt separado
        
        if (!userId) {
          // Cria novo usuário
          const newUser = await UserModel.create({
            name: 'Administrador do Sistema',
            email: 'systemadmin@exemplo.com',
            password_hash: passwordHash,
            is_superadmin: true,
          });
          userId = newUser.id;
          logger.info('[Init] ✅ Usuário systemadmin criado no PostgreSQL');
        }
        
        // Cria ou atualiza a associação com o tenant system
        await TenantUserModel.findOrCreate({
          where: {
            user_id: userId,
            tenant_id: systemTenantDb.id,
          },
          defaults: {
            user_id: userId,
            tenant_id: systemTenantDb.id,
            role: 'owner',
          },
        });
        
        logger.info('[Init] ✅ Super Admin criado/atualizado no PostgreSQL!');
        logger.info('[Init] 📋 Credenciais: email=systemadmin@exemplo.com, password=Admin123!');
      } else {
        logger.info('[Init] ✅ Super Admin já existe no PostgreSQL');
      }
    } catch (error) {
      logger.error('[Init] ❌ Erro ao verificar/criar systemadmin no PostgreSQL:', error);
      logger.error('[Init] Stack:', error.stack);
    }
    logger.info('[Init] ========================================');
  } catch (error) {
    logger.error('[Init] ❌❌❌ ERRO CRÍTICO ao inicializar systemadmin ❌❌❌');
    logger.error('[Init] Erro:', error);
    logger.error('[Init] Stack:', error.stack);
    logger.error('[Init] ========================================');
    // Não interrompe a inicialização do servidor se houver erro
  }
}

// ---------------------------------------------------------------------------
// Persistência em arquivo JSON
// ---------------------------------------------------------------------------

/**
 * Garante que o diretório de dados existe.
 */
function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Carrega fluxos.
 * @deprecated Migrado para banco de dados PostgreSQL. Esta função não faz mais nada.
 */
function loadFlowsFromFile() {
  // Migrado para banco de dados - não carrega mais de arquivo JSON
  logger.debug('loadFlowsFromFile chamado mas ignorado (dados estão no banco de dados)');
  // Dados agora estão no banco de dados PostgreSQL
}

/**
 * Salva todos os fluxos.
 * @deprecated Migrado para banco de dados PostgreSQL. Esta função não faz mais nada.
 */
function saveFlowsToFile() {
  // Migrado para banco de dados - não salva mais em arquivo JSON
  logger.debug('saveFlowsToFile chamado mas ignorado (dados estão no banco de dados)');
}

/**
 * Carrega fluxos do PostgreSQL para o cache em memória.
 * (DB é fonte de verdade; Map é cache para acesso rápido).
 */
async function loadFlowsFromDb() {
  try {
    const { getSequelize } = require('./db/sequelize');
    const sequelize = getSequelize();
    if (!sequelize) return;

    const { Flow } = require('./db/models');
    const FlowModel = Flow();
    const rows = await FlowModel.findAll();

    flows.clear();
    for (const row of rows) {
      const data = row.data && typeof row.data === 'object' ? row.data : {};
      const flowObj = { ...data, id: row.id };
      if (row.tenant_key && !flowObj.tenantId) flowObj.tenantId = row.tenant_key;
      if (row.name && !flowObj.name) flowObj.name = row.name;
      flows.set(row.id, flowObj);
    }

    logger.info('[Flows] Cache inicializado do PostgreSQL', { count: flows.size });
  } catch (err) {
    logger.warn('[Flows] Falha ao carregar fluxos do PostgreSQL', { error: err.message });
  }
}

function persistFlowBestEffort(flow) {
  try {
    const { getSequelize } = require('./db/sequelize');
    const sequelize = getSequelize();
    if (!sequelize) return;
    const { Flow } = require('./db/models');
    const FlowModel = Flow();

    setImmediate(() => {
      const now = new Date();
      FlowModel.findByPk(flow.id).then((existing) => {
        const payload = {
          id: flow.id,
          tenant_key: flow.tenantId || null,
          name: flow.name || null,
          data: flow,
          updated_at: now,
        };
        if (existing) {
          return existing.update(payload);
        }
        return FlowModel.create({ ...payload, created_at: now });
      }).catch((err) => {
        logger.warn('[Flows] Falha ao persistir flow no PostgreSQL', { flowId: flow.id, error: err.message });
      });
    });
  } catch (err) {
    // best-effort
  }
}

function deleteFlowBestEffort(flowId) {
  try {
    const { getSequelize } = require('./db/sequelize');
    const sequelize = getSequelize();
    if (!sequelize) return;
    const { Flow } = require('./db/models');
    const FlowModel = Flow();

    setImmediate(() => {
      FlowModel.destroy({ where: { id: flowId } }).catch((err) => {
        logger.warn('[Flows] Falha ao remover flow no PostgreSQL', { flowId, error: err.message });
      });
    });
  } catch (err) {
    // best-effort
  }
}

// Dados agora são carregados do banco de dados PostgreSQL - não precisa carregar de arquivo
// loadFlowsFromFile(); // Deprecated - dados agora estão no banco
// loadSessionEventsFromFile(); // Deprecated - dados agora estão no banco

// ---------------------------------------------------------------------------
// Helpers HTTP básicos
// ---------------------------------------------------------------------------

/**
 * Faz o parse do body JSON da requisição.
 * Inclui limite de tamanho para prevenir DoS.
 *
 * @param {http.IncomingMessage} req
 * @param {number} [maxSize=10*1024*1024] - Tamanho máximo em bytes (padrão: 10MB)
 * @returns {Promise<any>}
 */
function parseJsonBody(req, maxSize = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    let totalSize = 0;

    req.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        req.destroy();
        reject(new Error(`Body excede o tamanho máximo de ${maxSize} bytes`));
        return;
      }
      data += chunk;
    });

    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        const json = JSON.parse(data);
        resolve(json);
      } catch (err) {
        reject(err);
      }
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Adiciona headers CORS e de segurança à resposta.
 *
 * @param {http.ServerResponse} res
 */
function setCorsHeaders(res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-Id');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 horas
  
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

/**
 * Envia resposta JSON com status code.
 *
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {any} body
 */
function sendJson(res, status, body) {
  setCorsHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Responde 404 padrão.
 *
 * @param {http.ServerResponse} res
 */
function notFound(res) {
  sendJson(res, 404, { error: 'not_found' });
}

/**
 * Responde 400 padrão.
 *
 * @param {http.ServerResponse} res
 * @param {string} msg
 */
function badRequest(res, msg) {
  sendJson(res, 400, { error: 'bad_request', message: msg });
}

// ---------------------------------------------------------------------------
// Helpers de domínio (FlowDefinition)
// ---------------------------------------------------------------------------

/**
 * Valida a estrutura básica de um FlowDefinition antes de processar.
 *
 * @param {any} rawFlow
 * @returns {{ valid: boolean, error?: string, flow?: any }}
 */
function validateFlowStructure(rawFlow) {
  if (!rawFlow || typeof rawFlow !== 'object') {
    return { valid: false, error: 'Flow deve ser um objeto' };
  }

  if (!Array.isArray(rawFlow.nodes)) {
    return { valid: false, error: 'Flow deve ter um campo "nodes" do tipo array' };
  }

  if (rawFlow.nodes.length === 0) {
    return { valid: false, error: 'Flow deve ter pelo menos um nó' };
  }

  if (rawFlow.nodes.length > 1000) {
    return { valid: false, error: 'Flow excede o limite máximo de 1000 nós' };
  }

  // Validação de tamanho do JSON (limite de 10MB)
  const jsonString = JSON.stringify(rawFlow);
  if (jsonString.length > 10 * 1024 * 1024) {
    return { valid: false, error: 'Flow excede o tamanho máximo de 10MB' };
  }

  return { valid: true, flow: rawFlow };
}

/**
 * Garante metadados mínimos de FlowDefinition.
 *
 * - tenantId: sempre presente (deve ser fornecido)
 * - id: se não vier, gera um id simples com timestamp
 * - name: valor default amigável
 * - version: default 1 se não vier ou não for número
 *
 * @param {any} rawFlow
 * @returns {any}
 */
function ensureFlowHasMeta(rawFlow, tenantId = null) {
  const flow = rawFlow && typeof rawFlow === 'object' ? { ...rawFlow } : {};

  if (!flow.tenantId || typeof flow.tenantId !== 'string' || flow.tenantId.trim() === '') {
    // Tenant deve ser fornecido - não há mais fallback para tenant-demo
    // Se não vier, será definido pelo middleware de validação via req.tenantId
    flow.tenantId = tenantId || null;
  } else {
    // Sanitiza tenantId
    flow.tenantId = flow.tenantId.trim();
    if (flow.tenantId.length > 100) {
      flow.tenantId = flow.tenantId.substring(0, 100);
    }
  }

  if (!flow.id || typeof flow.id !== 'string' || flow.id.trim() === '') {
    const baseName = flow.name && typeof flow.name === 'string' ? flow.name : 'flow';
    flow.id = `${baseName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}-${Date.now()}`;
  } else {
    // Sanitiza id
    flow.id = flow.id.trim();
    if (flow.id.length > 200) {
      flow.id = flow.id.substring(0, 200);
    }
  }

  if (!flow.name || typeof flow.name !== 'string' || flow.name.trim() === '') {
    flow.name = 'Fluxo sem nome';
  } else {
    // Sanitiza name
    flow.name = flow.name.trim();
    if (flow.name.length > 500) {
      flow.name = flow.name.substring(0, 500);
    }
  }

  if (typeof flow.version !== 'number' || Number.isNaN(flow.version) || flow.version < 1 || !Number.isInteger(flow.version)) {
    flow.version = 1;
  } else if (flow.version > 999999) {
    // Limite razoável de versão
    flow.version = 999999;
  }

  return flow;
}

// ---------------------------------------------------------------------------
// Roteador principal
// ---------------------------------------------------------------------------

/**
 * Valida se o Content-Type é application/json para requisições com body.
 *
 * @param {http.IncomingMessage} req
 * @returns {boolean}
 */
function hasJsonContentType(req) {
  const contentType = req.headers['content-type'] || '';
  return contentType.toLowerCase().includes('application/json');
}

/**
 * Handler principal da API.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function requestHandler(req, res) {
  const method = (req.method || 'GET').toUpperCase();

  // Handle CORS preflight requests
  if (method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // URL é relativa; usamos base fictícia apenas para parse
  const url = new URL(req.url || '/', 'http://localhost');
  const { pathname } = url;

  // Log de debug para todas as requisições GET a /metrics
  if (method === 'GET' && pathname.startsWith('/metrics')) {
    logger.debug(`[Server] Requisição GET recebida: ${pathname}`);
  }

  // Healthcheck básico (mantido para compatibilidade)
  if (method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  // Liveness probe: verifica se o processo está vivo
  // Sempre retorna 200 se o processo está rodando (não consulta DB)
  if (method === 'GET' && pathname === '/health/live') {
    const uptimeSec = Math.floor(process.uptime());
    sendJson(res, 200, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSec
    });
    return;
  }

  // Healthcheck do banco de dados (detalhado)
  if (method === 'GET' && pathname === '/health/db') {
    try {
      const dbHealth = require('./db/health');
      
      // Verifica conexão
      const connectionCheck = await dbHealth.checkDbConnection();
      
      // Obtém informações do banco
      const dbInfo = dbHealth.getDbInfo();
      
      // Obtém status das migrations
      const migrationStatus = await dbHealth.getMigrationStatusSafe();
      
      // Obtém status do sync
      const syncStatus = dbHealth.getSyncStatus();
      
      // Obtém ambiente
      const environment = dbHealth.getEnvironment();
      
      if (!connectionCheck.ok) {
        sendJson(res, 503, {
          status: 'fail',
          environment,
          latencyMs: connectionCheck.latencyMs,
          db: dbInfo,
          migrations: {
            applied: migrationStatus.appliedCount,
            pending: migrationStatus.pendingCount,
            pendingNames: migrationStatus.pendingNames
          },
          sync: syncStatus,
          errorMessage: connectionCheck.errorMessage,
          timestamp: new Date().toISOString()
        });
        return;
      }
      
      sendJson(res, 200, {
        status: 'ok',
        environment,
        latencyMs: connectionCheck.latencyMs,
        db: dbInfo,
        migrations: {
          applied: migrationStatus.appliedCount,
          pending: migrationStatus.pendingCount,
          pendingNames: migrationStatus.pendingNames
        },
        sync: syncStatus,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      logger.error('[Health DB] Erro ao verificar banco de dados:', err);
      const dbHealth = require('./db/health');
      const dbInfo = dbHealth.getDbInfo();
      const environment = dbHealth.getEnvironment();
      
      sendJson(res, 503, {
        status: 'fail',
        environment,
        latencyMs: 0,
        db: dbInfo,
        migrations: {
          applied: 0,
          pending: 0,
          pendingNames: []
        },
        errorMessage: err.message || 'Erro ao verificar banco de dados',
        timestamp: new Date().toISOString()
      });
    }
    return;
  }

  // Readiness probe: verifica se o serviço está pronto para receber tráfego
  // Retorna 200 apenas se: DB ok E sem migrations pendentes
  if (method === 'GET' && pathname === '/health/ready') {
    try {
      const dbHealth = require('./db/health');
      
      // Verifica conexão
      const connectionCheck = await dbHealth.checkDbConnection();
      
      if (!connectionCheck.ok) {
        sendJson(res, 503, {
          status: 'not_ready',
          reason: 'db_connection_failed',
          timestamp: new Date().toISOString()
        });
        return;
      }
      
      // Verifica migrations pendentes
      const migrationStatus = await dbHealth.getMigrationStatusSafe();
      
      if (migrationStatus.pendingCount > 0) {
        sendJson(res, 503, {
          status: 'not_ready',
          reason: 'migrations_pending',
          pending: migrationStatus.pendingCount,
          pendingNames: migrationStatus.pendingNames,
          timestamp: new Date().toISOString()
        });
        return;
      }
      
      // Tudo ok: DB conectado e sem migrations pendentes
      sendJson(res, 200, {
        status: 'ready',
        db: 'ok',
        migrationsPending: 0,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      logger.error('[Health Ready] Erro ao verificar readiness:', err);
      sendJson(res, 503, {
        status: 'not_ready',
        reason: 'check_failed',
        error: err.message || 'Erro ao verificar readiness',
        timestamp: new Date().toISOString()
      });
    }
    return;
  }

  // Versão / ambiente
  if (method === 'GET' && pathname === '/version') {
    sendJson(res, 200, {
      name: 'chatbot-engine-api',
      env: config.get('nodeEnv', 'development'),
    });
    return;
  }

  // GET /system/status - Dashboard de status de todos os serviços
  if (method === 'GET' && pathname === '/system/status') {
    try {
      const { checkServicesStatus } = require('./services/systemStatusService');
      const status = await checkServicesStatus();
      sendJson(res, 200, status);
    } catch (err) {
      logger.error('Erro ao verificar status dos serviços:', err);
      sendJson(res, 500, { 
        error: 'internal_error', 
        message: err.message || 'Erro ao verificar status dos serviços' 
      });
    }
    return;
  }

  // GET /system/websocket - Informações detalhadas sobre conexões WebSocket
  if (method === 'GET' && pathname === '/system/websocket') {
    try {
      const { getConnectionsInfo } = require('./services/websocketService');
      const info = getConnectionsInfo();
      sendJson(res, 200, info);
    } catch (err) {
      logger.error('Erro ao obter informações de WebSocket:', err);
      sendJson(res, 500, { 
        error: 'internal_error', 
        message: err.message || 'Erro ao obter informações de WebSocket' 
      });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Rate Limiting por Tenant
  // -----------------------------------------------------------------------
  // Aplica rate limiting por tenant em todas as rotas (exceto rotas públicas acima)
  // Rotas públicas: /health, /version, /system/status, /system/websocket, OPTIONS
  // Rotas de autenticação não exigem tenant_id (login, reset, convites)
  // Rotas de super-admin não exigem tenant_id (mas exigem autenticação super-admin)
  const publicRoutes = ['/health', '/health/db', '/version', '/system/status', '/system/websocket'];
  const authRoutes = ['/auth/login', '/auth/rpa/login', '/auth/accept-invitation', '/auth/request-password-reset', '/auth/reset-password'];
  const superAdminRoutes = pathname.startsWith('/super-admin');
  
  const isPublicRoute = publicRoutes.some(route => pathname === route || pathname.startsWith(route + '/'));
  const isAuthRoute = authRoutes.some(route => pathname === route || pathname.startsWith(route + '/'));
  const isSuperAdminRoute = superAdminRoutes;
  
  // Aplica rate limiting apenas em rotas que não são públicas, de auth ou super-admin
  // Em desenvolvimento, rate limit é desativado
  const nodeEnv = config.get('nodeEnv', process.env.NODE_ENV || 'development');
  const isDevelopment = nodeEnv === 'development';
  
  if (!isPublicRoute && !isAuthRoute && !isSuperAdminRoute && method !== 'OPTIONS' && !isDevelopment) {
    try {
      const allowed = await tenantRateLimitMiddleware(req, res, sendJson);
      if (!allowed) {
        return; // Rate limit excedido, resposta já foi enviada
      }
    } catch (err) {
      // Se rate limiting falhar, permite mas loga
      logger.error('[Server] Erro no rate limiting por tenant', {
        pathname,
        method,
        error: err.message,
      });
      // Continua processamento (fail-open em caso de erro)
    }
  } else if (isDevelopment && !isPublicRoute && !isAuthRoute && !isSuperAdminRoute && method !== 'OPTIONS') {
    // Em desenvolvimento, loga mas não bloqueia
    logger.debug('[Server] Rate limit desativado em desenvolvimento', { pathname, method });
  }

  // -----------------------------------------------------------------------
  // Admin - Limpeza de Cache de Rate Limiting
  // -----------------------------------------------------------------------

  // POST /admin/rate-limit/clear-cache - Limpa cache de limiters em memória
  if (method === 'POST' && pathname === '/admin/rate-limit/clear-cache') {
    try {
      clearLimitersCache();
      logger.info('[Admin] Cache de rate limiters limpo via endpoint');
      sendJson(res, 200, {
        success: true,
        message: 'Cache de rate limiters limpo com sucesso',
      });
    } catch (err) {
      logger.error('[Admin] Erro ao limpar cache de rate limiters:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao limpar cache',
      });
    }
    return;
  }

  // POST /admin/rate-limit/clear - Limpa chaves de rate limiting no Redis (apenas desenvolvimento)
  if (method === 'POST' && pathname === '/admin/rate-limit/clear') {
    // Apenas em desenvolvimento
    const nodeEnv = config.get('nodeEnv', 'development');
    if (nodeEnv !== 'development') {
      sendJson(res, 403, {
        error: 'forbidden',
        message: 'Este endpoint está disponível apenas em desenvolvimento',
      });
      return;
    }

    try {
      const deletedCount = await clearRedisRateLimitKeys();
      logger.info('[Admin] Rate limit do Redis limpo via endpoint', { deletedCount });
      sendJson(res, 200, {
        success: true,
        message: `Rate limit limpo com sucesso. ${deletedCount} chave(s) removida(s).`,
        deletedCount,
      });
    } catch (err) {
      logger.error('[Admin] Erro ao limpar rate limit do Redis:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao limpar rate limit',
      });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Observabilidade - Channel Health
  // -----------------------------------------------------------------------

  // GET /system/channel-health - Saúde de canais (por tenant)
  if (method === 'GET' && pathname === '/system/channel-health') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const windowMinutes = parseInt(urlObj.searchParams.get('windowMinutes') || '10', 10);
      const { getChannelHealth } = require('./services/channelHealthService');
      const health = await getChannelHealth({ tenantId: req.tenantId, windowMinutes });
      sendJson(res, 200, health);
    } catch (err) {
      logger.error('Erro ao obter channel-health:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Autenticação de Agentes
  // -----------------------------------------------------------------------

  // POST /auth/login - Login de agente
  if (method === 'POST' && pathname === '/auth/login') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      
      // Validação robusta de input
      let validated;
      try {
        validated = validateInput(body, schemas.login);
      } catch (err) {
        if (err instanceof ValidationError) {
          badRequest(res, err.message);
          return;
        }
        throw err;
      }

      const { username, password } = validated;

      // Extrai IP e User-Agent
      const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';

      const result = await authLogin(username, password, ipAddress, userAgent);

      if (!result.success) {
        sendJson(res, 401, { error: 'authentication_failed', message: result.error });
        return;
      }

      // Registra ação de auditoria
      logAction({
        agentId: result.agent.id,
        username: result.agent.username,
        action: 'login',
        resource: 'auth',
        ipAddress,
        userAgent,
      });

      sendJson(res, 200, {
        token: result.token,
        agent: result.agent,
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao fazer login:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao processar login' });
      }
    }
    return;
  }

  // POST /auth/rpa/login - Login RPA usando token exclusivo
  if (method === 'POST' && pathname === '/auth/rpa/login') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const rpaToken = body.token || body.rpaToken;

      if (!rpaToken) {
        badRequest(res, 'Token RPA é obrigatório');
        return;
      }

      // Extrai IP e User-Agent
      const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'RPA-Automation';

      const result = await loginWithRpaToken(rpaToken, ipAddress, userAgent);

      if (!result.success) {
        sendJson(res, 401, { error: 'rpa_authentication_failed', message: result.error });
        return;
      }

      // Registra ação de auditoria
      logAction({
        agentId: result.agent.id,
        username: result.agent.username,
        action: 'rpa_login',
        resource: 'auth',
        ipAddress,
        userAgent,
      });

      sendJson(res, 200, {
        token: result.token,
        agent: result.agent,
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao fazer login RPA:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao processar login RPA' });
      }
    }
    return;
  }

  // GET /auth/rpa/token - Obtém ou gera token RPA
  if (method === 'GET' && pathname === '/auth/rpa/token') {
    try {
      const rpaTokenManager = require('../../tests/rpa/utils/rpaTokenManager');
      const token = rpaTokenManager.getOrCreateRpaToken();
      
      sendJson(res, 200, {
        token,
        message: 'Token RPA obtido com sucesso',
        note: 'Use este token para autenticação RPA via POST /auth/rpa/login',
      });
    } catch (err) {
      logger.error('Erro ao obter token RPA:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter token RPA' });
    }
    return;
  }

  // POST /auth/logout - Logout de agente
  if (method === 'POST' && pathname === '/auth/logout') {
    const token = req.headers.authorization?.replace('Bearer ', '') || null;

    if (!token) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Token não fornecido' });
      return;
    }

    const validation = validateToken(token);
    if (!validation.valid) {
      // Mesmo com token inválido, tenta fazer logout (idempotente)
      authLogout(token);
      sendJson(res, 200, { success: true, message: 'Logout realizado' });
      return;
    }

    // Registra ação de auditoria
    logAction({
      agentId: validation.agent.id,
      username: validation.agent.username,
      action: 'logout',
      resource: 'auth',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    const result = authLogout(token);
    sendJson(res, 200, { success: result.success });
    return;
  }

  // POST /auth/logout-all - Logout de todas as sessões do agente
  if (method === 'POST' && pathname === '/auth/logout-all') {
    const token = req.headers.authorization?.replace('Bearer ', '') || null;

    if (!token) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Token não fornecido' });
      return;
    }

    const validation = validateToken(token);
    if (!validation.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: validation.error || 'Token inválido' });
      return;
    }

    // Registra ação de auditoria
    logAction({
      agentId: validation.agent.id,
      username: validation.agent.username,
      action: 'logout_all',
      resource: 'auth',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    const removed = logoutAllSessions(validation.agent.id);
    sendJson(res, 200, { 
      success: true, 
      message: `Todas as sessões foram encerradas`,
      sessionsRemoved: removed 
    });
    return;
  }

  // GET /auth/me - Obtém informações do agente autenticado
  if (method === 'GET' && pathname === '/auth/me') {
    const token = req.headers.authorization?.replace('Bearer ', '') || null;

    if (!token) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Token não fornecido' });
      return;
    }

    const validation = validateToken(token);
    if (!validation.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: validation.error || 'Token inválido' });
      return;
    }

    sendJson(res, 200, { agent: validation.agent });
    return;
  }

  // ============================================
  // TENANTS ENDPOINTS
  // ============================================

  // POST /tenants - Cria novo tenant (requer autenticação admin)
  if (method === 'POST' && pathname === '/tenants') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    // Apenas super-admin pode criar tenants
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas super-admins podem criar tenants' });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      
      // Valida entrada usando schema
      const { validateInput, schemas } = require('./utils/inputValidator');
      try {
        validateInput(body, schemas.createTenant);
      } catch (validationError) {
        badRequest(res, validationError.message || 'Dados inválidos');
        return;
      }
      
      const result = createTenant(body);

      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      // Registra ação de auditoria
      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'tenant_create',
        resource: 'tenant',
        resourceId: result.tenant.id,
        details: { tenantName: result.tenant.name },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 201, { tenant: result.tenant });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar tenant:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // POST /tenants/generate-by-ai - Gera tenant por IA
  if (method === 'POST' && pathname === '/tenants/generate-by-ai') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    // Apenas super-admin pode gerar tenants por IA
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas super-admins podem gerar tenants por IA' });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { description } = body;

      if (!description || typeof description !== 'string' || description.trim().length === 0) {
        badRequest(res, 'Descrição é obrigatória');
        return;
      }

      // Usa tenant 'system' para geração por IA
      const systemTenantId = 'system';
      
      // Prompt para gerar dados do tenant
      const prompt = `Você é um assistente especializado em criar perfis de tenants para uma plataforma SaaS de automação com IA.

Com base na seguinte descrição, gere um JSON válido com os dados do tenant:

Descrição: ${description}

Gere um JSON com a seguinte estrutura:
{
  "name": "Nome do Tenant",
  "site": "https://exemplo.com",
  "ramo_atividade": "Descrição detalhada do ramo de atividade (2-3 frases)",
  "objetivo": "Objetivo estratégico do tenant com a plataforma (2-3 frases)"
}

Regras:
- O nome deve ser claro e profissional
- O site deve ser uma URL válida (use https://exemplo.com se não houver site específico)
- O ramo_atividade deve descrever o segmento de negócio de forma detalhada
- O objetivo deve explicar como o tenant pretende usar a plataforma

Retorne APENAS o JSON, sem markdown, sem explicações adicionais.`;

      logger.info('[Tenants] Gerando tenant por IA', { description: description.substring(0, 100) });

      const aiResult = await generateAiResponse(prompt, systemTenantId, {});
      const aiText = aiResult.text || '';

      // Tenta extrair JSON da resposta da IA
      let tenantData;
      try {
        // Remove markdown code blocks se existirem
        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          tenantData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('JSON não encontrado na resposta');
        }
      } catch (parseError) {
        logger.error('[Tenants] Erro ao parsear resposta da IA', { 
          aiText, 
          error: parseError.message 
        });
        sendJson(res, 500, { 
          error: 'Erro ao processar resposta da IA',
          details: 'A IA não retornou um JSON válido. Tente novamente com uma descrição mais detalhada.'
        });
        return;
      }

      // Valida dados gerados
      if (!tenantData.name || !tenantData.ramo_atividade || !tenantData.objetivo) {
        sendJson(res, 500, { 
          error: 'Dados incompletos',
          details: 'A IA não gerou todos os campos necessários. Tente novamente.'
        });
        return;
      }

      // Garante que o site existe
      if (!tenantData.site) {
        tenantData.site = 'https://exemplo.com';
      }

      // Valida entrada usando schema
      const { validateInput, schemas } = require('./utils/inputValidator');
      try {
        validateInput(tenantData, schemas.createTenant);
      } catch (validationError) {
        badRequest(res, `Dados gerados inválidos: ${validationError.message}`);
        return;
      }

      logger.info('[Tenants] Tenant gerado por IA com sucesso', { 
        name: tenantData.name,
        site: tenantData.site 
      });

      sendJson(res, 200, { 
        tenant: tenantData,
        generated: true
      });
    } catch (err) {
      logger.error('[Tenants] Erro ao gerar tenant por IA:', err);
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        sendJson(res, 500, { 
          error: 'internal_error',
          message: err.message || 'Erro ao gerar tenant por IA'
        });
      }
    }
    return;
  }

  // POST /system/suggest-description - Sugere descrição usando IA
  if (method === 'POST' && pathname === '/system/suggest-description') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { prompt, name, tenantId, urls } = body;

      if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        badRequest(res, 'Prompt é obrigatório');
        return;
      }

      const tenantIdForAI = tenantId || req.agent?.tenantId || 'tenant-demo';
      
      logger.info('[System] Sugerindo descrição por IA', { 
        name: name || 'N/A',
        tenantId: tenantIdForAI,
        hasUrls: Array.isArray(urls) && urls.length > 0
      });

      // Primeiro, consulta RAG para obter conteúdo indexado sobre o tenant/sistema
      let ragContext = '';
      try {
        // Constrói query mais específica baseada no nome e URLs
        let ragQuery = '';
        if (name && Array.isArray(urls) && urls.length > 0) {
          // Se tem nome e URLs, busca por conteúdo relacionado ao nome e às URLs
          const urlDomains = urls.map(url => {
            try {
              const urlObj = new URL(url);
              return urlObj.hostname.replace('www.', '');
            } catch {
              return url;
            }
          }).filter(Boolean);
          ragQuery = `${name} ${urlDomains.join(' ')} informações sobre serviços produtos`;
        } else if (name) {
          // Se tem apenas nome, busca por informações sobre o nome
          ragQuery = `Informações sobre ${name} serviços produtos empresa negócio`;
        } else if (Array.isArray(urls) && urls.length > 0) {
          // Se tem apenas URLs, busca por conteúdo das URLs
          const urlDomains = urls.map(url => {
            try {
              const urlObj = new URL(url);
              return urlObj.hostname.replace('www.', '');
            } catch {
              return url;
            }
          }).filter(Boolean);
          ragQuery = `${urlDomains.join(' ')} informações conteúdo site`;
        } else {
          ragQuery = 'Informações sobre o sistema ou tenant';
        }
        
        logger.debug('[System] Consultando RAG para obter contexto', { 
          query: ragQuery, 
          tenantId: tenantIdForAI,
          name,
          urlsCount: Array.isArray(urls) ? urls.length : 0
        });
        
        const ragResult = await ragService.queryRag(ragQuery, tenantIdForAI, {}, {
          topK: 10, // Aumenta para pegar mais contexto
          minScore: 0.25, // Score ainda mais baixo para pegar mais contexto
          maxTokens: 3000, // Mais tokens para ter mais informações
        });
        
        if (ragResult.success) {
          // Prioriza sources se disponíveis, senão usa response
          if (ragResult.sources && ragResult.sources.length > 0) {
            // Extrai conteúdo relevante dos chunks retornados
            // Sources podem ter: content, text, chunk, excerpt, ou similar
            const relevantChunks = ragResult.sources
              .filter(s => {
                const score = s.score || s.relevance_score || s.similarity || 0;
                return score >= 0.25; // Score mais baixo para pegar mais contexto
              })
              .slice(0, 8) // Aumenta para 8 chunks mais relevantes
              .map(s => {
                // O campo correto é 'excerpt' conforme o modelo Source do Python
                // Mas também tenta outros campos para compatibilidade
                const content = s.excerpt || s.content || s.text || s.chunk || s.snippet || '';
                return content;
              })
              .filter(c => c && c.trim() && c.length > 20); // Filtra conteúdos muito curtos
            
            if (relevantChunks.length > 0) {
              ragContext = `\n\nCONTEXTO EXTRAÍDO DOS ARQUIVOS INDEXADOS:\n${relevantChunks.join('\n\n---\n\n')}\n\n`;
              logger.info('[System] Contexto RAG obtido com sucesso', { 
                chunksCount: relevantChunks.length,
                totalLength: ragContext.length,
                sourcesCount: ragResult.sources.length,
                avgChunkLength: Math.round(relevantChunks.reduce((sum, c) => sum + c.length, 0) / relevantChunks.length)
              });
            } else {
              logger.debug('[System] RAG retornou sources mas sem conteúdo extraível suficiente', { 
                sourcesCount: ragResult.sources.length,
                sampleSource: ragResult.sources[0] ? Object.keys(ragResult.sources[0]) : [],
                sampleContent: ragResult.sources[0] ? (ragResult.sources[0].content || ragResult.sources[0].text || '').substring(0, 100) : ''
              });
            }
          }
          
          // Se não conseguiu extrair contexto dos sources mas há uma resposta gerada, usa ela
          if (!ragContext && ragResult.response && ragResult.response.trim()) {
            ragContext = `\n\nINFORMAÇÕES EXTRAÍDAS DOS ARQUIVOS INDEXADOS:\n${ragResult.response}\n\n`;
            logger.info('[System] Usando resposta RAG como contexto (sources não disponíveis)', { 
              responseLength: ragResult.response.length 
            });
          }
        } else {
          logger.debug('[System] RAG não retornou resultados ou está vazio', { 
            success: ragResult.success,
            sourcesCount: ragResult.sources?.length || 0,
            hasResponse: !!ragResult.response,
            error: ragResult.error
          });
        }
      } catch (ragError) {
        logger.warn('[System] Erro ao consultar RAG (continuando sem contexto)', { 
          error: ragError.message 
        });
        // Continua sem contexto RAG se houver erro
      }

      // Monta prompt final com contexto RAG se disponível
      let finalPrompt = prompt;
      
      if (ragContext) {
        // Se há contexto RAG, usa ele como fonte principal
        finalPrompt = `${prompt}\n\n${ragContext}\n\nIMPORTANTE: Use APENAS as informações do contexto extraído dos arquivos indexados acima. Não invente informações que não estejam no contexto. Se o contexto não contiver informações suficientes, seja cauteloso e mencione apenas o que está disponível.`;
      } else if (Array.isArray(urls) && urls.length > 0) {
        // Se não há RAG mas há URLs, menciona as URLs (mas não acessa diretamente)
        finalPrompt = `${prompt}\n\nURLs do site para referência: ${urls.join(', ')}\n\nIMPORTANTE: Use apenas informações que foram indexadas dos arquivos enviados ou do web scraping desses sites. Não invente informações.`;
      } else {
        // Sem RAG nem URLs, instrui a ser muito cauteloso
        finalPrompt = `${prompt}\n\nIMPORTANTE: Não há conteúdo indexado disponível. Seja muito cauteloso e não invente informações específicas. Use apenas inferências genéricas baseadas no nome.`;
      }

      const aiResult = await generateAiResponse(finalPrompt, tenantIdForAI, {});
      const suggestedDescription = aiResult.text || '';

      if (!suggestedDescription.trim()) {
        sendJson(res, 500, { 
          error: 'Erro ao processar resposta da IA',
          details: 'A IA não retornou uma descrição sugerida.'
        });
        return;
      }

      logger.info('[System] Descrição sugerida com sucesso', { 
        length: suggestedDescription.length 
      });

      sendJson(res, 200, { 
        suggestion: suggestedDescription.trim()
      });
    } catch (err) {
      logger.error('[System] Erro ao sugerir descrição:', err);
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        sendJson(res, 500, { 
          error: 'internal_error',
          message: err.message || 'Erro ao sugerir descrição por IA'
        });
      }
    }
    return;
  }

  // GET /tenants - Lista tenants
  if (method === 'GET' && pathname === '/tenants') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    // Apenas super-admin pode listar todos os tenants
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas super-admins podem listar tenants' });
      return;
    }

    try {
      const tenantsList = await listTenants();
      sendJson(res, 200, { tenants: tenantsList });
    } catch (err) {
      logger.error('Erro ao listar tenants:', err);
      sendJson(res, 500, { error: 'Erro ao listar tenants', message: err.message });
    }
    return;
  }

  // GET /tenants/:id/context - Obtém contexto do tenant (deve vir ANTES da rota genérica /tenants/:id)
  if (method === 'GET' && pathname.startsWith('/tenants/') && pathname.endsWith('/context')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length).replace('/context', ''));
    
    // Verifica se o tenant existe primeiro
    try {
      const tenant = await getTenant(tenantId);
      if (!tenant) {
        sendJson(res, 404, { error: 'tenant_not_found' });
        return;
      }
    } catch (err) {
      logger.error('Erro ao verificar tenant:', err);
      sendJson(res, 500, { error: 'Erro ao verificar tenant', message: err.message });
      return;
    }
    
    // Super-admin pode ver qualquer contexto
    // Admin pode ver qualquer contexto
    // Outros só podem ver seu próprio contexto
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser && req.agent.role !== 'admin' && req.agent.tenantId !== tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você só pode ver o contexto do seu próprio tenant' });
      return;
    }

    const context = getTenantContext(tenantId);
    if (!context) {
      sendJson(res, 404, { error: 'tenant_context_not_found' });
      return;
    }

    sendJson(res, 200, { context });
    return;
  }

  // GET /tenants/:id/usage - Obtém métricas de uso do tenant (deve vir ANTES da rota genérica /tenants/:id)
  if (method === 'GET' && pathname.startsWith('/tenants/') && pathname.endsWith('/usage')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length).replace('/usage', ''));
    
    // Owner pode ver métricas do seu tenant, admin pode ver qualquer tenant
    if (req.agent.role !== 'owner' && req.agent.role !== 'admin') {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas owner ou admin podem ver métricas' });
      return;
    }

    // Super-admin pode ver métricas de qualquer tenant
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser && req.agent.role === 'owner' && req.agent.tenantId !== tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você só pode ver métricas do seu próprio tenant' });
      return;
    }

    try {
      const usage = await getTenantUsage(tenantId);
      if (!usage) {
        sendJson(res, 404, { error: 'tenant_not_found' });
        return;
      }

      sendJson(res, 200, { usage });
    } catch (err) {
      logger.error('Erro ao obter métricas de uso:', err);
      sendJson(res, 500, { error: 'Erro ao obter métricas de uso', message: err.message });
    }
    return;
  }

  // GET /tenants/:id/ai-provider-status - Verifica se tenant tem provider de IA válido (deve vir ANTES da rota genérica /tenants/:id)
  if (method === 'GET' && pathname.startsWith('/tenants/') && pathname.endsWith('/ai-provider-status')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length).replace('/ai-provider-status', ''));
    
    // Verifica se o usuário tem permissão para ver o status do tenant
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser && req.agent.role !== 'admin' && req.agent.tenantId !== tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você só pode ver o status de provider de IA do seu próprio tenant' });
      return;
    }

    try {
      const { getAiProviderForTenant } = require('../engine/aiProviderManager');
      const { getAIConfig, getDecryptedAPIKey } = require('./services/tenantAIService');
      
      // Busca configuração de IA do tenant no banco de dados
      const tenantAiConfig = await getAIConfig(tenantId);
      
      // Configuração específica é obrigatória - se não tiver, retorna false
      if (!tenantAiConfig || !tenantAiConfig.primary || !tenantAiConfig.configured) {
        logger.warn('Tenant não tem configuração específica de provider de IA (obrigatória)', {
          tenantId,
          hasTenantConfig: !!tenantAiConfig,
          hasPrimary: !!tenantAiConfig?.primary,
          configured: tenantAiConfig?.configured,
        });
        
        sendJson(res, 200, { 
          hasValidProvider: false,
          tenantId 
        });
        return;
      }
      
      // Obtém o provider específico do tenant
      const provider = getAiProviderForTenant(tenantId);
      
      // Verifica se o provider é válido
      const hasValidProvider = provider !== null && 
                              typeof provider === 'object' && 
                              typeof provider.generate === 'function';
      
      // Se o provider não estiver registrado, testa o token do provider configurado
      let finalIsValid = hasValidProvider;
      
      if (!hasValidProvider && tenantAiConfig.primary) {
        const primaryProvider = tenantAiConfig.primary;
        // Busca API key do banco de dados (criptografada)
        const apiKey = await getDecryptedAPIKey(tenantId, primaryProvider);
        
        if (apiKey && apiKey.trim()) {
          logger.debug('Provider não registrado, testando token do provider configurado', {
            tenantId,
            primaryProvider,
            hasApiKey: !!apiKey,
          });
          
          // Testa o token do provider primário configurado
          try {
            if (primaryProvider === 'openai') {
              const response = await fetch('https://api.openai.com/v1/models', {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${apiKey.trim()}`,
                },
                signal: AbortSignal.timeout(10000),
              });
              
              if (response.ok) {
                const data = await response.json().catch(() => null);
                finalIsValid = !!(data && Array.isArray(data.data));
                logger.info('Token OpenAI testado com sucesso', {
                  tenantId,
                  isValid: finalIsValid,
                  hasData: !!data,
                  isArray: Array.isArray(data?.data),
                });
              } else {
                const errorData = await response.json().catch(() => ({}));
                logger.warn('Token OpenAI inválido', {
                  tenantId,
                  status: response.status,
                  error: errorData.error?.message || response.statusText,
                });
                finalIsValid = false;
              }
            } else if (primaryProvider === 'anthropic') {
              const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'x-api-key': apiKey.trim(),
                  'anthropic-version': '2023-06-01',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'claude-3-haiku-20240307',
                  max_tokens: 10,
                  messages: [{ role: 'user', content: 'test' }],
                }),
                signal: AbortSignal.timeout(10000),
              });
              
              if (response.ok) {
                const data = await response.json().catch(() => null);
                finalIsValid = !!(data && data.content);
                logger.info('Token Anthropic testado com sucesso', {
                  tenantId,
                  isValid: finalIsValid,
                  hasData: !!data,
                  hasContent: !!data?.content,
                });
              } else {
                const errorData = await response.json().catch(() => ({}));
                logger.warn('Token Anthropic inválido', {
                  tenantId,
                  status: response.status,
                  error: errorData.error?.message || response.statusText,
                });
                finalIsValid = false;
              }
            }
          } catch (err) {
            logger.warn('Erro ao testar token do provider', {
              tenantId,
              provider: primaryProvider,
              error: err.message,
            });
            finalIsValid = false;
          }
        } else {
          logger.warn('API key não encontrada para o provider configurado', {
            tenantId,
            primaryProvider,
          });
          finalIsValid = false;
        }
      }
      
      logger.debug('Verificando provider de IA para tenant', {
        tenantId,
        hasValidProvider,
        finalIsValid,
        primaryProvider: tenantAiConfig?.primary,
      });
      
      if (!finalIsValid) {
        logger.warn('Provider de IA não válido para tenant', {
          tenantId,
          hasTenantConfig: !!tenantAiConfig,
          tenantPrimaryProvider: tenantAiConfig?.primary,
          tenantSecondaryProvider: tenantAiConfig?.secondary,
        });
      }
      
      logger.info('Status final de provider de IA do tenant', {
        tenantId,
        hasValidProvider: finalIsValid,
        providerRegistrado: hasValidProvider,
        providerTestado: !hasValidProvider && tenantAiConfig?.primary,
      });
      
      const responseData = { 
        hasValidProvider: finalIsValid,
        tenantId 
      };
      
      logger.debug('Enviando resposta ao cliente', responseData);
      
      sendJson(res, 200, responseData);
    } catch (err) {
      logger.error('Erro ao verificar status de provider de IA do tenant:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao verificar status de provider de IA' });
    }
    return;
  }

  // GET /tenants/:id/ai-config - Obtém configuração de IA do tenant (deve vir ANTES da rota genérica /tenants/:id)
  // NOTA: Esta rota também cobre /tenants/current/ai-config por compatibilidade.
  if (method === 'GET' && pathname.startsWith('/tenants/') && pathname.endsWith('/ai-config')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    let tenantId = decodeURIComponent(pathname.slice('/tenants/'.length).replace('/ai-config', ''));
    // Compatibilidade: /tenants/current/ai-config deve resolver para o tenant do agente autenticado.
    if (tenantId === 'current') {
      tenantId = authResult.agent?.tenantId;
    }
    if (!tenantId) {
      sendJson(res, 400, { error: 'bad_request', message: 'tenantId ausente ou inválido' });
      return;
    }
    
    // Verifica se o usuário tem permissão para ver a config de IA do tenant
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser && req.agent.role !== 'admin' && req.agent.tenantId !== tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você só pode ver a configuração de IA do seu próprio tenant' });
      return;
    }

    try {
      // Busca configuração de IA do tenant no banco de dados
      const { getAIConfig } = require('./services/tenantAIService');
      const tenantAiConfig = await getAIConfig(tenantId);
      
      // Se tenant não existir, 404
      if (tenantAiConfig === null) {
        sendJson(res, 404, { error: 'not_found', message: 'Tenant não encontrado' });
        return;
      }
      
      // Retorna configuração completa (sem segredos) para o frontend reidratar campos (model, temperature, max_tokens, etc).
      sendJson(res, 200, { tenantId, ...tenantAiConfig });
    } catch (err) {
      logger.error('Erro ao obter configuração de IA do tenant:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter configuração de IA do tenant' });
    }
    return;
  }

  // GET /tenants/:id - Obtém tenant específico
  if (method === 'GET' && pathname.startsWith('/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length));
    
    // Verifica se é super-admin (role super_admin OU owner do tenant system original)
    // IMPORTANTE: Usa req.agent.tenantId (tenantId original do agente), não req.tenantId (que pode ter sido alterado)
    const isSuperAdminUser = isSuperAdmin(req.agent);
    
    // Super-admin pode ver qualquer tenant
    // Admin pode ver qualquer tenant
    // Outros só podem ver seu próprio tenant (baseado no tenantId original do agente)
    if (!isSuperAdminUser && req.agent.role !== 'admin' && req.agent.tenantId !== tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você só pode ver seu próprio tenant' });
      return;
    }

    try {
      const tenant = await getTenant(tenantId);
      if (!tenant) {
        sendJson(res, 404, { error: 'tenant_not_found' });
        return;
      }

      sendJson(res, 200, { tenant });
    } catch (err) {
      logger.error('[Server] Erro ao obter tenant:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // PUT /tenants/:id/context - Atualiza contexto do tenant (deve vir ANTES da rota genérica /tenants/:id)
  if (method === 'PUT' && pathname.startsWith('/tenants/') && pathname.endsWith('/context')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    // Apenas OWNER ou ADMIN podem atualizar contextos (proteção contra prompt injection)
    // Apenas super-admin pode atualizar contextos de tenants
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas super-admins podem atualizar contextos de tenants' });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length).replace('/context', ''));
    
    try {
      const tenant = await getTenant(tenantId);
      if (!tenant) {
        sendJson(res, 404, { error: 'tenant_not_found' });
        return;
      }
      const body = await parseJsonBody(req);
      
      // Valida entrada usando schema
      const { validateInput, schemas } = require('./utils/inputValidator');
      try {
        validateInput(body, schemas.updateTenantContext);
      } catch (validationError) {
        badRequest(res, validationError.message || 'Dados inválidos');
        return;
      }
      
      // Passa informações do usuário para auditoria e validação
      const result = await updateTenantContext(tenantId, body, {
        userRole: req.agent.role,
        userId: req.agent.id,
        username: req.agent.username,
      });

      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      // Registra ação de auditoria
      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'tenant_context_update',
        resource: 'tenant_context',
        resourceId: tenantId,
        details: { updatedFields: Object.keys(body) },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, { context: result.context });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atualizar tenant context:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // PUT /tenants/:id - Atualiza tenant
  // Exclui rotas específicas que devem ser tratadas antes (ai-config, ai-credentials, etc)
  if (method === 'PUT' && pathname.startsWith('/tenants/') && 
      !pathname.endsWith('/ai-config') && !pathname.endsWith('/ai-credentials')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    // Apenas super-admin pode atualizar tenants
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas super-admins podem atualizar tenants' });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length));
    const tenant = getTenant(tenantId);
    
    if (!tenant) {
      sendJson(res, 404, { error: 'tenant_not_found' });
      return;
    }

    try {
      const body = await parseJsonBody(req);
      
      // Valida entrada usando schema
      const { validateInput, schemas } = require('./utils/inputValidator');
      try {
        validateInput(body, schemas.updateTenant);
      } catch (validationError) {
        badRequest(res, validationError.message || 'Dados inválidos');
        return;
      }
      
      const result = await updateTenant(tenantId, body);

      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      // Registra ação de auditoria
      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'tenant_update',
        resource: 'tenant',
        resourceId: tenantId,
        details: { updatedFields: Object.keys(body) },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, { tenant: result.tenant });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atualizar tenant:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // DELETE /tenants/:id - Remove tenant
  if (method === 'DELETE' && pathname.startsWith('/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    // Apenas super-admins podem remover tenants
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas super-admins podem remover tenants' });
      return;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length));
    
    try {
      const tenant = await getTenant(tenantId);
      if (!tenant) {
        sendJson(res, 404, { error: 'tenant_not_found' });
        return;
      }

      const result = await deleteTenant(tenantId);

      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      sendJson(res, 200, { success: true, message: 'Tenant removido com sucesso' });
    } catch (err) {
      logger.error('Erro ao remover tenant:', err);
      sendJson(res, 500, { error: 'Erro ao remover tenant', message: err.message });
    }
    return;

    // Registra ação de auditoria
    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      action: 'tenant_delete',
      resource: 'tenant',
      resourceId: tenantId,
      details: { tenantName: tenant.name },
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, { success: true });
    return;
  }



  // POST /tenants/:id/suspend - Suspende tenant (requer autenticação admin/owner)
  if (method === 'POST' && pathname.includes('/suspend') && pathname.startsWith('/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length).replace('/suspend', ''));
    
    // Apenas owner ou admin podem suspender
    if (req.agent.role !== 'owner' && req.agent.role !== 'admin') {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas owner ou admin podem suspender tenants' });
      return;
    }

    // Owner só pode suspender seu próprio tenant
    if (req.agent.role === 'owner' && req.tenantId !== tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você só pode suspender seu próprio tenant' });
      return;
    }

    const result = await suspendTenant(tenantId);
    if (!result.success) {
      sendJson(res, 400, { error: result.error });
      return;
    }

    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      tenantId: tenantId,
      action: 'tenant_suspend',
      resource: 'tenant',
      resourceId: tenantId,
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, { tenant: result.tenant });
    return;
  }

  // POST /tenants/:id/reactivate - Reativa tenant (requer autenticação admin/owner)
  if (method === 'POST' && pathname.includes('/reactivate') && pathname.startsWith('/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length).replace('/reactivate', ''));
    
    // Apenas owner ou admin podem reativar
    if (req.agent.role !== 'owner' && req.agent.role !== 'admin') {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas owner ou admin podem reativar tenants' });
      return;
    }

    const result = await reactivateTenant(tenantId);
    if (!result.success) {
      sendJson(res, 400, { error: result.error });
      return;
    }

    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      tenantId: tenantId,
      action: 'tenant_reactivate',
      resource: 'tenant',
      resourceId: tenantId,
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, { tenant: result.tenant });
    return;
  }

  // POST /tenants/:id/change-plan - Muda plano do tenant (requer autenticação admin/owner)
  if (method === 'POST' && pathname.includes('/change-plan') && pathname.startsWith('/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length).replace('/change-plan', ''));
    
    // Apenas owner ou admin podem mudar plano
    if (req.agent.role !== 'owner' && req.agent.role !== 'admin') {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas owner ou admin podem mudar plano' });
      return;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body.plan) {
        badRequest(res, 'Campo "plan" é obrigatório');
        return;
      }

      const result = await changePlan(tenantId, body.plan);
      if (!result.success) {
        sendJson(res, 400, { error: result.error });
        return;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        tenantId: tenantId,
        action: 'tenant_change_plan',
        resource: 'tenant',
        resourceId: tenantId,
        details: { newPlan: body.plan },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, { tenant: result.tenant });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao mudar plano do tenant:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }


  // ============================================================================
  // SUPER ADMIN ROUTES
  // ============================================================================

  // GET /super-admin/tenants - Lista todos os tenants (requer Super Admin)
  if (method === 'GET' && pathname === '/super-admin/tenants') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode acessar esta área' });
      return;
    }

    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const filters = {
        status: url.searchParams.get('status'),
        plan: url.searchParams.get('plan'),
        search: url.searchParams.get('search'),
      };

      const tenants = await listAllTenants(filters);
      sendJson(res, 200, { tenants });
    } catch (err) {
      logger.error('Erro ao listar tenants (Super Admin):', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // GET /super-admin/tenants/:id/metrics - Obtém métricas detalhadas de um tenant
  if (method === 'GET' && pathname.includes('/metrics') && pathname.startsWith('/super-admin/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode acessar esta área' });
      return;
    }

    const tenantId = decodeURIComponent(pathname.slice('/super-admin/tenants/'.length).replace('/metrics', ''));
    const metrics = getTenantMetrics(tenantId);

    if (!metrics) {
      sendJson(res, 404, { error: 'tenant_not_found' });
      return;
    }

    sendJson(res, 200, { metrics });
    return;
  }

  // POST /super-admin/impersonate - Impersona um usuário
  if (method === 'POST' && pathname === '/super-admin/impersonate') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode impersonar usuários' });
      return;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body.agentId) {
        badRequest(res, 'Campo "agentId" é obrigatório');
        return;
      }

      const result = impersonateUser(body.agentId, req.agent.id);
      if (!result.success) {
        sendJson(res, 400, { error: result.error });
        return;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        tenantId: 'system',
        action: 'impersonate_user',
        resource: 'agent',
        resourceId: body.agentId,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao impersonar usuário:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // POST /super-admin/tenants/:id/block - Bloqueia um tenant
  if (method === 'POST' && pathname.includes('/block') && pathname.startsWith('/super-admin/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode bloquear tenants' });
      return;
    }

    const tenantId = decodeURIComponent(pathname.slice('/super-admin/tenants/'.length).replace('/block', ''));

    try {
      const body = await parseJsonBody(req);
      const reason = body.reason || 'Bloqueado por Super Admin';

      const result = blockTenant(tenantId, reason, req.agent.id);
      if (!result.success) {
        sendJson(res, 400, { error: result.error });
        return;
      }

      sendJson(res, 200, { tenant: result.tenant });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao bloquear tenant:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // POST /super-admin/tenants/:id/unblock - Desbloqueia um tenant
  if (method === 'POST' && pathname.includes('/unblock') && pathname.startsWith('/super-admin/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode desbloquear tenants' });
      return;
    }

    const tenantId = decodeURIComponent(pathname.slice('/super-admin/tenants/'.length).replace('/unblock', ''));

    const result = unblockTenant(tenantId, req.agent.id);
    if (!result.success) {
      sendJson(res, 400, { error: result.error });
      return;
    }

    sendJson(res, 200, { tenant: result.tenant });
    return;
  }

  // POST /super-admin/tenants/:id/adjust-plan - Ajusta plano de um tenant
  if (method === 'POST' && pathname.includes('/adjust-plan') && pathname.startsWith('/super-admin/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode ajustar planos' });
      return;
    }

    const tenantId = decodeURIComponent(pathname.slice('/super-admin/tenants/'.length).replace('/adjust-plan', ''));

    try {
      const body = await parseJsonBody(req);
      if (!body.plan) {
        badRequest(res, 'Campo "plan" é obrigatório');
        return;
      }

      const result = adjustTenantPlan(tenantId, body.plan, body.customLimits, req.agent.id);
      if (!result.success) {
        sendJson(res, 400, { error: result.error });
        return;
      }

      sendJson(res, 200, { tenant: result.tenant });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao ajustar plano:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // ============================================================================
  // ONBOARDING ROUTES
  // ============================================================================

  // GET /onboarding/status - Obtém status de onboarding do tenant
  if (method === 'GET' && pathname === '/onboarding/status') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!req.tenantId) {
      sendJson(res, 403, { error: 'tenant_id_required' });
      return;
    }

    const status = getOnboardingStatus(req.tenantId);
    if (!status) {
      sendJson(res, 404, { error: 'tenant_not_found' });
      return;
    }

    sendJson(res, 200, { onboarding: status });
    return;
  }

  // POST /onboarding/start - Inicia processo de onboarding
  if (method === 'POST' && pathname === '/onboarding/start') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!req.tenantId) {
      sendJson(res, 403, { error: 'tenant_id_required' });
      return;
    }

    // Apenas owner ou admin podem iniciar onboarding
    if (req.agent.role !== 'owner' && req.agent.role !== 'admin') {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas owner ou admin podem iniciar onboarding' });
      return;
    }

    const result = startOnboarding(req.tenantId);
    if (!result.success) {
      sendJson(res, 400, { error: result.error });
      return;
    }

    sendJson(res, 200, result);
    return;
  }

  // POST /onboarding/complete-step - Marca um step como completo
  if (method === 'POST' && pathname === '/onboarding/complete-step') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!req.tenantId) {
      sendJson(res, 403, { error: 'tenant_id_required' });
      return;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body.stepId) {
        badRequest(res, 'Campo "stepId" é obrigatório');
        return;
      }

      const result = completeOnboardingStep(req.tenantId, body.stepId);
      if (!result.success) {
        sendJson(res, 400, { error: result.error });
        return;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        tenantId: req.tenantId,
        action: 'onboarding_step_complete',
        resource: 'onboarding',
        resourceId: body.stepId,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao completar step de onboarding:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // POST /onboarding/complete - Finaliza onboarding
  if (method === 'POST' && pathname === '/onboarding/complete') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!req.tenantId) {
      sendJson(res, 403, { error: 'tenant_id_required' });
      return;
    }

    // Apenas owner ou admin podem finalizar onboarding
    if (req.agent.role !== 'owner' && req.agent.role !== 'admin') {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas owner ou admin podem finalizar onboarding' });
      return;
    }

    const result = completeOnboarding(req.tenantId);
    if (!result.success) {
      sendJson(res, 400, { error: result.error });
      return;
    }

    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      tenantId: req.tenantId,
      action: 'onboarding_complete',
      resource: 'onboarding',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, result);
    return;
  }

  // POST /onboarding/create-templates - Cria templates iniciais
  if (method === 'POST' && pathname === '/onboarding/create-templates') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!req.tenantId) {
      sendJson(res, 403, { error: 'tenant_id_required' });
      return;
    }

    // Apenas owner ou admin podem criar templates
    if (req.agent.role !== 'owner' && req.agent.role !== 'admin') {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas owner ou admin podem criar templates' });
      return;
    }

    const result = createInitialTemplates(req.tenantId);
    if (!result.success) {
      sendJson(res, 400, { error: result.error });
      return;
    }

    sendJson(res, 200, result);
    return;
  }

  // GET /auth/agents - Lista agentes (requer autenticação e permissão)
  if (method === 'GET' && pathname === '/auth/agents') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'agents', 'list_all');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    // Filtra agentes por tenant do agente autenticado
    const agents = await listAgents(req.tenantId);
    sendJson(res, 200, { agents });
    return;
  }

  // POST /auth/agents - Cria novo agente (requer autenticação e permissão)
  if (method === 'POST' && pathname === '/auth/agents') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'agents', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      // Garante que tenantId seja o mesmo do agente autenticado
      body.tenantId = req.tenantId;
      const result = await createAgent(body);

      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      // Registra ação de auditoria
      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'agent_create',
        resource: 'agent',
        resourceId: result.agent.id,
        details: { createdAgent: result.agent.username },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 201, { agent: result.agent });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar agente:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // GET /auth/agents/:id - Obtém agente específico
  if (method === 'GET' && pathname.startsWith('/auth/agents/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const agentId = decodeURIComponent(pathname.slice('/auth/agents/'.length));
    
    // Agent pode ver apenas próprio perfil, admin/supervisor podem ver qualquer um do mesmo tenant
    if (req.agent.role !== 'admin' && req.agent.role !== 'supervisor' && req.agent.id !== agentId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você só pode ver seu próprio perfil' });
      return;
    }

    const agent = await getAgent(agentId);
    if (!agent) {
      sendJson(res, 404, { error: 'agent_not_found' });
      return;
    }

    // Valida tenant
    if (req.tenantId && agent.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Agente não pertence ao seu tenant' });
      return;
    }

    sendJson(res, 200, { agent });
    return;
  }

  // PUT /auth/agents/:id - Atualiza agente
  if (method === 'PUT' && pathname.startsWith('/auth/agents/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const agentId = decodeURIComponent(pathname.slice('/auth/agents/'.length));
    const agent = await getAgent(agentId);
    
    if (!agent) {
      sendJson(res, 404, { error: 'agent_not_found' });
      return;
    }

    // Valida tenant - super-admin pode editar agentes de qualquer tenant
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser && req.tenantId && agent.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Agente não pertence ao seu tenant' });
      return;
    }
    
    // Agent pode atualizar apenas próprio perfil (com restrições), admin/supervisor podem atualizar qualquer um do mesmo tenant
    // Super-admin pode atualizar qualquer agente
    if (!isSuperAdminUser && req.agent.role !== 'admin' && req.agent.role !== 'supervisor' && req.agent.id !== agentId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você só pode atualizar seu próprio perfil' });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      
      // Agent comum não pode alterar role ou active
      if (req.agent.role === 'agent' && agentId === req.agent.id) {
        delete body.role;
        delete body.active;
      }

      const result = await updateAgent(agentId, body);

      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      // Registra ação de auditoria
      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'agent_update',
        resource: 'agent',
        resourceId: agentId,
        details: { updatedFields: Object.keys(body) },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, { agent: result.agent });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atualizar agente:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // DELETE /auth/agents/:id - Remove agente
  if (method === 'DELETE' && pathname.startsWith('/auth/agents/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'agents', 'delete');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const agentId = decodeURIComponent(pathname.slice('/auth/agents/'.length));
    const agent = await getAgent(agentId);
    
    if (!agent) {
      sendJson(res, 404, { error: 'agent_not_found' });
      return;
    }

    // Valida tenant
    if (req.tenantId && agent.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Agente não pertence ao seu tenant' });
      return;
    }

    const result = await deleteAgent(agentId);

    if (!result.success) {
      badRequest(res, result.error);
      return;
    }

    // Registra ação de auditoria
    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      action: 'agent_delete',
      resource: 'agent',
      resourceId: agentId,
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, { success: true });
    return;
  }

  // POST /auth/invite - Convida um novo usuário
  if (method === 'POST' && pathname === '/auth/invite') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'agents', 'invite');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      // Garante que tenantId seja o mesmo do agente autenticado
      body.tenantId = req.tenantId || body.tenantId;
      
      const result = await inviteUser(body);
      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        tenantId: req.tenantId,
        action: 'user_invite',
        resource: 'agent',
        resourceId: result.agentId,
        details: { email: body.email, role: body.role },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao convidar usuário:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // POST /auth/accept-invitation - Aceita convite
  if (method === 'POST' && pathname === '/auth/accept-invitation') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body.invitationToken || !body.password || !body.username) {
        badRequest(res, 'invitationToken, password e username são obrigatórios');
        return;
      }

      const result = await acceptInvitation(body.invitationToken, body.password, body.username);
      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      // Salva token se retornado
      if (result.token) {
        res.setHeader('Set-Cookie', `auth_token=${result.token}; HttpOnly; Secure; SameSite=Strict`);
      }

      logAction({
        agentId: result.agent?.id || 'system',
        username: result.agent?.username || body.username,
        tenantId: result.agent?.tenantId || 'unknown',
        action: 'invitation_accepted',
        resource: 'agent',
        resourceId: result.agent?.id,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao aceitar convite:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // POST /auth/request-password-reset - Solicita reset de senha
  if (method === 'POST' && pathname === '/auth/request-password-reset') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body.email) {
        badRequest(res, 'Email é obrigatório');
        return;
      }

      await requestPasswordReset(body.email);
      // Sempre retorna sucesso (por segurança, não revela se email existe)
      sendJson(res, 200, { 
        success: true, 
        message: 'Se o email existir, um link de reset será enviado' 
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao solicitar reset de senha:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // POST /auth/reset-password - Reseta senha usando token
  if (method === 'POST' && pathname === '/auth/reset-password') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body.resetToken || !body.newPassword) {
        badRequest(res, 'resetToken e newPassword são obrigatórios');
        return;
      }

      const result = await resetPassword(body.resetToken, body.newPassword);
      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      sendJson(res, 200, { success: true, message: 'Senha resetada com sucesso' });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao resetar senha:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // GET /audit/logs - Consulta logs de auditoria
  if (method === 'GET' && pathname === '/audit/logs') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'audit', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const urlObj = new URL(req.url || '/', 'http://localhost');
    const filters = {
      agentId: urlObj.searchParams.get('agentId') || undefined,
      username: urlObj.searchParams.get('username') || undefined,
      action: urlObj.searchParams.get('action') || undefined,
      resource: urlObj.searchParams.get('resource') || undefined,
      resourceId: urlObj.searchParams.get('resourceId') || undefined,
      tenantId: req.tenantId || urlObj.searchParams.get('tenantId') || undefined, // Filtra por tenant do agente autenticado
      startDate: urlObj.searchParams.get('startDate') || undefined,
      endDate: urlObj.searchParams.get('endDate') || undefined,
      limit: urlObj.searchParams.get('limit') || undefined,
      offset: urlObj.searchParams.get('offset') || undefined,
    };

    const result = await queryLogs(filters);
    sendJson(res, 200, result);
    return;
  }

  // GET /audit/stats - Estatísticas de auditoria
  if (method === 'GET' && pathname === '/audit/stats') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'audit', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const stats = await getAuditStats();
    sendJson(res, 200, stats);
    return;
  }

  // -----------------------------------------------------------------------
  // CRUD de fluxos
  // -----------------------------------------------------------------------

  // GET /flows
  if (method === 'GET' && pathname === '/flows') {
    // Se autenticado, filtra por tenant do agente
    const authResult = requireAuth(req);
    if (authResult.valid && req.tenantId) {
      const tenantFlows = Array.from(flows.values()).filter(flow => flow.tenantId === req.tenantId);
      sendJson(res, 200, tenantFlows);
    } else {
      // Sem autenticação, retorna todos (compatibilidade)
      sendJson(res, 200, Array.from(flows.values()));
    }
    return;
  }

  // GET /flows/:id
  // IMPORTANTE: Verificar se não é um endpoint especial (validate, simulate) antes de processar
  if (method === 'GET' && pathname.startsWith('/flows/') && pathname !== '/flows/validate' && pathname !== '/flows/simulate') {
    const id = decodeURIComponent(pathname.slice('/flows/'.length));
    const flow = flows.get(id);
    if (!flow) {
      sendJson(res, 404, { error: 'flow_not_found' });
      return;
    }
    
    // Valida tenant se autenticado
    const authResult = requireAuth(req);
    if (authResult.valid && req.tenantId && flow.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Fluxo não pertence ao seu tenant' });
      return;
    }
    
    sendJson(res, 200, flow);
    return;
  }

  // POST /flows
  if (method === 'POST' && pathname === '/flows') {
    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);

      // Validação estrutural básica
      const structureValidation = validateFlowStructure(body);
      if (!structureValidation.valid) {
        badRequest(res, structureValidation.error || 'Estrutura do fluxo inválida');
        return;
      }

      // Se autenticado, garante que tenantId do fluxo seja o mesmo do agente
      const authResult = requireAuth(req);
      if (authResult.valid && req.tenantId) {
        body.tenantId = req.tenantId; // Força tenantId do agente
      }

      const flow = ensureFlowHasMeta(body, req.tenantId);

      // 🚫 Gate de validação OBRIGATÓRIA para fluxos gerados por IA
      // Fluxos gerados por IA DEVEM passar pelo gate antes de serem salvos
      const isAiGenerated = flow.metadata?.generatedBy === 'ai' || flow.metadata?.generated === true;
      if (isAiGenerated) {
        const { validateGeneratedPlanOrThrow } = require('../engine/ai/validateGeneratedPlan');
        try {
          validateGeneratedPlanOrThrow(flow, 'chatbot');
          logger.info('[POST /flows] Fluxo gerado por IA passou no gate de validação', {
            flowId: flow.id,
            flowName: flow.name
          });
        } catch (validationError) {
          logger.error('[POST /flows] Gate de validação bloqueou fluxo gerado por IA', {
            flowId: flow.id,
            flowName: flow.name,
            error: validationError.message
          });
          badRequest(res, `Fluxo gerado por IA não passou na validação obrigatória: ${validationError.message}`);
          return;
        }
      }

      // Validação completa usando o validador da engine
      // ✅ NOTA: A validação é executada mas não bloqueia a criação do fluxo
      // O fluxo pode ser criado mesmo com erros de validação para permitir que o usuário corrija depois
      // EXCEÇÃO: Fluxos gerados por IA já foram validados pelo gate acima
      const validationResult = validateFlow(flow);
      const hasValidationErrors = !validationResult.valid && validationResult.errors.length > 0;

      // Verifica se já existe um fluxo com o mesmo id
      if (flows.has(flow.id)) {
        sendJson(res, 409, {
          error: 'flow_already_exists',
          message: `Já existe um fluxo com o id "${flow.id}". Use PUT para atualizar.`,
        });
        return;
      }

      flows.set(flow.id, flow);
      persistFlowBestEffort(flow);
      
      // Dispara webhooks e WebSocket
      const tenantId = req.tenantId || flow.tenantId;
      triggerWebhooks(tenantId, 'flow.created', {
        flowId: flow.id,
        flowName: flow.name,
        agentId: req.agent?.id,
      }).catch((err) => {
        logger.error('[Webhook] Erro ao disparar webhook para flow.created:', err);
      });

      emitEvent('flow.created', {
        flowId: flow.id,
        flowName: flow.name,
        agentId: req.agent?.id,
      }, { tenantId });
      
      // ✅ Retorna o fluxo criado, incluindo erros de validação se houver
      // Isso permite que o frontend exiba os erros mas não bloqueia a criação
      const response = { ...flow };
      if (hasValidationErrors) {
        response.validationWarnings = {
          valid: false,
          errors: validationResult.errors, // ✅ Já vem com messageUi do validator
        };
      }
      
      sendJson(res, 201, response);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else if (err.message && err.message.includes('excede o tamanho máximo')) {
        badRequest(res, err.message);
      } else {
        logger.error('Erro ao criar fluxo', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao processar requisição' });
      }
    }
    return;
  }

  // PUT /flows/:id
  // IMPORTANTE: Verificar se não é um endpoint especial antes de processar
  if (method === 'PUT' && pathname.startsWith('/flows/') && pathname !== '/flows/validate' && pathname !== '/flows/simulate') {
    const id = decodeURIComponent(pathname.slice('/flows/'.length));

    // Validação básica do ID
    if (!id || id.trim() === '') {
      badRequest(res, 'ID do fluxo é obrigatório');
      return;
    }

    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);

      // Verifica se o fluxo existe
      const existingFlow = flows.get(id);
      if (!existingFlow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${id}" não encontrado` });
        return;
      }

      // Valida tenant se autenticado
      const authResult = requireAuth(req);
      if (authResult.valid && req.tenantId && existingFlow.tenantId !== req.tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'Fluxo não pertence ao seu tenant' });
        return;
      }

      // Se autenticado, garante que tenantId do fluxo seja o mesmo do agente
      if (authResult.valid && req.tenantId) {
        body.tenantId = req.tenantId; // Força tenantId do agente
      }

      // Valida consistência: se body.id existe, deve corresponder ao id da URL
      if (body && typeof body === 'object' && body.id && body.id !== id) {
        badRequest(res, `O ID do fluxo no body ("${body.id}") não corresponde ao ID da URL ("${id}")`);
        return;
      }

      const merged = {
        ...existingFlow,
        ...(body && typeof body === 'object' ? body : {}),
        id, // Garante que o ID não seja alterado
      };

      // Validação estrutural básica
      const structureValidation = validateFlowStructure(merged);
      if (!structureValidation.valid) {
        badRequest(res, structureValidation.error || 'Estrutura do fluxo inválida');
        return;
      }

      // 🚫 Gate de validação OBRIGATÓRIA para fluxos gerados por IA
      // Se o fluxo foi gerado por IA, deve passar pelo gate antes de ser atualizado
      const isAiGenerated = merged.metadata?.generatedBy === 'ai' || merged.metadata?.generated === true;
      if (isAiGenerated) {
        const { validateGeneratedPlanOrThrow } = require('../engine/ai/validateGeneratedPlan');
        try {
          validateGeneratedPlanOrThrow(merged, 'chatbot');
          logger.info('[PUT /flows/:id] Fluxo gerado por IA passou no gate de validação', {
            flowId: id,
            flowName: merged.name
          });
        } catch (validationError) {
          logger.error('[PUT /flows/:id] Gate de validação bloqueou atualização de fluxo gerado por IA', {
            flowId: id,
            flowName: merged.name,
            error: validationError.message
          });
          badRequest(res, `Fluxo gerado por IA não passou na validação obrigatória: ${validationError.message}`);
          return;
        }
      }

      // Validação completa usando o validador da engine
      const validationResult = validateFlow(merged);
      if (!validationResult.valid && validationResult.errors.length > 0) {
        // ✅ Mapeia erros técnicos para mensagens amigáveis
        sendJson(res, 400, {
          error: 'validation_failed',
          message: 'O fluxo não passou na validação',
          errors: validationResult.errors, // ✅ Já vem com messageUi do validator
        });
        return;
      }

      const flow = ensureFlowHasMeta(merged);
      flows.set(id, flow);
      persistFlowBestEffort(flow);
      
      // Dispara webhooks e WebSocket
      const tenantId = req.tenantId || flow.tenantId;
      triggerWebhooks(tenantId, 'flow.updated', {
        flowId: flow.id,
        flowName: flow.name,
        agentId: req.agent?.id,
      }).catch((err) => {
        logger.error('[Webhook] Erro ao disparar webhook para flow.updated:', err);
      });

      emitEvent('flow.updated', {
        flowId: flow.id,
        flowName: flow.name,
        agentId: req.agent?.id,
      }, { tenantId });
      
      sendJson(res, 200, flow);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else if (err.message && err.message.includes('excede o tamanho máximo')) {
        badRequest(res, err.message);
      } else {
        logger.error('Erro ao atualizar fluxo:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao processar requisição' });
      }
    }
    return;
  }

  // DELETE /flows/:id
  // IMPORTANTE: Verificar se não é um endpoint especial antes de processar
  if (method === 'DELETE' && pathname.startsWith('/flows/')) {
    // Verificar se não é um endpoint especial
    if (pathname === '/flows/validate' || pathname === '/flows/simulate') {
      notFound(res);
      return;
    }
    const id = decodeURIComponent(pathname.slice('/flows/'.length));
    const flow = flows.get(id);
    if (!flow) {
      sendJson(res, 404, { error: 'flow_not_found' });
      return;
    }
    
    // Valida tenant se autenticado
    const authResult = requireAuth(req);
    if (authResult.valid && req.tenantId && flow.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Fluxo não pertence ao seu tenant' });
      return;
    }
    
    flows.delete(id);
    deleteFlowBestEffort(id);
    
    // Dispara webhooks e WebSocket
    const tenantId = req.tenantId || flow.tenantId;
    triggerWebhooks(tenantId, 'flow.deleted', {
      flowId: flow.id,
      flowName: flow.name,
      agentId: req.agent?.id,
    }).catch((err) => {
      logger.error('[Webhook] Erro ao disparar webhook para flow.deleted:', err);
    });

    emitEvent('flow.deleted', {
      flowId: flow.id,
      flowName: flow.name,
      agentId: req.agent?.id,
    }, { tenantId });
    
    sendJson(res, 200, { success: true, deletedId: id });
    return;
  }

  // -----------------------------------------------------------------------
  // Validação de fluxo
  // -----------------------------------------------------------------------

  // POST /flows/validate
  if (method === 'POST' && pathname === '/flows/validate') {
    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object') {
        badRequest(res, 'Body deve ser um objeto FlowDefinition');
        return;
      }

      // Validação estrutural básica primeiro
      const structureValidation = validateFlowStructure(body);
      if (!structureValidation.valid) {
        // ✅ Mapeia erro estrutural também
        const structureError = addUiMessage({
          code: 'INVALID_FLOW_STRUCTURE',
          message: structureValidation.error || 'Estrutura do fluxo inválida',
          nodeIds: [],
        });
        sendJson(res, 200, {
          valid: false,
          errors: [structureError], // ✅ Já vem com messageUi do validator
        });
        return;
      }

      const result = validateFlow(body);
      
      sendJson(res, 200, {
        valid: Boolean(result && result.valid),
        errors: result.errors || [], // ✅ Já vem com messageUi do validator
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else if (err.message && err.message.includes('excede o tamanho máximo')) {
        badRequest(res, err.message);
      } else {
        logger.error('Erro ao validar fluxo:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao validar fluxo' });
      }
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Geração de fluxo a partir de descrição
  // -----------------------------------------------------------------------

  // POST /flows/generate
  if (method === 'POST' && pathname === '/flows/generate') {
    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object') {
        badRequest(res, 'Body deve ser um objeto válido');
        return;
      }

      // Obtém tenantId do agente autenticado se disponível
      const authResult = requireAuth(req);
      const finalTenantId = body.tenantId || (authResult.valid && req.tenantId) || 'demo-tenant';

      // Usa orquestrador de geração
      const result = await orchestrateGeneration(body, {
        tenantId: finalTenantId,
        autoResolveDependencies: body.autoResolveDependencies || false,
      });

      if (!result.success) {
        badRequest(res, result.error || 'Erro na orquestração de geração');
        return;
      }

      // Registra para auditoria
      if (result.metadata) {
        const auditId = await registerGeneration(result.metadata);
        // Armazena auditId para vincular ao relatório
        result.metadata.auditId = auditId;
        const auditReport = await generateAuditReport({ ...result.metadata, auditId }, { format: 'json' });
        result.metadata.auditId = auditId;
        result.metadata.reportId = auditReport.reportId;
      }

      // Retorna resultado completo
      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao gerar fluxo:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message || 'Erro interno ao gerar fluxo' });
      }
    }
    return;
  }

  // POST /flows/generate/dry-run (Modo DRY-RUN)
  if (method === 'POST' && pathname === '/flows/generate/dry-run') {
    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object') {
        badRequest(res, 'Body deve ser um objeto válido');
        return;
      }

      // Obtém tenantId do agente autenticado se disponível
      const authResult = requireAuth(req);
      const finalTenantId = body.tenantId || (authResult.valid && req.tenantId) || 'demo-tenant';

      // Usa orquestrador em modo DRY-RUN
      const result = await orchestrateGeneration(body, {
        tenantId: finalTenantId,
        dryRun: true,
      });

      if (!result.success) {
        badRequest(res, result.error || 'Erro na orquestração de geração (DRY-RUN)');
        return;
      }

      // Retorna resultado do DRY-RUN
      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro no DRY-RUN de geração:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message || 'Erro interno no DRY-RUN' });
      }
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Sistema de Geração e Validação Único
  // -----------------------------------------------------------------------

  // POST /system/check-rate-limit - Verifica rate limit sem consumir pontos
  if (method === 'POST' && pathname === '/system/check-rate-limit') {
    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object') {
        badRequest(res, 'Body deve ser um objeto válido');
        return;
      }

      // Obtém tenantId do agente autenticado se disponível
      const authResult = requireAuth(req);
      const finalTenantId = body.tenantId || (authResult.valid && req.tenantId) || 'demo-tenant';
      const userId = req.agent?.id || req.agent?.username || finalTenantId;

      // Determina tipo de operação baseado no payload
      const isBootstrap = body.bootstrap === true;
      const isDryRun = body.executionMode === 'dry-run';
      let operationType;
      if (isBootstrap) {
        operationType = 'BOOTSTRAP';
      } else if (isDryRun) {
        operationType = 'DRY_RUN';
      } else {
        operationType = 'GENERATION_REAL';
      }

      // Verifica rate limit sem consumir pontos
      const { checkRateLimitStatus } = require('../infra/rate-limit');
      const status = await checkRateLimitStatus({
        userId,
        operationType,
      });

      // Para super-admins, adiciona flag indicando que rate limit é apenas informativo
      const isSuperAdminUser = req.agent ? isSuperAdmin(req.agent) : false;
      if (isSuperAdminUser) {
        status.isSuperAdmin = true;
        status.informativeOnly = true; // Rate limit é apenas informativo, não bloqueia
      }

      sendJson(res, 200, status);
    } catch (err) {
      logger.error('Erro ao verificar rate limit:', err);
      sendJson(res, 500, { 
        error: 'internal_error', 
        message: err.message || 'Erro ao verificar rate limit' 
      });
    }
    return;
  }

  // POST /system/generate-and-validate
  if (method === 'POST' && pathname === '/system/generate-and-validate') {
    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object') {
        badRequest(res, 'Body deve ser um objeto válido');
        return;
      }

      // Obtém tenantId do agente autenticado se disponível
      const authResult = requireAuth(req);
      const finalTenantId = body.tenantId || (authResult.valid && req.tenantId) || 'demo-tenant';
      const userId = req.agent?.id || req.agent?.username || finalTenantId;
      const agentId = req.agent?.id;

      // Callback para enviar atualizações de progresso via WebSocket
      const { emitEvent } = require('./services/websocketService');
      const onProgress = (progress) => {
        if (agentId) {
          emitEvent('generation.progress', progress, { agentId });
        } else if (finalTenantId) {
          emitEvent('generation.progress', progress, { tenantId: finalTenantId });
        }
      };

      // Usa orquestrador único generate-and-validate
      const result = await generateAndValidate(body, {
        tenantId: finalTenantId,
        userId,
        agent: req.agent, // Passa agente para verificação de super-admin
      }, onProgress);

      // Trata erro de rate limit no resultado
      if (result.rateLimitExceeded) {
        sendJson(res, 429, {
          error: 'rate_limit_exceeded',
          message: result.errors[0] || 'Rate limit excedido',
          retryAfter: result.retryAfter,
        });
        return;
      }

      // Retorna resultado completo
      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else if (err.code === 'RATE_LIMIT_EXCEEDED') {
        // Garante que retryAfter é um número válido
        const retryAfter = (err.retryAfter && !isNaN(err.retryAfter) && err.retryAfter > 0)
          ? err.retryAfter
          : 60; // Fallback padrão de 60 segundos
        
        sendJson(res, 429, {
          error: 'rate_limit_exceeded',
          message: `Rate limit excedido. Tente novamente em ${retryAfter} segundos.`,
          retryAfter: retryAfter,
        });
      } else {
        logger.error('Erro em generate-and-validate:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message || 'Erro interno em generate-and-validate' });
      }
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Geração de teste RPA por IA
  // -----------------------------------------------------------------------

  // POST /flows/:flowId/generate-rpa-test
  if (method === 'POST' && pathname.match(/^\/flows\/([^\/]+)\/generate-rpa-test$/)) {
    const flowIdMatch = pathname.match(/^\/flows\/([^\/]+)\/generate-rpa-test$/);
    const flowId = flowIdMatch ? flowIdMatch[1] : null;

    if (!flowId) {
      badRequest(res, 'flowId é obrigatório na URL');
      return;
    }

    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    // Declara flowVersion no escopo do try para estar disponível no catch
    let flowVersion = 1;
    
    try {
      const body = await parseJsonBody(req);
      const { version, autoResolveDependencies = false } = body || {};

      // Obtém o fluxo
      const flow = flows.get(flowId);
      if (!flow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${flowId}" não encontrado` });
        return;
      }

      // Valida versão se fornecida
      flowVersion = version || flow.version || 1;
      if (flow.version && flow.version !== flowVersion) {
        sendJson(res, 400, { error: 'version_mismatch', message: `Versão do fluxo não corresponde. Esperado: ${flow.version}, recebido: ${flowVersion}` });
        return;
      }

      // Obtém tenantId
      const authResult = requireAuth(req);
      const tenantId = flow.tenantId || (authResult.valid && req.tenantId) || 'demo-tenant';

      // Importa serviços
      const { analyzeFlowDependencies, resolveDependencies } = require('./services/rpaTestDependencyAnalyzer');
      const { generateRpaTestFromFlow } = require('./services/rpaTestGeneratorService');

      logger.info('Iniciando geração de teste RPA por IA', { flowId, flowVersion, tenantId });

      // Passo 1: Analisa dependências
      logger.info('Passo 1: Analisando dependências do fluxo', { flowId });
      let dependencies;
      try {
        dependencies = await analyzeFlowDependencies(flow, tenantId);
        logger.debug('Dependências analisadas', {
          hasSeeds: !!dependencies.seeds,
          seedsStructure: dependencies.seeds ? Object.keys(dependencies.seeds) : [],
          missingCount: dependencies.seeds?.missing?.length || 0
        });
      } catch (depError) {
        logger.error('Erro ao analisar dependências', {
          error: depError.message,
          stack: depError.stack,
          flowId
        });
        throw new Error(`Erro ao analisar dependências: ${depError.message}`);
      }

      // Passo 2: Resolve dependências se solicitado
      let resolution = null;
      if (autoResolveDependencies && dependencies.seeds && dependencies.seeds.missing && dependencies.seeds.missing.length > 0) {
        logger.info('Passo 2: Resolvendo dependências faltantes', { 
          flowId,
          missingCount: dependencies.seeds.missing.length 
        });
        try {
          resolution = await resolveDependencies(dependencies, tenantId);
          if (resolution && resolution.executedSeeds && resolution.executedSeeds.length > 0) {
            if (!dependencies.seeds) {
              dependencies.seeds = {};
            }
            dependencies.seeds.executedSeeds = resolution.executedSeeds;
          }
        } catch (resolveError) {
          logger.error('Erro ao resolver dependências', {
            error: resolveError.message,
            stack: resolveError.stack,
            flowId
          });
          // Não falha o processo se a resolução de dependências falhar
          logger.warn('Continuando sem resolver dependências devido a erro');
        }
      }

      // Passo 3: Gera script de teste RPA por IA
      logger.info('Passo 3: Gerando script de teste RPA por IA', { flowId });
      let rpaTest;
      try {
        rpaTest = await generateRpaTestFromFlow(flow, dependencies, {
          tenantId,
          testId: `test-${flowId}-${Date.now()}`,
        });
      } catch (rpaError) {
        logger.error('Erro ao gerar teste RPA', {
          error: rpaError.message,
          stack: rpaError.stack,
          flowId
        });
        throw rpaError;
      }

      // Passo 4: Gate de validação obrigatória (IA nunca executa sem passar por aqui)
      logger.info('Passo 4: Validando plano gerado pelo gate de validação', { flowId });
      const { validateGeneratedPlanOrThrow } = require('../engine/ai/validateGeneratedPlan');
      try {
        validateGeneratedPlanOrThrow(rpaTest, 'rpa');
        logger.info('Passo 4: Validação do script concluída', { 
          flowId,
          valid: true
        });
      } catch (validationError) {
        logger.error('Gate de validação bloqueou plano RPA gerado', {
          flowId,
          error: validationError.message
        });
        throw new Error(`Validação falhou: ${validationError.message}`);
      }

      // Retorna preview completo (não salva ainda)
      const preview = {
        flowId,
        flowVersion,
        flowName: flow.name,
        dependencies,
        resolution,
        rpaTest,
        readyToSave: !rpaTest.validationWarnings || rpaTest.validationWarnings.valid,
      };

      sendJson(res, 200, preview);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao gerar teste RPA:', {
          error: err.message,
          stack: err.stack,
          flowId,
          flowVersion
        });
        
        // Mensagem de erro mais específica para diferentes tipos de erro
        let errorMessage = 'Erro interno ao gerar teste RPA';
        let errorDetails = err.message;
        
        if (err.message && err.message.includes('Serviço de IA não está disponível')) {
          errorMessage = 'Serviço de IA não disponível';
          errorDetails = 'O serviço de IA não está configurado ou não está disponível no momento. Verifique a configuração da IA e tente novamente.';
        } else if (err.message && err.message.includes('parsear resposta da IA')) {
          errorMessage = 'Erro ao processar resposta da IA';
          errorDetails = 'A resposta da IA não está em formato JSON válido. Tente novamente ou verifique a configuração da IA.';
        } else if (err.message && err.message.includes('Resposta da IA não contém texto')) {
          errorMessage = 'Resposta inválida da IA';
          errorDetails = 'A IA não retornou uma resposta válida. Verifique a configuração da IA.';
        }
        
        sendJson(res, 500, { 
          error: 'internal_error', 
          message: errorMessage, 
          details: errorDetails 
        });
      }
    }
    return;
  }

  // POST /rpa-tests (salvar teste RPA gerado)
  if (method === 'POST' && pathname === '/rpa-tests') {
    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { rpaTest } = body || {};

      if (!rpaTest || !rpaTest.id) {
        badRequest(res, 'Campo "rpaTest" é obrigatório e deve ter um "id"');
        return;
      }

      // Gate de validação obrigatória (IA nunca executa sem passar por aqui)
      // ARQUITETURA: RAG define LIMITES | Schema valida FORMA | Gate valida SEMÂNTICA
      // TODO conteúdo gerado por IA passa por este gate antes de qualquer execução
      const { validateGeneratedPlanOrThrow } = require('../engine/ai/validateGeneratedPlan');
      try {
        validateGeneratedPlanOrThrow(rpaTest, 'rpa');
      } catch (validationError) {
        logger.error('Gate de validação bloqueou plano RPA', {
          testId: rpaTest.id,
          error: validationError.message
        });
        badRequest(res, `Validação falhou: ${validationError.message}`);
        return;
      }

      // Salva o teste RPA em arquivo
      const fs = require('fs');
      const path = require('path');
      // UNIFICADO: Tudo salva em /seeds/
      const seedsDir = path.join(__dirname, '../tests/rpa/seeds');
      
      if (!fs.existsSync(seedsDir)) {
        fs.mkdirSync(seedsDir, { recursive: true });
      }

      // Adiciona flag source: automatic
      if (!rpaTest.source) {
        rpaTest.source = 'automatic';
      }

      const testFilePath = path.join(seedsDir, `${rpaTest.id}.json`);
      fs.writeFileSync(testFilePath, JSON.stringify(rpaTest, null, 2), 'utf8');

      logger.info('Teste RPA salvo com sucesso', { testId: rpaTest.id, filePath: testFilePath });

      sendJson(res, 200, {
        success: true,
        testId: rpaTest.id,
        filePath: testFilePath,
        message: 'Teste RPA salvo com sucesso',
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao salvar teste RPA:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao salvar teste RPA', details: err.message });
      }
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Simulação de fluxo
  // -----------------------------------------------------------------------

  // POST /flows/simulate
  if (method === 'POST' && pathname === '/flows/simulate') {
    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { flowId, ...options } = body || {};

      if (!flowId || typeof flowId !== 'string' || flowId.trim() === '') {
        badRequest(res, 'Campo "flowId" é obrigatório e deve ser uma string não vazia');
        return;
      }

      // Validação de opções
      if (options.maxSteps !== undefined) {
        if (typeof options.maxSteps !== 'number' || !Number.isInteger(options.maxSteps) || options.maxSteps < 1 || options.maxSteps > 1000) {
          badRequest(res, 'Campo "maxSteps" deve ser um número inteiro entre 1 e 1000');
          return;
        }
      }

      const flow = flows.get(flowId.trim());
      if (!flow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${flowId}" não encontrado` });
        return;
      }

      // Valida o fluxo antes de simular
      const validationResult = validateFlow(flow);
      if (!validationResult.valid && validationResult.errors.length > 0) {
        sendJson(res, 400, {
          error: 'flow_invalid',
          message: 'O fluxo não passou na validação e não pode ser simulado',
          errors: validationResult.errors,
        });
        return;
      }

      const result = await simulateFlow(flow, options || {});

      // Guarda eventos por sessão para permitir /replay/:sessionId
      const sessionId =
        result &&
        result.replay &&
        typeof result.replay.sessionId === 'string'
          ? result.replay.sessionId
          : null;

      if (sessionId) {
        sessionEvents.set(sessionId, Array.isArray(result.events) ? result.events : []);
        // Salva conversas após adicionar eventos
        saveSessionEventsToFile();
      }

      // Retorna resultado completo da simulação (SimulationResultUi)
      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else if (err.message && err.message.includes('excede o tamanho máximo')) {
        badRequest(res, err.message);
      } else {
        logger.error('Erro ao simular fluxo', err);
        sendJson(res, 500, {
          error: 'simulation_error',
          message: err && err.message ? err.message : 'Erro interno ao simular fluxo',
        });
      }
    }
    return;
  }

  // -----------------------------------------------------------------------
  // RPA Flow Pipeline - Resolução de Dependências e Conversão
  // -----------------------------------------------------------------------

  // POST /flows/:id/resolve-dependencies
  if (method === 'POST' && pathname.match(/^\/flows\/[^\/]+\/resolve-dependencies$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const flowId = pathname.split('/')[2];
      const flow = flows.get(flowId);
      
      if (!flow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${flowId}" não encontrado` });
        return;
      }

      const tenantId = flow.tenantId || req.tenantId;
      const resolution = await rpaDependencyResolver.resolveDependencies(flow, tenantId);

      sendJson(res, 200, resolution);
    } catch (err) {
      logger.error('Erro ao resolver dependências:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao resolver dependências' });
    }
    return;
  }

  // POST /flows/:id/preview-rpa
  if (method === 'POST' && pathname.match(/^\/flows\/[^\/]+\/preview-rpa$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const flowId = pathname.split('/')[2];
      const flow = flows.get(flowId);
      
      if (!flow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${flowId}" não encontrado` });
        return;
      }

      const preview = await previewRpaFlowPipeline(flow);

      sendJson(res, 200, preview);
    } catch (err) {
      logger.error('Erro ao gerar preview RPA:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao gerar preview RPA' });
    }
    return;
  }

  // POST /flows/:id/generate-rpa
  if (method === 'POST' && pathname.match(/^\/flows\/[^\/]+\/generate-rpa$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const flowId = pathname.split('/')[2];
      const flow = flows.get(flowId);
      
      if (!flow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${flowId}" não encontrado` });
        return;
      }

      const options = {
        autoExecuteSeeds: body.autoExecuteSeeds || false,
        saveRecording: body.saveRecording !== false,
      };

      const result = await executeRpaFlowPipeline(flow, options);

      if (result.success) {
        sendJson(res, 200, result);
      } else {
        sendJson(res, 400, result);
      }
    } catch (err) {
      logger.error('Erro ao gerar gravação RPA:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao gerar gravação RPA' });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Replay
  // -----------------------------------------------------------------------

  // GET /replay/:sessionId
  if (method === 'GET' && pathname.startsWith('/replay/')) {
    const sessionId = decodeURIComponent(pathname.slice('/replay/'.length));
    const events = sessionEvents.get(sessionId);
    if (!events) {
      sendJson(res, 404, { error: 'session_not_found' });
      return;
    }

    const replay = buildConversationReplay(events);
    sendJson(res, 200, replay);
    return;
  }

  // -----------------------------------------------------------------------
  // Conversas (Histórico completo)
  // -----------------------------------------------------------------------

  // GET /conversations - Lista todas as conversas
  if (method === 'GET' && pathname === '/conversations') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    // Compatibilidade:
    // - padrão (sem query) mantém comportamento legado (sessionEvents / replay)
    // - com ?source=channels, retorna conversas persistidas no Channel Gateway (multi-tenant)
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const source = (urlObj.searchParams.get('source') || '').toLowerCase();
    if (source === 'channels' || source === 'channel' || source === 'omnichannel') {
      const permResult = requirePermission(req, 'tickets', 'read');
      if (!permResult.allowed) {
        sendJson(res, 403, { error: 'forbidden', message: permResult.error });
        return;
      }

      try {
        const status = urlObj.searchParams.get('status');
        const channelType = urlObj.searchParams.get('channel') || urlObj.searchParams.get('channelType');
        const queue = urlObj.searchParams.get('queue');
        const limit = urlObj.searchParams.get('limit') || '100';
        const offset = urlObj.searchParams.get('offset') || '0';

        const result = await listChannelConversations({
          tenantId: req.tenantId,
          status,
          channelType,
          queue,
          limit,
          offset,
        });

        sendJson(res, 200, { conversations: result.items, total: result.total, source: 'channels' });
      } catch (err) {
        logger.error('[Conversations] Erro ao listar conversas (channels):', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar conversas (channels)' });
      }
      return;
    }

    const permResult = requirePermission(req, 'audit', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      logger.debug(`[Conversations] Listando conversas. Total de sessões em memória: ${sessionEvents.size}`);
      const conversations = [];
      for (const [sessionId, events] of sessionEvents.entries()) {
        if (!Array.isArray(events) || events.length === 0) continue;

        // Ordena eventos por timestamp
        const sortedEvents = [...events].sort((a, b) => {
          const timeA = new Date(a.timestamp).getTime();
          const timeB = new Date(b.timestamp).getTime();
          return timeA - timeB;
        });

        const firstEvent = sortedEvents[0];
        const lastEvent = sortedEvents[sortedEvents.length - 1];

        // Conta mensagens
        const messageCount = events.filter(e => e.type === 'MESSAGE_IN' || e.type === 'MESSAGE_OUT').length;
        const hasHandoff = events.some(e => e.type === 'HANDOFF');

        conversations.push({
          sessionId,
          flowId: firstEvent?.flowId || null,
          startTime: firstEvent?.timestamp || null,
          lastActivity: lastEvent?.timestamp || null,
          messageCount,
          eventCount: events.length,
          hasHandoff,
        });
      }

      // Ordena por última atividade (mais recentes primeiro)
      conversations.sort((a, b) => {
        if (!a.lastActivity) return 1;
        if (!b.lastActivity) return -1;
        return new Date(b.lastActivity) - new Date(a.lastActivity);
      });

      logger.debug(`[Conversations] Retornando ${conversations.length} conversa(s)`);
      sendJson(res, 200, { conversations });
    } catch (err) {
      logger.error('[Conversations] Erro ao listar conversas:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar conversas' });
    }
    return;
  }

  // GET /conversations/:id/messages - Lista mensagens persistidas do Channel Gateway
  // (não conflita com /conversations/:sessionId legado)
  if (method === 'GET' && pathname.match(/^\/conversations\/[^\/]+\/messages$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const conversationId = decodeURIComponent(pathname.split('/')[2]);
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const limit = urlObj.searchParams.get('limit') || '200';
      const offset = urlObj.searchParams.get('offset') || '0';

      const result = await listConversationMessages({
        tenantId: req.tenantId,
        conversationId,
        limit,
        offset,
      });

      sendJson(res, 200, { conversationId, messages: result.items, total: result.total });
    } catch (err) {
      logger.error('[Conversations] Erro ao listar mensagens (channels):', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar mensagens (channels)' });
    }
    return;
  }

  // GET /conversations/:sessionId - Obtém detalhes de uma conversa
  if (method === 'GET' && pathname.startsWith('/conversations/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'audit', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const sessionId = decodeURIComponent(pathname.slice('/conversations/'.length));
      const events = sessionEvents.get(sessionId);
      
      if (!events || !Array.isArray(events) || events.length === 0) {
        sendJson(res, 404, { error: 'conversation_not_found', message: 'Conversa não encontrada' });
        return;
      }

      const replay = buildConversationReplay(events);
      sendJson(res, 200, replay);
    } catch (err) {
      logger.error('[Conversations] Erro ao obter conversa:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter conversa' });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Sistema de Filas e Tickets
  // -----------------------------------------------------------------------

  // POST /tickets - Cria um novo ticket manualmente (para conversas iniciadas por agente)
  if (method === 'POST' && pathname === '/tickets') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const phoneNumber = body && body.phoneNumber ? String(body.phoneNumber).trim() : null;
      const queue = body && body.queue ? String(body.queue).trim() : null;
      const initialMessage = body && body.initialMessage ? String(body.initialMessage).trim() : null;

      if (!phoneNumber || phoneNumber === '') {
        badRequest(res, 'Campo "phoneNumber" é obrigatório');
        return;
      }

      if (!queue || queue === '') {
        badRequest(res, 'Campo "queue" é obrigatório');
        return;
      }

      // Valida formato do número de telefone (aceita apenas números e +)
      const phoneRegex = /^\+?[1-9]\d{10,14}$/;
      const cleanPhone = phoneNumber.replace(/\s+/g, '').replace(/[^\d+]/g, '');
      if (!phoneRegex.test(cleanPhone)) {
        badRequest(res, 'Número de telefone inválido. Use formato: +5511999999999 ou 5511999999999');
        return;
      }

      // Cria sessionId no formato padrão: whatsapp_5511999999999
      const sessionId = `whatsapp_${cleanPhone.replace(/^\+/, '')}`;

      // Verifica se já existe ticket ativo para este número
      const existingTicket = getTicketBySession(sessionId);
      if (existingTicket && existingTicket.status !== 'closed') {
        sendJson(res, 409, {
          error: 'ticket_already_exists',
          message: 'Já existe um ticket ativo para este número',
          ticket: existingTicket,
        });
        return;
      }

      // Quota: max_conversas_mes (best-effort)
      try {
        const { checkLimit } = require('./services/planLimitsService');
        const limitCheck = await checkLimit(req.tenantId, 'max_conversas_mes', 1);
        if (!limitCheck.allowed) {
          sendJson(res, 403, { error: 'limit_exceeded', message: limitCheck.error, limit: limitCheck.limit, current: limitCheck.current });
          return;
        }
      } catch (e) {
        // não bloqueia se falhar a contagem
      }

      // Cria o ticket
      const ticket = createTicket({
        tenantId: req.tenantId, // Usa tenantId do agente autenticado
        sessionId,
        queue,
        lastUserMessage: null, // Não há mensagem do usuário ainda
        context: {
          flowId: null,
          escalationReason: 'manual_agent_initiated',
          escalationAttempt: 0,
          botHistory: [], // Sem histórico do bot, pois foi iniciado por agente
          variables: {},
          allowReturnToBot: false, // Conversas iniciadas por agente não retornam ao bot
          safeReturnNode: null,
          metadata: {
            initiatedBy: 'agent',
            initiatedByAgentId: req.agent.id,
            initiatedByAgentUsername: req.agent.username,
            channel: 'whatsapp',
          },
        },
      });

      // Auto-assign best-effort (se a fila estiver configurada com estratégia automática)
      autoAssignTicket(ticket.id).catch(() => null);

      // Se há mensagem inicial, envia e adiciona ao histórico
      if (initialMessage && initialMessage !== '') {
        try {
          // Adiciona mensagem do agente ao histórico
          addAgentMessage(ticket.id, initialMessage, req.agent.id);

          // Envia mensagem via WhatsApp
          await sendTextMessage(cleanPhone, initialMessage);
          logger.info('[Ticket] Ticket criado e mensagem inicial enviada', {
            ticketId: ticket.id,
            phoneNumber: cleanPhone,
            agentId: req.agent.id,
          });
        } catch (whatsappError) {
          // Se falhar ao enviar, ainda retorna o ticket criado
          logger.warn('[Ticket] Ticket criado mas falha ao enviar mensagem inicial', {
            ticketId: ticket.id,
            phoneNumber: cleanPhone,
            error: whatsappError.message,
          });
        }
      }

      // Dispara webhooks e WebSocket
      const tenantId = req.tenantId;
      triggerWebhooks(tenantId, 'ticket.created', {
        ticketId: ticket.id,
        queue: ticket.queue,
        phoneNumber: cleanPhone,
        agentId: req.agent.id,
      }).catch((err) => {
        logger.error('[Webhook] Erro ao disparar webhook para ticket.created:', err);
      });

      // Inclui ticket completo no evento WebSocket para evitar requisições HTTP no frontend
      emitEvent('ticket.created', {
        ticketId: ticket.id,
        queue: ticket.queue,
        phoneNumber: cleanPhone,
        agentId: req.agent.id,
        ticket: ticket, // Ticket completo para atualização local sem requisição HTTP
      }, { tenantId });

      // Registra ação de auditoria
      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'ticket_create_manual',
        resource: 'ticket',
        resourceId: ticket.id,
        details: {
          phoneNumber: cleanPhone,
          queue,
          hasInitialMessage: !!initialMessage,
        },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 201, ticket);
      return;
    } catch (err) {
      logger.error('[Ticket] Erro ao criar ticket manualmente', {
        error: err.message,
        stack: err.stack,
      });
      sendJson(res, 500, {
        error: 'internal_error',
        message: 'Erro ao criar ticket',
      });
      return;
    }
  }

  // GET /queues - Lista todas as filas disponíveis
  if (method === 'GET' && pathname === '/queues') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'queues', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    // Compatibilidade: mantém retorno como array de strings.
    // Agora inclui também definições persistidas na tabela `queues` (por tenant).
    const legacy = listQueues() || [];
    const defs = queueDefinitionService.listQueues({ tenantId: req.tenantId }).map((q) => q.name);
    const merged = Array.from(new Set([...legacy, ...defs])).sort();
    sendJson(res, 200, merged);
    return;
  }

  // -----------------------------------------------------------------------
  // Channel Accounts (CRUD) - multi-tenant
  // -----------------------------------------------------------------------

  // GET /channel-accounts
  if (method === 'GET' && pathname === '/channel-accounts') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const includeConfig = urlObj.searchParams.get('includeConfig') === 'true';
      const { listAccounts } = require('./services/channelAccountsService');
      const accounts = await listAccounts({ tenantId: req.tenantId, includeConfig });
      sendJson(res, 200, { accounts });
    } catch (err) {
      logger.error('Erro ao listar channel-accounts', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // POST /channel-accounts
  if (method === 'POST' && pathname === '/channel-accounts') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { type, externalId, status, config } = body || {};
      const { createAccount } = require('./services/channelAccountsService');
      const result = await createAccount({ tenantId: req.tenantId, type, externalId, status, config });
      if (!result.success) {
        sendJson(res, 400, { error: result.error });
        return;
      }
      sendJson(res, 201, result);
    } catch (err) {
      logger.error('Erro ao criar channel-account', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // POST /channel-accounts/:id/test - Testa credenciais do canal (best-effort)
  // IMPORTANTE: deve vir ANTES do PUT /channel-accounts/:id
  if (method === 'POST' && pathname.startsWith('/channel-accounts/') && pathname.endsWith('/test')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/channel-accounts/'.length).replace('/test', ''));
      const { testAccountConnection } = require('./services/channelAccountsService');
      const result = await testAccountConnection({ tenantId: req.tenantId, id, timeoutMs: 8000 });
      if (!result.success) {
        if (result.error === 'not_found') {
          sendJson(res, 404, { error: 'not_found' });
          return;
        }
        if (result.error === 'missing_config') {
          sendJson(res, 400, { error: 'missing_config', missing: result.missing || [] });
          return;
        }
        sendJson(res, 502, { error: result.error || 'upstream_error', message: result.message, details: result.details, statusCode: result.statusCode });
        return;
      }
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao testar channel-account', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // PUT /channel-accounts/:id
  if (method === 'PUT' && pathname.startsWith('/channel-accounts/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/channel-accounts/'.length));
      const body = await parseJsonBody(req);
      const { updateAccount } = require('./services/channelAccountsService');
      const result = await updateAccount({ tenantId: req.tenantId, id, patch: body || {} });
      if (!result.success) {
        sendJson(res, result.error === 'not_found' ? 404 : 400, { error: result.error });
        return;
      }
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao atualizar channel-account', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // DELETE /channel-accounts/:id
  if (method === 'DELETE' && pathname.startsWith('/channel-accounts/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/channel-accounts/'.length));
      const { deleteAccount } = require('./services/channelAccountsService');
      const result = await deleteAccount({ tenantId: req.tenantId, id });
      if (!result.success) {
        sendJson(res, result.error === 'not_found' ? 404 : 400, { error: result.error });
        return;
      }
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao remover channel-account', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // POST /queues - Cria uma nova fila
  if (method === 'POST' && pathname === '/queues') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'queues', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const queueName = body && body.name ? String(body.name) : null;

      if (!queueName) {
        badRequest(res, 'Campo "name" é obrigatório');
        return;
      }

      const result = createQueue(queueName);
      
      if (result.success) {
        // Persistência best-effort de metadados de fila (roteamento/prioridade)
        queueDefinitionService.upsertQueue({
          tenantId: req.tenantId,
          name: result.queueName,
          routingStrategy: 'manual',
          priority: 0,
          active: true,
        }).catch(() => {});

        // Registra ação de auditoria
        logAction({
          agentId: req.agent.id,
          username: req.agent.username,
          action: 'queue_create',
          resource: 'queue',
          resourceId: result.queueName,
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        });

        sendJson(res, result.message === 'Fila já existe' ? 200 : 201, result);
      } else {
        badRequest(res, result.message);
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar fila', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao processar requisição' });
      }
    }
    return;
  }

  // GET /queues/:name - Obtém informações sobre uma fila
  if (method === 'GET' && pathname.startsWith('/queues/') && !pathname.endsWith('/tickets')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'queues', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const queueName = decodeURIComponent(pathname.slice('/queues/'.length));
    const info = getQueueInfo(queueName);
    
    if (info === null) {
      badRequest(res, 'Nome da fila inválido');
      return;
    }
    
    sendJson(res, 200, info);
    return;
  }

  // DELETE /queues/:name - Exclui uma fila
  if (method === 'DELETE' && pathname.startsWith('/queues/') && !pathname.endsWith('/tickets')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'queues', 'delete');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const queueName = decodeURIComponent(pathname.slice('/queues/'.length));
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const force = urlObj.searchParams.get('force') === 'true';

    const result = deleteQueue(queueName, force);
    
    if (result.success) {
      // Registra ação de auditoria
      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'queue_delete',
        resource: 'queue',
        resourceId: queueName,
        details: { force, deletedTickets: result.deletedTickets || 0 },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result);
    } else {
      if (result.message.includes('não encontrada')) {
        sendJson(res, 404, result);
      } else {
        sendJson(res, 400, result);
      }
    }
    return;
  }

  // GET /queues/:queue/tickets - Lista tickets de uma fila
  if (method === 'GET' && pathname.startsWith('/queues/') && pathname.endsWith('/tickets')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const queue = decodeURIComponent(pathname.slice('/queues/'.length, -'/tickets'.length));
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const status = urlObj.searchParams.get('status'); // opcional: ?status=waiting

    let tickets = listQueue(queue, { 
      tenantId: req.tenantId, // Filtro por tenant
      ...(status ? { status } : {})
    });
    
    // Filtra tickets por permissão (agent só vê próprios ou não atribuídos)
    if (req.agent.role === 'agent') {
      tickets = tickets.filter((ticket) => 
        canAccessTicket(req.agent, ticket)
      );
    }

    sendJson(res, 200, tickets);
    return;
  }

  // GET /tickets - Lista todos os tickets (com filtros opcionais e paginação)
  if (method === 'GET' && pathname === '/tickets') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const urlObj = new URL(req.url || '/', 'http://localhost');
    const status = urlObj.searchParams.get('status');
    const queue = urlObj.searchParams.get('queue');
    const limit = urlObj.searchParams.get('limit');
    const offset = urlObj.searchParams.get('offset');

    // Log para identificar origem das requisições
    logger.debug('[Server] GET /tickets chamado', {
      agentId: req.agent?.id,
      username: req.agent?.username,
      status,
      queue,
      limit,
      offset,
      userAgent: req.headers['user-agent']?.substring(0, 50),
      referer: req.headers['referer']?.substring(0, 50),
    });

    const result = listAllTickets({ 
      tenantId: req.tenantId, // Filtro por tenant
      status, 
      queue,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    
    // Filtra tickets por permissão (agent só vê próprios ou não atribuídos)
    if (req.agent.role === 'agent') {
      result.tickets = result.tickets.filter((ticket) => 
        canAccessTicket(req.agent, ticket)
      );
      result.total = result.tickets.length;
    }
    
    // Log para debug
    logger.info('Tickets retornados', {
      total: result.total,
      ticketsCount: result.tickets?.length || 0,
      limit: result.limit,
      offset: result.offset,
      agentRole: req.agent.role,
    });
    
    sendJson(res, 200, result);
    return;
  }

  // GET /tickets/session/:sessionId - Obtém ticket ativo de uma sessão (verificar antes de /tickets/:id)
  if (method === 'GET' && pathname.startsWith('/tickets/session/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const sessionId = decodeURIComponent(pathname.slice('/tickets/session/'.length));
    const ticket = getTicketBySession(sessionId);
    if (!ticket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return;
    }

    // Verifica se pode acessar o ticket
    if (!canAccessTicket(req.agent, ticket)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você não tem permissão para acessar este ticket' });
      return;
    }

    sendJson(res, 200, ticket);
    return;
  }

  // GET /tickets/:id/messages - Obtém histórico de mensagens de um ticket (verificar antes de /tickets/:id)
  if (method === 'GET' && pathname.startsWith('/tickets/') && pathname.endsWith('/messages')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/messages'.length));
    const ticket = getTicket(id);
    
    if (!ticket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return;
    }

    // Valida tenant
    if (req.tenantId && ticket.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
      return;
    }

    // Verifica se pode acessar o ticket
    if (!canAccessTicket(req.agent, ticket)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você não tem permissão para acessar este ticket' });
      return;
    }

    const messages = getTicketMessages(id);
    sendJson(res, 200, { ticketId: id, messages });
    return;
  }

  // POST /tickets/:id/assign - Atribui um ticket para um atendente
  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/assign')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'assign');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/assign'.length));
    const ticket = getTicket(id);
    
    if (!ticket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return;
    }

    // Valida tenant
    if (req.tenantId && ticket.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      // Se não especificar assignedTo, atribui para o agente autenticado
      // Se especificar, verifica permissão (apenas admin/supervisor podem atribuir para outros)
      let assignedTo = req.agent.id;
      
      if (body && body.assignedTo) {
        // Admin e supervisor podem atribuir para qualquer agente
        if (req.agent.role === 'admin' || req.agent.role === 'supervisor') {
          assignedTo = String(body.assignedTo);
        } else {
          // Agent comum só pode atribuir para si mesmo
          assignedTo = req.agent.id;
        }
      }

      const updatedTicket = assignTicket(id, assignedTo);
      if (!updatedTicket) {
        sendJson(res, 404, { error: 'ticket_not_found' });
        return;
      }

      // Dispara webhooks e WebSocket
      const tenantId = req.tenantId;
      triggerWebhooks(tenantId, 'ticket.assigned', {
        ticketId: id,
        assignedTo,
        assignedBy: req.agent.id,
      }).catch((err) => {
        logger.error('[Webhook] Erro ao disparar webhook para ticket.assigned:', err);
      });

      // Inclui ticket completo no evento WebSocket para evitar requisições HTTP no frontend
      emitEvent('ticket.assigned', {
        ticketId: id,
        assignedTo,
        assignedBy: req.agent.id,
        ticket: updatedTicket, // Ticket completo para atualização local sem requisição HTTP
      }, { tenantId, agentId: assignedTo });

      // Registra ação de auditoria
      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'ticket_assign',
        resource: 'ticket',
        resourceId: id,
        details: { assignedTo },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, updatedTicket);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atribuir ticket:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // POST /tickets/:id/takeover - Assumir atendimento humano (handover bot -> humano)
  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/takeover')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/takeover'.length));
    const ticket = getTicket(id);
    if (!ticket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return;
    }

    // Valida tenant
    if (req.tenantId && ticket.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
      return;
    }

    let reason = 'agent_takeover';
    if (hasJsonContentType(req)) {
      try {
        const body = await parseJsonBody(req);
        if (body?.reason) reason = String(body.reason);
      } catch (e) {
        // ignora body inválido e usa default
      }
    }

    const result = await takeOverTicket(id, req.agent, reason);
    if (!result.success) {
      sendJson(res, 400, { error: result.error || 'handover_failed' });
      return;
    }

    // Auditoria
    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      tenantId: req.tenantId,
      action: 'ticket_takeover',
      resource: 'ticket',
      resourceId: id,
      details: { reason },
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, result.ticket);
    return;
  }

  // POST /tickets/:id/return-to-bot - Devolver atendimento ao bot (handover humano -> bot)
  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/return-to-bot')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/return-to-bot'.length));
    const ticket = getTicket(id);
    if (!ticket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return;
    }

    // Valida tenant
    if (req.tenantId && ticket.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
      return;
    }

    let reason = 'user_request';
    if (hasJsonContentType(req)) {
      try {
        const body = await parseJsonBody(req);
        if (body?.reason) reason = String(body.reason);
      } catch (e) {
        // ignora
      }
    }

    const result = await returnTicketToBot(id, req.agent, reason);
    if (!result.success) {
      sendJson(res, 400, { error: result.error || 'handover_failed' });
      return;
    }

    // Auditoria
    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      tenantId: req.tenantId,
      action: 'ticket_return_to_bot',
      resource: 'ticket',
      resourceId: id,
      details: { reason },
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, result.ticket);
    return;
  }

  // POST /tickets/:id/close - Fecha um ticket
  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/close')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'close');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/close'.length));
    const ticket = getTicket(id);
    
    if (!ticket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return;
    }

    // Valida tenant
    if (req.tenantId && ticket.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
      return;
    }

    // Verifica se pode modificar o ticket
    if (!canModifyTicket(req.agent, ticket)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você não tem permissão para fechar este ticket' });
      return;
    }

    // Motivo de encerramento (opcional, compatível com chamadas antigas sem body)
    if (hasJsonContentType(req)) {
      try {
        const body = await parseJsonBody(req);
        const closeReasonId = body?.closeReasonId ? String(body.closeReasonId) : null;
        const closeReasonName = body?.closeReasonName ? String(body.closeReasonName) : null;

        let closeReason = null;
        if (closeReasonId) {
          closeReason = closeReasonsService.getCloseReason(closeReasonId);
        }
        if (!closeReason && closeReasonName) {
          closeReason = { id: null, name: closeReasonName };
        }

        if (closeReason) {
          // atualiza ticket para que closeTicket escreva system message com motivo
          const { updateTicket } = require('./services/queueService');
          updateTicket(id, {
            context: {
              ...(ticket.context || {}),
              closeReason: { id: closeReason.id || null, name: closeReason.name },
              closeReasonName: closeReason.name,
              closedBy: { id: req.agent.id, username: req.agent.username },
              closedAt: new Date().toISOString(),
            },
          });
        }
      } catch (e) {
        // ignora body inválido
      }
    }

    const closedTicket = closeTicket(id);
    if (!closedTicket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return;
    }

    // Dispara webhooks e WebSocket
    const tenantId = req.tenantId;
    triggerWebhooks(tenantId, 'ticket.closed', {
      ticketId: id,
      closedBy: req.agent.id,
    }).catch((err) => {
      logger.error('[Webhook] Erro ao disparar webhook para ticket.closed:', err);
    });

    // Inclui ticket completo no evento WebSocket para evitar requisições HTTP no frontend
    emitEvent('ticket.closed', {
      ticketId: id,
      closedBy: req.agent.id,
      ticket: closedTicket, // Ticket completo para atualização local sem requisição HTTP
    }, { tenantId, agentId: closedTicket.assignedTo });

    // Registra ação de auditoria
    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      action: 'ticket_close',
      resource: 'ticket',
      resourceId: id,
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, closedTicket);
    return;
  }

  // -----------------------------------------------------------------------
  // Close Reasons
  // -----------------------------------------------------------------------

  // GET /close-reasons - Lista motivos de encerramento do tenant
  if (method === 'GET' && pathname === '/close-reasons') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const activeOnly = urlObj.searchParams.get('activeOnly');
      const list = closeReasonsService.listCloseReasons({
        tenantId: req.tenantId,
        activeOnly: activeOnly === null ? true : activeOnly !== 'false',
      });
      sendJson(res, 200, { closeReasons: list });
    } catch (err) {
      logger.error('Erro ao listar close reasons:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Ticket Insights (Resumo IA)
  // -----------------------------------------------------------------------

  // GET /tickets/:id/ai-summary - Retorna resumo IA (cache)
  if (method === 'GET' && pathname.startsWith('/tickets/') && pathname.endsWith('/ai-summary')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/ai-summary'.length));
      const { getTicket } = require('./services/queueService');
      const ticket = getTicket(id);
      if (!ticket) {
        sendJson(res, 404, { error: 'ticket_not_found' });
        return;
      }

      if (req.tenantId && ticket.tenantId !== req.tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
        return;
      }

      const result = ticketInsightService.getAiSummary(id);
      if (!result.success) {
        sendJson(res, 404, { error: result.error });
        return;
      }
      sendJson(res, 200, { summary: result.summary });
    } catch (err) {
      logger.error('Erro ao obter ai-summary:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // POST /tickets/:id/ai-summary - Gera/atualiza resumo IA
  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/ai-summary')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/ai-summary'.length));
      const { getTicket } = require('./services/queueService');
      const ticket = getTicket(id);
      if (!ticket) {
        sendJson(res, 404, { error: 'ticket_not_found' });
        return;
      }

      if (req.tenantId && ticket.tenantId !== req.tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
        return;
      }

      const result = await ticketInsightService.generateAiSummary({
        ticketId: id,
        tenantId: req.tenantId,
        agent: req.agent,
      });

      if (!result.success) {
        sendJson(res, 400, { error: result.error });
        return;
      }

      sendJson(res, 200, { summary: result.summary });
    } catch (err) {
      logger.error('Erro ao gerar ai-summary:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // POST /queues/reload - Recarrega tickets e filas do arquivo JSON
  if (method === 'POST' && pathname === '/queues/reload') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'queues', 'admin');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      logger.info('Recarregando dados de filas e tickets do arquivo...');
      
      // Obtém estado atual antes de recarregar
      const allTicketsBefore = listAllTickets();
      const queuesBefore = listQueues();
      const ticketsBefore = allTicketsBefore.tickets.length;
      const queuesCountBefore = queuesBefore.length;
      
      // Recarrega dados do arquivo
      // Dados agora estão no banco de dados PostgreSQL
      
      // Obtém estado após recarregar
      const allTicketsAfter = listAllTickets();
      const queuesAfter = listQueues();
      const ticketsAfter = allTicketsAfter.tickets.length;
      const queuesCountAfter = queuesAfter.length;
      
      logger.info('Dados recarregados com sucesso', {
        ticketsAntes: ticketsBefore,
        ticketsDepois: ticketsAfter,
        filasAntes: queuesCountBefore,
        filasDepois: queuesCountAfter,
      });

      // Registra ação de auditoria
      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'queue_reload',
        resource: 'queue',
        details: {
          before: { tickets: ticketsBefore, queues: queuesCountBefore },
          after: { tickets: ticketsAfter, queues: queuesCountAfter },
        },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });
      
      sendJson(res, 200, {
        success: true,
        message: 'Dados recarregados com sucesso',
        before: {
          tickets: ticketsBefore,
          queues: queuesCountBefore,
        },
        after: {
          tickets: ticketsAfter,
          queues: queuesCountAfter,
        },
      });
      return;
    } catch (error) {
      logger.error('Erro ao recarregar dados', error);
      sendJson(res, 500, {
        success: false,
        error: 'Erro ao recarregar dados',
        message: error.message,
      });
      return;
    }
  }

  // GET /metrics/queues - Obtém métricas do sistema de filas
  if (method === 'GET' && pathname === '/metrics/queues') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'queues', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    // eslint-disable-next-line no-console
    console.log('========================================');
    // eslint-disable-next-line no-console
    console.log('[Server] ⚡ Endpoint /metrics/queues CHAMADO!');
    // eslint-disable-next-line no-console
    console.log('========================================');
    logger.info('Endpoint /metrics/queues chamado');
    try {
      // eslint-disable-next-line no-console
      console.log('[Server] Chamando getMetrics()...');
      logger.info('Chamando getMetrics()...');
      const metrics = getMetrics();
      // Log para debug
      // eslint-disable-next-line no-console
      console.log('[Server] ✅ Métricas retornadas:', JSON.stringify({
        totalTickets: metrics.totalTickets,
        ticketsByStatus: metrics.ticketsByStatus,
        ticketsByQueue: metrics.ticketsByQueue,
      }, null, 2));
      logger.info('Métricas retornadas', {
        totalTickets: metrics.totalTickets,
        ticketsByStatus: metrics.ticketsByStatus,
        ticketsByQueue: Object.keys(metrics.ticketsByQueue).length,
        queueDetails: metrics.ticketsByQueue,
      });
      
      // Adiciona timestamp para evitar cache
      const responseData = {
        ...metrics,
        _timestamp: Date.now(),
      };
      
      // eslint-disable-next-line no-console
      console.log('[Server] 📤 Enviando resposta:', JSON.stringify(responseData, null, 2));
      
      sendJson(res, 200, responseData);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Server] ❌ Erro ao obter métricas:', error);
      logger.error('Erro ao obter métricas', error);
      sendJson(res, 500, { error: 'Erro ao obter métricas', message: error.message });
    }
    return;
  }

  // GET /tickets/:id - Obtém um ticket específico (verificar por último, após todas as rotas específicas)
  if (method === 'GET' && pathname.startsWith('/tickets/') && 
      !pathname.endsWith('/messages') && 
      !pathname.endsWith('/assign') && 
      !pathname.endsWith('/close') && 
      !pathname.endsWith('/mark-read') && 
      !pathname.endsWith('/message') &&
      !pathname.startsWith('/tickets/session/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const id = decodeURIComponent(pathname.slice('/tickets/'.length));
    const ticket = getTicket(id);
    if (!ticket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return;
    }

    // Valida tenant
    if (req.tenantId && ticket.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
      return;
    }

    // Verifica se pode acessar o ticket
    if (!canAccessTicket(req.agent, ticket)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você não tem permissão para acessar este ticket' });
      return;
    }

    sendJson(res, 200, ticket);
    return;
  }

  // POST /tickets/:id/mark-read - Marca mensagens como lidas
  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/mark-read')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/mark-read'.length));
    const ticket = getTicket(id);
    
    if (!ticket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return;
    }

    // Valida tenant
    if (req.tenantId && ticket.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
      return;
    }

    // Verifica se pode acessar o ticket
    if (!canAccessTicket(req.agent, ticket)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você não tem permissão para acessar este ticket' });
      return;
    }

    const updatedTicket = markMessagesAsRead(id);
    
    if (!updatedTicket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return;
    }

    sendJson(res, 200, { success: true, ticketId: id });
    return;
  }

  // POST /tickets/:id/message - Envia mensagem do atendente para o usuário
  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/message')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/message'.length));

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const message = body && body.message ? String(body.message) : null;

      if (!message || message.trim() === '') {
        badRequest(res, 'Campo "message" é obrigatório e não pode estar vazio');
        return;
      }

      const ticket = getTicket(id);
      if (!ticket) {
        sendJson(res, 404, { error: 'ticket_not_found' });
        return;
      }

      // Valida tenant
      if (req.tenantId && ticket.tenantId !== req.tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
        return;
      }

      // Verifica se pode modificar o ticket
      if (!canModifyTicket(req.agent, ticket)) {
        sendJson(res, 403, { error: 'forbidden', message: 'Você não tem permissão para enviar mensagens neste ticket' });
        return;
      }

      if (ticket.status === 'closed') {
        badRequest(res, 'Não é possível enviar mensagem para um ticket fechado');
        return;
      }

      // Usa agentId do agente autenticado
      const agentId = req.agent.id;
      try {
        const updatedTicket = addAgentMessage(id, message, agentId);
        if (!updatedTicket) {
          logger.warn('[Ticket] Não foi possível adicionar mensagem ao histórico (ticket não encontrado)', { ticketId: id });
          sendJson(res, 404, { error: 'ticket_not_found' });
          return;
        }
      } catch (addMessageError) {
        logger.error('[Ticket] Erro ao adicionar mensagem ao histórico', {
          ticketId: id,
          error: addMessageError.message,
          stack: addMessageError.stack,
        });
        sendJson(res, 500, {
          error: 'internal_error',
          message: 'Erro ao salvar mensagem no histórico do ticket',
        });
        return;
      }

      // Tenta enviar mensagem via WhatsApp
      const phoneNumber = ticket.phoneNumber;
      if (!phoneNumber) {
        logger.warn('[Ticket] Número de telefone não encontrado no ticket, mensagem salva apenas no histórico', { ticketId: id });
      } else {
        try {
          await sendTextMessage(phoneNumber, message);
          logger.info('[Ticket] Mensagem enviada via WhatsApp com sucesso', { ticketId: id, phoneNumber });
        } catch (whatsappError) {
          // Se o erro for de credenciais inválidas, apenas loga um aviso e continua
          // Isso permite que o sistema funcione em modo de desenvolvimento/teste
          if (whatsappError.message && whatsappError.message.includes('credentials')) {
            logger.warn('[Ticket] Mensagem salva no histórico, mas não foi enviada via WhatsApp (credenciais inválidas)', {
              ticketId: id,
              phoneNumber,
              error: whatsappError.message,
            });
          } else {
            // Para outros erros do WhatsApp, também loga mas continua
            logger.warn('[Ticket] Mensagem salva no histórico, mas falha ao enviar via WhatsApp', {
              ticketId: id,
              phoneNumber,
              error: whatsappError.message,
            });
          }
        }
      }

      // Dispara webhooks e WebSocket
      const tenantId = req.tenantId;
      triggerWebhooks(tenantId, 'ticket.message.sent', {
        ticketId: id,
        agentId: req.agent.id,
        message,
      }).catch((err) => {
        logger.error('[Webhook] Erro ao disparar webhook para ticket.message.sent:', err);
      });

      // Inclui ticket completo no evento WebSocket para evitar requisições HTTP no frontend
      emitEvent('ticket.message.sent', {
        ticketId: id,
        agentId: req.agent.id,
        message,
        ticket: ticket, // Ticket completo para atualização local sem requisição HTTP
      }, { tenantId, agentId: ticket.assignedTo });

      // Registra ação de auditoria
      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'ticket_message',
        resource: 'ticket',
        resourceId: id,
        details: { messageLength: message.length },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, {
        success: true,
        ticketId: id,
        message,
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao enviar mensagem:', err);
        sendJson(res, 500, {
          error: 'internal_error',
          message: err.message || 'Erro ao enviar mensagem via WhatsApp',
        });
      }
    }
    return;
  }

  // -----------------------------------------------------------------------
  // API de IA
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // API Interna de Geração por IA (Wrappers)
  // -----------------------------------------------------------------------

  // POST /ai/chatbot/generate - Gera fluxo de chatbot via wrapper oficial
  if (method === 'POST' && pathname === '/ai/chatbot/generate') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { userInput, options = {} } = body || {};

      if (!userInput || typeof userInput !== 'string' || userInput.trim() === '') {
        badRequest(res, 'Campo "userInput" é obrigatório e deve ser uma string não vazia');
        return;
      }

      logger.info('[API] Geração de chatbot via wrapper', {
        inputLength: userInput.length
      });

      // Chama wrapper oficial
      const wrapperResult = await generateChatbotFlow(userInput, options);

      // Converte para formato IaGenerationResult
      const iaResult = {
        success: wrapperResult.success,
        domain: 'chatbot',
        meta: {
          prompt: 'chatbot.generator.prompt.md',
          ragVersion: null,
          timestamp: new Date().toISOString()
        }
      };

      if (wrapperResult.success) {
        iaResult.data = {
          flow: wrapperResult.flow,
          validation: wrapperResult.validation,
          promptVersion: wrapperResult.promptVersion
        };
      } else {
        iaResult.errors = wrapperResult.error ? [{
          code: wrapperResult.error.type || 'GENERATION_ERROR',
          message: wrapperResult.error.message || 'Erro na geração',
          source: wrapperResult.error.type === 'VALIDATION_FAILED' ? 'gate' : 'validator'
        }] : [];
      }

      sendJson(res, wrapperResult.success ? 200 : 400, iaResult);
    } catch (err) {
      logger.error('[API] Erro ao gerar chatbot', { error: err.message, stack: err.stack });
      sendJson(res, 500, {
        success: false,
        domain: 'chatbot',
        meta: {
          prompt: 'chatbot.generator.prompt.md',
          ragVersion: null,
          timestamp: new Date().toISOString()
        },
        errors: [{
          code: 'INTERNAL_ERROR',
          message: err.message || 'Erro interno ao gerar chatbot',
          source: 'validator'
        }]
      });
    }
    return;
  }

  // POST /ai/rpa/generate - Gera teste RPA via wrapper oficial
  if (method === 'POST' && pathname === '/ai/rpa/generate') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { userInput, options = {} } = body || {};

      if (!userInput || typeof userInput !== 'string' || userInput.trim() === '') {
        badRequest(res, 'Campo "userInput" é obrigatório e deve ser uma string não vazia');
        return;
      }

      logger.info('[API] Geração de RPA via wrapper', {
        inputLength: userInput.length
      });

      // Chama wrapper oficial
      const wrapperResult = await generateRpaTest(userInput, options);

      // Converte para formato IaGenerationResult
      const iaResult = {
        success: wrapperResult.success,
        domain: 'rpa',
        meta: {
          prompt: 'rpa.generator.prompt.md',
          ragVersion: null,
          timestamp: new Date().toISOString()
        }
      };

      if (wrapperResult.success) {
        iaResult.data = {
          plan: wrapperResult.plan,
          validation: wrapperResult.validation,
          promptVersion: wrapperResult.promptVersion
        };
      } else {
        iaResult.errors = wrapperResult.error ? [{
          code: wrapperResult.error.type || 'GENERATION_ERROR',
          message: wrapperResult.error.message || 'Erro na geração',
          source: wrapperResult.error.type === 'VALIDATION_FAILED' ? 'gate' : 'validator'
        }] : [];
      }

      sendJson(res, wrapperResult.success ? 200 : 400, iaResult);
    } catch (err) {
      logger.error('[API] Erro ao gerar RPA', { error: err.message, stack: err.stack });
      sendJson(res, 500, {
        success: false,
        domain: 'rpa',
        meta: {
          prompt: 'rpa.generator.prompt.md',
          ragVersion: null,
          timestamp: new Date().toISOString()
        },
        errors: [{
          code: 'INTERNAL_ERROR',
          message: err.message || 'Erro interno ao gerar RPA',
          source: 'validator'
        }]
      });
    }
    return;
  }

  // POST /api/ai/generate - Gera resposta de IA
  if (method === 'POST' && pathname === '/api/ai/generate') {
    if (!hasJsonContentType(req)) {
      logger.warn('Requisição de IA sem Content-Type JSON');
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { prompt, sessionId, flowId, nodeId, tenantId } = body || {};

      logger.debug('Requisição de IA recebida', {
        promptLength: prompt?.length,
        sessionId,
        flowId,
        nodeId,
        tenantId,
      });

      if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
        logger.warn('Prompt inválido na requisição de IA', { prompt, type: typeof prompt });
        badRequest(res, 'Campo "prompt" é obrigatório e deve ser uma string não vazia');
        return;
      }

      const effectiveTenantId = tenantId || req.tenantId;
      logger.debug('Usando tenant para IA', { effectiveTenantId });

      try {
        logger.debug('Gerando resposta de IA...', {
          tenantId: effectiveTenantId,
          promptPreview: prompt.substring(0, 100),
        });
        
        const result = await generateAiResponse(prompt, effectiveTenantId, {
          sessionId,
          flowId,
          nodeId,
        });

        logger.debug('Resposta de IA gerada com sucesso', {
          hasText: !!result?.text,
          textLength: result?.text?.length,
          hasUsage: !!result?.usage,
        });

        sendJson(res, 200, {
          text: typeof result === 'string' ? result : result.text,
          usage: result.usage || null,
        });
      } catch (aiError) {
        logger.error('Erro ao gerar resposta de IA', {
          message: aiError.message,
          stack: aiError.stack,
          tenantId: effectiveTenantId,
          promptPreview: prompt.substring(0, 100),
        });
        sendJson(res, 500, {
          error: 'ai_generation_failed',
          message: aiError.message || 'Erro ao gerar resposta de IA',
          details: process.env.NODE_ENV === 'development' ? aiError.stack : undefined,
        });
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        logger.warn('JSON inválido na requisição de IA', { message: err.message });
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao processar requisição de IA', {
          message: err.message,
          stack: err.stack,
        });
        sendJson(res, 500, {
          error: 'internal_error',
          message: err.message || 'Erro ao processar requisição',
        });
      }
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Webhook do WhatsApp
  // -----------------------------------------------------------------------

  // GET /webhooks/whatsapp - verificação do webhook (setup no painel Meta)
  if (method === 'GET' && pathname === '/webhooks/whatsapp') {
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const mode = urlObj.searchParams.get('hub.mode');
    const token = urlObj.searchParams.get('hub.verify_token');
    const challenge = urlObj.searchParams.get('hub.challenge');

    if (verifyWebhook(mode, token)) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge || '');
      return;
    }

    sendJson(res, 403, { error: 'forbidden' });
    return;
  }

  // POST /webhooks/whatsapp - mensagens recebidas do WhatsApp
  if (method === 'POST' && pathname === '/webhooks/whatsapp') {
    try {
      const body = await parseJsonBody(req);

      if (body.object === 'whatsapp_business_account') {
        const entries = body.entry || [];
        for (const entry of entries) {
          const changes = entry.changes || [];
          for (const change of changes) {
            if (change.field === 'messages') {
              const value = change.value || {};
              // Atualiza status delivery/read/failed quando disponível (best-effort)
              if (Array.isArray(value.statuses) && value.statuses.length > 0) {
                // eslint-disable-next-line no-await-in-loop
                await channelGatewayService.updateStatus('whatsapp', { value }).catch(() => null);
              }
              const messages = value.messages || [];
              for (const msg of messages) {
                // Persiste no gateway (best-effort) antes do processamento do bot
                // eslint-disable-next-line no-await-in-loop
                await channelGatewayService.ingestIncoming('whatsapp', { message: msg, value, raw: body }).catch(() => null);
                // Processa cada mensagem
                // eslint-disable-next-line no-await-in-loop
                await processWhatsAppMessage(msg, value, {
                  flows,
                  sessionEvents,
                  saveSessionEvents: saveSessionEventsToFile,
                });
              }
            }
          }
        }
      }

      sendJson(res, 200, { success: true });
    } catch (err) {
      logger.error('Erro no webhook WhatsApp:', err);
      sendJson(res, 500, { 
        error: 'internal_error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Erro interno ao processar webhook'
      });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Webhooks do Facebook Messenger
  // -----------------------------------------------------------------------

  // GET /webhooks/messenger - verificação do webhook
  if (method === 'GET' && pathname === '/webhooks/messenger') {
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const mode = urlObj.searchParams.get('hub.mode');
    const token = urlObj.searchParams.get('hub.verify_token');
    const challenge = urlObj.searchParams.get('hub.challenge');

    if (verifyMessengerWebhook(mode, token, challenge)) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge || '');
      return;
    }

    sendJson(res, 403, { error: 'forbidden' });
    return;
  }

  // POST /webhooks/messenger - mensagens recebidas do Messenger
  if (method === 'POST' && pathname === '/webhooks/messenger') {
    try {
      const body = await parseJsonBody(req);

      if (body.object === 'page') {
        const entries = body.entry || [];
        for (const entry of entries) {
          // Processa mensagens do Messenger
          await processMessengerMessage(entry, flows, sessionEvents);
        }
      }

      sendJson(res, 200, { success: true });
    } catch (err) {
      logger.error('Erro no webhook Messenger:', err);
      sendJson(res, 500, { 
        error: 'internal_error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Erro interno ao processar webhook'
      });
    }
    return;
  }

  // POST /messenger/send - Envia mensagem via Messenger
  if (method === 'POST' && pathname === '/messenger/send') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { recipientId, text, buttons } = body || {};

      if (!recipientId || !text) {
        badRequest(res, 'Campos "recipientId" e "text" são obrigatórios');
        return;
      }

      let result;
      if (buttons && Array.isArray(buttons) && buttons.length > 0) {
        result = await sendMessengerButtons(recipientId, text, buttons);
      } else {
        result = await sendMessengerMessage(recipientId, text);
      }

      if (!result.success) {
        sendJson(res, 500, { error: 'send_failed', message: result.error });
        return;
      }

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao enviar mensagem via Messenger:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Webhooks do Instagram Direct
  // -----------------------------------------------------------------------

  // GET /webhooks/instagram - verificação do webhook
  if (method === 'GET' && pathname === '/webhooks/instagram') {
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const mode = urlObj.searchParams.get('hub.mode');
    const token = urlObj.searchParams.get('hub.verify_token');
    const challenge = urlObj.searchParams.get('hub.challenge');

    if (verifyInstagramWebhook(mode, token, challenge)) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge || '');
      return;
    }

    sendJson(res, 403, { error: 'forbidden' });
    return;
  }

  // POST /webhooks/instagram - mensagens recebidas do Instagram
  if (method === 'POST' && pathname === '/webhooks/instagram') {
    try {
      const body = await parseJsonBody(req);

      if (body.object === 'instagram') {
        const entries = body.entry || [];
        for (const entry of entries) {
          // Persiste mensagens do webhook (best-effort)
          const messagingEvents = Array.isArray(entry.messaging) ? entry.messaging : [];
          for (const messaging of messagingEvents) {
            // eslint-disable-next-line no-await-in-loop
            await channelGatewayService.ingestIncoming('instagram', { entry, messaging, raw: body, pageId: entry.id }).catch(() => null);
          }
          // Processa mensagens do Instagram
          await processInstagramMessage(entry, flows, sessionEvents);
        }
      }

      sendJson(res, 200, { success: true });
    } catch (err) {
      logger.error('Erro no webhook Instagram:', err);
      sendJson(res, 500, { 
        error: 'internal_error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Erro interno ao processar webhook'
      });
    }
    return;
  }

  // POST /instagram/send - Envia mensagem via Instagram
  if (method === 'POST' && pathname === '/instagram/send') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { recipientId, text, mediaUrl, mediaType } = body || {};

      if (!recipientId) {
        badRequest(res, 'Campo "recipientId" é obrigatório');
        return;
      }

      let result;
      if (mediaUrl) {
        result = await sendInstagramMedia(recipientId, mediaUrl, mediaType || 'image');
      } else if (text) {
        result = await sendInstagramMessage(recipientId, text);
      } else {
        badRequest(res, 'Campo "text" ou "mediaUrl" é obrigatório');
        return;
      }

      if (!result.success) {
        sendJson(res, 500, { error: 'send_failed', message: result.error });
        return;
      }

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao enviar mensagem via Instagram:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Gerenciamento de Templates
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // Template Marketplace (DB) - Fluxos
  // -----------------------------------------------------------------------

  // GET /flow-templates - Lista templates (globais + do tenant)
  if (method === 'GET' && pathname === '/flow-templates') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'flows', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const tag = urlObj.searchParams.get('tag') || undefined;
      const q = urlObj.searchParams.get('q') || urlObj.searchParams.get('search') || undefined;
      const scope = urlObj.searchParams.get('scope') || 'all';
      const activeOnly = urlObj.searchParams.get('activeOnly');

      const templates = flowTemplateMarketplaceService.listTemplates({
        tenantId: req.tenantId,
        tag,
        q,
        scope,
        activeOnly: activeOnly === null ? true : activeOnly !== 'false',
      });

      sendJson(res, 200, { templates });
    } catch (err) {
      logger.error('Erro ao listar flow-templates', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // GET /flow-templates/:id - Obtém template completo (inclui flow)
  if (method === 'GET' && pathname.startsWith('/flow-templates/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'flows', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/flow-templates/'.length));
      if (!id || id.trim() === '') {
        badRequest(res, 'ID do template é obrigatório');
        return;
      }

      const tpl = flowTemplateMarketplaceService.getTemplate({ tenantId: req.tenantId, id });
      if (!tpl) {
        sendJson(res, 404, { error: 'not_found' });
        return;
      }

      sendJson(res, 200, tpl);
    } catch (err) {
      logger.error('Erro ao obter flow-template', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }


  // POST /flow-templates - Cria template do tenant (body inclui flow)
  if (method === 'POST' && pathname === '/flow-templates') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'flows', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { id, name, description, icon, tags, flow } = body || {};

      const result = await flowTemplateMarketplaceService.createTemplate({
        tenantId: req.tenantId,
        id: id ? String(id) : null,
        name,
        description,
        icon,
        tags,
        flow,
        createdBy: req.agent?.id || null,
      });

      if (!result.success) {
        sendJson(res, 400, { error: result.error, details: result.details });
        return;
      }

      sendJson(res, 201, { template: result.template });
    } catch (err) {
      logger.error('Erro ao criar flow-template', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // POST /flow-templates/:id/install - Cria um flow a partir do template e persiste
  if (method === 'POST' && pathname.startsWith('/flow-templates/') && pathname.endsWith('/install')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'flows', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const templateId = decodeURIComponent(pathname.slice('/flow-templates/'.length, -'/install'.length));
      const tpl = flowTemplateMarketplaceService.getTemplate({ tenantId: req.tenantId, id: templateId });
      if (!tpl) {
        sendJson(res, 404, { error: 'not_found' });
        return;
      }

      const body = await parseJsonBody(req);
      const customId = body?.id ? String(body.id) : null;
      const customName = body?.name ? String(body.name) : null;

      const random = crypto.randomBytes(6).toString('hex');
      const flowId = customId || `${tpl.id}-${Date.now()}-${random}`;
      const flowName = customName || `${tpl.name} (instalado)`;

      const raw = {
        ...(tpl.flow || {}),
        id: flowId,
        name: flowName,
        tenantId: req.tenantId,
        metadata: {
          ...(tpl.flow?.metadata || {}),
          createdFromTemplate: tpl.id,
          createdAt: new Date().toISOString(),
          createdBy: req.agent?.id || null,
        },
      };

      const structureValidation = validateFlowStructure(raw);
      if (!structureValidation.valid) {
        badRequest(res, structureValidation.error || 'Estrutura do fluxo inválida');
        return;
      }

      if (flows.has(raw.id)) {
        sendJson(res, 409, {
          error: 'flow_already_exists',
          message: `Já existe um fluxo com o id "${raw.id}".`,
        });
        return;
      }

      const flow = ensureFlowHasMeta(raw, req.tenantId);

      const validationResult = validateFlow(flow);
      const hasValidationErrors = !validationResult.valid && validationResult.errors.length > 0;

      flows.set(flow.id, flow);
      persistFlowBestEffort(flow);

      const tenantId = req.tenantId || flow.tenantId;
      triggerWebhooks(tenantId, 'flow.created', {
        flowId: flow.id,
        flowName: flow.name,
        agentId: req.agent?.id,
        templateId: tpl.id,
      }).catch((err) => {
        logger.error('[Webhook] Erro ao disparar webhook para flow.created:', err);
      });

      emitEvent('flow.created', {
        flowId: flow.id,
        flowName: flow.name,
        agentId: req.agent?.id,
        templateId: tpl.id,
      }, { tenantId });

      const response = { ...flow };
      if (hasValidationErrors) {
        response.validationWarnings = {
          valid: false,
          errors: validationResult.errors,
        };
      }

      sendJson(res, 201, response);
    } catch (err) {
      logger.error('Erro ao instalar flow-template', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // DELETE /flow-templates/:id - Remove template do tenant (não remove globais)
  if (method === 'DELETE' && pathname.startsWith('/flow-templates/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'flows', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/flow-templates/'.length));
      const result = await flowTemplateMarketplaceService.deleteTemplate({ tenantId: req.tenantId, id });
      if (!result.success) {
        sendJson(res, result.error === 'not_found' ? 404 : 403, { error: result.error });
        return;
      }
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao remover flow-template', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // GET /templates - Lista todos os templates disponíveis
  if (method === 'GET' && pathname === '/templates') {
    try {
      const templatesDir = path.join(__dirname, '..', 'frontend', 'public', 'templates');
      
      if (!fs.existsSync(templatesDir)) {
        sendJson(res, 200, []);
        return;
      }

      const files = fs.readdirSync(templatesDir);
      const templates = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(templatesDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const template = JSON.parse(content);
            
            // Valida estrutura básica do template
            if (template && template.id && template.name && template.flow) {
              templates.push({
                id: template.id,
                name: template.name,
                description: template.description || '',
                icon: template.icon || '📋',
              });
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`Erro ao ler template ${file}:`, err.message);
          }
        }
      }

      sendJson(res, 200, templates);
    } catch (err) {
      logger.error('Erro ao listar templates', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar templates' });
    }
    return;
  }

  // GET /templates/:id - Obtém um template específico completo
  if (method === 'GET' && pathname.startsWith('/templates/') && pathname !== '/templates') {
    try {
      const templateId = decodeURIComponent(pathname.replace('/templates/', '').replace(/\.json$/, ''));
      
      if (!templateId || templateId.trim() === '') {
        badRequest(res, 'ID do template é obrigatório');
        return;
      }

      const templatesDir = path.join(__dirname, '..', 'frontend', 'public', 'templates');
      const templateFile = path.join(templatesDir, `${templateId}.json`);

      if (!fs.existsSync(templateFile)) {
        sendJson(res, 404, { error: 'not_found', message: `Template "${templateId}" não encontrado` });
        return;
      }

      const content = fs.readFileSync(templateFile, 'utf8');
      const template = JSON.parse(content);

      // Valida estrutura básica
      if (!template || !template.id || !template.name || !template.flow) {
        sendJson(res, 500, { error: 'invalid_template', message: 'Template corrompido ou inválido' });
        return;
      }

      sendJson(res, 200, template);
    } catch (err) {
      if (err instanceof SyntaxError) {
        sendJson(res, 500, { error: 'parse_error', message: 'Erro ao parsear template JSON' });
      } else {
        // eslint-disable-next-line no-console
        logger.error('Erro ao obter template', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter template' });
      }
    }
    return;
  }

  // POST /templates - Salva um novo template
  if (method === 'POST' && pathname === '/templates') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      
      // Valida estrutura básica
      if (!body || typeof body !== 'object') {
        badRequest(res, 'Body deve ser um objeto');
        return;
      }

      if (!body.id || typeof body.id !== 'string' || body.id.trim() === '') {
        badRequest(res, 'Campo "id" é obrigatório e deve ser uma string não vazia');
        return;
      }

      if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
        badRequest(res, 'Campo "name" é obrigatório e deve ser uma string não vazia');
        return;
      }

      if (!body.flow || typeof body.flow !== 'object') {
        badRequest(res, 'Campo "flow" é obrigatório e deve ser um objeto');
        return;
      }

      // Valida o fluxo antes de salvar como template
      const validationResult = validateFlow(body.flow);
      if (!validationResult.valid && validationResult.errors.length > 0) {
        sendJson(res, 400, {
          error: 'validation_failed',
          message: 'O fluxo não passou na validação',
          errors: validationResult.errors,
        });
        return;
      }

      // Sanitiza o ID do template (usado como nome do arquivo)
      const templateId = body.id.trim().replace(/[^a-z0-9-]/g, '-').toLowerCase();
      const templatesDir = path.join(__dirname, '..', 'frontend', 'public', 'templates');
      const templateFile = path.join(templatesDir, `${templateId}.json`);

      // Garante que o diretório existe
      if (!fs.existsSync(templatesDir)) {
        fs.mkdirSync(templatesDir, { recursive: true });
      }

      // Prepara o template
      const template = {
        id: templateId,
        name: body.name.trim(),
        description: (body.description || '').trim() || `Template: ${body.name.trim()}`,
        icon: (body.icon || '📋').trim().substring(0, 2),
        flow: body.flow,
      };

      // Salva o arquivo JSON
      fs.writeFileSync(templateFile, JSON.stringify(template, null, 2), 'utf8');

      logger.debug(`Template salvo: ${templateFile}`);

      sendJson(res, 201, {
        success: true,
        template: template,
        message: `Template "${template.name}" salvo com sucesso`,
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao salvar template', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao salvar template' });
      }
    }
    return;
  }

  // DELETE /templates/:id - Remove um template
  if (method === 'DELETE' && pathname.startsWith('/templates/')) {
    try {
      let templateId = decodeURIComponent(pathname.slice('/templates/'.length));
      // Remove .json se presente
      if (templateId.endsWith('.json')) {
        templateId = templateId.slice(0, -'.json'.length);
      }
      
      if (!templateId || templateId.trim() === '') {
        badRequest(res, 'ID do template é obrigatório');
        return;
      }

      // Sanitiza o ID do template (mesmo processo usado no POST)
      const sanitizedId = templateId.trim().replace(/[^a-z0-9-]/g, '-').toLowerCase();
      const templatesDir = path.join(__dirname, '..', 'frontend', 'public', 'templates');
      const templateFile = path.join(templatesDir, `${sanitizedId}.json`);

      // Verifica se o arquivo existe
      if (!fs.existsSync(templateFile)) {
        sendJson(res, 404, {
          error: 'not_found',
          message: `Template "${sanitizedId}" não encontrado`,
        });
        return;
      }

      // Remove o arquivo
      fs.unlinkSync(templateFile);

      // eslint-disable-next-line no-console
      console.log(`Template removido: ${templateFile}`);

      sendJson(res, 200, {
        success: true,
        deletedId: sanitizedId,
        message: `Template "${sanitizedId}" removido com sucesso`,
      });
    } catch (err) {
      logger.error('Erro ao remover template', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: 'Erro interno ao remover template',
      });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Gerenciamento de configuração
  // -----------------------------------------------------------------------

  // GET /config - Lê a configuração atual
  // IMPORTANTE: Só responde com JSON se for uma requisição de API
  // Se for uma requisição de navegação (Accept: text/html), deixa cair no catch-all para servir o frontend
  if (method === 'GET' && pathname === '/config') {
    const acceptHeader = req.headers.accept || '';
    const isApiRequest = acceptHeader.includes('application/json') || 
                         !acceptHeader.includes('text/html');
    
    if (!isApiRequest) {
      // É uma requisição de navegação, deixa cair no catch-all para servir o frontend
      // Não retorna aqui, continua para o catch-all
    } else {
      // É uma requisição de API, responde com JSON
      try {
        // Recarrega a configuração do arquivo para garantir que está atualizada
        config.reload();
        const configData = config.getAll();
        
        // Valida que configData é um objeto válido
        if (!configData || typeof configData !== 'object' || Array.isArray(configData)) {
          throw new Error('Configuração retornada não é um objeto válido');
        }
        
        // Sanitiza a configuração: remove apiKey e seção ai completa para evitar vazamento
        // A configuração de IA por tenant deve ser obtida via endpoint específico
        const sanitizedConfig = JSON.parse(JSON.stringify(configData)); // Deep copy
        
        // Remove apiKey de qualquer provider de IA
        if (sanitizedConfig.ai) {
          if (sanitizedConfig.ai.openai && sanitizedConfig.ai.openai.apiKey) {
            delete sanitizedConfig.ai.openai.apiKey;
          }
          if (sanitizedConfig.ai.anthropic && sanitizedConfig.ai.anthropic.apiKey) {
            delete sanitizedConfig.ai.anthropic.apiKey;
          }
          // Remove a seção ai completamente para evitar confusão
          // A configuração de IA deve ser obtida via /tenants/:tenantId/ai-config
          delete sanitizedConfig.ai;
        }
        
        sendJson(res, 200, sanitizedConfig);
      } catch (err) {
        // Usa console.error como fallback caso logger falhe
        try {
          logger.error('Erro ao ler configuração:', err);
        } catch (logErr) {
          // Fallback: usa console.error se logger falhar
          // eslint-disable-next-line no-console
          console.error('Erro ao ler configuração:', err);
          // eslint-disable-next-line no-console
          console.error('Erro ao logar erro:', logErr);
        }
        
        sendJson(res, 500, { 
          error: 'Erro ao ler configuração',
          message: err.message || 'Erro desconhecido',
          stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
      }
      return;
    }
    // Se não for requisição de API, continua para o catch-all (não retorna aqui)
  }

  // GET /contracts/rag/question-generation.rules.json - Serve regras de geração de perguntas
  // GET /api/data/rag_question_generation_rules.json - Compatibilidade retroativa (deprecated)
  if (method === 'GET' && (pathname === '/contracts/rag/question-generation.rules.json' || pathname === '/api/data/rag_question_generation_rules.json')) {
    try {
      // Carrega do contrato
      const contractsDir = path.join(__dirname, '..', 'contracts');
      const rulesFile = path.join(contractsDir, 'rag', 'question-generation.rules.json');
      const fileToLoad = rulesFile;
      
      if (!fs.existsSync(fileToLoad)) {
        sendJson(res, 404, { error: 'not_found', message: 'Arquivo de regras não encontrado' });
        return;
      }
      
      const rulesContent = fs.readFileSync(fileToLoad, 'utf8');
      const rulesData = JSON.parse(rulesContent);
      
      setCorsHeaders(res);
      sendJson(res, 200, rulesData);
    } catch (err) {
      logger.error('Erro ao servir regras de geração de perguntas:', err);
      sendJson(res, 500, { 
        error: 'Erro ao ler regras',
        message: err.message || 'Erro desconhecido'
      });
    }
    return;
  }

  // GET /tenants/current/ai-config - Obtém configuração de IA do tenant atual (sem segredos)
  if (method === 'GET' && pathname === '/tenants/current/ai-config') {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return;
      }

      let tenantId = authResult.agent.tenantId;
      
      // Validação: se tenantId for "current" (string literal), isso é um erro
      if (tenantId === 'current') {
        logger.error('[Server] tenantId inválido: "current" (string literal). Agente:', {
          id: authResult.agent.id,
          username: authResult.agent.username,
          role: authResult.agent.role,
          tenantId: authResult.agent.tenantId
        });
        sendJson(res, 400, { error: 'bad_request', message: 'tenantId inválido: "current" não é um tenant válido. Verifique a configuração do agente.' });
        return;
      }
      
      if (!tenantId) {
        sendJson(res, 400, { error: 'bad_request', message: 'Agente não possui tenantId' });
        return;
      }

      const aiConfig = await getAIConfig(tenantId);
      
      if (aiConfig === null) {
        sendJson(res, 404, { error: 'not_found', message: 'Configuração de IA não encontrada para este tenant' });
        return;
      }

      sendJson(res, 200, aiConfig);
    } catch (err) {
      logger.error('Erro ao obter configuração de IA do tenant atual:', err);
      sendJson(res, 500, { error: 'Erro ao obter configuração de IA', message: err.message });
    }
    return;
  }

  // GET /tenants/current/plan-usage - Retorna plano + limites efetivos + uso (tenant atual)
  if (method === 'GET' && pathname === '/tenants/current/plan-usage') {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return;
      }

      const tenantId = authResult.agent.tenantId;
      if (!tenantId || tenantId === 'current') {
        sendJson(res, 400, { error: 'bad_request', message: 'tenantId inválido' });
        return;
      }

      // Apenas owner/admin (ou super-admin) podem ver limites/uso do plano
      const isSuperAdminUser = isSuperAdmin(authResult.agent);
      if (!isSuperAdminUser && authResult.agent.role !== 'owner' && authResult.agent.role !== 'admin') {
        sendJson(res, 403, { error: 'forbidden', message: 'Apenas owner ou admin podem ver plano/uso' });
        return;
      }

      const { getTenant } = require('./services/tenantService');
      const { getPlanLimits } = require('./services/planLimitsService');
      const { getTenantUsage } = require('./services/tenantService');

      const tenant = await getTenant(tenantId);
      if (!tenant) {
        sendJson(res, 404, { error: 'tenant_not_found' });
        return;
      }

      const usage = await getTenantUsage(tenantId);
      const limits = tenant.limits || getPlanLimits(tenant.plan);

      sendJson(res, 200, {
        tenantId,
        plan: tenant.plan || 'trial',
        limits,
        usage,
      });
    } catch (err) {
      logger.error('Erro ao obter plano/uso do tenant atual:', err);
      sendJson(res, 500, { error: 'Erro ao obter plano/uso', message: err.message });
    }
    return;
  }

  // PUT /tenants/current/ai-config - Salva configuração de IA do tenant atual
  if (method === 'PUT' && pathname === '/tenants/current/ai-config') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return;
      }

      let tenantId = authResult.agent.tenantId;
      
      // Validação: se tenantId for "current" (string literal), isso é um erro
      if (tenantId === 'current') {
        logger.error('[Server] tenantId inválido: "current" (string literal). Agente:', {
          id: authResult.agent.id,
          username: authResult.agent.username,
          role: authResult.agent.role,
          tenantId: authResult.agent.tenantId
        });
        sendJson(res, 400, { error: 'bad_request', message: 'tenantId inválido: "current" não é um tenant válido. Verifique a configuração do agente.' });
        return;
      }
      
      if (!tenantId) {
        sendJson(res, 400, { error: 'bad_request', message: 'Agente não possui tenantId' });
        return;
      }

      // Verifica permissão (owner/admin podem alterar)
      const permResult = requirePermission(req, 'tenants', 'update');
      const isSuperAdmin = require('./services/superAdminService').isSuperAdmin(authResult.agent);
      if (!permResult.allowed && !isSuperAdmin) {
        sendJson(res, 403, { error: 'forbidden', message: 'Permissão insuficiente para alterar configurações de IA' });
        return;
      }

      const body = await parseJsonBody(req);
      
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        badRequest(res, 'Configuração deve ser um objeto JSON válido');
        return;
      }

      const savedConfig = await saveAIConfig(tenantId, body);
      sendJson(res, 200, savedConfig);
    } catch (err) {
      logger.error('Erro ao salvar configuração de IA do tenant atual:', err);
      sendJson(res, 500, { error: 'Erro ao salvar configuração de IA', message: err.message });
    }
    return;
  }

  // PUT /tenants/current/ai-credentials - Salva credenciais de IA do tenant atual (criptografadas)
  if (method === 'PUT' && pathname === '/tenants/current/ai-credentials') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return;
      }

      let tenantId = authResult.agent.tenantId;
      
      // Validação: se tenantId for "current" (string literal), isso é um erro
      if (tenantId === 'current') {
        logger.error('[Server] tenantId inválido: "current" (string literal). Agente:', {
          id: authResult.agent.id,
          username: authResult.agent.username,
          role: authResult.agent.role,
          tenantId: authResult.agent.tenantId
        });
        sendJson(res, 400, { error: 'bad_request', message: 'tenantId inválido: "current" não é um tenant válido. Verifique a configuração do agente.' });
        return;
      }
      
      if (!tenantId) {
        sendJson(res, 400, { error: 'bad_request', message: 'Agente não possui tenantId' });
        return;
      }

      // Verifica permissão (owner/admin podem alterar)
      const permResult = requirePermission(req, 'tenants', 'update');
      const isSuperAdmin = require('./services/superAdminService').isSuperAdmin(authResult.agent);
      if (!permResult.allowed && !isSuperAdmin) {
        sendJson(res, 403, { error: 'forbidden', message: 'Permissão insuficiente para alterar credenciais de IA' });
        return;
      }

      const body = await parseJsonBody(req);
      
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        badRequest(res, 400, { error: 'invalid_request', message: 'Body deve ser um objeto JSON válido' });
        return;
      }

      const { provider, apiKey } = body;

      if (!provider || typeof provider !== 'string') {
        badRequest(res, 400, { error: 'invalid_request', message: 'Provider é obrigatório' });
        return;
      }

      if (!apiKey || typeof apiKey !== 'string') {
        badRequest(res, 400, { error: 'invalid_request', message: 'API key é obrigatória' });
        return;
      }

      await saveAICredentials(tenantId, provider, apiKey);
      
      sendJson(res, 200, { 
        success: true, 
        message: 'Credenciais salvas com sucesso' 
      });
    } catch (err) {
      logger.error('Erro ao salvar credenciais de IA do tenant atual:', err);
      sendJson(res, 500, { error: 'Erro ao salvar credenciais de IA', message: err.message });
    }
    return;
  }

  // GET /tenants/:tenantKey/ai-config - Obtém configuração de IA do tenant (sem segredos)
  if (method === 'GET' && pathname.match(/^\/tenants\/([^\/]+)\/ai-config$/)) {
    const match = pathname.match(/^\/tenants\/([^\/]+)\/ai-config$/);
    const tenantKey = match[1];

    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return;
      }

      // Verifica se o usuário tem acesso ao tenant
      // Super-admin pode acessar qualquer tenant
      // Outros usuários só podem acessar seu próprio tenant
      const isSuperAdmin = require('./services/superAdminService').isSuperAdmin(authResult.agent);
      if (!isSuperAdmin && authResult.agent.tenantId !== tenantKey) {
        sendJson(res, 403, { error: 'forbidden', message: 'Acesso negado a este tenant' });
        return;
      }

      const aiConfig = await getAIConfig(tenantKey);
      
      if (aiConfig === null) {
        sendJson(res, 404, { error: 'not_found', message: 'Tenant não encontrado' });
        return;
      }

      sendJson(res, 200, aiConfig);
    } catch (err) {
      logger.error('Erro ao obter configuração de IA:', err);
      sendJson(res, 500, { error: 'Erro ao obter configuração de IA', message: err.message });
    }
    return;
  }

  // PUT /tenants/:tenantKey/ai-config - Salva configuração de IA do tenant
  if (method === 'PUT' && pathname.match(/^\/tenants\/([^\/]+)\/ai-config$/)) {
    const match = pathname.match(/^\/tenants\/([^\/]+)\/ai-config$/);
    const tenantKey = match[1];

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return;
      }

      // Verifica RBAC: apenas admin/owner/superadmin podem alterar
      const isSuperAdmin = require('./services/superAdminService').isSuperAdmin(authResult.agent);
      if (!isSuperAdmin && authResult.agent.tenantId !== tenantKey) {
        sendJson(res, 403, { error: 'forbidden', message: 'Acesso negado a este tenant' });
        return;
      }

      // Verifica permissão (owner/admin podem alterar)
      const permResult = requirePermission(req, 'tenants', 'update');
      if (!permResult.allowed && !isSuperAdmin) {
        sendJson(res, 403, { error: 'forbidden', message: 'Permissão insuficiente para alterar configurações de IA' });
        return;
      }

      const body = await parseJsonBody(req);
      
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        badRequest(res, 'Configuração deve ser um objeto JSON válido');
        return;
      }

      const savedConfig = await saveAIConfig(tenantKey, body);
      sendJson(res, 200, savedConfig);
    } catch (err) {
      logger.error('Erro ao salvar configuração de IA:', err);
      sendJson(res, 500, { error: 'Erro ao salvar configuração de IA', message: err.message });
    }
    return;
  }

  // PUT /tenants/:tenantKey/ai-credentials - Salva credenciais de IA do tenant (criptografadas)
  if (method === 'PUT' && pathname.match(/^\/tenants\/([^\/]+)\/ai-credentials$/)) {
    const match = pathname.match(/^\/tenants\/([^\/]+)\/ai-credentials$/);
    const tenantKey = match[1];

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return;
      }

      // Verifica RBAC: apenas admin/owner/superadmin podem alterar
      const isSuperAdmin = require('./services/superAdminService').isSuperAdmin(authResult.agent);
      if (!isSuperAdmin && authResult.agent.tenantId !== tenantKey) {
        sendJson(res, 403, { error: 'forbidden', message: 'Acesso negado a este tenant' });
        return;
      }

      // Verifica permissão (owner/admin podem alterar)
      const permResult = requirePermission(req, 'tenants', 'update');
      if (!permResult.allowed && !isSuperAdmin) {
        sendJson(res, 403, { error: 'forbidden', message: 'Permissão insuficiente para alterar credenciais de IA' });
        return;
      }

      const body = await parseJsonBody(req);
      
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        badRequest(res, 400, { error: 'invalid_request', message: 'Body deve ser um objeto JSON válido' });
        return;
      }

      const { provider, apiKey } = body;

      if (!provider || typeof provider !== 'string') {
        badRequest(res, 400, { error: 'invalid_request', message: 'Provider é obrigatório' });
        return;
      }

      if (!apiKey || typeof apiKey !== 'string') {
        badRequest(res, 400, { error: 'invalid_request', message: 'API key é obrigatória' });
        return;
      }

      await saveAICredentials(tenantKey, provider, apiKey);
      
      sendJson(res, 200, { 
        success: true, 
        message: 'Credenciais salvas com sucesso' 
      });
    } catch (err) {
      logger.error('Erro ao salvar credenciais de IA:', err);
      // Se o erro for "Tenant não encontrado", retorna 404
      if (err.message && err.message.includes('não encontrado')) {
        sendJson(res, 404, { error: 'not_found', message: err.message });
      } else {
        sendJson(res, 500, { error: 'Erro ao salvar credenciais de IA', message: err.message });
      }
    }
    return;
  }

  // PUT /config - Atualiza a configuração
  if (method === 'PUT' && pathname === '/config') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      
      // Valida que é um objeto
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        badRequest(res, 'Configuração deve ser um objeto JSON válido');
        return;
      }

      // Envia resposta primeiro para evitar interrupção quando nodemon reiniciar
      sendJson(res, 200, { 
        success: true, 
        message: 'Configuração atualizada com sucesso. Servidor será reiniciado automaticamente.' 
      });

      // Salva no arquivo de forma assíncrona após enviar a resposta
      // Isso permite que o nodemon reinicie o servidor sem interromper a requisição HTTP
      setImmediate(() => {
        try {
          ensureDataDir();
          const configData = JSON.stringify(body, null, 2);
          fs.writeFileSync(configFile, configData, 'utf8');
          
          // Recarrega a configuração
          config.reload();
          
          // Reinicializa os providers de IA com a nova configuração
          try {
            initializeAiProviders();
            logger.info('Providers de IA reinicializados com nova configuração');
          } catch (aiError) {
            logger.warn('Erro ao reinicializar providers de IA', { message: aiError.message });
          }
          
          logger.info('Configuração atualizada via API - nodemon reiniciará o servidor automaticamente');
        } catch (err) {
          logger.error('Erro ao salvar configuração após resposta', err);
        }
      });
    } catch (err) {
      logger.error('Erro ao atualizar configuração', err);
      sendJson(res, 500, { error: 'Erro ao atualizar configuração', message: err.message });
    }
    return;
  }

  // GET /server/process-manager - Verifica qual gerenciador de processo está sendo usado
  if (method === 'GET' && pathname === '/server/process-manager') {
    const processManager = detectProcessManager();
    sendJson(res, 200, {
      success: true,
      processManager: processManager.name,
      hasProcessManager: processManager.hasProcessManager,
      details: processManager.details,
    });
    return;
  }

  // POST /config/validate-provider-token - Valida token de um provedor de IA
  // IMPORTANTE: Esta validação SEMPRE usa chamadas diretas à API, nunca usa fallback
  if (method === 'POST' && pathname === '/config/validate-provider-token') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { provider, apiKey } = body;

      if (!provider || !apiKey) {
        badRequest(res, 'Provider e apiKey são obrigatórios');
        return;
      }

      if (provider !== 'openai' && provider !== 'anthropic') {
        badRequest(res, 'Provider deve ser "openai" ou "anthropic"');
        return;
      }

      // Remove espaços em branco do token
      const cleanApiKey = apiKey.trim();
      if (!cleanApiKey) {
        sendJson(res, 200, {
          success: true,
          valid: false,
          error: 'Token não pode estar vazio',
        });
        return;
      }

      let isValid = false;
      let error = null;

      try {
        if (provider === 'openai') {
          // Valida token OpenAI fazendo uma chamada REAL à API (nunca usa fallback)
          // Usa endpoint de listagem de modelos que é leve e rápido
          const response = await fetch('https://api.openai.com/v1/models', {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${cleanApiKey}`,
            },
            // Timeout de 10 segundos para evitar espera longa
            signal: AbortSignal.timeout(10000),
          });

          if (response.ok) {
            // Verifica se a resposta realmente contém dados válidos
            const data = await response.json().catch(() => null);
            if (data && Array.isArray(data.data)) {
              isValid = true;
            } else {
              error = 'Resposta inválida da API OpenAI';
            }
          } else {
            const errorData = await response.json().catch(() => ({}));
            if (response.status === 401) {
              error = 'Token inválido ou expirado';
            } else if (response.status === 403) {
              error = 'Token não tem permissão para acessar a API';
            } else {
              error = errorData.error?.message || `Erro ${response.status}: ${response.statusText}`;
            }
          }
        } else if (provider === 'anthropic') {
          // Valida token Anthropic fazendo uma chamada REAL à API (nunca usa fallback)
          // Anthropic não tem endpoint de listagem, então fazemos uma chamada de teste mínima
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': cleanApiKey,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'claude-3-haiku-20240307',
              max_tokens: 10,
              messages: [{ role: 'user', content: 'test' }],
            }),
            // Timeout de 10 segundos para evitar espera longa
            signal: AbortSignal.timeout(10000),
          });

          if (response.ok) {
            // Verifica se a resposta realmente contém dados válidos
            const data = await response.json().catch(() => null);
            if (data && data.content) {
              isValid = true;
            } else {
              error = 'Resposta inválida da API Anthropic';
            }
          } else {
            const errorData = await response.json().catch(() => ({}));
            if (response.status === 401) {
              error = 'Token inválido ou expirado';
            } else if (response.status === 403) {
              error = 'Token não tem permissão para acessar a API';
            } else {
              error = errorData.error?.message || `Erro ${response.status}: ${response.statusText}`;
            }
          }
        }
      } catch (validationError) {
        // Trata diferentes tipos de erro
        if (validationError.name === 'AbortError' || validationError.name === 'TimeoutError') {
          error = 'Timeout ao validar token. Verifique sua conexão com a internet.';
        } else if (validationError.name === 'TypeError' && validationError.message.includes('fetch')) {
          error = 'Erro de conexão. Verifique sua conexão com a internet.';
        } else {
          error = validationError.message || 'Erro ao validar token';
        }
      }

      sendJson(res, 200, {
        success: true,
        valid: isValid,
        error: error || null,
      });
    } catch (err) {
      logger.error('Erro ao validar token de provedor', err);
      sendJson(res, 500, { 
        success: false,
        error: 'Erro ao validar token', 
        message: err.message 
      });
    }
    return;
  }

  // POST /config/validate-redis - Valida conexão do Redis
  if (method === 'POST' && pathname === '/config/validate-redis') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { redisUrl } = body;

      if (!redisUrl || typeof redisUrl !== 'string' || redisUrl.trim() === '') {
        sendJson(res, 200, {
          success: true,
          valid: false,
          error: 'URL do Redis não pode estar vazia',
        });
        return;
      }

      // Valida formato da URL
      const redisUrlPattern = /^(redis|rediss):\/\/([^:\/]+)(:(\d+))?(\/.*)?$/;
      const match = redisUrl.trim().match(redisUrlPattern);
      
      if (!match) {
        sendJson(res, 200, {
          success: true,
          valid: false,
          error: `Formato de URL inválido. Formato esperado: redis://host:port ou rediss://host:port`,
        });
        return;
      }

      // Valida porta se presente
      const port = match[4];
      if (port) {
        const portNum = parseInt(port, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
          sendJson(res, 200, {
            success: true,
            valid: false,
            error: `Porta inválida: ${port}. Deve ser um número entre 1 e 65535`,
          });
          return;
        }
      }

      // Tenta conectar ao Redis usando a URL fornecida
      let isValid = false;
      let error = null;

      try {
        // Cria um cliente Redis temporário para testar a conexão
        const Redis = require('ioredis');
        const testClient = new Redis(redisUrl.trim(), {
          connectTimeout: 5000,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });

        // Tenta conectar com timeout
        const connectPromise = testClient.connect();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout ao conectar ao Redis (5s)')), 5000)
        );
        
        await Promise.race([connectPromise, timeoutPromise]);
        
        // Se conectou, tenta fazer um PING
        const pingResult = await testClient.ping();
        isValid = pingResult === 'PONG';
        
        // Fecha o cliente de teste
        await testClient.quit();
        
      } catch (validationError) {
        // Trata diferentes tipos de erro
        if (validationError.message && validationError.message.includes('Timeout')) {
          error = 'Timeout ao conectar ao Redis. Verifique se o servidor está rodando e acessível.';
        } else if (validationError.message && (validationError.message.includes('ECONNREFUSED') || validationError.message.includes('connect ECONNREFUSED'))) {
          error = 'Conexão recusada. Verifique se o Redis está rodando e se a porta está correta.';
        } else if (validationError.message && (validationError.message.includes('ENOTFOUND') || validationError.message.includes('getaddrinfo'))) {
          error = 'Host não encontrado. Verifique se o endereço do Redis está correto.';
        } else if (validationError.message && validationError.message.includes('invalid password')) {
          error = 'Senha inválida. Verifique as credenciais do Redis.';
        } else {
          error = validationError.message || 'Erro ao conectar ao Redis';
        }
      }

      sendJson(res, 200, {
        success: true,
        valid: isValid,
        error: error || null,
      });
    } catch (err) {
      logger.error('Erro ao validar conexão do Redis', err);
      sendJson(res, 500, { 
        success: false,
        error: 'Erro ao validar conexão do Redis', 
        message: err.message 
      });
    }
    return;
  }

  // POST /server/restart - Reinicia o servidor
  if (method === 'POST' && pathname === '/server/restart') {
    logger.info('Reinício do servidor solicitado via API');
    
    const processManager = detectProcessManager();
    
    // Responde imediatamente antes de encerrar
    sendJson(res, 200, { 
      success: true, 
      message: processManager.hasProcessManager 
        ? 'Servidor será reiniciado automaticamente em breve'
        : 'Servidor será encerrado. Reinicie manualmente.',
      processManager: processManager.name,
      hasProcessManager: processManager.hasProcessManager,
      note: processManager.hasProcessManager
        ? `Gerenciador detectado: ${processManager.name}. O servidor será reiniciado automaticamente.`
        : 'Nenhum gerenciador de processo detectado. Você precisará reiniciar o servidor manualmente usando "npm start" ou "node api/server.js".'
    });
    
    // Encerra o processo após um pequeno delay para permitir que a resposta seja enviada
    setTimeout(() => {
      logger.info('Encerrando servidor para reinício...');
      if (processManager.hasProcessManager) {
        logger.info(`Gerenciador ${processManager.name} irá reiniciar o servidor automaticamente`);
      } else {
        logger.warn('Nenhum gerenciador detectado. Servidor não será reiniciado automaticamente.');
      }
      process.exit(0); // Código 0 para reinício limpo
    }, 500);
    
    return;
  }

  // -----------------------------------------------------------------------
  // Respostas Rápidas (Quick Replies)
  // -----------------------------------------------------------------------

  // GET /quick-replies - Lista respostas rápidas
  if (method === 'GET' && pathname === '/quick-replies') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const urlObj = new URL(req.url || '/', 'http://localhost');
    const filters = {
      tenantId: authResult.agent.tenantId,
      category: urlObj.searchParams.get('category') || undefined,
      tag: urlObj.searchParams.get('tag') || undefined,
      activeOnly: urlObj.searchParams.get('activeOnly') !== 'false',
      search: urlObj.searchParams.get('search') || undefined,
    };

    const replies = listQuickReplies(filters);
    sendJson(res, 200, { quickReplies: replies });
    return;
  }

  // GET /quick-replies/categories - Lista categorias
  if (method === 'GET' && pathname === '/quick-replies/categories') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const categories = getCategories();
    sendJson(res, 200, { categories });
    return;
  }

  // GET /quick-replies/tags - Lista tags
  if (method === 'GET' && pathname === '/quick-replies/tags') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const tags = getTags();
    sendJson(res, 200, { tags });
    return;
  }

  // POST /quick-replies/search - Busca por contexto
  if (method === 'POST' && pathname === '/quick-replies/search') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { context, limit = 5 } = body || {};

      if (!context || typeof context !== 'string') {
        badRequest(res, 'Campo "context" é obrigatório e deve ser uma string');
        return;
      }

      const tenantId = authResult.agent.tenantId;
      const replies = searchByContext(context, limit).filter((r) => !tenantId || r.tenantId === tenantId);
      sendJson(res, 200, { quickReplies: replies });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao buscar respostas rápidas:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // GET /quick-replies/:id - Obtém resposta rápida específica
  if (method === 'GET' && pathname.startsWith('/quick-replies/') && 
      pathname !== '/quick-replies/categories' && pathname !== '/quick-replies/tags') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const id = decodeURIComponent(pathname.slice('/quick-replies/'.length));
    const reply = getQuickReply(id);
    
    if (!reply || (authResult.agent.tenantId && reply.tenantId && reply.tenantId !== authResult.agent.tenantId)) {
      sendJson(res, 404, { error: 'quick_reply_not_found' });
      return;
    }

    sendJson(res, 200, { quickReply: reply });
    return;
  }

  // POST /quick-replies - Cria resposta rápida
  if (method === 'POST' && pathname === '/quick-replies') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'quick_replies', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const result = createQuickReply({
        ...body,
        tenantId: req.agent.tenantId,
        createdBy: req.agent.id,
      });

      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'quick_reply_create',
        resource: 'quick_reply',
        resourceId: result.quickReply.id,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 201, result.quickReply);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar resposta rápida:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // PUT /quick-replies/:id - Atualiza resposta rápida
  if (method === 'PUT' && pathname.startsWith('/quick-replies/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'quick_replies', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/quick-replies/'.length));
      const existing = getQuickReply(id);
      if (!existing || (req.agent.tenantId && existing.tenantId && existing.tenantId !== req.agent.tenantId)) {
        sendJson(res, 404, { error: 'quick_reply_not_found' });
        return;
      }

      const body = await parseJsonBody(req);
      const result = updateQuickReply(id, body);

      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'quick_reply_update',
        resource: 'quick_reply',
        resourceId: id,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result.quickReply);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atualizar resposta rápida:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // DELETE /quick-replies/:id - Remove resposta rápida
  if (method === 'DELETE' && pathname.startsWith('/quick-replies/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'quick_replies', 'delete');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const id = decodeURIComponent(pathname.slice('/quick-replies/'.length));
    const existing = getQuickReply(id);
    if (!existing || (req.agent.tenantId && existing.tenantId && existing.tenantId !== req.agent.tenantId)) {
      sendJson(res, 404, { error: 'quick_reply_not_found' });
      return;
    }
    const result = deleteQuickReply(id);

    if (!result.success) {
      badRequest(res, result.error);
      return;
    }

    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      action: 'quick_reply_delete',
      resource: 'quick_reply',
      resourceId: id,
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, { success: true });
    return;
  }

  // POST /quick-replies/:id/use - Incrementa contador de uso
  if (method === 'POST' && pathname.startsWith('/quick-replies/') && pathname.endsWith('/use')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const id = decodeURIComponent(pathname.slice('/quick-replies/'.length, -'/use'.length));
    const existing = getQuickReply(id);
    if (!existing || (req.agent.tenantId && existing.tenantId && existing.tenantId !== req.agent.tenantId)) {
      sendJson(res, 404, { error: 'quick_reply_not_found' });
      return;
    }
    incrementUsage(id);
    sendJson(res, 200, { success: true });
    return;
  }

  // -----------------------------------------------------------------------
  // Departamentos
  // -----------------------------------------------------------------------

  // GET /departments - Lista departamentos
  if (method === 'GET' && pathname === '/departments') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const urlObj = new URL(req.url || '/', 'http://localhost');
    const filters = {
      tenantId: authResult.agent.tenantId,
      activeOnly: urlObj.searchParams.get('activeOnly') !== 'false',
      agentId: urlObj.searchParams.get('agentId') || undefined,
    };

    const departments = listDepartments(filters);
    sendJson(res, 200, { departments });
    return;
  }

  // GET /departments/:id - Obtém departamento específico
  if (method === 'GET' && pathname.startsWith('/departments/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const id = decodeURIComponent(pathname.slice('/departments/'.length));
    const department = getDepartment(id);
    
    if (!department) {
      sendJson(res, 404, { error: 'department_not_found' });
      return;
    }

    sendJson(res, 200, { department });
    return;
  }

  // POST /departments - Cria departamento
  if (method === 'POST' && pathname === '/departments') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'departments', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const result = createDepartment({
        ...body,
        tenantId: req.agent.tenantId,
        createdBy: req.agent.id,
      });

      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'department_create',
        resource: 'department',
        resourceId: result.department.id,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 201, result.department);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar departamento:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // PUT /departments/:id - Atualiza departamento
  if (method === 'PUT' && pathname.startsWith('/departments/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'departments', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/departments/'.length));
      const body = await parseJsonBody(req);
      const result = updateDepartment(id, body);

      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'department_update',
        resource: 'department',
        resourceId: id,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result.department);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atualizar departamento:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // DELETE /departments/:id - Remove departamento
  if (method === 'DELETE' && pathname.startsWith('/departments/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'departments', 'delete');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const id = decodeURIComponent(pathname.slice('/departments/'.length));
    const result = deleteDepartment(id);

    if (!result.success) {
      badRequest(res, result.error);
      return;
    }

    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      action: 'department_delete',
      resource: 'department',
      resourceId: id,
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, { success: true });
    return;
  }

  // POST /departments/:id/agents - Adiciona agente ao departamento
  if (method === 'POST' && pathname.startsWith('/departments/') && pathname.endsWith('/agents')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'departments', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/departments/'.length, -'/agents'.length));
      const body = await parseJsonBody(req);
      const { agentId } = body || {};

      if (!agentId) {
        badRequest(res, 'Campo "agentId" é obrigatório');
        return;
      }

      const result = addAgentToDepartment(id, agentId);
      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      sendJson(res, 200, result.department);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao adicionar agente ao departamento:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // DELETE /departments/:id/agents/:agentId - Remove agente do departamento
  if (method === 'DELETE' && pathname.includes('/departments/') && pathname.includes('/agents/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'departments', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const parts = pathname.split('/');
      const deptIndex = parts.indexOf('departments');
      const agentIndex = parts.indexOf('agents');
      const departmentId = decodeURIComponent(parts[deptIndex + 1]);
      const agentId = decodeURIComponent(parts[agentIndex + 1]);

      const result = removeAgentFromDepartment(departmentId, agentId);
      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      sendJson(res, 200, result.department);
    } catch (err) {
      logger.error('Erro ao remover agente do departamento:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Disparos em Massa (Bulk Messaging)
  // -----------------------------------------------------------------------

  // GET /bulk-campaigns - Lista campanhas
  if (method === 'GET' && pathname === '/bulk-campaigns') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'bulk_messaging', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const urlObj = new URL(req.url || '/', 'http://localhost');
    const filters = {
      status: urlObj.searchParams.get('status') || undefined,
      createdBy: urlObj.searchParams.get('createdBy') || undefined,
    };

    const campaigns = listCampaigns(filters);
    sendJson(res, 200, { campaigns });
    return;
  }

  // GET /bulk-campaigns/:id - Obtém campanha específica
  if (method === 'GET' && pathname.startsWith('/bulk-campaigns/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'bulk_messaging', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const id = decodeURIComponent(pathname.slice('/bulk-campaigns/'.length));
    const campaign = getCampaign(id);
    
    if (!campaign) {
      sendJson(res, 404, { error: 'campaign_not_found' });
      return;
    }

    sendJson(res, 200, { campaign });
    return;
  }

  // POST /bulk-campaigns - Cria campanha
  if (method === 'POST' && pathname === '/bulk-campaigns') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'bulk_messaging', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const result = createCampaign({
        ...body,
        createdBy: req.agent.id,
      });

      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'bulk_campaign_create',
        resource: 'bulk_campaign',
        resourceId: result.campaign.id,
        details: { recipients: result.campaign.totalRecipients },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 201, result.campaign);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar campanha:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // PUT /bulk-campaigns/:id - Atualiza campanha
  if (method === 'PUT' && pathname.startsWith('/bulk-campaigns/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'bulk_messaging', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/bulk-campaigns/'.length));
      const body = await parseJsonBody(req);
      const result = updateCampaign(id, body);

      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'bulk_campaign_update',
        resource: 'bulk_campaign',
        resourceId: id,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result.campaign);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atualizar campanha:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // DELETE /bulk-campaigns/:id - Remove campanha
  if (method === 'DELETE' && pathname.startsWith('/bulk-campaigns/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'bulk_messaging', 'delete');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const id = decodeURIComponent(pathname.slice('/bulk-campaigns/'.length));
    const result = deleteCampaign(id);

    if (!result.success) {
      badRequest(res, result.error);
      return;
    }

    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      action: 'bulk_campaign_delete',
      resource: 'bulk_campaign',
      resourceId: id,
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, { success: true });
    return;
  }

  // POST /bulk-campaigns/:id/start - Inicia campanha
  if (method === 'POST' && pathname.startsWith('/bulk-campaigns/') && pathname.endsWith('/start')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'bulk_messaging', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/bulk-campaigns/'.length, -'/start'.length));
      const result = await startCampaign(id);

      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      sendJson(res, 200, { success: true });
    } catch (err) {
      logger.error('Erro ao iniciar campanha:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // POST /bulk-campaigns/:id/pause - Pausa campanha
  if (method === 'POST' && pathname.startsWith('/bulk-campaigns/') && pathname.endsWith('/pause')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'bulk_messaging', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/bulk-campaigns/'.length, -'/pause'.length));
      const result = pauseCampaign(id);

      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      sendJson(res, 200, { success: true });
    } catch (err) {
      logger.error('Erro ao pausar campanha:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // POST /bulk-campaigns/:id/resume - Retoma campanha
  if (method === 'POST' && pathname.startsWith('/bulk-campaigns/') && pathname.endsWith('/resume')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'bulk_messaging', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/bulk-campaigns/'.length, -'/resume'.length));
      const result = resumeCampaign(id);

      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      sendJson(res, 200, { success: true });
    } catch (err) {
      logger.error('Erro ao retomar campanha:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Dashboard de Análise (Analytics)
  // -----------------------------------------------------------------------

  // GET /analytics/metrics - Obtém todas as métricas
  if (method === 'GET' && pathname === '/analytics/metrics') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const options = {
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };

      const metrics = getAllMetrics(options);
      sendJson(res, 200, metrics);
    } catch (err) {
      logger.error('Erro ao obter métricas:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // GET /analytics/general - Métricas gerais
  if (method === 'GET' && pathname === '/analytics/general') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const options = {
        tenantId: req.tenantId,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };

      const metrics = getGeneralMetrics(options);
      sendJson(res, 200, metrics);
    } catch (err) {
      logger.error('Erro ao obter métricas gerais:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // GET /analytics/agents - Métricas por agente
  if (method === 'GET' && pathname === '/analytics/agents') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const options = {
        tenantId: req.tenantId,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };

      const metrics = getAgentMetrics(options);
      sendJson(res, 200, { agents: metrics });
    } catch (err) {
      logger.error('Erro ao obter métricas de agentes:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // GET /analytics/departments - Métricas por departamento
  if (method === 'GET' && pathname === '/analytics/departments') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const options = {
        tenantId: req.tenantId,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };

      const metrics = getDepartmentMetrics(options);
      sendJson(res, 200, { departments: metrics });
    } catch (err) {
      logger.error('Erro ao obter métricas de departamentos:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // GET /analytics/queues - Métricas por fila
  if (method === 'GET' && pathname === '/analytics/queues') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const options = {
        tenantId: req.tenantId,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };

      const metrics = getQueueMetrics(options);
      sendJson(res, 200, { queues: metrics });
    } catch (err) {
      logger.error('Erro ao obter métricas de filas:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // GET /analytics/trends - Métricas de tendência
  if (method === 'GET' && pathname === '/analytics/trends') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const options = {
        tenantId: req.tenantId,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
        groupBy: urlObj.searchParams.get('groupBy') || 'day',
      };

      const metrics = getTrendMetrics(options);
      sendJson(res, 200, { trends: metrics });
    } catch (err) {
      logger.error('Erro ao obter métricas de tendência:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Exportação de Dados
  // -----------------------------------------------------------------------

  // GET /export/tickets.csv - Exporta tickets em CSV
  if (method === 'GET' && pathname === '/export/tickets.csv') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'reports', 'export');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const options = {
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
        status: urlObj.searchParams.get('status') || undefined,
        queue: urlObj.searchParams.get('queue') || undefined,
      };

      const csv = exportTicketsCSV(options);
      const filename = `tickets_${new Date().toISOString().split('T')[0]}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.writeHead(200);
      res.end('\ufeff' + csv); // BOM para Excel reconhecer UTF-8
    } catch (err) {
      logger.error('Erro ao exportar tickets:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // GET /export/metrics.csv - Exporta métricas em CSV
  if (method === 'GET' && pathname === '/export/metrics.csv') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'reports', 'export');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const options = {
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };

      const csv = exportMetricsCSV(options);
      const filename = `metrics_${new Date().toISOString().split('T')[0]}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.writeHead(200);
      res.end('\ufeff' + csv);
    } catch (err) {
      logger.error('Erro ao exportar métricas:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // GET /export/conversations.json - Exporta conversas em JSON
  if (method === 'GET' && pathname === '/export/conversations.json') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'reports', 'export');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const options = {
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };

      const data = exportConversationsJSON(options);
      const filename = `conversations_${new Date().toISOString().split('T')[0]}.json`;

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      sendJson(res, 200, data);
    } catch (err) {
      logger.error('Erro ao exportar conversas:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // GET /export/full-report.json - Exporta relatório completo em JSON
  if (method === 'GET' && pathname === '/export/full-report.json') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'reports', 'export');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const options = {
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };

      const data = exportFullReportJSON(options);
      const filename = `full-report_${new Date().toISOString().split('T')[0]}.json`;

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      sendJson(res, 200, data);
    } catch (err) {
      logger.error('Erro ao exportar relatório completo:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // IA: Sugestão de Resposta e Reescrita
  // -----------------------------------------------------------------------

  // POST /ai/suggest-response - Sugere respostas baseadas no contexto
  if (method === 'POST' && pathname === '/ai/suggest-response') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { userMessage, conversationHistory, ticketId, tenantId } = body || {};

      if (!userMessage || typeof userMessage !== 'string') {
        badRequest(res, 'Campo "userMessage" é obrigatório e deve ser uma string');
        return;
      }

      const result = await suggestResponse({
        userMessage,
        conversationHistory: conversationHistory || [],
        ticketId,
        tenantId,
      });

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao sugerir resposta:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao gerar sugestões',
      });
    }
    return;
  }

  // POST /ai/rewrite-message - Reescreve mensagem de forma mais profissional
  if (method === 'POST' && pathname === '/ai/rewrite-message') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { message, tone, context, tenantId } = body || {};

      if (!message || typeof message !== 'string') {
        badRequest(res, 'Campo "message" é obrigatório e deve ser uma string');
        return;
      }

      const result = await rewriteMessage({
        message,
        tone: tone || 'professional',
        context,
        tenantId,
      });

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao reescrever mensagem:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao reescrever mensagem',
      });
    }
    return;
  }

  // POST /ai/rewrite-multiple - Reescreve múltiplas mensagens
  if (method === 'POST' && pathname === '/ai/rewrite-multiple') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { messages, tone, tenantId } = body || {};

      if (!Array.isArray(messages) || messages.length === 0) {
        badRequest(res, 'Campo "messages" é obrigatório e deve ser um array não vazio');
        return;
      }

      const result = await rewriteMultipleMessages({
        messages,
        tone: tone || 'professional',
        tenantId,
      });

      sendJson(res, 200, { results: result });
    } catch (err) {
      logger.error('Erro ao reescrever múltiplas mensagens:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao reescrever mensagens',
      });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Transcrição de Áudio
  // -----------------------------------------------------------------------

  // POST /audio/transcribe - Transcreve áudio
  if (method === 'POST' && pathname === '/audio/transcribe') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { audioUrl, audioData, provider, tenantId } = body || {};

      if (!audioUrl && !audioData) {
        badRequest(res, 'Campo "audioUrl" ou "audioData" é obrigatório');
        return;
      }

      const audioInput = audioUrl || (audioData ? Buffer.from(audioData, 'base64') : null);
      
      const result = await transcribeAudio({
        audioData: audioInput,
        provider: provider || 'whisper',
        tenantId,
      });

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao transcrever áudio:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao transcrever áudio',
      });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Segmentação e Tags
  // -----------------------------------------------------------------------

  // GET /segmentation/tags - Lista todas as tags
  if (method === 'GET' && pathname === '/segmentation/tags') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const tags = getAllTags({ tenantId: req.tenantId });
    sendJson(res, 200, { tags });
    return;
  }

  // GET /segmentation/categories - Lista todas as categorias
  if (method === 'GET' && pathname === '/segmentation/categories') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const categories = getAllCategories({ tenantId: req.tenantId });
    sendJson(res, 200, { categories });
    return;
  }

  // GET /segmentation/tickets - Filtra tickets por critérios
  if (method === 'GET' && pathname === '/segmentation/tickets') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const filters = {
        tenantId: req.tenantId,
        tags: urlObj.searchParams.get('tags') ? urlObj.searchParams.get('tags').split(',') : undefined,
        category: urlObj.searchParams.get('category') || undefined,
        status: urlObj.searchParams.get('status') || undefined,
        queue: urlObj.searchParams.get('queue') || undefined,
        assignedTo: urlObj.searchParams.get('assignedTo') || undefined,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
        search: urlObj.searchParams.get('search') || undefined,
      };

      const tickets = filterTickets(filters);
      sendJson(res, 200, { tickets, count: tickets.length });
    } catch (err) {
      logger.error('Erro ao filtrar tickets:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // GET /segmentation/stats - Estatísticas de segmentação
  if (method === 'GET' && pathname === '/segmentation/stats') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const filters = {
        tenantId: req.tenantId,
        tags: urlObj.searchParams.get('tags') ? urlObj.searchParams.get('tags').split(',') : undefined,
        category: urlObj.searchParams.get('category') || undefined,
        status: urlObj.searchParams.get('status') || undefined,
        queue: urlObj.searchParams.get('queue') || undefined,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };

      const stats = getSegmentationStats(filters);
      sendJson(res, 200, stats);
    } catch (err) {
      logger.error('Erro ao obter estatísticas de segmentação:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // POST /tickets/:id/tags - Adiciona tag a um ticket
  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/tags')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/tags'.length));
      const ticket = getTicket(id);
      if (!ticket) {
        sendJson(res, 404, { error: 'ticket_not_found' });
        return;
      }
      if (req.tenantId && ticket.tenantId !== req.tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
        return;
      }
      const body = await parseJsonBody(req);
      const { tag } = body || {};

      if (!tag || typeof tag !== 'string') {
        badRequest(res, 'Campo "tag" é obrigatório');
        return;
      }

      const result = addTagToTicket(id, tag);
      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      sendJson(res, 200, result.ticket);
    } catch (err) {
      logger.error('Erro ao adicionar tag:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // DELETE /tickets/:id/tags/:tag - Remove tag de um ticket
  if (method === 'DELETE' && pathname.includes('/tickets/') && pathname.includes('/tags/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const parts = pathname.split('/');
      const ticketIndex = parts.indexOf('tickets');
      const tagIndex = parts.indexOf('tags');
      const ticketId = decodeURIComponent(parts[ticketIndex + 1]);
      const tag = decodeURIComponent(parts[tagIndex + 1]);

      const ticket = getTicket(ticketId);
      if (!ticket) {
        sendJson(res, 404, { error: 'ticket_not_found' });
        return;
      }
      if (req.tenantId && ticket.tenantId !== req.tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
        return;
      }

      const result = removeTagFromTicket(ticketId, tag);
      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      sendJson(res, 200, result.ticket);
    } catch (err) {
      logger.error('Erro ao remover tag:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // PUT /tickets/:id/category - Define categoria de um ticket
  if (method === 'PUT' && pathname.startsWith('/tickets/') && pathname.endsWith('/category')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/category'.length));
      const ticket = getTicket(id);
      if (!ticket) {
        sendJson(res, 404, { error: 'ticket_not_found' });
        return;
      }
      if (req.tenantId && ticket.tenantId !== req.tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
        return;
      }
      const body = await parseJsonBody(req);
      const { category } = body || {};

      const result = setTicketCategory(id, category);
      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      sendJson(res, 200, result.ticket);
    } catch (err) {
      logger.error('Erro ao definir categoria:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Templates WhatsApp Business API
  // -----------------------------------------------------------------------

  // GET /whatsapp/templates - Lista templates aprovados
  if (method === 'GET' && pathname === '/whatsapp/templates') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'flows', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const templates = await listTemplates();
      sendJson(res, 200, { templates });
    } catch (err) {
      logger.error('Erro ao listar templates:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // GET /whatsapp/templates/:id - Obtém template específico
  if (method === 'GET' && pathname.startsWith('/whatsapp/templates/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'flows', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/whatsapp/templates/'.length));
      const template = await getTemplate(id);
      
      if (!template) {
        sendJson(res, 404, { error: 'template_not_found' });
        return;
      }

      sendJson(res, 200, { template });
    } catch (err) {
      logger.error('Erro ao obter template:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // POST /whatsapp/templates - Cria novo template
  if (method === 'POST' && pathname === '/whatsapp/templates') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'flows', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const result = await createTemplate(body);

      if (!result.success) {
        badRequest(res, result.error);
        return;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'whatsapp_template_create',
        resource: 'whatsapp_template',
        resourceId: result.templateId,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 201, { templateId: result.templateId });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar template:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    }
    return;
  }

  // POST /whatsapp/send-template - Envia mensagem usando template
  if (method === 'POST' && pathname === '/whatsapp/send-template') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'tickets', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { to, templateName, languageCode, parameters } = body || {};

      if (!to || !templateName) {
        badRequest(res, 'Campos "to" e "templateName" são obrigatórios');
        return;
      }

      const result = await sendTemplateMessage(
        to,
        templateName,
        languageCode || 'pt_BR',
        parameters || []
      );

      if (!result.success) {
        sendJson(res, 500, { error: 'send_failed', message: result.error });
        return;
      }

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao enviar template:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // =======================================================================
  // RAG Documents Management
  // =======================================================================

  // GET /rag/documents - Lista documentos
  if (method === 'GET' && pathname === '/rag/documents') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const filters = {
        tenantId: url.searchParams.get('tenantId') || req.tenantId,
        source: url.searchParams.get('source') || null,
        category: url.searchParams.get('category') || null,
        productId: url.searchParams.get('productId') || null,
        clientId: url.searchParams.get('clientId') || null,
        status: url.searchParams.get('status') || null,
        search: url.searchParams.get('search') || null,
      };

      const documents = listDocuments(filters);
      sendJson(res, 200, documents);
    } catch (err) {
      logger.error('Erro ao listar documentos:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // GET /rag/deduplication/stats - Estatísticas de deduplicação
  if (method === 'GET' && pathname === '/rag/deduplication/stats') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const tenantId = url.searchParams.get('tenantId') || req.tenantId;
      
      if (!tenantId) {
        sendJson(res, 400, { error: 'tenantId é obrigatório' });
        return;
      }

      const { getDeduplicationStats } = require('./services/ragDeduplicationService');
      const stats = getDeduplicationStats(tenantId);

      sendJson(res, 200, stats);
    } catch (err) {
      logger.error('Erro ao obter estatísticas de deduplicação:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // GET /rag/documents/stats - Estatísticas de documentos
  if (method === 'GET' && pathname === '/rag/documents/stats') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const tenantId = url.searchParams.get('tenantId') || req.tenantId;
      const stats = await getDocumentsStats(tenantId);
      sendJson(res, 200, stats);
    } catch (err) {
      logger.error('Erro ao obter estatísticas:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // GET /rag/documents/:id - Obtém documento específico
  if (method === 'GET' && pathname.startsWith('/rag/documents/') && pathname !== '/rag/documents/stats') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const documentId = decodeURIComponent(pathname.slice('/rag/documents/'.length));
      const document = getDocument(documentId);
      
      if (!document) {
        sendJson(res, 404, { error: 'document_not_found' });
        return;
      }

      sendJson(res, 200, document);
    } catch (err) {
      logger.error('Erro ao obter documento:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // POST /rag/documents - Cria documento
  if (method === 'POST' && pathname === '/rag/documents') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const tenantId = body.tenantId || req.tenantId;
      const result = await createDocument(body, tenantId);

      if (!result.success) {
        sendJson(res, 400, { error: 'creation_failed', message: result.error });
        return;
      }

      // Se é duplicata, retorna 200 (OK) ao invés de 201 (Created)
      if (result.isDuplicate) {
        logger.info('[RAGDocuments] Documento duplicado detectado no endpoint', {
          documentId: result.document.id,
          tenantId,
          isDuplicate: true
        });
        
        sendJson(res, 200, {
          ...result.document,
          isDuplicate: true,
          message: result.existingDocument ? 'Documento já existe (duplicado detectado)' : 'Documento duplicado',
        });
        return;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_document_create',
        resource: 'rag_document',
        resourceId: result.document.id,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 201, result.document);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar documento:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    }
    return;
  }

  // PUT /rag/documents/:id - Atualiza documento
  if (method === 'PUT' && pathname.startsWith('/rag/documents/') && !pathname.endsWith('/reindex')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const documentId = decodeURIComponent(pathname.slice('/rag/documents/'.length));
      const body = await parseJsonBody(req);
      const result = await updateDocument(documentId, body);

      if (!result.success) {
        sendJson(res, 400, { error: 'update_failed', message: result.error });
        return;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_document_update',
        resource: 'rag_document',
        resourceId: documentId,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result.document);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atualizar documento:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    }
    return;
  }

  // DELETE /rag/documents/:id - Deleta documento
  if (method === 'DELETE' && pathname.startsWith('/rag/documents/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'delete');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const documentId = decodeURIComponent(pathname.slice('/rag/documents/'.length));
      const result = await deleteDocument(documentId);

      if (!result.success) {
        sendJson(res, 400, { error: 'delete_failed', message: result.error });
        return;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_document_delete',
        resource: 'rag_document',
        resourceId: documentId,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, { success: true });
    } catch (err) {
      logger.error('Erro ao deletar documento:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // POST /rag/documents/:id/reindex - Reindexa documento
  if (method === 'POST' && pathname.startsWith('/rag/documents/') && pathname.endsWith('/reindex')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const documentId = decodeURIComponent(pathname.slice('/rag/documents/'.length).replace('/reindex', ''));
      const result = await reindexDocument(documentId);

      if (!result.success) {
        sendJson(res, 400, { error: 'reindex_failed', message: result.error });
        return;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_document_reindex',
        resource: 'rag_document',
        resourceId: documentId,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, {
        success: true,
        chunksCreated: result.chunksCreated,
      });
    } catch (err) {
      logger.error('Erro ao reindexar documento:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // POST /rag/documents/reindex-all - Reindexa todos os documentos não indexados
  if (method === 'POST' && pathname === '/rag/documents/reindex-all') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      let tenantId = null;
      // Body é opcional - se fornecido, parseia
      let includeInconsistent = false;
      if (hasJsonContentType(req) && req.headers['content-length'] && parseInt(req.headers['content-length']) > 0) {
        const body = await parseJsonBody(req);
        tenantId = body?.tenantId || null;
        includeInconsistent = body?.includeInconsistent === true;
      }
      
      const result = await reindexAllNotIndexed(tenantId, includeInconsistent);

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_documents_reindex_all',
        resource: 'rag_documents',
        resourceId: 'all',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao reindexar documentos em lote:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // POST /rag/query - Faz uma pergunta ao sistema RAG
  if (method === 'POST' && pathname === '/rag/query') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'query');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { query, tenantId, options = {} } = body;

      if (!query || !query.trim()) {
        sendJson(res, 400, { error: 'invalid_request', message: 'Query não pode ser vazia' });
        return;
      }

      // Obtém tenantId do body ou do agente autenticado
      const finalTenantId = tenantId || req.tenantId;

      // Prepara filtros (pode ser expandido no futuro)
      const filters = {
        topK: options.topK || 6,  // Aumentado de 5 para 6 para melhor cobertura
        minScore: options.minScore || 0.45,  // Reduzido de 0.5 para 0.45 para melhor taxa de sucesso
        maxTokens: options.maxTokens || 1000,
      };

      const result = await ragService.queryRag(query, finalTenantId, {}, filters);

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_query',
        resource: 'rag',
        resourceId: 'query',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao consultar RAG:', {
        error: err.message,
        stack: err.stack,
        originalError: err.originalError?.message,
      });
      
      // Melhora mensagens de erro para o usuário
      let errorMessage = err.message || 'Erro desconhecido ao consultar RAG';
      
      // Se o erro original contém informações sobre o serviço não estar disponível
      if (err.message && (err.message.includes('não está acessível') || err.message.includes('não encontrado'))) {
        errorMessage = err.message;
      } else if (err.originalError) {
        errorMessage = err.originalError.message || errorMessage;
      }
      
      sendJson(res, 500, { 
        error: 'internal_error', 
        message: errorMessage,
        success: false 
      });
    }
    return;
  }

  // GET /rag/learning/metrics/:tenantId - Obtém métricas de aprendizado
  if (method === 'GET' && pathname.startsWith('/rag/learning/metrics/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const tenantId = decodeURIComponent(pathname.slice('/rag/learning/metrics/'.length));
      const metrics = await ragService.getLearningMetrics(tenantId);
      sendJson(res, 200, metrics);
    } catch (err) {
      logger.error('Erro ao obter métricas de aprendizado:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // POST /rag/learning/update-synonyms - Atualiza sinônimos baseado em documentos
  if (method === 'POST' && pathname === '/rag/learning/update-synonyms') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { tenant_id, documents } = body;

      if (!tenant_id || !documents) {
        sendJson(res, 400, { error: 'invalid_request', message: 'tenant_id e documents são obrigatórios' });
        return;
      }

      const result = await ragService.updateSynonymsFromDocuments(tenant_id, documents);
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao atualizar sinônimos:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // POST /rag/learning/trigger-learning/:tenantId - Dispara aprendizado completo
  if (method === 'POST' && pathname.startsWith('/rag/learning/trigger-learning/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const tenantId = decodeURIComponent(pathname.slice('/rag/learning/trigger-learning/'.length));
      const result = await ragService.triggerLearning(tenantId);
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao disparar aprendizado:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // GET /rag/learning/full-data/:tenantId - Obtém todos os dados de aprendizado
  if (method === 'GET' && pathname.startsWith('/rag/learning/full-data/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const tenantId = decodeURIComponent(pathname.slice('/rag/learning/full-data/'.length));
      const result = await ragService.getFullLearningData(tenantId);
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao obter dados completos de aprendizado:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // PUT /rag/learning/synonyms - Atualiza sinônimo específico
  if (method === 'PUT' && pathname === '/rag/learning/synonyms') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { tenant_id, term, synonyms } = body;

      if (!tenant_id || !term || !synonyms) {
        sendJson(res, 400, { error: 'invalid_request', message: 'tenant_id, term e synonyms são obrigatórios' });
        return;
      }

      const result = await ragService.updateSynonym(tenant_id, term, synonyms);
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao atualizar sinônimo:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // DELETE /rag/learning/synonyms/:tenantId/:term - Remove sinônimo específico
  if (method === 'DELETE' && pathname.startsWith('/rag/learning/synonyms/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'delete');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const parts = pathname.split('/').filter(p => p);
      if (parts.length < 5) {
        sendJson(res, 400, { error: 'invalid_request', message: 'Caminho inválido' });
        return;
      }

      const tenantId = decodeURIComponent(parts[3]);
      const term = decodeURIComponent(parts[4]);

      const result = await ragService.deleteSynonym(tenantId, term);
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao remover sinônimo:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // GET /rag/learning/validation-rules - Obtém regras de validação
  if (method === 'GET' && pathname === '/rag/learning/validation-rules') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const serviceUrl = ragService.getRagServiceUrl(req.tenantId);
      const timeout = ragService.getRagTimeout(req.tenantId);

      const response = await fetch(`${serviceUrl}/rag/learning/validation-rules`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`RAG learning service error: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao obter regras de validação:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // POST /rag/learning/validation-rules/adapt/:tenantId - Dispara adaptação de regras
  if (method === 'POST' && pathname.startsWith('/rag/learning/validation-rules/adapt/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const tenantId = decodeURIComponent(pathname.slice('/rag/learning/validation-rules/adapt/'.length));
      const serviceUrl = ragService.getRagServiceUrl(tenantId);
      const timeout = ragService.getRagTimeout(tenantId);

      const response = await fetch(`${serviceUrl}/rag/learning/validation-rules/adapt/${tenantId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`RAG learning service error: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao adaptar regras:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // POST /rag/learning/clean-invalid-queries/:tenantId - Remove queries inválidas
  if (method === 'POST' && pathname.startsWith('/rag/learning/clean-invalid-queries/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const tenantId = decodeURIComponent(pathname.slice('/rag/learning/clean-invalid-queries/'.length));
      const result = await ragService.cleanInvalidQueries(tenantId);
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao limpar queries inválidas:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // GET /rag/domains - Obtém configuração de domínios RAG para o tenant
  if (method === 'GET' && pathname === '/rag/domains') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      // Obtém tenantId do agente autenticado ou do query param
      const queryParams = new URLSearchParams(req.url.split('?')[1] || '');
      const tenantIdParam = queryParams.get('tenantId');
      const finalTenantId = tenantIdParam || req.tenantId;

      // Obtém configuração de domínios
      const domains = ragService.getRagDomains(finalTenantId);
      
      // Adiciona informações detalhadas para cada domínio
      const domainsInfo = {
        tenantId: finalTenantId,
        domains: {
          chatbot: {
            ...domains.chatbot,
            enabled: ragService.isRagDomainEnabled(finalTenantId, 'chatbot'),
            sources: ragService.getRagDomainSources(finalTenantId, 'chatbot'),
          },
          rpa: {
            ...domains.rpa,
            enabled: ragService.isRagDomainEnabled(finalTenantId, 'rpa'),
            sources: ragService.getRagDomainSources(finalTenantId, 'rpa'),
          },
        },
      };

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_domains_read',
        resource: 'rag_domains',
        resourceId: finalTenantId,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, domainsInfo);
    } catch (err) {
      logger.error('Erro ao obter configuração de domínios RAG:', err);
      sendJson(res, 500, { 
        error: 'internal_error', 
        message: err.message,
      });
    }
    return;
  }

  // POST /web-scraping/scrape - Raspa uma URL
  if (method === 'POST' && pathname === '/web-scraping/scrape') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }
    const permResult = requirePermission(req, 'rag', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    try {
      const body = await parseJsonBody(req);
      if (!body.url) {
        badRequest(res, 'URL é obrigatória');
        return;
      }
      const userId = req.agent?.id || req.agent?.username || 'anonymous';
      const executionId = body.executionId || `exec-${Date.now()}`;
      
      const result = await scrapeUrl(body.url, {
        contentSelector: body.contentSelector,
        removeSelectors: body.removeSelectors,
        timeout: body.timeout || 30000,
        autoIndex: body.autoIndex !== false,
        source: body.source || 'web_scraping',
        category: body.category,
        tags: body.tags || [],
        tenantId: req.tenantId,
        userId,
        executionId,
      });
      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'web_scraping',
        resource: 'web_scraping',
        resourceId: result.documentId,
        details: { url: body.url },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });
      sendJson(res, 200, result);
    } catch (err) {
      // Trata erro de rate limit
      if (err.code === 'RATE_LIMIT_EXCEEDED') {
        // Garante que retryAfter é um número válido
        const retryAfter = (err.retryAfter && !isNaN(err.retryAfter) && err.retryAfter > 0)
          ? err.retryAfter
          : 60; // Fallback padrão de 60 segundos
        
        sendJson(res, 429, {
          error: 'rate_limit_exceeded',
          message: `Rate limit excedido. Tente novamente em ${retryAfter} segundos.`,
          retryAfter: retryAfter,
        });
        return;
      }
      logger.error('Erro ao raspar URL:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // POST /web-scraping/scrape-batch - Raspa múltiplas URLs
  if (method === 'POST' && pathname === '/web-scraping/scrape-batch') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }
    const permResult = requirePermission(req, 'rag', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    try {
      const body = await parseJsonBody(req);
      if (!body.urls || !Array.isArray(body.urls) || body.urls.length === 0) {
        badRequest(res, 'URLs é obrigatório e deve ser um array não vazio');
        return;
      }
      const results = await scrapeUrls(body.urls, {
        contentSelector: body.contentSelector,
        removeSelectors: body.removeSelectors,
        timeout: body.timeout || 30000,
        concurrency: body.concurrency || 3,
        autoIndex: body.autoIndex !== false,
        source: body.source || 'web_scraping',
        category: body.category,
        tags: body.tags || [],
        tenantId: req.tenantId,
      });
      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'web_scraping_batch',
        resource: 'web_scraping',
        details: { urlsCount: body.urls.length },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });
      sendJson(res, 200, { results });
    } catch (err) {
      logger.error('Erro ao raspar URLs:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Webhooks Customizados
  // -----------------------------------------------------------------------

  // GET /webhooks/events - Lista eventos disponíveis
  if (method === 'GET' && pathname === '/webhooks/events') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const events = getAvailableEvents();
    sendJson(res, 200, { events });
    return;
  }

  // GET /webhooks - Lista webhooks do tenant
  if (method === 'GET' && pathname === '/webhooks') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const webhooksList = listWebhooks(req.tenantId);
    sendJson(res, 200, { webhooks: webhooksList });
    return;
  }

  // GET /webhooks/:id - Obtém webhook específico
  if (method === 'GET' && pathname.startsWith('/webhooks/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const webhookId = pathname.split('/')[2];
    const webhook = getWebhook(webhookId);

    if (!webhook) {
      sendJson(res, 404, { error: 'not_found', message: 'Webhook não encontrado' });
      return;
    }

    // Verifica se pertence ao tenant do agente
      if (webhook.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Acesso negado' });
      return;
    }

    sendJson(res, 200, { webhook });
    return;
  }

  // POST /webhooks - Cria novo webhook
  if (method === 'POST' && pathname === '/webhooks') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'webhooks', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      
      // Usa tenantId do agente autenticado
      const webhookData = {
        ...body,
        tenantId: body.tenantId || req.tenantId,
      };

      const result = createWebhook(webhookData);

      if (!result.success) {
        sendJson(res, 400, { error: 'validation_error', message: result.error });
        return;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'create',
        resource: 'webhook',
        details: { webhookId: result.webhook.id },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 201, { webhook: result.webhook });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar webhook:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao criar webhook' });
      }
    }
    return;
  }

  // PUT /webhooks/:id - Atualiza webhook
  if (method === 'PUT' && pathname.startsWith('/webhooks/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'webhooks', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const webhookId = pathname.split('/')[2];
      const existingWebhook = getWebhook(webhookId);

      if (!existingWebhook) {
        sendJson(res, 404, { error: 'not_found', message: 'Webhook não encontrado' });
        return;
      }

      // Verifica se pertence ao tenant do agente
      if (existingWebhook.tenantId !== req.tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'Acesso negado' });
        return;
      }

      const body = await parseJsonBody(req);
      const result = updateWebhook(webhookId, body);

      if (!result.success) {
        sendJson(res, 400, { error: 'validation_error', message: result.error });
        return;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'update',
        resource: 'webhook',
        details: { webhookId },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, { webhook: result.webhook });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atualizar webhook:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao atualizar webhook' });
      }
    }
    return;
  }

  // DELETE /webhooks/:id - Deleta webhook
  if (method === 'DELETE' && pathname.startsWith('/webhooks/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'webhooks', 'delete');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const webhookId = pathname.split('/')[2];
    const existingWebhook = getWebhook(webhookId);

    if (!existingWebhook) {
      sendJson(res, 404, { error: 'not_found', message: 'Webhook não encontrado' });
      return;
    }

    // Verifica se pertence ao tenant do agente
      if (existingWebhook.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Acesso negado' });
      return;
    }

    const result = deleteWebhook(webhookId);

    if (!result.success) {
      sendJson(res, 400, { error: 'validation_error', message: result.error });
      return;
    }

    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      action: 'delete',
      resource: 'webhook',
      details: { webhookId },
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, { success: true });
    return;
  }

  // -----------------------------------------------------------------------
  // RPA - Testes Automatizados
  // -----------------------------------------------------------------------

  const {
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
  } = require('./services/rpaService');

  // GET /rpa/recordings - Lista gravações disponíveis
  if (method === 'GET' && pathname === '/rpa/recordings') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    try {
      const recordings = listRecordings();
      sendJson(res, 200, { recordings });
    } catch (error) {
      logger.error('Erro ao listar gravações RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar gravações RPA' });
    }
    return;
  }

  // DELETE /rpa/recordings/:id - Remove uma gravação
  if (method === 'DELETE' && pathname.startsWith('/rpa/recordings/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    try {
      let recordingId = decodeURIComponent(pathname.slice('/rpa/recordings/'.length));
      // Remove .json se presente
      if (recordingId.endsWith('.json')) {
        recordingId = recordingId.slice(0, -'.json'.length);
      }
      
      if (!recordingId || recordingId.trim() === '') {
        badRequest(res, 'ID da gravação é obrigatório');
        return;
      }

      const result = deleteRecording(recordingId);

      if (!result.success) {
        if (result.message.includes('não encontrada')) {
          sendJson(res, 404, {
            error: 'not_found',
            message: result.message,
          });
        } else {
          sendJson(res, 500, {
            error: 'internal_error',
            message: result.message,
          });
        }
        return;
      }

      // eslint-disable-next-line no-console
      logger.debug(`Gravação removida: ${recordingId}`);

      sendJson(res, 200, {
        success: true,
        deletedId: result.deletedId,
        message: result.message,
      });
    } catch (err) {
      logger.error('Erro ao remover gravação', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: 'Erro interno ao remover gravação',
      });
    }
    return;
  }

  // POST /rpa/execute/:recordingId - Executa uma gravação
  if (method === 'POST' && pathname.startsWith('/rpa/execute/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const recordingId = pathname.split('/rpa/execute/')[1];
      if (!recordingId) {
        badRequest(res, 'ID da gravação é obrigatório');
        return;
      }

      const body = await parseJsonBody(req);
      const config = body.config || {};
      const data = body.data || {};
      
      // Passa o token de autenticação para o overlay
      const token = req.token || null;

      const result = await executeRecording(recordingId, config, data, token);
      sendJson(res, 200, result);
    } catch (error) {
      logger.error('Erro ao executar RPA:', error);
      sendJson(res, 500, { 
        error: 'internal_error', 
        message: error.message || 'Erro ao executar RPA' 
      });
    }
    return;
  }

  // GET /rpa/execution/:executionId - Obtém status de execução
  if (method === 'GET' && pathname.startsWith('/rpa/execution/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    try {
      const executionId = pathname.split('/rpa/execution/')[1];
      if (!executionId) {
        badRequest(res, 'ID da execução é obrigatório');
        return;
      }

      const status = getExecutionStatus(executionId);
      if (!status) {
        sendJson(res, 404, { error: 'not_found', message: 'Execução não encontrada' });
        return;
      }

      sendJson(res, 200, status);
    } catch (error) {
      logger.error('Erro ao obter status da execução RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter status' });
    }
    return;
  }

  // POST /rpa/execution/:executionId/cancel - Cancela execução
  if (method === 'POST' && pathname.includes('/rpa/execution/') && pathname.endsWith('/cancel')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    try {
      const parts = pathname.split('/');
      const executionId = parts[parts.length - 2];
      
      if (!executionId) {
        badRequest(res, 'ID da execução é obrigatório');
        return;
      }

      const result = await cancelExecution(executionId);
      if (!result.success) {
        sendJson(res, 400, { error: 'validation_error', message: result.error });
        return;
      }

      sendJson(res, 200, { success: true, message: 'Execução cancelada' });
    } catch (error) {
      logger.error('Erro ao cancelar execução RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao cancelar execução' });
    }
    return;
  }

  // POST /rpa/execution/:executionId/continue - Continua execução pausada sem pausas
  if (method === 'POST' && pathname.includes('/rpa/execution/') && pathname.endsWith('/continue')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    try {
      const parts = pathname.split('/');
      const executionId = parts[parts.length - 2];
      
      if (!executionId) {
        badRequest(res, 'ID da execução é obrigatório');
        return;
      }

      // Continua sem pausas (desativa step-by-step)
      const result = continueExecution(executionId, true);
      if (!result.success) {
        sendJson(res, 400, { error: 'validation_error', message: result.error });
        return;
      }

      sendJson(res, 200, { success: true, message: 'Execução continuada sem pausas' });
    } catch (error) {
      logger.error('Erro ao continuar execução RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao continuar execução' });
    }
    return;
  }

  // POST /rpa/record/start - Inicia gravação manual
  if (method === 'POST' && pathname === '/rpa/record/start') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const seedName = body.seedName || body.name;
      const initialUrl = body.initialUrl || body.url;

      if (!seedName || seedName.trim() === '') {
        badRequest(res, 'Nome do seed (seedName) é obrigatório');
        return;
      }

      const result = await startManualRecording(seedName, initialUrl);
      
      if (!result.success) {
        sendJson(res, 400, result);
        return;
      }

      sendJson(res, 200, result);
    } catch (error) {
      logger.error('Erro ao iniciar gravação manual', error);
      sendJson(res, 500, {
        error: 'internal_error',
        message: error.message || 'Erro ao iniciar gravação manual',
      });
    }
    return;
  }

  // POST /rpa/record/stop/:recordingId - Para gravação manual
  if (method === 'POST' && pathname.startsWith('/rpa/record/stop/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    try {
      const recordingId = pathname.split('/rpa/record/stop/')[1];
      if (!recordingId) {
        badRequest(res, 'ID da gravação é obrigatório');
        return;
      }

      const result = await stopManualRecording(recordingId);
      
      if (!result.success) {
        sendJson(res, 400, result);
        return;
      }

      sendJson(res, 200, result);
    } catch (error) {
      logger.error('Erro ao parar gravação manual', error);
      sendJson(res, 500, {
        error: 'internal_error',
        message: error.message || 'Erro ao parar gravação manual',
      });
    }
    return;
  }

  // GET /rpa/record/status/:recordingId - Obtém status da gravação manual
  if (method === 'GET' && pathname.startsWith('/rpa/record/status/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    try {
      const recordingId = pathname.split('/rpa/record/status/')[1];
      if (!recordingId) {
        badRequest(res, 'ID da gravação é obrigatório');
        return;
      }

      const result = getRecordingStatus(recordingId);
      
      if (!result.success) {
        sendJson(res, 404, result);
        return;
      }

      sendJson(res, 200, result);
    } catch (error) {
      logger.error('Erro ao obter status da gravação', error);
      sendJson(res, 500, {
        error: 'internal_error',
        message: error.message || 'Erro ao obter status da gravação',
      });
    }
    return;
  }

  // POST /rpa/execution/:executionId/next - Executa apenas o próximo step
  if (method === 'POST' && pathname.includes('/rpa/execution/') && pathname.endsWith('/next')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    try {
      const parts = pathname.split('/');
      const executionId = parts[parts.length - 2];
      
      if (!executionId) {
        badRequest(res, 'ID da execução é obrigatório');
        return;
      }

      const result = nextStep(executionId);
      if (!result.success) {
        sendJson(res, 400, { error: 'validation_error', message: result.error });
        return;
      }

      sendJson(res, 200, { success: true, message: 'Próximo step executado' });
    } catch (error) {
      logger.error('Erro ao executar próximo step RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao executar próximo step' });
    }
    return;
  }

  // GET /rpa/execution/:executionId/report - Obtém relatório de execução
  if (method === 'GET' && pathname.includes('/rpa/execution/') && pathname.endsWith('/report')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    try {
      const parts = pathname.split('/');
      const executionId = parts[parts.length - 2];
      
      if (!executionId) {
        badRequest(res, 'ID da execução é obrigatório');
        return;
      }

      const status = getExecutionStatus(executionId);
      if (!status) {
        sendJson(res, 404, { error: 'not_found', message: 'Execução não encontrada' });
        return;
      }

      // Retorna o relatório completo
      sendJson(res, 200, {
        executionId: status.id,
        recordingId: status.recordingId,
        status: status.status,
        startTime: status.startTime,
        endTime: status.endTime,
        results: status.results,
      });
    } catch (error) {
      logger.error('Erro ao obter relatório da execução RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter relatório' });
    }
    return;
  }

  // GET /tests/rpa/reports/:filename - Serve arquivo de relatório RPA
  if (method === 'GET' && pathname.startsWith('/tests/rpa/reports/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    try {
      const filename = pathname.slice('/tests/rpa/reports/'.length);
      
      // Validação de segurança: apenas arquivos JSON e sem path traversal
      if (!filename || filename.includes('..') || filename.includes('/') || !filename.endsWith('.json')) {
        sendJson(res, 400, { error: 'invalid_filename', message: 'Nome de arquivo inválido' });
        return;
      }

      const reportPath = path.join(__dirname, '..', 'tests', 'rpa', 'reports', filename);
      
      // Verifica se o arquivo existe
      if (!fs.existsSync(reportPath)) {
        sendJson(res, 404, { error: 'not_found', message: 'Relatório não encontrado' });
        return;
      }

      // Lê e retorna o arquivo JSON
      const reportContent = fs.readFileSync(reportPath, 'utf8');
      const reportData = JSON.parse(reportContent);
      
      // Retorna com Content-Type correto
      setCorsHeaders(res);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify(reportData));
    } catch (error) {
      if (error instanceof SyntaxError) {
        logger.error('Erro ao fazer parse do relatório JSON:', error);
        sendJson(res, 500, { error: 'invalid_json', message: 'Relatório contém JSON inválido' });
      } else {
        logger.error('Erro ao servir relatório RPA:', error);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro ao servir relatório' });
      }
    }
    return;
  }

  // GET /tests/rpa/replay - Lista todos os arquivos de replay
  if (method === 'GET' && pathname === '/tests/rpa/replay') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    try {
      const replayDir = path.join(__dirname, '..', 'tests', 'rpa', 'replay');
      
      // Verifica se o diretório existe
      if (!fs.existsSync(replayDir)) {
        sendJson(res, 200, { files: [] });
        return;
      }

      // Lista todos os arquivos JSON com detalhes adicionais
      const files = fs.readdirSync(replayDir)
        .filter(file => file.endsWith('.json'))
        .map(file => {
          const filePath = path.join(replayDir, file);
          const stats = fs.statSync(filePath);
          
          // Tenta ler o conteúdo do arquivo para extrair mais detalhes
          let details = {
            filename: file,
            size: stats.size,
            modified: stats.mtime.toISOString(),
            created: stats.birthtime.toISOString(),
          };
          
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            const replayData = JSON.parse(content);
            
            // Extrai informações relevantes do replay
            if (replayData.id) details.id = replayData.id;
            if (replayData.recordingId) details.recordingId = replayData.recordingId;
            if (replayData.startTime) details.startTime = replayData.startTime;
            if (replayData.endTime) details.endTime = replayData.endTime;
            if (replayData.mode) details.mode = replayData.mode;
            if (replayData.result) details.result = replayData.result;
            
            // Conta ações e telas
            if (Array.isArray(replayData.actions)) {
              details.actionCount = replayData.actions.length;
            }
            if (Array.isArray(replayData.screens)) {
              details.screenCount = replayData.screens.length;
            }
            if (Array.isArray(replayData.errors)) {
              details.errorCount = replayData.errors.length;
            }
            
            // Calcula duração se tiver startTime e endTime
            if (replayData.startTime && replayData.endTime) {
              const start = new Date(replayData.startTime);
              const end = new Date(replayData.endTime);
              details.duration = end - start; // em milissegundos
            }
          } catch (parseError) {
            // Se não conseguir fazer parse, mantém apenas os dados básicos
            logger.debug(`Não foi possível extrair detalhes do replay ${file}:`, parseError.message);
          }
          
          return details;
        })
        .sort((a, b) => new Date(b.modified) - new Date(a.modified)); // Mais recentes primeiro

      sendJson(res, 200, { files });
    } catch (error) {
      logger.error('Erro ao listar replays RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar replays' });
    }
    return;
  }

  // GET /tests/rpa/replay/:filename - Serve arquivo de log/replay RPA
  if (method === 'GET' && pathname.startsWith('/tests/rpa/replay/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    try {
      const filename = pathname.slice('/tests/rpa/replay/'.length);
      
      // Validação de segurança: apenas arquivos JSON e sem path traversal
      if (!filename || filename.includes('..') || filename.includes('/') || !filename.endsWith('.json')) {
        sendJson(res, 400, { error: 'invalid_filename', message: 'Nome de arquivo inválido' });
        return;
      }

      const replayPath = path.join(__dirname, '..', 'tests', 'rpa', 'replay', filename);
      
      // Verifica se o arquivo existe
      if (!fs.existsSync(replayPath)) {
        sendJson(res, 404, { error: 'not_found', message: 'Log/Replay não encontrado' });
        return;
      }

      // Lê e retorna o arquivo JSON
      const replayContent = fs.readFileSync(replayPath, 'utf8');
      const replayData = JSON.parse(replayContent);
      
      // Retorna com Content-Type correto
      setCorsHeaders(res);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify(replayData));
    } catch (error) {
      if (error instanceof SyntaxError) {
        logger.error('Erro ao fazer parse do log/replay JSON:', error);
        sendJson(res, 500, { error: 'invalid_json', message: 'Log/Replay contém JSON inválido' });
      } else {
        logger.error('Erro ao servir log/replay RPA:', error);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro ao servir log/replay' });
      }
    }
    return;
  }

  // DELETE /tests/rpa/replay/:filename - Remove arquivo de replay RPA
  if (method === 'DELETE' && pathname.startsWith('/tests/rpa/replay/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    try {
      const filename = pathname.slice('/tests/rpa/replay/'.length);
      
      // Validação de segurança: apenas arquivos JSON e sem path traversal
      if (!filename || filename.includes('..') || filename.includes('/') || !filename.endsWith('.json')) {
        sendJson(res, 400, { error: 'invalid_filename', message: 'Nome de arquivo inválido' });
        return;
      }

      const replayPath = path.join(__dirname, '..', 'tests', 'rpa', 'replay', filename);
      
      // Verifica se o arquivo existe
      if (!fs.existsSync(replayPath)) {
        sendJson(res, 404, { error: 'not_found', message: 'Replay não encontrado' });
        return;
      }

      // Remove o arquivo
      fs.unlinkSync(replayPath);
      
      logger.info(`Replay removido: ${filename}`);
      
      sendJson(res, 200, {
        success: true,
        deletedFilename: filename,
        message: `Replay "${filename}" removido com sucesso`,
      });
    } catch (error) {
      logger.error('Erro ao remover replay RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao remover replay' });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // QA - Qualidade e Validação
  // -----------------------------------------------------------------------

  // GET /qa/latest - Último resultado de QA
  if (method === 'GET' && pathname === '/qa/latest') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    try {
      const result = getLatestQaResult();
      if (!result) {
        sendJson(res, 404, { error: 'not_found', message: 'Nenhum resultado de QA encontrado' });
        return;
      }
      sendJson(res, 200, result);
    } catch (error) {
      logger.error('Erro ao obter último resultado QA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter resultado QA' });
    }
    return;
  }

  // GET /qa/history - Histórico de resultados de QA
  if (method === 'GET' && pathname === '/qa/history') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const source = url.searchParams.get('source') || undefined;

      const history = getQaHistory({ limit, source });
      sendJson(res, 200, { results: history, count: history.length });
    } catch (error) {
      logger.error('Erro ao obter histórico QA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter histórico QA' });
    }
    return;
  }

  // GET /qa/stats - Estatísticas de QA
  if (method === 'GET' && pathname === '/qa/stats') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    try {
      const stats = getQaStatistics();
      sendJson(res, 200, stats);
    } catch (error) {
      logger.error('Erro ao obter estatísticas QA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter estatísticas QA' });
    }
    return;
  }

  // GET /qa/:id - Resultado de QA por ID (commit ou timestamp)
  if (method === 'GET' && pathname.startsWith('/qa/') && pathname !== '/qa/latest' && pathname !== '/qa/history' && pathname !== '/qa/stats') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    try {
      const id = pathname.split('/qa/')[1];
      if (!id) {
        badRequest(res, 'ID do resultado QA é obrigatório');
        return;
      }

      const result = getQaResultById(id);
      if (!result) {
        sendJson(res, 404, { error: 'not_found', message: 'Resultado de QA não encontrado' });
        return;
      }
      sendJson(res, 200, result);
    } catch (error) {
      logger.error('Erro ao obter resultado QA por ID:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter resultado QA' });
    }
    return;
  }

  // POST /qa/run - Executa QA manualmente
  if (method === 'POST' && pathname === '/qa/run') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const permResult = requirePermission(req, 'qa', 'execute');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const changedFiles = body.changedFiles || undefined;
      const source = body.source || 'manual';

      const result = runQaManual({ changedFiles, source });

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'execute',
        resource: 'qa',
        details: { status: result.status, scopes: result.scope },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result);
    } catch (error) {
      logger.error('Erro ao executar QA:', error);
      sendJson(res, 500, { error: 'internal_error', message: error.message || 'Erro ao executar QA' });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Dev - Gerenciamento de Contratos, Prompts e RAG
  // -----------------------------------------------------------------------

  // GET /dev/files - Lista arquivos disponíveis (contratos, prompts)
  // Apenas super-admin pode acessar
  if (method === 'GET' && pathname === '/dev/files') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    // Verifica se é super-admin
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas super-admins podem acessar arquivos de desenvolvimento' });
      return;
    }

    try {
      const projectRoot = path.join(__dirname, '..');
      const contractsDir = path.join(projectRoot, 'contracts');
      const promptsDir = path.join(projectRoot, 'prompts');
      const nodesDir = path.join(projectRoot, 'api/data/rag/chatbot');
      
      const files = {
        contracts: [],
        prompts: [],
        nodes: [],
        documents: {}, // Documentos organizados por categoria
      };

      // Lista contratos
      if (fs.existsSync(contractsDir)) {
        const listFiles = (dir, basePath = '') => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.join(basePath, entry.name).replace(/\\/g, '/');
            
            if (entry.isDirectory()) {
              listFiles(fullPath, relativePath);
            } else if (entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.md'))) {
              files.contracts.push({
                path: relativePath,
                name: entry.name,
                type: entry.name.endsWith('.json') ? 'json' : 'markdown',
                size: fs.statSync(fullPath).size,
              });
            }
          }
        };
        listFiles(contractsDir);
      }

      // Lista prompts
      if (fs.existsSync(promptsDir)) {
        const entries = fs.readdirSync(promptsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.md')) {
            const fullPath = path.join(promptsDir, entry.name);
            files.prompts.push({
              path: entry.name,
              name: entry.name,
              type: 'markdown',
              size: fs.statSync(fullPath).size,
            });
          }
        }
      }

      // Lista arquivos de nós (nodes, schema, rules, errors)
      if (fs.existsSync(nodesDir)) {
        const listNodeFiles = (dir, basePath = '') => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.join(basePath, entry.name).replace(/\\/g, '/');
            
            if (entry.isDirectory()) {
              // Inclui subdiretórios: nodes/, schema/, rules/, known_errors/
              if (entry.name === 'nodes' || entry.name === 'schema' || entry.name === 'rules' || entry.name === 'known_errors') {
                listNodeFiles(fullPath, relativePath);
              }
            } else if (entry.isFile() && entry.name.endsWith('.json')) {
              files.nodes.push({
                path: relativePath,
                name: entry.name,
                type: 'json',
                size: fs.statSync(fullPath).size,
              });
            }
          }
        };
        listNodeFiles(nodesDir);
      }

      // Lista documentos organizados do diretório "dev Documentos"
      const documentsDir = path.join(projectRoot, 'dev Documentos');
      if (fs.existsSync(documentsDir)) {
        const categories = fs.readdirSync(documentsDir, { withFileTypes: true })
          .filter(entry => entry.isDirectory() && entry.name.match(/^\d{2}_/))
          .map(entry => entry.name)
          .sort();
        
        for (const category of categories) {
          const categoryDir = path.join(documentsDir, category);
          const categoryFiles = [];
          
          const listCategoryFiles = (dir, basePath = '') => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              const relativePath = basePath ? path.join(basePath, entry.name).replace(/\\/g, '/') : entry.name;
              
              if (entry.isDirectory()) {
                listCategoryFiles(fullPath, relativePath);
              } else if (entry.isFile() && entry.name.endsWith('.md')) {
                const stats = fs.statSync(fullPath);
                categoryFiles.push({
                  path: relativePath,
                  name: entry.name,
                  type: 'markdown',
                  size: stats.size,
                  modified: stats.mtime.toISOString(),
                });
              }
            }
          };
          
          listCategoryFiles(categoryDir);
          if (categoryFiles.length > 0) {
            files.documents[category] = categoryFiles;
          }
        }
      }

      sendJson(res, 200, files);
    } catch (err) {
      logger.error('[Dev] Erro ao listar arquivos:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message || 'Erro ao listar arquivos' });
    }
    return;
  }

  // GET /dev/files/:type/:path - Lê conteúdo de um arquivo
  // Apenas super-admin pode acessar
  if (method === 'GET' && pathname.startsWith('/dev/files/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    // Verifica se é super-admin
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas super-admins podem ler arquivos de desenvolvimento' });
      return;
    }

    try {
      const parts = pathname.split('/').filter(p => p);
      // parts: ['dev', 'files', 'type', 'path...']
      if (parts.length < 4) {
        badRequest(res, 'Caminho inválido. Use /dev/files/:type/:path');
        return;
      }

      const type = parts[2]; // 'contracts', 'prompts', 'nodes' ou 'documents'
      const filePath = parts.slice(3).join('/'); // resto do caminho

      if (type !== 'contracts' && type !== 'prompts' && type !== 'nodes' && type !== 'documents') {
        badRequest(res, 'Tipo inválido. Use "contracts", "prompts", "nodes" ou "documents"');
        return;
      }

      const projectRoot = path.join(__dirname, '..');
      let baseDir;
      if (type === 'contracts') {
        baseDir = path.join(projectRoot, 'contracts');
      } else if (type === 'prompts') {
        baseDir = path.join(projectRoot, 'prompts');
      } else if (type === 'nodes') {
        baseDir = path.join(projectRoot, 'api/data/rag/chatbot');
      } else if (type === 'documents') {
        // Para documents, o caminho é: categoria/arquivo.md
        const categoryPath = parts[3]; // categoria (ex: 01_Analises)
        const fileName = parts.slice(4).join('/'); // nome do arquivo
        baseDir = path.join(projectRoot, 'dev Documentos', categoryPath);
        filePath = fileName; // Atualiza filePath para o nome do arquivo
      }
      
      const fullPath = path.join(baseDir, filePath);
      
      // Validação de segurança: garante que o caminho está dentro do diretório base
      const normalizedPath = path.normalize(fullPath);
      const normalizedBase = path.normalize(baseDir);
      if (!normalizedPath.startsWith(normalizedBase)) {
        badRequest(res, 'Caminho inválido: tentativa de acesso fora do diretório permitido');
        return;
      }

      if (!fs.existsSync(normalizedPath)) {
        sendJson(res, 404, { error: 'not_found', message: 'Arquivo não encontrado' });
        return;
      }

      const content = fs.readFileSync(normalizedPath, 'utf8');
      const stats = fs.statSync(normalizedPath);
      
      sendJson(res, 200, {
        path: filePath,
        type: type,
        content: content,
        size: stats.size,
        modified: stats.mtime.toISOString(),
      });
    } catch (err) {
      logger.error('[Dev] Erro ao ler arquivo:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message || 'Erro ao ler arquivo' });
    }
    return;
  }

  // PUT /dev/files/:type/:path - Salva conteúdo de um arquivo
  // Apenas super-admin pode acessar
  if (method === 'PUT' && pathname.startsWith('/dev/files/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    // Verifica se é super-admin
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas super-admins podem editar arquivos de desenvolvimento' });
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const parts = pathname.split('/').filter(p => p);
      if (parts.length < 4) {
        badRequest(res, 'Caminho inválido. Use /dev/files/:type/:path');
        return;
      }

      const type = parts[2];
      const filePath = parts.slice(3).join('/');

      if (type !== 'contracts' && type !== 'prompts' && type !== 'nodes' && type !== 'documents') {
        badRequest(res, 'Tipo inválido. Use "contracts", "prompts", "nodes" ou "documents"');
        return;
      }

      const body = await parseJsonBody(req);
      if (!body.content || typeof body.content !== 'string') {
        badRequest(res, 'Campo "content" (string) é obrigatório');
        return;
      }

      const projectRoot = path.join(__dirname, '..');
      let baseDir;
      let filePathToUse = filePath;
      
      if (type === 'contracts') {
        baseDir = path.join(projectRoot, 'contracts');
      } else if (type === 'prompts') {
        baseDir = path.join(projectRoot, 'prompts');
      } else if (type === 'nodes') {
        baseDir = path.join(projectRoot, 'api/data/rag/chatbot');
      } else if (type === 'documents') {
        // Para documents, o caminho é: categoria/arquivo.md
        const categoryPath = parts[3]; // categoria (ex: 01_Analises)
        const fileName = parts.slice(4).join('/'); // nome do arquivo
        baseDir = path.join(projectRoot, 'dev Documentos', categoryPath);
        filePathToUse = fileName; // Atualiza filePath para o nome do arquivo
      }
      
      const fullPath = path.join(baseDir, filePathToUse);
      
      // Validação de segurança
      const normalizedPath = path.normalize(fullPath);
      const normalizedBase = path.normalize(baseDir);
      if (!normalizedPath.startsWith(normalizedBase)) {
        badRequest(res, 'Caminho inválido: tentativa de acesso fora do diretório permitido');
        return;
      }

      // Cria diretório se não existir
      const dir = path.dirname(normalizedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Valida JSON se for arquivo JSON
      if (normalizedPath.endsWith('.json')) {
        try {
          JSON.parse(body.content);
        } catch (jsonErr) {
          badRequest(res, `JSON inválido: ${jsonErr.message}`);
          return;
        }
      }

      // Salva arquivo
      fs.writeFileSync(normalizedPath, body.content, 'utf8');
      
      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'update',
        resource: 'dev_file',
        resourceId: `${type}/${filePath}`,
        details: { type, path: filePath },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      const stats = fs.statSync(normalizedPath);
      sendJson(res, 200, {
        success: true,
        path: filePath,
        type: type,
        size: stats.size,
        modified: stats.mtime.toISOString(),
      });
    } catch (err) {
      logger.error('[Dev] Erro ao salvar arquivo:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message || 'Erro ao salvar arquivo' });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Frontend SPA - Serve index.html para rotas do frontend
  // -----------------------------------------------------------------------
  // Para requisições GET que não são de API, serve o frontend (SPA routing)
  // Isso permite que rotas como /login, /support, etc. funcionem corretamente
  // IMPORTANTE: Também serve para POST/PUT/DELETE de rotas do frontend que não são de API
  // para evitar que formulários HTML padrão causem 404
  const isFrontendRoute = !pathname.startsWith('/api') && 
      !pathname.startsWith('/auth') && 
      !pathname.startsWith('/health') &&
      !pathname.startsWith('/version') &&
      !pathname.startsWith('/system') &&
      !pathname.startsWith('/metrics') &&
      !pathname.startsWith('/tickets') &&
      !pathname.startsWith('/queues') &&
      !pathname.startsWith('/flows') &&
      !pathname.startsWith('/replay') &&
      !pathname.startsWith('/templates') &&
      !pathname.startsWith('/server') &&
      !pathname.startsWith('/tests') &&
      !pathname.startsWith('/rpa') &&
      !pathname.startsWith('/web-scraping') &&
      !pathname.startsWith('/audit') &&
      !pathname.startsWith('/onboarding') &&
      !pathname.startsWith('/tenants') &&
      !pathname.startsWith('/super-admin') &&
      !pathname.startsWith('/conversations') &&
      !pathname.startsWith('/rag') &&
      // /config pode ser rota do frontend ou API
      // Se for GET /config com Accept: application/json, já foi tratado pela rota de API acima
      // Se for GET /config com Accept: text/html (navegação), serve o frontend
      !(pathname === '/config' && req.headers.accept && req.headers.accept.includes('application/json')) &&
      !(pathname.startsWith('/config/') && pathname !== '/config') && // Exclui subcaminhos de /config (como /config/validate-*)
      !pathname.startsWith('/dev') &&
      !pathname.includes('.'); // Não serve HTML para arquivos estáticos (que têm extensão)
  
  if (isFrontendRoute) {
    // Para GET, sempre serve o index.html (SPA routing)
    // Para outros métodos (POST, PUT, DELETE), também serve o index.html para evitar 404
    // quando formulários HTML padrão fazem submit sem JavaScript
    if (method === 'GET' || (method === 'POST' && !req.headers['content-type']?.includes('application/json'))) {
      try {
        const frontendIndexPath = path.join(__dirname, '..', 'frontend', 'index.html');
        
        // Verifica se o arquivo existe
        if (fs.existsSync(frontendIndexPath)) {
          logger.debug('[Server] Servindo index.html do frontend para rota:', pathname);
          const html = fs.readFileSync(frontendIndexPath, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
          });
          res.end(html);
          return;
        } else {
          logger.warn('[Server] index.html do frontend não encontrado em:', frontendIndexPath);
        }
      } catch (err) {
        logger.error('[Server] Erro ao servir index.html do frontend:', err);
      }
    }
  }

  // Qualquer outro endpoint: 404 genérico
  notFound(res);
}

/**
 * Cria um servidor HTTP da API.
 *
 * Exportamos a factory para facilitar testes.
 *
 * @returns {http.Server}
 */
function createServer() {
  const server = http.createServer((req, res) => {
    // Garante que erros não derrubem o processo.
    requestHandler(req, res).catch((err) => {
      logger.error('Erro inesperado ao processar requisição', err);
      sendJson(res, 500, { error: 'internal_error' });
    });
  });

  // Inicializa WebSocket
  initializeWebSocket(server);

  return server;
}

const server = createServer();

// Inicialização automática do systemadmin quando o módulo é carregado
// Isso garante que o systemadmin seja criado mesmo se o servidor for iniciado de outra forma
let initializationPromise = null;
async function startInitialization() {
  if (initializationPromise) {
    return initializationPromise;
  }
  
  initializationPromise = (async () => {
    console.log('[Init] Iniciando inicialização automática...');
    logger.info('[Init] Iniciando inicialização automática...');
    
    // Aguarda um pouco para garantir que todos os módulos foram carregados
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Inicializa banco de dados PostgreSQL (OBRIGATÓRIO)
    console.log('[Init] Conectando ao PostgreSQL...');
    logger.info('[Init] Conectando ao PostgreSQL...');
    
    try {
      // Inicializa conexão Sequelize com retry
      // Usa config.js como fonte principal (config.json > env vars)
      const { connect } = require('./db/sequelize');
      await connect(30, 1000); // 30 tentativas, delay inicial 1s
      console.log('[Init] ✅ PostgreSQL conectado (Sequelize)');
      logger.info('[Init] ✅ PostgreSQL conectado (Sequelize)');
    } catch (dbErr) {
      const error = `Falha ao conectar ao PostgreSQL: ${dbErr.message}`;
      console.error(`[Init] ❌ ${error}`);
      logger.error(`[Init] ❌ ${error}`);
      throw new Error(error);
    }
    
    try {
      // Executa migrations Sequelize
      console.log('[Init] Executando migrations Sequelize...');
      logger.info('[Init] Executando migrations Sequelize...');
      const { runMigrations } = require('./db/migrate');
      await runMigrations();
      console.log('[Init] ✅ Migrations concluídas');
      logger.info('[Init] ✅ Migrations concluídas');
    } catch (migrationErr) {
      const error = `Falha ao executar migrations: ${migrationErr.message}`;
      console.error(`[Init] ❌ ${error}`);
      logger.error(`[Init] ❌ ${error}`);
      throw new Error(error);
    }
    
    try {
      // Executa seed
      console.log('[Init] Executando seed...');
      logger.info('[Init] Executando seed...');
      const { runSeed } = require('./db/seed');
      await runSeed();
      console.log('[Init] ✅ Seed concluído');
      logger.info('[Init] ✅ Seed concluído');
    } catch (seedErr) {
      const error = `Falha ao executar seed: ${seedErr.message}`;
      console.error(`[Init] ❌ ${error}`);
      logger.error(`[Init] ❌ ${error}`);
      throw new Error(error);
    }
    
      try {
        // Define relacionamentos dos models
        const { defineRelationships } = require('./db/models');
        defineRelationships();
        console.log('[Init] ✅ Relacionamentos definidos');
        logger.info('[Init] ✅ Relacionamentos definidos');
      } catch (relErr) {
        console.warn('[Init] ⚠️  Aviso ao definir relacionamentos:', relErr.message);
        logger.warn('[Init] ⚠️  Aviso ao definir relacionamentos:', relErr.message);
      }
      
      try {
        // Garante que o tenant de demonstração existe
        const { ensureDemoTenantExists } = require('./services/tenantService');
        await ensureDemoTenantExists();
        console.log('[Init] ✅ Tenant de demonstração verificado');
        logger.info('[Init] ✅ Tenant de demonstração verificado');
      } catch (demoErr) {
        console.warn('[Init] ⚠️  Aviso ao verificar tenant de demonstração:', demoErr.message);
        logger.warn('[Init] ⚠️  Aviso ao verificar tenant de demonstração:', demoErr.message);
      }

      // Inicializa tenant_contexts (best-effort)
      try {
        const { initializeTenantContexts } = require('./services/tenantService');
        await initializeTenantContexts();
        console.log('[Init] ✅ Tenant contexts inicializados');
        logger.info('[Init] ✅ Tenant contexts inicializados');
      } catch (ctxErr) {
        console.warn('[Init] ⚠️  Aviso ao inicializar tenant contexts:', ctxErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar tenant contexts:', ctxErr.message);
      }

      // Carrega fluxos persistidos no PostgreSQL (best-effort)
      try {
        await loadFlowsFromDb();
        console.log('[Init] ✅ Fluxos carregados');
        logger.info('[Init] ✅ Fluxos carregados');
      } catch (flowInitErr) {
        console.warn('[Init] ⚠️  Aviso ao carregar fluxos:', flowInitErr.message);
        logger.warn('[Init] ⚠️  Aviso ao carregar fluxos:', flowInitErr.message);
      }

      try {
        // Inicializa cache do AuthService (necessário para validateToken síncrono)
        const { initialize: initializeAuthService } = require('./services/authService');
        await initializeAuthService();
        console.log('[Init] ✅ AuthService inicializado');
        logger.info('[Init] ✅ AuthService inicializado');
      } catch (authInitErr) {
        const error = `Falha ao inicializar AuthService: ${authInitErr.message}`;
        console.error(`[Init] ❌ ${error}`);
        logger.error(`[Init] ❌ ${error}`);
        throw new Error(error);
      }
      
      // Inicializa cache de tickets/queues (best-effort)
      try {
        const { initialize: initializeQueueService } = require('./services/queueService');
        await initializeQueueService();
        console.log('[Init] ✅ QueueService inicializado');
        logger.info('[Init] ✅ QueueService inicializado');
      } catch (queueInitErr) {
        console.warn('[Init] ⚠️  Aviso ao inicializar QueueService:', queueInitErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar QueueService:', queueInitErr.message);
      }

      // Inicializa caches DB-only (best-effort): departments, quick replies, webhooks, rag documents
      try {
        const { initialize: initializeDepartments } = require('./services/departmentsService');
        await initializeDepartments();
        console.log('[Init] ✅ DepartmentsService inicializado');
        logger.info('[Init] ✅ DepartmentsService inicializado');
      } catch (deptErr) {
        console.warn('[Init] ⚠️  Aviso ao inicializar DepartmentsService:', deptErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar DepartmentsService:', deptErr.message);
      }

      // Inicializa cache de definições de filas (best-effort)
      try {
        await queueDefinitionService.initialize();
        console.log('[Init] ✅ QueueDefinitionService inicializado');
        logger.info('[Init] ✅ QueueDefinitionService inicializado');
      } catch (qDefErr) {
        console.warn('[Init] ⚠️  Aviso ao inicializar QueueDefinitionService:', qDefErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar QueueDefinitionService:', qDefErr.message);
      }

      try {
        const { initialize: initializeQuickReplies } = require('./services/quickRepliesService');
        await initializeQuickReplies();
        console.log('[Init] ✅ QuickRepliesService inicializado');
        logger.info('[Init] ✅ QuickRepliesService inicializado');
      } catch (qrErr) {
        console.warn('[Init] ⚠️  Aviso ao inicializar QuickRepliesService:', qrErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar QuickRepliesService:', qrErr.message);
      }

      // Inicializa close reasons (best-effort)
      try {
        await closeReasonsService.initialize();
        console.log('[Init] ✅ CloseReasonsService inicializado');
        logger.info('[Init] ✅ CloseReasonsService inicializado');
      } catch (crErr) {
        console.warn('[Init] ⚠️  Aviso ao inicializar CloseReasonsService:', crErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar CloseReasonsService:', crErr.message);
      }

      // Inicializa marketplace de templates de fluxo (best-effort)
      try {
        await flowTemplateMarketplaceService.initialize();
        console.log('[Init] ✅ FlowTemplateMarketplaceService inicializado');
        logger.info('[Init] ✅ FlowTemplateMarketplaceService inicializado');
      } catch (ftErr) {
        console.warn('[Init] ⚠️  Aviso ao inicializar FlowTemplateMarketplaceService:', ftErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar FlowTemplateMarketplaceService:', ftErr.message);
      }

      try {
        const { initialize: initializeWebhooks } = require('./services/webhookService');
        await initializeWebhooks();
        console.log('[Init] ✅ WebhookService inicializado');
        logger.info('[Init] ✅ WebhookService inicializado');
      } catch (whErr) {
        console.warn('[Init] ⚠️  Aviso ao inicializar WebhookService:', whErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar WebhookService:', whErr.message);
      }

      try {
        const { initialize: initializeRagDocuments } = require('./services/ragDocumentsService');
        await initializeRagDocuments();
        console.log('[Init] ✅ RAGDocumentsService inicializado');
        logger.info('[Init] ✅ RAGDocumentsService inicializado');
      } catch (ragDocsErr) {
        console.warn('[Init] ⚠️  Aviso ao inicializar RAGDocumentsService:', ragDocsErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar RAGDocumentsService:', ragDocsErr.message);
      }

      // Inicializa providers de IA do banco de dados (após banco estar conectado)
      try {
        console.log('[Init] Inicializando providers de IA do banco de dados...');
        logger.info('[Init] Inicializando providers de IA do banco de dados...');
        await initializeAiProviders();
        console.log('[Init] ✅ Providers de IA inicializados');
        logger.info('[Init] ✅ Providers de IA inicializados');
      } catch (aiErr) {
        // Não falha a inicialização se houver erro nos providers
        console.warn(`[Init] ⚠️  Aviso ao inicializar providers de IA: ${aiErr.message}`);
        logger.warn(`[Init] ⚠️  Aviso ao inicializar providers de IA: ${aiErr.message}`);
      }
  })();
  
  return initializationPromise;
}

// Salva conversas antes de encerrar o servidor
process.on('SIGINT', () => {
  logger.info('[Conversations] Encerrando servidor, salvando conversas...');
  saveSessionEventsToFileImmediate();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('[Conversations] Encerrando servidor, salvando conversas...');
  saveSessionEventsToFileImmediate();
  process.exit(0);
});

process.on('beforeExit', () => {
  saveSessionEventsToFileImmediate();
});

// Log para debug - verificar se o módulo está sendo executado como main
console.log('[Server] server.js carregado, require.main === module:', require.main === module);
console.log('[Server] require.main:', require.main?.filename);
console.log('[Server] __filename:', __filename);

if (require.main === module) {
  console.log('[Server] ✅ Bloco if (require.main === module) executado');
  // Limpa cache de limiters na inicialização para garantir que novas políticas sejam aplicadas
  clearLimitersCache();
  
  // Inicializa o systemadmin automaticamente na primeira inicialização
  // Usa a função startInitialization() que garante que só executa uma vez
  console.log('[Server] Iniciando servidor...');
  logger.info('[Server] Iniciando servidor...');
  console.log('[Server] Aguardando inicialização do systemadmin...');
  logger.info('[Server] Aguardando inicialização do systemadmin...');
  
  startInitialization().then(() => {
    console.log('[Server] ✅ Inicialização concluída, iniciando servidor...');
    logger.info('[Server] ✅ Inicialização concluída, iniciando servidor...');
    server.listen(port, () => {
      console.log(`API server listening on http://0.0.0.0:${port}`);
      logger.info(`API server listening on http://0.0.0.0:${port}`);
    });

    // Worker outbound (best-effort) - inicia após DB + migrations
    if (process.env.ENABLE_OUTBOUND_WORKER !== 'false') {
      try {
        startOutboundWorker({ intervalMs: 1500, batchSize: 25 });
      } catch (err) {
        logger.warn('[OutboundQueue] Falha ao iniciar worker (ignorado)', { error: err.message });
      }
    }

    // Auto-return-to-bot (best-effort)
    if (process.env.ENABLE_AUTO_RETURN_TO_BOT !== 'false') {
      const inactivityMinutes = parseInt(process.env.AUTO_RETURN_TO_BOT_MINUTES || '30', 10);
      try {
        startAutoReturnToBot({ inactivityMinutes, intervalMs: 15000 });
      } catch (err) {
        logger.warn('[Handover] Falha ao iniciar autoReturnToBot (ignorado)', { error: err.message });
      }
    }

    // Assignment worker (reassign offline) - best-effort
    if (process.env.ENABLE_ASSIGNMENT_WORKER !== 'false') {
      try {
        startAssignmentWorker({ intervalMs: 15000 });
      } catch (err) {
        logger.warn('[Assignment] Falha ao iniciar worker (ignorado)', { error: err.message });
      }
    }

    // Channel Health monitor (best-effort)
    if (process.env.ENABLE_CHANNEL_HEALTH_MONITOR !== 'false') {
      try {
        const { startChannelHealthMonitor } = require('./services/channelHealthService');
        const intervalMs = parseInt(process.env.CHANNEL_HEALTH_MONITOR_INTERVAL_MS || '60000', 10);
        const windowMinutes = parseInt(process.env.CHANNEL_HEALTH_WINDOW_MINUTES || '10', 10);
        const failRateThreshold = parseFloat(process.env.CHANNEL_HEALTH_FAIL_RATE_THRESHOLD || '0.15');
        const minSamples = parseInt(process.env.CHANNEL_HEALTH_MIN_SAMPLES || '20', 10);
        const cooldownMinutes = parseInt(process.env.CHANNEL_HEALTH_COOLDOWN_MINUTES || '10', 10);
        startChannelHealthMonitor({ intervalMs, windowMinutes, failRateThreshold, minSamples, cooldownMinutes });
      } catch (err) {
        logger.warn('[ChannelHealth] Falha ao iniciar monitor (ignorado)', { error: err.message });
      }
    }
  }).catch((error) => {
    console.error('[Server] ❌ Erro crítico ao inicializar systemadmin - servidor não será iniciado');
    console.error('[Server] Erro:', error);
    console.error('[Server] Stack:', error.stack);
    logger.error('[Server] ❌ Erro crítico ao inicializar systemadmin - servidor não será iniciado');
    logger.error('[Server] Erro:', error);
    logger.error('[Server] Stack:', error.stack);
    console.error('[Server] Encerrando processo...');
    process.exit(1);
  });
} else {
  console.log('[Server] ⚠️  Bloco if (require.main === module) NÃO executado - servidor não será iniciado automaticamente');
  // Mesmo assim, inicia a inicialização em background
  startInitialization().catch(err => {
    console.error('[Server] Erro na inicialização em background:', err);
    logger.error('[Server] Erro na inicialização em background:', err);
  });
}

module.exports = {
  createServer,
  server,
  // também exportamos helpers principais para facilitar testes isolados, se preciso
  _internal: {
    parseJsonBody,
    sendJson,
    notFound,
    badRequest,
    ensureFlowHasMeta,
    validateFlowStructure,
    flows,
    sessionEvents,
  },
};


