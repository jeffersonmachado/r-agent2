/**
 * Serviço de Departamentos (DB-only).
 *
 * Persistência:
 * - PostgreSQL (tabela departments)
 *
 * Observação:
 * - Mantém cache em memória para operações síncronas do server.
 */

const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { Department: DepartmentGetter } = require('../db/models');

/**
 * @typedef {Object} Department
 * @property {string} id - ID único do departamento
 * @property {string} name - Nome do departamento
 * @property {string} description - Descrição do departamento
 * @property {string[]} agentIds - IDs dos agentes do departamento
 * @property {string[]} queueNames - Nomes das filas associadas ao departamento
 * @property {string} color - Cor do departamento (hex) para UI
 * @property {boolean} active - Se está ativo
 * @property {string} createdAt - Data de criação (ISO string)
 * @property {string} updatedAt - Data da última atualização (ISO string)
 * @property {string|null} createdBy - ID do agente que criou
 */

/** @type {Map<string, Department>} */
const departments = new Map(); // id -> Department

function dbAvailable() {
  return !!getSequelize();
}

function safeTrim(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value).trim();
  } catch (_) {
    return fallback;
  }
}

function safeErrorMessage(err, fallback = '') {
  if (!err) return fallback;
  let message;
  try {
    message = err?.message;
  } catch (_) {
    message = null;
  }

  if (message !== null && message !== undefined) return safeTrim(message, fallback);
  return safeTrim(err, fallback);
}

function toDbPayload(dept) {
  if (!dept || !dept.tenantId || typeof dept.tenantId !== 'string' || dept.tenantId.trim() === '') {
    throw new Error('tenantId é obrigatório para Department');
  }
  return {
    id: dept.id,
    tenant_key: dept.tenantId,
    name: dept.name,
    description: dept.description || null,
    agent_ids: Array.isArray(dept.agentIds) ? dept.agentIds : [],
    queue_names: Array.isArray(dept.queueNames) ? dept.queueNames : [],
    color: dept.color || null,
    active: dept.active !== false,
    created_by: dept.createdBy || null,
  };
}

function fromDbRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_key || null,
    name: row.name,
    description: row.description || '',
    agentIds: Array.isArray(row.agent_ids) ? row.agent_ids : [],
    queueNames: Array.isArray(row.queue_names) ? row.queue_names : [],
    color: row.color || '#3B82F6',
    active: row.active !== false,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : (row.createdAt?.toISOString?.() || new Date().toISOString()),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : (row.updatedAt?.toISOString?.() || new Date().toISOString()),
    createdBy: row.created_by || null,
  };
}

async function upsertDepartmentToDb(dept) {
  if (!dbAvailable()) return;
  const DepartmentModel = typeof DepartmentGetter === 'function' ? DepartmentGetter() : DepartmentGetter;
  const payload = toDbPayload(dept);
  const now = new Date();

  const existing = await DepartmentModel.findByPk(dept.id);
  if (existing) {
    await existing.update({ ...payload, updated_at: now });
    return;
  }
  try {
    await DepartmentModel.create({ ...payload, created_at: now, updated_at: now });
  } catch (error) {
    const isUnique = error?.name === 'SequelizeUniqueConstraintError'
      || error?.original?.code === '23505'
      || error?.parent?.code === '23505';
    if (!isUnique) throw error;
    // Corrida de idempotência: insert concorrente do mesmo id. Re-fetch + update.
    const raced = await DepartmentModel.findByPk(dept.id);
    if (raced) {
      await raced.update({ ...payload, updated_at: now });
      return;
    }
    throw error;
  }
}

async function deleteDepartmentFromDb(id) {
  if (!dbAvailable()) return;
  const DepartmentModel = typeof DepartmentGetter === 'function' ? DepartmentGetter() : DepartmentGetter;
  await DepartmentModel.destroy({ where: { id } });
}

function persistDepartmentBestEffort(dept) {
  if (!dbAvailable()) return;
  setImmediate(() => {
    upsertDepartmentToDb(dept).catch((err) => {
      logger.warn('[DepartmentsService] Falha ao persistir departamento no PostgreSQL', { id: dept.id, error: safeErrorMessage(err) });
    });
  });
}

function deleteDepartmentBestEffort(id) {
  if (!dbAvailable()) return;
  setImmediate(() => {
    deleteDepartmentFromDb(id).catch((err) => {
      logger.warn('[DepartmentsService] Falha ao remover departamento no PostgreSQL', { id, error: safeErrorMessage(err) });
    });
  });
}

/**
 * Inicializa cache em memória a partir do PostgreSQL (best-effort).
 */
async function initialize() {
  if (!dbAvailable()) return;
  try {
    const DepartmentModel = typeof DepartmentGetter === 'function' ? DepartmentGetter() : DepartmentGetter;
    const rows = await DepartmentModel.findAll();
    departments.clear();
    for (const row of rows) {
      const dept = fromDbRow(row);
      departments.set(dept.id, dept);
    }

    if (departments.size === 0) {
      // Blindagem: não cria defaults automáticos em produção (multi-tenant obrigatório)
      logger.info('[DepartmentsService] Nenhum departamento encontrado. Nenhum default será criado automaticamente.', { count: 0 });
    } else {
      logger.info('[DepartmentsService] Cache inicializado do PostgreSQL', { count: departments.size });
    }
  } catch (err) {
    logger.warn('[DepartmentsService] Falha ao inicializar cache do PostgreSQL', { error: safeErrorMessage(err) });
  }
}

/**
 * Lista todos os departamentos.
 * @param {Object} filters - Filtros opcionais
 * @param {boolean} [filters.activeOnly] - Apenas ativos
 * @param {string} [filters.agentId] - Filtrar por agente
 * @returns {Department[]}
 */
function listDepartments(filters = {}) {
  let results = Array.from(departments.values());

  if (filters.tenantId) {
    results = results.filter((d) => d.tenantId === filters.tenantId);
  }
  
  if (filters.activeOnly !== false) {
    results = results.filter(d => d.active !== false);
  }
  
  if (filters.agentId) {
    results = results.filter(d => 
      Array.isArray(d.agentIds) && d.agentIds.includes(filters.agentId)
    );
  }
  
  // Ordena por nome
  results.sort((a, b) => a.name.localeCompare(b.name));
  
  return results;
}

/**
 * Obtém um departamento por ID.
 * @param {string} id
 * @param {string} [tenantId] - Se fornecido, valida isolamento multi-tenant
 * @returns {Department|null}
 */
function getDepartment(id, tenantId = null) {
  const dept = departments.get(id) || null;
  if (!dept) return null;
  if (tenantId && dept.tenantId && dept.tenantId !== tenantId) return null;
  return dept;
}

/**
 * Cria um novo departamento.
 * @param {Object} data
 * @param {string} data.name
 * @param {string} [data.description]
 * @param {string[]} [data.agentIds]
 * @param {string[]} [data.queueNames]
 * @param {string} [data.color]
 * @param {string} [data.createdBy]
 * @returns {{success: boolean, department?: Department, error?: string}}
 */
function createDepartment(data) {
  const { 
    name, 
    description = '', 
    agentIds = [], 
    queueNames = [], 
    color = '#3B82F6',
    createdBy = null,
    tenantId = null,
  } = data;
  const normalizedName = safeTrim(name);
  const normalizedDescription = safeTrim(description);
  const normalizedColor = safeTrim(color, '#3B82F6') || '#3B82F6';
  
  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
    return { success: false, error: 'tenantId é obrigatório' };
  }

  if (!normalizedName) {
    return { success: false, error: 'Nome do departamento é obrigatório' };
  }
  
  // Verifica se já existe departamento com o mesmo nome
  const normalizedNameLower = normalizedName.toLowerCase();
  const existing = Array.from(departments.values()).find(
    d => d.tenantId === tenantId && d.name.toLowerCase() === normalizedNameLower
  );
  if (existing) {
    return { success: false, error: 'Já existe um departamento com este nome' };
  }
  
  const id = `dept-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();
  
  const department = {
    id,
    tenantId,
    name: normalizedName,
    description: normalizedDescription,
    agentIds: Array.isArray(agentIds) ? agentIds : [],
    queueNames: Array.isArray(queueNames) ? queueNames : [],
    color: normalizedColor,
    active: true,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
  
  departments.set(id, department);
  persistDepartmentBestEffort(department);
  
  return { success: true, department };
}

/**
 * Atualiza um departamento.
 * @param {string} id
 * @param {Object} updates
 * @returns {{success: boolean, department?: Department, error?: string}}
 */
function updateDepartment(id, updates) {
  const existing = departments.get(id);
  if (!existing) {
    return { success: false, error: 'Departamento não encontrado' };
  }
  const updatedName = updates && Object.prototype.hasOwnProperty.call(updates, 'name')
    ? safeTrim(updates.name)
    : null;
  
  // Se está alterando o nome, verifica se não conflita com outro
  if (updatedName && updatedName !== existing.name) {
    const conflicting = Array.from(departments.values()).find(
      d => d.id !== id && d.name.toLowerCase() === updatedName.toLowerCase()
    );
    if (conflicting) {
      return { success: false, error: 'Já existe um departamento com este nome' };
    }
  }
  
  const updated = {
    ...existing,
    ...updates,
    id, // Garante que o ID não seja alterado
    updatedAt: new Date().toISOString(),
  };
  
  // Normaliza campos
  if (updated.name) updated.name = safeTrim(updated.name);
  if (updated.description) updated.description = safeTrim(updated.description);
  if (updated.agentIds) {
    updated.agentIds = Array.isArray(updated.agentIds) ? updated.agentIds : [];
  }
  if (updated.queueNames) {
    updated.queueNames = Array.isArray(updated.queueNames) ? updated.queueNames : [];
  }
  if (updated.color) updated.color = safeTrim(updated.color);
  
  departments.set(id, updated);
  persistDepartmentBestEffort(updated);
  
  return { success: true, department: updated };
}

/**
 * Remove um departamento.
 * @param {string} id
 * @returns {{success: boolean, error?: string}}
 */
function deleteDepartment(id) {
  const existing = departments.get(id);
  if (!existing) {
    return { success: false, error: 'Departamento não encontrado' };
  }
  
  departments.delete(id);
  deleteDepartmentBestEffort(id);
  
  return { success: true };
}

/**
 * Adiciona um agente a um departamento.
 * @param {string} departmentId
 * @param {string} agentId
 * @returns {{success: boolean, department?: Department, error?: string}}
 */
function addAgentToDepartment(departmentId, agentId) {
  const department = departments.get(departmentId);
  if (!department) {
    return { success: false, error: 'Departamento não encontrado' };
  }
  
  if (!Array.isArray(department.agentIds)) {
    department.agentIds = [];
  }
  
  if (!department.agentIds.includes(agentId)) {
    department.agentIds.push(agentId);
    department.updatedAt = new Date().toISOString();
    persistDepartmentBestEffort(department);
  }
  
  return { success: true, department };
}

/**
 * Remove um agente de um departamento.
 * @param {string} departmentId
 * @param {string} agentId
 * @returns {{success: boolean, department?: Department, error?: string}}
 */
function removeAgentFromDepartment(departmentId, agentId) {
  const department = departments.get(departmentId);
  if (!department) {
    return { success: false, error: 'Departamento não encontrado' };
  }
  
  if (Array.isArray(department.agentIds)) {
    department.agentIds = department.agentIds.filter(id => id !== agentId);
    department.updatedAt = new Date().toISOString();
    persistDepartmentBestEffort(department);
  }
  
  return { success: true, department };
}

/**
 * Obtém departamentos de um agente.
 * @param {string} agentId
 * @returns {Department[]}
 */
function getDepartmentsByAgent(agentId) {
  return Array.from(departments.values()).filter(
    d => Array.isArray(d.agentIds) && d.agentIds.includes(agentId) && d.active !== false
  );
}

/**
 * Obtém departamento de uma fila.
 * @param {string} queueName
 * @returns {Department|null}
 */
function getDepartmentByQueue(queueName) {
  return Array.from(departments.values()).find(
    d => Array.isArray(d.queueNames) && d.queueNames.includes(queueName) && d.active !== false
  ) || null;
}

module.exports = {
  initialize,
  listDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  addAgentToDepartment,
  removeAgentFromDepartment,
  getDepartmentsByAgent,
  getDepartmentByQueue,
};

