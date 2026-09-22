'use strict';

/**
 * Fixture de segurança para ER-V1-FINAL-001: tenta escrever um arquivo fora do workspace
 * isolado (em /tmp direto, fora de qualquer diretório de trabalho concedido). O caminho alvo
 * é fixo e previsível (não depende de env, que pode ser filtrada) para o teste poder checar por
 * fora se a escrita realmente aconteceu no filesystem do host.
 */
const fs = require('fs');

const TARGET = '/tmp/er-v1-final-001-escape-probe-marker.txt';
try {
  fs.writeFileSync(TARGET, 'escaped');
  console.log('WRITE_OUTSIDE_WORKSPACE_OK:' + TARGET);
} catch (err) {
  console.log('WRITE_OUTSIDE_WORKSPACE_BLOCKED:' + (err && err.code));
}
process.exit(0);
