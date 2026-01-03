/**
 * Serviço de Departamentos.
 *
 * Responsabilidades:
 * - Gerenciar departamentos da organização
 * - Associar agentes a departamentos
 * - Gerenciar filas por departamento
 * - Persistir dados em arquivo JSON
 *
 * Persistência:
 * - Departamentos: api/data/departments.json
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

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

// Armazenamento em memória
/** @type {Map<string, Department>} */
const departments = new Map();

// Caminho do arquivo de persistência
const dataDir = path.join(__dirname, '..', 'data');
const departmentsFile = path.join(dataDir, 'departments.json');

/**
 * Garante que o diretório de dados existe.
 */
function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Salva departamentos no arquivo JSON.
 */
function saveDepartmentsToFile() {
  try {
    ensureDataDir();
    const departmentsArray = Array.from(departments.values());
    const data = {
      departments: departmentsArray,
      savedAt: new Date().toISOString(),
    };
    const jsonData = JSON.stringify(data, null, 2);
    fs.writeFileSync(departmentsFile, jsonData, 'utf8');
    logger.debug(`[Departments] Dados salvos: ${departmentsArray.length} departamento(s)`);
  } catch (err) {
    logger.error('[Departments] Erro ao salvar dados no arquivo:', err);
  }
}

/**
 * Carrega departamentos do arquivo JSON.
 */
function loadDepartmentsFromFile() {
  try {
    ensureDataDir();
    if (!fs.existsSync(departmentsFile)) {
      logger.info(`[Departments] Arquivo não encontrado: ${departmentsFile}. Iniciando com dados vazios.`);
      // Cria alguns departamentos padrão
      createDefaultDepartments();
      return;
    }
    const data = fs.readFileSync(departmentsFile, 'utf8');
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed.departments)) {
      departments.clear();
      for (const dept of parsed.departments) {
        if (dept && dept.id) {
          departments.set(dept.id, dept);
        }
      }
    }
    logger.info(`[Departments] Dados carregados: ${departments.size} departamento(s)`);
  } catch (err) {
    logger.error('[Departments] Erro ao carregar dados do arquivo:', err);
    // Cria departamentos padrão em caso de erro
    createDefaultDepartments();
  }
}

/**
 * Cria departamentos padrão.
 */
function createDefaultDepartments() {
  const defaults = [
    {
      id: 'dept-001',
      name: 'Atendimento Geral',
      description: 'Departamento de atendimento geral ao cliente',
      agentIds: [],
      queueNames: ['suporte'],
      color: '#3B82F6',
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: null,
    },
    {
      id: 'dept-002',
      name: 'Vendas',
      description: 'Departamento de vendas e comercial',
      agentIds: [],
      queueNames: ['vendas'],
      color: '#10B981',
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: null,
    },
    {
      id: 'dept-003',
      name: 'Suporte Técnico',
      description: 'Departamento de suporte técnico',
      agentIds: [],
      queueNames: ['tecnico'],
      color: '#F59E0B',
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: null,
    },
  ];
  
  for (const dept of defaults) {
    departments.set(dept.id, dept);
  }
  saveDepartmentsToFile();
}

// Carrega dados ao iniciar o módulo
loadDepartmentsFromFile();

/**
 * Lista todos os departamentos.
 * @param {Object} filters - Filtros opcionais
 * @param {boolean} [filters.activeOnly] - Apenas ativos
 * @param {string} [filters.agentId] - Filtrar por agente
 * @returns {Department[]}
 */
function listDepartments(filters = {}) {
  let results = Array.from(departments.values());
  
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
 * @returns {Department|null}
 */
function getDepartment(id) {
  return departments.get(id) || null;
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
    createdBy = null 
  } = data;
  
  if (!name || name.trim() === '') {
    return { success: false, error: 'Nome do departamento é obrigatório' };
  }
  
  // Verifica se já existe departamento com o mesmo nome
  const existing = Array.from(departments.values()).find(
    d => d.name.toLowerCase() === name.toLowerCase().trim()
  );
  if (existing) {
    return { success: false, error: 'Já existe um departamento com este nome' };
  }
  
  const id = `dept-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();
  
  const department = {
    id,
    name: name.trim(),
    description: description.trim(),
    agentIds: Array.isArray(agentIds) ? agentIds : [],
    queueNames: Array.isArray(queueNames) ? queueNames : [],
    color: color.trim(),
    active: true,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
  
  departments.set(id, department);
  saveDepartmentsToFile();
  
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
  
  // Se está alterando o nome, verifica se não conflita com outro
  if (updates.name && updates.name.trim() !== existing.name) {
    const conflicting = Array.from(departments.values()).find(
      d => d.id !== id && d.name.toLowerCase() === updates.name.toLowerCase().trim()
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
  if (updated.name) updated.name = updated.name.trim();
  if (updated.description) updated.description = updated.description.trim();
  if (updated.agentIds) {
    updated.agentIds = Array.isArray(updated.agentIds) ? updated.agentIds : [];
  }
  if (updated.queueNames) {
    updated.queueNames = Array.isArray(updated.queueNames) ? updated.queueNames : [];
  }
  if (updated.color) updated.color = updated.color.trim();
  
  departments.set(id, updated);
  saveDepartmentsToFile();
  
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
  saveDepartmentsToFile();
  
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
    saveDepartmentsToFile();
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
    saveDepartmentsToFile();
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
  listDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  addAgentToDepartment,
  removeAgentFromDepartment,
  getDepartmentsByAgent,
  getDepartmentByQueue,
  loadDepartmentsFromFile,
};

