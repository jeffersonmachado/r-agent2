'use strict';

function createProjectManagementModuleService({ projectManagementService }) {
  return {
    listProjects({ tenantId, actorUserId, query }) {
      return projectManagementService.listProjects({ tenantId, actorUserId, query });
    },
    createProject({ tenantId, actorUserId, payload }) {
      return projectManagementService.createProject({ tenantId, actorUserId, payload });
    },
    getProject({ tenantId, projectId }) {
      return projectManagementService.getProject({ tenantId, projectId });
    },
    updateProject({ tenantId, actorUserId, projectId, payload }) {
      return projectManagementService.updateProject({ tenantId, actorUserId, projectId, payload });
    },
    deleteProject({ tenantId, actorUserId, projectId }) {
      return projectManagementService.deleteProject({ tenantId, actorUserId, projectId });
    },
    listMembers({ tenantId, projectId }) {
      return projectManagementService.listMembers({ tenantId, projectId });
    },
    addMember({ tenantId, actorUserId, projectId, payload }) {
      return projectManagementService.addMember({ tenantId, actorUserId, projectId, payload });
    },
    removeMember({ tenantId, actorUserId, projectId, memberId }) {
      return projectManagementService.removeMember({ tenantId, actorUserId, projectId, memberId });
    },
    listLists({ tenantId, projectId }) {
      return projectManagementService.listLists({ tenantId, projectId });
    },
    createList({ tenantId, actorUserId, projectId, payload }) {
      return projectManagementService.createList({ tenantId, actorUserId, projectId, payload });
    },
    updateList({ tenantId, actorUserId, projectId, listId, payload }) {
      return projectManagementService.updateList({ tenantId, actorUserId, projectId, listId, payload });
    },
    reorderLists({ tenantId, actorUserId, projectId, listIds }) {
      return projectManagementService.reorderLists({ tenantId, actorUserId, projectId, listIds });
    },
    listItems({ tenantId, projectId, query }) {
      return projectManagementService.listItems({ tenantId, projectId, query });
    },
    createItem({ tenantId, actorUserId, projectId, payload }) {
      return projectManagementService.createItem({ tenantId, actorUserId, projectId, payload });
    },
    getItem({ tenantId, projectId, itemId }) {
      return projectManagementService.getItem({ tenantId, projectId, itemId });
    },
    updateItem({ tenantId, actorUserId, projectId, itemId, payload }) {
      return projectManagementService.updateItem({ tenantId, actorUserId, projectId, itemId, payload });
    },
    deleteItem({ tenantId, actorUserId, projectId, itemId }) {
      return projectManagementService.deleteItem({ tenantId, actorUserId, projectId, itemId });
    },
    moveItem({ tenantId, actorUserId, projectId, itemId, payload }) {
      return projectManagementService.moveItem({ tenantId, actorUserId, projectId, itemId, payload });
    },
    completeItem({ tenantId, actorUserId, projectId, itemId }) {
      return projectManagementService.completeItem({ tenantId, actorUserId, projectId, itemId });
    },
    listComments({ tenantId, projectId, itemId }) {
      return projectManagementService.listComments({ tenantId, projectId, itemId });
    },
    addComment({ tenantId, actorUserId, projectId, itemId, payload }) {
      return projectManagementService.addComment({ tenantId, actorUserId, projectId, itemId, payload });
    },
    getDashboard({ tenantId, projectId }) {
      return projectManagementService.getDashboard({ tenantId, projectId });
    },
    getTimeline({ tenantId, projectId }) {
      return projectManagementService.getTimeline({ tenantId, projectId });
    },
    listTemplates({ tenantId }) {
      return projectManagementService.listTemplates({ tenantId });
    },
    createTemplate({ tenantId, actorUserId, payload }) {
      return projectManagementService.createTemplate({ tenantId, actorUserId, payload });
    },
    createProjectFromTemplate({ tenantId, actorUserId, payload }) {
      return projectManagementService.createProjectFromTemplate({ tenantId, actorUserId, payload });
    },
    listActivities({ tenantId, projectId, itemId }) {
      return projectManagementService.listActivities({ tenantId, projectId, itemId });
    },
  };
}

module.exports = {
  createProjectManagementModuleService,
};
