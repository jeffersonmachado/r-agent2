'use strict';

/**
 * ER-V1-SEAL-003 — globalTeardown: encerra o processo do Engineering Runner subido em
 * engineeringRunnerGlobalSetup.js. Best-effort — o processo já pode ter morrido sozinho (ex.:
 * suíte interrompida no meio).
 */

const fs = require('fs');
const { PID_FILE } = require('./engineeringRunnerGlobalSetup');

module.exports = async function engineeringRunnerGlobalTeardown() {
  if (!fs.existsSync(PID_FILE)) return;
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
  fs.rmSync(PID_FILE, { force: true });
  if (!pid) return;
  try {
    process.kill(pid, 'SIGTERM');
    // eslint-disable-next-line no-console
    console.log(`[jest-global-teardown] Engineering Runner (pid ${pid}) encerrado`);
  } catch (_) {
    // já morto — sem problema.
  }
};
