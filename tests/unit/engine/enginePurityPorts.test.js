'use strict';

/**
 * PROVA da correção DIV-PUREZA-ENGINE — pureza por INJEÇÃO, não por prosa.
 *
 * DEFEITO MEDIDO (2026-10-13): a `engine/` lia o ambiente DIRETO em 22 arquivos —
 * 31 `new Date()` + 25 `Date.now()` (57 leituras de relógio), além de `Math.random`,
 * `console`, `setTimeout`, `fs` e `process.cwd()`. A regra que deveria pegar isso
 * (`validate-layer-conventions`) era ao mesmo tempo IMPRECISA (acusava `new Date(x)`,
 * que é CONVERSÃO determinística — 16 falsos positivos) e INCOMPLETA (`Date.now()`
 * passava batido — 35 pontos cegos).
 *
 * CONSEQUÊNCIA REAL (não teórica): `createEngineEvent`, chamado em toda execução e
 * usado como base do replay, monta `id` com relógio + aleatório. O MESMO fluxo
 * executado duas vezes gerava ids diferentes, então dois replays do mesmo fluxo
 * divergiam sem causa no fluxo — o hash de replay deixava de ser comparável.
 *
 * O teste abaixo é escrito para FALHAR no código anterior: com `Date.now()` e
 * `Math.random()` lidos direto, não existe forma de congelá-los de fora, e as duas
 * chamadas de `createEngineEvent` nunca coincidem.
 *
 * As três partes cobrem: (a) as portas injetam e restauram; (b) o comportamento
 * determinístico que a injeção compra; (c) varredura INDEPENDENTE do relatório do
 * gate — se o gate for enfraquecido amanhã, este teste continua acusando.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ENGINE = path.join(ROOT, 'engine');

const clock = require(path.join(ENGINE, 'shared', 'clock'));
const rng = require(path.join(ENGINE, 'shared', 'random'));
const logPort = require(path.join(ENGINE, 'shared', 'logger'));
const timers = require(path.join(ENGINE, 'shared', 'scheduler'));
const fsPort = require(path.join(ENGINE, 'shared', 'fileSystem'));
const envPort = require(path.join(ENGINE, 'shared', 'runtimeEnv'));

const { createEngineEvent, nowIso } = require(path.join(ENGINE, 'utils'));
const { computeBackoffMs } = require(path.join(ENGINE, 'shared', 'executionDeadline'));

/** Portas: arquivos-ponte autorizados — a fronteira de ambiente, não regra de negócio. */
const PORTAS = [
  'engine/shared/clock.js',
  'engine/shared/random.js',
  'engine/shared/logger.js',
  'engine/shared/scheduler.js',
  'engine/shared/fileSystem.js',
  'engine/shared/runtimeEnv.js',
  // Pontes pré-existentes da mesma natureza (já autorizadas antes desta correção)
  'engine/ai/aiEnvelope.js',
  'engine/ai/aiEnvelopeSchema.js',
];

const PORTA_RE = new RegExp(`^(?:${PORTAS.map((p) => p.replace(/[.]/g, '\\.')).join('|')})$`);

function restaurarTodas() {
  clock.resetClockProvider();
  rng.resetRandomProvider();
  logPort.resetLoggerProvider();
  timers.resetSchedulerProvider();
  fsPort.resetFileReaderProvider();
  envPort.resetRuntimeEnvProvider();
}

/**
 * Remove comentários ANTES de procurar os padrões: um comentário que EXPLICA o
 * defeito (`// o engine NÃO usa new Date()`, `// antes era console.log`) não é
 * código. Sem isso a varredura acusa arquivo são — foi o que aconteceu na 1ª
 * versão deste teste com `fallbackController.js`, `flowTypes.js`,
 * `governance/pendenciesModel.js` e `engineeringMission/leasePolicy.js`.
 * O gate faz esse mesmo recorte; aqui ele é replicado de forma explícita.
 */
function semComentarios(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'`])\/\/.*$/gm, '$1');
}

function arquivosDeDominio() {
  return listarJs(ENGINE)
    .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
    .filter((f) => !PORTA_RE.test(f))
    .filter((f) => !/\.test\.js$/.test(f))
    .filter((f) => !/^engine\/__tests__\//.test(f));
}

function listarJs(dir) {
  const saida = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === 'node_modules') continue;
      saida.push(...listarJs(full));
    } else if (entrada.name.endsWith('.js')) {
      saida.push(full);
    }
  }
  return saida;
}

afterEach(restaurarTodas);

describe('portas de ambiente da engine — injeção e restauração', () => {
  test('clock: injetar congela o tempo; resetar volta ao relógio real', () => {
    const congelado = 1700000000000;
    clock.setClockProvider(() => congelado);
    expect(clock.hasInjectedClock()).toBe(true);
    expect(clock.nowMs()).toBe(congelado);
    expect(clock.nowIso()).toBe(new Date(congelado).toISOString());

    clock.resetClockProvider();
    expect(clock.hasInjectedClock()).toBe(false);
    expect(clock.nowMs()).toBeGreaterThan(congelado);
  });

  test('rng: injetar torna o aleatório reprodutível; default volta a variar', () => {
    rng.setRandomProvider(() => 0.5);
    expect(rng.random()).toBe(0.5);
    expect(rng.randomInt(10, 20)).toBe(15);
    expect(rng.chance(0.9)).toBe(true);

    rng.resetRandomProvider();
    expect(rng.hasInjectedRandom()).toBe(false);
    const amostras = new Set(Array.from({ length: 20 }, () => rng.random()));
    expect(amostras.size).toBeGreaterThan(1);
  });

  test('logger: injetar desvia o log e nada vai para o console', () => {
    const capturado = [];
    logPort.setLoggerProvider(() => ({
      log: (m) => capturado.push(['log', m]),
      warn: (m) => capturado.push(['warn', m]),
      error: (m) => capturado.push(['error', m]),
      debug: (m) => capturado.push(['debug', m]),
    }));
    logPort.info('a');
    logPort.warn('b');
    logPort.error('c');
    logPort.debug('d');
    expect(capturado).toEqual([['log', 'a'], ['warn', 'b'], ['error', 'c'], ['debug', 'd']]);
  });

  test('timers: injetar executa sem espera real (sem efeito pendente)', () => {
    const disparados = [];
    timers.setSchedulerProvider(() => ({
      setTimeout: (fn) => { fn(); return 1; },
      clearTimeout: () => {},
      setInterval: () => 1,
      clearInterval: () => {},
    }));
    const handle = timers.setTimeout(() => disparados.push('ok'), 600000);
    expect(disparados).toEqual(['ok']);
    expect(handle).toBe(1);
  });

  test('fileSystem: injetar substitui a leitura de disco', () => {
    fsPort.setFileReaderProvider(() => ({
      readFileSync: () => '{"allowed":["noop"]}',
      existsSync: () => true,
    }));
    expect(fsPort.readJsonSync('/caminho/que/nao/existe.json')).toEqual({ allowed: ['noop'] });
    expect(fsPort.existsSync('/qualquer')).toBe(true);
  });

  test('runtimeEnv: injetar substitui cwd/env (sem congelar valor no require)', () => {
    envPort.setRuntimeEnvProvider(() => ({
      cwd: () => '/tmp/porta',
      getEnv: (nome) => (nome === 'FLAG' ? 'false' : undefined),
    }));
    expect(envPort.cwd()).toBe('/tmp/porta');
    expect(envPort.isEnabledByDefault('FLAG')).toBe(false);
    expect(envPort.isEnabledByDefault('OUTRA')).toBe(true);
  });
});

describe('determinismo — o defeito que a impureza causava', () => {
  test('createEngineEvent produz id e timestamp IDÊNTICOS com as portas congeladas', () => {
    clock.setClockProvider(() => 1700000000000);
    rng.setRandomProvider(() => 0.123456);

    const base = { sessionId: 'sess-1', flowId: 'flow-1', type: 'NODE_ENTER' };
    const a = createEngineEvent(base);
    const b = createEngineEvent({ ...base });

    // Este é o defeito: antes, `id` vinha de Date.now() + Math.random() e as duas
    // execuções NUNCA coincidiam — dois replays do mesmo fluxo divergiam.
    expect(a.id).toBe(b.id);
    expect(a.timestamp).toBe(b.timestamp);
    expect(a).toEqual(b);
  });

  test('sem congelar, o id VARIA (o determinismo vem da porta, não de sorte)', () => {
    const base = { sessionId: 'sess-2', flowId: 'flow-2', type: 'NODE_ENTER' };
    const ids = new Set([
      createEngineEvent(base).id,
      createEngineEvent(base).id,
      createEngineEvent(base).id,
    ]);
    expect(ids.size).toBeGreaterThan(1);
  });

  test('nowIso() respeita o relógio injetado (não é mais imutável de fora)', () => {
    clock.setClockProvider(() => 1234567890123);
    expect(nowIso()).toBe(new Date(1234567890123).toISOString());
  });

  test('computeBackoffMs é reprodutível com o rng injetado', () => {
    rng.setRandomProvider(() => 0.25);
    const params = { attempt: 3, baseMs: 1000, multiplier: 2, jitterRatio: 0.2 };
    expect(computeBackoffMs(params)).toBe(computeBackoffMs(params));
  });
});

describe('anti-vacuidade — varredura INDEPENDENTE do relatório do gate', () => {
  test('nenhum módulo de domínio da engine lê ambiente direto', () => {
    const arquivos = arquivosDeDominio();

    expect(arquivos.length).toBeGreaterThan(100); // a varredura cobre a engine real

    const achados = [];
    for (const rel of arquivos) {
      const src = semComentarios(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
      if (/\bnew\s+Date\s*\(\s*\)/.test(src)) achados.push(`${rel}: new Date()`);
      if (/\bDate\.now\s*\(\s*\)/.test(src)) achados.push(`${rel}: Date.now()`);
      if (/(?<![.\w])Math\.random\b/.test(src)) achados.push(`${rel}: Math.random`);
      if (/(?<![.\w])(setTimeout|setInterval|setImmediate)\s*\(/.test(src)) achados.push(`${rel}: timer global`);
      if (/\bconsole\.(?:log|error|warn|info|debug)/.test(src)) achados.push(`${rel}: console direto`);
      if (/(?<![.\w])fs\./.test(src)) achados.push(`${rel}: fs.* direto`);
      if (/\bprocess\.(?!env\.NODE_ENV)/.test(src)) achados.push(`${rel}: process.* direto`);
      if (/\brequire\s*\(\s*['"](?:fs|http|https|net|dgram|child_process|process|os)['"]/.test(src)) {
        achados.push(`${rel}: require(fs/http/process)`);
      }
    }

    expect(achados).toEqual([]);
  });

  test('a regra distingue CONVERSÃO de LEITURA: há conversões no engine e nenhuma é acusada', () => {
    // Comportamental, não textual: `new Date(valor)` converte um dado JÁ CONHECIDO
    // (determinístico) e não deve ser acusado. Se a regra voltasse a ser
    // /\bnew\s+Date\b/, as conversões reais abaixo virariam acusação.
    const comConversao = arquivosDeDominio().filter((rel) =>
      /\bnew\s+Date\s*\(\s*[^)\s]/.test(semComentarios(fs.readFileSync(path.join(ROOT, rel), 'utf8')))
    );
    expect(comConversao.length).toBeGreaterThan(0);

    const relatorio = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'reports', 'layer-conventions-report.json'), 'utf8')
    );
    const acusados = (relatorio.issues || []).filter((i) => /new Date|Date\.now/.test(i.message || ''));
    expect(acusados).toEqual([]);
  });
});

