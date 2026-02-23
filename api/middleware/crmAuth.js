'use strict';

const { getUserPermissions, hasPermission, checkResourcePermission, logAudit } = require('../services/crm/rbacService');

/**
 * Middleware para verificar permissões de CRM
 * Uso: app.use('/api/crm', crmAuthMiddleware)
 */
async function crmAuthMiddleware(req, res, next) {
  try {
    const userId = req.user?.id;
    const tenantKey = req.user?.tenant_key || req.body?.tenant_key || 'system';

    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'No user identified' });
    }

    // Attach user and tenant to request
    req.crmUser = { userId, tenantKey };

    // Get user permissions
    const permissions = await getUserPermissions(req.sequelize, tenantKey, userId);
    req.crmPermissions = permissions;

    next();
  } catch (err) {
    console.error('[crmAuthMiddleware]', err);
    res.status(500).json({ error: 'auth_error', message: err.message });
  }
}

/**
 * Middleware factory para verificar permission específica
 * Uso: app.post('/api/crm/opportunities', requireCrmPermission('crm:opportunities:write'), handler)
 */
function requireCrmPermission(requiredPermission) {
  return (req, res, next) => {
    const { crmPermissions } = req;

    if (!crmPermissions || !hasPermission(crmPermissions, requiredPermission)) {
      return res.status(403).json({
        error: 'forbidden',
        message: `Permission denied: ${requiredPermission}`,
      });
    }

    next();
  };
}

/**
 * Middleware para verificar resource-level permission
 * Uso: app.put('/api/crm/opportunities/:id', requireResourcePermission('opportunity', 'edit'), handler)
 */
function requireResourcePermission(resourceType, requiredLevel = 'view') {
  return async (req, res, next) => {
    try {
      const { userId, tenantKey } = req.crmUser;
      const resourceId = req.params.id || req.body?.id;

      if (!resourceId) {
        return res.status(400).json({ error: 'invalid_request', message: 'Resource ID required' });
      }

      const hasAccess = await checkResourcePermission(
        req.sequelize,
        tenantKey,
        userId,
        resourceType,
        resourceId,
        requiredLevel
      );

      if (!hasAccess) {
        return res.status(403).json({
          error: 'forbidden',
          message: `No ${requiredLevel} permission for this resource`,
        });
      }

      next();
    } catch (err) {
      console.error('[requireResourcePermission]', err);
      res.status(500).json({ error: 'auth_error', message: err.message });
    }
  };
}

/**
 * Middleware para logar auditorias
 * Deve ser usado após operações bem-sucedidas
 * Uso: app.post('/api/crm/opportunities', ..., logCrmAudit('create', 'opportunity'), handler)
 */
function logCrmAudit(action, entityType) {
  return async (req, res, next) => {
    // Store audit info in response to be logged after success
    res.on('finish', async () => {
      try {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const { userId, tenantKey } = req.crmUser;
          const entityId = req.params.id || req.body?.id || `${Date.now()}`;
          const changes = {
            method: req.method,
            path: req.path,
            body: req.body,
          };

          await logAudit(req.sequelize, tenantKey, userId, action, entityType, entityId, changes);
        }
      } catch (err) {
        console.error('[logCrmAudit]', err);
        // Don't fail the request if audit logging fails
      }
    });

    next();
  };
}

module.exports = {
  crmAuthMiddleware,
  requireCrmPermission,
  requireResourcePermission,
  logCrmAudit,
};
