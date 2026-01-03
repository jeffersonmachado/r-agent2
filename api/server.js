/**
 * Servidor HTTP mínimo para expor a engine via API.
 *
 * Importante:
 * - Não depende de nenhuma biblioteca externa (sem Express).
 * - Exponde endpoints de health/version + CRUD de fluxos, validação,
 *   simulação e replay.
 * - Fluxos são persistidos em arquivo JSON (api/data/flows.json).
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
  validateToken,
  createAgent,
  listAgents,
  getAgent,
  updateAgent,
  deleteAgent,
} = require('./services/authService');
const { logAction, queryLogs, getAuditStats } = require('./services/auditService');
const { requireAuth, requirePermission } = require('./middleware/auth');
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
  loadQueuesFromFile,
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
  getDocumentsStats,
} = require('./services/ragDocumentsService');
const {
  scrapeUrl,
  scrapeUrls,
} = require('./services/webScrapingService');
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
const defaultTenantId = config.get('api.defaultTenantId', 'tenant-demo');

// Caminho do arquivo de persistência
const dataDir = path.join(__dirname, 'data');
const flowsFile = path.join(dataDir, 'flows.json');
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
  }
}

// Inicia limpeza periódica de sessões
setInterval(cleanupOldSessions, SESSION_CLEANUP_INTERVAL);

// Inicia limpeza periódica de tickets fechados antigos
// Remove tickets fechados com mais de 7 dias, a cada 1 hora
const TICKET_CLEANUP_INTERVAL_HOURS = Number(config.get('api.ticketCleanup.intervalHours', 1));
const TICKET_MAX_AGE_DAYS = Number(config.get('api.ticketCleanup.maxAgeDays', 7));
startAutoCleanup(TICKET_CLEANUP_INTERVAL_HOURS, TICKET_MAX_AGE_DAYS);

// Inicializa providers de IA
initializeAiProviders();

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
 * Carrega fluxos do arquivo JSON.
 */
function loadFlowsFromFile() {
  try {
    ensureDataDir();
    if (fs.existsSync(flowsFile)) {
      const data = fs.readFileSync(flowsFile, 'utf8');
      const flowsArray = JSON.parse(data);
      if (Array.isArray(flowsArray)) {
        flows.clear();
        for (const flow of flowsArray) {
          if (flow && flow.id) {
            flows.set(flow.id, flow);
          }
        }
        logger.info(`Carregados ${flows.size} fluxo(s) do arquivo ${flowsFile}`);
      }
    } else {
      logger.info(`Arquivo de fluxos não encontrado: ${flowsFile}. Criando novo arquivo.`);
    }
  } catch (err) {
    logger.error('Erro ao carregar fluxos do arquivo:', err);
    // Continua com Map vazio se houver erro
  }
}

/**
 * Salva todos os fluxos no arquivo JSON.
 */
function saveFlowsToFile() {
  try {
    ensureDataDir();
    const flowsArray = Array.from(flows.values());
    const data = JSON.stringify(flowsArray, null, 2);
    fs.writeFileSync(flowsFile, data, 'utf8');
    logger.debug(`Fluxos salvos no arquivo ${flowsFile} (${flows.size} fluxo(s))`);
  } catch (err) {
    logger.error('Erro ao salvar fluxos no arquivo:', err);
  }
}

// Carrega fluxos do arquivo ao iniciar o servidor
loadFlowsFromFile();

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
 * Adiciona headers CORS à resposta.
 *
 * @param {http.ServerResponse} res
 */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 horas
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
 * - tenantId: sempre presente (cai no DEFAULT_TENANT_ID se não vier)
 * - id: se não vier, gera um id simples com timestamp
 * - name: valor default amigável
 * - version: default 1 se não vier ou não for número
 *
 * @param {any} rawFlow
 * @returns {any}
 */
function ensureFlowHasMeta(rawFlow) {
  const flow = rawFlow && typeof rawFlow === 'object' ? { ...rawFlow } : {};

  if (!flow.tenantId || typeof flow.tenantId !== 'string' || flow.tenantId.trim() === '') {
    flow.tenantId = defaultTenantId;
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
    // eslint-disable-next-line no-console
    console.log(`[Server] Requisição GET recebida: ${pathname}`);
  }

  // Healthcheck básico
  if (method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { status: 'ok' });
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

      const result = authLogin(username, password, ipAddress, userAgent);

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
    const agents = listAgents(req.tenantId);
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
      const result = createAgent(body);

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

    const agent = getAgent(agentId);
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
    const agent = getAgent(agentId);
    
    if (!agent) {
      sendJson(res, 404, { error: 'agent_not_found' });
      return;
    }

    // Valida tenant
    if (req.tenantId && agent.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Agente não pertence ao seu tenant' });
      return;
    }
    
    // Agent pode atualizar apenas próprio perfil (com restrições), admin/supervisor podem atualizar qualquer um do mesmo tenant
    if (req.agent.role !== 'admin' && req.agent.role !== 'supervisor' && req.agent.id !== agentId) {
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

      const result = updateAgent(agentId, body);

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
    const agent = getAgent(agentId);
    
    if (!agent) {
      sendJson(res, 404, { error: 'agent_not_found' });
      return;
    }

    // Valida tenant
    if (req.tenantId && agent.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Agente não pertence ao seu tenant' });
      return;
    }

    const result = deleteAgent(agentId);

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

    const result = queryLogs(filters);
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

    const stats = getAuditStats();
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

      const flow = ensureFlowHasMeta(body);

      // Validação completa usando o validador da engine
      // ✅ NOTA: A validação é executada mas não bloqueia a criação do fluxo
      // O fluxo pode ser criado mesmo com erros de validação para permitir que o usuário corrija depois
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
      saveFlowsToFile(); // Salva no arquivo após criar
      
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
        // eslint-disable-next-line no-console
        console.error('Erro ao criar fluxo:', err);
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
      saveFlowsToFile(); // Salva no arquivo após atualizar
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
    flows.delete(id);
    saveFlowsToFile(); // Salva no arquivo após deletar
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
        badRequest(res, 'Body deve ser um objeto com campo "description"');
        return;
      }

      const { description, flowId, flowName, tenantId } = body;

      if (!description || typeof description !== 'string' || description.trim() === '') {
        badRequest(res, 'Campo "description" é obrigatório e deve ser uma string não vazia');
        return;
      }

      // Obtém tenantId do agente autenticado se disponível
      const authResult = requireAuth(req);
      const finalTenantId = tenantId || (authResult.valid && req.tenantId) || 'demo-tenant';

      // Gera o fluxo usando IA
      const generatedFlow = await generateFlowFromDescription(description, {
        tenantId: finalTenantId,
        flowId,
        flowName,
      });

      // Valida o fluxo gerado
      const validationResult = validateFlow(generatedFlow);
      const hasValidationErrors = !validationResult.valid && validationResult.errors.length > 0;

      // Retorna o fluxo gerado (mesmo com erros de validação, para permitir edição)
      const response = { ...generatedFlow };
      if (hasValidationErrors) {
        response.validationWarnings = {
          valid: false,
          errors: validationResult.errors,
        };
      }

      sendJson(res, 200, response);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao gerar fluxo:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao gerar fluxo' });
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
      }

      // Retorna resultado completo da simulação (SimulationResultUi)
      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else if (err.message && err.message.includes('excede o tamanho máximo')) {
        badRequest(res, err.message);
      } else {
        // eslint-disable-next-line no-console
        console.error('Erro ao simular fluxo:', err);
        sendJson(res, 500, {
          error: 'simulation_error',
          message: err && err.message ? err.message : 'Erro interno ao simular fluxo',
        });
      }
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

    const permResult = requirePermission(req, 'audit', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
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

      sendJson(res, 200, { conversations });
    } catch (err) {
      logger.error('[Conversations] Erro ao listar conversas:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar conversas' });
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
      const tenantId = req.tenantId || defaultTenantId;
      triggerWebhooks(tenantId, 'ticket.created', {
        ticketId: ticket.id,
        queue: ticket.queue,
        phoneNumber: cleanPhone,
        agentId: req.agent.id,
      }).catch((err) => {
        logger.error('[Webhook] Erro ao disparar webhook para ticket.created:', err);
      });

      emitEvent('ticket.created', {
        ticketId: ticket.id,
        queue: ticket.queue,
        phoneNumber: cleanPhone,
        agentId: req.agent.id,
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

    const queuesList = listQueues();
    sendJson(res, 200, queuesList);
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
        // eslint-disable-next-line no-console
        console.error('Erro ao criar fila:', err);
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
      const tenantId = req.tenantId || defaultTenantId;
      triggerWebhooks(tenantId, 'ticket.assigned', {
        ticketId: id,
        assignedTo,
        assignedBy: req.agent.id,
      }).catch((err) => {
        logger.error('[Webhook] Erro ao disparar webhook para ticket.assigned:', err);
      });

      emitEvent('ticket.assigned', {
        ticketId: id,
        assignedTo,
        assignedBy: req.agent.id,
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

    const closedTicket = closeTicket(id);
    if (!closedTicket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return;
    }

    // Dispara webhooks e WebSocket
    const tenantId = req.tenantId || defaultTenantId;
    triggerWebhooks(tenantId, 'ticket.closed', {
      ticketId: id,
      closedBy: req.agent.id,
    }).catch((err) => {
      logger.error('[Webhook] Erro ao disparar webhook para ticket.closed:', err);
    });

    emitEvent('ticket.closed', {
      ticketId: id,
      closedBy: req.agent.id,
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
      loadQueuesFromFile();
      
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

  // POST /api/ai/generate - Gera resposta de IA
  if (method === 'POST' && pathname === '/api/ai/generate') {
    if (!hasJsonContentType(req)) {
      // eslint-disable-next-line no-console
      console.error('[ERROR] Requisição de IA sem Content-Type JSON');
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { prompt, sessionId, flowId, nodeId, tenantId } = body || {};

      // eslint-disable-next-line no-console
      console.log('[INFO] Requisição de IA recebida', {
        promptLength: prompt?.length,
        sessionId,
        flowId,
        nodeId,
        tenantId,
      });

      if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
        // eslint-disable-next-line no-console
        console.error('[ERROR] Prompt inválido na requisição de IA', { prompt, type: typeof prompt });
        badRequest(res, 'Campo "prompt" é obrigatório e deve ser uma string não vazia');
        return;
      }

      const effectiveTenantId = tenantId || defaultTenantId;
      // eslint-disable-next-line no-console
      console.log('[DEBUG] Usando tenant para IA', { effectiveTenantId, defaultTenantId });

      try {
        // eslint-disable-next-line no-console
        console.log('[INFO] Gerando resposta de IA...', {
          tenantId: effectiveTenantId,
          promptPreview: prompt.substring(0, 100),
        });
        
        const result = await generateAiResponse(prompt, effectiveTenantId, {
          sessionId,
          flowId,
          nodeId,
        });

        // eslint-disable-next-line no-console
        console.log('[INFO] Resposta de IA gerada com sucesso', {
          hasText: !!result?.text,
          textLength: result?.text?.length,
          hasUsage: !!result?.usage,
        });

        sendJson(res, 200, {
          text: typeof result === 'string' ? result : result.text,
          usage: result.usage || null,
        });
      } catch (aiError) {
        // eslint-disable-next-line no-console
        console.error('[ERROR] Erro ao gerar resposta de IA:', {
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
        // eslint-disable-next-line no-console
        console.error('[ERROR] JSON inválido na requisição de IA:', err.message);
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        // eslint-disable-next-line no-console
        console.error('[ERROR] Erro ao processar requisição de IA:', {
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
              const messages = value.messages || [];
              for (const msg of messages) {
                // Processa cada mensagem
                // eslint-disable-next-line no-await-in-loop
                await processWhatsAppMessage(msg, value, {
                  flows,
                  sessionEvents,
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
      // eslint-disable-next-line no-console
      console.error('Erro ao listar templates:', err);
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
        console.error('Erro ao obter template:', err);
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

      // eslint-disable-next-line no-console
      console.log(`Template salvo: ${templateFile}`);

      sendJson(res, 201, {
        success: true,
        template: template,
        message: `Template "${template.name}" salvo com sucesso`,
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        // eslint-disable-next-line no-console
        console.error('Erro ao salvar template:', err);
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
      // eslint-disable-next-line no-console
      console.error('Erro ao remover template:', err);
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
  if (method === 'GET' && pathname === '/config') {
    try {
      const configData = config.getAll();
      
      // Valida que configData é um objeto válido
      if (!configData || typeof configData !== 'object' || Array.isArray(configData)) {
        throw new Error('Configuração retornada não é um objeto válido');
      }
      
      sendJson(res, 200, configData);
    } catch (err) {
      // Usa console.error como fallback caso logger falhe
      try {
        logger.error('Erro ao ler configuração:', err);
      } catch (logErr) {
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

      // Salva no arquivo
      ensureDataDir();
      const configData = JSON.stringify(body, null, 2);
      fs.writeFileSync(configFile, configData, 'utf8');
      
      // Recarrega a configuração
      config.reload();
      
      // eslint-disable-next-line no-console
      console.log('Configuração atualizada via API');
      
      sendJson(res, 200, { success: true, message: 'Configuração atualizada com sucesso' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Erro ao atualizar configuração:', err);
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

      const replies = searchByContext(context, limit);
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
    
    if (!reply) {
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

    const tags = getAllTags();
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

    const categories = getAllCategories();
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
        tenantId: url.searchParams.get('tenantId') || defaultTenantId,
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
      const tenantId = url.searchParams.get('tenantId') || defaultTenantId;
      const stats = getDocumentsStats(tenantId);
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
      const tenantId = body.tenantId || defaultTenantId;
      const result = await createDocument(body, tenantId);

      if (!result.success) {
        sendJson(res, 400, { error: 'creation_failed', message: result.error });
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
      const result = await scrapeUrl(body.url, {
        contentSelector: body.contentSelector,
        removeSelectors: body.removeSelectors,
        timeout: body.timeout || 30000,
        autoIndex: body.autoIndex !== false,
        source: body.source || 'web_scraping',
        category: body.category,
        tags: body.tags || [],
        tenantId: defaultTenantId,
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
        tenantId: defaultTenantId,
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

    const webhooksList = listWebhooks(req.tenantId || defaultTenantId);
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
    if (webhook.tenantId !== (req.tenantId || defaultTenantId)) {
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
        tenantId: body.tenantId || req.tenantId || defaultTenantId,
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
      if (existingWebhook.tenantId !== (req.tenantId || defaultTenantId)) {
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
    if (existingWebhook.tenantId !== (req.tenantId || defaultTenantId)) {
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
      sendJson(res, 200, recordings);
    } catch (error) {
      logger.error('Erro ao listar gravações RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar gravações RPA' });
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
      // eslint-disable-next-line no-console
      console.error('Erro inesperado ao processar requisição', err);
      sendJson(res, 500, { error: 'internal_error' });
    });
  });

  // Inicializa WebSocket
  initializeWebSocket(server);

  return server;
}

const server = createServer();

if (require.main === module) {
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`API server listening on http://0.0.0.0:${port}`);
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
    defaultTenantId,
  },
};


