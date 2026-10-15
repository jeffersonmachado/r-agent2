'use strict';

/**
 * Saúde do caminho de CDR do PBX (`scripts/pbx-cdr-health.sh`).
 *
 * DEFEITO REAL medido em 2026-10-13, com um ciclo de converge de ~40 min perdido:
 * o preflight do converge valida só a PORTA da ponte (15432). Quando o Postgres
 * não responde no boot do container, o backend `cdr_adaptive_odbc` para de gravar
 * EM SILÊNCIO e não volta sozinho — a porta segue de pé, o preflight passa, e o
 * passo 1/12 reprova com `pbxProdLike.cdr=false`, `hangupCauses=false` e
 * `omnichannel.pbx=false`. (Mesma armadilha registrada em
 * `AI_MEMORY/` e na memória de reparo do PBX.)
 *
 * O sinal é o BACKEND REGISTRADO, não a porta e não o `Use Count` (que é 0 até no
 * estado saudável): `cdr show status` lista "* Registered Backends / Adaptive ODBC"
 * quando o CDR vai gravar; quando o backend morre, essa linha DESAPARECE.
 *
 * Testes com dublês de `docker`/`ss` e de `pbx-host-db-bridge.sh` — nenhum socat
 * real é iniciado.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'pbx-cdr-health.sh');

/**
 * Monta um ambiente com dublês.
 * @param {{ponte?: boolean, backendRegistrado?: boolean, registraAposReload?: boolean, dockerOk?: boolean,
 *          conexoes?: number, lastFail?: string|null, limpaFalhaAposReload?: boolean}} cenario
 */
function montarCenario(cenario = {}) {
  const {
    ponte = true,
    backendRegistrado = true,
    registraAposReload = true,
    dockerOk = true,
    conexoes = 0,
    lastFail = null,
    limpaFalhaAposReload = true,
  } = cenario;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbx-cdr-'));
  const estado = path.join(dir, 'estado');
  const falha = path.join(dir, 'falha');
  const log = path.join(dir, 'docker.log');
  fs.writeFileSync(estado, backendRegistrado ? 'registrado' : 'ausente');
  fs.writeFileSync(falha, lastFail || '');
  fs.writeFileSync(log, '');

  fs.writeFileSync(path.join(dir, 'ss'), `#!/usr/bin/env bash\n${ponte ? 'printf "LISTEN 0 5 0.0.0.0:15432 0.0.0.0:*\\n"' : 'exit 0'}\n`);

  fs.writeFileSync(path.join(dir, 'docker'), `#!/usr/bin/env bash
# Registra a invocação para o teste conferir se o reload foi (ou não) aplicado.
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
if [ "$1" = "inspect" ]; then
  ${dockerOk ? 'printf "true\\n"' : 'printf "false\\n"'}
  exit 0
fi
if [ "$1" = "exec" ]; then
  cmd="$*"
  case "$cmd" in
    *"core show uptime"*) printf "System uptime: 1 hour\\n"; exit 0 ;;
    *"module reload"*)
      ${registraAposReload ? `printf 'registrado\\n' > ${JSON.stringify(estado)}` : ':'}
      ${limpaFalhaAposReload ? `: > ${JSON.stringify(falha)}` : ':'}
      printf "Module reloaded successfully.\\n"; exit 0 ;;
    *"cdr show status"*)
      printf "  Logging: Enabled\\n\\n* Registered Backends\\n  -------------------\\n"
      if [ "$(cat ${JSON.stringify(estado)})" = "registrado" ]; then printf "    Adaptive ODBC\\n"; fi
      printf "    cdr-custom\\n"
      exit 0 ;;
    *"odbc show"*)
      printf "    Number of active connections: ${conexoes} (out of 1)\\n"
      if [ -s ${JSON.stringify(falha)} ]; then
        printf "    Last fail connection attempt: %s\\n" "$(cat ${JSON.stringify(falha)})"
      fi
      exit 0 ;;
  esac
  exit 0
fi
exit 0
`);

  // Bridge dublê: só registra a tentativa de start (nunca sobe socat).
  const bridge = path.join(dir, 'bridge.sh');
  fs.writeFileSync(bridge, `#!/usr/bin/env bash\nprintf 'bridge %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`);

  for (const bin of ['ss', 'docker', 'bridge.sh']) {
    fs.chmodSync(path.join(dir, bin), 0o755);
  }
  return { dir, log, estado, bridge };
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
  return { status, saida, log: fs.readFileSync(cenario.log, 'utf8') };
}

function limpar(cenario) {
  fs.rmSync(cenario.dir, { recursive: true, force: true });
}

describe('pbx-cdr-health — sinal é o BACKEND registrado, não a porta', () => {
  it('backend registrado: check OK e ensure NÃO recarrega módulo (idempotente)', () => {
    const cenario = montarCenario({ backendRegistrado: true });
    try {
      const check = rodar(cenario, 'check');
      expect(check.status).toBe(0);
      expect(check.saida).toContain('status=OK');
      expect(check.saida).toContain('backend=AdaptiveODBC');

      const ensure = rodar(cenario, 'ensure');
      expect(ensure.status).toBe(0);
      expect(ensure.saida).toContain('nada a fazer');
      // Nenhum reload em nenhuma das duas passagens.
      expect(ensure.log).not.toContain('module reload');
    } finally {
      limpar(cenario);
    }
  });

  it('backend AUSENTE com a porta de pé: check acusa DEGRADED (o preflight do converge passaria!)', () => {
    const cenario = montarCenario({ ponte: true, backendRegistrado: false });
    try {
      const check = rodar(cenario, 'check');
      expect(check.status).toBe(1);
      expect(check.saida).toContain('status=DEGRADED');
      expect(check.saida).toContain('motivo=cdr_backend_nao_registrado');
      expect(check.saida).toContain('pbx-cdr-health.sh ensure');
    } finally {
      limpar(cenario);
    }
  });

  it('ensure RECUPERA: aplica os dois reloads, reverifica e sai como RECOVERED', () => {
    const cenario = montarCenario({ backendRegistrado: false, registraAposReload: true });
    try {
      const ensure = rodar(cenario, 'ensure');
      expect(ensure.status).toBe(0);
      expect(ensure.saida).toContain('status=RECOVERED');
      // Os DOIS módulos precisam ser recarregados (a armadilha documentada é
      // recarregar só um e o backend continuar fora do engine).
      expect(ensure.log).toContain('module reload res_odbc.so');
      expect(ensure.log).toContain('module reload cdr_adaptive_odbc.so');
    } finally {
      limpar(cenario);
    }
  });

  it('ensure que NÃO consegue recuperar é UNAVAILABLE (fail-closed, nunca ok sem sinal)', () => {
    const cenario = montarCenario({ backendRegistrado: false, registraAposReload: false });
    try {
      const ensure = rodar(cenario, 'ensure');
      expect(ensure.status).toBe(1);
      expect(ensure.saida).toContain('status=UNAVAILABLE');
      expect(ensure.saida).toContain('backend_nao_registrado_apos_reload');
    } finally {
      limpar(cenario);
    }
  });

  it('ponte ausente: ensure TENTA subir a ponte antes de recarregar módulo', () => {
    const cenario = montarCenario({ ponte: false, backendRegistrado: false, registraAposReload: true });
    try {
      const ensure = rodar(cenario, 'ensure');
      expect(ensure.log).toContain('bridge start');
    } finally {
      limpar(cenario);
    }
  });

  it('container ausente: motivo explícito e exit 1 (não finge saúde)', () => {
    const cenario = montarCenario({ dockerOk: false });
    try {
      const check = rodar(cenario, 'check');
      expect(check.status).toBe(1);
      expect(check.saida).toContain('motivo=container_ausente');
    } finally {
      limpar(cenario);
    }
  });

  // ── SEGUNDO SINAL (medido em 2026-10-14) ──────────────────────────────────
  // O backend registrado NÃO basta: com 1 conexão ativa e "Last fail connection
  // attempt" no boot, o CDR para de gravar em silêncio e o passo 1/12 do converge
  // reprova com `pbxProdLike.cdr=false` — enquanto o script dizia `status=OK`.
  it('backend REGISTRADO + 1 conexão + Last fail ⇒ DEGRADED (falso negativo medido em 2026-10-14)', () => {
    const cenario = montarCenario({
      backendRegistrado: true,
      conexoes: 1,
      lastFail: '2026-10-14 21:05:26',
    });
    try {
      const check = rodar(cenario, 'check');
      expect(check.status).toBe(1);
      expect(check.saida).toContain('status=DEGRADED');
      expect(check.saida).toContain('motivo=odbc_ultima_tentativa_falhou');
      // O timestamp é parte do diagnóstico auditável.
      expect(check.saida).toContain('2026-10-14 21:05:26');
    } finally {
      limpar(cenario);
    }
  });

  it('ensure RECUPERA o estado de conexão falha (reload limpa o Last fail e sai RECOVERED)', () => {
    const cenario = montarCenario({
      backendRegistrado: true,
      conexoes: 1,
      lastFail: '2026-10-14 21:05:26',
    });
    try {
      const ensure = rodar(cenario, 'ensure');
      expect(ensure.status).toBe(0);
      expect(ensure.saida).toContain('status=RECOVERED');
      expect(ensure.log).toContain('module reload res_odbc.so');
      expect(ensure.log).toContain('module reload cdr_adaptive_odbc.so');
    } finally {
      limpar(cenario);
    }
  });

  it('sem Last fail: check OK (o sinal novo não gera falso positivo no caminho saudável)', () => {
    const cenario = montarCenario({ backendRegistrado: true, conexoes: 1, lastFail: null });
    try {
      const check = rodar(cenario, 'check');
      expect(check.status).toBe(0);
      expect(check.saida).toContain('odbc=sem_falha_registrada');
    } finally {
      limpar(cenario);
    }
  });

  it('o preflight do converge passa a exigir o BACKEND, não só a porta', () => {
    const converge = fs.readFileSync(
      path.join(ROOT, 'scripts', 'governance', 'converge-governance.sh'), 'utf8');
    // Sem esta checagem, um ciclo de ~40 min começa com CDR morto e reprova em 1/12.
    expect(converge).toContain('pbx-cdr-health.sh');
  });
});
