/**
 * Script para popular dados de teste a partir dos seeds.
 * 
 * Este script:
 * - Limpa dados de teste existentes
 * - Carrega seeds de /tests/seeds/
 * - Valida estrutura de cada seed
 * - Popula dados em /api/data/test/
 * - Valida integridade após população
 */

const fs = require('fs');
const path = require('path');

const SEEDS_DIR = path.join(__dirname);
const DATA_DIR = path.join(__dirname, '../../api/data/test');

// Garante que o diretório de dados de teste existe
function ensureTestDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Limpa dados de teste existentes
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

// Carrega e valida um seed
function loadSeed(filename) {
  const filePath = path.join(SEEDS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Seed não encontrado: ${filename}`);
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  const seed = JSON.parse(content);
  
  if (!seed.version) {
    throw new Error(`Seed ${filename} não tem versão`);
  }
  
  return seed;
}

// Salva dados de teste
function saveTestData(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Popula dados de teste
function seedTestData() {
  console.log('🌱 Iniciando seed de dados de teste...');
  
  // Garante diretório existe
  ensureTestDataDir();
  
  // Limpa dados antigos
  console.log('🧹 Limpando dados de teste existentes...');
  cleanTestData();
  
  // Carrega e salva agents
  console.log('👤 Carregando agents...');
  const agentsSeed = loadSeed('agents.json');
  saveTestData('agents.json', agentsSeed.agents);
  
  // Carrega e salva flows
  console.log('🔄 Carregando flows...');
  const flowsSeed = loadSeed('flows.json');
  saveTestData('flows.json', flowsSeed.flows);
  
  // Carrega e salva queues
  console.log('📋 Carregando queues...');
  const queuesSeed = loadSeed('queues.json');
  saveTestData('queues.json', queuesSeed);
  
  // Carrega e salva departments
  console.log('🏢 Carregando departments...');
  const departmentsSeed = loadSeed('departments.json');
  saveTestData('departments.json', departmentsSeed);
  
  // Carrega e salva config
  console.log('⚙️  Carregando config...');
  const configSeed = loadSeed('config.json');
  saveTestData('config.json', configSeed.config);
  
  // Carrega e salva quickReplies
  console.log('💬 Carregando quickReplies...');
  const quickRepliesSeed = loadSeed('quickReplies.json');
  saveTestData('quickReplies.json', quickRepliesSeed.quickReplies);
  
  console.log('✅ Seed de dados de teste concluído com sucesso!');
  console.log(`📁 Dados salvos em: ${DATA_DIR}`);
}

// Executa se chamado diretamente
if (require.main === module) {
  try {
    seedTestData();
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro ao executar seed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

module.exports = { seedTestData, loadSeed };

















