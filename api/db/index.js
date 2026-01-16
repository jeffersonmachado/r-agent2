/**
 * Camada de acesso ao banco de dados PostgreSQL (COMPATIBILIDADE).
 * 
 * NOTA: Este módulo agora é um wrapper de compatibilidade sobre Sequelize.
 * O padrão do projeto é usar Sequelize diretamente (api/db/sequelize.js).
 * 
 * Este módulo mantém a interface antiga para compatibilidade com código legado,
 * mas internamente usa Sequelize.
 * 
 * Responsabilidades:
 * - Healthcheck (isConnected)
 * - Compatibilidade com código que ainda usa db/index
 * 
 * DEPRECATED: Use api/db/sequelize.js diretamente para novas implementações.
 */

const logger = require('../utils/logger');

/**
 * Verifica se o banco está conectado e acessível.
 * Usa Sequelize internamente.
 * 
 * @returns {Promise<boolean>} true se conectado, false caso contrário
 */
async function isConnected() {
  try {
    const { getSequelize } = require('./sequelize');
    const sequelize = getSequelize();
    
    if (!sequelize) {
      return false;
    }
    
    await sequelize.authenticate();
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Conecta ao banco de dados (compatibilidade).
 * Delega para sequelize.connect()
 * 
 * @param {number} maxRetries - Número máximo de tentativas (padrão: 30)
 * @param {number} retryDelay - Delay inicial entre tentativas em ms (padrão: 1000)
 * @returns {Promise} Instância do Sequelize
 */
async function connect(maxRetries = 30, retryDelay = 1000) {
  const { connect: sequelizeConnect } = require('./sequelize');
  return await sequelizeConnect(maxRetries, retryDelay);
}

/**
 * Obtém instância do Sequelize (compatibilidade).
 * 
 * @returns {Sequelize|null} Instância do Sequelize ou null
 */
function getSequelize() {
  const { getSequelize: getSequelizeInstance } = require('./sequelize');
  return getSequelizeInstance();
}

/**
 * Fecha a conexão (compatibilidade).
 * 
 * @returns {Promise<void>}
 */
async function close() {
  const { close: sequelizeClose } = require('./sequelize');
  await sequelizeClose();
}

/**
 * DEPRECATED: Use Sequelize diretamente para queries.
 * Mantido apenas para compatibilidade.
 * 
 * @param {string} sql - Query SQL
 * @param {Array} params - Parâmetros da query (opcional)
 * @returns {Promise<any>} Resultado da query
 */
async function query(sql, params = []) {
  const { getSequelize } = require('./sequelize');
  const sequelize = getSequelize();
  
  if (!sequelize) {
    throw new Error('Banco de dados não inicializado. Chame connect() primeiro.');
  }
  
  try {
    const [results] = await sequelize.query(sql, { bind: params });
    return { rows: results, rowCount: results.length };
  } catch (err) {
    logger.error('[DB] Erro ao executar query:', { sql: sql.substring(0, 100), error: err.message });
    throw err;
  }
}

/**
 * DEPRECATED: Pool não é mais usado. Use Sequelize diretamente.
 * Mantido apenas para compatibilidade.
 */
function getPool() {
  logger.warn('[DB] getPool() está deprecated. Use Sequelize diretamente.');
  return null;
}

/**
 * DEPRECATED: initDb não é mais usado. Use sequelize.connect() diretamente.
 * Mantido apenas para compatibilidade.
 */
async function initDb(maxRetries = 30, retryDelay = 1000) {
  logger.warn('[DB] initDb() está deprecated. Use sequelize.connect() diretamente.');
  return await connect(maxRetries, retryDelay);
}

module.exports = {
  connect,
  isConnected,
  close,
  getSequelize,
  query,
  // Deprecated, mas mantido para compatibilidade
  getPool,
  initDb,
};
