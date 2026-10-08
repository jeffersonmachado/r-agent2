'use strict';

/**
 * probes — sondas de RUNTIME usadas pela descoberta.
 *
 * Cada probe devolve o que mediu ou LANÇA (a descoberta converte lançamento em
 * indisponibilidade explícita). Probe nunca devolve valor fabricado: se não deu
 * para medir, o caminho é a exceção, não um "unknown" silencioso.
 *
 * `docker` merece nota: o host do RAP de desenvolvimento não tem socket Docker
 * acessível para a API, e a stack de produção roda em outro host. Por isso o
 * probe é OPCIONAL e best-effort — quando indisponível, o inventário registra a
 * lacuna em vez de fingir que as imagens locais são o que está em execução.
 */

const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

const DEFAULT_RAG_URL = 'http://127.0.0.1:8001';
const PROBE_TIMEOUT_MS = 4000;

function runCommand(command, args, { timeout = PROBE_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${command}_failed:${(stderr || error.message || '').toString().trim().slice(0, 200)}`));
        return;
      }
      resolve(String(stdout));
    });
  });
}

/** Extrai "16.4" de "PostgreSQL 16.4 (Ubuntu ...)". */
function parsePostgresVersion(value) {
  const match = /PostgreSQL\s+([0-9]+(?:\.[0-9]+)*)/i.exec(String(value || ''));
  return match ? match[1] : null;
}

function parseRedisVersion(info) {
  const match = /redis_version:([0-9][0-9.]*)/.exec(String(info || ''));
  return match ? match[1] : null;
}

/** Cliente Redis efêmero: conecta, mede, fecha. Nunca deixa handle aberto. */
async function probeRedis(env) {
  const Redis = require('ioredis');
  const url = env.REDIS_URL
    || `redis://${env.REDIS_HOST || '127.0.0.1'}:${env.REDIS_PORT || 6379}`;
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: PROBE_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    enableOfflineQueue: false,
  });
  client.on('error', () => {});
  try {
    await client.connect();
    const info = await client.info('server');
    return { version: parseRedisVersion(info) };
  } finally {
    try {
      await client.quit();
    } catch (error) {
      client.disconnect();
    }
  }
}

async function probePostgres() {
  const { connect } = require('../../db/sequelize');
  const sequelize = await connect(2, 500);
  const [versionRows] = await sequelize.query('SELECT version() AS version');
  const [extensionRows] = await sequelize.query('SELECT extname, extversion FROM pg_extension');
  const extensions = {};
  for (const row of extensionRows) extensions[row.extname] = row.extversion;
  return { version: parsePostgresVersion(versionRows[0] && versionRows[0].version), extensions };
}

async function probeRagService(env) {
  const base = (env.RAG_SERVICE_URL || DEFAULT_RAG_URL).replace(/\/$/, '');
  const response = await fetch(`${base}/health`, {
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`rag_health_http_${response.status}`);
  const body = await response.json().catch(() => ({}));
  return {
    version: body.version || body.app_version || null,
    pythonVersion: body.pythonVersion || body.python_version || null,
    // O serviço expõe `embeddingModel` (camelCase). Ler apenas o snake_case
    // produzia silenciosamente `null` — medido em 2026-10-08 contra o
    // /health real do rag-service.
    embeddingModel: body.embeddingModel || body.embedding_model || body.model || null,
    vectorStore: body.vectorStore || body.vector_store || null,
  };
}

/**
 * Inspeciona as imagens declaradas no compose. Só devolve o que o Docker local
 * conhece — nada é inferido a partir do nome da tag.
 */
async function probeDocker(declaredImages) {
  await runCommand('docker', ['version', '--format', '{{.Server.Version}}']);
  const images = [];
  const seen = new Set();
  for (const declared of declaredImages) {
    if (seen.has(declared.reference)) continue;
    seen.add(declared.reference);
    try {
      const output = await runCommand('docker', [
        'image', 'inspect', declared.reference,
        '--format', '{{.Id}}|{{json .RepoDigests}}',
      ]);
      const [imageId, digestsRaw] = output.trim().split('|');
      let digest = null;
      try {
        const digests = JSON.parse(digestsRaw || '[]');
        if (Array.isArray(digests) && digests.length > 0) {
          digest = digests[0].includes('@') ? digests[0].split('@')[1] : digests[0];
        }
      } catch (error) {
        digest = null;
      }
      images.push({
        name: declared.name,
        version: declared.tag || (imageId || '').slice(7, 19) || 'unknown',
        service: declared.service,
        kind: 'container-image',
        imageId,
        imageDigest: digest,
      });
    } catch (error) {
      // Imagem ausente localmente: é lacuna de inventário, não erro do probe.
      continue;
    }
  }
  return { images };
}

/**
 * Monta o mapa de probes com o ambiente real.
 * @param {object} options
 * @param {string} options.rootDir
 * @param {object} [options.env]
 * @param {Array<{reference:string,name:string,tag:string,service:string}>} [options.declaredImages]
 * @param {boolean} [options.includeDocker]
 */
function createDefaultProbes({ rootDir, env = process.env, declaredImages = [], includeDocker = true } = {}) {
  const probes = {
    runtime: () => ({
      version: process.version,
      versions: process.versions,
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      kernel: os.release(),
    }),
    osRelease: () => {
      const read = fs.readFileSync('/etc/os-release', 'utf8');
      return read;
    },
    postgres: () => probePostgres(),
    redis: () => probeRedis(env),
    ragService: () => probeRagService(env),
  };
  if (includeDocker) {
    probes.docker = () => probeDocker(declaredImages);
  }
  return probes;
}

module.exports = {
  PROBE_TIMEOUT_MS,
  createDefaultProbes,
  parsePostgresVersion,
  parseRedisVersion,
  probeDocker,
  probePostgres,
  probeRagService,
  probeRedis,
  runCommand,
};
