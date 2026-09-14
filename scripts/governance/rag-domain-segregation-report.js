#!/usr/bin/env node
'use strict';

/**
 * RAG Domain Segregation Report (gate de release).
 *
 * Mede, com evidência real (Postgres + probes HTTP contra o rag-service vivo):
 * - crossDomainLeakage: chunks SYSTEM recuperados por escopo OPERATIONAL (canário);
 * - crossTenantLeakage: chunks de um tenant recuperados por outro tenant (canário);
 * - unclassifiedDocuments: linhas com domain/classification inválidos no DB;
 * - incoherentDocuments: combinações domain x classification proibidas no DB;
 * - indexedSecrets: chunks cujo conteúdo casa padrões de secret;
 * - operationalAccessToSystemDomain: chamadas sem token interno que NÃO levam 401.
 *
 * Saída: reports/rag-domain-segregation-report.json
 * Exit 1 quando houver violação OU quando qualquer prova obrigatória não
 * puder ser executada. Evidência ausente nunca equivale a PASS.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'rag-domain-segregation-report.json');

// O gate de cobertura invoca este script num processo FILHO (`execFileSync`), que
// NÃO herda o `--env-file` do npm script pai. Sem carregar o `.env` aqui,
// `RAG_INTERNAL_TOKEN` chega vazio, os probes autenticados são PULADOS e o
// relatório sai FAIL — derrubando o gate agregado e a consolidação do release
// mesmo com o token presente no `.env` (observado em 2026-09-14, ciclo
// r-agent2-20260914-125012: `internalTokenMissing=1`, `runtimeChecksFailed=1`).
//
// `loadEnvFile` NÃO sobrescreve variável já exportada no ambiente (verificado no
// Node 22.12), então um token explicitamente exportado continua vencendo.
try {
  process.loadEnvFile(path.join(ROOT_DIR, '.env'));
} catch {
  // `.env` ausente: segue com o ambiente do processo (comportamento anterior).
}

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://localhost:8001';
const INTERNAL_TOKEN = process.env.RAG_INTERNAL_TOKEN || '';
const CANARY_TENANT = 'rag-seg-gate-canary';
const CANARY_MARKER = 'ZEBRALUNE_GATE_CANARY';
const CANARY_SYSTEM_DOC_ID = 'rag-seg-gate-canary-system-doc';
const CANARY_OPERATIONAL_DOC_ID = 'rag-seg-gate-canary-operational-doc';

// Mesmos padrões de rag-service/services/domain_policy.py (manter em sync).
const SECRET_PATTERNS = [
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/],
  ['aws_access_key', /\bAKIA[0-9A-Z]{16}\b/],
  ['openai_api_key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['anthropic_api_key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ['slack_token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['github_token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['password_assignment', /\b(?:password|passwd|senha)\s*[:=]\s*\S{6,}/i],
  ['token_assignment', /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key|client[_-]?secret)\s*[:=]\s*['"]?[A-Za-z0-9_/+\-.]{12,}/i],
  ['bearer_token', /\bauthorization\s*:\s*bearer\s+\S{10,}/i],
  ['whatsapp_token', /\bEAA[A-Za-z0-9]{30,}\b/],
];

async function getSequelize() {
  const { connect, getSequelize: get } = require('../../api/db/sequelize');
  // Gate/probe não é processo de longa duração: uma indisponibilidade deve
  // virar evidência FAIL imediatamente, não 30 retries que mascaram o estado.
  if (!get()) await connect(1, 0);
  return get();
}

async function checkDatabase() {
  const sequelize = await getSequelize();

  const [unclassified] = await sequelize.query(`
    SELECT 'rag_chunks' AS source, COUNT(*)::int AS count FROM rag_chunks
      WHERE domain IS NULL OR domain = '' OR classification IS NULL OR classification = ''
       OR domain NOT IN ('OPERATIONAL','SYSTEM')
       OR classification NOT IN ('PRODUCTION','SUPPORT','DEVELOPMENT')
    UNION ALL
    SELECT 'rag_documents', COUNT(*)::int FROM rag_documents
      WHERE domain IS NULL OR domain = '' OR classification IS NULL OR classification = ''
       OR domain NOT IN ('OPERATIONAL','SYSTEM')
       OR classification NOT IN ('PRODUCTION','SUPPORT','DEVELOPMENT')
  `);

  const [incoherent] = await sequelize.query(`
    SELECT 'rag_chunks' AS source, COUNT(*)::int AS count FROM rag_chunks
      WHERE (domain = 'OPERATIONAL' AND classification = 'DEVELOPMENT')
         OR (domain = 'SYSTEM' AND classification = 'PRODUCTION')
    UNION ALL
    SELECT 'rag_documents', COUNT(*)::int FROM rag_documents
      WHERE (domain = 'OPERATIONAL' AND classification = 'DEVELOPMENT')
         OR (domain = 'SYSTEM' AND classification = 'PRODUCTION')
  `);

  const [contents] = await sequelize.query('SELECT id, content FROM rag_chunks');
  const secretHits = [];
  for (const row of contents) {
    const categories = SECRET_PATTERNS.filter(([, re]) => re.test(row.content || '')).map(([c]) => c);
    if (categories.length > 0) {
      secretHits.push({ chunkId: row.id, categories });
    }
  }

  const [distribution] = await sequelize.query(`
    SELECT domain, classification, COUNT(*)::int AS count
    FROM rag_chunks GROUP BY domain, classification ORDER BY domain, classification
  `);

  return {
    unclassifiedDocuments: unclassified.reduce((acc, r) => acc + r.count, 0),
    incoherentDocuments: incoherent.reduce((acc, r) => acc + r.count, 0),
    indexedSecrets: secretHits.length,
    secretHits: secretHits.slice(0, 20),
    distribution,
  };
}

async function probe(pathname, { method = 'GET', token = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-RAG-Internal-Token'] = token;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${RAG_SERVICE_URL}${pathname}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* corpo não-JSON */ }
    return { status: response.status, json };
  } finally {
    clearTimeout(timeout);
  }
}

async function runProbes() {
  const probes = {
    serviceReachable: false,
    crossDomainLeakage: 'skipped',
    crossTenantLeakage: 'skipped',
    operationalAccessToSystemDomain: 'skipped',
    details: [],
  };

  // 1) Sem token: todo acesso deve ser negado (quando o serviço exige token).
  const anon = await probe('/rag/query', {
    method: 'POST',
    body: { query: CANARY_MARKER, tenantId: CANARY_TENANT },
  }).catch(() => null);

  if (!anon) {
    probes.details.push('rag-service inalcançável: provas obrigatórias de runtime não executadas');
    return probes;
  }
  probes.serviceReachable = true;

  if (INTERNAL_TOKEN) {
    probes.operationalAccessToSystemDomain = anon.status === 401 ? 0 : 1;
    if (anon.status !== 401) {
      probes.details.push(`chamada sem token retornou HTTP ${anon.status} (esperado 401)`);
    }
  } else {
    probes.details.push('RAG_INTERNAL_TOKEN ausente: não é possível executar probes autenticados');
    probes.operationalAccessToSystemDomain = 'skipped';
    return probes;
  }

  // 2) Canários: um doc SYSTEM/DEVELOPMENT e um OPERATIONAL no tenant canário.
  const sysDoc = {
    id: CANARY_SYSTEM_DOC_ID,
    tenantId: CANARY_TENANT,
    domain: 'SYSTEM',
    classification: 'DEVELOPMENT',
    content: `${CANARY_MARKER} runbook interno do gate: procedimento técnico restrito de engenharia.`,
  };
  const opDoc = {
    id: CANARY_OPERATIONAL_DOC_ID,
    tenantId: CANARY_TENANT,
    domain: 'OPERATIONAL',
    classification: 'PRODUCTION',
    content: `${CANARY_MARKER} informação operacional pública de horário de atendimento.`,
  };

  try {
    for (const doc of [sysDoc, opDoc]) {
      const indexed = await probe('/rag/index', { method: 'POST', token: INTERNAL_TOKEN, body: { document: doc } });
      if (indexed.status !== 200 || !indexed.json?.success) {
        probes.details.push(`falha ao indexar canário ${doc.id}: HTTP ${indexed.status}`);
        return probes;
      }
    }

    // 2a) Escopo OPERATIONAL não pode recuperar o canário SYSTEM.
    const opQuery = await probe('/rag/query', {
      method: 'POST',
      token: INTERNAL_TOKEN,
      body: {
        query: CANARY_MARKER,
        tenantId: CANARY_TENANT,
        options: { topK: 10, minScore: 0.0 },
        scope: { domain: 'OPERATIONAL', classifications: ['PRODUCTION'] },
      },
    });
    const opDocIds = (opQuery.json?.sources || []).map((s) => s.documentId);
    probes.crossDomainLeakage = opDocIds.includes(CANARY_SYSTEM_DOC_ID) ? 1 : 0;
    if (probes.crossDomainLeakage > 0) {
      probes.details.push('VAZAMENTO: escopo OPERATIONAL recuperou chunk SYSTEM');
    }

    // 2b) Outro tenant não pode recuperar os canários.
    const otherTenantQuery = await probe('/rag/query', {
      method: 'POST',
      token: INTERNAL_TOKEN,
      body: {
        query: CANARY_MARKER,
        tenantId: `${CANARY_TENANT}-intruso`,
        options: { topK: 10, minScore: 0.0 },
        scope: { domain: 'SYSTEM', classifications: ['SUPPORT', 'DEVELOPMENT'] },
      },
    });
    const otherDocIds = (otherTenantQuery.json?.sources || []).map((s) => s.documentId);
    probes.crossTenantLeakage = otherDocIds.includes(CANARY_SYSTEM_DOC_ID) || otherDocIds.includes(CANARY_OPERATIONAL_DOC_ID) ? 1 : 0;
    if (probes.crossTenantLeakage > 0) {
      probes.details.push('VAZAMENTO: tenant intruso recuperou chunks do tenant canário');
    }
  } finally {
    // Cleanup dos canários (best-effort, direto no DB).
    try {
      const sequelize = await getSequelize();
      await sequelize.query(
        'DELETE FROM rag_chunks WHERE document_id IN (:a, :b)',
        { replacements: { a: CANARY_SYSTEM_DOC_ID, b: CANARY_OPERATIONAL_DOC_ID } },
      );
      await sequelize.query(
        'DELETE FROM rag_documents WHERE id IN (:a, :b)',
        { replacements: { a: CANARY_SYSTEM_DOC_ID, b: CANARY_OPERATIONAL_DOC_ID } },
      );
    } catch (err) {
      probes.details.push(`cleanup de canários falhou: ${err.message}`);
    }
  }

  return probes;
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    ragServiceUrl: RAG_SERVICE_URL,
    metrics: {
      crossDomainLeakage: 0,
      crossTenantLeakage: 0,
      unclassifiedDocuments: 0,
      incoherentDocuments: 0,
      indexedSecrets: 0,
      operationalAccessToSystemDomain: 0,
      dbChecksFailed: 0,
      runtimeChecksFailed: 0,
      internalTokenMissing: 0,
    },
    probes: {},
    distribution: [],
    details: [],
    status: 'PASS',
  };

  try {
    const db = await checkDatabase();
    report.metrics.unclassifiedDocuments = db.unclassifiedDocuments;
    report.metrics.incoherentDocuments = db.incoherentDocuments;
    report.metrics.indexedSecrets = db.indexedSecrets;
    report.distribution = db.distribution;
    if (db.secretHits.length > 0) {
      report.details.push(`secrets indexados: ${JSON.stringify(db.secretHits)}`);
    }
  } catch (err) {
    report.details.push(`checagens obrigatórias de DB falharam: ${err.message}`);
    report.metrics.dbChecksFailed = 1;
  }

  let probes;
  try {
    probes = await runProbes();
  } catch (err) {
    probes = {
      serviceReachable: false,
      crossDomainLeakage: 'skipped',
      crossTenantLeakage: 'skipped',
      operationalAccessToSystemDomain: 'skipped',
      details: [`probes obrigatórios falharam: ${err.message}`],
    };
  }
  report.probes = probes;
  for (const key of ['crossDomainLeakage', 'crossTenantLeakage', 'operationalAccessToSystemDomain']) {
    if (typeof probes[key] === 'number') {
      report.metrics[key] = probes[key];
    }
  }
  report.details.push(...probes.details);

  const requiredRuntimeMetrics = [
    'crossDomainLeakage',
    'crossTenantLeakage',
    'operationalAccessToSystemDomain',
  ];
  const runtimeComplete = probes.serviceReachable === true
    && requiredRuntimeMetrics.every((key) => typeof probes[key] === 'number');
  if (!runtimeComplete) report.metrics.runtimeChecksFailed = 1;
  if (!INTERNAL_TOKEN) report.metrics.internalTokenMissing = 1;

  const violations = Object.entries(report.metrics)
    .filter(([, value]) => typeof value !== 'number' || value > 0);
  report.status = violations.length === 0 ? 'PASS' : 'FAIL';

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(`[rag-domain-segregation] status=${report.status}`);
  console.log(`[rag-domain-segregation] metrics=${JSON.stringify(report.metrics)}`);
  if (report.details.length > 0) {
    for (const d of report.details) console.log(`[rag-domain-segregation] ${d}`);
  }
  console.log(`[rag-domain-segregation] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}`);

  process.exit(report.status === 'PASS' ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[rag-domain-segregation] erro fatal:', err);
    process.exit(1);
  });
}

module.exports = { checkDatabase, runProbes, main };
