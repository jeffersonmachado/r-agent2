'use strict';

function createProviderRegistrar({
  logger,
  initializeSystemAdmin,
  initializeAiProviders,
  validatePushStartupConfig,
  validateWebPushStartupConfig,
  loadFlowsFromDb,
  flowTemplateMarketplaceService,
  queueDefinitionService,
  closeReasonsService,
}) {
  let initializationPromise = null;

  async function startInitialization() {
    if (initializationPromise) {
      return initializationPromise;
    }

    initializationPromise = (async () => {
      console.log('[Init] Iniciando inicialização automática...');
      logger.info('[Init] Iniciando inicialização automática...');

      await new Promise((resolve) => setTimeout(resolve, 500));

      console.log('[Init] Conectando ao PostgreSQL...');
      logger.info('[Init] Conectando ao PostgreSQL...');

      try {
        const { connect } = require('../db/sequelize');
        await connect(30, 1000);
        console.log('[Init] ✅ PostgreSQL conectado (Sequelize)');
        logger.info('[Init] ✅ PostgreSQL conectado (Sequelize)');
      } catch (dbErr) {
        const error = `Falha ao conectar ao PostgreSQL: ${dbErr.message}`;
        console.error(`[Init] ❌ ${error}`);
        logger.error(`[Init] ❌ ${error}`);
        throw new Error(error);
      }

      try {
        console.log('[Init] Executando migrations Sequelize...');
        logger.info('[Init] Executando migrations Sequelize...');
        const { runMigrations } = require('../db/migrate');
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
        console.log('[Init] Executando seed...');
        logger.info('[Init] Executando seed...');
        const { runSeed } = require('../db/seed');
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
        const { defineRelationships } = require('../db/models');
        defineRelationships();
        console.log('[Init] ✅ Relacionamentos definidos');
        logger.info('[Init] ✅ Relacionamentos definidos');
      } catch (relErr) {
        console.warn('[Init] ⚠️  Aviso ao definir relacionamentos:', relErr.message);
        logger.warn('[Init] ⚠️  Aviso ao definir relacionamentos:', relErr.message);
      }

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

      try {
        const { initializeTenantContexts } = require('../services/tenantService');
        await initializeTenantContexts();
        console.log('[Init] ✅ Tenant contexts inicializados');
        logger.info('[Init] ✅ Tenant contexts inicializados');
      } catch (ctxErr) {
        console.warn('[Init] ⚠️  Aviso ao inicializar tenant contexts:', ctxErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar tenant contexts:', ctxErr.message);
      }

      try {
        await loadFlowsFromDb();
        console.log('[Init] ✅ Fluxos carregados');
        logger.info('[Init] ✅ Fluxos carregados');
      } catch (flowInitErr) {
        console.warn('[Init] ⚠️  Aviso ao carregar fluxos:', flowInitErr.message);
        logger.warn('[Init] ⚠️  Aviso ao carregar fluxos:', flowInitErr.message);
      }

      try {
        const { initialize: initializeAuthService } = require('../services/authService');
        await initializeAuthService();
        console.log('[Init] ✅ AuthService inicializado');
        logger.info('[Init] ✅ AuthService inicializado');
      } catch (authInitErr) {
        const error = `Falha ao inicializar AuthService: ${authInitErr.message}`;
        console.error(`[Init] ❌ ${error}`);
        logger.error(`[Init] ❌ ${error}`);
        throw new Error(error);
      }

      try {
        const { initialize: initializeQueueService } = require('../services/queueService');
        await initializeQueueService();
        console.log('[Init] ✅ QueueService inicializado');
        logger.info('[Init] ✅ QueueService inicializado');
      } catch (queueInitErr) {
        console.warn('[Init] ⚠️  Aviso ao inicializar QueueService:', queueInitErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar QueueService:', queueInitErr.message);
      }

      try {
        const { initialize: initializeDepartments } = require('../services/departmentsService');
        await initializeDepartments();
        console.log('[Init] ✅ DepartmentsService inicializado');
        logger.info('[Init] ✅ DepartmentsService inicializado');
      } catch (deptErr) {
        console.warn('[Init] ⚠️  Aviso ao inicializar DepartmentsService:', deptErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar DepartmentsService:', deptErr.message);
      }

      try {
        await queueDefinitionService.initialize();
        console.log('[Init] ✅ QueueDefinitionService inicializado');
        logger.info('[Init] ✅ QueueDefinitionService inicializado');
      } catch (qDefErr) {
        console.warn('[Init] ⚠️  Aviso ao inicializar QueueDefinitionService:', qDefErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar QueueDefinitionService:', qDefErr.message);
      }

      try {
        const { initialize: initializeQuickReplies } = require('../services/quickRepliesService');
        await initializeQuickReplies();
        console.log('[Init] ✅ QuickRepliesService inicializado');
        logger.info('[Init] ✅ QuickRepliesService inicializado');
      } catch (qrErr) {
        console.warn('[Init] ⚠️  Aviso ao inicializar QuickRepliesService:', qrErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar QuickRepliesService:', qrErr.message);
      }

      try {
        await closeReasonsService.initialize();
        console.log('[Init] ✅ CloseReasonsService inicializado');
        logger.info('[Init] ✅ CloseReasonsService inicializado');
      } catch (crErr) {
        console.warn('[Init] ⚠️  Aviso ao inicializar CloseReasonsService:', crErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar CloseReasonsService:', crErr.message);
      }

      try {
        await flowTemplateMarketplaceService.initialize();
        console.log('[Init] ✅ FlowTemplateMarketplaceService inicializado');
        logger.info('[Init] ✅ FlowTemplateMarketplaceService inicializado');
      } catch (ftErr) {
        console.warn('[Init] ⚠️  Aviso ao inicializar FlowTemplateMarketplaceService:', ftErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar FlowTemplateMarketplaceService:', ftErr.message);
      }

      try {
        const { initialize: initializeWebhooks } = require('../services/webhookService');
        await initializeWebhooks();
        console.log('[Init] ✅ WebhookService inicializado');
        logger.info('[Init] ✅ WebhookService inicializado');
      } catch (whErr) {
        console.warn('[Init] ⚠️  Aviso ao inicializar WebhookService:', whErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar WebhookService:', whErr.message);
      }

      try {
        const { initialize: initializeRagDocuments } = require('../services/ragDocumentsService');
        await initializeRagDocuments();
        console.log('[Init] ✅ RAGDocumentsService inicializado');
        logger.info('[Init] ✅ RAGDocumentsService inicializado');
      } catch (ragDocsErr) {
        console.warn('[Init] ⚠️  Aviso ao inicializar RAGDocumentsService:', ragDocsErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar RAGDocumentsService:', ragDocsErr.message);
      }

      try {
        console.log('[Init] Inicializando providers de IA do banco de dados...');
        logger.info('[Init] Inicializando providers de IA do banco de dados...');
        await initializeAiProviders();
        console.log('[Init] ✅ Providers de IA inicializados');
        logger.info('[Init] ✅ Providers de IA inicializados');
      } catch (aiErr) {
        console.warn(`[Init] ⚠️  Aviso ao inicializar providers de IA: ${aiErr.message}`);
        logger.warn(`[Init] ⚠️  Aviso ao inicializar providers de IA: ${aiErr.message}`);
      }

      try {
        validatePushStartupConfig();
        console.log('[Init] ✅ Push config validada');
        logger.info('[Init] ✅ Push config validada');
      } catch (pushCfgErr) {
        const error = `Falha ao validar PUSH config: ${pushCfgErr.message}`;
        console.error(`[Init] ❌ ${error}`);
        logger.error(`[Init] ❌ ${error}`);
        throw new Error(error);
      }

      try {
        validateWebPushStartupConfig();
        console.log('[Init] ✅ Web Push config validada');
        logger.info('[Init] ✅ Web Push config validada');
      } catch (webPushCfgErr) {
        const error = `Falha ao validar WEB PUSH config: ${webPushCfgErr.message}`;
        console.error(`[Init] ❌ ${error}`);
        logger.error(`[Init] ❌ ${error}`);
        throw new Error(error);
      }
    })();

    return initializationPromise;
  }

  return {
    startInitialization,
  };
}

module.exports = {
  createProviderRegistrar,
};
