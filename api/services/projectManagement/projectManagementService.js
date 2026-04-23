'use strict';

const { Op } = require('sequelize');
const dbModels = require('../../db/models');

const DEFAULT_PROJECT_LISTS = [
  { name: 'Backlog', slug: 'backlog', color: '#475569' },
  { name: 'To Do', slug: 'todo', color: '#2563eb' },
  { name: 'Doing', slug: 'doing', color: '#f59e0b' },
  { name: 'Review', slug: 'review', color: '#8b5cf6' },
  { name: 'Blocked', slug: 'blocked', color: '#ef4444' },
  { name: 'Done', slug: 'done', color: '#10b981' },
];

const DEFAULT_TEMPLATE = {
  lists: DEFAULT_PROJECT_LISTS,
  items: [
    {
      title: 'Mapear escopo inicial',
      itemType: 'task',
      priority: 'high',
      status: 'todo',
      listSlug: 'todo',
    },
    {
      title: 'Levantar riscos operacionais',
      itemType: 'research',
      priority: 'medium',
      status: 'backlog',
      listSlug: 'backlog',
    },
  ],
};

function resolveModel(modelFactory) {
  return typeof modelFactory === 'function' ? modelFactory() : modelFactory;
}

function getModels() {
  return {
    Project: resolveModel(dbModels.Project),
    ProjectMember: resolveModel(dbModels.ProjectMember),
    ProjectList: resolveModel(dbModels.ProjectList),
    ProjectItem: resolveModel(dbModels.ProjectItem),
    ProjectComment: resolveModel(dbModels.ProjectComment),
    ProjectAttachment: resolveModel(dbModels.ProjectAttachment),
    ProjectActivity: resolveModel(dbModels.ProjectActivity),
    ProjectMilestone: resolveModel(dbModels.ProjectMilestone),
    ProjectDependency: resolveModel(dbModels.ProjectDependency),
    ProjectTemplate: resolveModel(dbModels.ProjectTemplate),
    Tenant: resolveModel(dbModels.Tenant),
    User: resolveModel(dbModels.User),
  };
}

function safeTrim(value, fallback = '') {
  if (value == null) return fallback;
  return String(value).trim();
}

function asNullableString(value) {
  const trimmed = safeTrim(value);
  return trimmed || null;
}

function asNullableDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asInteger(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeJson(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function slugify(value, fallback = 'project') {
  const normalized = safeTrim(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

async function createActivity({ ProjectActivity, projectId, itemId = null, actorUserId = null, eventType, before = {}, after = {}, metadata = {}, transaction }) {
  return ProjectActivity.create({
    project_id: projectId,
    item_id: itemId,
    actor_user_id: actorUserId || null,
    event_type: eventType,
    before_json: sanitizeJson(before),
    after_json: sanitizeJson(after),
    metadata_json: sanitizeJson(metadata),
  }, { transaction });
}

async function createDefaultLists({ ProjectList, projectId, transaction }) {
  const created = [];
  for (let index = 0; index < DEFAULT_PROJECT_LISTS.length; index += 1) {
    const entry = DEFAULT_PROJECT_LISTS[index];
    created.push(await ProjectList.create({
      project_id: projectId,
      name: entry.name,
      slug: entry.slug,
      position: index,
      color: entry.color,
    }, { transaction }));
  }
  return created;
}

async function createProjectCode({ Project, tenantId, name }) {
  const base = slugify(name, 'project').replace(/-/g, '').slice(0, 6).toUpperCase() || 'PRJ';
  const count = await Project.count({ where: { tenant_id: tenantId } });
  return `${base}-${String(count + 1).padStart(3, '0')}`;
}

function normalizeProjectPayload(payload = {}) {
  return {
    code: asNullableString(payload.code),
    name: safeTrim(payload.name),
    description: asNullableString(payload.description),
    status: safeTrim(payload.status, 'active') || 'active',
    priority: safeTrim(payload.priority, 'medium') || 'medium',
    health: safeTrim(payload.health, 'on_track') || 'on_track',
    visibility: safeTrim(payload.visibility, 'private') || 'private',
    owner_user_id: asNullableString(payload.ownerUserId || payload.owner_user_id),
    start_date: asNullableDate(payload.startDate || payload.start_date),
    target_end_date: asNullableDate(payload.targetEndDate || payload.target_end_date),
    actual_end_date: asNullableDate(payload.actualEndDate || payload.actual_end_date),
  };
}

function normalizeListPayload(payload = {}) {
  return {
    name: safeTrim(payload.name),
    slug: slugify(payload.slug || payload.name, 'list'),
    color: asNullableString(payload.color),
    wip_limit: asInteger(payload.wipLimit || payload.wip_limit),
  };
}

function normalizeItemPayload(payload = {}) {
  return {
    parent_item_id: asNullableString(payload.parentItemId || payload.parent_item_id),
    list_id: asNullableString(payload.listId || payload.list_id),
    milestone_id: asNullableString(payload.milestoneId || payload.milestone_id),
    item_type: safeTrim(payload.itemType || payload.item_type, 'task') || 'task',
    title: safeTrim(payload.title),
    description: asNullableString(payload.description),
    status: safeTrim(payload.status, 'todo') || 'todo',
    priority: safeTrim(payload.priority, 'medium') || 'medium',
    severity: asNullableString(payload.severity),
    assignee_user_id: asNullableString(payload.assigneeUserId || payload.assignee_user_id),
    reporter_user_id: asNullableString(payload.reporterUserId || payload.reporter_user_id),
    story_points: asInteger(payload.storyPoints || payload.story_points),
    effort_estimate_minutes: asInteger(payload.effortEstimateMinutes || payload.effort_estimate_minutes),
    effort_actual_minutes: asInteger(payload.effortActualMinutes || payload.effort_actual_minutes),
    progress_percent: asInteger(payload.progressPercent || payload.progress_percent, 0) || 0,
    start_date: asNullableDate(payload.startDate || payload.start_date),
    due_date: asNullableDate(payload.dueDate || payload.due_date),
    position: asInteger(payload.position, 0) || 0,
    source_type: asNullableString(payload.sourceType || payload.source_type),
    source_id: asNullableString(payload.sourceId || payload.source_id),
    origin_context_json: sanitizeJson(payload.originContextJson || payload.origin_context_json, {}),
  };
}

function normalizeTemplatePayload(payload = {}) {
  return {
    name: safeTrim(payload.name),
    description: asNullableString(payload.description),
    template_json: sanitizeJson(payload.templateJson || payload.template_json, {}),
  };
}

function hasOwn(payload, key) {
  return Object.prototype.hasOwnProperty.call(payload || {}, key);
}

function buildProjectPatch(payload = {}) {
  const patch = {};
  if (hasOwn(payload, 'name')) patch.name = safeTrim(payload.name);
  if (hasOwn(payload, 'description')) patch.description = asNullableString(payload.description);
  if (hasOwn(payload, 'status')) patch.status = safeTrim(payload.status, 'active') || 'active';
  if (hasOwn(payload, 'priority')) patch.priority = safeTrim(payload.priority, 'medium') || 'medium';
  if (hasOwn(payload, 'health')) patch.health = safeTrim(payload.health, 'on_track') || 'on_track';
  if (hasOwn(payload, 'visibility')) patch.visibility = safeTrim(payload.visibility, 'private') || 'private';
  if (hasOwn(payload, 'ownerUserId') || hasOwn(payload, 'owner_user_id')) patch.owner_user_id = asNullableString(payload.ownerUserId || payload.owner_user_id);
  if (hasOwn(payload, 'startDate') || hasOwn(payload, 'start_date')) patch.start_date = asNullableDate(payload.startDate || payload.start_date);
  if (hasOwn(payload, 'targetEndDate') || hasOwn(payload, 'target_end_date')) patch.target_end_date = asNullableDate(payload.targetEndDate || payload.target_end_date);
  if (hasOwn(payload, 'actualEndDate') || hasOwn(payload, 'actual_end_date')) patch.actual_end_date = asNullableDate(payload.actualEndDate || payload.actual_end_date);
  return patch;
}

function buildListPatch(payload = {}) {
  const patch = {};
  if (hasOwn(payload, 'name')) patch.name = safeTrim(payload.name);
  if (hasOwn(payload, 'slug') || hasOwn(payload, 'name')) patch.slug = slugify(payload.slug || payload.name, 'list');
  if (hasOwn(payload, 'color')) patch.color = asNullableString(payload.color);
  if (hasOwn(payload, 'wipLimit') || hasOwn(payload, 'wip_limit')) patch.wip_limit = asInteger(payload.wipLimit || payload.wip_limit);
  return patch;
}

function buildItemPatch(payload = {}) {
  const patch = {};
  if (hasOwn(payload, 'parentItemId') || hasOwn(payload, 'parent_item_id')) patch.parent_item_id = asNullableString(payload.parentItemId || payload.parent_item_id);
  if (hasOwn(payload, 'listId') || hasOwn(payload, 'list_id')) patch.list_id = asNullableString(payload.listId || payload.list_id);
  if (hasOwn(payload, 'milestoneId') || hasOwn(payload, 'milestone_id')) patch.milestone_id = asNullableString(payload.milestoneId || payload.milestone_id);
  if (hasOwn(payload, 'itemType') || hasOwn(payload, 'item_type')) patch.item_type = safeTrim(payload.itemType || payload.item_type, 'task') || 'task';
  if (hasOwn(payload, 'title')) patch.title = safeTrim(payload.title);
  if (hasOwn(payload, 'description')) patch.description = asNullableString(payload.description);
  if (hasOwn(payload, 'status')) patch.status = safeTrim(payload.status, 'todo') || 'todo';
  if (hasOwn(payload, 'priority')) patch.priority = safeTrim(payload.priority, 'medium') || 'medium';
  if (hasOwn(payload, 'severity')) patch.severity = asNullableString(payload.severity);
  if (hasOwn(payload, 'assigneeUserId') || hasOwn(payload, 'assignee_user_id')) patch.assignee_user_id = asNullableString(payload.assigneeUserId || payload.assignee_user_id);
  if (hasOwn(payload, 'reporterUserId') || hasOwn(payload, 'reporter_user_id')) patch.reporter_user_id = asNullableString(payload.reporterUserId || payload.reporter_user_id);
  if (hasOwn(payload, 'storyPoints') || hasOwn(payload, 'story_points')) patch.story_points = asInteger(payload.storyPoints || payload.story_points);
  if (hasOwn(payload, 'effortEstimateMinutes') || hasOwn(payload, 'effort_estimate_minutes')) patch.effort_estimate_minutes = asInteger(payload.effortEstimateMinutes || payload.effort_estimate_minutes);
  if (hasOwn(payload, 'effortActualMinutes') || hasOwn(payload, 'effort_actual_minutes')) patch.effort_actual_minutes = asInteger(payload.effortActualMinutes || payload.effort_actual_minutes);
  if (hasOwn(payload, 'progressPercent') || hasOwn(payload, 'progress_percent')) patch.progress_percent = asInteger(payload.progressPercent || payload.progress_percent, 0) || 0;
  if (hasOwn(payload, 'startDate') || hasOwn(payload, 'start_date')) patch.start_date = asNullableDate(payload.startDate || payload.start_date);
  if (hasOwn(payload, 'dueDate') || hasOwn(payload, 'due_date')) patch.due_date = asNullableDate(payload.dueDate || payload.due_date);
  if (hasOwn(payload, 'position')) patch.position = asInteger(payload.position, 0) || 0;
  if (hasOwn(payload, 'sourceType') || hasOwn(payload, 'source_type')) patch.source_type = asNullableString(payload.sourceType || payload.source_type);
  if (hasOwn(payload, 'sourceId') || hasOwn(payload, 'source_id')) patch.source_id = asNullableString(payload.sourceId || payload.source_id);
  if (hasOwn(payload, 'originContextJson') || hasOwn(payload, 'origin_context_json')) patch.origin_context_json = sanitizeJson(payload.originContextJson || payload.origin_context_json, {});
  return patch;
}

async function requireProject(Project, tenantId, projectId, extra = {}) {
  const project = await Project.findOne({
    where: { id: projectId, tenant_id: tenantId },
    ...extra,
  });
  if (!project) {
    const error = new Error('Projeto nao encontrado');
    error.code = 'not_found';
    throw error;
  }
  return project;
}

async function requireProjectList(ProjectList, projectId, listId) {
  const list = await ProjectList.findOne({ where: { id: listId, project_id: projectId } });
  if (!list) {
    const error = new Error('Coluna nao encontrada');
    error.code = 'not_found';
    throw error;
  }
  return list;
}

async function requireProjectItem(ProjectItem, projectId, itemId, extra = {}) {
  const item = await ProjectItem.findOne({
    where: { id: itemId, project_id: projectId },
    ...extra,
  });
  if (!item) {
    const error = new Error('Item nao encontrado');
    error.code = 'not_found';
    throw error;
  }
  return item;
}

async function resolveTenantId(tenantRef) {
  const normalized = safeTrim(tenantRef);
  if (!normalized) return normalized;

  const { Tenant } = getModels();
  if (!Tenant || !Tenant.findOne) {
    return normalized;
  }

  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized);
    const where = isUuid
      ? { id: normalized }
      : { tenant_key: normalized };
    const tenant = await Tenant.findOne({
      where,
    });
    return tenant?.id || normalized;
  } catch (_) {
    return normalized;
  }
}

function inferStatusFromListSlug(slug, fallback) {
  if (!slug) return fallback || 'todo';
  if (slug === 'done') return 'done';
  if (slug === 'blocked') return 'blocked';
  if (slug === 'review') return 'review';
  if (slug === 'doing') return 'doing';
  if (slug === 'backlog') return 'backlog';
  return fallback || 'todo';
}

async function ensureFixture({ tenantId, actorUserId }) {
  const { Project, ProjectMember, ProjectItem, ProjectList, ProjectTemplate } = getModels();
  const existingCount = await Project.count({ where: { tenant_id: tenantId } });
  if (existingCount > 0) return;

  await createProject({
    tenantId,
    actorUserId,
    payload: {
      name: 'Projeto Demo RAP',
      description: 'Projeto inicial para validar board, comentarios e historico do modulo.',
      priority: 'high',
      health: 'on_track',
      visibility: 'team',
    },
    bootstrapItems: true,
  });

  const templateCount = await ProjectTemplate.count({ where: { tenant_id: tenantId } });
  if (templateCount === 0) {
    await ProjectTemplate.create({
      tenant_id: tenantId,
      name: 'Template Operacional Padrao',
      description: 'Estrutura inicial para rollout, QA e melhoria continua.',
      template_json: DEFAULT_TEMPLATE,
      created_by: actorUserId || null,
    });
  }

  const project = await Project.findOne({ where: { tenant_id: tenantId }, order: [['created_at', 'ASC']] });
  if (project) {
    const memberCount = await ProjectMember.count({ where: { project_id: project.id } });
    const itemCount = await ProjectItem.count({ where: { project_id: project.id } });
    if (memberCount === 0 && actorUserId) {
      await ProjectMember.create({
        project_id: project.id,
        user_id: actorUserId,
        role: 'project_owner',
        allocation_percent: 100,
      });
    }
    if (itemCount === 0) {
      const lists = await ProjectList.findAll({ where: { project_id: project.id }, order: [['position', 'ASC']] });
      const todoList = lists.find((entry) => entry.slug === 'todo') || lists[0];
      if (todoList) {
        await ProjectItem.create({
          project_id: project.id,
          list_id: todoList.id,
          item_type: 'task',
          title: 'Validar primeiro fluxo do board',
          description: 'Criado automaticamente para confirmar que a fixture do modulo esta ativa.',
          status: inferStatusFromListSlug(todoList.slug, 'todo'),
          priority: 'high',
          reporter_user_id: actorUserId || null,
          progress_percent: 10,
          position: 0,
          created_by: actorUserId || null,
          updated_by: actorUserId || null,
        });
      }
    }
  }
}

async function createProject({ tenantId, actorUserId, payload, bootstrapItems = false }) {
  const { Project, ProjectMember, ProjectList, ProjectItem, ProjectActivity } = getModels();
  const sequelize = Project.sequelize;
  const normalized = normalizeProjectPayload(payload);
  if (!normalized.name) {
    const error = new Error('name e obrigatorio');
    error.code = 'bad_request';
    throw error;
  }

  return sequelize.transaction(async (transaction) => {
    const code = normalized.code || await createProjectCode({ Project, tenantId, name: normalized.name });
    const project = await Project.create({
      ...normalized,
      tenant_id: tenantId,
      code,
      owner_user_id: normalized.owner_user_id || actorUserId || null,
      created_by: actorUserId || null,
      updated_by: actorUserId || null,
    }, { transaction });

    const lists = await createDefaultLists({ ProjectList, projectId: project.id, transaction });

    if (actorUserId) {
      await ProjectMember.create({
        project_id: project.id,
        user_id: actorUserId,
        role: 'project_owner',
        allocation_percent: 100,
      }, { transaction });
    }

    if (bootstrapItems) {
      const listMap = new Map(lists.map((entry) => [entry.slug, entry]));
      for (let index = 0; index < DEFAULT_TEMPLATE.items.length; index += 1) {
        const item = DEFAULT_TEMPLATE.items[index];
        const list = listMap.get(item.listSlug) || lists[0];
        await ProjectItem.create({
          project_id: project.id,
          list_id: list?.id || null,
          item_type: item.itemType,
          title: item.title,
          status: inferStatusFromListSlug(list?.slug, item.status),
          priority: item.priority,
          reporter_user_id: actorUserId || null,
          position: index,
          created_by: actorUserId || null,
          updated_by: actorUserId || null,
        }, { transaction });
      }
    }

    await createActivity({
      ProjectActivity,
      projectId: project.id,
      actorUserId,
      eventType: 'project.created',
      after: project.get({ plain: true }),
      transaction,
    });

    return project;
  });
}

async function listProjects({ tenantId, actorUserId, query = {} }) {
  const { Project, ProjectList, ProjectItem, ProjectMember } = getModels();
  await ensureFixture({ tenantId, actorUserId });

  const where = { tenant_id: tenantId };
  if (query.status) where.status = safeTrim(query.status);
  if (query.q) {
    const term = `%${safeTrim(query.q)}%`;
    where[Op.or] = [
      { name: { [Op.iLike]: term } },
      { code: { [Op.iLike]: term } },
      { description: { [Op.iLike]: term } },
    ];
  }

  const projects = await Project.findAll({
    where,
    order: [['updated_at', 'DESC'], ['created_at', 'DESC']],
    include: [
      { model: ProjectList, as: 'lists', required: false },
      { model: ProjectMember, as: 'members', required: false },
      { model: ProjectItem, as: 'items', required: false },
    ],
  });

  return projects.map((project) => {
    const plain = project.get({ plain: true });
    const items = Array.isArray(plain.items) ? plain.items : [];
    return {
      ...plain,
      kpis: {
        totalItems: items.length,
        doneItems: items.filter((item) => item.status === 'done').length,
        overdueItems: items.filter((item) => item.due_date && item.status !== 'done' && new Date(item.due_date).getTime() < Date.now()).length,
        memberCount: Array.isArray(plain.members) ? plain.members.length : 0,
      },
    };
  });
}

async function getProject({ tenantId, projectId }) {
  const { Project, ProjectList, ProjectMember, ProjectItem, ProjectActivity, ProjectMilestone } = getModels();
  const project = await requireProject(Project, tenantId, projectId, {
    include: [
      { model: ProjectList, as: 'lists', required: false },
      { model: ProjectMember, as: 'members', required: false },
      { model: ProjectItem, as: 'items', required: false },
      { model: ProjectActivity, as: 'activities', required: false, limit: 20, separate: true, order: [['created_at', 'DESC']] },
      { model: ProjectMilestone, as: 'milestones', required: false },
    ],
  });
  return project.get({ plain: true });
}

async function updateProject({ tenantId, actorUserId, projectId, payload }) {
  const { Project, ProjectActivity } = getModels();
  const project = await requireProject(Project, tenantId, projectId);
  const before = project.get({ plain: true });
  const patch = buildProjectPatch(payload);
  if (hasOwn(payload, 'name') && patch.name === '') {
    const error = new Error('name e obrigatorio');
    error.code = 'bad_request';
    throw error;
  }

  await project.update({
    ...patch,
    updated_by: actorUserId || null,
  });

  await createActivity({
    ProjectActivity,
    projectId: project.id,
    actorUserId,
    eventType: 'project.updated',
    before,
    after: project.get({ plain: true }),
  });

  return project.get({ plain: true });
}

async function deleteProject({ tenantId, actorUserId, projectId }) {
  const { Project, ProjectActivity } = getModels();
  const project = await requireProject(Project, tenantId, projectId);
  const before = project.get({ plain: true });
  await createActivity({
    ProjectActivity,
    projectId: project.id,
    actorUserId,
    eventType: 'project.deleted',
    before,
    after: {},
  });
  await project.destroy();
  return { ok: true };
}

async function listMembers({ tenantId, projectId }) {
  const { Project, ProjectMember, User } = getModels();
  await requireProject(Project, tenantId, projectId);
  const members = await ProjectMember.findAll({
    where: { project_id: projectId },
    include: [{ model: User, as: 'user', required: false }],
    order: [['created_at', 'ASC']],
  });
  return members.map((entry) => entry.get({ plain: true }));
}

async function addMember({ tenantId, actorUserId, projectId, payload }) {
  const { Project, ProjectMember, ProjectActivity } = getModels();
  await requireProject(Project, tenantId, projectId);
  const userId = asNullableString(payload.userId || payload.user_id);
  if (!userId) {
    const error = new Error('userId e obrigatorio');
    error.code = 'bad_request';
    throw error;
  }
  const [member] = await ProjectMember.findOrCreate({
    where: { project_id: projectId, user_id: userId },
    defaults: {
      project_id: projectId,
      user_id: userId,
      role: safeTrim(payload.role, 'project_contributor'),
      allocation_percent: asInteger(payload.allocationPercent || payload.allocation_percent, 100) || 100,
    },
  });
  await createActivity({
    ProjectActivity,
    projectId,
    actorUserId,
    eventType: 'project.member_added',
    after: member.get({ plain: true }),
  });
  return member.get({ plain: true });
}

async function removeMember({ tenantId, actorUserId, projectId, memberId }) {
  const { Project, ProjectMember, ProjectActivity } = getModels();
  await requireProject(Project, tenantId, projectId);
  const member = await ProjectMember.findOne({ where: { id: memberId, project_id: projectId } });
  if (!member) {
    const error = new Error('Membro nao encontrado');
    error.code = 'not_found';
    throw error;
  }
  const before = member.get({ plain: true });
  await member.destroy();
  await createActivity({
    ProjectActivity,
    projectId,
    actorUserId,
    eventType: 'project.member_removed',
    before,
    after: {},
  });
  return { ok: true };
}

async function listLists({ tenantId, projectId }) {
  const { Project, ProjectList, ProjectItem } = getModels();
  await requireProject(Project, tenantId, projectId);
  const lists = await ProjectList.findAll({
    where: { project_id: projectId },
    include: [{ model: ProjectItem, as: 'items', required: false }],
    order: [['position', 'ASC']],
  });
  return lists.map((entry) => entry.get({ plain: true }));
}

async function createList({ tenantId, actorUserId, projectId, payload }) {
  const { Project, ProjectList, ProjectActivity } = getModels();
  await requireProject(Project, tenantId, projectId);
  const normalized = normalizeListPayload(payload);
  if (!normalized.name) {
    const error = new Error('name e obrigatorio');
    error.code = 'bad_request';
    throw error;
  }
  const currentCount = await ProjectList.count({ where: { project_id: projectId } });
  const list = await ProjectList.create({
    project_id: projectId,
    ...normalized,
    position: currentCount,
  });
  await createActivity({
    ProjectActivity,
    projectId,
    actorUserId,
    eventType: 'project.list_created',
    after: list.get({ plain: true }),
  });
  return list.get({ plain: true });
}

async function updateList({ tenantId, actorUserId, projectId, listId, payload }) {
  const { Project, ProjectList, ProjectActivity } = getModels();
  await requireProject(Project, tenantId, projectId);
  const list = await requireProjectList(ProjectList, projectId, listId);
  const before = list.get({ plain: true });
  const patch = buildListPatch(payload);
  await list.update({
    ...patch,
  });
  await createActivity({
    ProjectActivity,
    projectId,
    actorUserId,
    eventType: 'project.list_updated',
    before,
    after: list.get({ plain: true }),
  });
  return list.get({ plain: true });
}

async function reorderLists({ tenantId, actorUserId, projectId, listIds = [] }) {
  const { Project, ProjectList, ProjectActivity } = getModels();
  await requireProject(Project, tenantId, projectId);
  const lists = await ProjectList.findAll({ where: { project_id: projectId } });
  const existing = new Map(lists.map((entry) => [entry.id, entry]));
  for (let index = 0; index < listIds.length; index += 1) {
    const list = existing.get(listIds[index]);
    if (list) {
      await list.update({ position: index });
    }
  }
  await createActivity({
    ProjectActivity,
    projectId,
    actorUserId,
    eventType: 'project.lists_reordered',
    after: { listIds },
  });
  return listProjects({ tenantId });
}

async function listItems({ tenantId, projectId, query = {} }) {
  const { Project, ProjectItem, ProjectComment, ProjectActivity, ProjectAttachment } = getModels();
  await requireProject(Project, tenantId, projectId);
  const where = { project_id: projectId };
  if (query.listId) where.list_id = query.listId;
  if (query.status) where.status = query.status;
  if (query.assigneeUserId) where.assignee_user_id = query.assigneeUserId;
  if (query.q) {
    const term = `%${safeTrim(query.q)}%`;
    where[Op.or] = [
      { title: { [Op.iLike]: term } },
      { description: { [Op.iLike]: term } },
    ];
  }
  const items = await ProjectItem.findAll({
    where,
    include: [
      { model: ProjectComment, as: 'comments', required: false },
      { model: ProjectActivity, as: 'activities', required: false },
      { model: ProjectAttachment, as: 'attachments', required: false },
    ],
    order: [['position', 'ASC'], ['created_at', 'ASC']],
  });
  return items.map((entry) => entry.get({ plain: true }));
}

async function createItem({ tenantId, actorUserId, projectId, payload }) {
  const { Project, ProjectItem, ProjectList, ProjectActivity } = getModels();
  await requireProject(Project, tenantId, projectId);
  const normalized = normalizeItemPayload(payload);
  if (!normalized.title) {
    const error = new Error('title e obrigatorio');
    error.code = 'bad_request';
    throw error;
  }
  let selectedListId = normalized.list_id;
  let selectedStatus = normalized.status;
  if (selectedListId) {
    const list = await requireProjectList(ProjectList, projectId, selectedListId);
    selectedStatus = inferStatusFromListSlug(list.slug, normalized.status);
  } else {
    const fallbackList = await ProjectList.findOne({
      where: { project_id: projectId },
      order: [['position', 'ASC']],
    });
    selectedListId = fallbackList?.id || null;
    selectedStatus = inferStatusFromListSlug(fallbackList?.slug, normalized.status);
  }
  const itemCount = await ProjectItem.count({
    where: {
      project_id: projectId,
      list_id: selectedListId,
    },
  });
  const item = await ProjectItem.create({
    ...normalized,
    project_id: projectId,
    list_id: selectedListId,
    status: selectedStatus,
    reporter_user_id: normalized.reporter_user_id || actorUserId || null,
    position: itemCount,
    created_by: actorUserId || null,
    updated_by: actorUserId || null,
  });
  await createActivity({
    ProjectActivity,
    projectId,
    itemId: item.id,
    actorUserId,
    eventType: 'project.item_created',
    after: item.get({ plain: true }),
  });
  return item.get({ plain: true });
}

async function getItem({ tenantId, projectId, itemId }) {
  const { Project, ProjectItem, ProjectComment, ProjectActivity, ProjectAttachment } = getModels();
  await requireProject(Project, tenantId, projectId);
  const item = await requireProjectItem(ProjectItem, projectId, itemId, {
    include: [
      { model: ProjectComment, as: 'comments', required: false },
      { model: ProjectActivity, as: 'activities', required: false, separate: true, order: [['created_at', 'DESC']] },
      { model: ProjectAttachment, as: 'attachments', required: false },
    ],
  });
  return item.get({ plain: true });
}

async function updateItem({ tenantId, actorUserId, projectId, itemId, payload }) {
  const { Project, ProjectItem, ProjectList, ProjectActivity } = getModels();
  await requireProject(Project, tenantId, projectId);
  const item = await requireProjectItem(ProjectItem, projectId, itemId);
  const before = item.get({ plain: true });
  const patch = buildItemPatch(payload);
  if (hasOwn(payload, 'title') && patch.title === '') {
    const error = new Error('title e obrigatorio');
    error.code = 'bad_request';
    throw error;
  }
  patch.updated_by = actorUserId || null;
  if (patch.list_id) {
    const list = await requireProjectList(ProjectList, projectId, patch.list_id);
    patch.status = inferStatusFromListSlug(list.slug, patch.status);
  }
  if (patch.status === 'done' && !item.completed_at) {
    patch.completed_at = new Date();
    patch.progress_percent = 100;
  }
  await item.update(patch);
  await createActivity({
    ProjectActivity,
    projectId,
    itemId,
    actorUserId,
    eventType: 'project.item_updated',
    before,
    after: item.get({ plain: true }),
  });
  return item.get({ plain: true });
}

async function deleteItem({ tenantId, actorUserId, projectId, itemId }) {
  const { Project, ProjectItem, ProjectActivity } = getModels();
  await requireProject(Project, tenantId, projectId);
  const item = await requireProjectItem(ProjectItem, projectId, itemId);
  const before = item.get({ plain: true });
  await createActivity({
    ProjectActivity,
    projectId,
    itemId,
    actorUserId,
    eventType: 'project.item_deleted',
    before,
    after: {},
  });
  await item.destroy();
  return { ok: true };
}

async function moveItem({ tenantId, actorUserId, projectId, itemId, payload }) {
  const { Project, ProjectItem, ProjectList, ProjectActivity } = getModels();
  await requireProject(Project, tenantId, projectId);
  const item = await requireProjectItem(ProjectItem, projectId, itemId);
  const targetListId = asNullableString(payload.listId || payload.list_id);
  const targetPosition = asInteger(payload.position, item.position) || 0;
  if (!targetListId) {
    const error = new Error('listId e obrigatorio');
    error.code = 'bad_request';
    throw error;
  }
  const targetList = await requireProjectList(ProjectList, projectId, targetListId);
  const before = item.get({ plain: true });
  await item.update({
    list_id: targetList.id,
    position: targetPosition,
    status: inferStatusFromListSlug(targetList.slug, item.status),
    progress_percent: targetList.slug === 'done' ? 100 : item.progress_percent,
    completed_at: targetList.slug === 'done' ? new Date() : null,
    updated_by: actorUserId || null,
  });
  await createActivity({
    ProjectActivity,
    projectId,
    itemId,
    actorUserId,
    eventType: 'project.item_moved',
    before,
    after: item.get({ plain: true }),
    metadata: { targetListId: targetList.id, targetListSlug: targetList.slug },
  });
  return item.get({ plain: true });
}

async function completeItem({ tenantId, actorUserId, projectId, itemId }) {
  const { Project, ProjectList } = getModels();
  await requireProject(Project, tenantId, projectId);
  const doneList = await ProjectList.findOne({
    where: { project_id: projectId, slug: 'done' },
  });
  return moveItem({
    tenantId,
    actorUserId,
    projectId,
    itemId,
    payload: { listId: doneList?.id, position: 0 },
  });
}

async function listComments({ tenantId, projectId, itemId }) {
  const { Project, ProjectItem, ProjectComment } = getModels();
  await requireProject(Project, tenantId, projectId);
  await requireProjectItem(ProjectItem, projectId, itemId);
  const comments = await ProjectComment.findAll({
    where: { item_id: itemId },
    order: [['created_at', 'ASC']],
  });
  return comments.map((entry) => entry.get({ plain: true }));
}

async function addComment({ tenantId, actorUserId, projectId, itemId, payload }) {
  const { Project, ProjectItem, ProjectComment, ProjectActivity } = getModels();
  await requireProject(Project, tenantId, projectId);
  await requireProjectItem(ProjectItem, projectId, itemId);
  const body = safeTrim(payload.body);
  if (!body) {
    const error = new Error('body e obrigatorio');
    error.code = 'bad_request';
    throw error;
  }
  const comment = await ProjectComment.create({
    item_id: itemId,
    author_user_id: actorUserId || null,
    body,
    is_system: false,
  });
  await createActivity({
    ProjectActivity,
    projectId,
    itemId,
    actorUserId,
    eventType: 'project.comment_created',
    after: comment.get({ plain: true }),
  });
  return comment.get({ plain: true });
}

async function getDashboard({ tenantId, projectId }) {
  const { Project, ProjectItem, ProjectList } = getModels();
  await requireProject(Project, tenantId, projectId);
  const [items, lists] = await Promise.all([
    ProjectItem.findAll({ where: { project_id: projectId } }),
    ProjectList.findAll({ where: { project_id: projectId }, order: [['position', 'ASC']] }),
  ]);
  const plainItems = items.map((entry) => entry.get({ plain: true }));
  const byStatus = {};
  const byType = {};
  for (const item of plainItems) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    byType[item.item_type] = (byType[item.item_type] || 0) + 1;
  }
  return {
    totals: {
      items: plainItems.length,
      done: plainItems.filter((item) => item.status === 'done').length,
      blocked: plainItems.filter((item) => item.status === 'blocked').length,
      overdue: plainItems.filter((item) => item.due_date && item.status !== 'done' && new Date(item.due_date).getTime() < Date.now()).length,
    },
    byStatus,
    byType,
    flow: lists.map((list) => ({
      id: list.id,
      name: list.name,
      slug: list.slug,
      count: plainItems.filter((item) => item.list_id === list.id).length,
    })),
  };
}

async function getTimeline({ tenantId, projectId }) {
  const { Project, ProjectMilestone, ProjectItem } = getModels();
  await requireProject(Project, tenantId, projectId);
  const [milestones, items] = await Promise.all([
    ProjectMilestone.findAll({ where: { project_id: projectId }, order: [['due_date', 'ASC']] }),
    ProjectItem.findAll({ where: { project_id: projectId }, order: [['due_date', 'ASC']] }),
  ]);
  return {
    milestones: milestones.map((entry) => entry.get({ plain: true })),
    scheduledItems: items
      .map((entry) => entry.get({ plain: true }))
      .filter((item) => item.start_date || item.due_date),
  };
}

async function listTemplates({ tenantId }) {
  const { ProjectTemplate } = getModels();
  const templates = await ProjectTemplate.findAll({
    where: {
      [Op.or]: [
        { tenant_id: tenantId },
        { tenant_id: null },
      ],
    },
    order: [['created_at', 'DESC']],
  });
  return templates.map((entry) => entry.get({ plain: true }));
}

async function createTemplate({ tenantId, actorUserId, payload }) {
  const { ProjectTemplate } = getModels();
  const normalized = normalizeTemplatePayload(payload);
  if (!normalized.name) {
    const error = new Error('name e obrigatorio');
    error.code = 'bad_request';
    throw error;
  }
  const template = await ProjectTemplate.create({
    tenant_id: tenantId,
    name: normalized.name,
    description: normalized.description,
    template_json: normalized.template_json,
    created_by: actorUserId || null,
  });
  return template.get({ plain: true });
}

async function createProjectFromTemplate({ tenantId, actorUserId, payload }) {
  const { ProjectTemplate, ProjectList, ProjectItem } = getModels();
  const templateId = asNullableString(payload.templateId || payload.template_id);
  if (!templateId) {
    const error = new Error('templateId e obrigatorio');
    error.code = 'bad_request';
    throw error;
  }
  const template = await ProjectTemplate.findOne({
    where: {
      id: templateId,
      [Op.or]: [{ tenant_id: tenantId }, { tenant_id: null }],
    },
  });
  if (!template) {
    const error = new Error('Template nao encontrado');
    error.code = 'not_found';
    throw error;
  }
  const project = await createProject({
    tenantId,
    actorUserId,
    payload: {
      name: payload.name || template.name,
      description: payload.description || template.description,
      priority: payload.priority || 'medium',
      visibility: payload.visibility || 'team',
    },
  });
  const plainProject = project.get({ plain: true });
  const templateJson = sanitizeJson(template.template_json, {});
  const lists = Array.isArray(templateJson.lists) ? templateJson.lists : DEFAULT_PROJECT_LISTS;
  const items = Array.isArray(templateJson.items) ? templateJson.items : [];

  await ProjectList.destroy({ where: { project_id: plainProject.id } });
  const createdLists = [];
  for (let index = 0; index < lists.length; index += 1) {
    const entry = lists[index];
    createdLists.push(await ProjectList.create({
      project_id: plainProject.id,
      name: safeTrim(entry.name) || `Lista ${index + 1}`,
      slug: slugify(entry.slug || entry.name || `lista-${index + 1}`),
      position: index,
      color: asNullableString(entry.color),
      wip_limit: asInteger(entry.wipLimit || entry.wip_limit),
    }));
  }
  const bySlug = new Map(createdLists.map((entry) => [entry.slug, entry]));
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const list = bySlug.get(slugify(item.listSlug || item.list_slug, 'todo')) || createdLists[0];
    await ProjectItem.create({
      project_id: plainProject.id,
      list_id: list?.id || null,
      item_type: safeTrim(item.itemType || item.item_type, 'task') || 'task',
      title: safeTrim(item.title) || `Item ${index + 1}`,
      description: asNullableString(item.description),
      status: inferStatusFromListSlug(list?.slug, safeTrim(item.status, 'todo')),
      priority: safeTrim(item.priority, 'medium') || 'medium',
      reporter_user_id: actorUserId || null,
      position: index,
      created_by: actorUserId || null,
      updated_by: actorUserId || null,
    });
  }
  return getProject({ tenantId, projectId: plainProject.id });
}

async function listActivities({ tenantId, projectId, itemId = null }) {
  const { Project, ProjectActivity } = getModels();
  await requireProject(Project, tenantId, projectId);
  const where = { project_id: projectId };
  if (itemId) where.item_id = itemId;
  const activities = await ProjectActivity.findAll({
    where,
    order: [['created_at', 'DESC']],
    limit: 100,
  });
  return activities.map((entry) => entry.get({ plain: true }));
}

module.exports = {
  DEFAULT_PROJECT_LISTS,
  listProjects: async (args = {}) => listProjects({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  createProject: async (args = {}) => createProject({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  getProject: async (args = {}) => getProject({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  updateProject: async (args = {}) => updateProject({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  deleteProject: async (args = {}) => deleteProject({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  listMembers: async (args = {}) => listMembers({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  addMember: async (args = {}) => addMember({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  removeMember: async (args = {}) => removeMember({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  listLists: async (args = {}) => listLists({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  createList: async (args = {}) => createList({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  updateList: async (args = {}) => updateList({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  reorderLists: async (args = {}) => reorderLists({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  listItems: async (args = {}) => listItems({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  createItem: async (args = {}) => createItem({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  getItem: async (args = {}) => getItem({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  updateItem: async (args = {}) => updateItem({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  deleteItem: async (args = {}) => deleteItem({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  moveItem: async (args = {}) => moveItem({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  completeItem: async (args = {}) => completeItem({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  listComments: async (args = {}) => listComments({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  addComment: async (args = {}) => addComment({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  getDashboard: async (args = {}) => getDashboard({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  getTimeline: async (args = {}) => getTimeline({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  listTemplates: async (args = {}) => listTemplates({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  createTemplate: async (args = {}) => createTemplate({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  createProjectFromTemplate: async (args = {}) => createProjectFromTemplate({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  listActivities: async (args = {}) => listActivities({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
  ensureFixture: async (args = {}) => ensureFixture({ ...args, tenantId: await resolveTenantId(args.tenantId) }),
};
