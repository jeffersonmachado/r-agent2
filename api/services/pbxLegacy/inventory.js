const fs = require('fs');
const path = require('path');
const { getLegacyRoot, getXmlDir, getBinDir, getCgiDir, getAsteriskConfigDir } = require('./paths');

function safeExists(p) {
  try {
    return !!(p && fs.existsSync(p));
  } catch {
    return false;
  }
}

function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

/**
 * Lista arquivos de um diretório com limites (evita varrer o mundo).
 * @param {string} dir
 * @param {{ maxFiles?: number, maxDepth?: number, includeExtensions?: string[] }} opts
 */
function listFilesBounded(dir, opts = {}) {
  const maxFiles = Number.isFinite(opts.maxFiles) ? opts.maxFiles : 500;
  const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : 4;
  const includeExtensions = Array.isArray(opts.includeExtensions) ? opts.includeExtensions : null;

  /** @type {string[]} */
  const results = [];
  /** @type {{dir:string, depth:number}[]} */
  const stack = [{ dir, depth: 0 }];

  while (stack.length && results.length < maxFiles) {
    const cur = stack.pop();
    if (!cur) break;
    if (cur.depth > maxDepth) continue;

    let entries;
    try {
      entries = fs.readdirSync(cur.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      if (results.length >= maxFiles) break;
      const full = path.join(cur.dir, ent.name);
      if (ent.isDirectory()) {
        stack.push({ dir: full, depth: cur.depth + 1 });
        continue;
      }
      if (!ent.isFile()) continue;
      if (includeExtensions) {
        const ext = path.extname(ent.name).toLowerCase();
        if (!includeExtensions.includes(ext)) continue;
      }
      results.push(full);
    }
  }

  return results;
}

function summarizePaths(paths, root) {
  const normalizedRoot = root ? path.normalize(root) : null;
  return paths.map(p => {
    if (!normalizedRoot) return p;
    try {
      const np = path.normalize(p);
      return np.startsWith(normalizedRoot) ? np.slice(normalizedRoot.length + 1) : np;
    } catch {
      return p;
    }
  });
}

async function getLegacyInventory() {
  const root = getLegacyRoot();
  if (!root) {
    return {
      configured: false,
      error: 'PBX_LEGACY_ROOT não configurado',
      root: null,
    };
  }

  const xmlDir = getXmlDir();
  const binDir = getBinDir();
  const cgiDir = getCgiDir();
  const astDir = getAsteriskConfigDir();

  const knownDirs = {
    root,
    xmlDir,
    binDir,
    cgiDir,
    asteriskConfigDir: astDir,
    dockerWebDir: path.join(root, 'docker/web'),
    confDir: path.join(root, 'conf'),
    fontesNovoSrcDir: path.join(root, 'fontes.novo/src'),
    fontesSrcDir: path.join(root, 'fontes/src'),
  };

  const dirStatus = {};
  for (const [k, v] of Object.entries(knownDirs)) {
    const st = safeStat(v);
    dirStatus[k] = {
      path: v,
      exists: !!st,
      isDirectory: !!st && st.isDirectory(),
    };
  }

  // Arquivos principais (best-effort)
  const importantFiles = {
    extensionsConf: path.join(astDir || '', 'extensions.conf'),
    pjsipConf: path.join(astDir || '', 'pjsip.conf'),
    configDbPhp: path.join(root, 'conf/config_db.php'),
    openDbPhp: path.join(root, 'conf/open_db.php'),
    apacheVhost: path.join(root, 'docker/web/000-default.conf'),
  };

  const fileStatus = {};
  for (const [k, v] of Object.entries(importantFiles)) {
    const st = safeStat(v);
    fileStatus[k] = {
      path: v,
      exists: !!st,
      size: st?.isFile() ? st.size : null,
    };
  }

  // Catálogo limitado de fontes/CGI/PHP configs (para contrato inicial)
  const cSources = safeExists(knownDirs.fontesNovoSrcDir)
    ? listFilesBounded(knownDirs.fontesNovoSrcDir, { includeExtensions: ['.c', '.h'], maxFiles: 800, maxDepth: 3 })
    : [];
  const phpFiles = safeExists(knownDirs.confDir)
    ? listFilesBounded(knownDirs.confDir, { includeExtensions: ['.php'], maxFiles: 200, maxDepth: 1 })
    : [];
  const apacheConfs = safeExists(knownDirs.dockerWebDir)
    ? listFilesBounded(knownDirs.dockerWebDir, { includeExtensions: ['.conf'], maxFiles: 100, maxDepth: 2 })
    : [];
  const asteriskConfs = safeExists(astDir)
    ? listFilesBounded(astDir, { includeExtensions: ['.conf'], maxFiles: 200, maxDepth: 2 })
    : [];

  const inventory = {
    configured: true,
    root,
    dirs: dirStatus,
    files: fileStatus,
    catalog: {
      cSources: {
        count: cSources.length,
        sample: summarizePaths(cSources.slice(0, 200), root),
      },
      phpFiles: {
        count: phpFiles.length,
        sample: summarizePaths(phpFiles.slice(0, 200), root),
      },
      apacheConfs: {
        count: apacheConfs.length,
        sample: summarizePaths(apacheConfs.slice(0, 200), root),
      },
      asteriskConfs: {
        count: asteriskConfs.length,
        sample: summarizePaths(asteriskConfs.slice(0, 200), root),
      },
    },
  };

  return inventory;
}

module.exports = {
  getLegacyInventory,
};

