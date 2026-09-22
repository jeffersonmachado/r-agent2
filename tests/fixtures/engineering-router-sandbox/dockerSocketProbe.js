'use strict';

/**
 * Fixture de segurança para ER-V1-FINAL-001: tenta acessar o socket do Docker do host, que
 * (se acessível) permitiria escapar do sandbox controlando o próprio daemon Docker.
 */
const fs = require('fs');

try {
  const stat = fs.statSync('/var/run/docker.sock');
  console.log('DOCKER_SOCKET_ACCESS_OK:' + stat.isSocket());
} catch (err) {
  console.log('DOCKER_SOCKET_ACCESS_BLOCKED:' + (err && err.code));
}
process.exit(0);
