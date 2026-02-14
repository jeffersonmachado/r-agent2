const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getBinDir } = require('./paths');

const DEFAULT_TIMEOUT_MS = 20_000;

function isSafeArg(s) {
  // Evita injeção/controle: allowlist simples (migração gradual)
  return typeof s === 'string' && s.length <= 512 && !/[\0\r\n]/.test(s);
}

/**
 * Executa um binário legado com allowlist.
 *
 * IMPORTANTE: este wrapper é propositalmente restritivo para reduzir risco.
 * O alvo de longo prazo é remover a dependência de binários CGI.
 */
async function execLegacyBinary({ relativePath, args = [], timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const binDir = getBinDir();
  if (!binDir) {
    const err = new Error('pbx_bin_dir_not_configured');
    err.code = 'pbx_bin_dir_not_configured';
    throw err;
  }

  if (!relativePath || typeof relativePath !== 'string') {
    const err = new Error('relativePath_required');
    err.code = 'relativePath_required';
    throw err;
  }

  const fullPath = path.join(binDir, relativePath);
  const st = fs.existsSync(fullPath) ? fs.statSync(fullPath) : null;
  if (!st || !st.isFile()) {
    const err = new Error('legacy_binary_not_found');
    err.code = 'legacy_binary_not_found';
    err.details = { fullPath };
    throw err;
  }

  const safeArgs = (Array.isArray(args) ? args : []).map(a => String(a));
  for (const a of safeArgs) {
    if (!isSafeArg(a)) {
      const err = new Error('unsafe_arg');
      err.code = 'unsafe_arg';
      throw err;
    }
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(fullPath, safeArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      const err = new Error('legacy_exec_timeout');
      err.code = 'legacy_exec_timeout';
      reject(err);
    }, timeoutMs);

    child.stdout.on('data', d => { stdout += d.toString('utf8'); });
    child.stderr.on('data', d => { stderr += d.toString('utf8'); });
    child.on('error', (e) => {
      clearTimeout(timer);
      const err = new Error('legacy_exec_error');
      err.code = 'legacy_exec_error';
      err.details = { message: e.message };
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

module.exports = {
  execLegacyBinary,
};

