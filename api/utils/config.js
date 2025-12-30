/**
 * Gerenciador de configuração centralizado.
 * 
 * Carrega configurações de api/data/config.json com fallback para process.env.
 * Isso permite migração gradual de variáveis de ambiente para JSON.
 * 
 * Uso:
 *   const config = require('./utils/config');
 *   const port = config.get('api.port');
 *   const token = config.get('whatsapp.accessToken');
 */

const fs = require('fs');
const path = require('path');

// Caminho do arquivo de configuração
const configFile = path.join(__dirname, '..', 'data', 'config.json');

// Cache da configuração carregada
let cachedConfig = null;

/**
 * Mapeamento de variáveis de ambiente antigas para novos caminhos JSON.
 * Usado para compatibilidade durante a migração.
 */
const ENV_TO_CONFIG_MAP = {
  'NODE_ENV': 'nodeEnv',
  'API_PORT': 'api.port',
  'DEFAULT_TENANT_ID': 'api.defaultTenantId',
  'TICKET_CLEANUP_INTERVAL_HOURS': 'api.ticketCleanup.intervalHours',
  'TICKET_MAX_AGE_DAYS': 'api.ticketCleanup.maxAgeDays',
  'FRONTEND_PORT': 'frontend.port',
  'VITE_API_BASE_URL': 'frontend.apiBaseUrl',
  'WHATSAPP_API_URL': 'whatsapp.apiUrl',
  'WHATSAPP_PHONE_NUMBER_ID': 'whatsapp.phoneNumberId',
  'WHATSAPP_ACCESS_TOKEN': 'whatsapp.accessToken',
  'WHATSAPP_VERIFY_TOKEN': 'whatsapp.verifyToken',
  'DEFAULT_FLOW_ID': 'flows.defaultFlowId',
  'API_URL': 'scripts.apiUrl',
  'MAX_AGE_DAYS': 'scripts.maxAgeDays',
  'DRY_RUN': 'scripts.dryRun',
};

/**
 * Carrega configuração do arquivo JSON.
 * 
 * @returns {Object} Configuração carregada
 */
function loadConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    if (fs.existsSync(configFile)) {
      const data = fs.readFileSync(configFile, 'utf8');
      cachedConfig = JSON.parse(data);
      // eslint-disable-next-line no-console
      console.log(`[Config] Configuração carregada de ${configFile}`);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[Config] Arquivo de configuração não encontrado: ${configFile}. Usando valores padrão e process.env.`);
      cachedConfig = {};
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[Config] Erro ao carregar configuração:', err.message);
    cachedConfig = {};
  }

  return cachedConfig;
}

/**
 * Obtém valor de configuração usando caminho com notação de ponto.
 * Exemplo: 'api.port', 'whatsapp.accessToken'
 * 
 * @param {string} path - Caminho da configuração (ex: 'api.port')
 * @param {any} defaultValue - Valor padrão se não encontrado
 * @returns {any} Valor da configuração
 */
function get(path, defaultValue = undefined) {
  const config = loadConfig();
  
  // Tenta obter do JSON primeiro
  const parts = path.split('.');
  let value = config;
  
  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      value = undefined;
      break;
    }
  }
  
  // Se encontrou no JSON, retorna
  if (value !== undefined) {
    return value;
  }
  
  // Fallback: tenta process.env (compatibilidade)
  // Procura no mapeamento primeiro
  for (const [envVar, configPath] of Object.entries(ENV_TO_CONFIG_MAP)) {
    if (configPath === path && process.env[envVar] !== undefined) {
      // Converte string para tipo apropriado
      const envValue = process.env[envVar];
      if (envValue === 'true') return true;
      if (envValue === 'false') return false;
      if (/^\d+$/.test(envValue)) return Number(envValue);
      return envValue;
    }
  }
  
  // Se não encontrou, retorna defaultValue
  return defaultValue;
}

/**
 * Obtém toda a configuração.
 * 
 * @returns {Object} Configuração completa (cópia profunda para evitar mutações)
 */
function getAll() {
  try {
    const config = loadConfig();
    
    // Garante que config é um objeto válido
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      console.warn('[Config] Configuração inválida, retornando objeto vazio');
      return {};
    }
    
    // Retorna uma cópia profunda para evitar mutações acidentais
    try {
      const serialized = JSON.stringify(config);
      return JSON.parse(serialized);
    } catch (err) {
      // Se houver erro na serialização (ex: referências circulares), retorna cópia simples
      console.error('[Config] Erro ao serializar configuração:', err.message);
      // Tenta fazer uma cópia superficial
      try {
        return { ...config };
      } catch (copyErr) {
        console.error('[Config] Erro ao copiar configuração:', copyErr.message);
        return {};
      }
    }
  } catch (err) {
    // Erro geral ao obter configuração
    console.error('[Config] Erro ao obter configuração:', err.message, err.stack);
    return {};
  }
}

/**
 * Recarrega a configuração do arquivo.
 * Útil após mudanças no arquivo JSON.
 */
function reload() {
  cachedConfig = null;
  return loadConfig();
}

module.exports = {
  get,
  getAll,
  reload,
  loadConfig,
};

