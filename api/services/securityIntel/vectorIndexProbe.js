'use strict';

/**
 * vectorIndexProbe — MEDIÇÃO da saúde do índice vetorial (I/O).
 *
 * Mede apenas o que pode ser medido no banco vivo; o veredito é do módulo puro
 * `engine/securityIntel/vectorIndexHealth.js`. Nada aqui interpreta risco.
 *
 * Existe porque "corrupção dos índices do RAG" é um sintoma recorrente sem
 * medição permanente: quando o índice está inválido, `indisvalid=false` no
 * catálogo do PostgreSQL é a evidência objetiva; quando está sadio, isso também
 * precisa ficar registrado para não se reabrir a mesma investigação.
 */

const { connect, getSequelize } = require('../../db/sequelize');
const { detectIndexMethod, evaluateVectorIndexHealth } = require('../../../engine/securityIntel/vectorIndexHealth');

async function ensureConnected() {
  if (getSequelize()) return getSequelize();
  try {
    return await connect(3, 500);
  } catch (error) {
    const wrapped = new Error(`persistence_required:${error.message}`);
    wrapped.code = 'persistence_required';
    throw wrapped;
  }
}

/**
 * Coleta os fatos medidos sobre a extensão vetorial, o índice e os embeddings.
 *
 * @param {object} input
 * @param {string} [input.tableName]   tabela dos vetores (default: política)
 * @param {string} [input.columnName]  coluna do vetor
 * @returns {Promise<object>} fatos (medições), com `null` onde não foi possível medir
 */
async function measureVectorIndex({ tableName = 'rag_chunks', columnName = 'embedding' } = {}) {
  const sequelize = await ensureConnected();
  const query = async (sql) => {
    const [rows] = await sequelize.query(sql);
    return rows;
  };

  const extensionRows = await query(
    "SELECT extname AS name, extversion AS version FROM pg_extension WHERE extname IN ('vector','pgvector')"
  );
  const extension = extensionRows[0] ? { name: extensionRows[0].name, version: extensionRows[0].version } : null;

  const indexRows = await query(`
    SELECT c.relname AS name,
           pg_get_indexdef(i.indexrelid) AS definition,
           i.indisvalid AS "isValid",
           i.indisready AS "isReady",
           i.indislive AS "isLive",
           pg_relation_size(i.indexrelid) AS "sizeBytes",
           (SELECT idx_scan FROM pg_stat_user_indexes u WHERE u.indexrelid = i.indexrelid) AS scans
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    WHERE t.relname = '${tableName.replace(/'/g, "''")}'
      AND pg_get_indexdef(i.indexrelid) ~* 'using (hnsw|ivfflat)'
    ORDER BY c.relname
  `);
  const indexRow = indexRows[0] || null;
  const index = indexRow
    ? {
      name: indexRow.name,
      method: detectIndexMethod(indexRow.definition),
      opclass: /\((\w+)\s+(\w+_ops)\)/.exec(indexRow.definition)?.[2] || null,
      definition: indexRow.definition,
      isValid: indexRow.isValid,
      isReady: indexRow.isReady,
      isLive: indexRow.isLive,
      sizeBytes: indexRow.sizeBytes === null || indexRow.sizeBytes === undefined ? null : Number(indexRow.sizeBytes),
      scans: indexRow.scans === null || indexRow.scans === undefined ? null : Number(indexRow.scans),
    }
    : null;

  let embeddings = null;
  try {
    const rows = await query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE "${columnName}" IS NULL)::int AS nulls,
             count(*) FILTER (WHERE "${columnName}" IS NOT NULL
                              AND vector_dims("${columnName}") <> (
                                SELECT vector_dims("${columnName}") FROM ${tableName}
                                WHERE "${columnName}" IS NOT NULL LIMIT 1))::int AS "wrongDimensions"
      FROM ${tableName}
    `);
    const row = rows[0] || {};
    const dimensionRows = await query(`
      SELECT vector_dims("${columnName}")::int AS dims FROM ${tableName}
      WHERE "${columnName}" IS NOT NULL LIMIT 1
    `);
    embeddings = {
      total: Number(row.total || 0),
      nulls: Number(row.nulls || 0),
      wrongDimensions: Number(row.wrongDimensions || 0),
      measuredDimensions: dimensionRows[0] ? Number(dimensionRows[0].dims) : null,
    };
  } catch (error) {
    embeddings = null;
  }

  let plan = null;
  if (index) {
    try {
      const planRows = await query(`
        EXPLAIN (COSTS OFF)
        SELECT id FROM ${tableName}
        WHERE "${columnName}" IS NOT NULL
        ORDER BY "${columnName}" <=> (SELECT "${columnName}" FROM ${tableName} WHERE "${columnName}" IS NOT NULL LIMIT 1)
        LIMIT 5
      `);
      const planText = planRows.map((row) => row['QUERY PLAN']).join('\n');
      plan = {
        usesVectorIndex: new RegExp(`Index Scan using ${index.name}\\b`).test(planText)
          || /using [a-z_]*hnsw[a-z_]*/i.test(planText) && planText.includes(index.name),
        detail: planText.split('\n').slice(-3).join(' | ').slice(0, 300),
      };
    } catch (error) {
      plan = null;
    }
  }

  return { tableName, columnName, extension, index, embeddings, plan };
}

/**
 * Mede e avalia, aplicando a política declarativa.
 * @param {object} input  `{ policy, tableName, columnName }`
 */
async function checkVectorIndexHealth({ policy = {}, tableName, columnName } = {}) {
  const vectorPolicy = policy.vectorIndex || {};
  const measured = await measureVectorIndex({
    tableName: tableName || vectorPolicy.tableName || 'rag_chunks',
    columnName: columnName || vectorPolicy.columnName || 'embedding',
  });

  const evaluationInput = { ...measured, policy: vectorPolicy };
  if (measured.embeddings && vectorPolicy.expectedDimensions) {
    // A dimensão esperada vem da POLÍTICA (declarada); a medida serve de
    // conferência — se divergirem, o achado é de dimensão errada.
    evaluationInput.embeddings = {
      ...measured.embeddings,
      expectedDimensions: vectorPolicy.expectedDimensions,
    };
  }
  const evaluation = evaluateVectorIndexHealth(evaluationInput);
  return { measured, evaluation, policy: vectorPolicy };
}

module.exports = {
  measureVectorIndex,
  checkVectorIndexHealth,
};
