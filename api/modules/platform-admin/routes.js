'use strict';

const express = require('express');
const { createConfigRoutes } = require('../config/routes');
const { createQueueRoutes } = require('../queue/routes');
const { handleChannelAccountRoutes } = require('./handleChannelAccountRoutes');
const { handleDepartmentRoutes } = require('./handleDepartmentRoutes');
const { handleExportRoutes } = require('./handleExportRoutes');
const { handleSegmentationRoutes } = require('./handleSegmentationRoutes');
const { handleConfigAdminRoutes } = require('./handleConfigAdminRoutes');

function createPlatformAdminRoutes({ buildDeps }) {
  const router = express.Router();

  function runHandled(handler, selectDeps) {
    return async (req, res, next) => {
      try {
        const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
        const ctx = buildDeps(req, res);
        const handled = await handler({
          req,
          res,
          method: (req.method || 'GET').toUpperCase(),
          pathname,
          deps: selectDeps(ctx),
        });
        if (!handled && !res.writableEnded) {
          next();
        }
      } catch (err) {
        next(err);
      }
    };
  }

  router.use(runHandled(handleChannelAccountRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    requirePermission: ctx.requirePermission,
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    logger: ctx.logger,
  })));

  router.use(runHandled(handleDepartmentRoutes, (ctx) => ({
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
  })));

  router.use(runHandled(handleExportRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    requirePermission: ctx.requirePermission,
    requireTenant: ctx.requireTenant,
    sendJson: ctx.sendJson,
    logger: ctx.logger,
    exportTicketsCSV: ctx.exportTicketsCSV,
    exportMetricsCSV: ctx.exportMetricsCSV,
    exportConversationsJSON: ctx.exportConversationsJSON,
    exportFullReportJSON: ctx.exportFullReportJSON,
  })));

  router.use(runHandled(handleSegmentationRoutes, (ctx) => ({
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
  })));

  router.use(runHandled(handleConfigAdminRoutes, (ctx) => ({
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
  })));

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
