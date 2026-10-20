'use strict';

/**
 * scripts/governance/run-release-suites.js — EXECUÇÃO CANÔNICA das suítes autoritativas.
 *
 * Substitui `jest <globs manuais>` por execução DERIVADA do manifesto canônico
 * (`config/canonical-release-suites.json`, resolvido por `lib/releaseSuiteManifest`).
 *
 * Por que existe (achado real de 2026-09-25): o comando de execução usava globs e o validador
 * anti-greenwashing usava uma LISTA À MÃO. Consequências medidas:
 *   - os dois conjuntos divergiam (o gate verificava menos do que se executava);
 *   - suítes autoritativas fora da lista pulavam infraestrutura em SILÊNCIO com `console.warn`,
 *     sem aparecer em nenhum relatório (uma delas foi encontrada assim que o manifesto passou a
 *     ser derivado);
 *   - suíte nova exigia edição manual em dois lugares, e esquecer isso produzia PASS com cobertura
 *     incompleta.
 *
 * Este runner produz `reports/release-suite-execution.json` com o estado REAL de cada suíte do
 * manifesto — incluindo NOT_EXECUTED e a contagem de testes — e falha se:
 *   - alguma suíte do manifesto não aparecer na execução (NOT_EXECUTED);
 *   - alguma suíte "passar" executando ZERO testes;
 *   - alguma suíte falhar.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { ROOT, writeReport } = require('./common');
const { resolveManifest, evaluateExecution, MANIFEST_VIOLATION_CODES } = require('./lib/releaseSuiteManifest');
// Fonte única da carga do `.env` (mesmo módulo usado por
// `collect-engineering-router-runtime-evidence.js`, que tinha o MESMO defeito: o veredito
// dependia de quem invocava o coletor).
const { loadEnvFile: loadEnvFileFromLib } = require('./lib/loadEnvFile');

/**
 * Carrega o `.env` do repositório (se existir) SEM sobrescrever o que já veio do ambiente.
 *
 * DEFEITO REAL medido em 2026-09-29: o regime autoritativo não era determinístico. O
 * `seal-release.sh` exporta o `.env` no shell antes de chamar o runner; um
 * `node scripts/governance/run-release-suites.js` manual, não. Como o spawn do Jest herda
 * `process.env`, o RESULTADO das suítes dependia de quem invocava o runner — e nada registrava
 * qual dos dois regimes rodou. O caso concreto: o probe live do Qwen resolvia credencial pelo
 * ambiente (ou não) conforme a invocação, e a classificação do requisito acabava sendo um texto
 * declarado em vez de medição.
 *
 * Os scripts de governança do projeto usam `--env-file-if-exists=.env` pelo mesmo motivo. Aqui a
 * leitura é explícita para que o runner seja o mesmo objeto independentemente da invocação.
 */
function loadEnvFile() {
  return loadEnvFileFromLib(ROOT);
}

/** Traduz o resultado do Jest para os estados canônicos do manifesto. */
function mapSuiteResult(testResult) {
  // DEFEITO REAL medido em 2026-09-25: a primeira versão lia `numTotalTests` NO NÍVEL DA SUÍTE.
  // No relatório JSON do Jest esse campo existe apenas na RAIZ (`json.numTotalTests`); por suíte o
  // que existe é `assertionResults[]`. Resultado do erro: TODAS as 24 suítes apareciam como
  // "executou ZERO testes" — ou seja, o gate teria reprovado uma execução 100% verde (falso
  // negativo) e, com a checagem invertida, poderia ter aprovado suítes vazias (falso positivo).
  const assertionResults = Array.isArray(testResult.assertionResults) ? testResult.assertionResults : [];
  const testsExecuted = assertionResults.length || Number(testResult.numTotalTests || 0);
  const failed = assertionResults.filter((a) => a.status === 'failed').length
    + Number(testResult.numRuntimeErrorTestSuites || 0)
    + (assertionResults.length === 0 && testResult.status === 'failed' ? 1 : 0);
  // FALSO POSITIVO REAL corrigido em 2026-09-25: a detecção varria `JSON.stringify(assertionResults)`,
  // que inclui o TÍTULO de cada teste. A própria suíte que testa este mapeador tem casos com a
  // palavra "INFRA_ERROR" no título — e a suíte inteira passou a ser classificada como
  // INFRA_ERROR, reprovando uma execução verde. É a mesma classe de defeito que o
  // anti-greenwashing já resolve com `isFixtureOrStringLine`: dado não é mecanismo.
  // Correção: olhar apenas MENSAGENS DE FALHA (estrutura), nunca o texto do título.
  const failureText = [
    testResult.status === 'failed' ? (testResult.message || '') : '',
    ...assertionResults.flatMap((a) => (Array.isArray(a.failureMessages) ? a.failureMessages : [])),
  ].join('\n');
  const infraError = /INFRA_ERROR/.test(failureText);
  const skipped = assertionResults.filter((a) => a.status === 'pending' || a.status === 'todo').length;
  const onlySkipped = testsExecuted > 0 && skipped === testsExecuted;

  let state;
  let reason = null;
  if (infraError) {
    state = 'INFRA_ERROR';
    reason = 'infraestrutura obrigatória ausente (RELEASE_AUTHORITATIVE exige falha explícita)';
  } else if (failed > 0 || testResult.status === 'failed') {
    state = 'FAIL';
    reason = `${failed} teste(s) falharam`;
  } else if (testsExecuted === 0) {
    state = 'FAIL';
    reason = 'suíte executou ZERO testes';
  } else if (onlySkipped) {
    state = 'NOT_EXECUTED';
    reason = `todos os ${testsExecuted} teste(s) foram pulados — não conta como cobertura`;
  } else {
    state = 'PASS';
  }

  return { state, testsExecuted, failed, skipped, reason };
}

/**
 * Executa o manifesto em LOTES.
 *
 * DEFEITO REAL medido em 2026-09-25: a primeira versão rodava TODAS as suítes numa única invocação
 * do Jest e caía em `EXECUTION_REPORT_MISSING` — o Jest saía com código 1 sem NUNCA escrever o
 * relatório JSON, e o erro real ficava invisível (o runner não preservava o stderr). Uma suíte capaz
 * de derrubar o processo (e o manifesto inclui suítes de crash real com SIGKILL) apaga a coleta
 * inteira.
 *
 * Em lotes: o que já foi coletado SOBREVIVE, o lote que falhou é identificado com a saída real do
 * Jest, e nenhuma suíte ausente é contada como PASS (vira NOT_EXECUTED explícito).
 */
/**
 * DIRETÓRIO DO RELATÓRIO POR LOTE — artefato de TRANSPORTE, fora de `reports/`.
 *
 * DEFEITO REAL medido em 2026-10-02 (duas execuções seguidas): o JSON do lote era gravado em
 * `reports/` e CHEGAVA AUSENTE na leitura do runner (lote 2: `exit=1`, `json=NULL`), embora o
 * mesmo comando, rodado à mão com o mesmo `--outputFile`, escrevesse o arquivo normalmente. A
 * consequência era pior que a falha: o runner degradava as SEIS suítes do lote para
 * `MANIFEST_SUITE_NOT_EXECUTED` e o erro real — `RUNTIME-EVIDENCE_UNAVAILABLE`, que nomeia o
 * requisito e o remédio — desaparecia do relatório agregado. Uma falha real disfarçada de "não
 * executada" esconde causa e resultado ao mesmo tempo.
 *
 * `reports/` é diretório GOVERNADO: outros componentes (higiene de release, runtime:clean)
 * podam estado transitório ali, e este transporte não pode competir com quem limpa. Em
 * `os.tmpdir()` ele é o que sempre foi — canal entre dois processos.
 *
 * `RELEASE_SUITE_BATCH_DIR` permite apontar para diretório persistente quando se quer a retomada
 * por `RELEASE_SUITES_REUSE_BATCHES=1` entre invocações distintas.
 */
function batchReportDir() {
  const override = String(process.env.RELEASE_SUITE_BATCH_DIR || '').trim();
  return override || path.join(os.tmpdir(), 'r-agent2-release-suites');
}

// ── CONTRATO DE REUSO DE LOTE (Fase 6) ──────────────────────────────────────────
//
// DEFEITO MEDIDO (2026-10-11): o reuso era `if (reuse && fs.existsSync(outputFile))`
// — reusava QUALQUER relatório de lote já presente, inventava `exitCode: 0` e não
// conferia absolutamente nada. Com `RELEASE_SUITES_REUSE_BATCHES=1`, um relatório
// de um COMMIT ANTERIOR (todas as suítes verdes) sustentava uma execução nova: o
// falso verde clássico de reutilização de evidência incompatível — e o relatório
// agregado ainda dizia quantas suítes passaram.
//
// Agora a evidência só é reusada quando o BINDING confere com a execução atual:
// runId, sourceCommit, sourceFingerprint, plano de suítes e hash do próprio
// resultado. Sem sidecar de binding (ou sem run governado) NÃO reusa — fail-closed:
// evidência sem procedência verificável é reexecutada, não presumida.
const CURRENT_RUN_RELATIVE_PATH = 'governance/.current-run.json';

function batchMetaPath(batchIndex) {
  return path.join(batchReportDir(), `batch-${batchIndex}.meta.json`);
}

/** Identidade do source atual (a mesma que o resto da governança usa). */
function currentBuildIdentity() {
  try {
    const run = JSON.parse(fs.readFileSync(path.join(ROOT, CURRENT_RUN_RELATIVE_PATH), 'utf8'));
    return {
      runId: run.runId || null,
      sourceCommit: run.sourceCommit || null,
      sourceFingerprint: run.sourceFingerprint || null,
    };
  } catch (_) {
    return { runId: null, sourceCommit: null, sourceFingerprint: null };
  }
}

function sha256De(texto) {
  return crypto.createHash('sha256').update(String(texto), 'utf8').digest('hex');
}

/** Fingerprint do PLANO do lote: quais suítes ele deve executar. */
function suitesFingerprint(suites) {
  return sha256De([...suites].sort().join('\n'));
}

/**
 * O lote já executado pode ser REUSADO para a execução atual?
 *
 * PURA de propósito (a decisão é a parte que já errou uma vez): recebe o sidecar,
 * a identidade atual, o plano de suítes e o hash do resultado em disco.
 *
 * @returns {{reuse: boolean, reason: string|null}}
 */
function avaliarReusoDeLote({ meta, identidade, suites, resultHash, resultExitCode } = {}) {
  if (!meta || typeof meta !== 'object') return { reuse: false, reason: 'META_MISSING' };
  if (!identidade || !identidade.runId || !identidade.sourceFingerprint) {
    return { reuse: false, reason: 'NO_GOVERNED_RUN' };
  }
  if (meta.runId !== identidade.runId) return { reuse: false, reason: 'RUN_MISMATCH' };
  if (meta.sourceCommit !== identidade.sourceCommit) return { reuse: false, reason: 'SOURCE_COMMIT_MISMATCH' };
  if (meta.sourceFingerprint !== identidade.sourceFingerprint) {
    return { reuse: false, reason: 'SOURCE_FINGERPRINT_MISMATCH' };
  }
  if (meta.suitesHash !== suitesFingerprint(suites)) return { reuse: false, reason: 'SUITE_PLAN_MISMATCH' };
  if (!resultHash || meta.resultHash !== resultHash) return { reuse: false, reason: 'RESULT_HASH_MISMATCH' };
  // CÓDIGO DE SAÍDA ORIGINAL (P0-6, medido 2026-10-16).
  //
  // O JSON do Jest é escrito ANTES do teardown, então um lote cujo PROCESSO morreu
  // depois — handle aberto, rejeição não tratada, `forceExit`, morte por sinal —
  // deixa um JSON todo verde com `status != 0`. A regra que pega exatamente isso na
  // execução NOVA (`collectBatchExitCodeViolations` → `BATCH_EXIT_CODE_NONZERO`)
  // isentava lote reusado, e o contrato de reuso conferia run, commit, fingerprint,
  // plano e hash do JSON — mas NUNCA o código real do processo, que o sidecar grava
  // em `exitCode` desde 2026-10-11. Resultado: o falso verde era propagado para o
  // run corrente, exatamente a classe que a Fase 6 existe para impedir.
  // Sidecar sem o campo (formato anterior) é recusado por fail-closed, não presumido
  // limpo. Não são aceitos atalhos por flag: a exigência é sobre o dado, não sobre
  // quem chamou.
  if (meta.exitCode !== 0) return { reuse: false, reason: 'ORIGINAL_EXIT_CODE_NONZERO' };
  // COERÊNCIA RELATÓRIO ↔ PROCESSO: os dois são exigidos e nenhum substitui o outro.
  // O processo prova que nada falhou depois dos testes (teardown, rejeição não tratada,
  // sinal); o relatório prova que os TESTES passaram. Um JSON com `success !== true`
  // não sustenta reuso, mesmo que o processo tenha saído 0.
  if (resultExitCode !== 0) return { reuse: false, reason: 'RESULT_REPORT_NOT_SUCCESS' };
  // `exitCode` sai daqui VALIDADO (=0): quem decide o reuso é quem pode atestá-lo,
  // e o chamador carrega esse valor real no lote em vez de derivá-lo do JSON.
  return { reuse: true, reason: null, exitCode: meta.exitCode };
}

/**
 * Exit code do lote REUSADO, derivado do relatório — nunca presumido.
 * O relatório do Jest declara `success`; confiar em `0` fixo transformava
 * "relatório reaproveitado" em "lote aprovado".
 */
function exitCodeDoRelatorioReusado(json) {
  if (!json || typeof json !== 'object') return 1;
  if (json.success === true) return 0;
  return 1;
}

function batchReportPath(batchIndex) {
  return path.join(batchReportDir(), `batch-${batchIndex}.json`);
}

/**
 * ARGUMENTOS DO LOTE — a POLÍTICA DE EXECUÇÃO do manifesto é declarada aqui.
 *
 * DEFEITO REAL medido em 2026-10-08: o `jest.config.cjs` traz `bail: 1` (comentado como "útil para
 * debug") e o runner não o desligava. Um lote de 6 suítes em que a 3ª falhava parava ali: o Jest
 * encerrava no primeiro teste falho e NÃO escrevia o `--outputFile`, então TODAS as 6 suítes do
 * lote viravam `MANIFEST_SUITE_NOT_EXECUTED`. Uma falha real (uma suíte) apagava a evidência de até
 * 5 suítes que sequer chegaram a rodar, e o relatório agregado dizia "não executada" em vez de
 * nomear o que falhou. Medido com as mesmas 6 suítes: com `bail: 1` → 3 de 6 suítes e relatório
 * AUSENTE; com `--bail=0` → 6 de 6 suítes e relatório PRESENTE.
 *
 * O manifesto autoritativo existe para executar TODAS as suítes declaradas. Abortar no primeiro
 * erro é conveniência de debug interativo, nunca política de gate — por isso a flag é explícita
 * AQUI, no ponto que produz a evidência, e não herdada de uma configuração de projeto.
 */
function buildJestArgs(suites, outputFile) {
  // Execução serial: as suítes autoritativas compartilham banco real e já se mostraram sensíveis a
  // contenção de recursos quando executadas em paralelo.
  return ['jest', ...suites, '--runInBand', '--no-coverage', '--bail=0', '--json', `--outputFile=${outputFile}`];
}

/**
 * ISOLAMENTO ENTRE LOTES — drenagem do pool de conexões.
 *
 * DEFEITO MEDIDO em 2026-10-11: o lote 3 do runner autoritativo falhou (2 suítes)
 * com `Error:` **SEM MENSAGEM** em `tests/helpers/purgeTestFindings.js:156`
 * (`Finding.destroy`), e as MESMAS 6 suítes, executadas isoladas
 * (`--runInBand --no-coverage --bail=0`), passaram: **6/6, 86 testes, 0 falhas**.
 *
 * Causa: suítes de integração deixam processos-filho (Engineering Runner / worker do
 * laço de bugs) e conexões abertas ao terminar. O Postgres tem
 * `max_connections=100`; medido em repouso o banco fica com ~9. Ao longo do run os
 * lotes acumulam conexões e o lote seguinte estoura o pool — e estouro de pool no
 * Sequelize se manifesta como erro VAZIO, que se confunde com "flake" e faz a
 * conclusão errada ("a suíte é instável") em vez da correta ("o lote herdou
 * conexões").
 *
 * Aqui esperamos o pool drenar entre lotes. É BOUNDED e NÃO-FATAL de propósito: se
 * não drenar no prazo, o run continua e o motivo fica registrado em
 * `connectionDrains` — nunca se converte a espera num PASS falso.
 */
function connectionProbeScript() {
  return `
    (async () => {
      const { Client } = require('pg');
      let dsn;
      try { dsn = process.env.DATABASE_URL || require(${JSON.stringify(
        require('path').join(ROOT, 'api', 'utils', 'config'),
      )}).getDatabaseUrl(); } catch (_) { dsn = process.env.DATABASE_URL; }
      if (!dsn) { process.stdout.write('unknown'); process.exit(0); }
      const c = new Client({ connectionString: dsn, connectionTimeoutMillis: 5000 });
      try {
        await c.connect();
        const r = await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()");
        process.stdout.write(String(r.rows[0].n));
      } catch (e) {
        process.stdout.write('unknown');
      } finally {
        await c.end().catch(() => {});
      }
    })();
  `;
}

function currentDbConnections() {
  const probe = spawnSync('node', ['-e', connectionProbeScript()], {
    cwd: ROOT, encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024,
  });
  const raw = String(probe.stdout || '').trim();
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

function awaitConnectionDrain({ threshold = 40, timeoutMs = Number(process.env.RELEASE_SUITES_DRAIN_TIMEOUT_MS || 180000) } = {}) {
  const startedAt = Date.now();
  const samples = [];
  let last = currentDbConnections();
  while (last !== null && last > threshold && Date.now() - startedAt < timeoutMs) {
    samples.push(last);
    spawnSync('sleep', ['2'], { encoding: 'utf8' });
    last = currentDbConnections();
  }
  return {
    drained: last !== null && last <= threshold,
    threshold,
    finalConnections: last,
    peakDuringWait: samples.length ? Math.max(...samples) : last,
    waitedMs: Date.now() - startedAt,
  };
}

// ── CEIFA DO GRUPO DO LOTE COM PROVA DE SAÍDA (Fase 6) ───────────────────────────
//
// `SIGTERM` NÃO é prova de que o processo morreu: o sinal pode ser ignorado, a
// suíte pode estar em estado não-interrompível e o grupo pode ter sobreviventes
// segurando conexões — exatamente o que envenena o lote seguinte. A versão anterior
// chamava isto de "reaped" apenas por ter ENVIADO o sinal, e o relatório não tinha
// como distinguir "morreu" de "recebeu o pedido".
//
// Aqui a ceifa é verificada: TERM -> confere quem sobrou -> KILL -> confere de novo,
// e o resultado (`exitProof`) vai para a evidência.
/**
 * Processos VIVOS do grupo (exclui zumbis).
 *
 * MEDIDO (2026-10-11): `ps -o pid= -g <pgid>` lista também processos em estado Z —
 * um filho morto que ainda não foi colhido pelo pai aparece como "sobrevivente" e
 * faria a ceifa declarar SURVIVORS com o grupo já morto (falso positivo que
 * esconderia a informação real). O estado vem do próprio `ps` (`stat`): `Z` = zumbi.
 */
/** Parse da saída de `ps -o pid=,stat=` — PURA, para a regra do zumbi ser testável. */
function parsePidsVivos(stdout) {
  return String(stdout || '')
    .split('\n')
    .map((linha) => String(linha).trim())
    .filter(Boolean)
    .map((linha) => {
      const [pid, stat] = linha.split(/\s+/);
      return { pid: Number(pid), zombie: String(stat || '').startsWith('Z') };
    })
    .filter((item) => Number.isInteger(item.pid) && item.pid > 0 && !item.zombie)
    .map((item) => item.pid);
}

function pidsNoGrupo(pgid) {
  const ps = spawnSync('ps', ['-o', 'pid=,stat=', '-g', String(pgid)], { encoding: 'utf8' });
  if (ps.status !== 0) return [];
  return parsePidsVivos(ps.stdout);
}

function esperarGrupoMorrer(pgid, timeoutMs) {
  const inicio = Date.now();
  let restantes = pidsNoGrupo(pgid);
  while (restantes.length > 0 && Date.now() - inicio < timeoutMs) {
    spawnSync('sleep', ['0.2'], { encoding: 'utf8' });
    restantes = pidsNoGrupo(pgid);
  }
  return restantes;
}

function ceifarGrupoDoLote(pgid, { termTimeoutMs = 8000, killTimeoutMs = 5000 } = {}) {
  const registro = {
    pgid,
    termEnviado: false,
    sobreviventesAposTerm: null,
    killEnviado: false,
    sobreviventesAposKill: null,
    exitProof: 'NONE',
  };
  if (!pgid) return registro;
  const inicial = pidsNoGrupo(pgid);
  if (inicial.length === 0) {
    // O grupo já não existe: a saída é provada por ausência, não por sinal.
    registro.sobreviventesAposTerm = 0;
    registro.exitProof = 'ALREADY_GONE';
    return registro;
  }
  try { process.kill(-pgid, 'SIGTERM'); registro.termEnviado = true; } catch (_) { /* já saiu */ }
  let restantes = esperarGrupoMorrer(pgid, termTimeoutMs);
  registro.sobreviventesAposTerm = restantes.length;
  if (restantes.length === 0) {
    registro.exitProof = 'TERM';
    return registro;
  }
  try { process.kill(-pgid, 'SIGKILL'); registro.killEnviado = true; } catch (_) { /* já saiu */ }
  restantes = esperarGrupoMorrer(pgid, killTimeoutMs);
  registro.sobreviventesAposKill = restantes.length;
  registro.sobreviventesPids = restantes.slice(0, 10);
  registro.exitProof = restantes.length === 0 ? 'KILL' : 'SURVIVORS';
  return registro;
}

function runJestBatch(suites, batchIndex) {
  const outputFile = batchReportPath(batchIndex);
  let reap = null;
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  if (fs.existsSync(outputFile)) fs.rmSync(outputFile, { force: true });
  const args = buildJestArgs(suites, outputFile);
  // A URL/TOKEN DO RUNNER NÃO SÃO HERDADOS DO AMBIENTE DO RUNNER DE SUÍTES.
  //
  // DEFEITO REAL MEDIDO (2026-10-20): o processo deste script roda com
  // `--env-file-if-exists=.env`, que define `ENGINEERING_RUNNER_URL=http://127.0.0.1:8090`
  // (endereço de dev). O `globalSetup` do Jest sobe o runner de TESTE em 8097 e exporta a
  // variável — mas qualquer subprocesso que não herde esse override (ou que recarregue o
  // `.env`) volta para 8090, onde nada escuta. Resultado medido: tasks de correção morriam em
  // `SANDBOX_UNAVAILABLE ... :8090: fetch failed` e a missão ia para BLOCKED, derrubando suítes
  // que passam isoladas. Quem define a URL do runner de teste é o globalSetup, nunca o `.env`.
  const batchEnv = { ...process.env, RELEASE_AUTHORITATIVE: process.env.RELEASE_AUTHORITATIVE || '1' };
  delete batchEnv.ENGINEERING_RUNNER_URL;
  delete batchEnv.ENGINEERING_RUNNER_TOKEN;
  // ORÇAMENTO DE CONEXÕES DO LOTE — o `.env` declara `DB_POOL_MAX=40` para a API de dev, e o
  // `applyJestDbBudgetToEnv` do `tests/setup.js` calcula a partir DELE. Medido em 2026-10-20: com a
  // API de dev segurando ~34 conexões e o manifesto inteiro rodando, o lote 4 morreu com
  // `SequelizeConnectionError: sorry, too many clients already` (max_connections=100) e a suíte
  // `engineeringBugLoop` — que abre conexões SIMULTÂNEAS no teste de dedup concorrente — caiu. Um
  // lote roda `--runInBand`: 40 conexões por suíte são desperdício, não necessidade. Aqui o teto do
  // lote passa a ser explícito e pequeno, e o orçamento do Jest o respeita (clampa, nunca infla).
  const declaredPool = Number.parseInt(process.env.RELEASE_SUITES_DB_POOL_MAX || '', 10);
  const batchPoolMax = Number.isFinite(declaredPool) && declaredPool > 0 ? declaredPool : 12;
  const inheritedPool = Number.parseInt(batchEnv.DB_POOL_MAX || '', 10);
  batchEnv.DB_POOL_MAX = String(
    Number.isFinite(inheritedPool) && inheritedPool > 0 ? Math.min(inheritedPool, batchPoolMax) : batchPoolMax,
  );
  const result = spawnSync('npx', args, {
    cwd: ROOT,
    env: batchEnv,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // Grupo de processos PRÓPRIO: permite ceifar o que o lote deixar vivo. Um lote que
    // termina (ou morre por timeout) pode deixar filhos segurando conexões do Postgres,
    // e é isso que envenena os lotes seguintes (ver `awaitConnectionDrain`).
    detached: true,
  });

  // CEIFA O GRUPO DO LOTE. Sem isto, filho órfão sobrevive ao lote e segue consumindo
  // o pool — a causa medida da falha do lote 3. Sinal negativo = grupo inteiro; o
  // `detached:true` acima garante que este grupo é só do lote (nunca o do pipeline).
  let reaped = false;
  if (result.pid) {
    // Prova de SAÍDA, não de intenção: TERM -> confere sobreviventes -> KILL ->
    // confere de novo. `reaped` só é verdadeiro quando o grupo de fato não existe
    // mais (ou já não existia).
    reap = ceifarGrupoDoLote(result.pid);
    reaped = reap.exitProof === 'TERM' || reap.exitProof === 'KILL' || reap.exitProof === 'ALREADY_GONE';
    if (reap.exitProof === 'SURVIVORS') {
      console.warn(`[release-suites] lote ${batchIndex}: ${reap.sobreviventesAposKill} processo(s) sobreviveram ao SIGKILL (pids ${(reap.sobreviventesPids || []).join(',')}) — o lote seguinte pode herdar conexões`);
    }
  }
  const raw = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : null;
  let json = null;
  let parseError = null;
  if (raw) {
    try {
      json = JSON.parse(raw);
    } catch (err) {
      parseError = err.message;
    }
  }
  // SIDECAR DE BINDING: é o que permite (ou proíbe) reusar esta evidência depois.
  // Sem ele, a reutilização é recusada por construção — evidência sem procedência
  // verificável não sustenta um run.
  try {
    const identidade = currentBuildIdentity();
    fs.writeFileSync(batchMetaPath(batchIndex), JSON.stringify({
      ...identidade,
      suitesHash: suitesFingerprint(suites),
      resultHash: raw ? sha256De(raw) : null,
      exitCode: result.status,
      signal: result.signal || null,
      generatedAt: new Date().toISOString(),
      outputFile,
    }, null, 2));
  } catch (err) {
    console.warn(`[release-suites] não foi possível gravar o binding do lote ${batchIndex}: ${err.message}`);
  }
  // LOG INTEGRAL DO LOTE QUE FALHOU — preservado em disco.
  //
  // DEFEITO DE AUDITORIA medido em 2026-10-20: quando um lote falhava, só restavam 40 linhas de
  // `stdoutTail`/`stderrTail` no relatório agregado. Suítes que fazem o diagnóstico impossível de
  // adivinhar imprimem blocos estruturados no stdout (ex.: `DIAG_NAO_FECHOU` de
  // `governanceApprovalFullWorkerE2E` com estado do finding, contrato da task e erro das
  // tentativas) — e eles eram DESCARTADOS exatamente no caso em que são necessários. O arquivo
  // abaixo é transporte/evidência de execução (tmpdir), não relatório governado.
  let stdoutLogPath = null;
  if (result.status !== 0) {
    try {
      stdoutLogPath = path.join(batchReportDir(), `batch-${batchIndex}.stdout.log`);
      fs.writeFileSync(stdoutLogPath, `${result.stdout || ''}\n--- STDERR ---\n${result.stderr || ''}`, 'utf8');
    } catch (err) {
      stdoutLogPath = null;
      console.warn(`[release-suites] não foi possível gravar o log do lote ${batchIndex}: ${err.message}`);
    }
  }
  return {
    suites,
    exitCode: result.status,
    signal: result.signal || null,
    spawnError: result.error ? result.error.message : null,
    reap,
    json,
    parseError,
    reportPath: outputFile,
    reportPresent: raw !== null,
    reportBytes: raw === null ? 0 : Buffer.byteLength(raw, 'utf8'),
    // Prova de que o grupo do lote foi ceifado (isola vazamento para o lote seguinte).
    processGroupReaped: reaped,
    // O stdout do Jest carrega o resumo (`Test Suites:`/`Tests:`) mesmo quando o JSON não chega;
    // preservá-lo é o que permite distinguir "falhou" de "não rodou" sem adivinhação.
    stdoutTail: (result.stdout || '').split('\n').slice(-40).join('\n'),
    stderrTail: (result.stderr || '').split('\n').slice(-40).join('\n'),
    // Caminho do log INTEGRAL (só existe para lote que falhou). `null` = nada a preservar.
    stdoutLogPath,
  };
}

/**
 * AGRUPAMENTO EM LOTES COM EXCLUSIVIDADE DECLARADA.
 *
 * DEFEITO REAL medido em 2026-10-02: `tests/helpers/purgeTestFindings.js` fundamenta sua segurança
 * numa premissa escrita em comentário — "as suítes do laço NÃO podem rodar em paralelo entre si" —
 * mas o agrupamento por tamanho fixo colocava TRÊS suítes de bug loop no MESMO lote. Como
 * `runBugLoopSweep` é GLOBAL e a posse por finding é um LEASE, um sweep vizinho reivindica o finding
 * e, ao terminar, deixa o lease preso até o TTL; o worker da suíte que ESPERA (a que prova autonomia)
 * só pula (`leaseSkipped`). Medido: `cycles: 115` sem retomada em 187 s, e depois 900 s sem fechar —
 * com a mesma suíte passando em 35-68 s isolada.
 *
 * A exclusividade passa a ser DECLARADA no manifesto (`execution.exclusiveGroups`), não presumida por
 * um comentário. O agrupamento continua sendo o mais cheio possível (não serializa tudo), mas nunca
 * coloca duas suítes do mesmo grupo no mesmo lote. Uma suíte pode pertencer a mais de um grupo.
 */
function buildExclusiveIndex(exclusiveGroups = []) {
  const groupsOf = new Map(); // suite -> Set(groupId)
  const groups = [];
  for (const group of Array.isArray(exclusiveGroups) ? exclusiveGroups : []) {
    const id = String((group && group.id) || '').trim();
    const suites = Array.isArray(group && group.suites) ? group.suites.filter(Boolean) : [];
    if (id === '' || suites.length < 2) continue; // um grupo de 1 não restringe nada
    const reason = String((group && group.reason) || '').trim();
    if (reason.length < 20) {
      throw new Error(`exclusiveGroups: o grupo "${id}" precisa de motivo com pelo menos 20 caracteres — restrição de concorrência sem justificativa é decisão invisível`);
    }
    groups.push({ id, suites, reason });
    for (const suite of suites) {
      if (!groupsOf.has(suite)) groupsOf.set(suite, new Set());
      groupsOf.get(suite).add(id);
    }
  }
  return { groups, groupsOf };
}

function batchPaths(suites, { exclusiveGroups = [] } = {}) {
  const batchSize = Math.max(1, Number(process.env.RELEASE_SUITE_BATCH_SIZE || 6));
  const { groups, groupsOf } = buildExclusiveIndex(exclusiveGroups);
  const batches = [];

  const groupsInBatch = (batch) => {
    const set = new Set();
    for (const suite of batch.suites) {
      for (const g of groupsOf.get(suite) || []) set.add(g);
    }
    return set;
  };

  for (const suite of suites) {
    const mine = groupsOf.get(suite) || new Set();
    // Primeiro lote com vaga e SEM conflito de grupo; senão, um lote novo.
    let target = null;
    for (const batch of batches) {
      if (batch.suites.length >= batchSize) continue;
      const taken = groupsInBatch(batch);
      let conflict = false;
      for (const g of mine) { if (taken.has(g)) { conflict = true; break; } }
      if (!conflict) { target = batch; break; }
    }
    if (!target) {
      target = { index: batches.length, suites: [] };
      batches.push(target);
    }
    target.suites.push(suite);
  }
  return { batches, groups };
}

/**
 * RETOMADA DECLARADA: com RELEASE_SUITES_REUSE_BATCHES=1 e os relatórios de lote já presentes, a
 * execução é REUSADA em vez de repetida. Existe porque uma execução real do manifesto leva ~25
 * minutos (suítes de crash/resume reais) e uma falha na MONTAGEM do relatório não pode obrigar a
 * reexecutar tudo. O relatório final registra `reusedBatches: true` — nunca é apresentado como
 * execução nova.
 */
/** Registro auditável das drenagens entre lotes (prova de isolamento). */
const drainRecords = [];

/**
 * Reusos RECUSADOS nesta execução: lote cuja evidência em disco não confere com o
 * run/source/plano atual. Fica no relatório final — reuso recusado é informação de
 * auditoria, não ruído (foi o silêncio aqui que produzia o falso verde).
 */
const reuseRejections = [];

function runJest(suites, { exclusiveGroups = [] } = {}) {
  const { batches, groups } = batchPaths(suites, { exclusiveGroups });
  const reuse = ['1', 'true'].includes(String(process.env.RELEASE_SUITES_REUSE_BATCHES || ''));
  const runs = [];
  for (const { index, suites: batch } of batches) {
    // ANTES de cada lote (exceto o primeiro), espera o pool drenar o que o lote
    // anterior deixou. Medido: sem isto o lote seguinte falha com `Error:` vazio em
    // chamadas Sequelize, e as mesmas suítes passam isoladas — o sintoma se
    // disfarça de "suíte instável".
    if (runs.length > 0) drainRecords.push(awaitConnectionDrain());
    const outputFile = batchReportPath(index);
    if (reuse && fs.existsSync(outputFile)) {
      const motivo = (() => {
        let raw = null;
        let json = null;
        try {
          raw = fs.readFileSync(outputFile, 'utf8');
          json = JSON.parse(raw);
        } catch (_) {
          return { reuse: false, reason: 'RESULT_UNREADABLE' };
        }
        let meta = null;
        try {
          meta = JSON.parse(fs.readFileSync(batchMetaPath(index), 'utf8'));
        } catch (_) {
          return { reuse: false, reason: 'META_MISSING' };
        }
        return avaliarReusoDeLote({
          meta,
          identidade: currentBuildIdentity(),
          suites: batch,
          resultHash: sha256De(raw),
          // Coerência relatório↔processo: derivado do `json.success` do lote.
          resultExitCode: exitCodeDoRelatorioReusado(json),
        });
      })();
      if (motivo.reuse) {
        const json = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        runs.push({
          suites: batch,
          // CÓDIGO REAL do processo original, já validado como 0 pelo contrato de
          // reuso (`motivo.exitCode`). Derivá-lo do `json.success` — como era antes —
          // apagava a única evidência de que o PROCESSO do lote terminou limpo.
          exitCode: motivo.exitCode,
          signal: null,
          spawnError: null,
          json,
          parseError: null,
          stderrTail: '',
          reused: true,
          reuseBinding: 'VERIFIED',
        });
        continue;
      }
      // Recusa registrada e VISÍVEL: o lote será executado de novo, e a razão
      // fica no relatório final (nada de reuso silencioso).
      reuseRejections.push({ batchIndex: index, suites: batch, reason: motivo.reason });
    }
    runs.push({ ...runJestBatch(batch, index), reused: false });
  }
  return runs;
}

function collectBatchResults(batchRuns) {
  const suites = {};
  const batchFailures = [];
  for (const [index, run] of batchRuns.entries()) {
    if (!run.json) {
      // Lote sem relatório: TODAS as suas suítes são NOT_EXECUTED (o loop seguinte marca cada uma)
      // e a causa real fica registrada — nunca um vazio mudo.
      batchFailures.push({
        batchIndex: index,
        suites: run.suites,
        exitCode: run.exitCode,
        signal: run.signal,
        spawnError: run.spawnError,
        parseError: run.parseError,
        reportPath: run.reportPath || null,
        reportPresent: run.reportPresent === true,
        reportBytes: run.reportBytes || 0,
        stdoutTail: run.stdoutTail || '',
        stderrTail: run.stderrTail,
      });
      continue;
    }
    for (const testResult of run.json.testResults || []) {
      const relative = path.relative(ROOT, testResult.name).split(path.sep).join('/');
      suites[relative] = mapSuiteResult(testResult);
    }
  }
  return { suites, batchFailures };
}

/**
 * Violações por PROCESSO imundo nos lotes da regressão (H1).
 *
 * DEFEITO CORRIGIDO (medido 2026-10-11): o exit code do lote era apenas REGISTRADO
 * (`batchExitCodes`) — nunca virava violação. Assim, um lote cujo PROCESSO terminava
 * != 0 mas cujo JSON listava tudo aprovado (erro de teardown/forceExit, rejeição não
 * tratada depois dos testes, morte por sinal) deixava o relatório agregado em `PASS`:
 * "JSON válido com testes aprovados não pode ocultar uma falha do processo" (Fase 6.1
 * da missão). O runner roda com `--bail=0` (ver buildJestArgs), então exit != 0 não
 * é ambiguidade de bail: é o processo dizendo que algo além dos testes falhou — e as
 * suítes seguintes do lote podem não ter rodado.
 *
 * Sem exceção por flag, de propósito: uma lista de exceções seria o mesmo defeito com
 * outro nome. Lotes já reportados como `BATCH_REPORT_MISSING` não são duplicados.
 *
 * SEM ISENÇÃO PARA LOTE REUSADO (P0-6, medido 2026-10-16): a isenção existia porque o
 * lote reusado declarava `exitCode` derivado do JSON — não havia código real para
 * conferir. Agora o contrato de reuso exige `exitCode === 0` do sidecar e o lote
 * carrega esse valor REAL, então a regra vale nos dois caminhos: se algum dia o
 * contrato voltar a deixar passar um processo sujo, esta varredura o pega.
 *
 * @param {{batchRuns?: Array, batchFailures?: Array}} input
 * @returns {Array<{code: string, batchIndex: number, detail: string}>}
 */
function collectBatchExitCodeViolations({ batchRuns, batchFailures } = {}) {
  const runs = Array.isArray(batchRuns) ? batchRuns : [];
  const failures = Array.isArray(batchFailures) ? batchFailures : [];
  const jaViolados = new Set(failures.map((failure) => failure && failure.batchIndex));
  const violacoes = [];
  runs.forEach((run, index) => {
    if (!run) return;
    if (jaViolados.has(index)) return;
    if (run.exitCode === 0) return;
    violacoes.push({
      code: 'BATCH_EXIT_CODE_NONZERO',
      batchIndex: index,
      detail: `lote terminou com exit=${run.exitCode === null || run.exitCode === undefined ? 'null (morto por sinal)' : run.exitCode}${run.signal ? ` signal=${run.signal}` : ''} — testes aprovados no JSON NÃO cancelam a falha do PROCESSO; reconheça a causa (drenagem, timeout, crash) antes de considerar a regressão válida`,
    });
  });
  return violacoes;
}

function main() {
  // BUG CLOSURE FIRST (2026-10-17): suíte autoritativa de release é L2.
  require('../../governance/bug-closure/require-eligibility')
    .exigirElegibilidade('L2_L3_EXTENSIVO', { actor: 'scripts/governance/run-release-suites.js' });

  const manifest = resolveManifest();
  // Determinismo do ambiente: o `.env` é carregado ANTES de qualquer suíte (ver `loadEnvFile`).
  const envFile = loadEnvFile();
  // LINEAGE NA ORIGEM: a execução autoritativa é a prova de RUNTIME que os demais gates consomem.
  // Sem runId/sourceFingerprint gravados AQUI, um relatório de outro run (ou de outro código) era
  // aceito como prova deste — gap medido em 2026-09-30 pelo binding do ciclo de bug
  // (EVIDENCE_LINEAGE_MISSING em reports/release-suite-execution.json).
  const { applyOriginLineage, resolveRunLineage } = require('./lib/resolve-run-lineage');
  const lineage = resolveRunLineage({ rootDir: ROOT });
  const report = applyOriginLineage({
    artifactType: 'release-suite-execution-report',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    manifestVersion: manifest.manifestVersion,
    manifestConfig: 'config/canonical-release-suites.json',
    authoritativeMode: process.env.RELEASE_AUTHORITATIVE === '1' || process.env.RELEASE_AUTHORITATIVE === 'true',
    // Prova de isolamento entre lotes: quantas conexões havia e quanto se esperou.
    connectionDrains: drainRecords,
    environment: { envFileLoaded: envFile.loaded, envFileKeys: envFile.keys, envFileNote: envFile.reason },
    status: 'FAIL',
    manifestViolations: manifest.violations,
    manifestViolationCount: manifest.violations.length,
    discovered: manifest.discovered.length,
    excluded: manifest.excluded.map((e) => ({ path: e.path, glob: e.glob, reason: e.reason })),
    suites: {},
    results: [],
    violations: [],
    violationCount: 0,
  }, lineage);

  if (!manifest.ok) {
    // Manifesto inconsistente = nada a executar com confiança. Fail-closed.
    report.violations = manifest.violations.map((v) => ({ code: v.code, suite: v.suite || null, detail: v.detail }));
    report.violationCount = report.violations.length;
    writeReport('release-suite-execution.json', report);
    console.error(`[release-suites] MANIFESTO INCONSISTENTE — ${report.violationCount} violação(ões)`);
    for (const v of report.violations) console.error(`  - ${v.code} :: ${v.suite || '(global)'} — ${v.detail}`);
    process.exit(1);
  }

  const batchRuns = runJest(manifest.authoritative, {
    // EXCLUSIVIDADE DECLARADA: suítes que compartilham runner/lease global (o laço de bugs) nunca
    // caem no mesmo lote. A restrição vem do MANIFESTO, com motivo — não de uma frase de comentário
    // num helper, que foi exatamente como o defeito passou despercebido.
    exclusiveGroups: (manifest.execution && manifest.execution.exclusiveGroups) || [],
  });
  const collected = collectBatchResults(batchRuns);
  report.suites = collected.suites;
  report.batchFailures = collected.batchFailures;
  report.batches = batchRuns.map((b) => ({ suites: b.suites.length, exitCode: b.exitCode, producedReport: Boolean(b.json), reused: Boolean(b.reused), reuseBinding: b.reuseBinding || null, reap: b.reap || null }));
  report.reusedBatches = batchRuns.some((b) => b.reused);
  // Reusos recusados: a evidência em disco não conferia com este run/source/plano.
  // Publicar é obrigatório — recusar em silêncio esconderia a reexecução do lote.
  report.reuseRejections = reuseRejections;

  // Cauda legível de uma saída de lote. MEDIDO (2026-10-05): com `--json --outputFile` o Jest manda
  // o resumo legível para o STDERR e o stdout fica legitimamente VAZIO. Reportar só o stdout fez a
  // violação dizer "(vazio)" enquanto a causa real (RUNTIME-EVIDENCE_UNAVAILABLE, por evidência de
  // runtime amarrada a sourceFingerprint antigo) estava apenas no stderr — a violação escondeu o
  // remédio. As duas caudas agora aparecem, nomeadas.
  const outputTail = (value) => (value || '').trim().split('\n').slice(-3).join(' | ') || '(vazio)';

  for (const failure of collected.batchFailures) {
    report.violations.push({
      code: 'BATCH_REPORT_MISSING',
      batchIndex: failure.batchIndex,
      suites: failure.suites,
      detail: `lote não produziu relatório do Jest (exit=${failure.exitCode}, signal=${failure.signal || 'null'}${failure.spawnError ? `, spawn=${failure.spawnError}` : ''}${failure.parseError ? `, parse=${failure.parseError}` : ''}; transporte=${failure.reportPath || 'desconhecido'}, presente=${failure.reportPresent === true}, bytes=${failure.reportBytes || 0}) — suítes marcadas NOT_EXECUTED; as caudas abaixo dizem se o lote ROU ou se falhou (com --json --outputFile o Jest escreve o resumo legível no STDERR): stdout=${outputTail(failure.stdoutTail)} | stderr=${outputTail(failure.stderrTail)}`,
    });
  }

  const evaluation = evaluateExecution(manifest, { suites: report.suites });
  report.results = evaluation.results;
  report.coverage = { covered: evaluation.covered, total: evaluation.total, ratio: evaluation.coverageRatio };
  report.states = evaluation.states;
  report.totals = {
    testsExecuted: Object.values(report.suites).reduce((acc, s) => acc + s.testsExecuted, 0),
    failedSuites: Object.values(report.suites).filter((s) => s.state === 'FAIL').length,
  };
  report.violations = [...report.violations, ...evaluation.violations];

  // Processo imundo do lote ⇒ violação (a regra vive em função pura testável).
  report.violations = [...report.violations, ...collectBatchExitCodeViolations({
    batchRuns,
    batchFailures: collected.batchFailures,
  })];

  report.violationCount = report.violations.length;
  report.batchExitCodes = batchRuns.map((b) => b.exitCode);
  report.status = report.violationCount === 0 ? 'PASS' : 'FAIL';

  writeReport('release-suite-execution.json', report);

  console.log(`[release-suites] status=${report.status} suites=${evaluation.covered}/${evaluation.total} testes=${report.totals.testsExecuted}`);
  if (report.status !== 'PASS') {
    for (const v of report.violations.slice(0, 25)) console.error(`  - ${v.code} :: ${v.suite || '(global)'}${v.detail ? ` — ${v.detail}` : ''}`);
    if (report.violations.some((v) => v.code === MANIFEST_VIOLATION_CODES.SUITE_NOT_IN_MANIFEST)) {
      console.error('  verifique config/canonical-release-suites.json (descoberta × manifesto)');
    }
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  mapSuiteResult, batchPaths, buildExclusiveIndex, buildJestArgs, collectBatchExitCodeViolations,
  avaliarReusoDeLote, suitesFingerprint, exitCodeDoRelatorioReusado, currentBuildIdentity,
  pidsNoGrupo, ceifarGrupoDoLote, parsePidsVivos,
};
