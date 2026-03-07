'use strict';

const { User, Department } = require('../db/models');
const { hasPermission } = require('./rbacService');

const INVALID_REFERENCE_LITERALS = new Set(['0', '-', 'null', 'undefined']);

function normalizeReferenceId(raw, fieldPrefix) {
  const value = raw === null || raw === undefined ? '' : String(raw).trim();
  if (!value) return null;
  if (INVALID_REFERENCE_LITERALS.has(value.toLowerCase())) {
    const err = new Error(`${fieldPrefix}_invalid`);
    err.code = `${fieldPrefix}_invalid`;
    throw err;
  }
  return value;
}

async function getUserById(tenantId, userId) {
  const normalizedUserId = normalizeReferenceId(userId, 'owner');
  if (!normalizedUserId) return null;
  const Model = User();
  return Model.findOne({
    where: {
      tenant_key: String(tenantId),
      id: String(normalizedUserId),
    },
  });
}

async function getTeamById(tenantId, teamId) {
  const normalizedTeamId = normalizeReferenceId(teamId, 'team');
  if (!normalizedTeamId) return null;
  const Model = Department();
  return Model.findOne({
    where: {
      tenant_key: String(tenantId),
      id: String(normalizedTeamId),
      active: true,
    },
  });
}

function canAssignOwner(requestUser, targetOwner) {
  if (!requestUser || !targetOwner) return false;
  const requestUserId = String(requestUser.id || '').trim();
  const targetOwnerId = String(targetOwner.id || '').trim();
  if (!requestUserId || !targetOwnerId) return false;
  if (requestUserId === targetOwnerId) return true;

  const role = String(requestUser.role || '').trim().toLowerCase();
  const hasAssignAnyRole = ['owner', 'admin', 'super_admin', 'manager', 'supervisor'].includes(role);
  if (hasAssignAnyRole) return true;

  return hasPermission(requestUser, 'agents', 'update');
}

function canAssignTeam(requestUser, targetTeam) {
  if (!requestUser || !targetTeam) return false;
  const requestUserId = String(requestUser.id || '').trim();
  const requestUsername = String(requestUser.username || '').trim();
  const teamJson = targetTeam?.toJSON ? targetTeam.toJSON() : targetTeam;
  const agentIds = Array.isArray(teamJson?.agent_ids)
    ? teamJson.agent_ids
    : (Array.isArray(teamJson?.agentIds) ? teamJson.agentIds : []);

  const belongsToTeam = agentIds.some((id) => {
    const normalized = String(id || '').trim();
    return normalized && (normalized === requestUserId || normalized === requestUsername);
  });
  if (belongsToTeam) return true;

  const role = String(requestUser.role || '').trim().toLowerCase();
  const hasTeamAnyRole = ['owner', 'admin', 'super_admin', 'manager', 'supervisor'].includes(role);
  if (hasTeamAnyRole) return true;

  return hasPermission(requestUser, 'departments', 'update') || hasPermission(requestUser, 'queues', 'admin');
}

module.exports = {
  normalizeReferenceId,
  getUserById,
  getTeamById,
  canAssignOwner,
  canAssignTeam,
};
