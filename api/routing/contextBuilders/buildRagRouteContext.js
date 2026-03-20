'use strict';

function buildRagRouteContext(deps) {
  const { isValidExecutionId } = require('../../middleware/requireExecutionId');
  const { createPipelineWs } = require('../../ws/pipelineEmitter');
  const { emitPipelineStage } = require('../../ws/emitPipelineStage');
  const { extractTextFromFile } = require('../../services/fileExtractionService');
  const ragDocumentsService = require('../../services/ragDocumentsService');
  const ragDeduplicationService = require('../../services/ragDeduplicationService');

  return {
    requireAuth: deps.requireAuth,
    requirePermission: deps.requirePermission,
    sendJson: deps.sendJson,
    badRequest: deps.badRequest,
    hasJsonContentType: deps.hasJsonContentType,
    parseJsonBody: deps.parseJsonBody,
    requireTenant: deps.requireTenant,
    isSuperAdmin: deps.isSuperAdmin,
    logAction: deps.logAction,
    setCorsHeaders: deps.setCorsHeaders,
    logger: deps.logger,
    parseMultipartFormData: deps.parseMultipartFormData,
    listDocuments: deps.listDocuments,
    getDocument: deps.getDocument,
    getDocumentsStats: deps.getDocumentsStats,
    createDocument: deps.createDocument,
    updateDocument: deps.updateDocument,
    deleteDocument: deps.deleteDocument,
    reindexDocument: deps.reindexDocument,
    reindexAllNotIndexed: deps.reindexAllNotIndexed,
    ragService: deps.ragService,
    scrapeUrl: deps.scrapeUrl,
    scrapeUrls: deps.scrapeUrls,
    extractTextFromFile,
    createPipelineWs,
    emitPipelineStage,
    isValidExecutionId,
    ragDocumentsService,
    ragDeduplicationService,
  };
}

module.exports = {
  buildRagRouteContext,
};
