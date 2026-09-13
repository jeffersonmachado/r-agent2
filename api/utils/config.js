const bootstrapLog = require('./bootstrapLog');
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

const fs = require('node:fs');
const path = require('node:path');

// Caminho do arquivo de configuração
const configFile = path.join(__dirname, '..', 'data', 'config.json');

// Cache da configuração carregada
let cachedConfig = null;

function isTestRuntime() {
  return process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
}

function logConfigInfo(message) {
  if (isTestRuntime()) return;
  // eslint-disable-next-line no-console
  bootstrapLog.info(message);
}

function logConfigWarn(message) {
  if (isTestRuntime()) return;
  // eslint-disable-next-line no-console
  bootstrapLog.warn(message);
}

/**
 * Mapeamento de variáveis de ambiente antigas para novos caminhos JSON.
 * Usado para compatibilidade durante a migração.
 */
const ENV_TO_CONFIG_MAP = {
  'NODE_ENV': 'nodeEnv',
  'API_PORT': 'api.port',
  'TICKET_CLEANUP_INTERVAL_HOURS': 'api.ticketCleanup.intervalHours',
  'TICKET_MAX_AGE_DAYS': 'api.ticketCleanup.maxAgeDays',
  'FRONTEND_PORT': 'frontend.port',
  'VITE_API_BASE_URL': 'frontend.apiBaseUrl',
  // -----------------------------------------------------------------------
  // PBX Legacy (Ripabx / r-pbx) integration
  // -----------------------------------------------------------------------
  'PBX_LEGACY_ROOT': 'pbx.legacy.root',
  'PBX_LEGACY_XML_DIR': 'pbx.legacy.xmlDir',
  'PBX_LEGACY_BIN_DIR': 'pbx.legacy.binDir',
  'PBX_LEGACY_CGI_DIR': 'pbx.legacy.cgiDir',
  'PBX_LEGACY_AST_DIR': 'pbx.legacy.asteriskConfigDir',
  'PBX_MARIADB_URL': 'pbx.mariadb.url',
  'PBX_MARIADB_HOST': 'pbx.mariadb.host',
  'PBX_MARIADB_PORT': 'pbx.mariadb.port',
  'PBX_MARIADB_DATABASE': 'pbx.mariadb.database',
  'PBX_MARIADB_USER': 'pbx.mariadb.username',
  'PBX_MARIADB_PASSWORD': 'pbx.mariadb.password',
  'WHATSAPP_API_URL': 'whatsapp.apiUrl',
  'WHATSAPP_PHONE_NUMBER_ID': 'whatsapp.phoneNumberId',
  'WHATSAPP_ACCESS_TOKEN': 'whatsapp.accessToken',
  'WHATSAPP_VERIFY_TOKEN': 'whatsapp.verifyToken',
  'INSTAGRAM_APP_SECRET': 'instagram.appSecret',
  'MESSENGER_APP_SECRET': 'messenger.appSecret',
  'WHATSAPP_QR_WEBHOOK_SECRET': 'webhooks.whatsappQrSecret',
  'NOTIFICATION_EMAIL_ENABLED': 'notifications.email.enabled',
  'EMAIL_SMTP_HOST': 'notifications.email.smtp.host',
  'EMAIL_SMTP_PORT': 'notifications.email.smtp.port',
  'EMAIL_SMTP_SECURE': 'notifications.email.smtp.secure',
  'EMAIL_SMTP_USERNAME': 'notifications.email.smtp.username',
  'EMAIL_SMTP_PASSWORD': 'notifications.email.smtp.password',
  'EMAIL_FROM_ADDRESS': 'notifications.email.fromAddress',
  'EMAIL_FROM_NAME': 'notifications.email.fromName',
  'DEFAULT_FLOW_ID': 'flows.defaultFlowId',
  'API_URL': 'scripts.apiUrl',
  'MAX_AGE_DAYS': 'scripts.maxAgeDays',
  'DRY_RUN': 'scripts.dryRun',
  'RATE_LIMIT_REDIS_URL': 'rateLimit.redis.url',
  'REDIS_URL': 'rateLimit.redis.url',
  'RATE_LIMIT_DRY_RUN_POINTS': 'rateLimit.policies.dryRun.points',
  'RATE_LIMIT_DRY_RUN_DURATION': 'rateLimit.policies.dryRun.duration',
  'RATE_LIMIT_GENERATION_POINTS': 'rateLimit.policies.generation.points',
  'RATE_LIMIT_GENERATION_DURATION': 'rateLimit.policies.generation.duration',
  'RATE_LIMIT_BOOTSTRAP_POINTS': 'rateLimit.policies.bootstrap.points',
  'RATE_LIMIT_BOOTSTRAP_DURATION': 'rateLimit.policies.bootstrap.duration',
  'RATE_LIMIT_SCRAPING_POINTS': 'rateLimit.policies.scraping.points',
  'RATE_LIMIT_SCRAPING_DURATION': 'rateLimit.policies.scraping.duration',
  'RATE_LIMIT_SCRAPING_RPS': 'rateLimit.policies.scraping.requestsPerSecond',
  'RATE_LIMIT_SCRAPING_PAGES': 'rateLimit.policies.scraping.pagesPerExecution',
  'RATE_LIMIT_SYSTEM_VALIDATE_POINTS': 'rateLimit.policies.systemValidate.points',
  'RATE_LIMIT_SYSTEM_VALIDATE_DURATION': 'rateLimit.policies.systemValidate.duration',
  'RATE_LIMIT_PUBLIC_TOKENS_RESOLVE_POINTS': 'rateLimit.policies.publicTokens.resolve.points',
  'RATE_LIMIT_PUBLIC_TOKENS_RESOLVE_DURATION': 'rateLimit.policies.publicTokens.resolve.duration',
  'RATE_LIMIT_PUBLIC_TOKENS_STOREFRONT_POINTS': 'rateLimit.policies.publicTokens.storefront.points',
  'RATE_LIMIT_PUBLIC_TOKENS_STOREFRONT_DURATION': 'rateLimit.policies.publicTokens.storefront.duration',
  'RATE_LIMIT_PUBLIC_TOKENS_KIOSK_POINTS': 'rateLimit.policies.publicTokens.kiosk.points',
  'RATE_LIMIT_PUBLIC_TOKENS_KIOSK_DURATION': 'rateLimit.policies.publicTokens.kiosk.duration',
  'RATE_LIMIT_PUBLIC_TOKENS_PANEL_POINTS': 'rateLimit.policies.publicTokens.panel.points',
  'RATE_LIMIT_PUBLIC_TOKENS_PANEL_DURATION': 'rateLimit.policies.publicTokens.panel.duration',
  'RATE_LIMIT_PUBLIC_TOKENS_STATION_POINTS': 'rateLimit.policies.publicTokens.station.points',
  'RATE_LIMIT_PUBLIC_TOKENS_STATION_DURATION': 'rateLimit.policies.publicTokens.station.duration',
  'RATE_LIMIT_EXECUTION_QUEUE_ENQUEUE_POINTS': 'rateLimit.policies.executionQueue.enqueue.points',
  'RATE_LIMIT_EXECUTION_QUEUE_ENQUEUE_DURATION': 'rateLimit.policies.executionQueue.enqueue.duration',
  'RATE_LIMIT_AUTH_PUBLIC_POINTS': 'rateLimit.policies.authPublic.points',
  'RATE_LIMIT_AUTH_PUBLIC_DURATION': 'rateLimit.policies.authPublic.duration',
  'AUTH_INACTIVITY_TIMEOUT_MINUTES': 'auth.inactivityTimeoutMinutes',
  'AUTH_TOKEN_EXPIRATION_HOURS': 'auth.tokenExpirationHours',
  'RAG_SERVICE_URL': 'rag.serviceUrl',
  'RAG_TIMEOUT': 'rag.timeout',
  'DATABASE_URL': 'database.url',
  'PGHOST': 'database.host',
  'PGPORT': 'database.port',
  'PGDATABASE': 'database.database',
  'PGUSER': 'database.username',
  'PGPASSWORD': 'database.password',
};

// Índice invertido pré-computado: configPath -> [envVars] (na ordem de
// declaração do mapa). Preserva exatamente a semântica da varredura original
// de ENV_TO_CONFIG_MAP, incluindo múltiplas envs para o mesmo path
// (ex.: RATE_LIMIT_REDIS_URL e REDIS_URL -> rateLimit.redis.url, onde a
// primeira env definida na ordem do mapa vence).
const CONFIG_PATH_TO_ENV_VARS = new Map();
for (const [envVar, configPath] of Object.entries(ENV_TO_CONFIG_MAP)) {
  const list = CONFIG_PATH_TO_ENV_VARS.get(configPath);
  if (list) {
    list.push(envVar);
  } else {
    CONFIG_PATH_TO_ENV_VARS.set(configPath, [envVar]);
  }
}

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
      logConfigInfo(`[Config] Configuração carregada de ${configFile}`);
    } else {
      logConfigWarn(`[Config] Arquivo de configuração não encontrado: ${configFile}. Usando valores padrão e process.env.`);
      cachedConfig = {};
    }
    
    // Valida configuração do Redis após carregar
    try {
      const redisValidation = validateRedisConfig();
      if (!redisValidation.valid) {
        logConfigWarn('[Config] Avisos na configuração do Redis:');
        redisValidation.errors.forEach(error => {
          logConfigWarn(`  - ${error}`);
        });
      } else if (redisValidation.config) {
        logConfigInfo(`[Config] Configuração do Redis válida: ${redisValidation.config.url}`);
      }
    } catch (validationErr) {
      logConfigWarn(`[Config] Erro ao validar configuração do Redis: ${validationErr.message}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    bootstrapLog.error('[Config] Erro ao carregar configuração:', err.message);
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

  // 1) Primeiro: variáveis de ambiente (override do JSON)
  // Consulta O(1) no índice invertido pré-computado (configPath -> envVars)
  const envVars = CONFIG_PATH_TO_ENV_VARS.get(path);
  if (envVars) {
    for (const envVar of envVars) {
      if (process.env[envVar] !== undefined) {
        // Converte string para tipo apropriado
        const envValue = process.env[envVar];
        if (envValue === 'true') return true;
        if (envValue === 'false') return false;
        if (/^\d+$/.test(envValue)) return Number(envValue);
        return envValue;
      }
    }
  }

  // 2) Se não houver env, tenta obter do JSON
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
  
  // Se não encontrou, retorna defaultValue
  return defaultValue;
}

/**
 * Obtém valor exclusivamente do config.json (sem fallback de env).
 *
 * @param {string} path - Caminho da configuração (ex: 'api.port')
 * @param {any} defaultValue - Valor padrão se não encontrado
 * @returns {any} Valor da configuração no arquivo
 */
function getFromFile(path, defaultValue = undefined) {
  const config = loadConfig();
  const parts = String(path || '').split('.').filter(Boolean);
  let value = config;

  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      return defaultValue;
    }
  }

  return value === undefined ? defaultValue : value;
}

/**
 * Remove secrets da configuração antes de retornar
 * 
 * @param {Object} config - Configuração completa
 * @returns {Object} Configuração sem secrets
 */
function sanitizeConfig(config) {
  if (!config || typeof config !== 'object') {
    return {};
  }
  
  // Cria cópia profunda
  const sanitized = JSON.parse(JSON.stringify(config));
  
  // Remove apiKey de qualquer lugar
  function removeSecrets(obj) {
    if (!obj || typeof obj !== 'object') {
      return;
    }
    
    for (const key in obj) {
      if (key.toLowerCase().includes('apikey') || 
          key.toLowerCase().includes('api_key') ||
          key.toLowerCase().includes('secret') ||
          key.toLowerCase().includes('password')) {
        delete obj[key];
      } else if (typeof obj[key] === 'object') {
        removeSecrets(obj[key]);
      }
    }
  }
  
  removeSecrets(sanitized);
  return sanitized;
}

/**
 * Obtém toda a configuração (sem secrets).
 * 
 * @returns {Object} Configuração completa sem secrets (cópia profunda para evitar mutações)
 */
function getAll() {
  try {
    const config = loadConfig();
    
    // Garante que config é um objeto válido
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      bootstrapLog.warn('[Config] Configuração inválida, retornando objeto vazio');
      return {};
    }
    
    // Remove secrets antes de retornar
    return sanitizeConfig(config);
  } catch (err) {
    // Erro geral ao obter configuração
    bootstrapLog.error('[Config] Erro ao obter configuração:', err.message, err.stack);
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

/**
 * Valida a configuração do Redis.
 * 
 * Verifica:
 * - Se a URL está configurada
 * - Se o formato da URL é válido (redis:// ou rediss://)
 * - Se a URL tem estrutura válida (host:port)
 * 
 * @returns {Object} { valid: boolean, errors: string[], config?: Object }
 */
function validateRedisConfig() {
  const errors = [];
  const config = loadConfig();
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Obtém a URL do Redis
  // IMPORTANTE: variáveis de ambiente têm prioridade sobre config.json
  let redisUrl = process.env.RATE_LIMIT_REDIS_URL || process.env.REDIS_URL;
  
  // Fallback para config.json se não houver env
  if (!redisUrl) {
    redisUrl = config?.rateLimit?.redis?.url;
  }
  
  // Verifica se está configurada
  if (!redisUrl) {
    if (!isProduction) {
      return {
        valid: true,
        errors: [],
        optional: true,
        configured: false,
        config: null,
      };
    }

    errors.push('URL do Redis não configurada. Configure rateLimit.redis.url em config.json ou defina RATE_LIMIT_REDIS_URL/REDIS_URL');
    return { valid: false, errors };
  }
  
  // Verifica se é uma string
  if (typeof redisUrl !== 'string') {
    errors.push('URL do Redis deve ser uma string');
    return { valid: false, errors };
  }
  
  // Valida formato da URL
  const redisUrlPattern = /^(redis|rediss):\/\/([^:\/]+)(:(\d+))?(\/.*)?$/;
  const match = redisUrl.match(redisUrlPattern);
  
  if (!match) {
    errors.push(`Formato de URL do Redis inválido: "${redisUrl}". Formato esperado: redis://host:port ou rediss://host:port`);
    return { valid: false, errors };
  }
  
  // Valida porta se presente
  const port = match[4];
  if (port) {
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      errors.push(`Porta do Redis inválida: ${port}. Deve ser um número entre 1 e 65535`);
    }
  }
  
  // Valida host
  const host = match[2];
  if (!host || host.trim().length === 0) {
    errors.push('Host do Redis não pode estar vazio');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    optional: false,
    configured: true,
    config: {
      url: redisUrl,
      host: host,
      port: port ? parseInt(port, 10) : 6379,
      secure: match[1] === 'rediss'
    }
  };
}

/**
 * Obtém a URL de conexão do banco de dados.
 * Prioridade: config.json > env vars (DATABASE_URL ou PGHOST/PGUSER/etc)
 * 
 * @returns {string} URL de conexão do banco
 */
function getDatabaseUrl() {
  // 0) Prioridade máxima: TEST_DATABASE_URL (testes que rodam no host mas precisam
  //    apontar para o banco do container de teste, ex.: PBX smoke em modo direct)
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }

  // 1) Tenta config.json primeiro
  const configUrl = get('database.url');
  if (configUrl) {
    return configUrl;
  }

  // 2) Fallback para DATABASE_URL (env)
  if (process.env.DATABASE_URL) {
    logConfigInfo('[Config] Usando DATABASE_URL de variável de ambiente (fallback)');
    return process.env.DATABASE_URL;
  }

  // 3) Fallback: constrói URL a partir de variáveis individuais
  const host = process.env.PGHOST || get('database.host') || 'localhost';
  const port = process.env.PGPORT || get('database.port') || '5432';
  const database = process.env.PGDATABASE || get('database.database') || 'r_agent2';
  const username = process.env.PGUSER || get('database.username') || 'postgres';
  const password = process.env.PGPASSWORD || get('database.password') || 'postgres';

  if (process.env.PGHOST || process.env.PGUSER) {
    logConfigInfo('[Config] Usando variáveis de ambiente individuais para banco (fallback)');
  }

  return `postgres://${username}:${password}@${host}:${port}/${database}`;
}

/**
 * Obtém configuração do pool de conexões.
 * 
 * @returns {Object} Configuração do pool { min, max }
 */
function getDatabasePool() {
  const poolConfig = get('database.pool', {});
  return {
    min: poolConfig.min !== undefined ? poolConfig.min : (process.env.DB_POOL_MIN ? parseInt(process.env.DB_POOL_MIN, 10) : 0),
    max: poolConfig.max !== undefined ? poolConfig.max : (process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 10),
  };
}

/**
 * Obtém configuração SSL do banco de dados.
 * 
 * @returns {boolean|Object} Configuração SSL (false ou objeto de configuração)
 */
function getDatabaseSsl() {
  const sslConfig = get('database.ssl');
  if (sslConfig !== undefined) {
    return sslConfig;
  }
  // Fallback: verifica se DATABASE_URL tem SSL
  const dbUrl = process.env.DATABASE_URL || getDatabaseUrl();
  if (dbUrl && (dbUrl.includes('sslmode=require') || dbUrl.includes('ssl=true'))) {
    return true;
  }
  return false;
}

/**
 * Extrai informações do banco de dados da URL (sem senha).
 * Útil para logs e diagnóstico.
 * 
 * @param {string} databaseUrl - URL do banco de dados
 * @returns {Object} { host, port, database, username } (sem senha)
 */
function parseDatabaseUrlSafe(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port || '5432', 10),
      database: url.pathname.replace(/^\//, ''),
      username: url.username,
    };
  } catch (error) {
    return {
      host: 'unknown',
      port: 5432,
      database: 'unknown',
      username: 'unknown',
    };
  }
}

module.exports = {
  get,
  getFromFile,
  getAll,
  reload,
  loadConfig,
  validateRedisConfig,
  getDatabaseUrl,
  getDatabasePool,
  getDatabaseSsl,
  parseDatabaseUrlSafe,
};

