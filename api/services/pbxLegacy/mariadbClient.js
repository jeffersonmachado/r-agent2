const config = require('../../utils/config');

let pool = null;
let mysql = null;

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_QUERY_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_ATTEMPTS = 2; // total = 1 tentativa + 1 retry
const DEFAULT_RETRY_BASE_DELAY_MS = 200;

function getMariaDbConfig() {
  // Prefer URL única (mysql://user:pass@host:port/db)
  const url = (config.get('pbx.mariadb.url', process.env.PBX_MARIADB_URL || '') || '').trim();
  if (url) return { url };

  const host = (config.get('pbx.mariadb.host', process.env.PBX_MARIADB_HOST || '') || '').trim();
  const port = Number(config.get('pbx.mariadb.port', process.env.PBX_MARIADB_PORT || 3306));
  const database = (config.get('pbx.mariadb.database', process.env.PBX_MARIADB_DATABASE || '') || '').trim();
  const user = (config.get('pbx.mariadb.username', process.env.PBX_MARIADB_USER || '') || '').trim();
  const password = (config.get('pbx.mariadb.password', process.env.PBX_MARIADB_PASSWORD || '') || '').trim();

  return { host, port, database, user, password };
}

function getClientTuning() {
  const connectTimeoutMs = Number(config.get(
    'pbx.mariadb.connectTimeoutMs',
    process.env.PBX_MARIADB_CONNECT_TIMEOUT_MS || DEFAULT_CONNECT_TIMEOUT_MS,
  ));
  const queryTimeoutMs = Number(config.get(
    'pbx.mariadb.queryTimeoutMs',
    process.env.PBX_MARIADB_QUERY_TIMEOUT_MS || DEFAULT_QUERY_TIMEOUT_MS,
  ));
  const retryAttempts = Number(config.get(
    'pbx.mariadb.retryAttempts',
    process.env.PBX_MARIADB_RETRY_ATTEMPTS || DEFAULT_RETRY_ATTEMPTS,
  ));
  const retryBaseDelayMs = Number(config.get(
    'pbx.mariadb.retryBaseDelayMs',
    process.env.PBX_MARIADB_RETRY_BASE_DELAY_MS || DEFAULT_RETRY_BASE_DELAY_MS,
  ));

  return {
    connectTimeoutMs: Number.isFinite(connectTimeoutMs) ? connectTimeoutMs : DEFAULT_CONNECT_TIMEOUT_MS,
    queryTimeoutMs: Number.isFinite(queryTimeoutMs) ? queryTimeoutMs : DEFAULT_QUERY_TIMEOUT_MS,
    retryAttempts: Number.isFinite(retryAttempts) ? retryAttempts : DEFAULT_RETRY_ATTEMPTS,
    retryBaseDelayMs: Number.isFinite(retryBaseDelayMs) ? retryBaseDelayMs : DEFAULT_RETRY_BASE_DELAY_MS,
  };
}

async function getMysql() {
  if (mysql) return mysql;
  // lazy import
  // eslint-disable-next-line global-require
  mysql = require('mysql2/promise');
  return mysql;
}

async function getPool() {
  if (pool) return pool;
  const mysqlLib = await getMysql();
  const cfg = getMariaDbConfig();
  const tuning = getClientTuning();

  // Not configured => no pool (caller decide)
  if (cfg.url) {
    pool = mysqlLib.createPool({
      uri: cfg.url,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      connectTimeout: tuning.connectTimeoutMs,
    });
    return pool;
  }

  if (!cfg.host || !cfg.database || !cfg.user) {
    return null;
  }

  pool = mysqlLib.createPool({
    host: cfg.host,
    port: cfg.port || 3306,
    user: cfg.user,
    password: cfg.password || '',
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    connectTimeout: tuning.connectTimeoutMs,
  });
  return pool;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(fn, opts = {}) {
  const attempts = Number.isFinite(opts.attempts) ? opts.attempts : DEFAULT_RETRY_ATTEMPTS;
  const baseDelayMs = Number.isFinite(opts.baseDelayMs) ? opts.baseDelayMs : DEFAULT_RETRY_BASE_DELAY_MS;

  let lastErr;
  for (let i = 0; i < Math.max(1, attempts); i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn(i);
    } catch (err) {
      lastErr = err;
      // eslint-disable-next-line no-await-in-loop
      if (i < attempts - 1) await sleep(baseDelayMs * (i + 1));
    }
  }
  throw lastErr;
}

async function checkMariaDbHealth() {
  const p = await getPool();
  if (!p) {
    return { configured: false, status: 'not_configured' };
  }
  try {
    const tuning = getClientTuning();
    const [rows] = await withRetry(
      () => p.query({ sql: 'SELECT 1 AS ok', timeout: tuning.queryTimeoutMs }),
      { attempts: tuning.retryAttempts, baseDelayMs: tuning.retryBaseDelayMs },
    );
    const ok = Array.isArray(rows) && rows[0] && rows[0].ok === 1;
    return { configured: true, status: ok ? 'healthy' : 'unhealthy' };
  } catch (err) {
    return { configured: true, status: 'unhealthy', error: err.message };
  }
}

module.exports = {
  getMariaDbConfig,
  getClientTuning,
  getPool,
  checkMariaDbHealth,
};

