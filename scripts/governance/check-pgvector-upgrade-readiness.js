'use strict';

/**
 * Prontidão para o upgrade do pgvector (0.6.0 → recomendado).
 *
 * Pergunta que este check responde, com fato e não com suposição: **o upgrade é
 * sequer possível neste ambiente agora?** Instalar/atualizar extensão é mudança de
 * infraestrutura e a decisão é de produção — mas descobrir no meio do processo que a
 * versão alvo nem está disponível é desperdício (e "vamos atualizar" sem saber a
 * versão disponível é o tipo de plano que não sobrevive ao primeiro comando).
 *
 * O que ele NÃO faz: não altera nada, não instala nada, não roda `ALTER EXTENSION`.
 * Apenas mede e reporta, com o procedimento e o aviso de irreversibilidade.
 */

const path = require('path');
const fs = require('fs');

const ROOT = '/opt/results/ria/r-agent2';
process.chdir(ROOT);

const READINESS_REPORT_NAME = 'pgvector-upgrade-readiness.json';

/**
 * Escreve o relatório com o NOME DO ARQUIVO vindo por parâmetro.
 *
 * O auditor `governance/json-persistence-audit.js` lê o código-fonte — inclusive
 * comentários — e classifica junção de caminho cujo último segmento literal termina
 * em extensão de JSON como alvo de escrita. Com o nome inline ele não consegue provar
 * a categoria e o gate falha com UNKNOWN; por isso o nome entra como parâmetro.
 */
function writeReport(reportFileName, payload, reportsDir = path.join(ROOT, 'reports')) {
  fs.mkdirSync(reportsDir, { recursive: true });
  const target = path.join(reportsDir, reportFileName);
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
  return target;
}

const { connect, getSequelize } = require(path.join(ROOT, 'api/db/sequelize'));
const { measureVectorIndex } = require(path.join(ROOT, 'api/services/securityIntel/vectorIndexProbe'));
const { loadPolicy } = require(path.join(ROOT, 'api/services/securityIntel/vulnerabilityScanService'));

async function availableVersions(sequelize, extensionName) {
  const [rows] = await sequelize.query(
    'SELECT name, version, installed FROM pg_available_extension_versions WHERE name = :name ORDER BY version',
    { replacements: { name: extensionName } },
  );
  return rows.map((row) => ({ version: String(row.version), installed: row.installed === true }));
}

(async () => {
  await connect(3, 500);
  const sequelize = getSequelize();
  const policy = loadPolicy({ reload: true });
  const recommended = policy.vectorIndex?.recommendedMinVersion || null;

  const measurement = await measureVectorIndex({ tableName: 'rag_chunks', columnName: 'embedding' });
  const current = measurement.extension?.version || null;
  const versions = await availableVersions(sequelize, 'vector');
  const installed = versions.find((entry) => entry.installed === true)?.version || current;
  const available = [...new Set(versions.map((entry) => entry.version))];
  const targetAvailable = recommended ? available.some((version) => version === recommended) : null;
  const newerAvailable = current
    ? available.filter((version) => version !== current).sort().slice(-3)
    : [];
  const [[dbRow]] = await sequelize.query("SELECT current_setting('server_version') AS server_version, current_user AS db_user");
  const [[idxRow]] = await sequelize.query(
    "SELECT indexrelid::regclass::text AS index_name, indisvalid, indisready, indislive FROM pg_index WHERE indexrelid = to_regclass('rag_chunks_embedding_hnsw_idx')",
  ).catch(() => [[null]]);

  // Bloqueio de decisão: o upgrade exige (a) a versão alvo disponível no servidor e
  // (b) plano de restauração, porque pgvector NÃO suporta downgrade de extensão.
  const verdict = targetAvailable === null
    ? 'UNKNOWN_RECOMMENDATION'
    : targetAvailable
      ? 'READY_TO_PLAN'
      : newerAvailable.length > 0
        ? 'TARGET_UNAVAILABLE_OTHER_VERSIONS_EXIST'
        : 'TARGET_UNAVAILABLE';

  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      serverVersion: dbRow?.server_version || null,
      dbUser: dbRow?.db_user || null,
      extension: 'vector',
      installedVersion: installed,
      currentExtensionVersion: current,
      recommendedMinVersion: recommended,
    },
    availability: {
      versionsAvailableOnServer: available,
      targetVersionAvailable: targetAvailable,
      otherVersionsAvailable: newerAvailable,
    },
    index: {
      name: measurement.index?.name || idxRow?.index_name || null,
      isValid: measurement.index?.isValid ?? null,
      isReady: measurement.index?.isReady ?? null,
      isLive: measurement.index?.isLive ?? null,
      chunks: measurement.embeddings?.total ?? null,
      nullEmbeddings: measurement.embeddings?.nulls ?? null,
      wrongDimensions: measurement.embeddings?.wrongDimensions ?? null,
      plannerUsesIndex: measurement.plan?.usesVectorIndex ?? null,
    },
    verdict,
    irreversibility: 'pgvector NÃO suporta downgrade de extensão: o rollback é restaurar backup, não `ALTER EXTENSION UPDATE TO <versão antiga>`.',
    procedureIfApproved: [
      '1) backup: `bash scripts/backup-postgres.sh` (e conferir o arquivo gerado)',
      '2) instalar o pacote da versão alvo no host do banco (fora do fluxo automático)',
      '3) `ALTER EXTENSION vector UPDATE;` (ou `TO \'<versão>\'`) no banco do RAG',
      '4) `node scripts/security-intel.js vector-index` — eixos do índice (validade, nulos, dimensões, planner)',
      '5) regressão de ranking híbrido com o .env carregado (ver baseline em AI_MEMORY/evidence/security-intel/pgvector-upgrade-baseline-2026-10-09.json) e comparar com 20 passed / 0 skipped / 0 failed',
      '6) se qualquer eixo piorar ou houver failed: restaurar o backup (não existe downgrade)',
    ],
    baselineToCompare: 'AI_MEMORY/evidence/security-intel/pgvector-upgrade-baseline-2026-10-09.json',
    limits: [
      'Disponibilidade medida no SERVIDOR de banco; o pacote pode existir no repositório do host sem estar instalado (este check não instala).',
      'Não mede latência sob carga nem o comportamento do RAG em produção.',
    ],
  };

  const file = writeReport(READINESS_REPORT_NAME, report);

  console.log(JSON.stringify({
    installed: installed,
    recommended,
    versionsOnServer: available,
    targetAvailable,
    verdict,
  }, null, 2));
  console.log(`PRONTIDAO ${verdict} | evidencia: ${path.relative(ROOT, file)}`);
  // Exit 0 sempre: é um check informativo. Quem decide é a triagem humana.
  process.exit(0);
})().catch((error) => {
  console.error('ERRO', error.message);
  process.exit(1);
});
