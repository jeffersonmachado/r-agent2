'use strict';

/**
 * Fixture de segurança para ER-V1-FINAL-001: tenta escrever dentro de node_modules do
 * workspace. Hoje (patchApplyService.materializeWorktree) node_modules é um symlink GRAVÁVEL
 * para o node_modules real do repositório raiz — escrever aqui corrompe fisicamente as
 * dependências reais compartilhadas por toda a aplicação.
 */
const fs = require('fs');
const path = require('path');

const MARKER = path.join(process.cwd(), 'node_modules', '.er-v1-final-001-marker');
try {
  fs.writeFileSync(MARKER, 'tampered');
  console.log('WRITE_NODE_MODULES_OK:' + MARKER);
} catch (err) {
  console.log('WRITE_NODE_MODULES_BLOCKED:' + (err && err.code));
}
process.exit(0);
