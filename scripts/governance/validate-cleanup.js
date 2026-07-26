'use strict';

/**
 * Validador de higiene do ambiente QA Mesh
 * 
 * Verifica:
 * - Quantidade de arquivos de histórico (alerta se > MAX)
 * - Quantidade de diretórios de evidência (alerta se > MAX)
 * - Presença de lock files stale (> 30 min)
 * - Espaço em disco dos diretórios monitorados
 * 
 * Uso: node scripts/governance/validate-cleanup.js
 * Env: QA_MESH_MAX_HISTORY, QA_MESH_MAX_EVIDENCE, QA_MESH_STALE_LOCK_MINUTES
 */

const fs = require('fs');
const path = require('path');

const MESH_DIR = path.join(__dirname, '..', '..', 'qa-mesh');
const HISTORY_DIR = process.env.QA_MESH_HISTORY_DIR || path.join(MESH_DIR, 'meshHistory');
const EVIDENCE_DIR = process.env.QA_MESH_EVIDENCE_DIR || path.join(MESH_DIR, 'meshEvidence');
const MAX_HISTORY = parseInt(process.env.QA_MESH_MAX_HISTORY || '5', 10);
const MAX_EVIDENCE = parseInt(process.env.QA_MESH_MAX_EVIDENCE || '5', 10);
const STALE_LOCK_MINUTES = parseInt(process.env.QA_MESH_STALE_LOCK_MINUTES || '30', 10);

const results = [];
let overallStatus = 'PASS';

function addResult(check, status, detail) {
  results.push({ check, status, detail });
  if (status === 'FAIL' || status === 'WARN') {
    if (status === 'FAIL') overallStatus = 'FAIL';
    if (status === 'WARN' && overallStatus === 'PASS') overallStatus = 'WARN';
  }
}

// --- Verifica histórico ---
// A retenção do mesh é por classe (canônicas e não-canônicas têm cotas
// separadas de MAX_HISTORY) — a contagem aqui espelha a mesma política.
function isCanonicalHistoryFile(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Boolean(parsed && (parsed.isCanonicalExecution === true
      || (parsed.summary && parsed.summary.isCanonicalExecution === true)));
  } catch (_) {
    return false;
  }
}

try {
  if (fs.existsSync(HISTORY_DIR)) {
    const historyFiles = fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith('.json'));
    const canonicalCount = historyFiles.filter((f) => isCanonicalHistoryFile(path.join(HISTORY_DIR, f))).length;
    const nonCanonicalCount = historyFiles.length - canonicalCount;
    const over = [];
    if (canonicalCount > MAX_HISTORY) over.push(`${canonicalCount} canônicos`);
    if (nonCanonicalCount > MAX_HISTORY) over.push(`${nonCanonicalCount} não-canônicos`);
    if (over.length > 0) {
      addResult('history_file_count', 'WARN', `${over.join(' + ')} (limite: ${MAX_HISTORY} por classe). Execute o mesh para auto-limpar.`);
    } else {
      addResult('history_file_count', 'PASS', `${nonCanonicalCount}/${MAX_HISTORY} não-canônicos + ${canonicalCount}/${MAX_HISTORY} canônicos`);
    }
  } else {
    addResult('history_dir', 'PASS', 'Diretório de histórico não existe ainda (será criado na primeira execução)');
  }
} catch (err) {
  addResult('history_dir', 'FAIL', `Erro ao verificar histórico: ${err.message}`);
}

// --- Verifica evidências ---
try {
  if (fs.existsSync(EVIDENCE_DIR)) {
    const evidenceDirs = fs.readdirSync(EVIDENCE_DIR).filter((f) => {
      try { return fs.statSync(path.join(EVIDENCE_DIR, f)).isDirectory(); } catch (_) { return false; }
    });
    if (evidenceDirs.length > MAX_EVIDENCE) {
      addResult('evidence_dir_count', 'WARN', `${evidenceDirs.length} diretórios (limite: ${MAX_EVIDENCE}). Execute o mesh para auto-limpar.`);
    } else {
      addResult('evidence_dir_count', 'PASS', `${evidenceDirs.length}/${MAX_EVIDENCE} diretórios`);
    }
    
    // Calcula tamanho total
    let totalSize = 0;
    for (const dir of evidenceDirs) {
      try {
        const files = fs.readdirSync(path.join(EVIDENCE_DIR, dir), { recursive: true });
        for (const f of files) {
          try {
            const stat = fs.statSync(path.join(EVIDENCE_DIR, dir, f));
            if (stat.isFile()) totalSize += stat.size;
          } catch (_) {}
        }
      } catch (_) {}
    }
    const sizeMB = (totalSize / (1024 * 1024)).toFixed(1);
    if (totalSize > 500 * 1024 * 1024) {
      addResult('evidence_disk_usage', 'WARN', `${sizeMB} MB (limite: 500 MB)`);
    } else {
      addResult('evidence_disk_usage', 'PASS', `${sizeMB} MB`);
    }
  } else {
    addResult('evidence_dir', 'PASS', 'Diretório de evidências não existe ainda');
  }
} catch (err) {
  addResult('evidence_dir', 'FAIL', `Erro ao verificar evidências: ${err.message}`);
}

// --- Verifica locks stale ---
const locks = [
  path.join(MESH_DIR, 'canonical.lock.json'),
  path.join(MESH_DIR, 'mesh-running.lock'),
];
const now = Date.now();
const staleThreshold = STALE_LOCK_MINUTES * 60 * 1000;
for (const lockPath of locks) {
  try {
    const stat = fs.statSync(lockPath);
    const ageMin = Math.round((now - stat.mtimeMs) / 60000);
    if (ageMin > STALE_LOCK_MINUTES) {
      addResult(`stale_lock:${path.basename(lockPath)}`, 'FAIL', `Lock com ${ageMin} min (limite: ${STALE_LOCK_MINUTES} min). Remova manualmente ou execute o mesh.`);
    } else {
      addResult(`lock_active:${path.basename(lockPath)}`, 'PASS', `Lock ativo (${ageMin} min)`);
    }
  } catch (_) {
    // Lock não existe = OK
  }
}

// --- Output ---
const report = {
  timestamp: new Date().toISOString(),
  status: overallStatus,
  checks: results,
};

const reportPath = path.join(__dirname, '..', '..', 'reports', 'cleanup-report.json');
try { fs.mkdirSync(path.dirname(reportPath), { recursive: true }); } catch (_) {}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`[validate:cleanup] Status: ${overallStatus}`);
for (const r of results) {
  const icon = r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '⚠️' : '🔴';
  console.log(`  ${icon} ${r.check}: ${r.detail}`);
}

if (overallStatus === 'FAIL') {
  process.exit(1);
}
