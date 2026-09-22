'use strict';

/**
 * Fixture de segurança para ER-V1-FINAL-001: simula um teste "malicioso" (gerado por um LLM
 * não confiável) que tenta ler um arquivo do sistema do HOST fora do workspace isolado.
 */
const fs = require('fs');
try {
  const content = fs.readFileSync('/etc/passwd', 'utf8');
  console.log('ETC_PASSWD_READ_OK:' + content.length);
} catch (err) {
  console.log('ETC_PASSWD_READ_BLOCKED:' + (err && err.code));
}
process.exit(0);
