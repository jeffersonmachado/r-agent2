/**
 * Validador de agentes.
 * 
 * Verifica:
 * - Existência de agentes obrigatórios
 * - Estrutura válida
 * - IDs únicos
 * - Usernames únicos
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../../api/data/test');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');

function validateAgents() {
  const errors = [];
  const warnings = [];
  
  // Verifica se arquivo existe
  if (!fs.existsSync(AGENTS_FILE)) {
    errors.push({
      validator: 'agents.validator',
      level: 'error',
      message: 'Arquivo de agentes não encontrado',
      details: {
        file: AGENTS_FILE
      }
    });
    return { errors, warnings };
  }
  
  // Carrega agentes
  let agents;
  try {
    const content = fs.readFileSync(AGENTS_FILE, 'utf8');
    agents = JSON.parse(content);
  } catch (error) {
    errors.push({
      validator: 'agents.validator',
      level: 'error',
      message: 'Erro ao carregar arquivo de agentes',
      details: {
        error: error.message
      }
    });
    return { errors, warnings };
  }
  
  if (!Array.isArray(agents)) {
    errors.push({
      validator: 'agents.validator',
      level: 'error',
      message: 'Agentes devem ser um array',
      details: {
        type: typeof agents
      }
    });
    return { errors, warnings };
  }
  
  if (agents.length === 0) {
    errors.push({
      validator: 'agents.validator',
      level: 'error',
      message: 'Nenhum agente encontrado'
    });
    return { errors, warnings };
  }
  
  // Verifica agentes obrigatórios
  const requiredRoles = ['admin', 'supervisor', 'agent'];
  const foundRoles = new Set();
  const ids = new Set();
  const usernames = new Set();
  
  for (const agent of agents) {
    // Valida estrutura
    if (!agent.id) {
      errors.push({
        validator: 'agents.validator',
        level: 'error',
        message: 'Agente sem ID',
        details: { agent }
      });
      continue;
    }
    
    if (!agent.username) {
      errors.push({
        validator: 'agents.validator',
        level: 'error',
        message: 'Agente sem username',
        details: { agentId: agent.id }
      });
      continue;
    }
    
    if (!agent.role) {
      errors.push({
        validator: 'agents.validator',
        level: 'error',
        message: 'Agente sem role',
        details: { agentId: agent.id }
      });
      continue;
    }
    
    if (agent.active === undefined) {
      warnings.push({
        validator: 'agents.validator',
        level: 'warning',
        message: 'Agente sem campo active',
        details: { agentId: agent.id }
      });
    }
    
    // Verifica IDs únicos
    if (ids.has(agent.id)) {
      errors.push({
        validator: 'agents.validator',
        level: 'error',
        message: 'ID duplicado',
        details: { agentId: agent.id }
      });
    }
    ids.add(agent.id);
    
    // Verifica usernames únicos
    if (usernames.has(agent.username)) {
      errors.push({
        validator: 'agents.validator',
        level: 'error',
        message: 'Username duplicado',
        details: { username: agent.username }
      });
    }
    usernames.add(agent.username);
    
    // Verifica roles obrigatórias
    if (requiredRoles.includes(agent.role)) {
      foundRoles.add(agent.role);
    }
  }
  
  // Verifica se todas as roles obrigatórias estão presentes
  for (const role of requiredRoles) {
    if (!foundRoles.has(role)) {
      errors.push({
        validator: 'agents.validator',
        level: 'error',
        message: `Falta agente com role: ${role}`,
        details: { requiredRole: role }
      });
    }
  }
  
  return { errors, warnings };
}

module.exports = { validateAgents };









