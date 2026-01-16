/**
 * Helper para tornar migrations resilientes
 * 
 * Funções auxiliares para verificar se tabelas/índices já existem
 * antes de criar, evitando erros em bancos já inicializados.
 */

/**
 * Verifica se uma tabela existe
 */
async function tableExists(queryInterface, tableName) {
  try {
    const results = await queryInterface.sequelize.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = '${tableName}'
      ) AS exists`,
      {
        type: queryInterface.sequelize.constructor.QueryTypes.SELECT,
      }
    );
    // Sequelize retorna array de objetos
    if (Array.isArray(results) && results.length > 0) {
      const result = results[0];
      return result.exists === true || result.exists === 't';
    }
    return false;
  } catch (err) {
    console.error(`[Migration Helper] Erro ao verificar tabela ${tableName}:`, err.message);
    return false;
  }
}

/**
 * Verifica se um índice existe
 */
async function indexExists(queryInterface, tableName, indexName) {
  try {
    // Usa query direta com escape seguro dos nomes
    const escapedTableName = tableName.replace(/'/g, "''");
    const escapedIndexName = indexName.replace(/'/g, "''");
    const [results] = await queryInterface.sequelize.query(
      `SELECT EXISTS (
        SELECT FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND tablename = '${escapedTableName}' 
        AND indexname = '${escapedIndexName}'
      ) AS "exists"`,
      {
        type: queryInterface.sequelize.constructor.QueryTypes.SELECT,
      }
    );
    // Sequelize retorna array de objetos
    if (Array.isArray(results) && results.length > 0) {
      const result = results[0];
      // PostgreSQL retorna boolean como true/false ou 't'/'f'
      const exists = result.exists || result['exists'];
      return exists === true || exists === 't' || exists === true;
    }
    return false;
  } catch (err) {
    console.error(`[Migration Helper] Erro ao verificar índice ${indexName}:`, err.message);
    return false;
  }
}

/**
 * Verifica se já existe um índice único em uma coluna específica
 * (útil quando o índice foi criado automaticamente pelo PostgreSQL)
 */
async function uniqueIndexExistsOnColumn(queryInterface, tableName, columnName) {
  try {
    const escapedTableName = tableName.replace(/'/g, "''");
    const escapedColumnName = columnName.replace(/'/g, "''");
    
    // Verifica se existe um índice único na coluna
    // Isso cobre índices criados automaticamente pelo PostgreSQL quando unique: true é definido
    const results = await queryInterface.sequelize.query(
      `SELECT EXISTS (
        SELECT 1
        FROM pg_index i
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
        WHERE t.relname = '${escapedTableName}'
          AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
          AND a.attname = '${escapedColumnName}'
          AND i.indisunique = true
      ) AS "exists"`,
      {
        type: queryInterface.sequelize.constructor.QueryTypes.SELECT,
        plain: false, // Garante que retorna array
      }
    );
    
    // Sequelize retorna [results, metadata] quando não usa plain: true
    const resultArray = Array.isArray(results) && Array.isArray(results[0]) ? results[0] : results;
    
    if (Array.isArray(resultArray) && resultArray.length > 0) {
      const result = resultArray[0];
      const exists = result?.exists || result?.['exists'];
      // PostgreSQL retorna boolean como true/false ou 't'/'f' como string
      if (exists === true || exists === 't' || exists === 'true') {
        return true;
      }
    }
    return false;
  } catch (err) {
    console.error(`[Migration Helper] Erro ao verificar índice único na coluna ${columnName}:`, err.message);
    // Em caso de erro, retorna false para tentar criar (pode falhar, mas pelo menos tenta)
    return false;
  }
}

/**
 * Cria tabela apenas se não existir
 */
async function createTableIfNotExists(queryInterface, tableName, attributes, options = {}) {
  const exists = await tableExists(queryInterface, tableName);
  if (exists) {
    console.log(`[Migration] Tabela ${tableName} já existe, pulando criação`);
    return;
  }
  return queryInterface.createTable(tableName, attributes, options);
}

/**
 * Adiciona índice apenas se não existir
 */
async function addIndexIfNotExists(queryInterface, tableName, fields, options = {}) {
  const indexName = options.name || `${tableName}_${fields.join('_')}_idx`;
  
  // Verifica se o índice com o nome específico já existe
  const existsByName = await indexExists(queryInterface, tableName, indexName);
  if (existsByName) {
    console.log(`[Migration] Índice ${indexName} já existe, pulando criação`);
    return;
  }
  
  // Se for um índice único e tiver apenas uma coluna, verifica se já existe índice único nessa coluna
  // (isso cobre o caso onde o índice foi criado automaticamente pelo PostgreSQL)
  if (options.unique && fields.length === 1) {
    const existsOnColumn = await uniqueIndexExistsOnColumn(queryInterface, tableName, fields[0]);
    if (existsOnColumn) {
      console.log(`[Migration] Índice único na coluna ${fields[0]} já existe (criado automaticamente), pulando criação`);
      return;
    }
  }
  
  // Tenta criar o índice - se falhar porque já existe, captura o erro
  try {
    return await queryInterface.addIndex(tableName, fields, options);
  } catch (err) {
    // Se o erro for que o índice já existe, ignora
    if (err.message && err.message.includes('already exists')) {
      console.log(`[Migration] Índice ${indexName} já existe (detectado ao tentar criar), pulando criação`);
      return;
    }
    // Caso contrário, relança o erro
    throw err;
  }
}

module.exports = {
  tableExists,
  indexExists,
  uniqueIndexExistsOnColumn,
  createTableIfNotExists,
  addIndexIfNotExists,
};
