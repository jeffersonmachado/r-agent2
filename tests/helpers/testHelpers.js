/**
 * Helpers compartilhados para testes.
 * 
 * Funções utilitárias usadas em múltiplos testes.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../api/data/test');

/**
 * Carrega dados de teste de um arquivo.
 * 
 * @param {string} filename - Nome do arquivo
 * @returns {any} Dados carregados
 */
function loadTestData(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

/**
 * Verifica se dados de teste existem.
 * 
 * @returns {boolean} Se dados existem
 */
function testDataExists() {
  return fs.existsSync(DATA_DIR) && fs.readdirSync(DATA_DIR).length > 0;
}

/**
 * Cria um agente de teste.
 * 
 * @param {object} overrides - Valores para sobrescrever
 * @returns {object} Agente de teste
 */
function createTestAgent(overrides = {}) {
  return {
    id: `test-agent-${Date.now()}`,
    username: 'test-user',
    email: 'test@test.com',
    passwordHash: 'hash',
    salt: 'salt',
    role: 'agent',
    name: 'Test Agent',
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tenantId: 'tenant-test',
    ...overrides
  };
}

/**
 * Cria um fluxo de teste.
 * 
 * @param {object} overrides - Valores para sobrescrever
 * @returns {object} Fluxo de teste
 */
function createTestFlow(overrides = {}) {
  return {
    id: `test-flow-${Date.now()}`,
    name: 'Test Flow',
    description: 'Test flow description',
    version: '1.0.0',
    nodes: [
      {
        id: 'start-1',
        type: 'start',
        label: 'Início',
        position: { x: 100, y: 100 }
      },
      {
        id: 'end-1',
        type: 'end',
        label: 'Fim',
        position: { x: 300, y: 100 }
      }
    ],
    connections: [
      {
        from: 'start-1',
        to: 'end-1'
      }
    ],
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    tenantId: 'tenant-test',
    ...overrides
  };
}

/**
 * Limpa dados de teste.
 */
function cleanTestData() {
  if (fs.existsSync(DATA_DIR)) {
    const files = fs.readdirSync(DATA_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(DATA_DIR, file));
      }
    }
  }
}

module.exports = {
  loadTestData,
  testDataExists,
  createTestAgent,
  createTestFlow,
  cleanTestData
};










