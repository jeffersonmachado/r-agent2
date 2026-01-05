/**
 * Validador de departamentos.
 * 
 * Verifica:
 * - Existência de departamentos
 * - Referências válidas (filas, agentes)
 * - IDs únicos
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../../api/data/test');
const DEPARTMENTS_FILE = path.join(DATA_DIR, 'departments.json');
const QUEUES_FILE = path.join(DATA_DIR, 'queues.json');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');

function loadData(file) {
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const content = fs.readFileSync(file, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function validateDepartments() {
  const errors = [];
  const warnings = [];
  
  // Carrega dados necessários
  const departmentsData = loadData(DEPARTMENTS_FILE);
  const queuesData = loadData(QUEUES_FILE);
  const agentsData = loadData(AGENTS_FILE);
  
  if (!departmentsData) {
    errors.push({
      validator: 'departments.validator',
      level: 'error',
      message: 'Arquivo de departamentos não encontrado',
      details: {
        file: DEPARTMENTS_FILE
      }
    });
    return { errors, warnings };
  }
  
  if (!Array.isArray(departmentsData.departments)) {
    errors.push({
      validator: 'departments.validator',
      level: 'error',
      message: 'Departamentos devem ser um array',
      details: {
        type: typeof departmentsData.departments
      }
    });
    return { errors, warnings };
  }
  
  const departments = departmentsData.departments;
  const ids = new Set();
  const agentIds = new Set();
  const queueNames = new Set();
  
  // Coleta IDs de agentes e nomes de filas para validação
  if (agentsData && Array.isArray(agentsData)) {
    for (const agent of agentsData) {
      if (agent.id) {
        agentIds.add(agent.id);
      }
    }
  }
  
  if (queuesData && queuesData.queues) {
    for (const queueName of Object.keys(queuesData.queues)) {
      queueNames.add(queueName);
    }
  }
  
  // Valida cada departamento
  for (const dept of departments) {
    if (!dept.id) {
      errors.push({
        validator: 'departments.validator',
        level: 'error',
        message: 'Departamento sem ID',
        details: { dept }
      });
      continue;
    }
    
    // Verifica IDs únicos
    if (ids.has(dept.id)) {
      errors.push({
        validator: 'departments.validator',
        level: 'error',
        message: 'ID de departamento duplicado',
        details: { deptId: dept.id }
      });
    }
    ids.add(dept.id);
    
    // Valida referências de filas
    if (dept.queueNames && Array.isArray(dept.queueNames)) {
      for (const queueName of dept.queueNames) {
        if (queueNames.size > 0 && !queueNames.has(queueName)) {
          warnings.push({
            validator: 'departments.validator',
            level: 'warning',
            message: 'Departamento referencia fila inexistente',
            details: {
              deptId: dept.id,
              queueName
            }
          });
        }
      }
    }
    
    // Valida referências de agentes
    if (dept.agentIds && Array.isArray(dept.agentIds)) {
      for (const agentId of dept.agentIds) {
        if (agentIds.size > 0 && !agentIds.has(agentId)) {
          warnings.push({
            validator: 'departments.validator',
            level: 'warning',
            message: 'Departamento referencia agente inexistente',
            details: {
              deptId: dept.id,
              agentId
            }
          });
        }
      }
    }
  }
  
  return { errors, warnings };
}

module.exports = { validateDepartments };


















