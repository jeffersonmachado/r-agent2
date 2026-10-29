'use strict';

/**
 * Supervisão GENERALIZADA dos serviços de dev (api + rag + frontend) e a política
 * de snapshot/teardown/restore usada pelo smoke prod-like.
 *
 * Defeitos REAIS medidos em 2026-10-11, todos encontrados por prova de execução e
 * travados aqui para não voltarem:
 *
 *  D1. Fallback duplicado: `curl … -w '%{http_code}' || printf '000'` produzia
 *      "000000" (o curl já imprime 000 em falha). Comparações com a string "000"
 *      paravam de funcionar — a decisão de "estava parado" nunca era reconhecida.
 *  D2. Mesmo defeito em `systemctl is-active … || echo unknown`: o comando imprime
 *      "inactive" E sai com código != 0, então a saída virava "inactive\nunknown",
 *      injetando um campo FANTASMA no snapshot (um serviço chamado "unknown").
 *  D3. Restauração não seletiva: o RAG que o operador havia deixado PARADO era
 *      parado (de novo) e RELIGADO pelo smoke — o smoke mudava o ambiente.
 *  D4. Resíduo falso positivo: filhos legítimos do serviço (`sh -c vite …`,
 *      `node …/vite`) casam o mesmo padrão de linha de comando do processo
 *      principal; a limpeza que pulava apenas o MainPID os MATARIA, derrubando o
 *      serviço que estava no ar.
 *
 * A política é um único módulo (`scripts/dev/lib/servicos-dev-state.sh`) consumido
 * pelo smoke — não há duas fontes de verdade sobre o que significa "estava no ar".
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVICE = path.join(ROOT, 'scripts', 'dev', 'service.sh');
const LIB = path.join(ROOT, 'scripts', 'dev', 'lib', 'servicos-dev-state.sh');
const SMOKE = path.join(ROOT, 'scripts', 'smoke', 'run-scheduled-production-health-smoke.sh');

/**
 * Porta EFÊMERA atribuída pelo SO (bind em 0) em vez de número fixo. As portas fixas usadas antes
 * (39117/39118/39119) estão DENTRO do range efêmero do Linux (32768–60999), então qualquer conexão de
 * saída da máquina pode ocupá-las: medido 2026-10-29, `EADDRINUSE` em 1 de 1122 suítes na execução
 * completa em paralelo, com a suíte passando isolada. O teste não depende do número — ele injeta a
 * porta detectada nos dublês — então usar a porta REAL atribuída preserva a mesma asserção.
 */
async function escutarEmPortaEfemera(servidor) {
  await new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', resolve);
  });
  return servidor.address().port;
}

const serviceCode = fs
  .readFileSync(SERVICE, 'utf8')
  .split('\n')
  .filter((linha) => !/^\s*#/.test(linha))
  .join('\n');
const libCode = fs.readFileSync(LIB, 'utf8');
const smoke = fs.readFileSync(SMOKE, 'utf8');
const smokeCode = smoke
  .split('\n')
  .filter((linha) => !/^\s*#/.test(linha))
  .join('\n');

/** Renderiza um template como o script faz (todos os placeholders). */
function renderTemplate(
  nome,
  {
    root = ROOT,
    log = '/tmp/x.log',
    node = '/usr/bin/node',
    npm = '/usr/bin/npm',
    uvicorn = path.join(root, 'rag-service', 'venv', 'bin', 'uvicorn'),
  } = {},
) {
  return fs
    .readFileSync(path.join(ROOT, 'scripts', 'dev', `${nome}.service.template`), 'utf8')
    .split('{{ROOT}}').join(root)
    .split('{{SERVICE_DIR}}').join(root)
    .split('{{LOG}}').join(log)
    .split('{{NODE}}').join(node)
    .split('{{NPM}}').join(npm)
    .split('{{UVICORN}}').join(uvicorn);
}

/**
 * Roda `systemd-analyze verify <arquivo>` devolvendo stdout+stderr SEMPRE.
 *
 * MEDIDO (systemd 255 e 249): o `verify` reporta `Unknown key name ... in section`
 * no stderr com **exit 0** — então inspecionar a saída apenas no `catch` (com
 * `execFileSync`) enxerga só metade dos diagnósticos e transforma o teste em algo
 * que não vê defeito nenhum quando o systemd decide não falhar o processo.
 */
function verificarUnit(file) {
  const r = spawnSync('systemd-analyze', ['verify', file], { encoding: 'utf8' });
  const codigo = typeof r.status === 'number' ? r.status : 1;
  return { codigo, saida: `${r.stdout || ''}${r.stderr || ''}` };
}

describe('supervisão generalizada dos serviços de dev', () => {
  test('os TRÊS serviços têm template versionado, com restart e trava anti-tempestade em [Unit]', () => {
    for (const nome of ['ragent2-api-dev', 'ragent2-rag-dev', 'ragent2-frontend-dev']) {
      const template = renderTemplate(nome);
      expect(template).toContain('Restart=always');
      expect(template).toMatch(/RestartSec=\d+/);
      expect(template).toContain('StandardOutput=append:');
      const unit = /^\[Unit\]$/m.exec(template);
      const service = /^\[Service\]$/m.exec(template);
      expect(unit).not.toBeNull();
      expect(service).not.toBeNull();
      const secaoUnit = template.slice(unit.index, service.index);
      expect(secaoUnit).toContain('StartLimitIntervalSec=');
      expect(secaoUnit).toContain('StartLimitBurst=');
      // Em [Service] o systemd IGNORA StartLimit* em silêncio (erro já cometido).
      expect(template.slice(service.index)).not.toContain('StartLimitIntervalSec=');
    }
  });

  test('systemd-analyze verify aceita as TRÊS units renderizadas', () => {
    let disponivel = true;
    try {
      execFileSync('systemd-analyze', ['--version'], { stdio: 'ignore' });
    } catch (_) {
      disponivel = false;
    }
    if (!disponivel) {
      expect(libCode).toContain('deve_parar');
      return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragent2-units-'));
    // VERIFICAÇÃO HERMÉTICA (medido 2026-10-21, run 39582527650): o template aponta para
    // caminhos que só existem na máquina real (`/usr/bin/node`) e no venv do RAG
    // (`rag-service/venv/bin/uvicorn`). No runner do CI eles não existem e o
    // `systemd-analyze verify` reprova com "Command /usr/bin/node is not executable" —
    // reprovação por AMBIENTE, não por sintaxe do unit. Custou um ciclo inteiro de
    // diagnóstico (a saída não aparecia em lugar nenhum) e um vermelho falso treina todos a
    // ignorar o L0. Aqui os executáveis passam a EXISTIR (stub executável), e o critério
    // continua estrito: qualquer linha do systemd que cite o unit segue reprovando.
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(binDir);
    const stub = (nome) => {
      const alvo = path.join(binDir, nome);
      fs.writeFileSync(alvo, '#!/bin/sh\nexit 0\n');
      fs.chmodSync(alvo, 0o755);
      return alvo;
    };
    const executaveis = { node: process.execPath, npm: stub('npm'), uvicorn: stub('uvicorn') };
    const reprovacoes = [];
    const saidaBruta = [];
    for (const nome of ['ragent2-api-dev', 'ragent2-rag-dev', 'ragent2-frontend-dev']) {
      const file = path.join(dir, `${nome}.service`);
      fs.writeFileSync(file, renderTemplate(nome, { log: path.join(dir, `${nome}.log`), ...executaveis }));
      const { codigo, saida } = verificarUnit(file);
      saidaBruta.push(`### ${nome} exit=${codigo}\n${saida || '(sem saída)'}`);
      const linhas = saida.split('\n').filter((linha) => linha.includes(`${nome}.service`));
      if (linhas.length > 0) reprovacoes.push({ nome, codigo, linhas });
    }
    // DIAGNÓSTICO PERSISTENTE **antes** da asserção: se a verificação reprovar, a saída BRUTA
    // já está em disco (o CI publica `reports/` como artefato). Antes o arquivo era escrito
    // DEPOIS do `expect` — a reprovação abortava a função e não sobrava evidência alguma.
    try {
      fs.mkdirSync(path.join(__dirname, '..', '..', '..', 'reports'), { recursive: true });
      fs.writeFileSync(
        path.join(__dirname, '..', '..', '..', 'reports', 'dev-services-supervision-systemd.log'),
        `${saidaBruta.join('\n')}\nsystemd-analyze: ${execFileSync('systemd-analyze', ['--version'], { encoding: 'utf8' }).split('\n')[0]}\n`,
      );
    } catch (_) { /* diagnóstico é best-effort: nunca muda o veredito */ }
    fs.rmSync(dir, { recursive: true, force: true });
    expect(reprovacoes).toEqual([]);
  });

  test('a verificação de units NÃO é vacuosa: defeito real do systemd é detectado', () => {
    // Prova de não-vacuidade do critério acima. Medido em systemd 255 e 249:
    //   * chave desconhecida  -> `<unit>:6: Unknown key name '...', ignoring.` e exit 0;
    //   * executável ausente  -> `<unit>: Command ... is not executable` e exit != 0.
    // Ou seja: o exit code NÃO separa defeito de aviso — o que separa é a linha citar o unit.
    // Este teste injeta um defeito real e exige que a MESMA checagem o detecte, para que a
    // correção do vermelho falso (binários existentes) nunca vire um teste que passa sempre.
    let disponivel = true;
    try {
      execFileSync('systemd-analyze', ['--version'], { stdio: 'ignore' });
    } catch (_) {
      disponivel = false;
    }
    if (!disponivel) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragent2-units-neg-'));
    const file = path.join(dir, 'ragent2-api-dev.service');
    fs.writeFileSync(
      file,
      renderTemplate('ragent2-api-dev', { node: process.execPath, npm: process.execPath, uvicorn: process.execPath })
        .replace('[Service]', '[Service]\nLvalueInventado=1'),
    );
    // Captura stdout+stderr SEMPRE: o defeito injetado sai como aviso (exit 0).
    const { saida } = verificarUnit(file);
    const linhas = saida.split('\n').filter((linha) => linha.includes('ragent2-api-dev.service'));
    fs.rmSync(dir, { recursive: true, force: true });
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas.join('\n')).toMatch(/Unknown key name/i);
  });

  test('nenhuma unit versiona segredo', () => {
    for (const nome of ['ragent2-api-dev', 'ragent2-rag-dev', 'ragent2-frontend-dev']) {
      expect(renderTemplate(nome)).not.toMatch(/API_KEY|SECRET|PASSWORD|TOKEN=/);
    }
    // O RAG lê o .env do próprio diretório (opcional: `-`), nunca embute segredo.
    expect(renderTemplate('ragent2-rag-dev')).toContain('EnvironmentFile=-');
  });

  test('o dispatcher cobre api/rag/frontend e falha fechado em serviço desconhecido', () => {
    expect(serviceCode).toContain('api rag frontend');
    let erro = null;
    try {
      execFileSync('bash', [SERVICE, 'status', 'servico-que-nao-existe'], { stdio: 'pipe' });
    } catch (error) {
      erro = error;
    }
    expect(erro).not.toBeNull();
    expect(erro.status).not.toBe(0);
    expect(`${erro.stdout}${erro.stderr}`).toContain('serviço desconhecido');
  });
});

describe('D1/D2 — normalização: fallback não pode DUPLICAR a saída', () => {
  test('o helper `|| printf`/`|| echo` não é usado em comandos que já imprimem valor', () => {
    // A forma correta é capturar em variável e só então aplicar o default.
    expect(serviceCode).not.toMatch(/curl[^\n]*\|\|\s*printf\s*'000'/);
    expect(smokeCode).not.toMatch(/is-active[^\n]*\|\|\s*(printf|echo)\s*'?(unknown|000)?/);
  });

  test('health_code devolve UM valor (mesmo quando o curl falha)', () => {
    // Executa o script real com um `curl` falso que só escreve "000" e sai != 0,
    // reproduzindo a condição que duplicava o código. O valor observado sai do
    // próprio `status`, que imprime `health=<code>`.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragent2-fakecurl-'));
    fs.writeFileSync(
      path.join(dir, 'curl'),
      '#!/usr/bin/env bash\nprintf 000\nexit 7\n',
    );
    fs.writeFileSync(
      path.join(dir, 'systemctl'),
      // `show-environment` precisa responder OK: `require_systemd` usa essa chamada
      // para provar que existe D-Bus de usuário antes de qualquer operação.
      '#!/usr/bin/env bash\ncase "$*" in *show-environment*) exit 0 ;; esac\nprintf "inactive\\n"\nexit 3\n',
    );
    for (const bin of ['curl', 'systemctl']) fs.chmodSync(path.join(dir, bin), 0o755);
    const saida = execFileSync('bash', [SERVICE, 'status', 'rag'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
    expect(saida).toContain('health=000');
    expect(saida).not.toContain('health=000000');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('D3 — o smoke restaura SÓ o que ele parou', () => {
  test('a política decide parar/preservar de forma explícita (tabela executada de verdade)', () => {
    const casos = [
      ['active', '200', '0'],
      ['activating', '000', '0'],
      ['reloading', '000', '0'],
      ['inactive', '200', '0'], // processo solto segurando a porta: PRECISA parar
      ['inactive', '000', '1'], // já estava desligado: PRESERVAR
      ['inactive', '', '1'], // D1: health vazio não é "000" nem "no ar"
      ['failed', '000', '1'],
      ['unknown', '000', '1'],
      ['sem_unidade', '200', '1'], // sem unidade não há restauração determinística
    ];
    const script = casos
      .map(([estado, health, esperado]) => `deve_parar ${estado} '${health}' && r=0 || r=1; [ "$r" = "${esperado}" ] || { echo "FALHOU ${estado}/${health} esperado ${esperado}"; exit 1; }`)
      .join('\n');
    const saida = execFileSync('bash', ['-c', `. "${LIB}"\n${script}\necho TODOS_OK`], {
      encoding: 'utf8',
    });
    expect(saida).toContain('TODOS_OK');
  });

  test('deve_restaurar só aceita quem foi marcado como parado', () => {
    const saida = execFileSync(
      'bash',
      ['-c', `. "${LIB}"; deve_restaurar parado && printf A; deve_restaurar preservado || printf B; deve_restaurar '' || printf C`],
      { encoding: 'utf8' },
    );
    expect(saida).toBe('ABC');
  });

  test('o snapshot usa delimitador fixo e não compara com a string "000"', () => {
    expect(smokeCode).toContain("IFS='|' read -r s estado health");
    // O critério de "estava no ar" vem do módulo compartilhado, não de um `if`
    // local que poderia divergir do restore.
    expect(smokeCode).toContain('deve_parar');
    expect(smokeCode).toContain('deve_restaurar');
    expect(smokeCode).not.toMatch(/"\$health"\s*=\s*"000"/);
  });

  test('o smoke tem trap de saída e restauração idempotente', () => {
    expect(smokeCode).toMatch(/trap\s+on_exit\s+EXIT\s+INT\s+TERM/);
    expect(smokeCode).toContain('RESTORE_CONCLUIDO=1');
    // Restauração no caminho NORMAL, antes do veredito final.
    const posRestore = smokeCode.indexOf('restore_dev_state');
    const posVeredito = smokeCode.indexOf('END status=');
    expect(posRestore).toBeGreaterThan(-1);
    expect(posVeredito).toBeGreaterThan(posRestore);
  });

  test('o snapshot cobre os TRÊS serviços (parar só a API deixava Vite/uvicorn presos à porta)', () => {
    expect(smokeCode).toContain('SERVICOS_DEV="api rag frontend"');
    expect(smokeCode).toContain('5173');
    expect(smokeCode).toContain('8001');
  });
});

describe('D4 — filho do serviço não é resíduo', () => {
  test('a identidade usa o ControlGroup da unidade (não só o MainPID)', () => {
    expect(serviceCode).toContain('ControlGroup');
    expect(serviceCode).toContain('proc_no_cgroup_da_unidade');
    // E a limpeza consulta essa identidade ANTES de matar.
    const posCheck = serviceCode.indexOf('proc_no_cgroup_da_unidade "$pid" "$servico" && continue');
    const posKill = serviceCode.indexOf('kill -TERM "$pid"');
    expect(posCheck).toBeGreaterThan(-1);
    expect(posKill).toBeGreaterThan(posCheck);
  });

  test('identidade por cwd também é exigida (protege OUTRA instalação do RAP)', () => {
    expect(serviceCode).toContain('proc_pertence_ao_root');
    expect(serviceCode).toContain('/proc/$pid/cwd');
    // cwd ilegível => não mexer (fail-closed).
    expect(serviceCode).toMatch(/\[ -n "\$cwd" \] \|\| return 1/);
  });

  test('o `stop` limpa resíduo fora da unidade (senão a porta continua ocupada)', () => {
    const posStop = serviceCode.indexOf('systemctl --user stop');
    const posReap = serviceCode.indexOf('reap_strays "$servico"', posStop);
    expect(posStop).toBeGreaterThan(-1);
    expect(posReap).toBeGreaterThan(posStop);
  });

  test('nenhum script usa pkill/fuser para derrubar serviço supervisionado', () => {
    for (const codigo of [serviceCode, smokeCode]) {
      expect(codigo).not.toMatch(/\bpkill\b/);
      expect(codigo).not.toMatch(/\bfuser\s+-k\b/);
    }
  });
});

/**
 * D5. `health` prova que ALGUÉM responde — não prova QUEM.
 *
 * Medido em 2026-10-13 durante prova de execução do smoke agendado: o log disse
 *
 *   [api] RESTAURADO (health=200) — estado inicial era unidade=active health=200
 *
 * com a unidade de dev PARADA; quem respondia em 127.0.0.1:3001 era o container
 * `chatbot-api` da stack prod-like. O smoke declarava "ambiente restaurado" e
 * saía 0 — falso verde, e a unidade de dev ficava em loop de EADDRINUSE sem
 * nenhum erro aparecer. A restauração agora exige IDENTIDADE (ControlGroup) e
 * restauração incompleta tem estado terminal próprio (exit 3), nunca GO.
 */
describe('D5 — identidade de quem responde na porta', () => {
  /** Roda um snippet bash com a lib carregada, devolvendo stdout. */
  function rodarComLib(script) {
    return execFileSync('bash', ['-c', `source "${LIB}"\n${script}`], {
      encoding: 'utf8',
      timeout: 20000,
    }).trim();
  }

  test('a lib expõe porta canônica, PIDs da porta e identidade (fonte única)', () => {
    expect(libCode).toContain('dev_porta()');
    expect(libCode).toContain('dev_pids_na_porta()');
    expect(libCode).toContain('dev_pid_no_cgroup()');
    expect(libCode).toContain('porta_pertence_a_unidade()');
  });

  test('porta canônica: 3001/8001/5173 e serviço desconhecido falha', () => {
    expect(rodarComLib('dev_porta api')).toBe('3001');
    expect(rodarComLib('dev_porta rag')).toBe('8001');
    expect(rodarComLib('dev_porta frontend')).toBe('5173');
    expect(rodarComLib('dev_porta inexistente; echo "rc=$?"')).toBe('rc=1');
  });

  test('EXECUÇÃO: processo REAL fora da unidade => identidade NÃO comprovada (fail-closed)', async () => {
    const servidor = require('http').createServer((_req, res) => res.end('ok'));
    const porta = await escutarEmPortaEfemera(servidor);
    try {
      const pidReal = String(process.pid);
      // 1) o PID que escuta É encontrado;
      const pids = rodarComLib(`dev_pids_na_porta ${porta}`);
      expect(pids.split('\n')).toContain(pidReal);

      // 2) mas NÃO pertence ao ControlGroup da unidade (cgroup do processo de
      // teste não é o da unidade de dev) => decisão fail-closed.
      const fora = rodarComLib(
        `dev_pid_no_cgroup ${pidReal} ragent2-api-dev; echo "rc=$?"`
      );
      expect(fora).toBe('rc=1');

      const decisao = rodarComLib(
        [
          `dev_porta() { printf '${porta}'; }`,
          `dev_unidade() { printf 'ragent2-api-dev'; }`,
          'porta_pertence_a_unidade api',
          'echo "rc=$?"',
        ].join('\n')
      );
      expect(decisao).toBe('rc=1');
    } finally {
      await new Promise((resolve) => servidor.close(resolve));
    }
  });

  test('identidade COMPROVADA quando o cgroup do PID é o da unidade', async () => {
    const servidor = require('http').createServer((_req, res) => res.end('ok'));
    const porta = await escutarEmPortaEfemera(servidor);
    try {
      const cgroupReal = execFileSync(
        'bash',
        ['-c', `sed -n 's/^0:://p' /proc/${process.pid}/cgroup | head -n1`],
        { encoding: 'utf8' }
      ).trim();
      expect(cgroupReal).not.toBe('');
      const decisao = rodarComLib(
        [
          `dev_porta() { printf '${porta}'; }`,
          `dev_unidade() { printf 'ragent2-api-dev'; }`,
          // dublê de systemctl devolvendo o ControlGroup REAL deste processo de
          // teste: é exatamente o que a unidade devolveria para o seu próprio PID.
          `systemctl() { printf '%s\\n' '${cgroupReal}'; }`,
          'porta_pertence_a_unidade api',
          'echo "rc=$?"',
        ].join('\n')
      );
      expect(decisao).toBe('rc=0');
    } finally {
      await new Promise((resolve) => servidor.close(resolve));
    }
  });

  test('sem evidência (nada escutando / cgroup ilegível) => NÃO comprovado', () => {
    expect(rodarComLib('dev_pids_na_porta 39999; echo "fim"')).toBe('fim');
    expect(rodarComLib('dev_pid_no_cgroup 999999 ragent2-api-dev; echo "rc=$?"')).toBe('rc=1');
    expect(rodarComLib('dev_pid_no_cgroup "" ragent2-api-dev; echo "rc=$?"')).toBe('rc=1');
  });

  test('restore do smoke NÃO declara RESTAURADO sem identidade comprovada', () => {
    const posStart = smokeCode.indexOf('restore_dev_state() {');
    const posFim = smokeCode.indexOf('# Saída antecipada', posStart);
    const corpo = smokeCode.slice(posStart, posFim);
    const posIdentidade = corpo.indexOf('porta_pertence_a_unidade "$s"');
    const posLogOk = corpo.indexOf('RESTAURADO');
    // A verificação de identidade precede o log de sucesso.
    expect(posIdentidade).toBeGreaterThan(-1);
    expect(posLogOk).toBeGreaterThan(posIdentidade);
    // O ramo "identidade OK" é o ÚNICO que pode dizer RESTAURADO; o ramo de
    // conflito (else) diz explicitamente que a unidade NÃO atende a porta.
    const posElse = corpo.indexOf('else', posIdentidade);
    expect(posElse).toBeGreaterThan(posIdentidade);
    const ramoOk = corpo.slice(posIdentidade, posElse);
    const ramoConflito = corpo.slice(posElse, posElse + 700);
    expect(ramoOk).toContain('RESTAURADO');
    expect(ramoConflito).not.toContain('RESTAURADO');
    expect(ramoConflito).toContain('NÃO é servida pela unidade');
  });

  test('restauração incompleta tem estado terminal próprio (exit 3), nunca GO', () => {
    expect(smokeCode).toContain('RESTORE_FALHAS=0');
    expect(smokeCode).toContain('RESTORE_FALHAS=$((RESTORE_FALHAS + RESTORE_FALHAS_LOCAL))');
    expect(smokeCode).toContain('status=RESTORE_INCOMPLETO exit=3');
    // O veredito GO só sai com restauração íntegra.
    const posGuard = smokeCode.indexOf('[[ $EXIT_CODE -eq 0 ]] && [[ $RESTORE_FALHAS -gt 0 ]]');
    const posGo = smokeCode.indexOf('END status=GO exit=0');
    expect(posGuard).toBeGreaterThan(-1);
    expect(posGo).toBeGreaterThan(posGuard);
    // E o trap aplica a mesma regra na saída antecipada.
    const posTrap = smokeCode.indexOf('on_exit() {');
    expect(smokeCode.slice(posTrap, posTrap + 500)).toContain('RESTORE_FALHAS');
  });
});

/**
 * D6. "Ativa sem servir": com `EADDRINUSE` no `listen`, o processo NÃO morre e o
 * systemd considera a unidade `active` — ela fica no ar sem atender porta
 * nenhuma e nunca reinicia sozinha.
 *
 * Medido em 2026-10-13: `ragent2-api-dev` em "active (running)" há 1min42s, porta
 * 3001 sem ninguém escutando e health 000, após
 * `[ERROR] [WebSocketService] listen EADDRINUSE: address already in use :::3001`
 * (a unidade foi religada enquanto a stack Docker ocupava a porta). O `start`
 * antigo só olhava `health`, então declarava sucesso apoiado no 200 de QUEM
 * respondesse — ou falhava sem dizer a causa.
 */
describe('D6 — start exige identidade e recupera "ativa sem servir"', () => {
  test('o service.sh consome a MESMA política de estado (fonte única, sem duplicar portas)', () => {
    expect(serviceCode).toContain('lib/servicos-dev-state.sh');
    expect(serviceCode).toContain('esperar_identidade()');
    expect(serviceCode).toContain('porta_pertence_a_unidade');
    expect(serviceCode).toContain('dev_pids_na_porta');
    // A porta não é reescrita como literal dentro do start.
    const corpo = serviceCode.slice(
      serviceCode.indexOf('cmd_start() {'),
      serviceCode.indexOf('cmd_stop() {')
    );
    expect(corpo).toContain('dev_porta "$servico"');
  });

  test('start só declara sucesso com health E identidade; senão reinicia uma vez e falha explicando', () => {
    const corpo = serviceCode.slice(
      serviceCode.indexOf('cmd_start() {'),
      serviceCode.indexOf('cmd_stop() {')
    );
    // Caminho feliz exige as duas condições.
    expect(corpo).toMatch(/esperar_health "\$servico" 30 && esperar_identidade "\$servico"/);
    // Recuperação de bind falho: restart único.
    expect(corpo).toContain('systemctl --user restart');
    expect(corpo).toContain('reiniciando a unidade uma vez');
    // Falha terminal aponta a porta e quem responde ali.
    expect(corpo).toContain('NÃO atende a porta');
    const posFail = corpo.indexOf('NÃO atende a porta');
    const posHealth = corpo.indexOf('esperar_health "$servico" 30');
    expect(posFail).toBeGreaterThan(posHealth);
  });

  test('PROVA FUNCIONAL: porta servida por outro processo => start FALHA (antes: "no ar")', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-svc-dubles-'));
    const net = require('net');
    const cgroupFalso = '/fake.slice/unidade-alheia.service';
    const servidor = net.createServer(() => {});
    const portaFalsa = await escutarEmPortaEfemera(servidor);
    fs.writeFileSync(
      path.join(tmp, 'ss'),
      `#!/usr/bin/env bash\nprintf 'LISTEN 0 511 127.0.0.1:${portaFalsa} 0.0.0.0:* users:(("node",pid=${process.pid},fd=1))\\n'\n`
    );
    fs.writeFileSync(
      path.join(tmp, 'systemctl'),
      [
        '#!/usr/bin/env bash',
        'case "$*" in',
        `  *"show -p ControlGroup --value"*) printf '%s\\n' '${cgroupFalso}' ;;`,
        '  *is-active*) printf "active\\n" ;;',
        '  *"cat"*) exit 0 ;;',
        'esac',
        'exit 0',
        '',
      ].join('\n')
    );
    // curl devolve 200 em qualquer porta: "alguém responde", sem ser a unidade.
    fs.writeFileSync(path.join(tmp, 'curl'), '#!/usr/bin/env bash\nprintf \'200\'\n');
    for (const bin of ['ss', 'systemctl', 'curl']) {
      fs.chmodSync(path.join(tmp, bin), 0o755);
    }
    let resultado;
    try {
      resultado = execFileSync(
        'bash',
        [path.join(ROOT, 'scripts', 'dev', 'service.sh'), 'start', 'api'],
        {
          encoding: 'utf8',
          timeout: 60000,
          env: {
            ...process.env,
            PATH: `${tmp}:${process.env.PATH}`,
            RAGENT2_IDENTIDADE_TENTATIVAS: '1',
          },
        }
      );
      resultado = { status: 0, saida: resultado };
    } catch (erro) {
      resultado = {
        status: erro.status,
        saida: `${erro.stdout || ''}${erro.stderr || ''}`,
      };
    } finally {
      servidor.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    // Não pode sair 0 nem dizer "no ar": quem atende a porta não é a unidade.
    expect(resultado.status).toBe(1);
    expect(resultado.saida).toContain('quem atende não é a unidade');
    expect(resultado.saida).toContain('NÃO atende a porta');
    expect(resultado.saida).not.toMatch(/\[api\] no ar/);
  });
});
