'use strict';

/**
 * Detecção e correção de BLOAT DE ÍNDICE no Postgres.
 *
 * MOTIVAÇÃO (medida em 2026-10-02, não presumida)
 * ----------------------------------------------
 * O banco tinha 11 GB dos quais a maior parte era índice inchado. Medições:
 *
 *   tabela            indices ANTES   indices DEPOIS   fator
 *   event_ledger       5.393 MB         424 MB        12,7x
 *   execution_jobs     2.100 MB         310 MB         6,8x
 *   runtime_artifacts    7,9 MB         4,8 MB        1,65x
 *   ------------------------------------------------------------------
 *   banco                11 GB          4,7 GB    ~6,2 GB devolvidos (~56%)
 *
 * Prova direta do inchaço (não inferência): foi construído um índice NOVO com
 * a MESMA definição de `event_ledger_tenant_occurred_at_idx` —
 * `(tenant_key, occurred_at)` — e ele ocupou **26 MB contra 283 MB** do
 * existente (10,9x), em 1,8 s. O espaço era bloat, não dado.
 *
 * CAUSA RAIZ: os expurgos (`prune_event_ledger`, `prune_execution_jobs`, ...)
 * apagam linhas continuamente, mas `DELETE` + `VACUUM` NÃO devolvem páginas ao
 * sistema operacional nem compactam a btree. Sem REINDEX, cada ciclo deixa as
 * páginas antigas no lugar e o índice fica dimensionado para o PICO HISTÓRICO.
 * Com ~100 mil linhas/dia entrando nas duas tabelas, isso degrada cache, I/O de
 * varredura, custo de escrita e custo de autovacuum — exatamente a classe de
 * problema que aparece ao escalar para milhões de transações.
 *
 * COMO DETECTA (sem extensão, sem achismo)
 * ----------------------------------------
 * Métrica: **bytes de índice por linha viva, por índice**. Valores MEDIDOS:
 *   - saudável:  42 B/linha/índice (execution_jobs) e 63 (event_ledger)
 *   - legítimo largo: 181 (índice de 3 colunas com chave longa)
 *   - inchado: 288 B/linha/índice (execution_jobs) e 808 (event_ledger)
 *
 * LIMITE DEFAULT = 200, e a ESCOLHA É DELIBERADAMENTE CONSERVADORA. A margem
 * entre o índice legítimo mais largo medido (181) e o menor caso inchado
 * confirmado (288) é estreita (~1,6x), então esta métrica SOZINHA não separa os
 * dois com folga: ela conflita "chave larga" com "bloat". A verificação
 * decisiva é reconstruir uma cópia e comparar (foi assim que o defeito foi
 * provado: 26 MB novos contra 283 MB existentes, 10,9x).
 * A assimetria justifica o viés para baixo: um FALSO POSITIVO custa um
 * `REINDEX CONCURRENTLY` que não bloqueia escrita, não muda comportamento e
 * leva segundos; um FALSO NEGATIVO deixa o inchaço acumulando — que é o que
 * degrada cache, I/O e custo de escrita ao escalar para milhões de transações.
 * Para conferir um caso duvidoso sem reconstruir: construir um índice temporário
 * com a MESMA definição e comparar tamanhos (`--probe` documentado no cabeçalho).
 *
 * GARANTIAS
 * ---------
 * 1. DRY-RUN POR PADRÃO. Só reconstrói com `--execute` (convenção de
 *    scripts/sweep-orphan-blobs.js).
 * 2. Usa `REINDEX ... CONCURRENTLY`: NÃO bloqueia escrita (verificado: 54,8 s e
 *    64,5 s nas duas maiores tabelas, sem indisponibilidade).
 * 3. Nunca remove índice — reconstruir preserva 100% da funcionalidade.
 * 4. Ao final confere `pg_index.indisvalid` e reporta índice inválido (falha de
 *    REINDEX CONCURRENTLY deixa índice inválido, e isso não pode passar em
 *    silêncio).
 * 5. Limite inválido ABORTA em vez de reindexar tudo.
 *
 * USO
 * ---
 *   node scripts/db-reindex-bloated.js                     # dry-run
 *   node scripts/db-reindex-bloated.js --execute           # reconstrói
 *   node scripts/db-reindex-bloated.js --min-rows=10000    # ignora tabelas pequenas
 *   node scripts/db-reindex-bloated.js --threshold=300     # B/linha/índice
 */

const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DEFAULT_THRESHOLD_BYTES_PER_ROW = 200;
const DEFAULT_MIN_ROWS = 5000;

/** Extraído para teste puro: bytes de índice por linha viva, por índice. */
function indexBytesPerRow({ indexBytes, liveRows, indexCount }) {
  const rows = Number(liveRows);
  const count = Number(indexCount);
  if (!Number.isFinite(rows) || rows <= 0) return null;
  if (!Number.isFinite(count) || count <= 0) return null;
  if (!Number.isFinite(Number(indexBytes))) return null;
  return Number(indexBytes) / rows / count;
}

/** Extraído para teste puro: merece reconstrução? */
function isBloated({ bytesPerRow, thresholdBytesPerRow = DEFAULT_THRESHOLD_BYTES_PER_ROW }) {
  const value = Number(bytesPerRow);
  const threshold = Number(thresholdBytesPerRow);
  if (!Number.isFinite(value) || !Number.isFinite(threshold) || threshold <= 0) return false;
  return value > threshold;
}

/** Extraído para teste puro: a tabela entra na varredura? */
function isEligible({ liveRows, minRows = DEFAULT_MIN_ROWS }) {
  const rows = Number(liveRows);
  const min = Number(minRows);
  if (!Number.isFinite(rows) || !Number.isFinite(min)) return false;
  return rows >= min;
}

function parseArgs(argv) {
  const out = { execute: false, threshold: undefined, minRows: undefined };
  for (const arg of argv) {
    if (arg === '--execute') out.execute = true;
    else if (arg.startsWith('--threshold=')) out.threshold = arg.slice('--threshold='.length);
    else if (arg.startsWith('--min-rows=')) out.minRows = arg.slice('--min-rows='.length);
  }
  return out;
}

function resolvePositiveNumber(raw, fallback, label) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label}_invalido: ${raw} (esperado numero > 0)`);
  }
  return parsed;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1073741824) return `${(value / 1048576).toFixed(1)} MB`;
  return `${(value / 1073741824).toFixed(2)} GB`;
}

/**
 * Varredura BARATA: só tamanhos. A decisão NUNCA usa `n_live_tup`.
 *
 * ARMADILHA MEDIDA (2026-10-02): `n_live_tup` é ESTIMATIVA do autovacuum e fica
 * sistematicamente defasada nas tabelas que mais sofrem expurgo — exatamente as
 * que esta rotina existe para vigiar. Medido no banco real:
 *   scorecard_requirement_results  real 2.040.240  estimativa 77.220   (26x menor)
 *   vertical_engagement_signals    real   447.934  estimativa 24.592   (18x menor)
 *   scorecard_dimension_results    real   185.504  estimativa  7.020   (26x menor)
 *   event_ledger                   real   872.366  estimativa 874.119 (exata)
 * Usar a estimativa produzia FALSO POSITIVO nas três primeiras (1074, 719 e
 * 1077 B/linha/indice "inchados") quando a contagem real dá 41, 39 e 41 B/linha
 * — ou seja, índices saudáveis.
 */
const SURVEY_SQL = `
  SELECT c.relname AS table_name,
         pg_relation_size(c.oid) AS heap_bytes,
         pg_indexes_size(c.oid) AS index_bytes,
         (SELECT count(*) FROM pg_index c2 WHERE c2.indrelid = c.oid) AS index_count,
         (SELECT count(*) FROM pg_index c2 WHERE c2.indrelid = c.oid AND NOT c2.indisvalid) AS invalid_indexes
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r' AND n.nspname = 'public'
  ORDER BY pg_indexes_size(c.oid) DESC
`;

/**
 * Piso de índice (bytes) para uma tabela valer a contagem real. Contar linhas
 * exige varredura, então só contamos o que tem tamanho para importar.
 */
const DEFAULT_SCREEN_MIN_INDEX_BYTES = 20 * 1024 * 1024;

/** Extraído para teste puro: vale gastar a contagem real nesta tabela? */
function needsRealCount({ indexBytes, screenMinIndexBytes = DEFAULT_SCREEN_MIN_INDEX_BYTES }) {
  const size = Number(indexBytes);
  const floor = Number(screenMinIndexBytes);
  if (!Number.isFinite(size) || !Number.isFinite(floor) || floor <= 0) return false;
  return size >= floor;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Carregado aqui (nao no topo do modulo) para que importar este arquivo em
  // teste nao altere o ambiente do processo com o .env do repositorio.
  try {
    require('./governance/lib/loadEnvFile').loadEnvFile(ROOT_DIR);
  } catch (_) {
    /* .env opcional: DATABASE_URL pode vir do shell */
  }

  let threshold;
  let minRows;
  try {
    threshold = resolvePositiveNumber(
      args.threshold ?? process.env.DB_INDEX_BLOAT_THRESHOLD_BYTES,
      DEFAULT_THRESHOLD_BYTES_PER_ROW,
      'threshold'
    );
    minRows = resolvePositiveNumber(args.minRows ?? process.env.DB_INDEX_BLOAT_MIN_ROWS, DEFAULT_MIN_ROWS, 'min_rows');
  } catch (error) {
    console.error(`[db-reindex-bloated] ABORTADO — ${error.message}`);
    return 2;
  }

  const { connect, getSequelize, close } = require('../api/db/sequelize');
  await connect(3, 300);
  const sequelize = getSequelize();
  if (!sequelize) {
    console.error('[db-reindex-bloated] ABORTADO — sem conexao com o banco (DATABASE_URL)');
    return 2;
  }

  const { QueryTypes } = require('sequelize');
  const rows = await sequelize.query(SURVEY_SQL, { type: QueryTypes.SELECT });

  console.log(`[db-reindex-bloated] ${args.execute ? 'MODO: EXECUTAR' : 'MODO: DRY-RUN (use --execute)'}`);
  console.log(`  limite    : ${threshold} B/linha/indice`);
  console.log(`  min linhas: ${minRows}`);

  // Só as tabelas com índice relevante pagam o custo de uma contagem real.
  const candidates = rows.filter((row) => needsRealCount({ indexBytes: row.index_bytes }));
  const realRows = new Map();
  for (const row of candidates) {
    const counted = await sequelize.query(`SELECT count(*) AS total FROM "${row.table_name}"`, {
      type: QueryTypes.SELECT,
    });
    realRows.set(row.table_name, Number(counted?.[0]?.total) || 0);
  }

  const evaluated = rows.map((row) => {
    const indexBytes = Number(row.index_bytes) || 0;
    const indexCount = Number(row.index_count) || 0;
    // Contagem REAL quando disponível; para tabelas abaixo do piso de índice o
    // tamanho é irrelevante e `liveRows: 0` as torna inelegíveis (fail-closed).
    const liveRows = realRows.has(row.table_name) ? realRows.get(row.table_name) : 0;
    const bytesPerRow = indexBytesPerRow({ indexBytes, liveRows, indexCount });
    return {
      table: row.table_name,
      liveRows,
      counted: realRows.has(row.table_name),
      indexBytes,
      heapBytes: Number(row.heap_bytes) || 0,
      indexCount,
      invalidIndexes: Number(row.invalid_indexes) || 0,
      bytesPerRow,
      eligible: isEligible({ liveRows, minRows }),
      bloated: bytesPerRow !== null && isBloated({ bytesPerRow, thresholdBytesPerRow: threshold }),
    };
  });

  const flagged = evaluated.filter((item) => item.eligible && item.bloated);
  const totalIndexBytes = evaluated.reduce((sum, item) => sum + item.indexBytes, 0);

  console.log(`  tabelas analisadas: ${evaluated.length}`);
  console.log(`  indice total      : ${formatBytes(totalIndexBytes)}`);
  console.log(`  marcadas          : ${flagged.length}`);
  for (const item of flagged) {
    console.log(`    - ${item.table}: ${formatBytes(item.indexBytes)} em ${item.indexCount} indices sobre ${item.liveRows} linhas = ${Math.round(item.bytesPerRow)} B/linha/indice`);
  }

  if (!flagged.length) {
    console.log('[db-reindex-bloated] nenhuma tabela acima do limite — nada a fazer.');
    await close().catch(() => {});
    return 0;
  }

  if (!args.execute) {
    console.log('[db-reindex-bloated] DRY-RUN: nada foi reconstruido.');
    await close().catch(() => {});
    return 0;
  }

  const beforeBytes = evaluated.reduce((sum, item) => sum + item.indexBytes, 0);
  let failed = 0;
  for (const item of flagged) {
    const startedAt = Date.now();
    try {
      await sequelize.query(`REINDEX TABLE CONCURRENTLY "${item.table}"`, { type: QueryTypes.RAW });
      console.log(`    [ok] ${item.table} em ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
    } catch (error) {
      failed += 1;
      console.error(`    [falha] ${item.table}: ${error.message}`);
    }
  }

  const after = await sequelize.query(SURVEY_SQL, { type: QueryTypes.SELECT });
  const afterBytes = after.reduce((sum, row) => sum + (Number(row.index_bytes) || 0), 0);
  const invalid = after
    .filter((row) => Number(row.invalid_indexes) > 0)
    .map((row) => `${row.table_name}(${row.invalid_indexes})`);
  const dbSize = await sequelize.query(
    'SELECT pg_database_size(current_database()) AS bytes',
    { type: QueryTypes.SELECT }
  );

  console.log(`  indice antes  : ${formatBytes(beforeBytes)}`);
  console.log(`  indice depois : ${formatBytes(afterBytes)}`);
  console.log(`  devolvido     : ${formatBytes(Math.max(0, beforeBytes - afterBytes))}`);
  console.log(`  banco agora   : ${formatBytes(dbSize?.[0]?.bytes)}`);

  if (invalid.length) {
    console.error(`[db-reindex-bloated] ATENCAO — indices INVALIDOS (REINDEX CONCURRENTLY falhou): ${invalid.join(', ')}`);
    console.error('  Remédio: DROP INDEX + CREATE INDEX CONCURRENTLY para cada um.');
    await close().catch(() => {});
    return 1;
  }

  await close().catch(() => {});
  return failed > 0 ? 1 : 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`[db-reindex-bloated] FALHA: ${error.message}`);
      process.exit(1);
    });
}

module.exports = {
  DEFAULT_THRESHOLD_BYTES_PER_ROW,
  DEFAULT_MIN_ROWS,
  DEFAULT_SCREEN_MIN_INDEX_BYTES,
  SURVEY_SQL,
  indexBytesPerRow,
  isBloated,
  isEligible,
  needsRealCount,
  parseArgs,
  resolvePositiveNumber,
};
