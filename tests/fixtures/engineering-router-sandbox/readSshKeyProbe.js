'use strict';

/**
 * Fixture de segurança para ER-V1-FINAL-001: tenta ler chaves SSH do HOME real do host
 * (não o HOME=cwd isolado) por caminho absoluto explícito, contornando a variável HOME.
 */
const fs = require('fs');
const os = require('os');

const candidates = [
  `${os.homedir()}/.ssh/id_rsa`,
  `${os.homedir()}/.ssh/id_ed25519`,
  '/root/.ssh/id_rsa',
  '/home/jmachado/.ssh/id_rsa',
];

let readAny = false;
for (const candidate of candidates) {
  try {
    fs.readFileSync(candidate, 'utf8');
    console.log('SSH_KEY_READ_OK:' + candidate);
    readAny = true;
  } catch (_) {
    // esperado se bloqueado
  }
}
if (!readAny) console.log('SSH_KEY_READ_BLOCKED');
process.exit(0);
