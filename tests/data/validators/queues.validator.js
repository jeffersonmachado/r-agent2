/**
 * Validador de filas.
 * 
 * Verifica:
 * - Existência de filas
 * - Estrutura válida
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../../api/data/test');
const QUEUES_FILE = path.join(DATA_DIR, 'queues.json');

function validateQueues() {
  const errors = [];
  const warnings = [];
  
  // Verifica se arquivo existe
  if (!fs.existsSync(QUEUES_FILE)) {
    errors.push({
      validator: 'queues.validator',
      level: 'error',
      message: 'Arquivo de filas não encontrado',
      details: {
        file: QUEUES_FILE
      }
    });
    return { errors, warnings };
  }
  
  // Carrega filas
  let queuesData;
  try {
    const content = fs.readFileSync(QUEUES_FILE, 'utf8');
    queuesData = JSON.parse(content);
  } catch (error) {
    errors.push({
      validator: 'queues.validator',
      level: 'error',
      message: 'Erro ao carregar arquivo de filas',
      details: {
        error: error.message
      }
    });
    return { errors, warnings };
  }
  
  if (!queuesData.queues || typeof queuesData.queues !== 'object') {
    errors.push({
      validator: 'queues.validator',
      level: 'error',
      message: 'Estrutura de filas inválida',
      details: {
        hasQueues: !!queuesData.queues
      }
    });
    return { errors, warnings };
  }
  
  const queueNames = Object.keys(queuesData.queues);
  
  if (queueNames.length === 0) {
    errors.push({
      validator: 'queues.validator',
      level: 'error',
      message: 'Nenhuma fila encontrada'
    });
    return { errors, warnings };
  }
  
  // Valida estrutura de cada fila
  for (const queueName of queueNames) {
    const queue = queuesData.queues[queueName];
    
    if (!queue.name) {
      warnings.push({
        validator: 'queues.validator',
        level: 'warning',
        message: 'Fila sem nome',
        details: { queueName }
      });
    }
  }
  
  return { errors, warnings };
}

module.exports = { validateQueues };

















