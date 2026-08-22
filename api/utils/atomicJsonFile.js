'use strict';

const fs = require('fs');
const path = require('path');

function writeFileAtomic(filePath, content, encoding = 'utf8') {
  const target = path.resolve(filePath);
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });

  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  let handle = null;
  try {
    handle = fs.openSync(temporary, 'wx');
    fs.writeFileSync(handle, content, encoding);
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    fs.renameSync(temporary, target);
  } catch (error) {
    if (handle !== null) {
      try { fs.closeSync(handle); } catch (_) { /* best effort */ }
    }
    try { fs.unlinkSync(temporary); } catch (_) { /* best effort */ }
    throw error;
  }
}

function writeJsonAtomic(filePath, value) {
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  // RAP-078: espelho canônico em banco para stores mutáveis de QA/Mesh.
  // O JSON permanece como export derivado; a fonte de verdade é o DB.
  try {
    const rel = path.relative(process.cwd(), path.resolve(filePath)).replace(/\\/g, '/');
    if (/^(qa\/qa-waves\/|qa-mesh\/(baseline|canonical-promotion|scheduler-state|gap-engine)\/)/.test(rel)) {
      // Require lazy para evitar ciclo de inicialização.
      // eslint-disable-next-line global-require
      const dbStateStore = require('../../qa/state/dbStateStore');
      dbStateStore.saveSyncExport(rel, value);
    }
  } catch (_) {
    // Espelho DB é best-effort fora do fluxo transacional; nunca derruba o writer.
  }
}

module.exports = {
  writeFileAtomic,
  writeJsonAtomic,
};
