'use strict';

/**
 * Fixture de segurança para ER-V1-FINAL-001: tenta abrir uma conexão TCP para um host
 * externo (rede pública), simulando exfiltração de dados por um teste malicioso.
 */
const net = require('net');

const socket = net.createConnection({ host: '1.1.1.1', port: 80, timeout: 3000 });
socket.on('connect', () => {
  console.log('NETWORK_ACCESS_OK');
  socket.destroy();
  process.exit(0);
});
socket.on('timeout', () => {
  console.log('NETWORK_ACCESS_BLOCKED:timeout');
  socket.destroy();
  process.exit(0);
});
socket.on('error', (err) => {
  console.log('NETWORK_ACCESS_BLOCKED:' + (err && err.code));
  process.exit(0);
});
