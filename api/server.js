/**
 * Servidor HTTP principal da API, consolidado em Express.
 *
 * Papel atual:
 * - expor factories de app/server para testes e runtime;
 * - montar o contexto central compartilhado do backend;
 * - delegar bootstrap e startup operacional para módulos de runtime.
 */

'use strict';

const express = require('express');
const http = require('http');
const config = require('./utils/config');
const { initializeAiProviders } = require('./services/aiProviderService');
const logger = require('./utils/logger');
const { createTenant, getTenant } = require('./services/tenantService');
const { startAutoCleanup } = require('./services/queueService');
const { clearLimitersCache } = require('../infra/rate-limit');
const outboundWorker = require('./services/outboundWorker');
const { createStartInitialization } = require('./bootstrap/startInitialization');
const { createInitializeSystemAdmin } = require('./bootstrap/systemAdminBootstrap');
const { startWorkers } = require('./runtime/startWorkers');
const { registerShutdownHooks } = require('./runtime/registerShutdownHooks');
const { detectProcessManager } = require('./runtime/processManager');
const { startServerRuntime } = require('./runtime/startServerRuntime');
const { createFlowRuntimeState } = require('./runtime/flowRuntimeState');
const { createBuildCoreRoutingContext } = require('./composition/core/buildCoreRoutingContext');
const { createBuildPlatformRoutingContext } = require('./composition/platform/buildPlatformRoutingContext');
const { createBuildExtendedRoutingContext } = require('./composition/extended/buildExtendedRoutingContext');
const { requireTenant } = require('./composition/shared/requireTenant');
const {
  parseJsonBody,
  sendJson,
  badRequest,
  notFound,
} = require('./express/httpHelpers');
const { registerRoutes } = require('./app/registerRoutes');
const { applyGlobalMiddlewares } = require('./app/applyMiddlewares');
const queueDefinitionService = require('./services/queueDefinitionService');
const closeReasonsService = require('./services/closeReasonsService');
const flowTemplateMarketplaceService = require('./services/flowTemplateMarketplaceService');
const { startAutoReturnToBot } = require('./services/handoverService');
const { startAssignmentWorker } = require('./services/assignmentService');
const { initializeWebSocket } = require('./services/websocketService');

const port = Number(config.get('api.port', 3000));

function parseBooleanEnv(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return defaultValue;
}

// Segurança por padrão: modo estrito (auth + tenant obrigatórios) é o default
// em TODOS os ambientes. O modo legado sem auth é opt-in explícito via
// STRICT_TENANT_MODE=false (apenas desenvolvimento local controlado).
const STRICT_TENANT_MODE = parseBooleanEnv(
  process.env.STRICT_TENANT_MODE,
  true
);

function ensureRequestTracing(req) {
  if (!req.id && req.headers && req.headers['x-request-id']) {
    req.id = String(req.headers['x-request-id']).trim() || undefined;
  }
}

const runtimeState = createFlowRuntimeState({ logger });

const buildCoreRoutingContext = createBuildCoreRoutingContext({
  validateFlowStructure: runtimeState.validateFlowStructure,
  ensureFlowHasMeta: runtimeState.ensureFlowHasMeta,
  flows: runtimeState.flows,
  persistFlowBestEffort: runtimeState.persistFlowBestEffort,
  deleteFlowBestEffort: runtimeState.deleteFlowBestEffort,
  sessionEvents: runtimeState.sessionEvents,
  sessionTenants: runtimeState.sessionTenants,
  saveSessionEventsToFile: runtimeState.saveSessionEventsToFile,
  strictTenantMode: STRICT_TENANT_MODE,
});

const buildPlatformRoutingContext = createBuildPlatformRoutingContext({
  requireTenant,
  validateFlowStructure: runtimeState.validateFlowStructure,
  ensureFlowHasMeta: runtimeState.ensureFlowHasMeta,
  persistFlowBestEffort: runtimeState.persistFlowBestEffort,
  flows: runtimeState.flows,
  detectProcessManager,
});

const buildExtendedRoutingContext = createBuildExtendedRoutingContext({
  requireTenant,
  flows: runtimeState.flows,
  sessionEvents: runtimeState.sessionEvents,
  sessionTenants: runtimeState.sessionTenants,
  saveSessionEventsToFile: runtimeState.saveSessionEventsToFile,
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

function createServer() {
  const app = getOrCreateExpressApp();
  const server = http.createServer(app);
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

const initializeSystemAdmin = createInitializeSystemAdmin({
  logger,
  createTenant,
  getTenant,
});

const startInitialization = createStartInitialization({
  logger,
  initializeSystemAdmin,
  loadFlowsFromDb: runtimeState.loadFlowsFromDb,
  queueDefinitionService,
  closeReasonsService,
  flowTemplateMarketplaceService,
  initializeAiProviders,
});

registerShutdownHooks({
  logger,
  outboundWorker,
  saveSessionEventsToFileImmediate: runtimeState.saveSessionEventsToFileImmediate,
  processRef: process,
});

if (require.main === module) {
  const ticketCleanupIntervalHours = Number(config.get('api.ticketCleanup.intervalHours', 1));
  const ticketMaxAgeDays = Number(config.get('api.ticketCleanup.maxAgeDays', 7));

  startServerRuntime({
    logger,
    clearLimitersCache,
    startInitialization,
    getOrCreateServer,
    port,
    startWorkers,
    workerDeps: {
      logger,
      outboundWorker,
      startAutoCleanup,
      ticketCleanupIntervalHours,
      ticketMaxAgeDays,
      startAutoReturnToBot,
      startAssignmentWorker,
      processRef: process,
    },
    processRef: process,
  });
}

module.exports = {
  createExpressApp,
  createServer,
  getOrCreateServer,
  _internal: {
    parseJsonBody,
    sendJson,
    notFound,
    badRequest,
    ensureFlowHasMeta: runtimeState.ensureFlowHasMeta,
    validateFlowStructure: runtimeState.validateFlowStructure,
    flows: runtimeState.flows,
    sessionEvents: runtimeState.sessionEvents,
    sessionTenants: runtimeState.sessionTenants,
  },
};
