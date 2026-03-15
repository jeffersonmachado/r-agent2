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
      const { description, create = false } = body;

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

      // ----------------------------
      // Safe-mode + contrato + semântica (obrigatório)
      // ----------------------------
      const { buildAiEnvelope, validateAiEnvelopeOrThrow } = require('../engine/ai/aiEnvelope');
      const fs = require('fs');
      const path = require('path');
      const contractsDir = path.join(__dirname, '..', 'contracts');
      const tenantContractPath = path.join(contractsDir, 'tenant.contract.json');
      const tenantContract = JSON.parse(fs.readFileSync(tenantContractPath, 'utf8'));
      const { slugifyTenantKey, createTenantAiDraft } = require('./services/tenantAiDraft');

      async function ensureUniqueTenantKey(baseKey) {
        const { getSequelize } = require('./db/sequelize');
        const sequelize = getSequelize();
        if (!sequelize) return baseKey;
        const { Tenant } = require('./db/models');
        const TenantModel = Tenant();
        let key = baseKey;
        for (let i = 0; i < 10; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          const existing = await TenantModel.findOne({ where: { tenant_key: key } });
          if (!existing) return key;
          key = `${baseKey}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 50);
        }
        return null;
      }

      const baseTenantKey = slugifyTenantKey(tenantData.name);
      const uniqueTenantKey = await ensureUniqueTenantKey(baseTenantKey);
      if (!uniqueTenantKey) {
        sendJson(res, 409, { error: 'tenant_key_conflict', message: 'Não foi possível gerar tenant_key único' });
        return;
      }

      const requestId = (req.headers['x-request-id'] && String(req.headers['x-request-id']).trim())
        ? String(req.headers['x-request-id']).trim()
        : `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const draftRes = createTenantAiDraft(tenantData, {
        tenantContractPath: 'contracts/tenant.contract.json',
        tenant_key: uniqueTenantKey,
      });

      const tenantDraft = draftRes.tenantDraft;

      const aiMeta = {
        provider: { name: null, model: null, temperature: null },
        input: {
          prompt_summary: 'tenants.generate-by-ai',
          user_goal: description,
          context: { tenantId: 'system' },
        },
        audit: {
          request_id: requestId,
          seed: null,
          tenant_id: 'system',
          user_id: req.agent?.id || req.agent?.username || null,
        },
        rawModelOutput: aiText,
      };

      const envelope = validateAiEnvelopeOrThrow(buildAiEnvelope('tenant', tenantDraft, {
        valid: draftRes.valid === true,
        errors: draftRes.errors || [],
        warnings: draftRes.warnings || [],
        qualityScore: draftRes.qualityScore ?? (draftRes.valid ? 100 : 0),
        riskFlags: draftRes.riskFlags || [],
      }, aiMeta));

      if (!draftRes.valid) {
        // Persistência/auditoria best-effort (falha)
        try {
          const { appendGeneration } = require('../qa/aiGenerationStore');
          appendGeneration({
            envelope,
            valid: false,
            domain: 'tenant',
            requestId,
          });
        } catch (e) {
          // best-effort
        }
        try {
          const { logFailure } = require('../engine/ai/aiTelemetry');
          logFailure({
            domain: 'tenant',
            requestId,
            promptUsed: 'tenants.generate-by-ai',
            stage: 'TENANT_DRAFT_INVALID',
            errors: draftRes.errors || [],
          });
        } catch (_) {}

        // Auditoria (DB) best-effort
        try {
          await registerGeneration({
            tenantId: 'system',
            payload: { description, createRequested: !!create },
            context: { sources: [] },
            artifacts: { tenantKey: tenantDraft?.tenant_key || null },
            contract: { version: tenantContract?.version || '1.0.0', hash: null },
            envelope,
            error: { type: 'TENANT_DRAFT_INVALID', errors: draftRes.errors || [] },
          });
        } catch (_) {}

        sendJson(res, 400, { envelope, error: { code: 'tenant_ai_validation_failed', message: 'Tenant gerado não passou por contrato/semântica/safe-mode', details: draftRes.errors } });
        return;
      }

      logger.info('[Tenants] Tenant gerado por IA com sucesso', { 
        name: tenantDraft.name,
        site: tenantDraft.site,
        tenant_key: tenantDraft.tenant_key,
        createRequested: !!create,
      });

      // Persistência/auditoria best-effort do envelope completo
      let aiAuditId = null;
      try {
        const { appendGeneration } = require('../qa/aiGenerationStore');
        aiAuditId = appendGeneration({ envelope, valid: true, domain: 'tenant', requestId });
      } catch (e) {
        // best-effort
      }

      try {
        const { logSuccess } = require('../engine/ai/aiTelemetry');
        logSuccess({
          domain: 'tenant',
          requestId,
          promptUsed: 'tenants.generate-by-ai',
          qualityScore: envelope?.validation?.qualityScore ?? null,
          riskFlags: envelope?.validation?.riskFlags || [],
        });
      } catch (_) {}

      // Auditoria (DB) best-effort
      let auditGenerationId = null;
      try {
        auditGenerationId = await registerGeneration({
          tenantId: 'system',
          payload: { description, createRequested: !!create },
          context: { sources: [] },
          artifacts: { tenantKey: tenantDraft?.tenant_key || null },
          contract: { version: tenantContract?.version || '1.0.0', hash: null },
          envelope,
        });
      } catch (_) {
        // best-effort
      }

      // Se solicitado, cria o tenant em etapas (base -> context). NUNCA ativa automaticamente.
      let createdTenant = null;
      if (create === true) {
        const { createTenant } = require('./services/tenantService');
        const createResult = await createTenant({
          tenant_key: tenantDraft.tenant_key,
          name: tenantDraft.name,
          site: tenantDraft.site,
          ramo_atividade: tenantDraft.ramo_atividade,
          objetivo: tenantDraft.objetivo,
          plan: tenantDraft.plan,
          status: tenantDraft.status,
          limits: tenantDraft.limits,
          settings: tenantDraft.settings,
          branding: tenantDraft.branding,
          _aiSafeMode: true,
        });
        if (!createResult.success) {
          sendJson(res, 500, {
            error: 'tenant_create_failed',
            message: createResult.error || 'Erro ao criar tenant (safe-mode)',
            tenantDraft,
            envelope,
            auditId: aiAuditId,
          });
          return;
        }
        createdTenant = createResult.tenant;
      }

      sendJson(res, 200, {
        generated: true,
        auditId: aiAuditId,
        auditGenerationId,
        envelope,
        tenantDraft,
        tenant: tenantDraft, // compatibilidade
        created: !!createdTenant,
        createdTenant,
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

  // POST /system/pipeline/validate-prereqs - Valida pré-requisitos do pipeline tenant
  if (method === 'POST' && pathname === '/system/pipeline/validate-prereqs') {
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
      const { requireExecutionId } = require('./middleware/requireExecutionId');
      const executionId = requireExecutionId(body, res, badRequest);
      if (!executionId) {
        return;
      }

      const tenantId = (authResult.agent?.tenantId && String(authResult.agent.tenantId).trim())
        ? String(authResult.agent.tenantId).trim()
        : null;
      if (!tenantId) {
        sendJson(res, 400, { error: 'bad_request', message: 'tenantId ausente para validar pré-requisitos do pipeline' });
        return;
      }

      const { ensureExecutionContext, updateStage, updateStatus } = require('./services/pipelineExecutionContext');
      const { checkRagServiceStatus } = require('./services/systemStatusService');

      const pipelineExecution = ensureExecutionContext(
        { executionId, tenantId, useRag: body?.useRag === true },
        { tenantId }
      );
      updateStatus(pipelineExecution, 'running', {
        currentStage: 'providerValidated',
        message: 'Validando pré-requisitos do pipeline',
        source: '/system/pipeline/validate-prereqs',
      });

      const aiConfig = await getAIConfig(tenantId);
      const provider = aiConfig?.primary || aiConfig?.provider || null;
      const hasConfiguredProvider = !!(aiConfig?.configured && provider);
      const apiKey = hasConfiguredProvider ? await getDecryptedAPIKey(tenantId, provider) : null;
      const providerValidated = !!(hasConfiguredProvider && apiKey && String(apiKey).trim());

      if (!providerValidated) {
        sendJson(res, 422, {
          error: 'provider_not_configured',
          code: 'PROVIDER_NOT_CONFIGURED',
          message: 'Provider de IA não configurado para este tenant. Configure um provider e suas credenciais antes de continuar.',
          details: {
            tenantId,
            provider: provider || null,
            configured: !!aiConfig?.configured,
          },
        });
        return;
      }

      updateStage(pipelineExecution, 'providerValidated', true);

      const shouldValidateRag = body?.useRag !== false;
      let ragValidated = true;
      let ragStatus = null;

      if (shouldValidateRag) {
        ragStatus = await checkRagServiceStatus();
        ragValidated = ragStatus?.status === 'healthy';
        if (!ragValidated) {
          sendJson(res, 422, {
            error: 'rag_unavailable',
            code: 'RAG_UNAVAILABLE',
            message: ragStatus?.error || 'Serviço RAG indisponível. Verifique a saúde do serviço antes de continuar.',
            details: {
              tenantId,
              ragStatus,
            },
          });
          return;
        }
      }

      updateStage(pipelineExecution, 'ragValidated', true);
      updateStatus(pipelineExecution, 'running', {
        currentStage: shouldValidateRag ? 'ragValidated' : 'providerValidated',
        message: shouldValidateRag
          ? 'Pré-requisitos do pipeline validados'
          : 'Pré-requisitos do pipeline validados (RAG não solicitado)',
        source: '/system/pipeline/validate-prereqs',
      });

      sendJson(res, 200, {
        ok: true,
        executionId,
        tenantId,
        providerValidated: true,
        ragValidated,
        provider,
      });
    } catch (err) {
      logger.error('[System] Erro ao validar pré-requisitos do pipeline', err);
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        sendJson(res, 500, {
          error: 'internal_error',
          message: err.message || 'Erro ao validar pré-requisitos do pipeline',
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
      const { prompt, name, tenantId, urls, fileNames, mode } = body;
      const normalizedMode = String(mode || 'default').trim().toLowerCase();
      const institutionalMode = normalizedMode === 'institutional';

      if (!institutionalMode && (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0)) {
        badRequest(res, 'Prompt é obrigatório');
        return;
      }

      const effectivePrompt = (prompt && typeof prompt === 'string' && prompt.trim().length > 0)
        ? prompt.trim()
        : `Gere uma descrição institucional em português para ${name || 'a empresa'}, com foco em clareza, objetividade e chamada para ação.`;

      const isSuperAdminUser = isSuperAdmin(req.agent);
      const tenantIdForAI = (req.agent?.tenantId && String(req.agent.tenantId).trim())
        ? String(req.agent.tenantId).trim()
        : (isSuperAdminUser && tenantId ? String(tenantId).trim() : null);
      if (!tenantIdForAI) {
        sendJson(res, 403, { error: 'forbidden', message: 'tenantId é obrigatório' });
        return;
      }
      
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

      // Fallback determinístico: sem contexto indexado, mas com fontes informadas.
      // Evita chamar IA e retorna orientação segura para o usuário.
      if (!ragContext && Array.isArray(urls) && urls.length > 0) {
        const fallbackSuggestion = (
          name && String(name).trim()
            ? `Descrição preliminar de ${String(name).trim()}: empresa com presença digital ativa e fontes informadas para indexação. Recomendamos complementar com conteúdos institucionais e diferenciais de serviço para melhorar a precisão.`
            : 'Descrição preliminar: presença digital ativa com fontes informadas para indexação. Recomendamos complementar com conteúdos institucionais e diferenciais de serviço para melhorar a precisão.'
        );

        sendJson(res, 200, {
          ok: true,
          suggestion: fallbackSuggestion,
          warnings: [{
            code: 'NO_INDEXED_CONTEXT_FALLBACK',
            message: 'Sem contexto indexado no RAG. Retornando sugestão preliminar baseada nas fontes informadas.',
            details: {
              tenantId: tenantIdForAI,
              sourcesCount: urls.length,
            },
          }],
        });
        return;
      }

      if (institutionalMode) {
        const parseJsonText = (text) => {
          const raw = String(text || '').trim();
          if (!raw) return null;
          try {
            return JSON.parse(raw);
          } catch (_) {
            const match = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
            if (match && match[1]) {
              try {
                return JSON.parse(match[1]);
              } catch (__){
                return null;
              }
            }
            return null;
          }
        };

        const splitParagraphs = (text) => String(text || '')
          .split(/\n\s*\n/g)
          .map((p) => p.trim())
          .filter(Boolean);

        const hasForbiddenTerms = (text) => {
          const lower = String(text || '').toLowerCase();
          return lower.includes('com base no conteúdo')
            || lower.includes('aparente')
            || lower.includes('fontes')
            || lower.includes('ocr')
            || lower.includes('scraping')
            || lower.includes('rag');
        };

        const hasCta = (paragraph) => /entre em contato|fale com|saiba mais|solicite/i.test(String(paragraph || ''));

        const profilePrompt = [
          'Extraia um perfil institucional estruturado a partir do contexto abaixo.',
          'Retorne apenas JSON válido.',
          'SCHEMA (preencha exatamente estas chaves):',
          '{',
          '  "name": string|null,',
          '  "website": string|null,',
          '  "segment": string|null,',
          '  "whatItDoes": string|null,',
          '  "productsServices": string[],',
          '  "audience": string[],',
          '  "differentials": string[],',
          '  "proofPoints": object[],',
          '  "contacts": object,',
          '  "channels": object,',
          '  "locations": string[],',
          '  "paymentMethods": string[],',
          '  "legal": object,',
          '  "operatingHours": string[],',
          '  "tone": string|null,',
          '  "confidence": number|null',
          '}',
          '',
          `Nome informado: ${name || 'N/A'}`,
          `URLs informadas: ${Array.isArray(urls) ? urls.join(', ') : 'nenhuma'}`,
          `Arquivos informados: ${Array.isArray(fileNames) ? fileNames.join(', ') : 'nenhum'}`,
          ragContext ? `Contexto indexado:${ragContext}` : 'Sem contexto indexado.',
        ].join('\n');

        const profileAiResult = await generateAiResponse(profilePrompt, tenantIdForAI, {});
        const entityProfile = parseJsonText(profileAiResult?.text) || {
          name: name || null,
          website: Array.isArray(urls) && urls[0] ? String(urls[0]) : null,
          productsServices: [],
          differentials: [],
          paymentMethods: [],
        };

        const institutionalPrompt = [
          'Escreva um texto institucional em português com EXATAMENTE 3 parágrafos.',
          'Regras obrigatórias:',
          '- Sem metalinguagem e sem mencionar RAG, OCR, scraping, fontes, ou "com base no conteúdo".',
          '- Não usar a palavra "aparente".',
          '- O 3º parágrafo deve ter CTA (ex.: entre em contato, saiba mais, solicite).',
          '- Linguagem clara, profissional e natural.',
          '',
          `Pedido do usuário: ${effectivePrompt}`,
          `Perfil estruturado: ${JSON.stringify(entityProfile)}`,
          ragContext ? `Contexto indexado:${ragContext}` : 'Sem contexto indexado.',
        ].join('\n');

        let institutionalText = String((await generateAiResponse(institutionalPrompt, tenantIdForAI, {}))?.text || '').trim();
        let paragraphs = splitParagraphs(institutionalText);
        if (hasForbiddenTerms(institutionalText) || paragraphs.length !== 3 || !hasCta(paragraphs[2])) {
          const rewritePrompt = [
            'Reescreva o texto abaixo seguindo estritamente:',
            '- Exatamente 3 parágrafos;',
            '- Não usar: "com base no conteúdo", "aparente", "fontes", "OCR", "scraping", "RAG";',
            '- O 3º parágrafo deve conter CTA;',
            '',
            'Texto a reescrever:',
            institutionalText,
          ].join('\n');
          institutionalText = String((await generateAiResponse(rewritePrompt, tenantIdForAI, {}))?.text || institutionalText).trim();
          paragraphs = splitParagraphs(institutionalText);
        }

        sendJson(res, 200, {
          ok: true,
          suggestion: institutionalText,
          entityProfile,
          warnings: [],
        });
        return;
      }

      // Monta prompt final com contexto RAG se disponível
      let finalPrompt = effectivePrompt;
      
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

  // GET /tenants/:id/plan-usage - Retorna plano + limites efetivos + uso (deve vir ANTES da rota genérica /tenants/:id)
  // Também suporta /tenants/current/plan-usage para o tenant do agente autenticado.
  if (method === 'GET' && pathname.startsWith('/tenants/') && pathname.endsWith('/plan-usage')) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return;
      }

      let tenantId = decodeURIComponent(pathname.slice('/tenants/'.length).replace('/plan-usage', ''));
      if (tenantId === 'current') {
        tenantId = authResult.agent?.tenantId;
      }
      if (!tenantId || tenantId === 'current') {
        sendJson(res, 400, { error: 'bad_request', message: 'tenantId ausente ou inválido' });
        return;
      }

      // Apenas owner/admin (ou super-admin) podem ver limites/uso do plano
      const agent = authResult.agent || req.agent;
      const isSuperAdminUser = isSuperAdmin(agent);
      if (!isSuperAdminUser && agent?.role !== 'owner' && agent?.role !== 'admin') {
        sendJson(res, 403, { error: 'forbidden', message: 'Apenas owner ou admin podem ver plano/uso' });
        return;
      }

      const { getTenant, getTenantUsage } = require('./services/tenantService');
      const { getPlanLimits } = require('./services/planLimitsService');

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
      logger.error('Erro ao obter plano/uso do tenant:', err);
      sendJson(res, 500, { error: 'Erro ao obter plano/uso', message: err.message });
    }
    return;
  }

  // POST /system/generate-faq - Gera perguntas/FAQ agrupadas a partir do contexto do tenant
  if (method === 'POST' && pathname === '/system/generate-faq') {
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
      const tenantId = (body?.tenantId && isSuperAdmin(req.agent))
        ? String(body.tenantId).trim()
        : String(authResult.agent?.tenantId || '').trim();

      if (!tenantId) {
        badRequest(res, 'tenantId é obrigatório');
        return;
      }

      const { requireExecutionId } = require('./middleware/requireExecutionId');
      const rawExecutionId = body?.executionId ? String(body.executionId).trim() : '';
      const executionId = rawExecutionId ? requireExecutionId(body, res, badRequest) : null;
      if (rawExecutionId && !executionId) {
        return;
      }

      const { generateFaq } = require('./services/faqGeneratorService');
      const { ensureExecutionContext, updateStage, updateStatus } = require('./services/pipelineExecutionContext');

      let execution = null;
      const pipelineStage = String(body?.pipelineStage || '').trim();
      if (executionId) {
        execution = ensureExecutionContext(
          { executionId, tenantId, pipelineStage },
          { tenantId }
        );
        updateStatus(execution, 'running', {
          currentStage: pipelineStage || 'faqGenerated',
          message: pipelineStage === 'questionsGenerated' ? 'Gerando perguntas automaticamente' : 'Gerando FAQ do tenant',
          source: '/system/generate-faq',
        });
      }

      const result = await generateFaq({
        tenantId,
        name: body?.name ?? null,
        description: body?.description ?? null,
        urls: Array.isArray(body?.urls) ? body.urls : [],
        fileNames: Array.isArray(body?.fileNames) ? body.fileNames : [],
        chunks: Array.isArray(body?.chunks) ? body.chunks : [],
        executionId: executionId || null,
        contextMode: body?.contextMode ?? 'auto',
        rules: body?.rules ?? null,
        dryRun: body?.dryRun === true,
      });

      if (execution && pipelineStage) {
        updateStage(execution, pipelineStage, true);
        updateStatus(execution, 'running', {
          currentStage: pipelineStage,
          message: pipelineStage === 'questionsGenerated' ? 'Perguntas geradas' : 'FAQ gerado',
          source: '/system/generate-faq',
        });
      } else if (execution) {
        updateStage(execution, 'faqGenerated', true);
      }

      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('[System] Erro ao gerar FAQ:', err);
        sendJson(res, 500, {
          error: 'internal_error',
          message: err.message || 'Erro ao gerar FAQ',
        });
      }
    }
    return;
  }

  // POST /system/generate-faq-answers - Gera respostas para perguntas de FAQ
  if (method === 'POST' && pathname === '/system/generate-faq-answers') {
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
      const tenantId = (body?.tenantId && isSuperAdmin(req.agent))
        ? String(body.tenantId).trim()
        : String(authResult.agent?.tenantId || '').trim();

      if (!tenantId) {
        badRequest(res, 'tenantId é obrigatório');
        return;
      }

      const { generateFaqAnswers } = require('./services/faqAnswersService');
      const result = await generateFaqAnswers({
        tenantId,
        questions: Array.isArray(body?.questions) ? body.questions : [],
        executionId: body?.executionId ?? null,
        name: body?.name ?? null,
        urls: Array.isArray(body?.urls) ? body.urls : [],
        fileNames: Array.isArray(body?.fileNames) ? body.fileNames : [],
        chunks: Array.isArray(body?.chunks) ? body.chunks : [],
        contextMode: body?.contextMode ?? 'auto',
        dryRun: body?.dryRun === true,
      });

      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('[System] Erro ao gerar respostas de FAQ:', err);
        sendJson(res, 500, {
          error: 'internal_error',
          message: err.message || 'Erro ao gerar respostas de FAQ',
        });
      }
    }
    return;
  }

  // POST /system/generate-initial-flow - Gera um fluxo inicial visual para tenant
  if (method === 'POST' && pathname === '/system/generate-initial-flow') {
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
      const tenantIdForAI = (body?.tenantId && isSuperAdmin(req.agent))
        ? String(body.tenantId).trim()
        : String(authResult.agent?.tenantId || '').trim();
      const targetTenantId = body?.targetTenantId ? String(body.targetTenantId).trim() : tenantIdForAI;

      if (!tenantIdForAI) {
        badRequest(res, 'tenantId é obrigatório');
        return;
      }
      if (!targetTenantId) {
        badRequest(res, 'targetTenantId é obrigatório');
        return;
      }

      const { requireExecutionId } = require('./middleware/requireExecutionId');
      const rawExecutionId = body?.executionId ? String(body.executionId).trim() : '';
      const executionId = rawExecutionId ? requireExecutionId(body, res, badRequest) : null;
      if (rawExecutionId && !executionId) {
        return;
      }

      const { generateInitialGraph } = require('./services/initialGraphService');
      const { ensureExecutionContext, updateStage, updateStatus } = require('./services/pipelineExecutionContext');

      let execution = null;
      if (executionId) {
        execution = ensureExecutionContext(
          { executionId, tenantId: tenantIdForAI, targetTenantId },
          { tenantId: tenantIdForAI }
        );
        updateStatus(execution, 'running', {
          currentStage: 'initialFlowGenerated',
          message: 'Gerando fluxo inicial do tenant',
          source: '/system/generate-initial-flow',
        });
      }

      const result = await generateInitialGraph({
        tenantIdForAI,
        tenantIdTarget: targetTenantId,
        name: body?.name ?? null,
        description: body?.description ?? null,
        urls: Array.isArray(body?.urls) ? body.urls : [],
        fileNames: Array.isArray(body?.fileNames) ? body.fileNames : [],
        executionId: executionId || null,
        contextMode: body?.contextMode ?? 'auto',
        chunks: Array.isArray(body?.chunks) ? body.chunks : [],
        rules: body?.rules ?? null,
        dryRun: body?.dryRun === true || body?.persistFlow === false,
      });

      if (execution) {
        updateStage(execution, 'initialFlowGenerated', true);
        updateStatus(execution, 'running', {
          currentStage: 'initialFlowGenerated',
          message: 'Fluxo inicial gerado',
          source: '/system/generate-initial-flow',
        });
      }

      sendJson(res, 200, {
        initialFlow: result?.reteJson || null,
        entities: {
          categories: Array.isArray(result?.categories) ? result.categories : [],
          coverage: typeof result?.coverage === 'number' ? result.coverage : 0,
          excludedItemsCount: Number(result?.excludedItemsCount || 0),
        },
        persisted: !!result?.persisted,
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('[System] Erro ao gerar fluxo inicial:', err);
        sendJson(res, 500, {
          error: 'internal_error',
          message: err.message || 'Erro ao gerar fluxo inicial',
        });
      }
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
  // Preview / Diff de fluxo (read-only, safe)
  // -----------------------------------------------------------------------
  // POST /flows/preview
  if (method === 'POST' && pathname === '/flows/preview') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    try {
      const body = await parseJsonBody(req);
      const { flow, baseFlowId = null } = body || {};
      if (!flow || typeof flow !== 'object') {
        badRequest(res, 'Campo "flow" é obrigatório e deve ser um FlowDefinition');
        return;
      }

      const structureValidation = validateFlowStructure(flow);
      if (!structureValidation.valid) {
        sendJson(res, 200, {
          ok: false,
          valid: false,
          errors: [{ code: 'INVALID_FLOW_STRUCTURE', message: structureValidation.error || 'Estrutura do fluxo inválida' }],
        });
        return;
      }

      function collectEdges(f) {
        const edges = [];
        const nodes = Array.isArray(f.nodes) ? f.nodes : [];
        for (const n of nodes) {
          if (!n || !n.id) continue;
          if (typeof n.next === 'string') edges.push({ from: n.id, to: n.next });
          else if (Array.isArray(n.next)) {
            for (const to of n.next) if (typeof to === 'string') edges.push({ from: n.id, to });
          }
          if (n.type === 'router' && Array.isArray(n?.config?.rules)) {
            for (const r of n.config.rules) if (r && typeof r.next === 'string') edges.push({ from: n.id, to: r.next });
          }
          if (n.type === 'schedule_router' && Array.isArray(n?.config?.schedules)) {
            for (const s of n.config.schedules) if (s && typeof s.next === 'string') edges.push({ from: n.id, to: s.next });
            if (typeof n?.config?.defaultNext === 'string') edges.push({ from: n.id, to: n.config.defaultNext });
          }
        }
        return edges;
      }

      function summarize(f) {
        const nodes = Array.isArray(f.nodes) ? f.nodes : [];
        const edges = collectEdges(f);
        const byType = {};
        for (const n of nodes) {
          const t = n?.type || 'unknown';
          byType[t] = (byType[t] || 0) + 1;
        }
        return {
          id: f.id || null,
          tenantId: f.tenantId || null,
          version: f.version || null,
          nodeCount: nodes.length,
          edgeCount: edges.length,
          nodesByType: byType,
          hasFallback: !!byType.fallback,
          hasApiNode: !!byType.api,
          requiresReview: f?.metadata?.requiresReview === true,
          status: f?.metadata?.status || null,
        };
      }

      const base = baseFlowId ? flows.get(String(baseFlowId)) : null;
      const edges = collectEdges(flow);
      const summary = summarize(flow);
      const diff = base ? (() => {
        const baseEdges = collectEdges(base);
        const baseNodeMap = new Map((base.nodes || []).filter(Boolean).map(n => [n.id, n]));
        const nextNodeMap = new Map((flow.nodes || []).filter(Boolean).map(n => [n.id, n]));

        const addedNodes = [];
        const removedNodes = [];
        const changedNodes = [];

        for (const [id, n] of nextNodeMap.entries()) {
          if (!baseNodeMap.has(id)) addedNodes.push(id);
          else {
            const before = baseNodeMap.get(id);
            if (JSON.stringify(before) !== JSON.stringify(n)) changedNodes.push(id);
          }
        }
        for (const [id] of baseNodeMap.entries()) {
          if (!nextNodeMap.has(id)) removedNodes.push(id);
        }

        const edgeKey = (e) => `${e.from}->${e.to}`;
        const baseSet = new Set(baseEdges.map(edgeKey));
        const nextSet = new Set(edges.map(edgeKey));
        const addedEdges = [];
        const removedEdges = [];
        for (const k of nextSet) if (!baseSet.has(k)) addedEdges.push(k);
        for (const k of baseSet) if (!nextSet.has(k)) removedEdges.push(k);

        return {
          baseFlowId,
          addedNodes,
          removedNodes,
          changedNodes,
          addedEdges,
          removedEdges,
        };
      })() : null;

      sendJson(res, 200, {
        ok: true,
        valid: true,
        summary,
        edges,
        diff,
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else if (err.message && err.message.includes('excede o tamanho máximo')) {
        badRequest(res, err.message);
      } else {
        logger.error('Erro ao gerar preview/diff do fluxo:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao gerar preview/diff do fluxo' });
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

      const authResult = requireAuth(req);
      let finalTenantId = null;
      if (STRICT_TENANT_MODE) {
        if (!authResult.valid) {
          sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
          return;
        }
        finalTenantId = requireTenant(req, res);
        if (!finalTenantId) return;
      } else {
        finalTenantId = (authResult.valid && req.tenantId) || body.tenantId || null;
        if (!finalTenantId || typeof finalTenantId !== 'string' || finalTenantId.trim() === '') {
          sendJson(res, 403, { error: 'tenant_required' });
          return;
        }
        finalTenantId = finalTenantId.trim();
      }

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

      // Compatibilidade: expõe validationWarnings em formato estável para UI/testes
      if (!result.validationWarnings) {
        const flowValidation = result?.validation?.flow || null;
        const validationErrors = Array.isArray(flowValidation?.errors) ? flowValidation.errors : [];
        const codes = validationErrors
          .map((errItem) => (errItem && (errItem.code || errItem.type)) ? String(errItem.code || errItem.type) : null)
          .filter(Boolean);

        result.validationWarnings = {
          valid: flowValidation?.valid !== false,
          errors: validationErrors,
          codes,
        };
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

      const authResult = requireAuth(req);
      let finalTenantId = null;
      if (STRICT_TENANT_MODE) {
        if (!authResult.valid) {
          sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
          return;
        }
        finalTenantId = requireTenant(req, res);
        if (!finalTenantId) return;
      } else {
        finalTenantId = (authResult.valid && req.tenantId) || body.tenantId || null;
        if (!finalTenantId || typeof finalTenantId !== 'string' || finalTenantId.trim() === '') {
          sendJson(res, 403, { error: 'tenant_required' });
          return;
        }
        finalTenantId = finalTenantId.trim();
      }

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

      const authResult = requireAuth(req);
      let finalTenantId = null;
      if (STRICT_TENANT_MODE) {
        if (!authResult.valid) {
          sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
          return;
        }
        finalTenantId = requireTenant(req, res);
        if (!finalTenantId) return;
      } else {
        finalTenantId = (authResult.valid && req.tenantId) || body.tenantId || null;
        if (!finalTenantId || typeof finalTenantId !== 'string' || finalTenantId.trim() === '') {
          sendJson(res, 403, { error: 'tenant_required' });
          return;
        }
        finalTenantId = finalTenantId.trim();
      }
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

      const authResult = requireAuth(req);
      let finalTenantId = null;
      if (STRICT_TENANT_MODE) {
        if (!authResult.valid) {
          sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
          return;
        }
        finalTenantId = requireTenant(req, res);
        if (!finalTenantId) return;
      } else {
        finalTenantId = (authResult.valid && req.tenantId) || body.tenantId || null;
        if (!finalTenantId || typeof finalTenantId !== 'string' || finalTenantId.trim() === '') {
          sendJson(res, 403, { error: 'tenant_required' });
          return;
        }
        finalTenantId = finalTenantId.trim();
      }
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

      const authResult = requireAuth(req);
      let tenantId = null;
      if (STRICT_TENANT_MODE) {
        if (!authResult.valid) {
          sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
          return;
        }
        tenantId = requireTenant(req, res);
        if (!tenantId) return;
        if (flow.tenantId !== tenantId) {
          sendJson(res, 403, { error: 'forbidden', message: 'Fluxo não pertence ao seu tenant' });
          return;
        }
      } else {
        tenantId = (authResult.valid && req.tenantId) || flow.tenantId || null;
        if (!tenantId) {
          sendJson(res, 403, { error: 'tenant_required' });
          return;
        }
      }

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
        // -------------------------------------------------------------------
        // DEV: não servir index.html cru do filesystem
        // Motivo: em dev, o frontend roda no Vite e precisa do preamble do
        // React Refresh (injetado no HTML pelo Vite/@vitejs/plugin-react).
        // Servir o index.html estático daqui causa:
        // "@vitejs/plugin-react can't detect preamble. Something is wrong."
        // -------------------------------------------------------------------
        const acceptHeader = req.headers.accept || '';
        const isDev = process.env.NODE_ENV !== 'production';
        const isHtmlNavigation = acceptHeader.includes('text/html');

        if (isDev && method === 'GET' && isHtmlNavigation) {
          const frontendPort = Number(process.env.FRONTEND_PORT || 5173);
          const location = `http://localhost:${frontendPort}${req.url || pathname || '/'}`;
          res.writeHead(302, { Location: location });
          res.end();
          return;
        }

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
