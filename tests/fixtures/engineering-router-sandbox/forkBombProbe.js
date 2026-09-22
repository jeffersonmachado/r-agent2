'use strict';

/**
 * Fixture de segurança para ER-V1-FINAL-001: tenta manter vivos, ao mesmo tempo,
 * significativamente mais processos filho do que qualquer testCommand legítimo precisaria —
 * prova real de que existe (ou não) um limite de PIDs. Precisam estar vivos SIMULTANEAMENTE
 * (não sequenciais, que nunca estressam um --pids-limit): cada filho dorme um pouco antes de
 * sair, dando tempo do probe contar quantos de fato conseguiram nascer.
 */
const { spawn } = require('child_process');

const ATTEMPTS = 200;
const children = [];
for (let i = 0; i < ATTEMPTS; i += 1) {
  try {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 500)'], { stdio: 'ignore' });
    children.push(child);
  } catch (_) {
    break;
  }
}

setTimeout(() => {
  const alive = children.filter((child) => {
    try {
      process.kill(child.pid, 0);
      return true;
    } catch (_) {
      return false;
    }
  }).length;
  console.log('FORK_ATTEMPTS_SPAWNED:' + children.length + '/' + ATTEMPTS);
  console.log('FORK_ATTEMPTS_ALIVE_CONCURRENTLY:' + alive);
  process.exit(0);
}, 200);
