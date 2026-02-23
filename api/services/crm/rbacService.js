'use strict';

const { v4: uuidv4 } = require('uuid');

const DEFAULT_ROLES = {
  admin: {
    name: 'Administrator',
    description: 'Full access to all CRM resources',
    is_system: true,
    permissions: [
      'crm:*:*', // Full access
      'crm:roles:*',
      'crm:audit:read',
    ],
  },
  manager: {
    name: 'Manager',
    description: 'Can manage team and their opportunities',
    is_system: true,
    permissions: [
      'crm:accounts:read',
      'crm:accounts:write',
      'crm:contacts:read',
      'crm:contacts:write',
      'crm:leads:read',
      'crm:leads:write',
      'crm:pipelines:read',
      'crm:opportunities:*',
      'crm:activities:*',
    ],
  },
  sales_rep: {
    name: 'Sales Representative',
    description: 'Can work with assigned opportunities',
    is_system: true,
    permissions: [
      'crm:accounts:read',
      'crm:contacts:read',
      'crm:contacts:write',
      'crm:leads:read',
      'crm:leads:write',
      'crm:pipelines:read',
      'crm:opportunities:read',
      'crm:opportunities:write',
      'crm:activities:read',
      'crm:activities:write',
    ],
  },
  viewer: {
    name: 'Viewer',
    description: 'Read-only access',
    is_system: true,
    permissions: [
      'crm:accounts:read',
      'crm:contacts:read',
      'crm:leads:read',
      'crm:pipelines:read',
      'crm:opportunities:read',
      'crm:activities:read',
    ],
  },
};

async function initializeDefaultRoles(sequelize, tenantKey) {
  const CrmRole = sequelize.models.CrmRole;
  if (!CrmRole) throw new Error('CrmRole model not found');

  for (const [key, roleData] of Object.entries(DEFAULT_ROLES)) {
    const existing = await CrmRole.findOne({
      where: { tenant_key: tenantKey, name: roleData.name },
    });

    if (!existing) {
      await CrmRole.create({
        id: uuidv4(),
        tenant_key: tenantKey,
        ...roleData,
      });
    }
  }
}

async function assignRoleToUser(sequelize, tenantKey, userId, roleId, assignedBy) {
  const CrmUserRole = sequelize.models.CrmUserRole;
  if (!CrmUserRole) throw new Error('CrmUserRole model not found');

  return CrmUserRole.create({
    id: uuidv4(),
    tenant_key: tenantKey,
    user_id: userId,
    role_id: roleId,
    assigned_by: assignedBy,
  });
}

async function getUserPermissions(sequelize, tenantKey, userId) {
  const CrmUserRole = sequelize.models.CrmUserRole;
  const CrmRole = sequelize.models.CrmRole;

  if (!CrmUserRole || !CrmRole) {
    throw new Error('Models not found');
  }

  const userRoles = await CrmUserRole.findAll({
    where: { tenant_key: tenantKey, user_id: userId },
    include: [
      {
        model: CrmRole,
        as: 'role',
        attributes: ['permissions'],
      },
    ],
  });

  const allPermissions = new Set();
  userRoles.forEach((ur) => {
    if (ur.role?.permissions) {
      ur.role.permissions.forEach((p) => allPermissions.add(p));
    }
  });

  return Array.from(allPermissions);
}

function hasPermission(permissions, requiredPermission) {
  // Check for wildcard permissions
  if (permissions.includes('crm:*:*')) return true;

  // Check for exact match
  if (permissions.includes(requiredPermission)) return true;

  // Check for partial wildcards
  const parts = requiredPermission.split(':');
  if (parts.length === 3) {
    const [resource, module, action] = parts;
    if (permissions.includes(`${resource}:${module}:*`)) return true;
  }

  return false;
}

async function checkResourcePermission(
  sequelize,
  tenantKey,
  userId,
  resourceType,
  resourceId,
  requiredLevel = 'view'
) {
  const CrmResourcePermission = sequelize.models.CrmResourcePermission;
  if (!CrmResourcePermission) throw new Error('CrmResourcePermission model not found');

  const permissionLevels = { view: 1, edit: 2, delete: 3, owner: 4 };
  const requiredLevelValue = permissionLevels[requiredLevel] || 1;

  const permission = await CrmResourcePermission.findOne({
    where: {
      tenant_key: tenantKey,
      resource_type: resourceType,
      resource_id: resourceId,
      user_id: userId,
    },
  });

  if (!permission) return false;

  const userLevelValue = permissionLevels[permission.permission_level] || 0;
  return userLevelValue >= requiredLevelValue;
}

async function grantResourcePermission(
  sequelize,
  tenantKey,
  resourceType,
  resourceId,
  userId,
  permissionLevel
) {
  const CrmResourcePermission = sequelize.models.CrmResourcePermission;
  if (!CrmResourcePermission) throw new Error('CrmResourcePermission model not found');

  const existing = await CrmResourcePermission.findOne({
    where: { tenant_key: tenantKey, resource_type: resourceType, resource_id: resourceId, user_id: userId },
  });

  if (existing) {
    return existing.update({ permission_level: permissionLevel });
  }

  return CrmResourcePermission.create({
    id: uuidv4(),
    tenant_key: tenantKey,
    resource_type: resourceType,
    resource_id: resourceId,
    user_id: userId,
    permission_level: permissionLevel,
  });
}

async function logAudit(
  sequelize,
  tenantKey,
  userId,
  action,
  entityType,
  entityId,
  changes = null
) {
  const CrmAuditLog = sequelize.models.CrmAuditLog;
  if (!CrmAuditLog) throw new Error('CrmAuditLog model not found');

  return CrmAuditLog.create({
    id: uuidv4(),
    tenant_key: tenantKey,
    user_id: userId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    changes,
  });
}

module.exports = {
  DEFAULT_ROLES,
  initializeDefaultRoles,
  assignRoleToUser,
  getUserPermissions,
  hasPermission,
  checkResourcePermission,
  grantResourcePermission,
  logAudit,
};
