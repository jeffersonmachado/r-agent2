'use strict';

/**
 * Regressão do FALSO NEGATIVO por SIGPIPE em `scripts/pbx-cdr-health.sh`.
 *
 * DEFEITO MEDIDO em 2026-10-18 (L0 da fase C, 11 workers): a suíte
 * `pbxCdrHealth.test.js` reprovou em "sem Last fail: check OK" com
 * `Expected 0 / Received 1` — e PASSAVA isolada (10/10 em 2,1 s). Causa raiz:
 *
 *   `set -o pipefail` + `grep -q` no pipeline
 *   `docker exec ... asterisk -rx "cdr show status" | grep -q 'Adaptive ODBC'`
 *
 * O `grep -q` encerra no PRIMEIRO casamento. O produtor real continua
 * imprimindo backends DEPOIS da linha casada, recebe SIGPIPE e morre com 141;
 * com `pipefail`, a pipeline inteira retorna 141 e a função passa a dizer
 * "backend não registrado" para um Asterisk saudável. A janela é de timing
 * (sob carga o `grep` sai mais rápido que o produtor), por isso o defeito é
 * intermitente — e por isso o teste força a janela com um `sleep` no dublê.
 *
 * Impacto real (não é só teste): `check` é o preflight do converge. Um
 * `status=DEGRADED` falso bloqueia o ciclo e, no `ensure`, dispara reload
 * desnecessário de `res_odbc.so` + `cdr_adaptive_odbc.so`.
 *
 * Prova do mecanismo (bash, mesma máquina):
 *   escritor() { printf "Adaptive ODBC\n"; sleep 0.2; printf "cdr-custom\n"; }
 *   escritor | grep -q 'Adaptive ODBC'   # exit=141
 *   escritor | grep 'Adaptive ODBC' >/dev/null   # exit=0
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'pbx-cdr-health.sh');

/**
 * Dublês que escrevem ALÉM da linha casada, com uma janela de tempo no meio —
 * exatamente o padrão que matava as funções de sinal por SIGPIPE.
 */
function montarCenario() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbx-cdr-sigpipe-'));

  fs.writeFileSync(path.join(dir, 'ss'), `#!/usr/bin/env bash
printf "State Recv-Q Send-Q Local Address:Port Peer Address:Port\\n"
printf "LISTEN 0 5 0.0.0.0:15432 0.0.0.0:*\\n"
sleep 0.4
printf "LISTEN 0 128 0.0.0.0:22 0.0.0.0:*\\n"
exit 0
`);

  fs.writeFileSync(path.join(dir, 'docker'), `#!/usr/bin/env bash
if [ "$1" = "inspect" ]; then printf "true\\n"; exit 0; fi
if [ "$1" = "exec" ]; then
  case "$*" in
    *"core show uptime"*) printf "System uptime: 1 hour\\n"; exit 0 ;;
    *"cdr show status"*)
      printf "  Logging: Enabled\\n\\n* Registered Backends\\n  -------------------\\n"
      printf "    Adaptive ODBC\\n"
      # Janela em que o \`grep -q\` já saiu: o produtor leva SIGPIPE ao escrever.
      sleep 0.4
      printf "    cdr-custom\\n"
      sleep 0.4
      printf "    cdr_manager\\n"
      exit 0 ;;
    *"odbc show"*)
      printf "    Number of active connections: 1 (out of 1)\\n"
      sleep 0.4
      printf "    Status: Connected\\n"
      exit 0 ;;
  esac
  exit 0
fi
exit 0
`);

  const bridge = path.join(dir, 'bridge.sh');
  fs.writeFileSync(bridge, '#!/usr/bin/env bash\nexit 0\n');

  for (const bin of ['ss', 'docker', 'bridge.sh']) fs.chmodSync(path.join(dir, bin), 0o755);
  return { dir, bridge };
}

function rodar(cenario, acao) {
  let status = 0;
  let saida = '';
  try {
    saida = execFileSync('bash', [SCRIPT, acao], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60000,
      env: {
        ...process.env,
        PATH: `${cenario.dir}:${process.env.PATH}`,
        PBX_BRIDGE_SCRIPT: cenario.bridge,
      },
    });
  } catch (erro) {
    status = erro.status === null || erro.status === undefined ? 1 : erro.status;
    saida = `${erro.stdout || ''}${erro.stderr || ''}`;
  }
  return { status, saida };
}

describe('pbx-cdr-health — nenhum sinal pode morrer por SIGPIPE (pipefail + produtor com saída posterior)', () => {
  it('check continua OK quando `cdr show status` escreve backends DEPOIS da linha casada', () => {
    const cenario = montarCenario();
    try {
      const check = rodar(cenario, 'check');
      // Com `grep -q`, a pipeline retornava 141 e este check virava DEGRADED.
      expect(check.saida).toContain('status=OK');
      expect(check.status).toBe(0);
    } finally {
      fs.rmSync(cenario.dir, { recursive: true, force: true });
    }
  });

  it('check reconhece a porta quando `ss` escreve outras linhas DEPOIS da linha da ponte', () => {
    const cenario = montarCenario();
    try {
      const check = rodar(cenario, 'check');
      // Com `grep -qF`, o SIGPIPE no `ss` virava motivo=ponte_ausente.
      expect(check.saida).not.toContain('ponte_ausente');
      expect(check.saida).toContain('porta=15432');
    } finally {
      fs.rmSync(cenario.dir, { recursive: true, force: true });
    }
  });

  it('ensure NÃO recarrega módulo quando o backend está registrado (sem reload por falso negativo)', () => {
    const cenario = montarCenario();
    try {
      const ensure = rodar(cenario, 'ensure');
      expect(ensure.saida).toContain('nada a fazer');
      expect(ensure.status).toBe(0);
    } finally {
      fs.rmSync(cenario.dir, { recursive: true, force: true });
    }
  });
});
