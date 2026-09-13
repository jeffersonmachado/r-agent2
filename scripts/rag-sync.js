'use strict';

/**
 * RAG Sync — mantém o RAG como camada de consulta derivada das fontes canônicas.
 *
 * Fontes canônicas (git-versioned) → RAG (índice derivado, nunca autoritativo).
 *
 * - Computa SHA-256 de cada arquivo-fonte
 * - Compara com o manifesto (reports/rag-sync-manifest.json)
 * - Indexa SOMENTE o que mudou (ou força tudo com --all)
 * - Registra o novo estado no manifesto
 *
 * Uso:
 *   node scripts/rag-sync.js               # incremental (só mudanças)
 *   node scripts/rag-sync.js --all         # força re-indexação total
 *   node scripts/rag-sync.js --dry-run     # lista o que seria indexado
 *   RAG_BASE_URL=http://10.10.2.30:8002 node scripts/rag-sync.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

// §A9: taxonomia de superfície vem do módulo compartilhado — o gate de
// sanitização de manuais usa EXATAMENTE a mesma regra.
const {
  resolveDomainClassification: resolveSurfaceClassification,
  isProductionSurface,
} = require('../api/services/rag/knowledgeSurfaceClassification');
// §L6: o mesmo detector que o gate usa. Superfície PRODUCTION não entra no
// índice OPERACIONAL sem passar por ele.
const { detectProductionLeaks } = require('../api/services/learning/manualSanitizer');

const RAG_BASE = process.env.RAG_BASE_URL || 'http://10.10.2.30:8002';
const RAG_TOKEN = process.env.RAG_INTERNAL_TOKEN || '';
const ROOT = process.env.RAG_REPO_ROOT || path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'reports', 'rag-sync-manifest.json');

// Diretórios canônicos (fonte de gravação)
const SOURCE_DIRS = [
  'AI_MEMORY',
  'docs',
  'config',
  'contracts',
];

// Artefatos operacionais gerados fora dos diretórios canônicos. A projeção
// operacional de jornadas é conhecimento de NEGÓCIO (sanitizado, sem internals
// de QA) e precisa ser consultável pelo copiloto — por isso entra
// explicitamente, e não por varredura de diretório.
const EXTRA_OPERATIONAL_SOURCES = [
  'reports/business-journey-projections.json',
];

const EXTENSIONS = new Set(['.md', '.json', '.html']);

// Diretórios transitórios a excluir (evidência de runtime, não fonte canônica)
const EXCLUDE_DIRS = new Set([
  'AI_MEMORY/evidence',
  'AI_MEMORY/operational-checklists',
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

function sha256(content) {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(rel)) continue;
      walkFiles(full, acc);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      acc.push(full);
    }
  }
  return acc;
}

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  } catch {
    return { version: 1, files: {} };
  }
}

function saveManifest(manifest) {
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

function postJSON(urlPath, body) {
  if (!String(RAG_TOKEN).trim()) {
    return Promise.reject(new Error('RAG_INTERNAL_TOKEN não configurado'));
  }
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, RAG_BASE);
    const data = JSON.stringify(body);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'X-RAG-Internal-Token': RAG_TOKEN,
      },
    };
    const req = http.request(opts, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(b) });
        } catch {
          resolve({ status: res.statusCode, data: b });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── Mapeamento de domínio (OPERATIONAL × SYSTEM) ──────────────────────────
//
// A taxonomia canônica vive em
// `api/services/rag/knowledgeSurfaceClassification.js` e é compartilhada com o
// gate `validate:manual-sanitization`. Aqui apenas injetamos as fontes
// operacionais extras declaradas neste script (git-versioned) para que a
// classificação do rag-sync continue exatamente a mesma de antes da extração.

const SHARED = require('../api/services/rag/knowledgeSurfaceClassification');

const EXTRA_OPERATIONAL_SOURCES_LOCAL = new Set(EXTRA_OPERATIONAL_SOURCES);

function resolveDomainClassification(rel) {
  // A taxonomia compartilhada já cobre os prefixos PRODUCTION canônicos,
  // SUPPORT e SYSTEM. Adicionamos apenas as fontes operacionais extras
  // declaradas neste script, sem alterar nenhuma decisão existente.
  if (EXTRA_OPERATIONAL_SOURCES_LOCAL.has(rel)) {
    return { domain: 'OPERATIONAL', classification: 'PRODUCTION' };
  }
  return resolveSurfaceClassification(rel);
}

// Remove marcação HTML para indexar manuais de produto como texto.
function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Arquivos que jamais devem ser indexados (segredos/credenciais).
const SECRET_PATH_PATTERNS = [/\.env/, /\.token/, /\.pem$/, /\.key$/, /credentials/i, /secret/i];
const SECRET_CONTENT_PATTERNS = [
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /sk-[a-zA-Z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /xox[baprs]-[a-zA-Z0-9-]{10,}/,
  /gh[pousr]_[a-zA-Z0-9]{30,}/,
  /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/,
];

function looksSensitive(rel, content) {
  if (SECRET_PATH_PATTERNS.some((pattern) => pattern.test(rel))) return true;
  return SECRET_CONTENT_PATTERNS.some((pattern) => pattern.test(content));
}

/**
 * §L6 — O índice OPERACIONAL só recebe representação PRODUCTION.
 *
 * A classificação é decidida pelo CAMINHO (taxonomia canônica). Se um documento
 * classificado PRODUCTION carregar detalhe interno (replay, seletor, cenário de
 * QA, caminho/endpoint/comando de QA-RPA, ferramenta de automação), ele NÃO é
 * projetado para o índice: é bloqueado e a sincronização falha no final. Deixar
 * passar seria contaminar exatamente a superfície que o operador e o copiloto
 * leem.
 *
 * @returns {Array} vazamentos encontrados (vazio = pode indexar)
 */
function productionLeaksForIngestion(rel, documentContent) {
  const { classification } = resolveDomainClassification(rel);
  if (classification !== 'PRODUCTION') return [];
  return detectProductionLeaks(documentContent).map((leak) => ({
    rel,
    ruleId: leak.ruleId,
    match: leak.match,
    description: leak.description,
  }));
}

// Mapeia um arquivo-fonte para um documento RAG.
function buildDocumentFromFile(filePath, content) {
  const rel = path.relative(ROOT, filePath);
  const ext = path.extname(filePath);
  const hash = sha256(content);
  const now = new Date().toISOString();
  // ID estável baseado no caminho relativo (sem hash, para permitir atualização in-place)
  const id = `src-${rel.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`.slice(0, 120);

  const { domain, classification } = resolveDomainClassification(rel);

  let documentContent = content;
  if (ext === '.html') {
    documentContent = htmlToText(content);
  } else if (ext === '.json') {
    documentContent = `# ${rel}\n\n\`\`\`json\n${content}\n\`\`\``;
  }

  // Filtro de permissões secundário (o primário é domain+classification no SQL):
  // roles null/[] = visível a todos do tenant.
  const rolesByClassification = {
    PRODUCTION: null,
    SUPPORT: ['super_admin', 'auditor'],
    DEVELOPMENT: ['super_admin'],
  };

  return {
    document: {
      id,
      tenantId: 'system',
      title: rel,
      domain,
      classification,
      sensitivity: 'INTERNAL',
      content: documentContent,
      metadata: {
        source: 'canonical-source',
        category: domain === 'OPERATIONAL' ? 'operational-documentation' : 'technical-source',
        sourceFile: rel,
        sha256: hash,
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      permissions: {
        roles: rolesByClassification[classification] || null,
        agents: [],
      },
      status: 'active',
    },
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const forceAll = process.argv.includes('--all');
  const dryRun = process.argv.includes('--dry-run');

  console.log(`🔄 RAG Sync ${dryRun ? '(DRY RUN)' : ''}`);
  console.log(`   RAG: ${RAG_BASE}`);
  console.log(`   Root: ${ROOT}`);

  const manifest = loadManifest();
  const files = [
    ...SOURCE_DIRS.flatMap((d) => walkFiles(path.join(ROOT, d))),
    ...EXTRA_OPERATIONAL_SOURCES.map((rel) => path.join(ROOT, rel)).filter((p) => fs.existsSync(p)),
  ];
  const uniqueFiles = [...new Set(files)];

  console.log(`   ${uniqueFiles.length} arquivos-fonte detectados`);

  const toIndex = [];
  const unchanged = [];
  // §L6: documentos PRODUCTION bloqueados por detalhe interno (não entram no
  // índice OPERACIONAL e derrubam o comando no final).
  const blocked = [];

  for (const filePath of uniqueFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const hash = sha256(content);
    const rel = path.relative(ROOT, filePath);
    const previous = manifest.files[rel];

    if (!forceAll && previous && previous.sha256 === hash) {
      unchanged.push(rel);
      continue;
    }

    if (looksSensitive(rel, content)) {
      console.log(`   🚫 ${rel}: pulado (padrão de secret/credencial detectado)`);
      continue;
    }

    const doc = buildDocumentFromFile(filePath, content);
    const ingestionLeaks = productionLeaksForIngestion(rel, doc.document.content);
    if (ingestionLeaks.length > 0) {
      blocked.push(...ingestionLeaks);
      console.log(
        `   ⛔ ${rel}: BLOQUEADO (superfície PRODUCTION com detalhe interno): `
        + ingestionLeaks.map((leak) => `${leak.ruleId}("${leak.match}")`).join(', '),
      );
      continue;
    }

    toIndex.push({ rel, hash, doc });
  }

  console.log(`   ${toIndex.length} para indexar, ${unchanged.length} inalterados`);
  if (blocked.length > 0) {
    console.log(`   ${blocked.length} bloqueado(s) por conteúdo interno em superfície PRODUCTION\n`);
  }

  if (dryRun) {
    for (const item of toIndex) {
      const prev = manifest.files[item.rel];
      console.log(`   ${prev ? '🔄' : '➕'} ${item.rel} (${item.hash.slice(0, 12)})`);
    }
    console.log(`\nDRY RUN — nada foi alterado.`);
    // Fail-closed também no dry-run: o operador precisa ver que algo está
    // bloqueado antes de rodar a sincronização real.
    if (blocked.length > 0) process.exitCode = 1;
    return;
  }

  if (!String(RAG_TOKEN).trim()) {
    throw new Error('RAG_INTERNAL_TOKEN não configurado');
  }

  let ok = 0;
  const failures = [];

  for (const item of toIndex) {
    try {
      const res = await postJSON('/rag/index', item.doc);
      if (res.status === 200) {
        ok++;
        console.log(`   ✅ ${item.rel} (${res.data.chunksCreated} chunks)`);
        manifest.files[item.rel] = { sha256: item.hash, syncedAt: new Date().toISOString() };
      } else {
        failures.push({ rel: item.rel, status: res.status, error: JSON.stringify(res.data).slice(0, 120) });
        console.log(`   ❌ ${item.rel}: ${res.status} ${JSON.stringify(res.data).slice(0, 80)}`);
      }
    } catch (err) {
      failures.push({ rel: item.rel, status: 'ERR', error: err.message });
      console.log(`   ❌ ${item.rel}: ${err.message}`);
    }
  }

  // Salva manifesto apenas com sucessos (falhas re-tentam na próxima execução)
  saveManifest(manifest);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 ${ok}/${toIndex.length} indexados, ${unchanged.length} inalterados`);
  if (failures.length) {
    console.log('❌ Falhas:');
    failures.forEach((f) => console.log(`   - ${f.rel}: ${f.status} ${f.error}`));
  }
  if (blocked.length) {
    console.log('⛔ Bloqueados por conteúdo interno em superfície PRODUCTION:');
    blocked.forEach((b) => console.log(`   - ${b.rel}: ${b.ruleId}("${b.match}")`));
    // Fail-closed: nada de sair 0 com conteúdo PRODUCTION contaminado.
    process.exitCode = 1;
  }
  console.log(`${'='.repeat(60)}`);
}

module.exports = {
  buildDocumentFromFile,
  productionLeaksForIngestion,
  resolveDomainClassification,
  isProductionSurface,
  sha256,
  EXTRA_OPERATIONAL_SOURCES,
  SOURCE_DIRS,
};

if (require.main === module) {
  main().catch((err) => {
    console.error('FATAL:', err.message);
    process.exit(1);
  });
}
