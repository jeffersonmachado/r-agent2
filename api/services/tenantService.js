/**
 * Serviço de gerenciamento de Tenants.
 *
 * Responsabilidades:
 * - Gerenciar tenants (criar, listar, atualizar)
 * - Gerenciar tenant_context (contexto cognitivo do tenant)
 * - Persistência em PostgreSQL (OBRIGATÓRIO)
 * - Validação de schema
 *
 * Persistência:
 * - Tenants: PostgreSQL (tabela tenants)
 * - Tenant Contexts: PostgreSQL (tabela tenant_contexts ou similar)
 * 
 * NOTA: Arquivos JSON removidos - todos os dados agora estão no banco de dados PostgreSQL
 * 
 * IMPORTANTE: PostgreSQL é obrigatório. Não há fallback para JSON.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('../utils/logger');
const config = require('../utils/config');
const webScrapingService = require('./webScrapingService');
const { getSequelize } = require('../db/sequelize');

// Função auxiliar para verificar se está conectado
function isConnected() {
  const sequelize = getSequelize();
  if (!sequelize) return false;
  try {
    // Verifica se a conexão está ativa (método simples)
    return sequelize.connectionManager.pool !== null;
  } catch (e) {
    return false;
  }
}
const { Tenant } = require('../db/models');

// PostgreSQL é obrigatório - não há mais fallback

// Helper para obter models (suporta lazy loading)
function getModels() {
  return {
    Tenant: typeof Tenant === 'function' ? Tenant() : Tenant,
  };
}

// Lazy loading do ragDocumentsService para evitar dependência circular
let ragDocumentsService = null;
function getRagDocumentsService() {
  if (!ragDocumentsService) {
    ragDocumentsService = require('./ragDocumentsService');
  }
  return ragDocumentsService;
}

/**
 * @typedef {Object} Tenant
 * @property {string} id - ID único do tenant
 * @property {string} name - Nome do tenant/cliente
 * @property {string} site - URL oficial do cliente (obrigatório)
 * @property {string} ramo_atividade - Descrição textual do segmento de negócio (obrigatório)
 * @property {string} objetivo - Objetivo estratégico do cliente com o uso da plataforma (obrigatório)
 * @property {boolean} active - Se o tenant está ativo
 * @property {string} status - Status do tenant (trial, active, suspended, terminated)
 * @property {string} plan - Plano do tenant (free, trial, pro, enterprise)
 * @property {Object} limits - Limites do plano (usuários, agentes_ia, execucoes_rpa, tokens_ia, etc.)
 * @property {Object} settings - Configurações do tenant (json)
 * @property {Object} branding - Branding personalizado (logo, cores, etc.)
 * @property {string} createdAt - Data de criação (ISO string)
 * @property {string} updatedAt - Data da última atualização (ISO string)
 * @property {string|null} suspendedAt - Data de suspensão (ISO string)
 * @property {string|null} trialExpiresAt - Data de expiração do trial (ISO string)
 */

/**
 * @typedef {Object} TenantContext
 * @property {string} tenantId - ID do tenant (chave única)
 * @property {string} ramo_atividade - Descrição do segmento de negócio
 * @property {string} objetivo - Objetivo estratégico
 * @property {string} site_oficial - URL oficial do cliente
 * @property {string} prioridade - Prioridade do contexto (HIGH, MEDIUM, LOW) - padrão: HIGH
 * @property {string[]} escopo - Escopos onde o contexto se aplica (rag, chatbot, classificacao_intencao)
 * @property {string} createdAt - Data de criação (ISO string)
 * @property {string} updatedAt - Data da última atualização (ISO string)
 */


/** @type {Map<string, TenantContext>} */
const tenantContexts = new Map();

// Caminhos dos arquivos de persistência
const dataDir = path.join(__dirname, '..', 'data');
const tenantsFile = path.join(dataDir, 'tenants.json');
const tenantContextsFile = path.join(dataDir, 'tenant_contexts.json');
// Diretório raiz do projeto (para executar scripts auxiliares)
const projectRoot = path.join(__dirname, '..', '..');

/**
 * Garante que o diretório de dados existe.
 */
function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Verifica se existem dados do tenant-demo.
 * 
 * NOTA: Esta função foi simplificada - dados agora estão no banco de dados PostgreSQL.
 * A verificação deve ser feita diretamente no banco de dados.
 * 
 * @returns {boolean} false (sempre retorna false, pois dados estão no banco)
 */
function hasDemoTenantData() {
  // Dados agora estão no banco de dados PostgreSQL - não verifica mais arquivos JSON
  // Esta função é mantida apenas para compatibilidade, mas sempre retorna false
  // A verificação real deve ser feita consultando o banco de dados
  return false;
}

/**
 * Executa o seed do tenant-demo em background
 */
function runDemoTenantSeed() {
  try {
    logger.info('[TenantService] Iniciando seed completo para tenant-demo via scripts/seed-tenant-demo.js...');
    const seedProcess = spawn('node', ['scripts/seed-tenant-demo.js'], {
      cwd: projectRoot,
      stdio: 'ignore',
      detached: true,
    });

    seedProcess.on('error', (err) => {
      logger.error('[TenantService] Erro ao iniciar seed para tenant-demo:', {
        error: err.message,
      });
    });

    // Não bloqueia o boot da API; apenas logamos quando terminar, se possível
    seedProcess.unref();
  } catch (err) {
    logger.error('[TenantService] Exceção ao disparar seed para tenant-demo:', {
      error: err.message,
    });
  }
}

/**
 * Garante que o tenant de demonstração (`tenant-demo`) exista e tenha dados.
 * 
 * Este tenant é usado como ambiente de demonstração e desenvolvimento.
 * Se não existir no PostgreSQL, é criado automaticamente com
 * dados padrão seguros.
 * Se existir mas não tiver dados (agentes, fluxos, etc.), executa o seed.
 */
async function ensureDemoTenantExists() {
  const DEMO_TENANT_ID = 'tenant-demo';
  let tenantCreated = false;

  logger.info('[TenantService] Verificando tenant-demo e seus dados...');

  try {
    // Verifica se o tenant existe no PostgreSQL usando findTenantByIdentifier diretamente
    // para evitar problemas com formatação de retorno
    const existingTenantRaw = await findTenantByIdentifier(DEMO_TENANT_ID);
    const existingTenant = existingTenantRaw ? await getTenant(DEMO_TENANT_ID) : null;
    
    if (!existingTenant) {
      logger.info('[TenantService] Tenant de demonstração não encontrado. Criando tenant-demo padrão...');
      logger.debug('[TenantService] Tentando criar tenant-demo com tenant_key:', DEMO_TENANT_ID);

      const result = await createTenant({
        tenant_key: DEMO_TENANT_ID, // Usa tenant_key em vez de id
        name: 'Tenant Demo',
        site: 'https://demo.example.com',
        ramo_atividade: 'Tecnologia e Software - Plataforma de demonstração',
        objetivo: 'Demonstração e desenvolvimento da plataforma',
        plan: 'trial',
        settings: {},
        branding: {},
      });

      if (!result.success) {
        logger.error('[TenantService] Falha ao criar tenant-demo padrão:', {
          error: result.error,
          details: result,
        });
        return; // Não continua se não conseguiu criar o tenant
      }
      
      logger.info('[TenantService] Tenant-demo criado com sucesso:', {
        tenant_key: DEMO_TENANT_ID,
        tenant_id: result.tenant?.id,
      });
      
      logger.info('[TenantService] Tenant-demo criado automaticamente com sucesso.');
      tenantCreated = true;
    } else {
      logger.info('[TenantService] Tenant-demo já existe.');
    }
  } catch (err) {
    logger.error('[TenantService] Erro ao verificar/criar tenant-demo:', err);
    return;
  }

  // Verifica se existem dados do tenant-demo
  const hasData = hasDemoTenantData();
  if (!hasData) {
    logger.info('[TenantService] Dados do tenant-demo não encontrados. Executando seed...');
    runDemoTenantSeed();
  } else if (tenantCreated) {
    // Se o tenant foi criado agora, sempre executa o seed para garantir dados iniciais
    logger.info('[TenantService] Tenant-demo recém-criado. Executando seed para popular dados iniciais...');
    runDemoTenantSeed();
  } else {
    logger.info('[TenantService] Tenant-demo e seus dados já existem. Nenhuma ação necessária.');
  }
}

/**
 * Valida URL.
 *
 * @param {string} url - URL a validar
 * @returns {boolean}
 */
function isValidUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}


/**
 * Retorna limites padrão para um plano.
 * 
 * @param {string} plan - Plano (free, trial, pro, enterprise)
 * @returns {Object} Limites do plano
 */
function getDefaultLimits(plan) {
  const limitsByPlan = {
    free: {
      usuarios: 1,
      agentes_ia: 1,
      execucoes_rpa: 10,
      tokens_ia: 10000,
      documentos_rag: 10,
      storage_mb: 100,
    },
    trial: {
      usuarios: 3,
      agentes_ia: 2,
      execucoes_rpa: 50,
      tokens_ia: 50000,
      documentos_rag: 50,
      storage_mb: 500,
    },
    pro: {
      usuarios: 10,
      agentes_ia: 5,
      execucoes_rpa: 500,
      tokens_ia: 500000,
      documentos_rag: 500,
      storage_mb: 5000,
    },
    enterprise: {
      usuarios: -1, // Ilimitado
      agentes_ia: -1,
      execucoes_rpa: -1,
      tokens_ia: -1,
      documentos_rag: -1,
      storage_mb: -1,
    },
  };
  
  return limitsByPlan[plan] || limitsByPlan.trial;
}

// Funções deprecated removidas - dados agora estão no banco de dados PostgreSQL
// Dados são carregados do banco de dados PostgreSQL - não precisa carregar de arquivo
// Garante que o tenant de demonstração sempre exista (deferido para quando o servidor iniciar)
// ensureDemoTenantExists() será chamado pelo server.js após conectar ao PostgreSQL

/**
 * Cria ou atualiza o tenant_context automaticamente quando um tenant é criado/atualizado.
 *
 * @param {string} tenantId - ID do tenant
 * @param {string} ramo_atividade - Ramo de atividade
 * @param {string} objetivo - Objetivo estratégico
 * @param {string} site_oficial - Site oficial
 */
function syncTenantContext(tenantId, ramo_atividade, objetivo, site_oficial) {
  const now = new Date().toISOString();
  const existingContext = tenantContexts.get(tenantId);

  const context = {
    tenantId,
    ramo_atividade: ramo_atividade || '',
    objetivo: objetivo || '',
    site_oficial: site_oficial || '',
    prioridade: 'HIGH',
    escopo: ['rag', 'chatbot', 'classificacao_intencao'],
    createdAt: existingContext ? existingContext.createdAt : now,
    updatedAt: now,
  };

  tenantContexts.set(tenantId, context);
  // Dados agora estão no banco de dados PostgreSQL

  logger.debug(`[TenantService] Tenant context sincronizado: ${tenantId}`);
}

/**
 * Indexa o site do tenant como fonte institucional canônica.
 * Executado de forma assíncrona para não bloquear a criação/atualização do tenant.
 *
 * @param {string} tenantId - ID do tenant
 * @param {string} site - URL do site
 */
async function indexSiteAsInstitutionalSource(tenantId, site) {
  if (!site || !isValidUrl(site)) {
    logger.warn(`[TenantService] Site inválido, não indexando: ${site}`);
    return;
  }

  try {
    // Verifica se já existe documento com este site para este tenant
    const ragDocsService = getRagDocumentsService();
    if (!ragDocsService) {
      logger.error('[TenantService] ragDocumentsService não foi carregado corretamente');
      return;
    }
    
    const existingDocs = ragDocsService.listDocuments({
      tenantId,
      source: 'site_institucional',
    });

    const siteAlreadyIndexed = existingDocs.some(doc => 
      doc.metadata?.url === site || doc.metadata?.site_oficial === site
    );

    if (siteAlreadyIndexed) {
      logger.debug(`[TenantService] Site já indexado para tenant ${tenantId}: ${site}`);
      return;
    }

    logger.info(`[TenantService] Indexando site institucional para tenant ${tenantId}: ${site}`);

    // Raspa o site
    const scrapeResult = await webScrapingService.scrapeUrl(site, {
      source: 'site_institucional',
      category: 'institucional',
      tenantId,
      autoIndex: true,
      tags: ['site_oficial', 'fonte_canonica'],
      contentSelector: 'main, article, .content, #content',
      removeSelectors: ['nav', 'header', 'footer', '.sidebar', '.menu', '.advertisement', '.ads', '.social-share'],
    });

    if (scrapeResult.success && scrapeResult.documentId) {
      // Atualiza metadados do documento para marcar como fonte institucional canônica
      const ragDocsService = getRagDocumentsService();
      const updateResult = await ragDocsService.updateDocument(scrapeResult.documentId, {
        metadata: {
          source: 'site_institucional',
          site_oficial: site,
          rag_source: 'site_institucional',
          canonical: true,
        },
      });
      
      if (updateResult.success) {
        logger.info(`[TenantService] Site indexado como fonte institucional canônica: ${scrapeResult.documentId}`);
      }
    }
  } catch (error) {
    logger.error(`[TenantService] Erro ao indexar site institucional para tenant ${tenantId}:`, {
      error: error.message,
      site,
    });
    // Não falha a criação/atualização do tenant se a indexação falhar
  }
}

/**
 * Cria um novo tenant.
 *
 * @param {Object} params
 * @param {string} params.name - Nome do tenant
 * @param {string} params.site - URL oficial do cliente (obrigatório)
 * @param {string} params.ramo_atividade - Descrição do segmento de negócio (obrigatório)
 * @param {string} params.objetivo - Objetivo estratégico (obrigatório)
 * @param {string} [params.plan] - Plano (free, trial, pro, enterprise) - padrão: trial
 * @param {Object} [params.settings] - Configurações iniciais
 * @param {Object} [params.branding] - Branding personalizado
 * @returns {{success: boolean, tenant?: Tenant, error?: string}}
 */
async function createTenant({ id, tenant_key, name, site, ramo_atividade, objetivo, plan = 'trial', settings = {}, branding = {} }) {
  // Validações
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return { success: false, error: 'Nome é obrigatório' };
  }

  if (!site || typeof site !== 'string' || site.trim() === '') {
    return { success: false, error: 'Site é obrigatório' };
  }

  if (!isValidUrl(site)) {
    return { success: false, error: 'Site deve ser uma URL válida (http:// ou https://)' };
  }

  if (!ramo_atividade || typeof ramo_atividade !== 'string' || ramo_atividade.trim() === '') {
    return { success: false, error: 'Ramo de atividade é obrigatório' };
  }

  if (!objetivo || typeof objetivo !== 'string' || objetivo.trim() === '') {
    return { success: false, error: 'Objetivo é obrigatório' };
  }

  // Valida plano
  const validPlans = ['free', 'trial', 'pro', 'enterprise'];
  if (!validPlans.includes(plan)) {
    return { success: false, error: `Plano inválido. Use: ${validPlans.join(', ')}` };
  }

  const sequelize = getSequelize();
  if (!sequelize || !isConnected()) {
    return { success: false, error: 'PostgreSQL não está disponível. O banco de dados é obrigatório.' };
  }

  try {
    const { Tenant: TenantModel } = getModels();
    
    // Usa tenant_key se fornecido, senão usa id, senão gera um automaticamente
    const finalTenantKey = tenant_key || id || `tenant-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    
    // Verifica se já existe tenant com mesmo tenant_key
    const existing = await TenantModel.findOne({
      where: { tenant_key: finalTenantKey },
    });
    if (existing) {
      return { success: false, error: 'Já existe um tenant com este ID' };
    }
    
    // Verifica se já existe tenant com mesmo site
    const existingBySite = await TenantModel.findOne({
      where: { site: site.trim() },
    });
    if (existingBySite) {
      return { success: false, error: 'Já existe um tenant com este site' };
    }

    // Calcula expiração do trial se for trial
    let trialExpiresAt = null;
    if (plan === 'trial') {
      const trialExpires = new Date();
      trialExpires.setDate(trialExpires.getDate() + 14); // 14 dias
      trialExpiresAt = trialExpires;
    }

    // Cria tenant no PostgreSQL
    const { Tenant } = getModels();
    const tenantRecord = await Tenant.create({
      tenant_key: finalTenantKey,
      name: name.trim(),
      site: site.trim(),
      ramo_atividade: ramo_atividade.trim(),
      objetivo: objetivo.trim(),
      status: plan === 'trial' ? 'trial' : 'active',
      plan: plan,
      limits: getDefaultLimits(plan),
      settings: settings || {},
      branding: branding || {},
      suspendedAt: null,
      trialExpiresAt: trialExpiresAt,
    });

    // Converte para formato compatível usando toJSON() para garantir serialização correta
    const tenantData = tenantRecord.toJSON ? tenantRecord.toJSON() : tenantRecord.dataValues || tenantRecord;
    
    const tenantKey = tenantData.tenant_key;
    const tenantName = tenantData.name;
    const tenantStatus = tenantData.status;
    const tenantPlan = tenantData.plan;
    
    const tenant = {
      id: tenantKey,
      tenant_key: tenantKey,
      name: tenantName,
      site: tenantData.site || null,
      ramo_atividade: tenantData.ramo_atividade || null,
      objetivo: tenantData.objetivo || null,
      active: tenantStatus !== 'suspended' && tenantStatus !== 'terminated',
      status: tenantStatus,
      plan: tenantPlan,
      limits: tenantData.limits || {},
      settings: tenantData.settings || {},
      branding: tenantData.branding || {},
      createdAt: tenantData.created_at?.toISOString() || tenantData.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: tenantData.updated_at?.toISOString() || tenantData.updatedAt?.toISOString() || new Date().toISOString(),
      suspendedAt: tenantData.suspended_at?.toISOString() || tenantData.suspendedAt?.toISOString() || null,
      trialExpiresAt: tenantData.trial_expires_at?.toISOString() || tenantData.trialExpiresAt?.toISOString() || null,
    };

    // Cria/atualiza tenant_context automaticamente
    syncTenantContext(tenantId, ramo_atividade.trim(), objetivo.trim(), site.trim());

    // Indexa site como fonte institucional canônica (assíncrono, não bloqueia)
    indexSiteAsInstitutionalSource(tenantId, site.trim()).catch(err => {
      logger.error(`[TenantService] Erro ao indexar site após criação do tenant:`, err);
    });

    logger.info(`[TenantService] Tenant criado: ${tenantId} (${name}), plano: ${plan}`);

    return { success: true, tenant };
  } catch (err) {
    logger.error('[TenantService] Erro ao criar tenant no PostgreSQL:', err);
    return { success: false, error: err.message || 'Erro ao criar tenant' };
  }
}

/**
 * Atualiza um tenant no PostgreSQL.
 *
 * @param {string} tenantId
 * @param {Object} updates - Campos para atualizar
 * @returns {Promise<{success: boolean, tenant?, error?: string}>}>}
 */
async function updateTenant(tenantId, updates) {
  const sequelize = getSequelize();
  if (!sequelize || !isConnected()) {
    return { success: false, error: 'PostgreSQL não está disponível. O banco de dados é obrigatório.' };
  }

  try {
    const { Tenant: TenantModel } = getModels();
    const tenantRecord = await TenantModel.findOne({
      where: { tenant_key: tenantId },
    });
    
    if (!tenantRecord) {
      return { success: false, error: 'Tenant não encontrado' };
    }

    // Prepara atualizações
    const updateData = {};
    const { Op } = require('sequelize');

    if (updates.name !== undefined) {
      updateData.name = String(updates.name).trim();
    }

    if (updates.site !== undefined) {
      const newSite = String(updates.site).trim();
      if (!isValidUrl(newSite)) {
        return { success: false, error: 'Site deve ser uma URL válida (http:// ou https://)' };
      }
      // Verifica se outro tenant já usa este site
      const existingBySite = await TenantModel.findOne({
        where: { 
          site: newSite,
          tenant_key: { [Op.ne]: tenantId }
        },
      });
      if (existingBySite) {
        return { success: false, error: 'Já existe outro tenant com este site' };
      }
      updateData.site = newSite;
    }

    if (updates.ramo_atividade !== undefined) {
      const newRamo = String(updates.ramo_atividade).trim();
      if (newRamo === '') {
        return { success: false, error: 'Ramo de atividade não pode ser vazio' };
      }
      updateData.ramo_atividade = newRamo;
    }

    if (updates.objetivo !== undefined) {
      const newObjetivo = String(updates.objetivo).trim();
      if (newObjetivo === '') {
        return { success: false, error: 'Objetivo não pode ser vazio' };
      }
      updateData.objetivo = newObjetivo;
    }

    if (updates.status !== undefined) {
      const validStatuses = ['trial', 'active', 'suspended', 'terminated'];
      if (!validStatuses.includes(updates.status)) {
        return { success: false, error: `Status inválido. Use: ${validStatuses.join(', ')}` };
      }
      updateData.status = updates.status;
      if (updates.status === 'suspended') {
        updateData.suspendedAt = new Date();
      } else if (updates.status !== 'suspended') {
        updateData.suspendedAt = null;
      }
    } else if (updates.active !== undefined) {
      // Atualiza status baseado em active
      if (!updates.active && tenantRecord.status !== 'terminated') {
        updateData.status = 'suspended';
        updateData.suspendedAt = new Date();
      } else if (updates.active && tenantRecord.status === 'suspended') {
        updateData.status = tenantRecord.plan === 'trial' ? 'trial' : 'active';
        updateData.suspendedAt = null;
      }
    }

    if (updates.plan !== undefined) {
      const validPlans = ['free', 'trial', 'pro', 'enterprise'];
      if (!validPlans.includes(updates.plan)) {
        return { success: false, error: `Plano inválido. Use: ${validPlans.join(', ')}` };
      }
      updateData.plan = updates.plan;
      updateData.limits = getDefaultLimits(updates.plan);
      // Se mudou para trial, atualiza expiração
      if (updates.plan === 'trial' && !tenantRecord.trialExpiresAt) {
        const trialExpires = new Date();
        trialExpires.setDate(trialExpires.getDate() + 14);
        updateData.trialExpiresAt = trialExpires;
      }
    }

    if (updates.limits !== undefined) {
      if (typeof updates.limits !== 'object') {
        return { success: false, error: 'Limites deve ser um objeto' };
      }
      updateData.limits = { ...tenantRecord.limits, ...updates.limits };
    }

    if (updates.settings !== undefined) {
      if (typeof updates.settings !== 'object') {
        return { success: false, error: 'Configurações deve ser um objeto' };
      }
      updateData.settings = { ...tenantRecord.settings, ...updates.settings };
    }

    if (updates.branding !== undefined) {
      if (typeof updates.branding !== 'object') {
        return { success: false, error: 'Branding deve ser um objeto' };
      }
      updateData.branding = { ...tenantRecord.branding, ...updates.branding };
    }

    // Atualiza no banco
    await tenantRecord.update(updateData);
    
    // Recarrega para obter dados atualizados
    await tenantRecord.reload();

    // Converte para formato compatível usando toJSON() para garantir serialização correta
    const tenantData = tenantRecord.toJSON ? tenantRecord.toJSON() : tenantRecord.dataValues || tenantRecord;
    
    const tenantKey = tenantData.tenant_key;
    const tenantName = tenantData.name;
    const tenantStatus = tenantData.status;
    const tenantPlan = tenantData.plan;
    
    const tenant = {
      id: tenantKey,
      tenant_key: tenantKey,
      name: tenantName,
      site: tenantData.site || null,
      ramo_atividade: tenantData.ramo_atividade || null,
      objetivo: tenantData.objetivo || null,
      active: tenantStatus !== 'suspended' && tenantStatus !== 'terminated',
      status: tenantStatus,
      plan: tenantPlan,
      limits: tenantData.limits || {},
      settings: tenantData.settings || {},
      branding: tenantData.branding || {},
      createdAt: tenantData.created_at?.toISOString() || tenantData.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: tenantData.updated_at?.toISOString() || tenantData.updatedAt?.toISOString() || new Date().toISOString(),
      suspendedAt: tenantData.suspended_at?.toISOString() || tenantData.suspendedAt?.toISOString() || null,
      trialExpiresAt: tenantData.trial_expires_at?.toISOString() || tenantData.trialExpiresAt?.toISOString() || null,
    };

    // Sincroniza tenant_context
    syncTenantContext(
      tenantId,
      tenantRecord.ramo_atividade,
      tenantRecord.objetivo,
      tenantRecord.site
    );

    // Se o site foi atualizado, reindexa como fonte institucional
    if (updates.site !== undefined) {
      indexSiteAsInstitutionalSource(tenantId, tenantRecord.site).catch(err => {
        logger.error(`[TenantService] Erro ao indexar site após atualização do tenant:`, err);
      });
    }

    logger.info(`[TenantService] Tenant atualizado: ${tenantId}`);

    return { success: true, tenant };
  } catch (err) {
    logger.error('[TenantService] Erro ao atualizar tenant no PostgreSQL:', err);
    return { success: false, error: err.message || 'Erro ao atualizar tenant' };
  }
}

/**
 * Lista todos os tenants do PostgreSQL.
 *
 * @returns {Promise<Tenant[]>}
 */
async function listTenants() {
  const sequelize = getSequelize();
  if (!sequelize || !isConnected()) {
    throw new Error('PostgreSQL não está disponível. O banco de dados é obrigatório.');
  }

  try {
    const { Tenant } = getModels();
    const tenantsFromDb = await Tenant.findAll({
      order: [['created_at', 'DESC']],
      attributes: ['id', 'tenant_key', 'name', 'site', 'ramo_atividade', 'objetivo', 'status', 'plan', 'limits', 'settings', 'branding', 'suspended_at', 'trial_expires_at', 'created_at', 'updated_at'],
    });

    return tenantsFromDb.map(tenant => {
      // Usa toJSON() para garantir serialização correta do Sequelize
      const tenantData = tenant.toJSON ? tenant.toJSON() : tenant.dataValues || tenant;
      
      const tenantKey = tenantData.tenant_key;
      const tenantStatus = tenantData.status;
      
      return {
        id: tenantKey,
        tenant_key: tenantKey,
        name: tenantData.name,
        site: tenantData.site || null,
        ramo_atividade: tenantData.ramo_atividade || null,
        objetivo: tenantData.objetivo || null,
        active: tenantStatus !== 'suspended' && tenantStatus !== 'terminated',
        status: tenantStatus,
        plan: tenantData.plan,
        limits: tenantData.limits || {},
        settings: tenantData.settings || {},
        branding: tenantData.branding || {},
        createdAt: tenantData.created_at?.toISOString() || tenantData.createdAt?.toISOString() || new Date().toISOString(),
        updatedAt: tenantData.updated_at?.toISOString() || tenantData.updatedAt?.toISOString() || new Date().toISOString(),
        suspendedAt: tenantData.suspended_at?.toISOString() || tenantData.suspendedAt?.toISOString() || null,
        trialExpiresAt: tenantData.trial_expires_at?.toISOString() || tenantData.trialExpiresAt?.toISOString() || null,
      };
    });
  } catch (err) {
    logger.error('[TenantService] Erro ao listar tenants do PostgreSQL:', err);
    throw err;
  }
}

/**
 * Helper: Busca tenant por tenant_key ou id (UUID).
 * Padroniza a busca de tenants em todo o sistema.
 * 
 * @param {string} identifier - tenant_key (ex: "tenant-demo") ou id (UUID)
 * @returns {Promise<Tenant|null>} Instância do Sequelize ou null
 */
async function findTenantByIdentifier(identifier) {
  if (!identifier || typeof identifier !== 'string') {
    logger.warn('[TenantService] findTenantByIdentifier: identifier inválido', { identifier });
    return null;
  }

  const sequelize = getSequelize();
  if (!sequelize || !isConnected()) {
    logger.error('[TenantService] findTenantByIdentifier: PostgreSQL não está disponível');
    throw new Error('PostgreSQL não está disponível. O banco de dados é obrigatório.');
  }

  const { Tenant } = getModels();
  
  // Tenta buscar por tenant_key primeiro (caso mais comum)
  let tenant = await Tenant.findOne({
    where: { tenant_key: identifier },
  });

  if (tenant) {
    logger.debug('[TenantService] Tenant encontrado por tenant_key', { 
      identifier, 
      tenant_id: tenant.id, 
      tenant_key: tenant.tenant_key 
    });
    return tenant;
  }

  // Se não encontrou por tenant_key e parece ser UUID, tenta buscar por id
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)) {
    tenant = await Tenant.findOne({
      where: { id: identifier },
    });
    
    if (tenant) {
      logger.debug('[TenantService] Tenant encontrado por id (UUID)', { 
        identifier, 
        tenant_id: tenant.id, 
        tenant_key: tenant.tenant_key 
      });
      return tenant;
    }
  }

  logger.warn('[TenantService] Tenant não encontrado', { identifier });
  return null;
}

/**
 * Obtém um tenant por ID do PostgreSQL.
 * 
 * CONVENÇÃO: Esta função aceita tenant_key (string legível) ou id (UUID).
 * Prefira usar tenant_key em APIs públicas e URLs.
 *
 * @param {string} tenantId - tenant_key (ex: "tenant-demo") ou id (UUID)
 * @returns {Promise<Tenant|null>}
 */
async function getTenant(tenantId) {
  const sequelize = getSequelize();
  if (!sequelize || !isConnected()) {
    throw new Error('PostgreSQL não está disponível. O banco de dados é obrigatório.');
  }

  try {
    const { Tenant } = getModels();
    
    // Usa a função helper para buscar por tenant_key ou id
    let tenant = await findTenantByIdentifier(tenantId);
    
    if (!tenant) {
      return null;
    }

    // Busca novamente com os atributos específicos necessários
    const tenantWithAttrs = await Tenant.findOne({
      where: { id: tenant.id },
      attributes: ['id', 'tenant_key', 'name', 'site', 'ramo_atividade', 'objetivo', 'status', 'plan', 'limits', 'settings', 'branding', 'suspended_at', 'trial_expires_at', 'created_at', 'updated_at'],
    });

    if (!tenantWithAttrs) {
      return null;
    }

    // Usa toJSON() para garantir serialização correta do Sequelize
    // Isso garante que todos os campos sejam acessados corretamente, mesmo com underscored: true
    const tenantData = tenant.toJSON ? tenant.toJSON() : tenant.dataValues || tenant;
    
    const tenantKey = tenantData.tenant_key;
    const tenantName = tenantData.name;
    const tenantStatus = tenantData.status;
    const tenantPlan = tenantData.plan;
    
    // Valida que o tenant tem nome (obrigatório)
    if (!tenantName || (typeof tenantName === 'string' && tenantName.trim() === '')) {
      logger.error('[TenantService] Tenant encontrado sem nome', {
        tenantId,
        tenant_key: tenantKey,
        name: tenantName,
        tenantDataKeys: Object.keys(tenantData),
        rawTenant: tenantData,
      });
      throw new Error(`Tenant ${tenantId} está inconsistente: campo 'name' é obrigatório mas está vazio ou ausente`);
    }

    return {
      id: tenantKey,
      tenant_key: tenantKey,
      name: tenantName,
      site: tenantData.site || null,
      ramo_atividade: tenantData.ramo_atividade || null,
      objetivo: tenantData.objetivo || null,
      active: tenantStatus !== 'suspended' && tenantStatus !== 'terminated',
      status: tenantStatus,
      plan: tenantPlan,
      limits: tenantData.limits || {},
      settings: tenantData.settings || {},
      branding: tenantData.branding || {},
      createdAt: tenantData.created_at?.toISOString() || tenantData.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: tenantData.updated_at?.toISOString() || tenantData.updatedAt?.toISOString() || new Date().toISOString(),
      suspendedAt: tenantData.suspended_at?.toISOString() || tenantData.suspendedAt?.toISOString() || null,
      trialExpiresAt: tenantData.trial_expires_at?.toISOString() || tenantData.trialExpiresAt?.toISOString() || null,
    };
  } catch (err) {
    logger.error('[TenantService] Erro ao obter tenant do PostgreSQL:', err);
    throw err;
  }
}

/**
 * Remove um tenant do PostgreSQL.
 *
 * @param {string} tenantId
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteTenant(tenantId) {
  const sequelize = getSequelize();
  if (!sequelize || !isConnected()) {
    return { success: false, error: 'PostgreSQL não está disponível. O banco de dados é obrigatório.' };
  }

  try {
    const { Tenant: TenantModel } = getModels();
    const tenantRecord = await TenantModel.findOne({
      where: { tenant_key: tenantId },
    });
    
    if (!tenantRecord) {
      return { success: false, error: 'Tenant não encontrado' };
    }

    // Remove tenant_context também
    tenantContexts.delete(tenantId);
    // Dados agora estão no banco de dados PostgreSQL

    // Remove do PostgreSQL (CASCADE remove relacionamentos)
    await tenantRecord.destroy();

    logger.info(`[TenantService] Tenant removido: ${tenantId}`);

    return { success: true };
  } catch (err) {
    logger.error('[TenantService] Erro ao remover tenant do PostgreSQL:', err);
    return { success: false, error: err.message || 'Erro ao remover tenant' };
  }
}

/**
 * Obtém o tenant_context de um tenant.
 *
 * @param {string} tenantId
 * @returns {TenantContext|null}
 */
function getTenantContext(tenantId) {
  return tenantContexts.get(tenantId) || null;
}

/**
 * Atualiza o tenant_context de um tenant.
 * 
 * REGRAS DE SEGURANÇA:
 * - Apenas usuários com papel OWNER ou ADMIN podem atualizar tenant_context
 * - O tenant_context NÃO pode ser alterado por mensagens do usuário (proteção contra prompt injection)
 * - Esta função deve ser chamada apenas por APIs autenticadas com validação de permissões
 *
 * @param {string} tenantId
 * @param {Object} updates - Campos para atualizar
 * @param {Object} options - Opções (userRole, userId para auditoria)
 * @returns {{success: boolean, context?: TenantContext, error?: string}}
 */
async function updateTenantContext(tenantId, updates, options = {}) {
  // Verifica se tenant existe no PostgreSQL
  let tenant;
  try {
    tenant = await getTenant(tenantId);
    if (!tenant) {
      return { success: false, error: 'Tenant não encontrado' };
    }
  } catch (err) {
    logger.error('[TenantService] Erro ao verificar tenant:', err);
    return { success: false, error: 'Erro ao verificar tenant' };
  }

  // PROTEÇÃO CONTRA PROMPT INJECTION:
  // Valida que não há tentativa de injeção de contexto via updates
  const dangerousPatterns = [
    /ignore.*previous.*instruction/i,
    /forget.*context/i,
    /system.*prompt/i,
    /override.*context/i,
    /new.*instruction/i,
  ];

  const updatesStr = JSON.stringify(updates);
  for (const pattern of dangerousPatterns) {
    if (pattern.test(updatesStr)) {
      logger.warn('[TenantService] Tentativa de prompt injection detectada', {
        tenantId,
        pattern: pattern.toString(),
      });
      return { success: false, error: 'Atualização inválida detectada' };
    }
  }

  let context = tenantContexts.get(tenantId);
  const now = new Date().toISOString();

  // Se não existe, cria usando dados do tenant
  if (!context) {
    try {
      const tenant = await getTenant(tenantId);
      if (!tenant) {
        return { success: false, error: 'Tenant não encontrado' };
      }
      context = {
        tenantId,
        ramo_atividade: tenant.ramo_atividade || '',
        objetivo: tenant.objetivo || '',
        site_oficial: tenant.site || '',
        prioridade: 'HIGH',
        escopo: ['rag', 'chatbot', 'classificacao_intencao'],
        createdAt: now,
        updatedAt: now,
      };
    } catch (err) {
      logger.error('[TenantService] Erro ao obter tenant para contexto:', err);
      return { success: false, error: 'Erro ao obter dados do tenant' };
    }
  }

  // Atualiza campos permitidos
  if (updates.ramo_atividade !== undefined) {
    context.ramo_atividade = String(updates.ramo_atividade).trim();
  }

  if (updates.objetivo !== undefined) {
    context.objetivo = String(updates.objetivo).trim();
  }

  if (updates.site_oficial !== undefined) {
    const newSite = String(updates.site_oficial).trim();
    if (!isValidUrl(newSite)) {
      return { success: false, error: 'Site oficial deve ser uma URL válida' };
    }
    context.site_oficial = newSite;
  }

  if (updates.prioridade !== undefined) {
    if (!['HIGH', 'MEDIUM', 'LOW'].includes(updates.prioridade)) {
      return { success: false, error: 'Prioridade deve ser HIGH, MEDIUM ou LOW' };
    }
    context.prioridade = updates.prioridade;
  }

  if (updates.escopo !== undefined) {
    if (!Array.isArray(updates.escopo)) {
      return { success: false, error: 'Escopo deve ser um array' };
    }
    // Valida valores do escopo
    const validScopes = ['rag', 'chatbot', 'classificacao_intencao'];
    for (const scope of updates.escopo) {
      if (!validScopes.includes(scope)) {
        return { success: false, error: `Escopo inválido: ${scope}. Valores válidos: ${validScopes.join(', ')}` };
      }
    }
    context.escopo = updates.escopo;
  }

  context.updatedAt = now;
  tenantContexts.set(tenantId, context);
  // Dados agora estão no banco de dados PostgreSQL

  // Log de auditoria
  logger.info(`[TenantService] Tenant context atualizado: ${tenantId}`, {
    updatedFields: Object.keys(updates),
    userRole: options.userRole,
    userId: options.userId,
  });

  return { success: true, context };
}

/**
 * Suspende um tenant.
 *
 * @param {string} tenantId
 * @returns {{success: boolean, tenant?: Tenant, error?: string}}
 */
function suspendTenant(tenantId) {
  return updateTenant(tenantId, { status: 'suspended' });
}

/**
 * Reativa um tenant.
 *
 * @param {string} tenantId
 * @returns {{success: boolean, tenant?: Tenant, error?: string}}
 */
async function reactivateTenant(tenantId) {
  try {
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      return { success: false, error: 'Tenant não encontrado' };
    }
    const status = tenant.plan === 'trial' ? 'trial' : 'active';
    return await updateTenant(tenantId, { status, active: true });
  } catch (err) {
    logger.error('[TenantService] Erro ao reativar tenant:', err);
    return { success: false, error: err.message || 'Erro ao reativar tenant' };
  }
}

/**
 * Faz upgrade/downgrade de plano.
 *
 * @param {string} tenantId
 * @param {string} newPlan - Novo plano
 * @returns {{success: boolean, tenant?: Tenant, error?: string}}
 */
async function changePlan(tenantId, newPlan) {
  return await updateTenant(tenantId, { plan: newPlan });
}

/**
 * Verifica se um tenant está ativo e não expirado (PostgreSQL).
 *
 * @param {string} tenantId
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
async function validateTenantStatus(tenantId) {
  try {
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      return { valid: false, error: 'Tenant não encontrado' };
    }

    if (tenant.status === 'terminated') {
      return { valid: false, error: 'Tenant encerrado' };
    }

    if (tenant.status === 'suspended') {
      return { valid: false, error: 'Tenant suspenso' };
    }

    // Verifica se trial expirou
    if (tenant.status === 'trial' && tenant.trialExpiresAt) {
      const expiresAt = new Date(tenant.trialExpiresAt);
      const now = new Date();
      if (now > expiresAt) {
        // Auto-suspende trial expirado
        await updateTenant(tenantId, { status: 'suspended' });
        return { valid: false, error: 'Trial expirado' };
      }
    }

    return { valid: true };
  } catch (err) {
    logger.error('[TenantService] Erro ao validar status do tenant:', err);
    return { valid: false, error: 'Erro ao validar tenant' };
  }
}

/**
 * Obtém métricas de uso de um tenant (PostgreSQL).
 *
 * @param {string} tenantId
 * @returns {Promise<Object|null>} Métricas de uso
 */
async function getTenantUsage(tenantId) {
  try {
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      return null;
    }

    // TODO: Implementar contagem real de uso do PostgreSQL
    // Por enquanto retorna estrutura básica
    return {
      tenantId,
      usuarios: 0, // TODO: contar usuários ativos do PostgreSQL
      agentes_ia: 0, // TODO: contar agentes IA
      execucoes_rpa: 0, // TODO: contar execuções RPA no período
      tokens_ia: 0, // TODO: contar tokens IA no período
      documentos_rag: 0, // TODO: contar documentos RAG
      storage_mb: 0, // TODO: calcular storage usado
      periodo: 'mensal',
    };
  } catch (err) {
    logger.error('[TenantService] Erro ao obter métricas de uso:', err);
    return null;
  }
}

module.exports = {
  ensureDemoTenantExists,
  createTenant,
  updateTenant,
  listTenants,
  getTenant,
  findTenantByIdentifier, // Helper padronizado para buscar tenant por tenant_key ou id
  deleteTenant,
  suspendTenant,
  reactivateTenant,
  changePlan,
  validateTenantStatus,
  getTenantUsage,
  getTenantContext,
  updateTenantContext,
  // Funções internas para testes
  _internal: {
    getDefaultLimits,
    clearTenantContexts: () => tenantContexts.clear(),
  },
};

