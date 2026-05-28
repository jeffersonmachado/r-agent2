/**
 * Inicialização do Sequelize
 * 
 * Cria e configura a instância do Sequelize para uso em migrations e models.
 */

const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');
const config = require('../utils/config');

let sequelize = null;

function shouldEnableSequelizeLogging() {
  const raw = process.env.SEQUELIZE_LOGGING;
  if (raw !== undefined) {
    const v = String(raw).trim().toLowerCase();
    if (['0', 'false', 'off', 'no'].includes(v)) return false;
    if (['1', 'true', 'on', 'yes'].includes(v)) return true;
  }

  // Padrão: log de SQL desabilitado. Use SEQUELIZE_LOGGING=true para ativar.
  return false;
}

/**
 * Obtém configuração do banco de dados
 * Usa config.js como fonte principal, com fallback para env vars
 */
function getDatabaseConfig() {
  const dbUrl = config.getDatabaseUrl();
  const poolConfig = config.getDatabasePool();
  const sslConfig = config.getDatabaseSsl();
  
  return {
    url: dbUrl,
    pool: poolConfig,
    ssl: sslConfig,
  };
}

/**
 * Cria e configura a instância do Sequelize
 */
function createSequelize() {
  const dbConfig = getDatabaseConfig();
  
  // Configuração padrão para todos os models
  // IMPORTANTE: Migrations usam snake_case (created_at, updated_at)
  // então models devem usar underscored: true para mapear corretamente
  const defaultModelOptions = {
    underscored: true, // Mapeia createdAt -> created_at, updatedAt -> updated_at
    timestamps: true,
  };

  // Configuração do pool
  const poolConfig = {
    max: dbConfig.pool.max,
    min: dbConfig.pool.min,
    acquire: parseInt(process.env.DB_POOL_ACQUIRE || '30000', 10),
    idle: parseInt(process.env.DB_POOL_IDLE || '10000', 10),
  };

  // Configuração de dialect options
  const dialectOptions = {
    connectTimeout: 10000,
  };

  // Adiciona SSL se configurado
  if (dbConfig.ssl) {
    if (typeof dbConfig.ssl === 'object') {
      dialectOptions.ssl = dbConfig.ssl;
    } else {
      dialectOptions.ssl = { require: true };
    }
  }

  const sequelizeInstance = new Sequelize(dbConfig.url, {
    dialect: 'postgres',
    logging: shouldEnableSequelizeLogging()
      ? (msg) => logger.debug(`[Sequelize] ${msg}`)
      : false,
    define: defaultModelOptions, // Padrão global para todos os models
    pool: poolConfig,
    dialectOptions: dialectOptions,
  });
  
  return sequelizeInstance;
}

/**
 * Conecta ao banco de dados com retry logic
 * 
 * @param {number} maxRetries - Número máximo de tentativas (padrão: 30)
 * @param {number} retryDelay - Delay inicial entre tentativas em ms (padrão: 1000)
 * @returns {Promise<Sequelize>} Instância do Sequelize conectada
 */
async function connect(maxRetries = 30, retryDelay = 1000) {
  if (sequelize) {
    try {
      await sequelize.authenticate();
      return sequelize;
    } catch (err) {
      logger.warn('[Sequelize] Conexão existente inválida, recriando...', { error: err.message });
      sequelize = null;
    }
  }
  
  sequelize = createSequelize();
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await sequelize.authenticate();
      logger.info('[Sequelize] Conectado ao PostgreSQL com sucesso');
      return sequelize;
    } catch (err) {
      const isLastAttempt = attempt === maxRetries;
      
      if (isLastAttempt) {
        logger.error('[Sequelize] Falha ao conectar ao PostgreSQL após todas as tentativas', {
          attempts: maxRetries,
          error: err.message,
        });
        throw new Error(`Não foi possível conectar ao PostgreSQL após ${maxRetries} tentativas: ${err.message}`);
      }
      
      logger.warn(`[Sequelize] Tentativa ${attempt}/${maxRetries} falhou, tentando novamente em ${retryDelay}ms...`, {
        error: err.message,
      });
      
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      // Aumenta o delay exponencialmente (com limite)
      retryDelay = Math.min(retryDelay * 1.5, 10000);
    }
  }
  
  throw new Error('Não foi possível conectar ao PostgreSQL');
}

/**
 * Obtém a instância do Sequelize (sem conectar)
 */
function getSequelize() {
  return sequelize;
}

/**
 * Fecha a conexão
 */
async function close() {
  if (sequelize) {
    await sequelize.close();
    sequelize = null;
    logger.info('[Sequelize] Conexão fechada');
  }
}

module.exports = {
  connect,
  getSequelize,
  close,
  Sequelize,
};
