'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');

// Override por env permite hermetizar testes (mesmo padrão de
// QA_MESH_STABILITY_SNAPSHOT_PATH em qa/mesh/intelligence/stabilityEngine.js),
// evitando que execuções sintéticas de teste sobrescrevam os artefatos reais
// de learning consumidos pela StabilityPage via /qa/learn/*.
const LEARN_DIR = process.env.QA_MESH_LEARN_DIR
  || path.join(ROOT, 'qa', 'mesh', 'intelligence', 'learning');

function learnPath(fileName) {
  fs.mkdirSync(LEARN_DIR, { recursive: true });
  return path.join(LEARN_DIR, fileName);
}

module.exports = {
  LEARN_DIR,
  learnPath,
};
