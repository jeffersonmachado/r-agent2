'use strict';

const fs = require('fs');
const path = require('path');

function validateReplayFilename(filename) {
  const normalized = String(filename || '');
  if (!normalized || normalized.includes('..') || normalized.includes('/') || !normalized.endsWith('.json')) {
    return { ok: false, error: 'invalid_filename', message: 'Nome de arquivo inválido' };
  }
  return { ok: true, filename: normalized };
}

function getReplayPath(filename) {
  return path.join(__dirname, '..', '..', 'tests', 'rpa', 'replay', filename);
}

function deleteReplayFile(filename) {
  const validation = validateReplayFilename(filename);
  if (!validation.ok) {
    return { success: false, error: validation.error, message: validation.message };
  }

  const replayPath = getReplayPath(validation.filename);
  if (!fs.existsSync(replayPath)) {
    return { success: false, error: 'not_found', message: 'Replay não encontrado' };
  }

  fs.unlinkSync(replayPath);
  return {
    success: true,
    deletedFilename: validation.filename,
    message: `Replay "${validation.filename}" removido com sucesso`,
  };
}

module.exports = {
  validateReplayFilename,
  getReplayPath,
  deleteReplayFile,
};
