/**
 * Validador de fluxos.
 * 
 * Verifica:
 * - Existência de fluxos
 * - IDs únicos
 * - Estrutura básica válida
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../../api/data/test');
const FLOWS_FILE = path.join(DATA_DIR, 'flows.json');

function validateFlows() {
  const errors = [];
  const warnings = [];
  
  // Verifica se arquivo existe
  if (!fs.existsSync(FLOWS_FILE)) {
    errors.push({
      validator: 'flows.validator',
      level: 'error',
      message: 'Arquivo de fluxos não encontrado',
      details: {
        file: FLOWS_FILE
      }
    });
    return { errors, warnings };
  }
  
  // Carrega fluxos
  let flows;
  try {
    const content = fs.readFileSync(FLOWS_FILE, 'utf8');
    flows = JSON.parse(content);
  } catch (error) {
    errors.push({
      validator: 'flows.validator',
      level: 'error',
      message: 'Erro ao carregar arquivo de fluxos',
      details: {
        error: error.message
      }
    });
    return { errors, warnings };
  }
  
  if (!Array.isArray(flows)) {
    errors.push({
      validator: 'flows.validator',
      level: 'error',
      message: 'Fluxos devem ser um array',
      details: {
        type: typeof flows
      }
    });
    return { errors, warnings };
  }
  
  if (flows.length === 0) {
    errors.push({
      validator: 'flows.validator',
      level: 'error',
      message: 'Nenhum fluxo encontrado'
    });
    return { errors, warnings };
  }
  
  const ids = new Set();
  
  for (const flow of flows) {
    // Valida estrutura básica
    if (!flow.id) {
      errors.push({
        validator: 'flows.validator',
        level: 'error',
        message: 'Fluxo sem ID',
        details: { flow }
      });
      continue;
    }
    
    if (!flow.nodes || !Array.isArray(flow.nodes)) {
      errors.push({
        validator: 'flows.validator',
        level: 'error',
        message: 'Fluxo sem nodes ou nodes inválido',
        details: { flowId: flow.id }
      });
      continue;
    }
    
    if (flow.nodes.length === 0) {
      warnings.push({
        validator: 'flows.validator',
        level: 'warning',
        message: 'Fluxo sem nodes',
        details: { flowId: flow.id }
      });
    }
    
    // Verifica IDs únicos
    if (ids.has(flow.id)) {
      errors.push({
        validator: 'flows.validator',
        level: 'error',
        message: 'ID de fluxo duplicado',
        details: { flowId: flow.id }
      });
    }
    ids.add(flow.id);
  }
  
  return { errors, warnings };
}

module.exports = { validateFlows };










