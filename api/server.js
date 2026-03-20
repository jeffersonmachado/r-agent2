/**
 * Servidor HTTP principal da API, consolidado em Express.
 *
 * Importante:
 * - O ponto de entrada principal é `server.js`.
 * - Express hospeda toda a pipeline principal do servidor.
 * - Fluxos são persistidos no banco de dados PostgreSQL.
 */

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./utils/config');
const crypto = require('crypto');
const { initializeAiProviders } = require('./services/aiProviderService');
const { isSuperAdmin } = require('./services/superAdminService');
const logger = require('./utils/logger');
const {
  createTenant,
  getTenant,
} = require('./services/tenantService');
const {
  startAutoCleanup,
} = require('./services/queueService');
const { clearLimitersCache } = require('../infra/rate-limit');
const { generateChatbotFlow } = require('../engine/ai/generateChatbotFlow');
const { generateRpaTest } = require('../engine/ai/generateRpaTest');
const rpaDependencyResolver = require('../engine/rpaDependencyResolver');
const outboundWorker = require('./services/outboundWorker');
const { createStartInitialization } = require('./bootstrap/startInitialization');
const { startWorkers } = require('./runtime/startWorkers');
const { registerShutdownHooks } = require('./runtime/registerShutdownHooks');
const { createBuildCoreRoutingContext } = require('./composition/core/buildCoreRoutingContext');
const { createBuildPlatformRoutingContext } = require('./composition/platform/buildPlatformRoutingContext');
const { createBuildExtendedRoutingContext } = require('./composition/extended/buildExtendedRoutingContext');
const { parseJsonBody, setCorsHeaders, sendJson, badRequest, hasJsonContentType, notFound } = require('./express/httpHelpers');
const { registerRoutes } = require('./app/registerRoutes');
const { applyGlobalMiddlewares } = require('./app/applyMiddlewares');
const queueDefinitionService = require('./services/queueDefinitionService');
const closeReasonsService = require('./services/closeReasonsService');
const ticketInsightService = require('./services/ticketInsightService');
const flowTemplateMarketplaceService = require('./services/flowTemplateMarketplaceService');
const { startAutoReturnToBot } = require('./services/handoverService');
const { startAssignmentWorker } = require('./services/assignmentService');
const { initializeWebSocket } = require('./services/websocketService');

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
// Helpers HTTP básicos (importados de api/express/httpHelpers.js)
// ---------------------------------------------------------------------------
// parseJsonBody, setCorsHeaders, sendJson, notFound, badRequest, hasJsonContentType
// estão disponíveis via import no topo do arquivo.

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

function ensureRequestTracing(req) {
  if (!req.id && req.headers && req.headers['x-request-id']) {
    req.id = String(req.headers['x-request-id']).trim() || undefined;
  }
}

// buildRagRouteDeps → extraído para api/composition/rag/index.js

const buildCoreRoutingContext = createBuildCoreRoutingContext({
  validateFlowStructure,
  ensureFlowHasMeta,
  flows,
  persistFlowBestEffort,
  deleteFlowBestEffort,
  sessionEvents,
  saveSessionEventsToFile,
  strictTenantMode: STRICT_TENANT_MODE,
});

const buildPlatformRoutingContext = createBuildPlatformRoutingContext({
  requireTenant,
  validateFlowStructure,
  ensureFlowHasMeta,
  persistFlowBestEffort,
  flows,
  detectProcessManager,
});

const buildExtendedRoutingContext = createBuildExtendedRoutingContext({
  requireTenant,
  flows,
  sessionEvents,
  saveSessionEventsToFile,
});

function buildExpressApp() {
  const app = express();
  applyGlobalMiddlewares(app, { ensureRequestTracing });
  registerRoutes(app, {
    buildCoreRoutingContext,
    buildPlatformRoutingContext,
    buildExtendedRoutingContext,
  });
  return app;
}

let expressAppInstance = null;

function getOrCreateExpressApp() {
  if (!expressAppInstance) {
    expressAppInstance = buildExpressApp();
  }

  return expressAppInstance;
}

function createExpressApp() {
  return getOrCreateExpressApp();
}

/**
 * Cria um servidor HTTP da API.
 *
 * Exportamos a factory para facilitar testes.
 *
 * @returns {http.Server}
 */
function createServer() {
  const app = getOrCreateExpressApp();
  const server = http.createServer(app);

  // Inicializa WebSocket
  initializeWebSocket(server);

  return server;
}

let serverInstance = null;

function getOrCreateServer() {
  if (!serverInstance) {
    serverInstance = createServer();
  }

  return serverInstance;
}

// Inicialização automática do systemadmin quando o módulo é carregado.
// Isso garante que o systemadmin seja criado mesmo se o servidor for iniciado de outra forma.
const startInitialization = createStartInitialization({
  logger,
  initializeSystemAdmin,
  loadFlowsFromDb,
  queueDefinitionService,
  closeReasonsService,
  flowTemplateMarketplaceService,
  initializeAiProviders,
});

registerShutdownHooks({
  logger,
  outboundWorker,
  saveSessionEventsToFileImmediate,
  processRef: process,
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
    const server = getOrCreateServer();
    console.log('[Server] ✅ Inicialização concluída, iniciando servidor...');
    logger.info('[Server] ✅ Inicialização concluída, iniciando servidor...');
    server.listen(port, () => {
      console.log(`API server listening on http://0.0.0.0:${port}`);
      logger.info(`API server listening on http://0.0.0.0:${port}`);
    });

    startWorkers({
      logger,
      outboundWorker,
      startAutoCleanup,
      ticketCleanupIntervalHours: TICKET_CLEANUP_INTERVAL_HOURS,
      ticketMaxAgeDays: TICKET_MAX_AGE_DAYS,
      startAutoReturnToBot,
      startAssignmentWorker,
      processRef: process,
    });
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
  console.log('[Server] ⚠️  Bloco if (require.main === module) NÃO executado - inicialização automática desativada para imports');
}

module.exports = {
  createExpressApp,
  createServer,
  getOrCreateServer,
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
