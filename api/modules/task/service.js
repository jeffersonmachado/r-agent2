'use strict';

function normalizeCreatePayload(body) {
  return {
    title: body && body.title ? String(body.title).trim() : '',
    description: body?.description || '',
    dueAt: body?.dueAt || null,
    priority: body?.priority || 'normal',
  };
}

function normalizeReminderPayload(body) {
  return {
    reminderAt: body && body.reminderAt ? String(body.reminderAt) : null,
  };
}

function parseTaskId(req) {
  return decodeURIComponent(String(req.params.taskId || ''));
}

function createTaskService({ tasksService }) {
  return {
    listTasks(tenantId) {
      return tasksService.listTasks(tenantId);
    },

    async createTask(tenantId, body) {
      const payload = normalizeCreatePayload(body);
      if (!payload.title) {
        return {
          ok: false,
          kind: 'bad_request',
          message: 'title é obrigatório',
        };
      }

      const out = await tasksService.createTask(tenantId, payload);
      if (!out.ok) {
        return {
          ok: false,
          kind: 'service_unavailable',
          payload: {
            error: 'service_unavailable',
            message: out.error || 'tasks_unavailable',
          },
        };
      }

      return {
        ok: true,
        status: 201,
        payload: { ok: true, task: out.task },
      };
    },

    async completeTask(tenantId, req) {
      const taskId = parseTaskId(req);
      const out = await tasksService.completeTask(tenantId, taskId);
      if (!out.ok) {
        if (out.error === 'not_found') {
          return {
            ok: false,
            status: 404,
            payload: { error: 'not_found', message: 'Tarefa não encontrada' },
          };
        }

        return {
          ok: false,
          status: 503,
          payload: {
            error: 'service_unavailable',
            message: out.error || 'tasks_unavailable',
          },
        };
      }

      return {
        ok: true,
        status: 200,
        payload: { ok: true, task: out.task },
      };
    },

    async scheduleReminder(tenantId, req, body) {
      const taskId = parseTaskId(req);
      const payload = normalizeReminderPayload(body);
      const out = await tasksService.scheduleReminder(tenantId, taskId, payload.reminderAt);
      if (!out.ok) {
        if (out.error === 'not_found') {
          return {
            ok: false,
            status: 404,
            payload: { error: 'not_found', message: 'Tarefa não encontrada' },
          };
        }

        return {
          ok: false,
          status: 503,
          payload: {
            error: 'service_unavailable',
            message: out.error || 'tasks_unavailable',
          },
        };
      }

      return {
        ok: true,
        status: 200,
        payload: { ok: true, task: out.task },
      };
    },
  };
}

module.exports = {
  createTaskService,
};
