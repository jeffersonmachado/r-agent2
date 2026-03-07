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
    const allTables = await queryInterface.showAllTables();
    const wanted = String(tableName).toLowerCase();
    return (allTables || []).some((entry) => {
      if (typeof entry === 'string') return entry.toLowerCase() === wanted;
      if (entry && typeof entry === 'object') {
        const maybeName = entry.tableName || entry.table_name || entry.TABLE_NAME || entry.name;
        return maybeName ? String(maybeName).toLowerCase() === wanted : false;
      }
      return false;
    });
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
    const indexes = await queryInterface.showIndex(tableName);
    const wanted = String(indexName).toLowerCase();
    return (indexes || []).some((idx) => String(idx?.name || '').toLowerCase() === wanted);
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
    const indexes = await queryInterface.showIndex(tableName);
    const wanted = String(columnName).toLowerCase();
    return (indexes || []).some((idx) => {
      if (!idx?.unique) return false;
      const fields = Array.isArray(idx.fields) ? idx.fields : [];
      return fields.some((f) => String(f?.attribute || f?.name || '').toLowerCase() === wanted);
    });
  } catch (err) {
    console.error(`[Migration Helper] Erro ao verificar índice único na coluna ${columnName}:`, err.message);
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
