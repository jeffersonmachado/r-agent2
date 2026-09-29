#!/usr/bin/env node
'use strict';

/**
 * prune-probe-rag-documents.js — remove RESÍDUO DE SONDA do corpus RAG (higiene auditável).
 *
 * PROBLEMA MEDIDO (2026-09-28): 182 documentos `loadprobe-*` no vector store, TODOS sem conteúdo
 * (`content` vazio). São artefatos da sonda de carga, não conhecimento: reindexá-los é impossível
 * por definição — a rota oficial responde `RAG_INDEX_FAILED: "Documento não tem conteúdo"`
 * (medido: reparo 0/182, 0 chunks criados). O efeito no estado era pior que lixo: eles apareciam
 * como `failed` no corpus e viravam o "residual" do eixo `RAG_INDEX_HEALTH`, ou seja, um artefato de
 * experimento contaminava a decisão de governança.
 *
 * CRITÉRIO (duplo, para não remover conhecimento real):
 *   1. o `id` casa um PREFIXO DE SONDA/TESTE conhecido (`loadprobe`, `qaload`, `qaseg`, `loadtest`);
 *      OU o documento é ÓRFÃO SEM TENANT (`tenant_key IS NULL` em estado `failed`);
 *   2. E o documento NÃO tem conteúdo utilizável (`content` vazio/nulo) E nenhum chunk.
 *
 * Por que `tenant_key IS NULL AND failed` é resíduo INERTE e não conhecimento:
 *   - o retrieval filtra por tenant, então um documento sem tenant NUNCA é retornado por ninguém;
 *   - a rota de indexação exige `tenantId` (medido: `RAG_INDEX_FAILED: tenantId é obrigatório`),
 *     portanto esse documento NUNCA poderá ser reparado;
 *   - enquanto isso ele aparece como falha do corpus e contamina a leitura de saúde do índice.
 *
 * Um documento de sonda OU ORFÃO que tenha conteúdo/chunks NÃO é removido — vira caso de
 * investigação (nunca se destrói conteúdo possível por conveniência de estado).
 *
 * Uso:
 *   node --env-file-if-exists=.env scripts/prune-probe-rag-documents.js          # dry-run
 *   node --env-file-if-exists=.env scripts/prune-probe-rag-documents.js --apply  # remove
 */

const path = require('path');

const ROOT = path.join(__dirname, '..');

const APPLY = process.argv.includes('--apply');

const PROBE_PREFIXES = ['loadprobe', 'qaload', 'qaseg', 'loadtest'];

function isProbeId(id) {
  const value = String(id || '').toLowerCase();
  return PROBE_PREFIXES.some((prefix) => value.startsWith(prefix));
}

async function main() {
  const db = require(path.join(ROOT, 'api', 'db'));
  const { QueryTypes } = require('sequelize');
  await db.connect();
  const sequelize = db.getSequelize();

  const rows = await sequelize.query(`
    SELECT d.id,
           d.tenant_key,
           d.index_status,
           coalesce(length(d.content), 0) AS content_len,
           (SELECT count(*) FROM rag_chunks c WHERE c.document_id = d.id) AS chunks
      FROM rag_documents d
  `, { type: QueryTypes.SELECT });

  const probes = rows.filter((row) => isProbeId(row.id));
  // Órfão sem tenant em `failed`: inerte (nunca retornável, nunca reparável) — ver docstring.
  const orphans = rows.filter((row) => row.tenant_key === null && row.index_status === 'failed');
  const candidates = [...new Map([...probes, ...orphans].map((row) => [row.id, row])).values()];
  const empty = candidates.filter((row) => Number(row.content_len) === 0 && Number(row.chunks) === 0);
  const withContent = candidates.filter((row) => Number(row.content_len) > 0 || Number(row.chunks) > 0);

  console.log(`[prune-rag] documentos=${rows.length} candidatos=${candidates.length} (sonda=${probes.length}, orfaos_sem_tenant=${orphans.length}) vazios_sem_chunks=${empty.length}, COM_conteudo_ou_chunks=${withContent.length}`);
  if (withContent.length > 0) {
    console.log('[prune-rag] PRESERVADOS (investigar, não são resíduo inerte):');
    for (const row of withContent.slice(0, 10)) {
      console.log(`[prune-rag]   ${row.id} | content_len=${row.content_len} | chunks=${row.chunks}`);
    }
  }

  if (empty.length === 0) {
    console.log('[prune-rag] nada a remover');
    return;
  }

  if (!APPLY) {
    console.log(`[prune-rag] DRY-RUN: ${empty.length} documento(s) de sonda vazios seriam removidos (use --apply).`);
    return;
  }

  const ids = empty.map((row) => row.id);
  await sequelize.query('DELETE FROM rag_chunks WHERE document_id IN (:ids)', { replacements: { ids } });
  await sequelize.query('DELETE FROM rag_documents WHERE id IN (:ids)', { replacements: { ids } });

  const failedRows = await sequelize.query("SELECT count(*)::int AS total FROM rag_documents WHERE index_status='failed'", { type: QueryTypes.SELECT });
  const totalFailed = failedRows[0] ? failedRows[0].total : null;
  console.log(`[prune-rag] removidos=${ids.length} | failed restantes=${totalFailed}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`[prune-rag] falhou: ${error.message}`);
    process.exit(1);
  });
