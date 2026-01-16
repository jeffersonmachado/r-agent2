/**
 * Utilitários de saúde do banco de dados e migrations
 * 
 * Fornece funções reutilizáveis para healthchecks:
 * - checkDbConnection: verifica conexão e mede latência
 * - getDbInfo: retorna informações do banco (sem senha)
 * - getMigrationStatus: retorna status das migrations (sem executar)
 */

const { getSequelize } = require('./sequelize');
const { getMigrationStatus } = require('./migrate');
const config = require('../utils/config');
const logger = require('../utils/logger');

/**
 * Verifica conexão com o banco de dados e mede latência
 * 
 * @returns {Promise<{ok: boolean, latencyMs: number, errorMessage?: string}>}
 */
async function checkDbConnection() {
  const startTime = Date.now();
  
  try {
    const sequelize = getSequelize();
    
    if (!sequelize) {
      return {
        ok: false,
        latencyMs: Date.now() - startTime,
        errorMessage: 'Sequelize não inicializado'
      };
    }
    
    await sequelize.authenticate();
    const latencyMs = Date.now() - startTime;
    
    return {
      ok: true,
      latencyMs
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startTime,
      errorMessage: error.message || 'Erro ao conectar ao banco de dados'
    };
  }
}

/**
 * Obtém informações do banco de dados (sem senha)
 * 
 * @returns {{host: string, database: string, username?: string, port?: number}}
 */
function getDbInfo() {
  try {
    const dbUrl = config.getDatabaseUrl();
    const dbInfo = config.parseDatabaseUrlSafe(dbUrl);
    
    return {
      host: dbInfo.host,
      database: dbInfo.database,
      username: dbInfo.username,
      port: dbInfo.port
    };
  } catch (error) {
    logger.warn('[DB Health] Erro ao obter informações do banco:', error.message);
    return {
      host: 'unknown',
      database: 'unknown'
    };
  }
}

/**
 * Obtém status das migrations (sem executar)
 * 
 * IMPORTANTE: Esta função NÃO executa migrations, apenas consulta o status
 * 
 * @returns {Promise<{appliedCount: number, pendingCount: number, pendingNames: string[]}>}
 */
async function getMigrationStatusSafe() {
  try {
    const status = await getMigrationStatus();
    
    // Limita pendingNames a no máximo 10 para evitar respostas muito grandes
    const pendingNames = (status.pending || []).slice(0, 10);
    
    return {
      appliedCount: status.totalExecuted || 0,
      pendingCount: status.totalPending || 0,
      pendingNames
    };
  } catch (error) {
    logger.warn('[DB Health] Erro ao obter status das migrations:', error.message);
    // Retorna valores seguros em caso de erro
    return {
      appliedCount: 0,
      pendingCount: 0,
      pendingNames: []
    };
  }
}

/**
 * Obtém o ambiente atual (development, test, production)
 * 
 * @returns {string}
 */
function getEnvironment() {
  return process.env.NODE_ENV || 'development';
}

/**
 * Verifica se sync está permitido (baseado em config e ambiente)
 * 
 * @returns {{allowSync: boolean, syncBlockedInProduction: boolean}}
 */
function getSyncStatus() {
  const nodeEnv = getEnvironment();
  const allowSync = config.get('database.allowSync') === true;
  const syncBlockedInProduction = nodeEnv === 'production';
  
  return {
    allowSync: allowSync && !syncBlockedInProduction,
    syncBlockedInProduction
  };
}

module.exports = {
  checkDbConnection,
  getDbInfo,
  getMigrationStatusSafe,
  getEnvironment,
  getSyncStatus
};
