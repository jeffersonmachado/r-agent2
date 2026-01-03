/**
 * Validador de configuração.
 * 
 * Verifica:
 * - Configuração existe e é válida
 * - Tenant de teste está configurado
 * - Não há dependências de APIs externas em modo teste
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../../api/data/test');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

function validateConfig() {
  const errors = [];
  const warnings = [];
  
  // Verifica se arquivo existe
  if (!fs.existsSync(CONFIG_FILE)) {
    errors.push({
      validator: 'config.validator',
      level: 'error',
      message: 'Arquivo de configuração não encontrado',
      details: {
        file: CONFIG_FILE
      }
    });
    return { errors, warnings };
  }
  
  // Carrega configuração
  let config;
  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf8');
    config = JSON.parse(content);
  } catch (error) {
    errors.push({
      validator: 'config.validator',
      level: 'error',
      message: 'Erro ao carregar arquivo de configuração',
      details: {
        error: error.message
      }
    });
    return { errors, warnings };
  }
  
  // Verifica nodeEnv
  if (config.nodeEnv !== 'test') {
    warnings.push({
      validator: 'config.validator',
      level: 'warning',
      message: 'nodeEnv não está configurado como "test"',
      details: {
        nodeEnv: config.nodeEnv
      }
    });
  }
  
  // Verifica tenant de teste
  if (config.api && config.api.defaultTenantId !== 'tenant-test') {
    warnings.push({
      validator: 'config.validator',
      level: 'warning',
      message: 'defaultTenantId não está configurado como "tenant-test"',
      details: {
        defaultTenantId: config.api.defaultTenantId
      }
    });
  }
  
  // Verifica se há dependências de APIs externas
  // Verifica config.ai.useRealAiApi (se existir, deve ser false)
  if (config.ai && 'useRealAiApi' in config.ai && config.ai.useRealAiApi !== false) {
    errors.push({
      validator: 'config.validator',
      level: 'error',
      message: 'Configuração permite uso de APIs reais de IA em modo teste',
      details: {
        useRealAiApi: config.ai.useRealAiApi
      }
    });
  }
  
  // Verifica config.features.useRealAiApi (se existir, deve ser false)
  if (config.features && 'useRealAiApi' in config.features && config.features.useRealAiApi !== false) {
    errors.push({
      validator: 'config.validator',
      level: 'error',
      message: 'Features permite uso de APIs reais de IA em modo teste',
      details: {
        useRealAiApi: config.features.useRealAiApi
      }
    });
  }
  
  return { errors, warnings };
}

module.exports = { validateConfig };

