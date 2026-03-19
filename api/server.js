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
const { validateVoiceFlow } = require('./utils/voiceFlowValidator');
const crypto = require('crypto');
const { setupMfa, verifyMfa, disableMfa, consumeRecoveryCode } = require('./services/mfaService');
const { checkRateLimit } = require('../infra/rate-limit');
const { simulateFlow } = require('../engine/flowSimulation');
const { buildConversationReplay } = require('../engine/replay');
const { verifyWebhook } = require('./services/whatsappService');
const { processWhatsAppMessage } = require('./services/messageProcessor');
const outboundQueueService = require('./services/outboundQueueService');
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
const {
  canAccessTicket,
  canModifyTicket,
  listPermissions,
  createRole,
  getRoleDefinitions,
} = require('./services/rbacService');
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
  updateOutboundMessageMeta,
  markMessagesAsRead,
  getTicketMessages,
} = require('./services/queueService');
  const {
    createTicket,
    transferTicket,
    addTicketNote,
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
  getSupervisorMetrics,
  getSupervisorAgentStatus,
  getSupervisorQueueStatus,
} = require('./services/supervisorService');
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
const channelNormalizationService = require('./services/channelNormalizationService');
const channelGatewayService = require('./services/channelGatewayService');
const outboundWorker = require('./services/outboundWorker');
const { listConversations: listChannelConversations, listConversationMessages } = require('./services/channelConversationService');
const {
  takeOver: takeOverTicket,
  returnToBot: returnTicketToBot,
  setPaused: pauseTicket,
  resumeHuman: resumeHumanTicket,
  startAutoReturnToBot,
} = require('./services/handoverService');
const { resolveOrCreateTicketFromIncomingMessage, appendTicketMessage } = require('./services/conversationTicketLinkService');
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
const { extractKeywords: nlpExtractKeywords, analyzeText: nlpAnalyzeText } = require('./services/nlpService');
const { extractSemanticContext } = require('./services/semanticContextService');
const { storeTicketMedia, getTicketMediaById } = require('./services/ticketMediaService');
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
const { sendApiError, buildApiError } = require('./utils/apiError');

const port = Number(config.get('api.port', 3000));

const scheduleService = require('./services/scheduleService');

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

function normalizeAiProvider(provider) {
  if (!provider || typeof provider !== 'string') return null;
  const normalized = provider.trim().toLowerCase();
  if (normalized === 'openai' || normalized === 'anthropic') return normalized;
  return null;
}

async function validateProviderTokenDirect(provider, apiKey) {
  const normalizedProvider = normalizeAiProvider(provider);
  if (!normalizedProvider) {
    return {
      valid: false,
      error: 'Provider deve ser "openai" ou "anthropic"',
    };
  }

  const cleanApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!cleanApiKey) {
    return {
      valid: false,
      error: 'Token não pode estar vazio',
    };
  }

  try {
    if (normalizedProvider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cleanApiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json().catch(() => null);
        if (data && Array.isArray(data.data)) {
          return { valid: true, error: null };
        }
        return { valid: false, error: 'Resposta inválida da API OpenAI' };
      }

      const errorData = await response.json().catch(() => ({}));
      if (response.status === 401) return { valid: false, error: 'Token inválido ou expirado' };
      if (response.status === 403) return { valid: false, error: 'Token não tem permissão para acessar a API' };
      return {
        valid: false,
        error: errorData.error?.message || `Erro ${response.status}: ${response.statusText}`,
      };
    }

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
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json().catch(() => null);
      if (data && data.content) {
        return { valid: true, error: null };
      }
      return { valid: false, error: 'Resposta inválida da API Anthropic' };
    }

    const errorData = await response.json().catch(() => ({}));
    if (response.status === 401) return { valid: false, error: 'Token inválido ou expirado' };
    if (response.status === 403) return { valid: false, error: 'Token não tem permissão para acessar a API' };
    return {
      valid: false,
      error: errorData.error?.message || `Erro ${response.status}: ${response.statusText}`,
    };
  } catch (validationError) {
    if (validationError.name === 'AbortError' || validationError.name === 'TimeoutError') {
      return {
        valid: false,
        error: 'Timeout ao validar token. Verifique sua conexão com a internet.',
      };
    }
    if (validationError.name === 'TypeError' && validationError.message.includes('fetch')) {
      return {
        valid: false,
        error: 'Erro de conexão. Verifique sua conexão com a internet.',
      };
    }
    return {
      valid: false,
      error: validationError.message || 'Erro ao validar token',
    };
  }
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
const _cleanupSessionsTimer = setInterval(cleanupOldSessions, SESSION_CLEANUP_INTERVAL);
// Não manter o processo vivo apenas por timers (ajuda testes/Jest e shutdown limpo)
if (typeof _cleanupSessionsTimer.unref === 'function') _cleanupSessionsTimer.unref();

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
    
    // Função para hash de senha (compatível com api/services/authService.js)
    // Formato: sha256:<salt>:<hash>
    function hashPassword(password) {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto
        .createHash('sha256')
        .update(String(password) + salt)
        .digest('hex');
      return `sha256:${salt}:${hash}`;
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

        // Auto-correção (compatibilidade):
        // Versões anteriores criavam `password_hash` como sha256(password+salt) mas salvavam apenas o hash (perdendo o salt),
        // o que torna o login impossível. Se detectarmos esse formato legado (64 hex), reescrevemos para o formato suportado:
        // sha256:<salt>:<hash>
        try {
          const stored = existingUser.password_hash;
          const looksLikeLegacySaltedButBroken = typeof stored === 'string' && /^[a-f0-9]{64}$/i.test(stored);
          if (looksLikeLegacySaltedButBroken) {
            await existingUser.update({
              password_hash: hashPassword('Admin123!'),
              username: existingUser.username || 'systemadmin',
              role: existingUser.role || 'super_admin',
              is_active: existingUser.is_active !== false,
              status: existingUser.status || 'active',
              is_superadmin: true,
              tenant_key: existingUser.tenant_key || 'system',
            });
            logger.warn('[Init] 🔧 Corrigido password_hash legado do systemadmin para formato compatível (sha256:salt:hash)');
          }
        } catch (e) {
          logger.warn('[Init] Falha ao tentar corrigir password_hash legado do systemadmin (ignorado)', { error: e.message });
        }

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
        const passwordHash = hashPassword('Admin123!');
        
        if (!userId) {
          // Cria novo usuário
          const newUser = await UserModel.create({
            name: 'Administrador do Sistema',
            email: 'systemadmin@exemplo.com',
            password_hash: passwordHash,
            username: 'systemadmin',
            role: 'super_admin',
            is_active: true,
            status: 'active',
            is_superadmin: true,
            tenant_key: 'system',
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
        if (!flow.tenantId || typeof flow.tenantId !== 'string' || flow.tenantId.trim() === '') {
          // Hardening: nunca persiste registros sem tenant (evita dados órfãos/cross-tenant)
          logger.warn('[Flows] Ignorando persistência: flow sem tenantId', { flowId: flow.id });
          return null;
        }
        const payload = {
          id: flow.id,
          tenant_key: flow.tenantId,
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

async function deleteFlowBestEffort(flowId) {
  try {
    const { getSequelize } = require('./db/sequelize');
    const sequelize = getSequelize();
    if (!sequelize) return;
    const { Flow } = require('./db/models');
    const FlowModel = Flow();

    await FlowModel.destroy({ where: { id: flowId } });
  } catch (err) {
    logger.warn('[Flows] Falha ao remover flow no PostgreSQL', { flowId, error: err.message });
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
// Hardening multi-tenant (STRICT_TENANT_MODE)
// ---------------------------------------------------------------------------

function parseBooleanEnv(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return defaultValue;
}

// Default: true em produção; false fora de produção (somente dev/test).
const STRICT_TENANT_MODE = parseBooleanEnv(
  process.env.STRICT_TENANT_MODE,
  process.env.NODE_ENV === 'production'
);

/**
 * Exige tenantId resolvido a partir do agente autenticado (req.agent/req.tenantId).
 * - Para super-admin, req.tenantId pode vir de X-Tenant-Id (middleware/auth).
 * - Sem tenantId: 403 tenant_required.
 */
function requireTenant(req, res) {
  const superAdmin = req?.agent ? isSuperAdmin(req.agent) : false;
  // Hardening: super-admin só resolve tenant via header (req.tenantId).
  const tenantIdRaw = superAdmin ? (req?.tenantId || null) : (req?.tenantId || req?.agent?.tenantId || null);
  const tenantId = typeof tenantIdRaw === 'string' ? tenantIdRaw.trim() : null;
  if (!tenantId) {
    sendJson(res, 403, { error: 'tenant_required' });
    return null;
  }
  return tenantId;
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
    // Tenant deve ser fornecido - não há fallback padrão em produção
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

  // Populate req.id from incoming X-Request-Id header for tracing
  if (!req.id && req.headers && req.headers['x-request-id']) {
    req.id = String(req.headers['x-request-id']).trim() || undefined;
  }

  // URL é relativa; usamos base fictícia apenas para parse
  const url = new URL(req.url || '/', 'http://localhost');
  const { pathname } = url;

  // -----------------------------------------------------------------------
  // Public System Routes
  // -----------------------------------------------------------------------
  {
    const { handlePublicSystemRoutes } = require('./serverHandlers/publicSystemRoutes');
    const handledPS = await handlePublicSystemRoutes({
      req, res, method, pathname,
      deps: {
        sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logger, config, checkRateLimit, setCorsHeaders,
        requireAuth,
      },
    });
    if (handledPS) return;
  }

  // -----------------------------------------------------------------------
  // Rate Limiting por Tenant
  // -----------------------------------------------------------------------
  // Aplica rate limiting por tenant em todas as rotas (exceto rotas públicas acima)
  // Rotas públicas: /health, /version, /system/status, /system/websocket, OPTIONS
  // Rotas de autenticação não exigem tenant_id (login, reset, convites)
  // Rotas de super-admin não exigem tenant_id (mas exigem autenticação super-admin)
  const publicRoutes = [
    '/health',
    '/health/db',
    '/version',
    '/system/status',
    '/system/websocket',
    '/storefront/orders',
    '/physical/kiosk/tickets',
    '/physical/panel/state',
    '/public-tokens/resolve',
      '/physical/station',
  ];
  const authRoutes = ['/auth/login', '/auth/rpa/login', '/auth/accept-invitation', '/auth/request-password-reset', '/auth/reset-password'];
  // Webhooks de provedores (inbound) não podem ser bloqueados por falta de tenant no início:
  // tenant é resolvido por channel_accounts e, se não resolver, deve retornar 200 OK com log warn.
  const providerWebhookRoutes = ['/webhooks/whatsapp', '/webhooks/messenger', '/webhooks/instagram'];
  const superAdminRoutes = pathname.startsWith('/super-admin');
  
  const isPublicRoute = publicRoutes.some(route => pathname === route || pathname.startsWith(route + '/'));
  const isAuthRoute = authRoutes.some(route => pathname === route || pathname.startsWith(route + '/'));
  const isProviderWebhookRoute = providerWebhookRoutes.some(route => pathname === route || pathname.startsWith(route + '/'));
  const isSuperAdminRoute = superAdminRoutes;
  
  // Aplica rate limiting apenas em rotas que não são públicas, de auth ou super-admin
  // Em desenvolvimento, rate limit é desativado
  const nodeEnv = config.get('nodeEnv', process.env.NODE_ENV || 'development');
  const isDevelopment = nodeEnv === 'development';
  
  if (!isPublicRoute && !isAuthRoute && !isProviderWebhookRoute && !isSuperAdminRoute && method !== 'OPTIONS' && !isDevelopment) {
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
  } else if (isDevelopment && !isPublicRoute && !isAuthRoute && !isProviderWebhookRoute && !isSuperAdminRoute && method !== 'OPTIONS') {
    // Em desenvolvimento, loga mas não bloqueia
    logger.debug('[Server] Rate limit desativado em desenvolvimento', { pathname, method });
  }

  // -----------------------------------------------------------------------
  // System Admin Routes (rate-limit, channel-health)
  // -----------------------------------------------------------------------
  {
    const { handleSystemAdminRoutes } = require('./serverHandlers/systemAdminRoutes');
    const handledSA = await handleSystemAdminRoutes({
      req, res, method, pathname,
      deps: {
        clearLimitersCache, clearRedisRateLimitKeys, config,
        requireAuth, requirePermission, sendJson, logger,
      },
    });
    if (handledSA) return;
  }

  // -----------------------------------------------------------------------
  // Auth Routes
  // -----------------------------------------------------------------------
  {
    const { handleAuthRoutes } = require('./serverHandlers/authRoutes');
    const handledAuth = await handleAuthRoutes({
      req, res, method, pathname,
      deps: {
        sendJson, badRequest, hasJsonContentType, parseJsonBody,
        validateInput, schemas, ValidationError,
        authLogin, loginWithRpaToken, validateToken, authLogout,
        logoutAllSessions, logAction, logger,
      },
    });
    if (handledAuth) return;
  }

  // ============================================
  // TENANTS ROUTES
  // ============================================
  {
    const { handleTenantRoutes } = require('./serverHandlers/tenantRoutes');
    const handledTenants = await handleTenantRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, isSuperAdmin,
        sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logger, logAction,
        createTenant, getTenant, updateTenant, deleteTenant, listTenants,
        getTenantContext, updateTenantContext, getTenantUsage,
        suspendTenant, reactivateTenant, changePlan,
        generateAiResponse, registerGeneration,
      },
    });
    if (handledTenants) return;
  }


  // ============================================================================
  // SYSTEM GENERATION ROUTES
  // ============================================================================
  {
    const { handleSystemGenerationRoutes } = require('./serverHandlers/systemGenerationRoutes');
    const handledSystemGeneration = await handleSystemGenerationRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, isSuperAdmin, requireTenant,
        sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logger,
        generateAiResponse, getAIConfig, getDecryptedAPIKey,
        ragService, STRICT_TENANT_MODE, generateAndValidate,
      },
    });
    if (handledSystemGeneration) return;
  }

  // ============================================================================
  // SUPER ADMIN ROUTES
  // ============================================================================
  {
    const { handleSuperAdminRoutes } = require('./serverHandlers/superAdminRoutes');
    const handledSuperAdmin = await handleSuperAdminRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, isSuperAdmin,
        sendJson, badRequest, parseJsonBody,
        logger, logAction,
        listAllTenants, getTenantMetrics,
        impersonateUser, blockTenant, unblockTenant, adjustTenantPlan,
      },
    });
    if (handledSuperAdmin) return;
  }

  // ===========================================================================
  // Onboarding Routes
  // ===========================================================================
  {
    const { handleOnboardingRoutes } = require('./serverHandlers/onboardingRoutes');
    const handledOB = await handleOnboardingRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logger, logAction,
        getOnboardingStatus, startOnboarding, completeOnboardingStep,
        completeOnboarding, createInitialTemplates,
      },
    });
    if (handledOB) return;
  }

  // -----------------------------------------------------------------------
  // Agent Routes
  // -----------------------------------------------------------------------
  {
    const { handleAgentRoutes } = require('./serverHandlers/agentRoutes');
    const handledAG = await handleAgentRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson, badRequest,
        hasJsonContentType, parseJsonBody, listAgents, createAgent,
        getAgent, updateAgent, deleteAgent, inviteUser,
        acceptInvitation, requestPasswordReset, resetPassword, setupMfa,
        verifyMfa, disableMfa, consumeRecoveryCode, isSuperAdmin,
        logAction, logger,
      },
    });
    if (handledAG) return;
  }


  // -----------------------------------------------------------------------
  // Audit Routes
  // -----------------------------------------------------------------------
  {
    const { handleAuditRoutes } = require('./serverHandlers/auditRoutes');
    const handledAUD = await handleAuditRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson, queryLogs,
        getAuditStats,
      },
    });
    if (handledAUD) return;
  }

  // -----------------------------------------------------------------------
  // Flow CRUD Routes
  // -----------------------------------------------------------------------
  {
    const { handleFlowCrudRoutes } = require('./serverHandlers/flowCrudRoutes');
    const handledFC = await handleFlowCrudRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, requireTenant,
        sendJson, badRequest, hasJsonContentType, parseJsonBody, logger,
        validateFlow, validateVoiceFlow, validateFlowStructure, ensureFlowHasMeta,
        flows, persistFlowBestEffort, deleteFlowBestEffort,
        triggerWebhooks, emitEvent, isSuperAdmin, STRICT_TENANT_MODE,
      },
    });
    if (handledFC) return;
  }

  // -----------------------------------------------------------------------
  // Flow Execution Routes
  // -----------------------------------------------------------------------
  {
    const { handleFlowExecutionRoutes } = require('./serverHandlers/flowExecutionRoutes');
    const handledFER = await handleFlowExecutionRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requireTenant,
        sendJson, badRequest, hasJsonContentType, parseJsonBody, logger,
        validateFlow, validateFlowStructure, addUiMessage,
        flows, orchestrateGeneration, registerGeneration, generateAuditReport,
        STRICT_TENANT_MODE,
        rpaDependencyResolver, previewRpaFlowPipeline, executeRpaFlowPipeline,
        simulateFlow, sessionEvents, saveSessionEventsToFile, buildConversationReplay,
      },
    });
    if (handledFER) return;
  }

  // -----------------------------------------------------------------------
  // Conversation Routes
  // -----------------------------------------------------------------------
  {
    const { handleConversationRoutes } = require('./serverHandlers/conversationRoutes');
    const handledCONV = await handleConversationRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson, logger,
        sessionEvents, listChannelConversations, listConversationMessages, buildConversationReplay,
      },
    });
    if (handledCONV) return;
  }

  // -----------------------------------------------------------------------
  // Channel Accounts Routes
  // -----------------------------------------------------------------------
  {
    const { handleChannelAccountRoutes } = require('./serverHandlers/channelAccountRoutes');
    const handledCA = await handleChannelAccountRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson, badRequest,
        hasJsonContentType, parseJsonBody, logger,
      },
    });
    if (handledCA) return;
  }

  // -----------------------------------------------------------------------
  // Queue Routes
  // -----------------------------------------------------------------------
  {
    const { handleQueueRoutes } = require('./serverHandlers/queueRoutes');
    const handledQ = await handleQueueRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson, badRequest,
        hasJsonContentType, parseJsonBody, logger, logAction,
        listQueues, createQueue, getQueueInfo, deleteQueue, listQueue,
        canAccessTicket, queueDefinitionService,
      },
    });
    if (handledQ) return;
  }

  // -----------------------------------------------------------------------
  // Ticket Routes (Sistema de Filas e Tickets)
  // -----------------------------------------------------------------------
  {
    const { handleTicketRoutes } = require('./serverHandlers/ticketRoutes');
    const handledTR = await handleTicketRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson, badRequest,
        hasJsonContentType, parseJsonBody, logger, logAction,
        createTicket, getTicket, getTicketBySession, closeTicket, listAllTickets,
        listQueues, getMetrics, addAgentMessage, updateOutboundMessageMeta,
        markMessagesAsRead, getTicketMessages, canAccessTicket, canModifyTicket,
        assignTicket, triggerWebhooks, emitEvent,
        outboundQueueService, listConversationMessages,
        takeOverTicket, returnTicketToBot, pauseTicket, resumeHumanTicket,
        autoAssignTicket, closeReasonsService, ticketInsightService,
      },
    });
    if (handledTR) return;
  }

  // -----------------------------------------------------------------------
  // AI Generation Routes
  // -----------------------------------------------------------------------
  {
    const { handleAiRoutes } = require('./serverHandlers/aiRoutes');
    const handledAI = await handleAiRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requireTenant, sendJson, badRequest,
        hasJsonContentType, parseJsonBody, logger,
      },
    });
    if (handledAI) return;
  }

  // -----------------------------------------------------------------------
  // Templates Routes
  // -----------------------------------------------------------------------
  {
    const { handleTemplatesRoutes } = require('./serverHandlers/templatesRoutes');
    const handledTPL = await handleTemplatesRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson, badRequest,
        hasJsonContentType, parseJsonBody, logger, crypto,
        flowTemplateMarketplaceService, validateFlowStructure, validateFlow, validateVoiceFlow,
        ensureFlowHasMeta, persistFlowBestEffort, flows, triggerWebhooks,
        emitEvent,
      },
    });
    if (handledTPL) return;
  }


  // -----------------------------------------------------------------------
  // Config Routes
  // -----------------------------------------------------------------------
  {
    const { handleConfigRoutes } = require('./serverHandlers/configRoutes');
    const handledCFG = await handleConfigRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson, badRequest,
        hasJsonContentType, parseJsonBody, logger, getAIConfig,
        saveAIConfig, saveAICredentials, getDecryptedAPIKey, initializeAiProviders,
        isSuperAdmin, setCorsHeaders, emitEvent, detectProcessManager,
      },
    });
    if (handledCFG) return;
  }


  // -----------------------------------------------------------------------
  // Department Routes
  // -----------------------------------------------------------------------
  {
    const { handleDepartmentRoutes } = require('./serverHandlers/departmentRoutes');
    const handledDEP = await handleDepartmentRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requireTenant, requirePermission, sendJson,
        badRequest, hasJsonContentType, parseJsonBody, logger,
        logAction, listDepartments, getDepartment, createDepartment,
        updateDepartment, deleteDepartment, addAgentToDepartment, removeAgentFromDepartment,
      },
    });
    if (handledDEP) return;
  }


  // -----------------------------------------------------------------------
  // Export Routes
  // -----------------------------------------------------------------------
  {
    const { handleExportRoutes } = require('./serverHandlers/exportRoutes');
    const handledEXP = await handleExportRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, requireTenant, sendJson,
        logger, exportTicketsCSV, exportMetricsCSV, exportConversationsJSON,
        exportFullReportJSON,
      },
    });
    if (handledEXP) return;
  }


  // -----------------------------------------------------------------------
  // AI Suggestion Routes
  // -----------------------------------------------------------------------
  {
    const { handleAiSuggestionRoutes } = require('./serverHandlers/aiSuggestionRoutes');
    const handledAIS = await handleAiSuggestionRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, sendJson, badRequest, hasJsonContentType,
        parseJsonBody, logger, isSuperAdmin, suggestResponse,
        rewriteMessage, rewriteMultipleMessages,
      },
    });
    if (handledAIS) return;
  }


  // -----------------------------------------------------------------------
  // Audio Transcription Routes
  // -----------------------------------------------------------------------
  {
    const { handleAudioTranscriptionRoutes } = require('./serverHandlers/audioTranscriptionRoutes');
    const handledAT = await handleAudioTranscriptionRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, sendJson, badRequest, hasJsonContentType,
        parseJsonBody, logger, transcribeAudio,
      },
    });
    if (handledAT) return;
  }


  // -----------------------------------------------------------------------
  // Segmentation Routes
  // -----------------------------------------------------------------------
  {
    const { handleSegmentationRoutes } = require('./serverHandlers/segmentationRoutes');
    const handledSeg = await handleSegmentationRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson, badRequest,
        hasJsonContentType, parseJsonBody, logger, getAllTags,
        getAllCategories, filterTickets, getSegmentationStats, getTicket,
        addTagToTicket, removeTagFromTicket, setTicketCategory,
      },
    });
    if (handledSeg) return;
  }


  // -----------------------------------------------------------------------
  // WhatsApp Template Routes
  // -----------------------------------------------------------------------
  {
    const { handleWhatsappTemplateRoutes } = require('./serverHandlers/whatsappTemplateRoutes');
    const handledWAT = await handleWhatsappTemplateRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson, badRequest,
        hasJsonContentType, parseJsonBody, logAction, logger,
        listTemplates, getTemplate, createTemplate, sendTemplateMessage,
      },
    });
    if (handledWAT) return;
  }


  // =======================================================================
  // RAG Routes
  // =======================================================================
  {
    const { handleRagRoutes } = require('./serverHandlers/ragRoutes');
    const handledRag = await handleRagRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, requireTenant, isSuperAdmin,
        sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logAction, logger,
        listDocuments, getDocument, createDocument, updateDocument,
        deleteDocument, reindexDocument, reindexAllNotIndexed, getDocumentsStats,
        ragService,
      },
    });
    if (handledRag) return;
  }

  // =======================================================================
  // Config Admin Routes
  // =======================================================================
  {
    const { handleConfigAdminRoutes } = require('./serverHandlers/configAdminRoutes');
    const handledConfigAdmin = await handleConfigAdminRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, requireTenant,
        sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logger, logAction, flows,
      },
    });
    if (handledConfigAdmin) return;
  }

  // =======================================================================
  // Storefront Public Routes
  // =======================================================================
  {
    const { handleStorefrontRoutes } = require('./serverHandlers/storefrontRoutes');
    const { checkRateLimit } = require('../infra/rate-limit');
    const handledStorefront = await handleStorefrontRoutes({
      req, res, method, pathname,
      deps: {
        sendJson, badRequest, hasJsonContentType, parseJsonBody, logger, checkRateLimit,
      },
    });
    if (handledStorefront) return;
  }

  // =======================================================================
  // Physical Public Routes
  // =======================================================================
  {
    const { handlePhysicalPublicRoutes } = require('./serverHandlers/physicalPublicRoutes');
    const { checkRateLimit } = require('../infra/rate-limit');
    const handledPhysicalPublic = await handlePhysicalPublicRoutes({
      req, res, method, pathname,
      deps: {
        sendJson, badRequest, hasJsonContentType, parseJsonBody, logger, checkRateLimit, logAction,
      },
    });
    if (handledPhysicalPublic) return;
  }

  // =======================================================================
  // Public Token Routes
    // =======================================================================
    // Physical Station Routes
    // =======================================================================
    {
      const { handlePhysicalStationRoutes } = require('./serverHandlers/physicalStationRoutes');
      const { checkRateLimit } = require('../infra/rate-limit');
      const { createTicket: _createTicket } = require('./services/queueService');
      const handledPhysicalStation = await handlePhysicalStationRoutes({
        req, res, method, pathname,
        deps: {
          sendJson, badRequest, hasJsonContentType, parseJsonBody, logger,
          checkRateLimit, logAction, createTicket: _createTicket,
        },
      });
      if (handledPhysicalStation) return;
    }

    // =======================================================================
    // Public Token Routes
  // =======================================================================
  {
    const { handlePublicTokenRoutes } = require('./serverHandlers/publicTokenRoutes');
    const { checkRateLimit } = require('../infra/rate-limit');
    const handledPublicToken = await handlePublicTokenRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logger, logAction, checkRateLimit,
      },
    });
    if (handledPublicToken) return;
  }

  // =======================================================================
  // Web Scraping Routes
  // =======================================================================
  {
    const { handleWebScrapingRoutes } = require('./serverHandlers/webScrapingRoutes');
    const { requireExecutionId } = require('./middleware/requireExecutionId');
    const { createPipelineWs } = require('./ws/pipelineEmitter');
    const { emitPipelineStage } = require('./ws/emitPipelineStage');
    const { failGeneration } = require('./services/failGeneration');
    const { GenerationFailureReasons } = require('./constants/GenerationFailureReasons');
    const { ensureExecutionContext, requireStages, updateStage, updateStatus } = require('./services/pipelineExecutionContext');
    const handledWebScraping = await handleWebScrapingRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson, badRequest, hasJsonContentType, parseJsonBody,
        isSuperAdmin, logAction, logger, setCorsHeaders, sendApiError, buildApiError,
        scrapeUrl, scrapeUrls, requireExecutionId, createPipelineWs, emitPipelineStage,
        ensureExecutionContext, requireStages, updateStage, updateStatus, failGeneration,
        GenerationFailureReasons,
      },
    });
    if (handledWebScraping) return;
  }

  // =======================================================================
  // Webhooks Customizados Routes
  // =======================================================================
  {
    const { handleWebhooksRoutes } = require('./serverHandlers/webhooksRoutes');
    const handledWebhooks = await handleWebhooksRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logAction, logger,
        getAvailableEvents, listWebhooks, getWebhook, createWebhook, updateWebhook, deleteWebhook,
      },
    });
    if (handledWebhooks) return;
  }

  // =======================================================================
  // RPA - Testes Automatizados Routes
  // =======================================================================
  {
    const { handleRpaTestsRoutes } = require('./serverHandlers/rpaTestsRoutes');
    const {
      listRecordings, executeRecording, getExecutionStatus, cancelExecution, continueExecution,
      nextStep, deleteRecording, startManualRecording, stopManualRecording, getRecordingStatus,
    } = require('./services/rpaService');
    const handledRpaTests = await handleRpaTestsRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, sendJson, badRequest, hasJsonContentType, parseJsonBody, logger,
        listRecordings, executeRecording, getExecutionStatus, cancelExecution, continueExecution,
        nextStep, deleteRecording, startManualRecording, stopManualRecording, getRecordingStatus,
        path, fs,
      },
    });
    if (handledRpaTests) return;
  }

  // =======================================================================
  // QA - Qualidade e Validação Routes
  // =======================================================================
  {
    const { handleQaRoutes } = require('./serverHandlers/qaRoutes');
    const handledQa = await handleQaRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logAction, logger,
        getLatestQaResult, getQaHistory, getQaStatistics, getQaResultById, runQaManual,
      },
    });
    if (handledQa) return;
  }

  // =======================================================================
  // Dev - Gerenciamento de Contratos, Prompts e RAG Routes
  // =======================================================================
  {
    const { handleDevManagementRoutes } = require('./serverHandlers/devManagementRoutes');
    const handledDev = await handleDevManagementRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, sendJson, badRequest, hasJsonContentType, parseJsonBody, isSuperAdmin,
        logAction, logger, path, fs,
      },
    });
    if (handledDev) return;
  }

  // =======================================================================
  // Intelligence - Tenant Intelligence Core Routes
  // =======================================================================
  {
    const { handleIntelligenceRoutes } = require('./serverHandlers/intelligenceRoutes');
    const handledIntelligence = await handleIntelligenceRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, requireTenant,
        sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logger,
      },
    });
    if (handledIntelligence) return;
  }

  // =======================================================================
  // Intelligence - Market Intelligence Layer Routes
  // =======================================================================
  {
    const { handleMarketIntelligenceRoutes } = require('./serverHandlers/marketIntelligenceRoutes');
    const handledMarketIntelligence = await handleMarketIntelligenceRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, requireTenant,
        sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logger,
      },
    });
    if (handledMarketIntelligence) return;
  }

  // =======================================================================
  // Access Control - Core Routes
  // =======================================================================
  {
    const { handleAccessControlRoutes } = require('./serverHandlers/accessControlRoutes');
    const handledAccessControl = await handleAccessControlRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, requireTenant,
        sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logger, logAction,
      },
    });
    if (handledAccessControl) return;
  }

  // =======================================================================
  // Vertical - Beauty Routes
  // =======================================================================
  {
    const { handleBeautyRoutes } = require('./serverHandlers/verticalBeautyRoutes');
    const handledBeauty = await handleBeautyRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, requireTenant,
        sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logger, logAction,
      },
    });
    if (handledBeauty) return;
  }

  // =======================================================================
  // Vertical - Fitness Routes
  // =======================================================================
  {
    const { handleFitnessRoutes } = require('./serverHandlers/verticalFitnessRoutes');
    const handledFitness = await handleFitnessRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, requireTenant,
        sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logger, logAction,
      },
    });
    if (handledFitness) return;
  }

  // =======================================================================
  // Operations Dashboard - Pilot Monitoring (Beauty + Fitness)
  // =======================================================================
  {
    const { handleOperationsDashboardRoutes } = require('./serverHandlers/operationsDashboardRoutes');
    const handledOperationsDashboard = await handleOperationsDashboardRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, requireTenant,
        sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logger,
      },
    });
    if (handledOperationsDashboard) return;
  }

  // =======================================================================
  // PBX v1 / Legacy Routes
  // =======================================================================
  {
    const { handlePbxRoutes } = require('./serverHandlers/pbxRoutes');
    const handledPbx = await handlePbxRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, requireTenant,
        sendJson, badRequest, hasJsonContentType, parseJsonBody, parseMultipartFormData,
        logger, buildApiError, logAction,
      },
    });
    if (handledPbx) return;
  }

  // =======================================================================
  // Scheduling Support - Calendar / Lookups / CRM Contacts Routes
  // =======================================================================
  {
    const { handleSchedulingSupportRoutes } = require('./serverHandlers/schedulingSupportRoutes');
    const handledSchedulingSupport = await handleSchedulingSupportRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requireTenant,
        sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logger,
      },
    });
    if (handledSchedulingSupport) return;
  }

  // =======================================================================
  // Voice Routes (events, runtime, event-ledger)
  // =======================================================================
  {
    const { handleVoiceRoutes } = require('./serverHandlers/voiceRoutes');
    const handledVoice = await handleVoiceRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission,
        sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logger,
      },
    });
    if (handledVoice) return;
  }

  // =======================================================================
  // Physical Queue Routes
  // =======================================================================
  {
    const { handleQueueTicketRoutes } = require('./serverHandlers/queueTicketRoutes');
    const handledQueueTicket = await handleQueueTicketRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission,
        sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logger,
      },
    });
    if (handledQueueTicket) return;
  }

  // =======================================================================
  // Ops Routes (event-ledger metrics, flow-execution metrics)
  // =======================================================================
  {
    const { handleOpsRoutes } = require('./serverHandlers/opsRoutes');
    const handledOps = await handleOpsRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission,
        sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logger, logAction,
      },
    });
    if (handledOps) return;
  }

  // =======================================================================
  // Execution Ledger Routes
  // =======================================================================
  {
    const { handleExecutionLedgerRoutes } = require('./serverHandlers/executionLedgerRoutes');
    const handledExecutionLedger = await handleExecutionLedgerRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission,
        sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logger, logAction,
      },
    });
    if (handledExecutionLedger) return;
  }

  // -----------------------------------------------------------------------
  // GET /api/schedules - Lista agendamentos
    // =======================================================================
    // WhatsApp Connection Routes (QR, status, events, disconnect)
    // =======================================================================
    {
      const { handleWhatsAppConnectionRoutes } = require('./serverHandlers/whatsAppConnectionRoutes');
      const handledWhatsAppConnection = await handleWhatsAppConnectionRoutes({
        req, res, method, pathname,
        deps: {
          requireAuth, requirePermission, requireTenant,
          sendJson, badRequest, hasJsonContentType, parseJsonBody,
          logger,
        },
      });
      if (handledWhatsAppConnection) return;
    }

    // -----------------------------------------------------------------------
    // =======================================================================
    // Inbox / Conversations Routes (UX-01)
    // =======================================================================
    {
      const { handleInboxRoutes } = require('./serverHandlers/inboxRoutes');
      const handledInbox = await handleInboxRoutes({
        req, res, method, pathname,
        deps: {
          requireAuth, requirePermission,
          sendJson, badRequest, hasJsonContentType, parseJsonBody,
          listAllTickets, getTicket,
          canAccessTicket, canModifyTicket,
          assignTicket, transferTicket, addTicketNote,
          triggerWebhooks, emitEvent,
          logAction, logger,
        },
      });
      if (handledInbox) return;
    }

  // =======================================================================
  // Support + Debug Routes
  // =======================================================================
  {
    const { handleSupportDebugRoutes } = require('./serverHandlers/supportDebugRoutes');
    const handledSupportDebug = await handleSupportDebugRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, sendJson, parseJsonBody,
        scheduleService, extractSemanticContext,
        logger, nlpExtractKeywords, nlpAnalyzeText,
      },
    });
    if (handledSupportDebug) return;
  }

  // =======================================================================
  // Automation Routes
  // =======================================================================
  {
    const { handleAutomationRoutes } = require('./serverHandlers/automationRoutes');
    const handledAutomation = await handleAutomationRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson,
      },
    });
    if (handledAutomation) return;
  }

  // =======================================================================
  // Developer Key Routes
  // =======================================================================
  {
    const { handleDeveloperKeyRoutes } = require('./serverHandlers/developerKeyRoutes');
    const handledDeveloperKey = await handleDeveloperKeyRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson,
      },
    });
    if (handledDeveloperKey) return;
  }

  // =======================================================================
  // Marketing Routes
  // =======================================================================
  {
    const { handleMarketingRoutes } = require('./serverHandlers/marketingRoutes');
    const handledMarketing = await handleMarketingRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson, badRequest,
        hasJsonContentType, parseJsonBody, logger,
      },
    });
    if (handledMarketing) return;
  }

  // =======================================================================
  // Order Routes
  // =======================================================================
  {
    const { handleOrderRoutes } = require('./serverHandlers/orderRoutes');
    const handledOrder = await handleOrderRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson,
      },
    });
    if (handledOrder) return;
  }

  // =======================================================================
  // Process Runtime Routes
  // =======================================================================
  {
    const { handleProcessRuntimeRoutes } = require('./serverHandlers/processRuntimeRoutes');
    const handledProcessRuntime = await handleProcessRuntimeRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, requireTenant, sendJson,
        badRequest, hasJsonContentType, parseJsonBody, logger,
      },
    });
    if (handledProcessRuntime) return;
  }

  // =======================================================================
  // Public API Routes
  // =======================================================================
  {
    const { handlePublicApiRoutes } = require('./serverHandlers/publicApiRoutes');
    const handledPublicApi = await handlePublicApiRoutes({
      req, res, method, pathname,
      deps: {
        sendJson, badRequest, hasJsonContentType, parseJsonBody,
        logger, checkRateLimit,
      },
    });
    if (handledPublicApi) return;
  }

  // =======================================================================
  // RAG Documents Routes
  // =======================================================================
  {
    const { handleRagDocumentsRoutes } = require('./serverHandlers/ragDocumentsRoutes');
    const handledRagDocuments = await handleRagDocumentsRoutes({
      req, res, method, pathname,
      deps: {},
    });
    if (handledRagDocuments) return;
  }

  // =======================================================================
  // RBAC Routes
  // =======================================================================
  {
    const { handleRbacRoutes } = require('./serverHandlers/rbacRoutes');
    const handledRbac = await handleRbacRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, requireTenant, sendJson,
        badRequest, hasJsonContentType, parseJsonBody, logger,
        getRoleDefinitions, createRole, listPermissions, getAgent,
        updateAgent,
      },
    });
    if (handledRbac) return;
  }

  // =======================================================================
  // SLA Routes
  // =======================================================================
  {
    const { handleSlaRoutes } = require('./serverHandlers/slaRoutes');
    const handledSla = await handleSlaRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson,
      },
    });
    if (handledSla) return;
  }

  // =======================================================================
  // Solution Routes
  // =======================================================================
  {
    const { handleSolutionRoutes } = require('./serverHandlers/solutionRoutes');
    const handledSolution = await handleSolutionRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson, badRequest,
        hasJsonContentType, parseJsonBody, logger,
      },
    });
    if (handledSolution) return;
  }

  // =======================================================================
  // Supervisor Routes
  // =======================================================================
  {
    const { handleSupervisorRoutes } = require('./serverHandlers/supervisorRoutes');
    const handledSupervisor = await handleSupervisorRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, requireTenant, sendJson,
        logger, getSupervisorMetrics, getGeneralMetrics, getSupervisorAgentStatus,
        getSupervisorQueueStatus,
      },
    });
    if (handledSupervisor) return;
  }

  // =======================================================================
  // Task Routes
  // =======================================================================
  {
    const { handleTaskRoutes } = require('./serverHandlers/taskRoutes');
    const handledTask = await handleTaskRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson,
      },
    });
    if (handledTask) return;
  }

  // =======================================================================
  // Webhook Routes
  // =======================================================================
  {
    const { handleWebhookRoutes } = require('./serverHandlers/webhookRoutes');
    const handledWebhook = await handleWebhookRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, sendJson, badRequest, hasJsonContentType,
        parseJsonBody, logger, verifyWebhook, processWhatsAppMessage,
        verifyMessengerWebhook, sendMessengerMessage, sendMessengerButtons, verifyInstagramWebhook,
        sendInstagramMessage, sendInstagramMedia, channelNormalizationService, channelGatewayService,
        resolveOrCreateTicketFromIncomingMessage, appendTicketMessage, autoAssignTicket, emitEvent,
        flows, sessionEvents, saveSessionEventsToFile,
      },
    });
    if (handledWebhook) return;
  }

  // =======================================================================
  // WhatsApp IVR Routes
  // =======================================================================
  {
    const { handleWhatsAppIvrRoutes } = require('./serverHandlers/whatsAppIvrRoutes');
    const handledWhatsAppIvr = await handleWhatsAppIvrRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson,
      },
    });
    if (handledWhatsAppIvr) return;
  }

  // =======================================================================
  // WhatsApp QR Webhook Routes
  // =======================================================================
  {
    const { handleWhatsAppQrWebhookRoutes } = require('./serverHandlers/whatsAppQrWebhookRoutes');
    const handledWhatsAppQrWebhook = await handleWhatsAppQrWebhookRoutes({
      req, res, method, pathname,
      deps: {
        requireAuth, requirePermission, sendJson,
      },
    });
    if (handledWhatsAppQrWebhook) return;
  }

  // -----------------------------------------------------------------------
  // Frontend Fallback Routes
  // -----------------------------------------------------------------------
  {
    const { handleFrontendFallbackRoutes } = require('./serverHandlers/frontendFallbackRoutes');
    const handledFrontendFallback = await handleFrontendFallbackRoutes({
      req, res, method, pathname,
      deps: {
        fs, path, logger,
      },
    });
    if (handledFrontendFallback) return;
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

      // Em DEV, garantimos um super-admin padrão para facilitar bootstrap.
      // Em produção, NÃO criamos usuário automaticamente (hardening).
      try {
        const isProd = process.env.NODE_ENV === 'production';
        const disabled = process.env.DISABLE_SYSTEMADMIN_BOOTSTRAP === 'true';
        if (!isProd && !disabled) {
          await initializeSystemAdmin();
        }
      } catch (sysAdminErr) {
        console.warn('[Init] ⚠️  Aviso ao inicializar systemadmin (ignorado):', sysAdminErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar systemadmin (ignorado):', sysAdminErr.message);
      }
      
      // Blindagem produção: não cria/seed de tenant automaticamente (multi-tenant obrigatório).

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
  try { outboundWorker.stop(); } catch (_) {}
  saveSessionEventsToFileImmediate();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('[Conversations] Encerrando servidor, salvando conversas...');
  try { outboundWorker.stop(); } catch (_) {}
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
        outboundWorker.start({ intervalMs: 1500, batchSize: 25 });
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

      // Execution Queue Worker (dispatch_event_trigger jobs) - best-effort
      if (process.env.ENABLE_EXECUTION_QUEUE_WORKER !== 'false') {
        try {
          const { startExecutionQueueWorker } = require('./services/executionQueueService');
          startExecutionQueueWorker({ intervalMs: 800 });
        } catch (err) {
          logger.warn('[ExecutionQueue] Falha ao iniciar worker (ignorado)', { error: err.message });
        }
      }

      // Vertical journey scheduler (beauty + fitness automation) - best-effort
      if (process.env.ENABLE_VERTICAL_SCHEDULER !== 'false') {
        try {
          const { startVerticalScheduler } = require('./services/vertical/verticalSchedulerService');
          const verticalIntervalMs = parseInt(process.env.VERTICAL_SCHEDULER_INTERVAL_MS || '60000', 10);
          startVerticalScheduler({ intervalMs: verticalIntervalMs });
        } catch (err) {
          logger.warn('[VerticalScheduler] Falha ao iniciar (ignorado)', { error: err.message });
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
    requestHandler,
  },
};
