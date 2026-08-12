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

const RAG_BASE = process.env.RAG_BASE_URL || 'http://10.10.2.30:8002';
const ROOT = process.env.RAG_REPO_ROOT || path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'reports', 'rag-sync-manifest.json');

// Diretórios canônicos (fonte de gravação)
const SOURCE_DIRS = [
  'AI_MEMORY',
  'docs',
  'config',
  'contracts',
];

const EXTENSIONS = new Set(['.md', '.json']);

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

// Mapeia um arquivo-fonte para um documento RAG.
function buildDocumentFromFile(filePath, content) {
  const rel = path.relative(ROOT, filePath);
  const ext = path.extname(filePath);
  const hash = sha256(content);
  // ID estável baseado no caminho relativo (sem hash, para permitir atualização in-place)
  const id = `src-${rel.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`.slice(0, 120);

  let classification = 'documentation';
  let domain = 'OPERATIONAL';
  if (rel.startsWith('AI_MEMORY/')) {
    classification = rel.includes('rules') || rel.includes('governance') ? 'governance' : 'documentation';
  } else if (rel.startsWith('config/')) {
    classification = 'configuration';
    domain = 'SYSTEM';
  } else if (rel.startsWith('contracts/')) {
    classification = 'contract';
    domain = 'SYSTEM';
  } else if (rel.startsWith('docs/')) {
    classification = rel.includes('governance') ? 'governance' : 'documentation';
  }

  return {
    document: {
      id,
      tenantId: 'system',
      domain,
      classification,
      sensitivity: 'internal',
      content: ext === '.json' ? `# ${rel}\n\n\`\`\`json\n${content}\n\`\`\`` : content,
      metadata: {
        sourceFile: rel,
        sha256: hash,
        syncedAt: new Date().toISOString(),
        category: 'canonical-source',
      },
      permissions: { readRoles: ['super_admin', 'auditor', 'agent'], readTenants: ['system'] },
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
  const files = SOURCE_DIRS.flatMap((d) => walkFiles(path.join(ROOT, d)));

  console.log(`   ${files.length} arquivos-fonte detectados`);

  const toIndex = [];
  const unchanged = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const hash = sha256(content);
    const rel = path.relative(ROOT, filePath);
    const previous = manifest.files[rel];

    if (!forceAll && previous && previous.sha256 === hash) {
      unchanged.push(rel);
      continue;
    }

    toIndex.push({ rel, hash, doc: buildDocumentFromFile(filePath, content) });
  }

  console.log(`   ${toIndex.length} para indexar, ${unchanged.length} inalterados\n`);

  if (dryRun) {
    for (const item of toIndex) {
      const prev = manifest.files[item.rel];
      console.log(`   ${prev ? '🔄' : '➕'} ${item.rel} (${item.hash.slice(0, 12)})`);
    }
    console.log(`\nDRY RUN — nada foi alterado.`);
    return;
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
  console.log(`${'='.repeat(60)}`);
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
