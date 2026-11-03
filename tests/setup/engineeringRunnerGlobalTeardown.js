'use strict';

/**
 * ER-V1-SEAL-003 — globalTeardown: encerra o processo do Engineering Runner subido em
 * engineeringRunnerGlobalSetup.js. Best-effort — o processo já pode ter morrido sozinho (ex.:
 * suíte interrompida no meio).
 *
 * Achado real (ER-V1-SEAL-004, ao rodar `collect-engineering-router-runtime-evidence.js`, que
 * dispara um `npx jest` SEPARADO por item, cada um com seu próprio globalSetup/globalTeardown):
 * o runner faz shutdown gracioso ASSÍNCRONO (`await http.stop()` em index.js — drena conexões
 * antes de liberar a porta), mas este teardown só enviava SIGTERM e retornava IMEDIATAMENTE, sem
 * esperar o processo morrer de fato. Como a porta é fixa (`RUNNER_PORT`, default 8097) e o
 * próximo item já dispara um `npx jest` novo (com seu próprio globalSetup tentando subir OUTRO
 * runner na MESMA porta) segundos depois, a porta antiga às vezes ainda estava ocupada — o novo
 * runner falhava (EADDRINUSE/health nunca responde), `waitForHealth` estourava o timeout,
 * globalSetup lançava, e o processo Jest inteiro morria ANTES do reporter `--json` escrever
 * qualquer coisa (sintoma: "saída do Jest não pôde ser parseada como JSON" em 7 dos 25 itens,
 * de forma não-determinística — dependia de quão rápido o SO liberava a porta). Corrigido
 * fazendo este teardown esperar a morte REAL do processo (poll de `process.kill(pid, 0)`) antes
 * de retornar, com fallback para SIGKILL se o shutdown gracioso não terminar a tempo.
 */

const fs = require('fs');
const { PID_FILE, SESSION_FILE } = require('./engineeringRunnerGlobalSetup');

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function waitForDeath(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid)) {
    if (Date.now() > deadline) return false;
    // eslint-disable-next-line no-await-in-loop
    await sleep(50);
  }
  return true;
}

module.exports = async function engineeringRunnerGlobalTeardown() {
  if (!fs.existsSync(PID_FILE)) return;
  // SÓ ENCERRA O RUNNER QUE *ESTA* SESSÃO SUBIU.
  //
  // DEFEITO REAL MEDIDO (2026-10-21): o teardown lia um arquivo por PORTA, não por sessão. Uma
  // sessão Jest ANINHADA (o `npx jest --runInBand` de `run-impact-validation.js`, disparado
  // dentro de um teste) que reutilizava o runner da sessão-mãe apagava o PID e — pior — encerrava
  // o runner alheio ao terminar, derrubando o resto da bateria da sessão-mãe com
  // `ECONNREFUSED`/`SANDBOX_UNAVAILABLE`. O dono é agora explícito: sem registro de dono, ou com
  // dono diferente deste processo, nada é encerrado nem apagado (o resíduo real continua sendo
  // limpo pelo pré-check do globalSetup, que é fail-closed).
  const donoBruto = fs.existsSync(SESSION_FILE) ? fs.readFileSync(SESSION_FILE, 'utf8').trim() : '';
  if (donoBruto !== String(process.pid)) {
    process.stderr.write(
      `[jest-global-teardown] runner desta porta pertence à sessão Jest ${donoBruto || '(desconhecida)'}, ` +
      `não a esta (${process.pid}) — reutilizado, não encerrado.\n`,
    );
    return;
  }
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
  fs.rmSync(PID_FILE, { force: true });
  fs.rmSync(SESSION_FILE, { force: true });
  if (!pid || !isAlive(pid)) return;
  try {
    process.kill(pid, 'SIGTERM');
    const diedGracefully = await waitForDeath(pid, 5000);
    if (!diedGracefully) {
      process.kill(pid, 'SIGKILL');
      await waitForDeath(pid, 2000);
    }
    // stderr, nunca stdout — mesmo motivo do globalSetup (ver engineeringRunnerGlobalSetup.js).
    process.stderr.write(`[jest-global-teardown] Engineering Runner (pid ${pid}) encerrado (porta liberada)\n`);
  } catch (_) {
    // já morto — sem problema.
  }
};
