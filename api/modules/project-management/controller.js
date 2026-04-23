'use strict';

function createProjectManagementController({ service, deps }) {
  function ensureAuth(req, res) {
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return false;
    }
    return true;
  }

  function ensurePermission(req, res, action) {
    if (!ensureAuth(req, res)) return false;
    const perm = deps.requirePermission(req, 'projects', action);
    if (!perm.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: perm.error });
      return false;
    }
    return true;
  }

  function ensureJson(req, res) {
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return false;
    }
    return true;
  }

  function requireTenant(req, res) {
    return deps.requireTenant(req, res);
  }

  async function parseBody(req) {
    return deps.parseJsonBody(req);
  }

  function sendHandledError(res, error, fallbackMessage) {
    if (error?.code === 'bad_request') {
      deps.badRequest(res, error.message || fallbackMessage);
      return;
    }
    if (error?.code === 'not_found') {
      deps.sendJson(res, 404, { error: 'not_found', message: error.message || fallbackMessage });
      return;
    }
    deps.sendJson(res, 500, { error: 'internal_error', message: fallbackMessage });
  }

  return {
    async listProjects(req, res) {
      if (!ensurePermission(req, res, 'read')) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const projects = await service.listProjects({
          tenantId,
          actorUserId: req.agent?.id || null,
          query: req.query || {},
        });
        deps.sendJson(res, 200, { ok: true, projects });
      } catch (error) {
        deps.logger.error('[Projects] listProjects', error);
        sendHandledError(res, error, 'Erro ao listar projetos');
      }
    },

    async createProject(req, res) {
      if (!ensurePermission(req, res, 'create')) return;
      if (!ensureJson(req, res)) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const project = await service.createProject({
          tenantId,
          actorUserId: req.agent?.id || null,
          payload: await parseBody(req),
        });
        deps.sendJson(res, 201, { ok: true, project: project.get ? project.get({ plain: true }) : project });
      } catch (error) {
        deps.logger.error('[Projects] createProject', error);
        sendHandledError(res, error, 'Erro ao criar projeto');
      }
    },

    async getProject(req, res) {
      if (!ensurePermission(req, res, 'read')) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const project = await service.getProject({ tenantId, projectId: req.params.projectId });
        deps.sendJson(res, 200, { ok: true, project });
      } catch (error) {
        deps.logger.error('[Projects] getProject', error);
        sendHandledError(res, error, 'Erro ao carregar projeto');
      }
    },

    async updateProject(req, res) {
      if (!ensurePermission(req, res, 'update')) return;
      if (!ensureJson(req, res)) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const project = await service.updateProject({
          tenantId,
          actorUserId: req.agent?.id || null,
          projectId: req.params.projectId,
          payload: await parseBody(req),
        });
        deps.sendJson(res, 200, { ok: true, project });
      } catch (error) {
        deps.logger.error('[Projects] updateProject', error);
        sendHandledError(res, error, 'Erro ao atualizar projeto');
      }
    },

    async deleteProject(req, res) {
      if (!ensurePermission(req, res, 'delete')) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const result = await service.deleteProject({
          tenantId,
          actorUserId: req.agent?.id || null,
          projectId: req.params.projectId,
        });
        deps.sendJson(res, 200, result);
      } catch (error) {
        deps.logger.error('[Projects] deleteProject', error);
        sendHandledError(res, error, 'Erro ao remover projeto');
      }
    },

    async listMembers(req, res) {
      if (!ensurePermission(req, res, 'read')) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const members = await service.listMembers({ tenantId, projectId: req.params.projectId });
        deps.sendJson(res, 200, { ok: true, members });
      } catch (error) {
        deps.logger.error('[Projects] listMembers', error);
        sendHandledError(res, error, 'Erro ao listar membros');
      }
    },

    async addMember(req, res) {
      if (!ensurePermission(req, res, 'manage_members')) return;
      if (!ensureJson(req, res)) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const member = await service.addMember({
          tenantId,
          actorUserId: req.agent?.id || null,
          projectId: req.params.projectId,
          payload: await parseBody(req),
        });
        deps.sendJson(res, 201, { ok: true, member });
      } catch (error) {
        deps.logger.error('[Projects] addMember', error);
        sendHandledError(res, error, 'Erro ao adicionar membro');
      }
    },

    async removeMember(req, res) {
      if (!ensurePermission(req, res, 'manage_members')) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const result = await service.removeMember({
          tenantId,
          actorUserId: req.agent?.id || null,
          projectId: req.params.projectId,
          memberId: req.params.memberId,
        });
        deps.sendJson(res, 200, result);
      } catch (error) {
        deps.logger.error('[Projects] removeMember', error);
        sendHandledError(res, error, 'Erro ao remover membro');
      }
    },

    async listLists(req, res) {
      if (!ensurePermission(req, res, 'read')) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const lists = await service.listLists({ tenantId, projectId: req.params.projectId });
        deps.sendJson(res, 200, { ok: true, lists });
      } catch (error) {
        deps.logger.error('[Projects] listLists', error);
        sendHandledError(res, error, 'Erro ao listar colunas');
      }
    },

    async createList(req, res) {
      if (!ensurePermission(req, res, 'manage_workflow')) return;
      if (!ensureJson(req, res)) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const list = await service.createList({
          tenantId,
          actorUserId: req.agent?.id || null,
          projectId: req.params.projectId,
          payload: await parseBody(req),
        });
        deps.sendJson(res, 201, { ok: true, list });
      } catch (error) {
        deps.logger.error('[Projects] createList', error);
        sendHandledError(res, error, 'Erro ao criar coluna');
      }
    },

    async updateList(req, res) {
      if (!ensurePermission(req, res, 'manage_workflow')) return;
      if (!ensureJson(req, res)) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const list = await service.updateList({
          tenantId,
          actorUserId: req.agent?.id || null,
          projectId: req.params.projectId,
          listId: req.params.listId,
          payload: await parseBody(req),
        });
        deps.sendJson(res, 200, { ok: true, list });
      } catch (error) {
        deps.logger.error('[Projects] updateList', error);
        sendHandledError(res, error, 'Erro ao atualizar coluna');
      }
    },

    async reorderLists(req, res) {
      if (!ensurePermission(req, res, 'manage_workflow')) return;
      if (!ensureJson(req, res)) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const body = await parseBody(req);
        const result = await service.reorderLists({
          tenantId,
          actorUserId: req.agent?.id || null,
          projectId: req.params.projectId,
          listIds: Array.isArray(body?.listIds) ? body.listIds : [],
        });
        deps.sendJson(res, 200, { ok: true, result });
      } catch (error) {
        deps.logger.error('[Projects] reorderLists', error);
        sendHandledError(res, error, 'Erro ao reordenar colunas');
      }
    },

    async listItems(req, res) {
      if (!ensurePermission(req, res, 'read')) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const items = await service.listItems({
          tenantId,
          projectId: req.params.projectId,
          query: req.query || {},
        });
        deps.sendJson(res, 200, { ok: true, items });
      } catch (error) {
        deps.logger.error('[Projects] listItems', error);
        sendHandledError(res, error, 'Erro ao listar itens');
      }
    },

    async createItem(req, res) {
      if (!ensurePermission(req, res, 'update')) return;
      if (!ensureJson(req, res)) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const item = await service.createItem({
          tenantId,
          actorUserId: req.agent?.id || null,
          projectId: req.params.projectId,
          payload: await parseBody(req),
        });
        deps.sendJson(res, 201, { ok: true, item });
      } catch (error) {
        deps.logger.error('[Projects] createItem', error);
        sendHandledError(res, error, 'Erro ao criar item');
      }
    },

    async getItem(req, res) {
      if (!ensurePermission(req, res, 'read')) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const item = await service.getItem({
          tenantId,
          projectId: req.params.projectId,
          itemId: req.params.itemId,
        });
        deps.sendJson(res, 200, { ok: true, item });
      } catch (error) {
        deps.logger.error('[Projects] getItem', error);
        sendHandledError(res, error, 'Erro ao carregar item');
      }
    },

    async updateItem(req, res) {
      if (!ensurePermission(req, res, 'update')) return;
      if (!ensureJson(req, res)) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const item = await service.updateItem({
          tenantId,
          actorUserId: req.agent?.id || null,
          projectId: req.params.projectId,
          itemId: req.params.itemId,
          payload: await parseBody(req),
        });
        deps.sendJson(res, 200, { ok: true, item });
      } catch (error) {
        deps.logger.error('[Projects] updateItem', error);
        sendHandledError(res, error, 'Erro ao atualizar item');
      }
    },

    async deleteItem(req, res) {
      if (!ensurePermission(req, res, 'delete')) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const result = await service.deleteItem({
          tenantId,
          actorUserId: req.agent?.id || null,
          projectId: req.params.projectId,
          itemId: req.params.itemId,
        });
        deps.sendJson(res, 200, result);
      } catch (error) {
        deps.logger.error('[Projects] deleteItem', error);
        sendHandledError(res, error, 'Erro ao remover item');
      }
    },

    async moveItem(req, res) {
      if (!ensurePermission(req, res, 'update')) return;
      if (!ensureJson(req, res)) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const item = await service.moveItem({
          tenantId,
          actorUserId: req.agent?.id || null,
          projectId: req.params.projectId,
          itemId: req.params.itemId,
          payload: await parseBody(req),
        });
        deps.sendJson(res, 200, { ok: true, item });
      } catch (error) {
        deps.logger.error('[Projects] moveItem', error);
        sendHandledError(res, error, 'Erro ao mover item');
      }
    },

    async completeItem(req, res) {
      if (!ensurePermission(req, res, 'update')) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const item = await service.completeItem({
          tenantId,
          actorUserId: req.agent?.id || null,
          projectId: req.params.projectId,
          itemId: req.params.itemId,
        });
        deps.sendJson(res, 200, { ok: true, item });
      } catch (error) {
        deps.logger.error('[Projects] completeItem', error);
        sendHandledError(res, error, 'Erro ao concluir item');
      }
    },

    async listComments(req, res) {
      if (!ensurePermission(req, res, 'comment')) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const comments = await service.listComments({
          tenantId,
          projectId: req.params.projectId,
          itemId: req.params.itemId,
        });
        deps.sendJson(res, 200, { ok: true, comments });
      } catch (error) {
        deps.logger.error('[Projects] listComments', error);
        sendHandledError(res, error, 'Erro ao listar comentarios');
      }
    },

    async addComment(req, res) {
      if (!ensurePermission(req, res, 'comment')) return;
      if (!ensureJson(req, res)) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const comment = await service.addComment({
          tenantId,
          actorUserId: req.agent?.id || null,
          projectId: req.params.projectId,
          itemId: req.params.itemId,
          payload: await parseBody(req),
        });
        deps.sendJson(res, 201, { ok: true, comment });
      } catch (error) {
        deps.logger.error('[Projects] addComment', error);
        sendHandledError(res, error, 'Erro ao adicionar comentario');
      }
    },

    async listActivities(req, res) {
      if (!ensurePermission(req, res, 'read')) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const activities = await service.listActivities({
          tenantId,
          projectId: req.params.projectId,
          itemId: req.query.itemId || null,
        });
        deps.sendJson(res, 200, { ok: true, activities });
      } catch (error) {
        deps.logger.error('[Projects] listActivities', error);
        sendHandledError(res, error, 'Erro ao listar historico');
      }
    },

    async getDashboard(req, res) {
      if (!ensurePermission(req, res, 'read')) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const dashboard = await service.getDashboard({ tenantId, projectId: req.params.projectId });
        deps.sendJson(res, 200, { ok: true, dashboard });
      } catch (error) {
        deps.logger.error('[Projects] getDashboard', error);
        sendHandledError(res, error, 'Erro ao carregar dashboard');
      }
    },

    async getTimeline(req, res) {
      if (!ensurePermission(req, res, 'read')) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const timeline = await service.getTimeline({ tenantId, projectId: req.params.projectId });
        deps.sendJson(res, 200, { ok: true, timeline });
      } catch (error) {
        deps.logger.error('[Projects] getTimeline', error);
        sendHandledError(res, error, 'Erro ao carregar timeline');
      }
    },

    async listTemplates(req, res) {
      if (!ensurePermission(req, res, 'read')) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const templates = await service.listTemplates({ tenantId });
        deps.sendJson(res, 200, { ok: true, templates });
      } catch (error) {
        deps.logger.error('[Projects] listTemplates', error);
        sendHandledError(res, error, 'Erro ao listar templates');
      }
    },

    async createTemplate(req, res) {
      if (!ensurePermission(req, res, 'manage_templates')) return;
      if (!ensureJson(req, res)) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const template = await service.createTemplate({
          tenantId,
          actorUserId: req.agent?.id || null,
          payload: await parseBody(req),
        });
        deps.sendJson(res, 201, { ok: true, template });
      } catch (error) {
        deps.logger.error('[Projects] createTemplate', error);
        sendHandledError(res, error, 'Erro ao criar template');
      }
    },

    async createProjectFromTemplate(req, res) {
      if (!ensurePermission(req, res, 'create')) return;
      if (!ensureJson(req, res)) return;
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      try {
        const project = await service.createProjectFromTemplate({
          tenantId,
          actorUserId: req.agent?.id || null,
          payload: await parseBody(req),
        });
        deps.sendJson(res, 201, { ok: true, project });
      } catch (error) {
        deps.logger.error('[Projects] createProjectFromTemplate', error);
        sendHandledError(res, error, 'Erro ao criar projeto a partir do template');
      }
    },
  };
}

module.exports = {
  createProjectManagementController,
};
