'use strict';

/**
 * Reparo operacional: reindexa documentos RAG em estado `failed`.
 *
 * Contexto (medido em 2026-09-24): o vector store tinha 1944 documentos — 1664 `indexed` e 280
 * `failed`, com 6026 chunks (todos com embedding) e segregação de domínio correta
 * (SYSTEM 1869 / OPERATIONAL 75). Os motivos das falhas eram:
 *
 *   - RAG_INCONSISTENT (247): "Marcado como indexed, mas não há chunks gravados no Postgres" — o
 *     documento perdeu os chunks e ficou marcado como failed pelo verificador de consistência;
 *   - RAG_INDEX_FAILED (27): rag-service fora do ar no momento da indexação;
 *   - RAG_INDEX_FAILED (3): indexação retornou 0 chunks (duplicado/sem ingestão);
 *   - RAG_INDEX_FAILED (2): "tenantId é obrigatório" (chamada sem tenant);
 *   - RAG_INDEX_FAILED (1): 503 service_misconfigured (autenticação interna do RAG ausente).
 *
 * Só os 3 primeiros grupos são reparáveis por reindexação. Este script NÃO adivinha: ele lê o estado
 * real no banco, reindexa pela ROTA OFICIAL (`POST /rag/documents/:id/reindex`, com o header de
 * tenant que a rota exige), conta o que realmente foi reparado e escreve um relatório auditável.
 *
 * Uso:
 *   node scripts/reindex-failed-rag-documents.js                     # lista o que seria feito (dry-run)
 *   node scripts/reindex-failed-rag-documents.js --apply             # executa
 *   node scripts/reindex-failed-rag-documents.js --apply --limit=300 --concurrency=3
 *   node scripts/reindex-failed-rag-documents.js --apply --code=RAG_INCONSISTENT
 *
 * Env: API_BASE_URL, QA_USER, QA_PASS, TEST_TENANT_ID
 * Saída: reports/rag-failed-reindex-report.json
 */

const fs = require('fs');
const path = require('path');

const API = process.env.API_BASE_URL || 'http://localhost:3001';
const USER = process.env.QA_USER || 'systemadmin';
const PASS = process.env.QA_PASS || 'Admin123!';
const DEFAULT_TENANT = process.env.TEST_TENANT_ID || 'system';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const LIMIT = Number((args.find((a) => a.startsWith('--limit=')) || '--limit=100').split('=')[1]);
const CONCURRENCY = Number((args.find((a) => a.startsWith('--concurrency=')) || '--concurrency=3').split('=')[1]);
const CODE = (args.find((a) => a.startsWith('--code=')) || '').split('=')[1] || null;

async function login() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS, tenantKey: DEFAULT_TENANT, tenant_id: DEFAULT_TENANT }),
  });
  const body = await res.json().catch(() => ({}));
  const token = body.token || (body.data && body.data.token);
  if (!token) throw new Error(`login falhou (${res.status}): ${JSON.stringify(body).slice(0, 200)}`);
  return token;
}

async function selectFailed() {
  const sequelizeModule = require('../api/db/sequelize');
  await sequelizeModule.connect(2, 250);
  const sequelize = require('../api/db/models').EngineeringMission().sequelize;
  const where = ["index_status = 'failed'"];
  const replacements = { limit: LIMIT };
  if (CODE) { where.push('index_error_code = :code'); replacements.code = CODE; }
  const [rows] = await sequelize.query(
    `SELECT id, tenant_key, index_error_code, index_error_message
     FROM rag_documents WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC LIMIT :limit`,
    { replacements },
  );
  await sequelizeModule.close();
  return rows;
}

async function reindexOne(token, doc) {
  const res = await fetch(`${API}/rag/documents/${encodeURIComponent(doc.id)}/reindex`, {
    method: 'POST',
    // A rota resolve o tenant por `req.tenantId` (para super_admin, só o header) — medido: sem o
    // header a resposta é 403 tenant_required.
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Tenant-Id': doc.tenant_key || DEFAULT_TENANT,
    },
    body: JSON.stringify({ tenantKey: doc.tenant_key || DEFAULT_TENANT }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && body.success !== false, body };
}

async function main() {
  const startedAt = new Date().toISOString();
  const docs = await selectFailed();
  console.log(`[rag-repair] documentos failed selecionados: ${docs.length} (limite=${LIMIT}${CODE ? `, code=${CODE}` : ''})`);
  const byCode = {};
  for (const d of docs) byCode[d.index_error_code] = (byCode[d.index_error_code] || 0) + 1;
  console.log('[rag-repair] por código de erro:', JSON.stringify(byCode));

  if (!APPLY) {
    console.log('[rag-repair] DRY-RUN: nada foi alterado. Use --apply para executar.');
    return;
  }

  const token = await login();
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
    while (cursor < docs.length) {
      const doc = docs[cursor++];
      try {
        const out = await reindexOne(token, doc);
        results.push({ id: doc.id, code: doc.index_error_code, status: out.status, ok: out.ok, chunksCreated: out.body.chunksCreated || 0, error: out.ok ? null : JSON.stringify(out.body).slice(0, 160) });
      } catch (error) {
        results.push({ id: doc.id, code: doc.index_error_code, status: 0, ok: false, error: error.message });
      }
      if (results.length % 25 === 0) console.log(`[rag-repair] progresso: ${results.length}/${docs.length}`);
    }
  });
  await Promise.all(workers);

  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const report = {
    report: 'RAG_FAILED_DOCUMENTS_REINDEX',
    startedAt,
    finishedAt: new Date().toISOString(),
    apply: true,
    limit: LIMIT,
    code: CODE,
    concurrency: CONCURRENCY,
    selected: docs.length,
    byErrorCode: byCode,
    repaired: ok,
    stillFailing: failed.length,
    chunksCreated: results.reduce((acc, r) => acc + (r.chunksCreated || 0), 0),
    failures: failed.slice(0, 50),
    results,
  };
  const outPath = path.join(__dirname, '..', 'reports', 'rag-failed-reindex-report.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[rag-repair] reparados=${ok} ainda-falhando=${failed.length} chunks-criados=${report.chunksCreated}`);
  console.log(`[rag-repair] relatório: ${outPath}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('[rag-repair] ERRO:', error.message);
  process.exit(1);
});
