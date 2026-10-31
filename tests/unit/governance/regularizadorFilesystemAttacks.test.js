'use strict';

/**
 * FASE 2 / MISSÃO B — ATAQUES REAIS DE FILESYSTEM (symlink, TOCTOU, concorrência, durabilidade).
 *
 * Diferente das suítes da Fase 1 (que verificam CONTRATO), esta usa processos CONCORRENTES de
 * verdade: um escritor e um atacante rodando ao mesmo tempo, com arquivos-sentinela FORA da raiz
 * autorizada. O invariante medido não é "o código recusa o caso feliz de symlink", é:
 *
 *   - nenhum ataque escreve fora da raiz autorizada;
 *   - nenhum ataque altera arquivo-sentinela externo;
 *   - nenhuma prova válida é substituída por conteúdo incompatível;
 *   - manifesto `COMPLETED` nunca é produzido com artefatos incompletos;
 *   - resultado agregado integral nunca nasce de dados parciais;
 *   - evidência anterior nunca é corrompida em silêncio.
 *
 * MITIGAÇÕES QUE ESTES TESTES EXERCITAM (implementadas em `regularizationRun.js`):
 *   B-1 `fsync` do DIRETÓRIO (o `rename` pode ser perdido num crash sem ele);
 *   B-2 diretório PINADO por descritor (`/proc/self/fd/<fd>`) — trocar o nome do diretório não
 *       redireciona a escrita (elimina a classe TOCTOU de diretório no Linux; sem `/proc` resta a
 *       detecção pós-escrita, que RECUSA o sucesso);
 *   B-3 raiz privada (modo sem escrita para grupo/outros) — defesa preventiva contra outro usuário;
 *   B-4 criação exatamente-uma-vez do artefato (`link(2)`), com reexecução idempotente e recusa de
 *       conteúdo divergente (nunca "a última gravação vence").
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const runLib = require('../../../scripts/governance/lib/regularizationRun');
// ORÇAMENTO DE ESPERA, não expectativa de comportamento (defeito medido em 2026-10-26): cada teste
// desta suíte sobe processos FILHOS de verdade (`spawn`/`spawnSync`) e troca symlinks em janelas de
// tempo; com o timeout global de 10 s, o B2 estourou 10,404 s sob carga do lote e reprovou o L0 —
// passando em 316 ms isolado. 60 s ainda reprova um teste que trave de verdade; nenhuma asserção muda.
const { TIMEOUT_INTEGRATION_IO_MS } = require('../../helpers/jestTimeouts');
jest.setTimeout(TIMEOUT_INTEGRATION_IO_MS);

const BASE = path.join('AI_MEMORY', 'evidence', 'bug-closure-regularization');
const LIB = path.join(__dirname, '..', '..', '..', 'scripts', 'governance', 'lib', 'regularizationRun.js');
// Caminho da autoridade de inventário DERIVADO do repositório (nunca fixo no worktree do autor):
// um `require('/tmp/<worktree>')` commitado deixaria a suíte vermelha em qualquer outro clone.
const TRUSTED = path.join(__dirname, '..', '..', '..', 'governance', 'bug-closure', 'trusted-authorities.js');

const raiz = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p2b-'));

function inventarioNoRoot(root, ids = ['X1', 'X2']) {
  fs.mkdirSync(path.join(root, 'AI_MEMORY'), { recursive: true });
  const itens = ids.map((id) => ({ id, severity: 'P1', state: 'VERIFIED', status: 'prevention_active', title: id }));
  fs.writeFileSync(path.join(root, 'AI_MEMORY', 'hardening-queue.json'), JSON.stringify({ items: itens }, null, 2), 'utf8');
  return {
    digest: require('../../../governance/bug-closure/trusted-authorities').digestDoInventario(itens),
    queueSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'AI_MEMORY', 'hardening-queue.json'))).digest('hex'),
  };
}

function abrirRun(root, escopo) {
  const inf = inventarioNoRoot(root);
  return runLib.iniciar({
    rootDir: root,
    baseRel: BASE,
    commit: 'a'.repeat(40),
    sourceFingerprint: 'b'.repeat(64),
    inventoryFingerprint: inf.digest,
    hardeningQueueFingerprint: inf.queueSha256,
    testManifestFingerprint: 'd'.repeat(64),
    escopo: escopo || { tipo: 'PARCIAL', esperadoNoEscopo: 1 },
  });
}

const resultado = (id, extra = {}) => ({ id, severity: 'P1', classe: 'AGUARDA_ASSINATURA_E_ANCORA', teste: `t/${id}.test.js`, ...extra });

/** Sentinela FORA da raiz: qualquer escrita nela é escape. */
function sentinela() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2b-sentinela-'));
  const arquivo = path.join(dir, 'sentinela.txt');
  fs.writeFileSync(arquivo, 'INTOCAVEL\n', { mode: 0o600 });
  return { dir, arquivo, hash: crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex') };
}

/** Script do ESCRITOR: processo separado, grava N resultados e devolve o resultado de cada um. */
const SCRIPT_ESCRITOR = `
const runLib = require(process.argv[1]);
const plano = JSON.parse(process.argv[2]);
const saida = [];
for (const item of plano.itens) {
  try {
    const r = plano.modo === 'manifesto'
      ? { ok: true, retorno: runLib.finalizar({ rootDir: plano.root, baseRel: plano.baseRel, runId: plano.runId }) }
      : runLib.gravarResultado({ rootDir: plano.root, baseRel: plano.baseRel, runId: plano.runId, resultado: item });
    saida.push({ id: item.id, ...r });
  } catch (e) {
    saida.push({ id: item.id, ok: false, motivo: String(e.message) });
  }
}
process.stdout.write(JSON.stringify(saida));
`;

/**
 * Script do ATACANTE: troca `itens/` (ou o diretório da execução) por symlink para a sentinela e
 * volta, repetidamente, ENQUANTO o escritor grava. Nada é simulado: rename+symlink reais.
 */
const SCRIPT_ATACANTE = `
const fs = require('fs');
const plano = JSON.parse(process.argv[1]);
const alvo = plano.alvo;
const guardado = plano.guardado;
let trocas = 0;
const fim = Date.now() + plano.ms;
while (Date.now() < fim) {
  try {
    fs.renameSync(alvo, guardado);
    fs.symlinkSync(plano.destinoSymlink, alvo);
    fs.unlinkSync(alvo);
    fs.renameSync(guardado, alvo);
    trocas += 1;
  } catch (_) { /* corrida perdida: o escritor pode estar usando; segue tentando */ }
}
process.stdout.write(String(trocas));
`;

function rodarEscritor(plano, envExtra = {}) {
  const r = spawnSync(process.execPath, ['-e', SCRIPT_ESCRITOR, LIB, JSON.stringify(plano)], {
    encoding: 'utf8', timeout: 120000, env: { ...process.env, ...envExtra },
  });
  if (r.status !== 0 && !r.stdout) throw new Error(`escritor falhou: ${r.status} ${r.stderr}`);
  return JSON.parse(r.stdout || '[]');
}

function rodarAtacante(plano) {
  const r = spawnSync(process.execPath, ['-e', SCRIPT_ATACANTE, JSON.stringify(plano)], { encoding: 'utf8', timeout: 120000 });
  return Number(String(r.stdout || '0').trim()) || 0;
}

/** Arquivos de artefato presentes em `dir` (ignora temporários, que não terminam em `.json`). */
const artefatos = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : []);

/**
 * INTERCEPTAÇÃO DETERMINÍSTICA DA JANELA DE CORRIDA (executada em processo filho para não
 * contaminar `fs` do processo do Jest). O atacante "vence" no syscall exato:
 *   janela `antes`  — troca o nome do diretório ANTES de ele ser aberto;
 *   janela `depois` — troca o nome DEPOIS de o diretório já estar aberto.
 * A escrita é real: o kernel executa. O que se mede é se ela ATERRISSA fora da raiz.
 */
const SCRIPT_JANELA = `
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const [LIB, BASE, JANELA, TRUSTED] = process.argv.slice(1);
const lib = require(LIB);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'janela-'));
fs.mkdirSync(path.join(root, 'AI_MEMORY'), { recursive: true });
const fila = [{ id: 'X1', severity: 'P1', state: 'VERIFIED', status: 'prevention_active', title: 'X1' }];
fs.writeFileSync(path.join(root, 'AI_MEMORY', 'hardening-queue.json'), JSON.stringify({ items: fila }));
const { digestDoInventario } = require(TRUSTED);
const queueSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'AI_MEMORY', 'hardening-queue.json'))).digest('hex');
const run = lib.iniciar({ rootDir: root, baseRel: BASE, commit: 'a'.repeat(40), sourceFingerprint: 'b'.repeat(64),
  inventoryFingerprint: digestDoInventario(fila), hardeningQueueFingerprint: queueSha, testManifestFingerprint: 'd'.repeat(64),
  escopo: { tipo: 'PARCIAL', esperadoNoEscopo: 1 } });
const sen = fs.mkdtempSync(path.join(os.tmpdir(), 'janela-sen-'));
fs.writeFileSync(path.join(sen, 'sentinela.txt'), 'INTOCAVEL\\n');
const alvo = path.join(run.dir, 'itens');
const guardado = path.join(run.dir, 'itens-bkp');
const trocar = () => { fs.renameSync(alvo, guardado); fs.symlinkSync(sen, alvo); };
const openOriginal = fs.openSync;
let armado = true;
fs.openSync = function (alvoPath, flags, mode) {
  const p = String(alvoPath);
  const dispara = JANELA === 'antes' ? p === alvo : (p.startsWith('/proc/') || p.startsWith(alvo + path.sep));
  if (armado && dispara) { armado = false; trocar(); }
  return openOriginal.call(fs, alvoPath, flags, mode);
};
let retorno;
try {
  retorno = lib.gravarResultado({ rootDir: root, baseRel: BASE, runId: run.runId, resultado: { id: 'Y1', severity: 'P1', classe: 'X', teste: 't/Y1' } });
} catch (e) { retorno = { ok: false, motivo: String(e.message) }; }
fs.openSync = openOriginal;
process.stdout.write(JSON.stringify({
  janela: JANELA,
  ataqueDisparado: !armado,
  retorno: retorno.ok === true ? 'SUCESSO' : String(retorno.motivo),
  escaparam: fs.readdirSync(sen).filter((f) => f !== 'sentinela.txt'),
  noInodeLegitimo: fs.existsSync(guardado) ? fs.readdirSync(guardado).filter((f) => f.endsWith('.json')) : [],
}));
`;

function rodarJanela(janela) {
  const r = spawnSync(process.execPath, ['-e', SCRIPT_JANELA, LIB, BASE, janela, TRUSTED], { encoding: 'utf8', timeout: 60000 });
  if (!r.stdout) throw new Error(`filho falhou (${janela}): ${r.status} ${r.stderr}`);
  return JSON.parse(r.stdout);
}

describe('P2-B — ataques de filesystem com processos concorrentes', () => {
  const raizes = [];
  afterAll(() => { for (const r of raizes) fs.rmSync(r, { recursive: true, force: true }); });
  const novaRaiz = () => { const r = raiz(); raizes.push(r); return r; };

  test('B1 — troca do diretório `itens/` por symlink ANTES da gravação é recusada', () => {
    const root = novaRaiz();
    const sen = sentinela();
    raizes.push(sen.dir);
    const run = abrirRun(root);
    const itens = path.join(run.dir, 'itens');
    fs.rmSync(itens, { recursive: true, force: true });
    fs.symlinkSync(sen.dir, itens);

    const r = runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: run.runId, resultado: resultado('X1') });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('ITENS_E_SYMLINK');
    expect(fs.readdirSync(sen.dir)).toEqual(['sentinela.txt']);
    expect(crypto.createHash('sha256').update(fs.readFileSync(sen.arquivo)).digest('hex')).toBe(sen.hash);
  });

  test('B2 — troca REPETIDA de symlink durante a gravação: nada escapa para a sentinela', async () => {
    const root = novaRaiz();
    const sen = sentinela();
    raizes.push(sen.dir);
    const run = abrirRun(root);
    const itens = path.join(run.dir, 'itens');
    const guardado = path.join(run.dir, 'itens-guardado');

    const atacante = spawn(process.execPath, ['-e', SCRIPT_ATACANTE, JSON.stringify({ alvo: itens, guardado, destinoSymlink: sen.dir, ms: 4000 })], { stdio: 'ignore' });
    const itensDoPlano = ['X1', 'X2', 'X3', 'X4', 'X5', 'X6'].map((id) => resultado(id));
    const retornos = rodarEscritor({ root, baseRel: BASE, runId: run.runId, itens: itensDoPlano });

    // ESPERAR O ATACANTE MORRER ANTES DE ASSERTAR (flake medida 2026-10-29, run 40853040259):
    // `kill('SIGKILL')` é ASSÍNCRONO — sem aguardar o `exit`, o atacante pode executar mais uma
    // troca de diretório entre o kill e as asserções, movendo `itens/` (com os arquivos já gravados)
    // para `itens-guardado/`. A invariante 2 então via `existsSync(retorno.abs) === false` e falhava
    // num cenário que NÃO é fuga: nada foi para a sentinela (invariante 1 continuava válida) e nada
    // saiu da raiz. O mesmo SHA passou no re-run. Nenhuma asserção é afrouxada aqui: o que muda é
    // que o processo concorrente termina ANTES da verificação, eliminando a janela de corrida.
    await new Promise((resolve) => {
      if (atacante.exitCode !== null || atacante.signalCode !== null) { resolve(); return; }
      const encerrar = setTimeout(() => { try { atacante.kill('SIGKILL'); } catch { /* já morto */ } resolve(); }, 5000);
      atacante.once('exit', () => { clearTimeout(encerrar); resolve(); });
      atacante.kill('SIGKILL');
    });

    // Invariante 1: a sentinela não recebeu NADA (nem artefato, nem temporário).
    expect(fs.readdirSync(sen.dir)).toEqual(['sentinela.txt']);
    expect(crypto.createHash('sha256').update(fs.readFileSync(sen.arquivo)).digest('hex')).toBe(sen.hash);
    // Invariante 2: toda gravação reportada como sucesso é verificável DENTRO da raiz.
    for (const retorno of retornos.filter((x) => x.ok)) {
      expect(fs.existsSync(retorno.abs)).toBe(true);
      expect(fs.realpathSync(retorno.abs).startsWith(fs.realpathSync(root))).toBe(true);
    }
    // Invariante 3: nada "sumiu em silêncio" — cada id tem sucesso OU motivo explícito.
    for (const retorno of retornos) {
      expect(retorno.ok === true || typeof retorno.motivo === 'string').toBe(true);
      if (!retorno.ok) expect(retorno.motivo.length).toBeGreaterThan(0);
    }
    fs.rmSync(guardado, { recursive: true, force: true });
  }, 120000);

  test('B2b — janela ANTES da abertura: nome do diretório trocado ⇒ gravação RECUSADA', () => {
    const r = rodarJanela('antes');
    expect(r.ataqueDisparado).toBe(true);
    expect(r.escaparam).toEqual([]);
    expect(r.retorno).toMatch(/DIR_NAO_E_DIRETORIO|ITENS_E_SYMLINK|DESTINO_FORA/);
  });

  test('B2c — janela DEPOIS da abertura: escrita fica no INODE aberto e o resultado é FALHA', () => {
    // Antes da mitigação (HEAD de 29a41bcdf~1) este cenário ESCREVIA `Y1.json` no diretório da
    // sentinela e ainda reportava SUCESSO — reproduzido e registrado no relatório da Fase 2.
    const r = rodarJanela('depois');
    expect(r.ataqueDisparado).toBe(true);
    expect(r.escaparam).toEqual([]);
    expect(r.retorno).toBe('DIR_TROCADO_DURANTE_ESCRITA');
    expect(r.noInodeLegitimo).toContain('Y1.json');
  });

  test('B3 — substituição de diretório ANCESTRAL da execução é recusada nas duas pontas', () => {
    const root = novaRaiz();
    const sen = sentinela();
    raizes.push(sen.dir);
    const run = abrirRun(root);
    const dirDoRunReal = fs.realpathSync(run.dir);

    // Ancestral `runs/` trocado por symlink: tanto leitura quanto escrita recusam.
    const runs = path.dirname(run.dir);
    fs.renameSync(runs, `${runs}-guardado`);
    fs.symlinkSync(sen.dir, runs);

    expect(runLib.lerManifesto(root, BASE, run.runId)).toBeNull();
    const r = runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: run.runId, resultado: resultado('X1') });
    expect(r.ok).toBe(false);
    expect(fs.readdirSync(sen.dir)).toEqual(['sentinela.txt']);

    fs.unlinkSync(runs);
    fs.renameSync(`${runs}-guardado`, runs);
    expect(fs.realpathSync(run.dir)).toBe(dirDoRunReal);
  });

  test('B3b — troca do diretório ANCESTRAL da BASE (achado 2 da revisão): nada é escrito no alvo', () => {
    // Medido pela revisão independente: `dirDaExecucao` comparava `realBase` com ele mesmo, então
    // trocar `AI_MEMORY/evidence/bug-closure-regularization` por um symlink para fora fazia
    // `gravarResultado` gravar no alvo do atacante e RETORNAR `{ok:true}`. Âncora agora é
    // `realpath(rootDir)`: a base re-resolvida tem de ser exatamente `<realRaiz>/<baseRel>`.
    const root = novaRaiz();
    const sen = sentinela();
    raizes.push(sen.dir);
    const run = abrirRun(root);
    const base = path.join(root, BASE);
    const guardado = path.join(root, 'base-guardada');

    // O atacante prepara o alvo com a estrutura esperada e troca a base por symlink.
    fs.mkdirSync(path.join(sen.dir, 'runs', run.runId, 'itens'), { recursive: true });
    fs.renameSync(base, guardado);
    fs.symlinkSync(sen.dir, base);

    const r = runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: run.runId, resultado: resultado('X1') });
    expect(r.ok).toBe(false);
    expect(String(r.motivo)).toMatch(/BASE_FORA_DA_RAIZ|ITENS_E_SYMLINK|DIR_NAO_E_DIRETORIO|RUN_DIR_E_SYMLINK/);
    // Nenhum artefato novo no alvo do atacante e a sentinela intacta.
    expect(fs.readdirSync(path.join(sen.dir, 'runs', run.runId, 'itens'))).toEqual([]);
    expect(crypto.createHash('sha256').update(fs.readFileSync(sen.arquivo)).digest('hex')).toBe(sen.hash);
    expect(runLib.lerManifesto(root, BASE, run.runId)).toBeNull();

    fs.unlinkSync(base);
    fs.renameSync(guardado, base);
  });

  test('B3c — SEM `/proc` (plataforma sem primitiva): escrita RECUSADA, nada escapa (missão B)', () => {
    // Antes: `PIN_INDISPONIVEL` caía em caminho textual (escreve e só DEPOIS detecta) — detecção
    // não é prevenção e o efeito externo já teria ocorrido. Agora é recusa explícita.
    const root = novaRaiz();
    const sen = sentinela();
    raizes.push(sen.dir);
    const run = abrirRun(root);
    const itens = path.join(run.dir, 'itens');
    expect(fs.existsSync(itens)).toBe(true);

    const saida = rodarEscritor({
      root, baseRel: BASE, runId: run.runId, itens: [resultado('X1'), resultado('X2')],
    }, { RAP_SECURE_FS_FORCE_NO_PROC: '1', NODE_ENV: 'test' });

    expect(saida).toHaveLength(2);
    for (const retorno of saida) {
      expect(retorno.ok).toBe(false);
      expect(retorno.motivo).toBe('UNSUPPORTED_SECURE_FILESYSTEM:PIN_INDISPONIVEL');
    }
    // Nenhum artefato criado, nenhuma escrita externa, nenhum sucesso falso.
    expect(artefatos(itens)).toEqual([]);
    expect(fs.readdirSync(sen.dir)).toEqual(['sentinela.txt']);
    expect(crypto.createHash('sha256').update(fs.readFileSync(sen.arquivo)).digest('hex')).toBe(sen.hash);
    // E o FECHAMENTO também recusa quando não há primitiva (o manifesto não pode ser reescrito):
    const fechamento = spawnSync(process.execPath, ['-e', `
      const runLib = require(process.argv[1]);
      const [root, baseRel, runId] = process.argv.slice(2);
      let r;
      try { r = runLib.finalizar({ rootDir: root, baseRel, runId }); } catch (e) { r = { ok: false, motivo: String(e.message) }; }
      process.stdout.write(JSON.stringify(r));
    `, LIB, root, BASE, run.runId], {
      encoding: 'utf8',
      env: { ...process.env, RAP_SECURE_FS_FORCE_NO_PROC: '1', NODE_ENV: 'test' },
    });
    const f = JSON.parse(fechamento.stdout);
    expect(f.ok).toBe(false);
    expect(String(f.motivo)).toContain('UNSUPPORTED_SECURE_FILESYSTEM');
    // O manifesto em disco continua em RUNNING (nada foi reescrito sem primitiva segura).
    expect(runLib.lerManifesto(root, BASE, run.runId).status).toBe(runLib.STATUS.RUNNING);
  });

  test('B4 — destino substituído por symlink para a sentinela não é seguido', () => {
    const root = novaRaiz();
    const sen = sentinela();
    raizes.push(sen.dir);
    const run = abrirRun(root);
    const destino = path.join(run.dir, 'itens', 'X1.json');
    fs.symlinkSync(sen.arquivo, destino);

    const r = runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: run.runId, resultado: resultado('X1') });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('RESULTADO_E_SYMLINK');
    expect(crypto.createHash('sha256').update(fs.readFileSync(sen.arquivo)).digest('hex')).toBe(sen.hash);
  });

  test('B5 — duas gravações CONCORRENTES do mesmo id: exatamente uma vence e a divergente é recusada', () => {
    // Achado 5 da revisão independente: `spawnSync` duas vezes é execução SEQUENCIAL e
    // `oks.length >= 1` aceitaria dois vencedores — uma regressão para "a última gravação vence"
    // continuaria verde. Aqui os dois escritores sobem em paralelo (`spawn`) e a asserção exige
    // EXATAMENTE um sucesso.
    const { spawn } = require('child_process');
    const root = novaRaiz();
    const run = abrirRun(root);
    const planoA = { root, baseRel: BASE, runId: run.runId, itens: [resultado('X1', { classe: 'A' })] };
    const planoB = { root, baseRel: BASE, runId: run.runId, itens: [resultado('X1', { classe: 'B' })] };

    const disparar = (plano) => new Promise((resolve) => {
      const filho = spawn(process.execPath, ['-e', SCRIPT_ESCRITOR, LIB, JSON.stringify(plano)], { stdio: ['ignore', 'pipe', 'ignore'] });
      let saida = '';
      filho.stdout.on('data', (d) => { saida += d; });
      filho.on('close', () => { try { resolve(JSON.parse(saida)); } catch (_) { resolve([]); } });
    });
    const retornosPromise = Promise.all([disparar(planoA), disparar(planoB)]);
    return retornosPromise.then(([ra, rb]) => {
      const retornos = [...ra, ...rb];
      const oks = retornos.filter((x) => x.ok);
      const recusados = retornos.filter((x) => !x.ok);

      expect(oks).toHaveLength(1);
      // O conteúdo no disco é EXATAMENTE o do vencedor (nunca uma mistura dos dois).
      const disco = JSON.parse(fs.readFileSync(path.join(run.dir, 'itens', 'X1.json'), 'utf8'));
      expect(disco.artifactSha256).toBe(oks[0].sha256);
      expect(['A', 'B']).toContain(disco.classe);
      // O perdedor é recusado por divergência EXPLÍCITA — não por erro obscuro.
      expect(recusados).toHaveLength(1);
      expect(recusados[0].motivo).toBe('RESULTADO_JA_EXISTE_DIVERGENTE');
    });
  });

  test('B6 — reexecução IDEMPOTENTE do mesmo conteúdo é aceita e não altera a prova', () => {
    const root = novaRaiz();
    const run = abrirRun(root);
    const primeiro = runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: run.runId, resultado: resultado('X1') });
    expect(primeiro.ok).toBe(true);
    const hashAntes = crypto.createHash('sha256').update(fs.readFileSync(primeiro.abs)).digest('hex');

    const segundo = runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: run.runId, resultado: resultado('X1') });
    expect(segundo.ok).toBe(true);
    expect(segundo.idempotente).toBe(true);
    const hashDepois = crypto.createHash('sha256').update(fs.readFileSync(primeiro.abs)).digest('hex');
    expect(hashDepois).toBe(hashAntes);
  });

  test('B7 — tentativa de SOBRESCREVER o manifesto de outra execução não é aceita como sucesso', () => {
    const root = novaRaiz();
    const a = abrirRun(root);
    const b = abrirRun(root);
    const sen = sentinela();
    raizes.push(sen.dir);
    // Manifesto de A substituído por symlink para a sentinela: nem leitura nem gravação seguem.
    fs.unlinkSync(path.join(a.dir, 'manifest.json'));
    fs.symlinkSync(sen.arquivo, path.join(a.dir, 'manifest.json'));
    expect(runLib.lerManifesto(root, BASE, a.runId)).toBeNull();
    expect(() => runLib.finalizar({ rootDir: root, baseRel: BASE, runId: a.runId })).not.toThrow();
    expect(runLib.finalizar({ rootDir: root, baseRel: BASE, runId: a.runId }).ok).toBe(false);
    expect(crypto.createHash('sha256').update(fs.readFileSync(sen.arquivo)).digest('hex')).toBe(sen.hash);
    // A execução vizinha continua íntegra.
    expect(runLib.lerManifesto(root, BASE, b.runId).runId).toBe(b.runId);
    // A gravação no manifesto de B não pode produzir `completo` sem artefatos.
    const f = runLib.finalizar({ rootDir: root, baseRel: BASE, runId: b.runId });
    expect(f.ok).toBe(true);
    expect(f.manifesto.escopo.completo).toBe(false);
  });

  test('B8 — processo MORTO antes do rename não deixa artefato parcial nem manifesto truncado', () => {
    const root = novaRaiz();
    const run = abrirRun(root);
    const ok = runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: run.runId, resultado: resultado('X1') });
    expect(ok.ok).toBe(true);
    const manifestoAntes = fs.readFileSync(path.join(run.dir, 'manifest.json'), 'utf8');

    // Escritor morto por SIGKILL no meio da gravação de vários itens.
    const filho = spawn(process.execPath, ['-e', SCRIPT_ESCRITOR, LIB, JSON.stringify({
      root, baseRel: BASE, runId: run.runId, itens: Array.from({ length: 60 }, (_, i) => resultado(`Y${i}`)),
    })], { stdio: 'ignore' });
    setTimeout(() => { try { filho.kill('SIGKILL'); } catch (_) { /* já morto */ } }, 120);
    // Bloqueia até o processo morrer (síncrono no teste).
    const espera = spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1500)'], { timeout: 5000 });
    expect(espera.status).toBe(0);

    // Manifesto permanece VÁLIDO e em RUNNING (nada de estado meio-escrito).
    const manifesto = runLib.lerManifesto(root, BASE, run.runId);
    expect(manifesto).not.toBeNull();
    expect(manifesto.status).toBe(runLib.STATUS.RUNNING);
    expect(JSON.parse(manifestoAntes).runId).toBe(manifesto.runId);
    // Nenhum artefato parcial: todo `.json` presente é JSON válido com hash conferido.
    const lidos = runLib.lerResultados(root, BASE, run.runId);
    expect(lidos.ok).toBe(true);
    for (const item of lidos.resultados) expect(item.artifactSha256).toMatch(/^[0-9a-f]{64}$/);
    // A prova anterior continua íntegra e intocada.
    expect(JSON.parse(fs.readFileSync(ok.abs, 'utf8')).id).toBe('X1');
  }, 120000);

  test('B9 — recuperação após falha: nova execução completa e a anterior fica intacta', () => {
    const root = novaRaiz();
    const antiga = abrirRun(root);
    const r1 = runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: antiga.runId, resultado: resultado('X1') });
    const hashAntes = crypto.createHash('sha256').update(fs.readFileSync(r1.abs)).digest('hex');
    expect(runLib.finalizar({ rootDir: root, baseRel: BASE, runId: antiga.runId }).ok).toBe(true);

    const nova = abrirRun(root);
    const r2 = runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: nova.runId, resultado: resultado('X1', { teste: 'outro' }) });
    expect(r2.ok).toBe(true);
    expect(runLib.finalizar({ rootDir: root, baseRel: BASE, runId: nova.runId }).ok).toBe(true);

    // Isolamento: execuções distintas, artefatos distintos, prova antiga inalterada.
    expect(nova.runId).not.toBe(antiga.runId);
    expect(crypto.createHash('sha256').update(fs.readFileSync(r1.abs)).digest('hex')).toBe(hashAntes);
    expect(antiga.dir).not.toBe(nova.dir);
  });

  test('B10 — diretório somente-leitura falha com motivo explícito (nunca sucesso silencioso)', () => {
    const root = novaRaiz();
    const run = abrirRun(root);
    const itens = path.join(run.dir, 'itens');
    fs.chmodSync(itens, 0o500);
    try {
      const r = runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: run.runId, resultado: resultado('X1') });
      expect(r.ok).toBe(false);
      expect(String(r.motivo)).toMatch(/PIN_FALHOU|ESCRITA_FALHOU|EACCES|DESTINO_INACESSIVEL/);
      expect(artefatos(itens)).toEqual([]);
    } finally {
      fs.chmodSync(itens, 0o700);
    }
  });

  test('B11 — symlink dentro de `runs/` (diretório da execução) é recusado nas duas pontas', () => {
    const root = novaRaiz();
    const sen = sentinela();
    raizes.push(sen.dir);
    const runs = path.join(root, BASE, 'runs');
    fs.mkdirSync(runs, { recursive: true, mode: 0o700 });
    const runId = 'run-20260101000000-abcdef01';
    fs.symlinkSync(sen.dir, path.join(runs, runId));

    expect(runLib.lerManifesto(root, BASE, runId)).toBeNull();
    expect(() => runLib.dirDaExecucao(root, BASE, runId)).toThrow(/RUN_DIR_E_SYMLINK/);
    const r = runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId, resultado: resultado('X1') });
    expect(r.ok).toBe(false);
    expect(fs.readdirSync(sen.dir)).toEqual(['sentinela.txt']);
  });

  test('B12 — symlink dentro de `itens/` para sentinela não é lido como artefato válido', () => {
    const root = novaRaiz();
    const sen = sentinela();
    raizes.push(sen.dir);
    const run = abrirRun(root);
    runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: run.runId, resultado: resultado('X1') });
    // `X2.json` aponta para a sentinela externa (conteúdo não é JSON de resultado).
    fs.symlinkSync(sen.arquivo, path.join(run.dir, 'itens', 'X2.json'));

    const lidos = runLib.lerResultados(root, BASE, run.runId);
    // O artefato symlinkado NÃO entra como resultado válido (conteúdo não confere/não resolve).
    expect(lidos.resultados.map((x) => x.id)).not.toContain('X2');
    // E o fechamento não pode declarar cobertura integral com esse item presente.
    const f = runLib.finalizar({ rootDir: root, baseRel: BASE, runId: run.runId });
    if (f.ok) expect(f.manifesto.escopo.completo).toBe(false);
    expect(crypto.createHash('sha256').update(fs.readFileSync(sen.arquivo)).digest('hex')).toBe(sen.hash);
  });

  test('B13 — raiz com escrita para grupo/outros é recusada (defesa preventiva contra atacante local)', () => {
    const root = novaRaiz();
    const base = path.join(root, BASE);
    fs.mkdirSync(path.join(base, 'runs'), { recursive: true });
    fs.chmodSync(base, 0o777);
    try {
      expect(() => runLib.criarRaizPrivada(root, BASE)).toThrow(/RAIZ_PERMISSIVA/);
    } finally {
      fs.chmodSync(base, 0o700);
      fs.chmodSync(path.join(base, 'runs'), 0o700);
    }
    expect(() => runLib.criarRaizPrivada(root, BASE)).not.toThrow();
    expect(fs.statSync(base).mode & 0o022).toBe(0);
  });

  test('B14 — agregação recusa execução com artefato incompleto (nada de integral com dado parcial)', () => {
    const root = novaRaiz();
    const run = abrirRun(root, { tipo: 'PARCIAL', esperadoNoEscopo: 2 });
    runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: run.runId, resultado: resultado('X1') });
    runLib.finalizar({ rootDir: root, baseRel: BASE, runId: run.runId });
    const agregado = runLib.agregar({ rootDir: root, baseRel: BASE, runIds: [run.runId] });
    // A agregação de UMA execução parcial é permitida (dado é dado), mas nunca declara cobertura
    // integral: `completo` é recalculado a partir dos artefatos e do inventário real.
    expect(agregado.ok).toBe(true);
    expect(agregado.completo).toBe(false);
    expect(agregado.coberturaIntegral.motivo).toMatch(/não conferem|INVENTARIO_ILEGIVEL/);
    expect(agregado.escopo[0].completoNoEscopo).toBe(false);
    expect(agregado.escopo[0].processados).toBe(1);
    expect(JSON.stringify(agregado)).not.toMatch(/"completo":true/);
  });
});
