'use strict';

/**
 * ER-V1-SEAL-003 (Dedicated Execution Runner) — globalSetup do Jest.
 *
 * Sobe o Engineering Runner REAL (services/engineering-runner/src/index.js) como processo
 * SEPARADO antes de toda a suíte de testes — a mesma separação de processo que existe em
 * produção (API principal nunca chama `executionSandbox.js` diretamente; fala com o runner via
 * HTTP). `ENGINEERING_RUNNER_URL`/`ENGINEERING_RUNNER_TOKEN` setados aqui em `process.env` são
 * herdados pelos workers do Jest (mesmo processo principal do Jest CLI que spawna os workers).
 *
 * PID do processo do runner é persistido em disco (o globalSetup roda e termina antes da suíte
 * — não sobrevive para o globalTeardown localizar o processo por referência em memória).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * REGIME ÚNICO DE AMBIENTE — o `.env` é carregado UMA vez aqui, antes de o runner subir e antes
 * de os workers do Jest serem criados (eles herdam este `process.env`).
 *
 * DEFEITO REAL, medido em 2026-10-02: `npm run test:unit` falhava 3/3 em
 * `tests/unit/engineeringRouterSafeEnvironment.test.js` com `exitCode: null` e excerpts
 * `undefined`, enquanto a MESMA suíte passava no runner autoritativo. A causa não era a suíte: o
 * contrato do Engineering Runner exige que o cwd da execução esteja sob
 * `ENGINEERING_ROUTER_WORKSPACE_ROOT`, chave que vive no `.env`. Sem `.env` carregado o teste
 * cria o workspace no TMPDIR do host, o runner recusa com `cwd_not_allowed` e o veredito passa a
 * depender de QUEM INVOCA — medido: sem a chave 0/3, com a chave 3/3.
 *
 * O mesmo defeito já tinha sido diagnosticado (e corrigido) em
 * `scripts/governance/lib/loadEnvFile.js` — mas apenas nos COLETORES de governança. A origem do
 * regime é a sessão de teste: corrigir aqui faz `npm run test:unit`, `npx jest`, o runner do
 * manifesto e o selo verem o MESMO ambiente, em vez de cada invocador produzir um veredito
 * próprio. O ambiente já presente VENCE (o operador pode sobrescrever sem editar o arquivo).
 */
const { loadEnvFile } = require(path.join(ROOT, 'scripts', 'governance', 'lib', 'loadEnvFile'));
const envLoad = loadEnvFile(ROOT);
// stderr, NUNCA stdout — a mesma regra documentada logo abaixo para o banner do runner. O
// globalSetup roda no MESMO processo CLI que produz a saída de `--json` do Jest, e é esse stdout
// que `collect-engineering-router-runtime-evidence.js` parseia: uma linha em stdout ANTES do JSON
// faz o `JSON.parse` falhar e os 25 itens de runtime irem a RUNTIME_FAIL com
// "saída do Jest não pôde ser parseada como JSON". DEFEITO PRÓPRIO, medido em 2026-10-02: esta
// linha nasceu em stdout e derrubou exatamente os 25 itens que o comentário abaixo descreve como
// já resolvidos — o alerta existia, e foi ignorado na linha de cima.
process.stderr.write(`[jest-global-setup] .env ${envLoad.loaded ? `carregado (${envLoad.keys} chave(s) aplicada(s); ambiente explícito vence)` : `não aplicado: ${envLoad.reason}`}\n`);

// PID FILE POR PORTA (2026-10-20).
//
// DEFEITO MEDIDO: o arquivo tinha nome FIXO (`.jest-engineering-runner.pid`), então duas sessões
// de teste no MESMO repositório — ou um run em porta alternativa — compartilhavam o mesmo registro.
// O `globalTeardown` da sessão A lia o pid gravado pela sessão B (que acabara de subir seu runner)
// e matava o runner ALHEIO. Sintoma observado: `SANDBOX_UNAVAILABLE ... fetch failed` em uma suíte
// que passa isolada, e `RUNTIME_FAIL` em um item diferente a cada coleta — sempre dependente de
// promoção. O nome agora carrega a porta, que é a identidade do runner de teste.
const RUNNER_PORT = Number(process.env.ENGINEERING_RUNNER_TEST_PORT || 8097);
const PID_FILE = path.join(ROOT, `.jest-engineering-runner-${RUNNER_PORT}.pid`);
const RUNNER_TOKEN = 'jest-test-engineering-runner-token';
const READY_TIMEOUT_MS = 15000;

/**
 * Sonda `/health` UMA vez, com timeout curto. Usada ANTES do spawn: se algo já responde na porta,
 * não subimos runner nenhum — ver a explicação do vazamento auto-amplificante no corpo do setup.
 * Devolve o corpo parseado, ou `null` quando não há ninguém atendendo.
 */
function probeHealthOnce(url, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (_) { resolve({}); }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) { retry(); return; }
          try { resolve(JSON.parse(body)); } catch (_) { resolve(null); }
        });
      });
      req.on('error', retry);
    };
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Engineering Runner não respondeu /health dentro de ${timeoutMs}ms`));
        return;
      }
      setTimeout(attempt, 200);
    };
    attempt();
  });
}

/**
 * Achado real (ER-V1-SEAL-004, ao rodar o pilot real do Router: um `testCommand` da task é, ele
 * mesmo, um `npx jest --testPathPattern=...` — ex.: `RegressionPlan`/promoção rodando o teste do
 * fixture `mathUtils.test.js`). Esse `npx jest` ANINHADO roda DENTRO do workspace isolado
 * materializado por `git worktree add --detach` (ver `patchApplyService.js::materializeWorktree`)
 * e, sem `--config` explícito no `testCommand`, resolve o MESMO `jest.config.cjs` do repositório
 * (copiado para dentro do worktree) — que também aponta para este `globalSetup`. Isso tentava
 * subir um SEGUNDO Engineering Runner recursivamente a partir de dentro do sandbox, e crashava
 * com `EACCES` ao escrever `.jest-engineering-runner.pid` (o worktree/sandbox não tem essa
 * permissão), derrubando o `npx jest` aninhado inteiro ANTES de rodar qualquer teste — o que por
 * sua vez derrubava a task inteira do Router (RED->FIX repetido, nunca chegando a GREEN).
 *
 * Um worktree vinculado (`git worktree add`, nunca o repositório principal) sempre tem `.git`
 * como ARQUIVO (contém `gitdir: ...`), nunca como diretório — sinal confiável e já nativo do
 * git para detectar "estou rodando dentro de um workspace isolado do Engineering Router" sem
 * precisar de nenhuma env var nova. Nesse caso, pula o spawn: o `npx jest` aninhado não executa
 * nenhum código do próprio Router (é só o teste do fixture sendo validado), então nunca precisa
 * do Engineering Runner — e, se algum dia precisar, o fail-closed pré-existente
 * (`SANDBOX_UNAVAILABLE`, sem `ENGINEERING_RUNNER_URL`) já cobre isso corretamente.
 */
function isInsideLinkedGitWorktree() {
  try {
    return fs.statSync(path.join(ROOT, '.git')).isFile();
  } catch (_) {
    return false;
  }
}

/**
 * O ocupante da porta é o runner DESTE repositório? Identidade pela LINHA DE COMANDO.
 *
 * É o que permite limpar o próprio resíduo sem nunca tocar em processo alheio: qualquer coisa que
 * não seja comprovadamente `services/engineering-runner/src/index.js` mantém o aborto fail-closed.
 */
function isOwnEngineeringRunnerProcess(pid) {
  try {
    // eslint-disable-next-line global-require
    const { execFileSync } = require('child_process');
    const args = execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    return args.includes('services/engineering-runner/src/index.js');
  } catch (_) {
    return false;
  }
}

/** Espera a porta parar de responder (usado APÓS encerrar um resíduo nosso). */
async function waitForPortFree(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const occupant = await probeHealthOnce(url);
    if (!occupant) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 100); });
  }
  return false;
}

module.exports = async function engineeringRunnerGlobalSetup() {
  if (isInsideLinkedGitWorktree()) {
    process.stderr.write('[jest-global-setup] rodando dentro de um git worktree isolado (workspace do Engineering Router) — pulando spawn do Engineering Runner (aninhamento não suportado/não necessário aqui).\n');
    return;
  }

  // PRÉ-CHECAGEM DA PORTA — antes de subir qualquer coisa.
  //
  // VAZAMENTO AUTO-AMPLIFICANTE, medido em 2026-10-02: a checagem de identidade abaixo roda DEPOIS
  // do spawn. Se um runner órfão já ocupa a porta, o filho novo AINDA É SUBIDO, a checagem lança…
  // e o filho fica VIVO (medido: os dois processos coexistem ouvindo na mesma porta). A execução
  // seguinte encontra DOIS órfãos, e cada falha daí em diante adiciona mais um — foi assim que uma
  // falha isolada virou cascata de falhas em todas as 25 suítes de runtime e depois no selo V2.
  //
  // Aqui o ocupante é detectado antes do spawn: nada é criado, nada precisa ser limpo depois, e o
  // erro nomeia o remédio em vez de se acumular.
  const occupant = await probeHealthOnce(`http://127.0.0.1:${RUNNER_PORT}/health`);
  if (occupant) {
    // AUTO-CURA CIRCUNSCRITA AO PRÓPRIO RESÍDUO.
    //
    // O aborto abaixo é fail-closed e evita ACUMULAR órfãos, mas tem um efeito colateral medido
    // (2026-10-03): quando um lote morre de forma ANORMAL (kill/timeout do runner de suítes), o
    // globalTeardown não roda, o filho fica VIVO e o lote SEGUINTE aborta aqui. Como o Jest também
    // não roda o teardown quando o globalSetup lança, o órfão nunca é limpo e a cascata é
    // IRREVERSÍVEL — medido: batches 2..10 abortados e a execução autoritativa parando em 12 de 63
    // suítes, o que bloqueia permanentemente os gates que dependem dela.
    //
    // Aqui só o resíduo COMPROVADAMENTE nosso (linha de comando) é encerrado. Processo estranho
    // mantém o aborto: a guarda não é enfraquecida — ela deixa de punir o próprio lixo.
    const leftoverPid = Number(occupant.pid);
    if (Number.isFinite(leftoverPid) && leftoverPid > 0 && leftoverPid !== process.pid
      && isOwnEngineeringRunnerProcess(leftoverPid)) {
      try {
        process.kill(leftoverPid, 'SIGKILL');
        await waitForPortFree(`http://127.0.0.1:${RUNNER_PORT}/health`, 3000);
        process.stderr.write(`[jest-global-setup] resíduo do próprio Engineering Runner (pid ${leftoverPid}) encerrado; subindo um novo.\n`);
      } catch (_) {
        // se a limpeza não funcionar, o aborto abaixo continua valendo (fail-closed preservado)
      }
    }
  }

  const stillOccupied = await probeHealthOnce(`http://127.0.0.1:${RUNNER_PORT}/health`);
  if (stillOccupied) {
    throw new Error(
      `a porta ${RUNNER_PORT} já tem um processo respondendo em /health ANTES de subirmos o runner ` +
      `(pid reportado ${Number(stillOccupied.pid) || 'desconhecido'}) — runner ÓRFÃO de sessão anterior. ` +
      `Encerre quem segura a porta (ss -ltnp | grep ${RUNNER_PORT}) e rode de novo. ` +
      'Nenhum runner foi subido para não deixar mais um órfão.',
    );
  }

  // DIAGNÓSTICO DO RUNNER (medido 2026-10-09): o `stderr` do filho era DESCARTADO
  // (`stdio: ['ignore','ignore','ignore']`), então um `INFRA_ERROR`/`exitCode: null`
  // chegava ao chamador sem NENHUMA pista da causa — foi o que tornou o diagnóstico
  // do sandbox um exercício de adivinhação. O destino é ARQUIVO, nunca stdout: o
  // stdout do globalSetup é parseado pelo coletor (ver aviso no topo deste arquivo).
  const runnerLogFd = (() => {
    try {
      const logDir = path.join(ROOT, 'logs');
      fs.mkdirSync(logDir, { recursive: true });
      return fs.openSync(path.join(logDir, 'engineering-runner-jest.log'), 'a');
    } catch (_) {
      return 'ignore';
    }
  })();

  // ORDEM IMPORTA — as variáveis são definidas ANTES do spawn, não depois.
  //
  // DEFEITO REAL MEDIDO (2026-10-20): a atribuição existia só DEPOIS de `waitForHealth`. O filho
  // do runner herda `{...process.env}` no instante do spawn — e nesse instante a env ainda trazia
  // `ENGINEERING_RUNNER_URL` do `.env` (`127.0.0.1:8090`, endereço de dev). Medido com sonda por
  // processo: o processo do runner nasceu com `url=http://127.0.0.1:8090` e `port=8097`. Toda
  // execução disparada a partir dali podia falar com a porta errada, produzindo
  // `SANDBOX_UNAVAILABLE ... :8090: fetch failed` e missões BLOCKED em suítes que passam isoladas.
  process.env.ENGINEERING_RUNNER_URL = `http://127.0.0.1:${RUNNER_PORT}`;
  process.env.ENGINEERING_RUNNER_TOKEN = RUNNER_TOKEN;

  const child = spawn(process.execPath, [path.join(ROOT, 'services', 'engineering-runner', 'src', 'index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      ENGINEERING_RUNNER_TOKEN: RUNNER_TOKEN,
      ENGINEERING_RUNNER_PORT: String(RUNNER_PORT),
    },
    stdio: ['ignore', 'ignore', runnerLogFd],
    detached: false,
  });

  fs.writeFileSync(PID_FILE, String(child.pid));

  const health = await waitForHealth(`http://127.0.0.1:${RUNNER_PORT}/health`, READY_TIMEOUT_MS);

  // GUARDA DE IDENTIDADE — quem respondeu na porta tem de ser o processo que NÓS subimos.
  //
  // DEFEITO REAL medido em 2026-10-02: um runner ÓRFÃO de 01/out ficou preso na porta 8097 (deixado
  // por um terminal encerrado no meio do ciclo de vida do Jest). O filho novo morria em
  // `EADDRINUSE`, mas o health check era respondido pelo ORFÃO — e os testes passavam a falar com um
  // runner de configuração desconhecida (workspace root, token e estado alheios), produzindo falhas
  // INTERMITENTES como `exitCode: null` / `stdoutExcerpt: undefined`, sem nenhuma pista da causa
  // real. Verificado por medição: com a porta ocupada, o runner morre com
  // `EADDRINUSE: address already in use 0.0.0.0:8097`.
  //
  // A comparação por `pid` é DETERMINÍSTICA (sem corrida com a morte assíncrona do filho): se o
  // nosso filho morreu, nenhuma resposta pode trazer o pid dele. Fail-closed: falhar aqui nomeia o
  // remédio; degradar em silêncio falando com runner alheio não é opção.
  const answeringPid = Number(health && health.pid);
  if (answeringPid !== child.pid) {
    // Abortar SEM deixar o filho para trás: matar e remover o PID file é o que impede o vazamento
    // auto-amplificante descrito na pré-checagem acima (o globalTeardown não roda quando o
    // globalSetup lança, então a limpeza precisa acontecer aqui).
    try { child.kill('SIGKILL'); } catch (_) { /* já morto */ }
    try { fs.rmSync(PID_FILE, { force: true }); } catch (_) { /* sem arquivo */ }
    throw new Error(
      `Engineering Runner na porta ${RUNNER_PORT} respondeu como pid ${Number.isFinite(answeringPid) ? answeringPid : 'desconhecido'} ` +
      `mas o runner que subimos é pid ${child.pid} (exit=${child.exitCode}, signal=${child.signalCode}) — ` +
      `a porta está ocupada por um processo ESTRANGEIRO (runner órfão de sessão anterior). ` +
      `O filho que subimos foi encerrado e nenhum runner ficou para trás. ` +
      `Encerre o estrangeiro (ss -ltnp | grep ${RUNNER_PORT}) e rode de novo.`,
    );
  }

  process.env.ENGINEERING_RUNNER_URL = `http://127.0.0.1:${RUNNER_PORT}`;
  process.env.ENGINEERING_RUNNER_TOKEN = RUNNER_TOKEN;

  // stderr, nunca stdout: globalSetup roda no MESMO processo CLI que produz a saída de
  // `--json`/`--silent` do Jest (usada por scripts/governance/collect-engineering-router-runtime-evidence.js
  // para parsear resultados estruturados) — qualquer console.log aqui contamina esse stdout e
  // quebra o JSON.parse do coletor (achado real: os 25 itens de runtime evidence quebravam com
  // "saída do Jest não pôde ser parseada como JSON" até esta correção).
  process.stderr.write(`[jest-global-setup] Engineering Runner real (pid ${child.pid}) pronto em http://127.0.0.1:${RUNNER_PORT}\n`);
};

module.exports.PID_FILE = PID_FILE;
module.exports.RUNNER_PORT = RUNNER_PORT;
module.exports.RUNNER_TOKEN = RUNNER_TOKEN;
