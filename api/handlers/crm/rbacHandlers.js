'use strict';

const { v4: uuidv4 } = require('uuid');
const rbacService = require('../../services/crm/rbacService');

async function listRoles(req, res) {
  try {
    const { tenantKey } = req.crmUser;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const CrmRole = req.sequelize.models.CrmRole;
    const { count, rows } = await CrmRole.findAndCountAll({
      where: { tenant_key: tenantKey },
      limit,
      offset,
      attributes: { exclude: ['updated_at'] },
    });

    res.json({
      ok: true,
      data: rows,
      pagination: { total: count, limit, offset },
    });
  } catch (err) {
    console.error('[listRoles]', err);
    res.status(500).json({ error: 'list_roles_failed', message: err.message });
  }
}

async function getRole(req, res) {
  try {
    const { tenantKey } = req.crmUser;
    const { id } = req.params;

    const CrmRole = req.sequelize.models.CrmRole;
    const role = await CrmRole.findOne({
      where: { id, tenant_key: tenantKey },
    });

    if (!role) {
      return res.status(404).json({ error: 'not_found', message: 'Role not found' });
    }

    res.json({ ok: true, role });
  } catch (err) {
    console.error('[getRole]', err);
    res.status(500).json({ error: 'get_role_failed', message: err.message });
  }
}

async function createRole(req, res) {
  try {
    const { tenantKey, userId } = req.crmUser;
    const { name, description, permissions } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: 'invalid_input', message: 'Name is required' });
    }

    const CrmRole = req.sequelize.models.CrmRole;
    const role = await CrmRole.create({
      id: uuidv4(),
      tenant_key: tenantKey,
      name,
      description: description || '',
      permissions: Array.isArray(permissions) ? permissions : [],
      is_system: false,
    });

    await rbacService.logAudit(req.sequelize, tenantKey, userId, 'create', 'role', role.id);

    res.status(201).json({ ok: true, role });
  } catch (err) {
    console.error('[createRole]', err);
    res.status(500).json({ error: 'create_role_failed', message: err.message });
  }
}

async function updateRole(req, res) {
  try {
    const { tenantKey, userId } = req.crmUser;
    const { id } = req.params;
    const { name, description, permissions } = req.body;

    const CrmRole = req.sequelize.models.CrmRole;
    const role = await CrmRole.findOne({
      where: { id, tenant_key: tenantKey },
    });

    if (!role) {
      return res.status(404).json({ error: 'not_found', message: 'Role not found' });
    }

    if (role.is_system) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Cannot modify system roles',
      });
    }

    const changes = {
      before: role.toJSON(),
      after: {
        name: name !== undefined ? name : role.name,
        description: description !== undefined ? description : role.description,
        permissions: permissions !== undefined ? permissions : role.permissions,
      },
    };

    await role.update({
      name: name !== undefined ? name : role.name,
      description: description !== undefined ? description : role.description,
      permissions: Array.isArray(permissions) ? permissions : role.permissions,
    });

    await rbacService.logAudit(req.sequelize, tenantKey, userId, 'update', 'role', id, changes);

    res.json({ ok: true, role });
  } catch (err) {
    console.error('[updateRole]', err);
    res.status(500).json({ error: 'update_role_failed', message: err.message });
  }
}

async function assignUserToRole(req, res) {
  try {
    const { tenantKey, userId: currentUserId } = req.crmUser;
    const { userId, roleId } = req.body;

    if (!userId || !roleId) {
      return res.status(400).json({
        error: 'invalid_input',
        message: 'userId and roleId are required',
      });
    }

    const assignment = await rbacService.assignRoleToUser(req.sequelize, tenantKey, userId, roleId, currentUserId);

    await rbacService.logAudit(req.sequelize, tenantKey, currentUserId, 'assign_role', 'user', userId);

    res.status(201).json({ ok: true, assignment });
  } catch (err) {
    console.error('[assignUserToRole]', err);
    res.status(500).json({ error: 'assign_role_failed', message: err.message });
  }
}

async function listUserRoles(req, res) {
  try {
    const { tenantKey } = req.crmUser;
    const { userId } = req.params;

    const CrmUserRole = req.sequelize.models.CrmUserRole;
    const CrmRole = req.sequelize.models.CrmRole;

    const userRoles = await CrmUserRole.findAll({
      where: { tenant_key: tenantKey, user_id: userId },
      include: [
        {
          model: CrmRole,
          attributes: { exclude: ['updated_at'] },
        },
      ],
    });

    res.json({ ok: true, roles: userRoles.map((ur) => ur.CrmRole) });
  } catch (err) {
    console.error('[listUserRoles]', err);
    res.status(500).json({ error: 'list_user_roles_failed', message: err.message });
  }
}

async function grantResourcePermission(req, res) {
  try {
    const { tenantKey, userId: currentUserId } = req.crmUser;
    const { resourceType, resourceId, userId, permissionLevel } = req.body;

    if (!resourceType || !resourceId || !userId || !permissionLevel) {
      return res.status(400).json({ error: 'invalid_input', message: 'All fields are required' });
    }

    const permission = await rbacService.grantResourcePermission(
      req.sequelize,
      tenantKey,
      resourceType,
      resourceId,
      userId,
      permissionLevel
    );

    await rbacService.logAudit(req.sequelize, tenantKey, currentUserId, 'grant_permission', 'resource', resourceId);

    res.json({ ok: true, permission });
  } catch (err) {
    console.error('[grantResourcePermission]', err);
    res.status(500).json({ error: 'grant_permission_failed', message: err.message });
  }
}

async function getAuditLog(req, res) {
  try {
    const { tenantKey } = req.crmUser;
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const offset = parseInt(req.query.offset) || 0;
    const entityType = req.query.entityType;

    const CrmAuditLog = req.sequelize.models.CrmAuditLog;
    const where = { tenant_key: tenantKey };
    if (entityType) where.entity_type = entityType;

    const { count, rows } = await CrmAuditLog.findAndCountAll({
      where,
      limit,
      offset,
      order: [['timestamp', 'DESC']],
    });

    res.json({
      ok: true,
      logs: rows,
      pagination: { total: count, limit, offset },
    });
  } catch (err) {
    console.error('[getAuditLog]', err);
    res.status(500).json({ error: 'get_audit_log_failed', message: err.message });
  }
}

module.exports = {
  listRoles,
  getRole,
  createRole,
  updateRole,
  assignUserToRole,
  listUserRoles,
  grantResourcePermission,
  getAuditLog,
};
