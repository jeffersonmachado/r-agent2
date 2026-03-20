'use strict';

function parseRolePayload(body) {
  return {
    role: body && body.role ? String(body.role).trim() : '',
    permissions: body && Array.isArray(body.permissions) ? body.permissions : [],
  };
}

function parseAssignPayload(body) {
  return {
    agentId: body && body.agentId ? String(body.agentId).trim() : '',
    role: body && body.role ? String(body.role).trim() : '',
  };
}

function createRbacService({ deps }) {
  return {
    parseRolePayload,
    parseAssignPayload,

    listRoles() {
      return deps.getRoleDefinitions();
    },

    createRole(role, permissions) {
      return deps.createRole(role, permissions);
    },

    listPermissions() {
      return deps.listPermissions();
    },

    getAgent(agentId) {
      return deps.getAgent(agentId);
    },

    updateAgent(agentId, payload) {
      return deps.updateAgent(agentId, payload);
    },
  };
}

module.exports = {
  createRbacService,
};
