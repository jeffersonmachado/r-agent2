'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');
const { createConfigRoutes } = require('../config/routes');
const { createQueueRoutes } = require('../queue/routes');
const { handleChannelAccountRoutes } = require('../../serverHandlers/channelAccountRoutes');
const { handleDepartmentRoutes } = require('../../serverHandlers/departmentRoutes');
const { handleExportRoutes } = require('../../serverHandlers/exportRoutes');
const { handleSegmentationRoutes } = require('../../serverHandlers/segmentationRoutes');
const { handleConfigAdminRoutes } = require('../../serverHandlers/configAdminRoutes');

function createPlatformAdminRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: handleChannelAccountRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
      };
    },
  });

  mountExpressHandler(router, {
    handler: handleDepartmentRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requireTenant: ctx.requireTenant,
        requirePermission: ctx.requirePermission,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
        logAction: ctx.logAction,
        listDepartments: ctx.listDepartments,
        getDepartment: ctx.getDepartment,
        createDepartment: ctx.createDepartment,
        updateDepartment: ctx.updateDepartment,
        deleteDepartment: ctx.deleteDepartment,
        addAgentToDepartment: ctx.addAgentToDepartment,
        removeAgentFromDepartment: ctx.removeAgentFromDepartment,
      };
    },
  });

  mountExpressHandler(router, {
    handler: handleExportRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        requireTenant: ctx.requireTenant,
        sendJson: ctx.sendJson,
        logger: ctx.logger,
        exportTicketsCSV: ctx.exportTicketsCSV,
        exportMetricsCSV: ctx.exportMetricsCSV,
        exportConversationsJSON: ctx.exportConversationsJSON,
        exportFullReportJSON: ctx.exportFullReportJSON,
      };
    },
  });

  mountExpressHandler(router, {
    handler: handleSegmentationRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
        getAllTags: ctx.getAllTags,
        getAllCategories: ctx.getAllCategories,
        filterTickets: ctx.filterTickets,
        getSegmentationStats: ctx.getSegmentationStats,
        getTicket: ctx.getTicket,
        addTagToTicket: ctx.addTagToTicket,
        removeTagFromTicket: ctx.removeTagFromTicket,
        setTicketCategory: ctx.setTicketCategory,
      };
    },
  });

  mountExpressHandler(router, {
    handler: handleConfigAdminRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        requireTenant: ctx.requireTenant,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
        logAction: ctx.logAction,
        flows: ctx.flows,
      };
    },
  });

  router.use(createConfigRoutes({
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
        getAIConfig: ctx.getAIConfig,
        saveAIConfig: ctx.saveAIConfig,
        saveAICredentials: ctx.saveAICredentials,
        getDecryptedAPIKey: ctx.getDecryptedAPIKey,
        initializeAiProviders: ctx.initializeAiProviders,
        isSuperAdmin: ctx.isSuperAdmin,
        setCorsHeaders: ctx.setCorsHeaders,
        emitEvent: ctx.emitEvent,
        detectProcessManager: ctx.detectProcessManager,
      };
    },
  }));

  router.use(createQueueRoutes({
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
        logAction: ctx.logAction,
        listQueues: ctx.listQueues,
        createQueue: ctx.createQueue,
        getQueueInfo: ctx.getQueueInfo,
        deleteQueue: ctx.deleteQueue,
        listQueue: ctx.listQueue,
        canAccessTicket: ctx.canAccessTicket,
        queueDefinitionService: ctx.queueDefinitionService,
      };
    },
  }));

  return router;
}

module.exports = {
  createPlatformAdminRoutes,
};