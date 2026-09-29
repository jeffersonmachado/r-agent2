#!/usr/bin/env node
'use strict';

/**
 * validate-rag-index-health.js — MEDIÇÃO do corpus RAG (missão 2026-09-28).
 *
 * POR QUE EXISTE: o selo V2 lia o eixo `RAG_INDEX_HEALTH` de um RELATÓRIO DE STATUS ESTÁTICO
 * (`ENGINEERING_ROUTER_V2_STATUS_REPORT.json`, gerado em 2026-09-24). Isso inverte a direção da
 * cadeia: um arquivo narrativo virava a fonte da decisão de governança, e o estado podia estar
 * errado (para mais ou para menos) sem que nada o corrigisse. A direção correta é
 * runtime → medição → gate; status report é SAÍDA, nunca entrada.
 *
 * O que mede, no banco real:
 *   - documentos por estado de indexação (`indexed`, `not_indexed_duplicate`, `failed`, `pending`);
 *   - chunks por documento (documento `indexed` SEM chunks é INCONSISTENTE — falha);
 *   - resíduo: `failed` sem tenant (nunca retornável, nunca reparável) é DECLARADO, não escondido.
 *
 * Veredito:
 *   HEALTHY  — todos os `indexed` têm chunks; nenhum `failed` reparável; duplicações declaradas
 *              no estado próprio; exceções nomeadas com motivo.
 *   NO_GO    — qualquer `indexed` sem chunks, ou `failed` que não esteja declarado como exceção.
 *
 * Saída: `reports/rag-index-health-report.json`.
 * Uso: node --env-file-if-exists=.env scripts/governance/validate-rag-index-health.js [--json]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT, 'reports', 'rag-index-health-report.json');

/**
 * Exceções DECLARADAS: documentos `failed` que não são reparáveis e cujo conteúdo não deve ser
 * removido (regra: nunca destruir conteúdo possível por conveniência de estado). Cada exceção exige
 * motivo e origem — uma exceção sem motivo é um esconderijo.
 */
const DECLARED_FAILED_EXCEPTIONS = Object.freeze([
  {
    id: '6e19c37c-891a-47b9-a88e-96455d5aa63b',
    reason: 'fixture de validação ("exemplo-invalido"), sem tenant: a rota de indexação exige tenantId, então não é reparável; o retrieval filtra por tenant, então nunca é retornado',
    origin: 'teste de validação (2026-07-26)',
  },
  {
    id: 'c384903f-cdd9-4623-acd7-87f1f94ad1f9',
    reason: 'fixture de validação ("host-inexistente-qa.invalid"), sem tenant: mesma classe do anterior',
    origin: 'teste de validação (2026-07-26)',
  },
]);

async function main() {
  const db = require(path.join(ROOT, 'api', 'db'));
  const { QueryTypes } = require('sequelize');
  await db.connect();
  const sequelize = db.getSequelize();

  const byStatus = await sequelize.query(
    'SELECT index_status, count(*)::int AS total FROM rag_documents GROUP BY 1 ORDER BY 2 DESC',
    { type: QueryTypes.SELECT },
  );
  const indexedWithoutChunks = await sequelize.query(`
    SELECT d.id
      FROM rag_documents d
     WHERE d.index_status = 'indexed'
       AND NOT EXISTS (SELECT 1 FROM rag_chunks c WHERE c.document_id = d.id)
  `, { type: QueryTypes.SELECT });
  const failedDocs = await sequelize.query(
    "SELECT id, tenant_key FROM rag_documents WHERE index_status = 'failed'",
    { type: QueryTypes.SELECT },
  );
  const totals = await sequelize.query(
    'SELECT count(*)::int AS chunks, count(DISTINCT document_id)::int AS docs FROM rag_chunks',
    { type: QueryTypes.SELECT },
  );

  const declaredIds = new Set(DECLARED_FAILED_EXCEPTIONS.map((entry) => entry.id));
  const undeclaredFailed = failedDocs.filter((row) => !declaredIds.has(row.id));
  const declaredButMissing = DECLARED_FAILED_EXCEPTIONS.filter((entry) => !failedDocs.some((row) => row.id === entry.id));

  const violations = [];
  if (indexedWithoutChunks.length > 0) {
    violations.push({
      code: 'INDEXED_WITHOUT_CHUNKS',
      detail: `${indexedWithoutChunks.length} documento(s) marcados como indexed SEM chunks (documento inalcançável pelo retrieval)`,
      ids: indexedWithoutChunks.slice(0, 10).map((row) => row.id),
    });
  }
  if (undeclaredFailed.length > 0) {
    violations.push({
      code: 'UNDECLARED_FAILED_DOCUMENT',
      detail: `${undeclaredFailed.length} documento(s) em failed SEM exceção declarada`,
      ids: undeclaredFailed.slice(0, 10).map((row) => row.id),
    });
  }

  const statusByKey = Object.fromEntries(byStatus.map((row) => [row.index_status, row.total]));
  const report = {
    report: 'RAG_INDEX_HEALTH',
    generatedAt: new Date().toISOString(),
    status: violations.length === 0 ? 'HEALTHY' : 'NO_GO',
    byStatus: statusByKey,
    chunks: totals[0] ? totals[0].chunks : 0,
    documentsWithChunks: totals[0] ? totals[0].docs : 0,
    indexedWithoutChunks: indexedWithoutChunks.map((row) => row.id),
    failed: failedDocs.map((row) => ({ id: row.id, tenantKey: row.tenant_key })),
    declaredExceptions: DECLARED_FAILED_EXCEPTIONS,
    staleExceptions: declaredButMissing.map((entry) => entry.id),
    violations,
    note: 'Medição DIRETA do banco (runtime → medição → gate). Substitui a leitura do eixo estático do status report como fonte de decisão.',
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`[rag-index-health] status=${report.status} indexed=${statusByKey.indexed || 0} duplicados=${statusByKey.not_indexed_duplicate || 0} failed=${statusByKey.failed || 0} chunks=${report.chunks} violações=${violations.length}\n`);
    for (const violation of violations) process.stdout.write(`  [VIOLAÇÃO] ${violation.code} — ${violation.detail}\n`);
  }
  process.exit(report.status === 'HEALTHY' ? 0 : 1);
}

main().catch((error) => {
  console.error(`[rag-index-health] falhou: ${error.message}`);
  process.exit(1);
});
