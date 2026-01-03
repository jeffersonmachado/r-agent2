/**
 * Helper reutilizável para validação de dados.
 * 
 * Este helper executa a validação de dados e retorna status global
 * para ser usado como gate antes de executar scripts de conversa.
 * 
 * Frase-guia: "Sem dados, testamos estrutura. Com dados, testamos comportamento."
 */

const { validateSystem } = require('../data/validators/system.validator');
const { loadTestData } = require('./testHelpers');

/**
 * Executa validação completa de dados e retorna status global.
 * 
 * @returns {object} Resultado da validação
 * @property {boolean} passed - Se a validação passou (sem erros bloqueantes)
 * @property {Array} errors - Lista de erros encontrados
 * @property {Array} warnings - Lista de warnings encontrados
 * @property {string} message - Mensagem descritiva do status
 */
function validateTestData() {
  const result = validateSystem();
  
  return {
    passed: result.valid === true && result.errors.length === 0,
    errors: result.errors,
    warnings: result.warnings,
    message: result.errors.length === 0 
      ? 'Validação de dados passou com sucesso'
      : `Validação de dados falhou: ${result.errors.length} erro(s) encontrado(s)`
  };
}

/**
 * Verifica se um conjunto específico de dados está disponível.
 * 
 * @param {Array<string>} requiredData - Lista de tipos de dados requeridos
 * @returns {object} Resultado da verificação
 * @property {boolean} available - Se todos os dados requeridos estão disponíveis
 * @property {Array<string>} missing - Lista de dados faltando
 */
function checkRequiredData(requiredData = []) {
  const missing = [];
  const dataMap = {
    'departments': 'departments.json',
    'queues': 'queues.json',
    'agents': 'agents.json',
    'config': 'config.json',
    'flows': 'flows.json'
  };
  
  for (const dataType of requiredData) {
    const filename = dataMap[dataType];
    if (!filename) {
      missing.push(dataType);
      continue;
    }
    
    const data = loadTestData(filename);
    if (!data) {
      missing.push(dataType);
      continue;
    }
    
    // Para queues.json, verifica se tem a propriedade 'queues' com conteúdo
    if (dataType === 'queues') {
      if (Array.isArray(data)) {
        if (data.length === 0) {
          missing.push(dataType);
        }
      } else if (data.queues && typeof data.queues === 'object') {
        if (Object.keys(data.queues).length === 0) {
          missing.push(dataType);
        }
      } else {
        missing.push(dataType);
      }
    } else if (Array.isArray(data) && data.length === 0) {
      missing.push(dataType);
    } else if (!Array.isArray(data) && typeof data === 'object' && Object.keys(data).length === 0) {
      missing.push(dataType);
    }
  }
  
  return {
    available: missing.length === 0,
    missing
  };
}

/**
 * Valida dependências de um script de conversa.
 * 
 * CONTRATO FORMAL:
 * - Scripts DEVEM declarar todas as dependências no campo "requires" (array simples)
 * - Scripts PODEM declarar detalhes específicos em "requiresDetails" (ex: IDs específicos)
 * - Se faltar algo, script NÃO pode ser executado
 * 
 * @param {object} script - Script de conversa com campo 'requires'
 * @returns {object} Resultado da validação
 * @property {boolean} valid - Se todas as dependências estão disponíveis
 * @property {Array<string>} missing - Lista de dependências faltando
 */
function validateScriptRequirements(script) {
  if (!script.requires) {
    return {
      valid: false,
      missing: ['requires'],
      message: 'Script não declara dependências. Campo "requires" é obrigatório.'
    };
  }
  
  const required = [];
  
  // Formato novo (array simples) - PREFERIDO
  if (Array.isArray(script.requires)) {
    required.push(...script.requires);
  } else if (typeof script.requires === 'object') {
    // Formato antigo (objeto) - COMPATIBILIDADE
    if (script.requires.departments) {
      required.push('departments');
    }
    if (script.requires.queues) {
      required.push('queues');
    }
    if (script.requires.agents) {
      required.push('agents');
    }
    if (script.requires.flows) {
      required.push('flows');
    }
    if (script.requires.config) {
      required.push('config');
    }
  }
  
  // Valida dependências básicas
  const check = checkRequiredData(required);
  
  // Valida dependências específicas (requiresDetails)
  const missingDetails = [];
  if (script.requiresDetails && typeof script.requiresDetails === 'object') {
    // Valida IDs específicos de queues, agents, flows
    if (script.requiresDetails.queues && Array.isArray(script.requiresDetails.queues)) {
      const queuesData = loadTestData('queues.json') || {};
      // queues.json pode ser um objeto com propriedade 'queues' ou um array direto
      let queueIds = [];
      if (Array.isArray(queuesData)) {
        queueIds = queuesData.map(q => q.id || q.name || (typeof q === 'string' ? q : null)).filter(Boolean);
      } else if (queuesData.queues && typeof queuesData.queues === 'object') {
        // Converte objeto de queues em array de IDs
        // Prioriza: id do objeto > chave do objeto > name do objeto
        queueIds = Object.entries(queuesData.queues).map(([key, value]) => {
          if (typeof value === 'object' && value !== null) {
            // Se o objeto tem id, usa o id; caso contrário, usa a chave (que é o identificador real)
            return value.id || key;
          }
          return key;
        }).filter(Boolean);
      }
      for (const requiredQueueId of script.requiresDetails.queues) {
        if (!queueIds.includes(requiredQueueId)) {
          missingDetails.push(`queue:${requiredQueueId}`);
        }
      }
    }
    
    if (script.requiresDetails.agents && Array.isArray(script.requiresDetails.agents)) {
      const agents = loadTestData('agents.json') || [];
      const agentIds = Array.isArray(agents) ? agents.map(a => a.id || a.email) : [];
      for (const requiredAgentId of script.requiresDetails.agents) {
        if (!agentIds.includes(requiredAgentId)) {
          missingDetails.push(`agent:${requiredAgentId}`);
        }
      }
    }
    
    if (script.requiresDetails.flows && Array.isArray(script.requiresDetails.flows)) {
      const flows = loadTestData('flows.json') || [];
      const flowIds = Array.isArray(flows) ? flows.map(f => f.id) : [];
      for (const requiredFlowId of script.requiresDetails.flows) {
        if (!flowIds.includes(requiredFlowId)) {
          missingDetails.push(`flow:${requiredFlowId}`);
        }
      }
    }
  }
  
  const allValid = check.available && missingDetails.length === 0;
  
  return {
    valid: allValid,
    missing: [...check.missing, ...missingDetails],
    message: allValid
      ? 'Todas as dependências estão disponíveis'
      : `Dependências faltando: ${[...check.missing, ...missingDetails].join(', ')}`
  };
}

module.exports = {
  validateTestData,
  checkRequiredData,
  validateScriptRequirements
};

