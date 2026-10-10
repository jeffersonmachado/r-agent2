#!/usr/bin/env node
'use strict';

/**
 * validate-rag-ingestion-proof.js — PROVA de ingestão no BANCO, não no manifesto.
 *
 * POR QUE EXISTE: em 2026-09-11 o `reports/rag-sync-manifest.json` declarava ~436
 * arquivos sincronizados e o banco do ambiente tinha ZERO dos roteiros — o
 * copiloto respondia fallback para "Como faço uma matrícula?" e nenhum gate
 * percebia, porque a evidência consultada era o próprio manifesto (e o
 * `rag:sync --dry-run` se apoia nele). Ambiente reconstruído/migrado volta a
 * divergir sem que ninguém veja.
 *
 * O que mede: para cada fonte declarada em `config/rag-canonical-knowledge.json`
 * (conhecimento que o copiloto PRECISA ter), exige no banco do tenant:
 * documento presente, no escopo declarado (domain/classification), com
 * `index_status = 'indexed'` e chunks > 0.
 *
 * Veredito: PASS só com TODAS as fontes provadas. Qualquer ausência/escopo
 * errado/0 chunks reprova — a lista é pequena e explícita de propósito: uma
 * pergunta canônica que não tem fonte é um defeito do produto, não do corpus.
 *
 * Saída: `reports/rag-ingestion-proof-report.json`.
 * Uso: node --env-file-if-exists=.env scripts/governance/validate-rag-ingestion-proof.js [--json]
 */

const fs = require('fs');
const path = require('path');

const evalFn = require('./lib/ragCanonicalSources');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'rag-canonical-knowledge.json');
const REPORT_PATH = path.join(ROOT, 'reports', 'rag-ingestion-proof-report.json');

async function main() {
  const canonical = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  const db = require(path.join(ROOT, 'api', 'db'));
  const { QueryTypes } = require('sequelize');
  await db.connect();
  const sequelize = db.getSequelize();

  const ids = canonical.sources.map((source) => source.id);
  const rows = await sequelize.query(`
    SELECT d.id,
           d.domain,
           d.classification,
           d.index_status AS "indexStatus",
           (SELECT count(*)::int FROM rag_chunks c WHERE c.document_id = d.id) AS chunks
      FROM rag_documents d
     WHERE d.tenant_key = :tenantKey
       AND d.id IN (:ids)
  `, {
    type: QueryTypes.SELECT,
    replacements: { tenantKey: canonical.tenantKey, ids },
  });

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const { violations, checked } = evalFn.evaluateCanonicalSources({ canonical, rowsById });

  const report = {
    report: 'RAG_INGESTION_PROOF',
    generatedAt: new Date().toISOString(),
    status: violations.length === 0 ? 'PASS' : 'NO_GO',
    tenantKey: canonical.tenantKey,
    domain: canonical.domain,
    expectedSources: canonical.sources.length,
    checked,
    violations,
    note: 'Prova de INGESTÃO medida no banco (o manifesto de sync não é prova). Fontes declaradas em config/rag-canonical-knowledge.json.',
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`[rag-ingestion-proof] status=${report.status} fontes=${report.expectedSources} provadas=${checked.length} violações=${violations.length}\n`);
    for (const violation of violations) process.stdout.write(`  [VIOLAÇÃO] ${violation.code} — ${violation.detail}\n`);
  }
  process.exit(report.status === 'PASS' ? 0 : 1);
}

main().catch((error) => {
  console.error(`[rag-ingestion-proof] falhou: ${error.message}`);
  process.exit(1);
});
