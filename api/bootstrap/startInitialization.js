'use strict';

const logger = require('../utils/logger');

function createStartInitialization({
  logger,
  initializeSystemAdmin,
  loadFlowsFromDb,
  queueDefinitionService,
  closeReasonsService,
  flowTemplateMarketplaceService,
  initializeAiProviders,
}) {
  let initializationPromise = null;

  return async function startInitialization() {
    if (initializationPromise) {
      return initializationPromise;
    }

    initializationPromise = (async () => {
      logger.info('[Init] Iniciando inicialização automática...');
      logger.info('[Init] Iniciando inicialização automática...');

      // Aguarda um pouco para garantir que todos os módulos foram carregados.
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Inicializa banco de dados PostgreSQL (OBRIGATÓRIO).
      logger.info('[Init] Conectando ao PostgreSQL...');
      logger.info('[Init] Conectando ao PostgreSQL...');

      try {
        // Inicializa conexão Sequelize com retry.
        // Usa config.js como fonte principal (config.json > env vars).
        const { connect } = require('../db/sequelize');
        await connect(30, 1000);
        logger.info('[Init] ✅ PostgreSQL conectado (Sequelize)');
        logger.info('[Init] ✅ PostgreSQL conectado (Sequelize)');
      } catch (dbErr) {
        const error = `Falha ao conectar ao PostgreSQL: ${dbErr.message}`;
        logger.error(`[Init] ❌ ${error}`);
        logger.error(`[Init] ❌ ${error}`);
        throw new Error(error);
      }

      try {
        // Executa migrations Sequelize.
        logger.info('[Init] Executando migrations Sequelize...');
        logger.info('[Init] Executando migrations Sequelize...');
        const { runMigrations } = require('../db/migrate');
        await runMigrations();
        logger.info('[Init] ✅ Migrations concluídas');
        logger.info('[Init] ✅ Migrations concluídas');
      } catch (migrationErr) {
        const error = `Falha ao executar migrations: ${migrationErr.message}`;
        logger.error(`[Init] ❌ ${error}`);
        logger.error(`[Init] ❌ ${error}`);
        throw new Error(error);
      }

      try {
        // Executa seed.
        logger.info('[Init] Executando seed...');
        logger.info('[Init] Executando seed...');
        const { runSeed } = require('../db/seed');
        await runSeed();
        logger.info('[Init] ✅ Seed concluído');
        logger.info('[Init] ✅ Seed concluído');
      } catch (seedErr) {
        const error = `Falha ao executar seed: ${seedErr.message}`;
        logger.error(`[Init] ❌ ${error}`);
        logger.error(`[Init] ❌ ${error}`);
        throw new Error(error);
      }

      try {
        // Define relacionamentos dos models.
        const { defineRelationships } = require('../db/models');
        defineRelationships();
        logger.info('[Init] ✅ Relacionamentos definidos');
        logger.info('[Init] ✅ Relacionamentos definidos');
      } catch (relErr) {
        logger.warn('[Init] ⚠️  Aviso ao definir relacionamentos:', relErr.message);
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
        logger.warn('[Init] ⚠️  Aviso ao inicializar systemadmin (ignorado):', sysAdminErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar systemadmin (ignorado):', sysAdminErr.message);
      }

      // Blindagem produção: não cria/seed de tenant automaticamente (multi-tenant obrigatório).

      // Inicializa tenant_contexts (best-effort).
      try {
        const { initializeTenantContexts } = require('../services/tenantService');
        await initializeTenantContexts();
        logger.info('[Init] ✅ Tenant contexts inicializados');
        logger.info('[Init] ✅ Tenant contexts inicializados');
      } catch (ctxErr) {
        logger.warn('[Init] ⚠️  Aviso ao inicializar tenant contexts:', ctxErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar tenant contexts:', ctxErr.message);
      }

      // Carrega fluxos persistidos no PostgreSQL (best-effort).
      try {
        await loadFlowsFromDb();
        logger.info('[Init] ✅ Fluxos carregados');
        logger.info('[Init] ✅ Fluxos carregados');
      } catch (flowInitErr) {
        logger.warn('[Init] ⚠️  Aviso ao carregar fluxos:', flowInitErr.message);
        logger.warn('[Init] ⚠️  Aviso ao carregar fluxos:', flowInitErr.message);
      }

      try {
        // Inicializa cache do AuthService (necessário para validateToken síncrono).
        const { initialize: initializeAuthService } = require('../services/authService');
        await initializeAuthService();
        logger.info('[Init] ✅ AuthService inicializado');
        logger.info('[Init] ✅ AuthService inicializado');
      } catch (authInitErr) {
        const error = `Falha ao inicializar AuthService: ${authInitErr.message}`;
        logger.error(`[Init] ❌ ${error}`);
        logger.error(`[Init] ❌ ${error}`);
        throw new Error(error);
      }

      // Inicializa cache de tickets/queues (best-effort).
      try {
        const { initialize: initializeQueueService } = require('../services/queueService');
        await initializeQueueService();
        logger.info('[Init] ✅ QueueService inicializado');
        logger.info('[Init] ✅ QueueService inicializado');
      } catch (queueInitErr) {
        logger.warn('[Init] ⚠️  Aviso ao inicializar QueueService:', queueInitErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar QueueService:', queueInitErr.message);
      }

      // Inicializa caches DB-only (best-effort): departments, quick replies, webhooks, rag documents.
      try {
        const { initialize: initializeDepartments } = require('../services/departmentsService');
        await initializeDepartments();
        logger.info('[Init] ✅ DepartmentsService inicializado');
        logger.info('[Init] ✅ DepartmentsService inicializado');
      } catch (deptErr) {
        logger.warn('[Init] ⚠️  Aviso ao inicializar DepartmentsService:', deptErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar DepartmentsService:', deptErr.message);
      }

      // Inicializa cache de definições de filas (best-effort).
      try {
        await queueDefinitionService.initialize();
        logger.info('[Init] ✅ QueueDefinitionService inicializado');
        logger.info('[Init] ✅ QueueDefinitionService inicializado');
      } catch (qDefErr) {
        logger.warn('[Init] ⚠️  Aviso ao inicializar QueueDefinitionService:', qDefErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar QueueDefinitionService:', qDefErr.message);
      }

      try {
        const { initialize: initializeQuickReplies } = require('../services/quickRepliesService');
        await initializeQuickReplies();
        logger.info('[Init] ✅ QuickRepliesService inicializado');
        logger.info('[Init] ✅ QuickRepliesService inicializado');
      } catch (qrErr) {
        logger.warn('[Init] ⚠️  Aviso ao inicializar QuickRepliesService:', qrErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar QuickRepliesService:', qrErr.message);
      }

      // Inicializa close reasons (best-effort).
      try {
        await closeReasonsService.initialize();
        logger.info('[Init] ✅ CloseReasonsService inicializado');
        logger.info('[Init] ✅ CloseReasonsService inicializado');
      } catch (crErr) {
        logger.warn('[Init] ⚠️  Aviso ao inicializar CloseReasonsService:', crErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar CloseReasonsService:', crErr.message);
      }

      // Inicializa marketplace de templates de fluxo (best-effort).
      try {
        await flowTemplateMarketplaceService.initialize();
        logger.info('[Init] ✅ FlowTemplateMarketplaceService inicializado');
        logger.info('[Init] ✅ FlowTemplateMarketplaceService inicializado');
      } catch (ftErr) {
        logger.warn('[Init] ⚠️  Aviso ao inicializar FlowTemplateMarketplaceService:', ftErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar FlowTemplateMarketplaceService:', ftErr.message);
      }

      try {
        const { initialize: initializeWebhooks } = require('../services/webhookService');
        await initializeWebhooks();
        logger.info('[Init] ✅ WebhookService inicializado');
        logger.info('[Init] ✅ WebhookService inicializado');
      } catch (whErr) {
        logger.warn('[Init] ⚠️  Aviso ao inicializar WebhookService:', whErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar WebhookService:', whErr.message);
      }

      try {
        const { initialize: initializeRagDocuments } = require('../services/ragDocumentsService');
        await initializeRagDocuments();
        logger.info('[Init] ✅ RAGDocumentsService inicializado');
        logger.info('[Init] ✅ RAGDocumentsService inicializado');
      } catch (ragDocsErr) {
        logger.warn('[Init] ⚠️  Aviso ao inicializar RAGDocumentsService:', ragDocsErr.message);
        logger.warn('[Init] ⚠️  Aviso ao inicializar RAGDocumentsService:', ragDocsErr.message);
      }

      // Inicializa providers de IA do banco de dados (após banco estar conectado).
      try {
        logger.info('[Init] Inicializando providers de IA do banco de dados...');
        logger.info('[Init] Inicializando providers de IA do banco de dados...');
        await initializeAiProviders();
        logger.info('[Init] ✅ Providers de IA inicializados');
        logger.info('[Init] ✅ Providers de IA inicializados');
      } catch (aiErr) {
        // Não falha a inicialização se houver erro nos providers.
        logger.warn(`[Init] ⚠️  Aviso ao inicializar providers de IA: ${aiErr.message}`);
        logger.warn(`[Init] ⚠️  Aviso ao inicializar providers de IA: ${aiErr.message}`);
      }
    })();

    return initializationPromise;
  };
}

module.exports = {
  createStartInitialization,
};
