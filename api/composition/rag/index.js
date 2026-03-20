'use strict';

/**
 * Composition root do domínio RAG (Retrieval-Augmented Generation).
 *
 * Concentra toda a lógica de montagem do contexto de dependências RAG
 * usada pelos routers de domínio que expõem endpoints de RAG.
 *
 * Antes: buildRagRouteDeps() inline em api/server.js.
 * Agora: server.js apenas importa buildRagRouteDeps exportado aqui.
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const { isSuperAdmin } = require('../../services/superAdminService');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
  setCorsHeaders,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const { logAction } = require('../../services/auditService');
const { parseMultipartFormData } = require('../../utils/multipartParser');
const {
  listDocuments,
  getDocument,
  getDocumentsStats,
  createDocument,
  updateDocument,
  deleteDocument,
  reindexDocument,
  reindexAllNotIndexed,
} = require('../../services/ragDocumentsService');
const ragService = require('../../services/ragService');
const { scrapeUrl, scrapeUrls } = require('../../services/webScrapingService');
const { buildRagRouteContext } = require('../../routing/contextBuilders/buildRagRouteContext');

/**
 * Monta o contexto de dependências para as rotas RAG.
 * Usado pelos routers de domínio via ragRouteContext.
 *
 * @returns {object}
 */
function buildRagRouteDeps() {
  return buildRagRouteContext({
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    requireTenant,
    isSuperAdmin,
    logAction,
    setCorsHeaders,
    logger,
    parseMultipartFormData,
    listDocuments,
    getDocument,
    getDocumentsStats,
    createDocument,
    updateDocument,
    deleteDocument,
    reindexDocument,
    reindexAllNotIndexed,
    ragService,
    scrapeUrl,
    scrapeUrls,
  });
}

/**
 * requireTenant — injetado via server.js no momento de uso.
 * Como requireTenant depende de isSuperAdmin e sendJson (já importados aqui),
 * definimos uma cópia local idêntica à do server.js para desacoplar completamente.
 */
function requireTenant(req, res) {
  const superAdmin = req?.agent ? isSuperAdmin(req.agent) : false;
  const tenantIdRaw = superAdmin
    ? (req?.tenantId || null)
    : (req?.tenantId || req?.agent?.tenantId || null);
  const tenantId = typeof tenantIdRaw === 'string' ? tenantIdRaw.trim() : null;
  if (!tenantId) {
    sendJson(res, 403, { error: 'tenant_required' });
    return null;
  }
  return tenantId;
}

module.exports = {
  buildRagRouteDeps,
};
