/**
 * Serviço de gerenciamento de Tenants.
 *
 * Responsabilidades:
 * - Gerenciar tenants (criar, listar, atualizar)
 * - Gerenciar tenant_context (contexto cognitivo do tenant)
 * - Persistência em JSON
 * - Validação de schema
 *
 * Persistência:
 * - Tenants: api/data/tenants.json
 * - Tenant Contexts: api/data/tenant_contexts.json
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../utils/config');
const webScrapingService = require('./webScrapingService');
const ragDocumentsService = require('./ragDocumentsService');

/**
 * @typedef {Object} Tenant
 * @property {string} id - ID único do tenant
 * @property {string} name - Nome do tenant/cliente
 * @property {string} site - URL oficial do cliente (obrigatório)
 * @property {string} ramo_atividade - Descrição textual do segmento de negócio (obrigatório)
 * @property {string} objetivo - Objetivo estratégico do cliente com o uso da plataforma (obrigatório)
 * @property {boolean} active - Se o tenant está ativo
 * @property {string} createdAt - Data de criação (ISO string)
 * @property {string} updatedAt - Data da última atualização (ISO string)
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

// Armazenamento em memória
/** @type {Map<string, Tenant>} */
const tenants = new Map();

/** @type {Map<string, TenantContext>} */
const tenantContexts = new Map();

// Caminhos dos arquivos de persistência
const dataDir = path.join(__dirname, '..', 'data');
const tenantsFile = path.join(dataDir, 'tenants.json');
const tenantContextsFile = path.join(dataDir, 'tenant_contexts.json');

/**
 * Garante que o diretório de dados existe.
 */
function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
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
 * Salva tenants no arquivo JSON.
 */
function saveTenantsToFile() {
  try {
    ensureDataDir();
    const tenantsArray = Array.from(tenants.values());
    const data = JSON.stringify(tenantsArray, null, 2);
    fs.writeFileSync(tenantsFile, data, 'utf8');
    logger.debug(`[TenantService] Tenants salvos: ${tenantsArray.length} tenant(s)`);
  } catch (err) {
    logger.error('[TenantService] Erro ao salvar tenants:', err);
  }
}

/**
 * Carrega tenants do arquivo JSON.
 */
function loadTenantsFromFile() {
  try {
    ensureDataDir();
    if (!fs.existsSync(tenantsFile)) {
      logger.info(`[TenantService] Arquivo de tenants não encontrado: ${tenantsFile}. Iniciando com dados vazios.`);
      return;
    }

    const data = fs.readFileSync(tenantsFile, 'utf8');
    const tenantsArray = JSON.parse(data);

    if (Array.isArray(tenantsArray)) {
      tenants.clear();
      for (const tenant of tenantsArray) {
        if (tenant && tenant.id) {
          tenants.set(tenant.id, tenant);
        }
      }
      logger.info(`[TenantService] Tenants carregados: ${tenants.size} tenant(s)`);
    }
  } catch (err) {
    logger.error('[TenantService] Erro ao carregar tenants:', err);
  }
}

/**
 * Salva tenant contexts no arquivo JSON.
 */
function saveTenantContextsToFile() {
  try {
    ensureDataDir();
    const contextsArray = Array.from(tenantContexts.values());
    const data = JSON.stringify(contextsArray, null, 2);
    fs.writeFileSync(tenantContextsFile, data, 'utf8');
    logger.debug(`[TenantService] Tenant contexts salvos: ${contextsArray.length} contexto(s)`);
  } catch (err) {
    logger.error('[TenantService] Erro ao salvar tenant contexts:', err);
  }
}

/**
 * Carrega tenant contexts do arquivo JSON.
 */
function loadTenantContextsFromFile() {
  try {
    ensureDataDir();
    if (!fs.existsSync(tenantContextsFile)) {
      logger.info(`[TenantService] Arquivo de tenant contexts não encontrado: ${tenantContextsFile}. Iniciando com dados vazios.`);
      return;
    }

    const data = fs.readFileSync(tenantContextsFile, 'utf8');
    const contextsArray = JSON.parse(data);

    if (Array.isArray(contextsArray)) {
      tenantContexts.clear();
      for (const context of contextsArray) {
        if (context && context.tenantId) {
          tenantContexts.set(context.tenantId, context);
        }
      }
      logger.info(`[TenantService] Tenant contexts carregados: ${tenantContexts.size} contexto(s)`);
    }
  } catch (err) {
    logger.error('[TenantService] Erro ao carregar tenant contexts:', err);
  }
}

// Carrega dados ao iniciar o módulo
loadTenantsFromFile();
loadTenantContextsFromFile();

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
  saveTenantContextsToFile();

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
    const existingDocs = ragDocumentsService.listDocuments({
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
      const updateResult = await ragDocumentsService.updateDocument(scrapeResult.documentId, {
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
 * @returns {{success: boolean, tenant?: Tenant, error?: string}}
 */
function createTenant({ name, site, ramo_atividade, objetivo }) {
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

  // Verifica se já existe tenant com mesmo site
  for (const tenant of tenants.values()) {
    if (tenant.site.toLowerCase() === site.trim().toLowerCase()) {
      return { success: false, error: 'Já existe um tenant com este site' };
    }
  }

  // Cria tenant
  const now = new Date().toISOString();
  const id = `tenant-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const tenant = {
    id,
    name: name.trim(),
    site: site.trim(),
    ramo_atividade: ramo_atividade.trim(),
    objetivo: objetivo.trim(),
    active: true,
    createdAt: now,
    updatedAt: now,
  };

  tenants.set(id, tenant);
  saveTenantsToFile();

  // Cria/atualiza tenant_context automaticamente
  syncTenantContext(id, ramo_atividade.trim(), objetivo.trim(), site.trim());

  // Indexa site como fonte institucional canônica (assíncrono, não bloqueia)
  indexSiteAsInstitutionalSource(id, site.trim()).catch(err => {
    logger.error(`[TenantService] Erro ao indexar site após criação do tenant:`, err);
  });

  logger.info(`[TenantService] Tenant criado: ${id} (${name})`);

  return { success: true, tenant };
}

/**
 * Atualiza um tenant.
 *
 * @param {string} tenantId
 * @param {Object} updates - Campos para atualizar
 * @returns {{success: boolean, tenant?: Tenant, error?: string}}
 */
function updateTenant(tenantId, updates) {
  const tenant = tenants.get(tenantId);
  if (!tenant) {
    return { success: false, error: 'Tenant não encontrado' };
  }

  // Atualiza campos permitidos
  if (updates.name !== undefined) {
    tenant.name = String(updates.name).trim();
  }

  if (updates.site !== undefined) {
    const newSite = String(updates.site).trim();
    if (!isValidUrl(newSite)) {
      return { success: false, error: 'Site deve ser uma URL válida (http:// ou https://)' };
    }
    // Verifica se outro tenant já usa este site
    for (const t of tenants.values()) {
      if (t.id !== tenantId && t.site.toLowerCase() === newSite.toLowerCase()) {
        return { success: false, error: 'Já existe outro tenant com este site' };
      }
    }
    tenant.site = newSite;
  }

  if (updates.ramo_atividade !== undefined) {
    const newRamo = String(updates.ramo_atividade).trim();
    if (newRamo === '') {
      return { success: false, error: 'Ramo de atividade não pode ser vazio' };
    }
    tenant.ramo_atividade = newRamo;
  }

  if (updates.objetivo !== undefined) {
    const newObjetivo = String(updates.objetivo).trim();
    if (newObjetivo === '') {
      return { success: false, error: 'Objetivo não pode ser vazio' };
    }
    tenant.objetivo = newObjetivo;
  }

  if (updates.active !== undefined) {
    tenant.active = Boolean(updates.active);
  }

  tenant.updatedAt = new Date().toISOString();
  saveTenantsToFile();

  // Sincroniza tenant_context
  syncTenantContext(
    tenantId,
    tenant.ramo_atividade,
    tenant.objetivo,
    tenant.site
  );

  // Se o site foi atualizado, reindexa como fonte institucional
  if (updates.site !== undefined) {
    indexSiteAsInstitutionalSource(tenantId, tenant.site).catch(err => {
      logger.error(`[TenantService] Erro ao indexar site após atualização do tenant:`, err);
    });
  }

  logger.info(`[TenantService] Tenant atualizado: ${tenantId}`);

  return { success: true, tenant };
}

/**
 * Lista todos os tenants.
 *
 * @returns {Tenant[]}
 */
function listTenants() {
  return Array.from(tenants.values());
}

/**
 * Obtém um tenant por ID.
 *
 * @param {string} tenantId
 * @returns {Tenant|null}
 */
function getTenant(tenantId) {
  return tenants.get(tenantId) || null;
}

/**
 * Remove um tenant.
 *
 * @param {string} tenantId
 * @returns {{success: boolean, error?: string}}
 */
function deleteTenant(tenantId) {
  const tenant = tenants.get(tenantId);
  if (!tenant) {
    return { success: false, error: 'Tenant não encontrado' };
  }

  // Remove tenant_context também
  tenantContexts.delete(tenantId);
  saveTenantContextsToFile();

  tenants.delete(tenantId);
  saveTenantsToFile();

  logger.info(`[TenantService] Tenant removido: ${tenantId}`);

  return { success: true };
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
function updateTenantContext(tenantId, updates, options = {}) {
  // Verifica se tenant existe
  if (!tenants.has(tenantId)) {
    return { success: false, error: 'Tenant não encontrado' };
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

  // Se não existe, cria
  if (!context) {
    const tenant = tenants.get(tenantId);
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
  saveTenantContextsToFile();

  // Log de auditoria
  logger.info(`[TenantService] Tenant context atualizado: ${tenantId}`, {
    updatedFields: Object.keys(updates),
    userRole: options.userRole,
    userId: options.userId,
  });

  return { success: true, context };
}

module.exports = {
  createTenant,
  updateTenant,
  listTenants,
  getTenant,
  deleteTenant,
  getTenantContext,
  updateTenantContext,
  // Funções internas para testes
  _internal: {
    saveTenantsToFile,
    loadTenantsFromFile,
    saveTenantContextsToFile,
    loadTenantContextsFromFile,
  },
};

