'use strict';

const express = require('express');
const projectManagementService = require('../../services/projectManagement/projectManagementService');
const { createProjectManagementModuleService } = require('./service');
const { createProjectManagementController } = require('./controller');

function createProjectManagementRoutes({ buildDeps }) {
  const router = express.Router();
  const service = createProjectManagementModuleService({ projectManagementService });

  function controllerFor(req, res) {
    return createProjectManagementController({
      service,
      deps: buildDeps(req, res),
    });
  }

  router.get('/projects', (req, res) => controllerFor(req, res).listProjects(req, res));
  router.post('/projects', (req, res) => controllerFor(req, res).createProject(req, res));
  router.get('/projects/:projectId', (req, res) => controllerFor(req, res).getProject(req, res));
  router.patch('/projects/:projectId', (req, res) => controllerFor(req, res).updateProject(req, res));
  router.delete('/projects/:projectId', (req, res) => controllerFor(req, res).deleteProject(req, res));

  router.get('/projects/:projectId/members', (req, res) => controllerFor(req, res).listMembers(req, res));
  router.post('/projects/:projectId/members', (req, res) => controllerFor(req, res).addMember(req, res));
  router.delete('/projects/:projectId/members/:memberId', (req, res) => controllerFor(req, res).removeMember(req, res));

  router.get('/projects/:projectId/lists', (req, res) => controllerFor(req, res).listLists(req, res));
  router.post('/projects/:projectId/lists', (req, res) => controllerFor(req, res).createList(req, res));
  router.patch('/projects/:projectId/lists/:listId', (req, res) => controllerFor(req, res).updateList(req, res));
  router.post('/projects/:projectId/lists/reorder', (req, res) => controllerFor(req, res).reorderLists(req, res));

  router.get('/projects/:projectId/items', (req, res) => controllerFor(req, res).listItems(req, res));
  router.post('/projects/:projectId/items', (req, res) => controllerFor(req, res).createItem(req, res));
  router.get('/projects/:projectId/items/:itemId', (req, res) => controllerFor(req, res).getItem(req, res));
  router.patch('/projects/:projectId/items/:itemId', (req, res) => controllerFor(req, res).updateItem(req, res));
  router.delete('/projects/:projectId/items/:itemId', (req, res) => controllerFor(req, res).deleteItem(req, res));
  router.post('/projects/:projectId/items/:itemId/move', (req, res) => controllerFor(req, res).moveItem(req, res));
  router.post('/projects/:projectId/items/:itemId/complete', (req, res) => controllerFor(req, res).completeItem(req, res));

  router.get('/projects/:projectId/items/:itemId/comments', (req, res) => controllerFor(req, res).listComments(req, res));
  router.post('/projects/:projectId/items/:itemId/comments', (req, res) => controllerFor(req, res).addComment(req, res));

  router.get('/projects/:projectId/activities', (req, res) => controllerFor(req, res).listActivities(req, res));
  router.get('/projects/:projectId/dashboard', (req, res) => controllerFor(req, res).getDashboard(req, res));
  router.get('/projects/:projectId/timeline', (req, res) => controllerFor(req, res).getTimeline(req, res));

  router.get('/project-templates', (req, res) => controllerFor(req, res).listTemplates(req, res));
  router.post('/project-templates', (req, res) => controllerFor(req, res).createTemplate(req, res));
  router.post('/projects/from-template', (req, res) => controllerFor(req, res).createProjectFromTemplate(req, res));

  return router;
}

module.exports = {
  createProjectManagementRoutes,
};
