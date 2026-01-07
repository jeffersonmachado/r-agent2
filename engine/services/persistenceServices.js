/**
 * Serviços de persistência disponíveis para nós.
 * 
 * Permite que nós acessem dados de flows, queues e config
 * sem acoplar a engine diretamente aos arquivos.
 * 
 * Uso:
 *   const deps = { persistence: require('./services/persistenceServices') };
 *   const flows = await deps.persistence.getFlows();
 */

const fs = require('fs');
const path = require('path');

// Caminhos dos arquivos
const dataDir = path.join(__dirname, '..', '..', 'api', 'data');
const flowsFile = path.join(dataDir, 'flows.json');
const queuesFile = path.join(dataDir, 'queues.json');
const configFile = path.join(dataDir, 'config.json');

/**
 * Lê todos os fluxos disponíveis.
 * 
 * @returns {Promise<Array<Object>>} Lista de fluxos
 */
async function getFlows() {
  try {
    if (fs.existsSync(flowsFile)) {
      const data = fs.readFileSync(flowsFile, 'utf8');
      const flows = JSON.parse(data);
      return Array.isArray(flows) ? flows : [];
    }
    return [];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[PersistenceServices] Erro ao ler flows:', err.message);
    return [];
  }
}

/**
 * Obtém um fluxo específico por ID.
 * 
 * @param {string} flowId - ID do fluxo
 * @returns {Promise<Object|null>} Fluxo encontrado ou null
 */
async function getFlow(flowId) {
  if (!flowId || typeof flowId !== 'string') {
    return null;
  }
  
  try {
    const flows = await getFlows();
    return flows.find(f => f && f.id === flowId) || null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[PersistenceServices] Erro ao buscar fluxo:', err.message);
    return null;
  }
}

/**
 * Busca fluxos por critério.
 * 
 * @param {Object} criteria - Critérios de busca
 * @param {string} [criteria.tenantId] - Filtrar por tenant
 * @param {string} [criteria.name] - Filtrar por nome (contém)
 * @returns {Promise<Array<Object>>} Fluxos encontrados
 */
async function findFlows(criteria = {}) {
  try {
    const flows = await getFlows();
    
    return flows.filter(flow => {
      if (!flow) return false;
      
      if (criteria.tenantId && flow.tenantId !== criteria.tenantId) {
        return false;
      }
      
      if (criteria.name && flow.name) {
        const flowName = String(flow.name).toLowerCase();
        const searchName = String(criteria.name).toLowerCase();
        if (!flowName.includes(searchName)) {
          return false;
        }
      }
      
      return true;
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[PersistenceServices] Erro ao buscar fluxos:', err.message);
    return [];
  }
}

/**
 * Lê dados de filas e tickets.
 * 
 * @returns {Promise<Object>} Dados de filas e tickets
 */
async function getQueuesData() {
  try {
    if (fs.existsSync(queuesFile)) {
      const data = fs.readFileSync(queuesFile, 'utf8');
      return JSON.parse(data);
    }
    return { tickets: [], queues: {} };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[PersistenceServices] Erro ao ler queues:', err.message);
    return { tickets: [], queues: {} };
  }
}

/**
 * Obtém tickets de uma fila específica.
 * 
 * @param {string} queueName - Nome da fila
 * @param {Object} [options] - Opções de filtro
 * @param {string} [options.status] - Filtrar por status
 * @returns {Promise<Array>} Lista de tickets
 */
async function getQueueTickets(queueName, options = {}) {
  if (!queueName || typeof queueName !== 'string') {
    return [];
  }
  
  try {
    const data = await getQueuesData();
    const queue = data.queues[queueName] || [];
    const tickets = data.tickets || [];
    
    let result = queue
      .map(id => tickets.find(t => t && t.id === id))
      .filter(Boolean);
    
    // Filtra por status se especificado
    if (options.status) {
      result = result.filter(t => t.status === options.status);
    }
    
    return result;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[PersistenceServices] Erro ao buscar tickets:', err.message);
    return [];
  }
}

/**
 * Obtém informações sobre uma fila.
 * 
 * @param {string} queueName - Nome da fila
 * @returns {Promise<Object>} Informações da fila
 */
async function getQueueInfo(queueName) {
  if (!queueName || typeof queueName !== 'string') {
    return { exists: false, ticketCount: 0, activeTickets: 0, closedTickets: 0 };
  }
  
  try {
    const tickets = await getQueueTickets(queueName);
    const activeTickets = tickets.filter(t => t.status !== 'closed').length;
    const closedTickets = tickets.filter(t => t.status === 'closed').length;
    
    return {
      exists: tickets.length > 0 || (await getQueuesData()).queues[queueName] !== undefined,
      ticketCount: tickets.length,
      activeTickets,
      closedTickets,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[PersistenceServices] Erro ao obter info da fila:', err.message);
    return { exists: false, ticketCount: 0, activeTickets: 0, closedTickets: 0 };
  }
}

/**
 * Lista todas as filas disponíveis.
 * 
 * @returns {Promise<Array<string>>} Lista de nomes de filas
 */
async function listQueues() {
  try {
    const data = await getQueuesData();
    return Object.keys(data.queues || {});
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[PersistenceServices] Erro ao listar filas:', err.message);
    return [];
  }
}

/**
 * Lê configuração do sistema.
 * 
 * @returns {Promise<Object>} Configuração do sistema
 */
async function getConfig() {
  try {
    if (fs.existsSync(configFile)) {
      const data = fs.readFileSync(configFile, 'utf8');
      return JSON.parse(data);
    }
    return {};
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[PersistenceServices] Erro ao ler config:', err.message);
    return {};
  }
}

/**
 * Obtém um valor específico da configuração usando caminho com notação de ponto.
 * 
 * @param {string} path - Caminho da configuração (ex: 'api.port')
 * @param {any} defaultValue - Valor padrão se não encontrado
 * @returns {Promise<any>} Valor da configuração
 */
async function getConfigValue(path, defaultValue = undefined) {
  try {
    const config = await getConfig();
    const parts = path.split('.');
    let value = config;
    
    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return defaultValue;
      }
    }
    
    return value !== undefined ? value : defaultValue;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[PersistenceServices] Erro ao obter valor de config:', err.message);
    return defaultValue;
  }
}

module.exports = {
  getFlows,
  getFlow,
  findFlows,
  getQueuesData,
  getQueueTickets,
  getQueueInfo,
  listQueues,
  getConfig,
  getConfigValue,
};






























