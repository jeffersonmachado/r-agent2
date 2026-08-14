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
}

module.exports = {
  writeFileAtomic,
  writeJsonAtomic,
};
