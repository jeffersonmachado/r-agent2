/**
 * Validador geral do sistema.
 * 
 * Verifica:
 * - Integridade referencial geral
 * - Estados válidos
 * - Configuração mínima do bot
 */

const { validateAgents } = require('./agents.validator');
const { validateFlows } = require('./flows.validator');
const { validateQueues } = require('./queues.validator');
const { validateDepartments } = require('./departments.validator');
const { validateConfig } = require('./config.validator');

function validateSystem() {
  const errors = [];
  const warnings = [];
  
  // Executa todos os validadores
  const agentsResult = validateAgents();
  const flowsResult = validateFlows();
  const queuesResult = validateQueues();
  const departmentsResult = validateDepartments();
  const configResult = validateConfig();
  
  // Agrega erros e warnings
  errors.push(...agentsResult.errors);
  errors.push(...flowsResult.errors);
  errors.push(...queuesResult.errors);
  errors.push(...departmentsResult.errors);
  errors.push(...configResult.errors);
  
  warnings.push(...agentsResult.warnings);
  warnings.push(...flowsResult.warnings);
  warnings.push(...queuesResult.warnings);
  warnings.push(...departmentsResult.warnings);
  warnings.push(...configResult.warnings);
  
  // Verifica configuração mínima
  if (errors.length === 0) {
    // Se não há erros, sistema está válido
    return { errors, warnings, valid: true };
  }
  
  return { errors, warnings, valid: false };
}

module.exports = { validateSystem };





















