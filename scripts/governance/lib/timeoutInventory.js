'use strict';

/**
 * scripts/governance/lib/timeoutInventory.js
 *
 * Inventário machine-readable de TODOS os timeouts do repositório, com categoria
 * semântica explícita. Base do gate `validate:timeout-architecture`.
 *
 * Motivação (missão de hardening 2026-09-26): timeout de uma OPERAÇÃO não é
 * sinônimo de morte da MISSÃO. O sistema não pode decidir que uma task/mission
 * morreu apenas porque "passou tempo": liveness é heartbeat + lease + fence;
 * avanço é progresso significativo; deadline limita a OPERAÇÃO.
 *
 * Este módulo é PURO (sem I/O de rede, sem efeitos): recebe o conteúdo dos
 * arquivos e devolve o inventário. O runner faz a leitura do disco.
 */

/** Categorias canônicas. Nenhum timeout pode ficar semanticamente ambíguo. */
const TIMEOUT_CATEGORIES = Object.freeze({
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  OPERATION_DEADLINE: 'OPERATION_DEADLINE',
  COMMAND_DEADLINE: 'COMMAND_DEADLINE',
  DATABASE_TIMEOUT: 'DATABASE_TIMEOUT',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  LEASE_DURATION: 'LEASE_DURATION',
  HEARTBEAT_INTERVAL: 'HEARTBEAT_INTERVAL',
  NO_PROGRESS_TIMEOUT: 'NO_PROGRESS_TIMEOUT',
  RETRY_BACKOFF: 'RETRY_BACKOFF',
  POLL_INTERVAL: 'POLL_INTERVAL',
  TEST_TIMEOUT: 'TEST_TIMEOUT',
  SHUTDOWN_GRACE_PERIOD: 'SHUTDOWN_GRACE_PERIOD',
  /** Espera cooperativa (`sleep`) / cadência: NUNCA decide morte nem expira nada. */
  DELAY_SLEEP: 'DELAY_SLEEP',
  USER_DEFINED_DEADLINE: 'USER_DEFINED_DEADLINE',
  LEGACY_UNKNOWN_TIMEOUT: 'LEGACY_UNKNOWN_TIMEOUT',
});

/** Ação observada quando o timeout dispara. */
const EXPIRY_ACTIONS = Object.freeze({
  CANCEL_OPERATION: 'CANCEL_OPERATION',
  KILL_CHILD_PROCESS: 'KILL_CHILD_PROCESS',
  KILL_PARENT_PROCESS: 'KILL_PARENT_PROCESS',
  FAIL_TASK: 'FAIL_TASK',
  FAIL_MISSION: 'FAIL_MISSION',
  RETRY: 'RETRY',
  FALLBACK: 'FALLBACK',
  RECOVER: 'RECOVER',
  TAKE_OVER: 'TAKE_OVER',
  UNKNOWN: 'UNKNOWN',
});

/**
 * Regras de classificação. A ORDEM importa: a primeira que casar vence.
 * Cada regra casa contra `{ name, file, line, context }`.
 */
const CLASSIFICATION_RULES = Object.freeze([
  // --- liveness / ownership: nunca podem ser confundidos com deadline --------
  { id: 'lease', re: /lease/i, category: 'LEASE_DURATION' },
  { id: 'heartbeat', re: /heartbeat|heart_beat|hb_ms|_hb\b/i, category: 'HEARTBEAT_INTERVAL' },
  { id: 'no-progress', re: /no_?progress|maxNoProgress|stalenessProgress/i, category: 'NO_PROGRESS_TIMEOUT' },

  // --- infraestrutura ------------------------------------------------------
  { id: 'shutdown', re: /shutdown|graceful|grace_?period|sigterm|force_exit|forceExit/i, category: 'SHUTDOWN_GRACE_PERIOD' },
  { id: 'retry-backoff', re: /backoff|jitter|retryDelay|retry_delay|RETRY_MS|waitBeforeRetry/i, category: 'RETRY_BACKOFF' },
  { id: 'poll', re: /poll|interval_sec|intervalMs|tick|sweep|watchdogCheck/i, category: 'POLL_INTERVAL' },
  { id: 'test', re: /jest|vitest|testTimeout|TEST_TIMEOUT|suiteTimeout|hookTimeout/i, category: 'TEST_TIMEOUT' },
  { id: 'command', re: /command|spawn|exec|child|shell|npm_?test|regression/i, category: 'COMMAND_DEADLINE' },
  { id: 'database', re: /db|database|query|postgres|sequelize|pool|pg_|transaction|lock_timeout|statement_timeout|acquire/i, category: 'DATABASE_TIMEOUT' },
  { id: 'provider', re: /provider|openai|anthropic|claude|deepseek|kimi|qwen|gemini|llm|completion|chat_?model|ai_?timeout/i, category: 'PROVIDER_TIMEOUT' },
  { id: 'user-deadline', re: /user_?deadline|deadline_?at|dueAt|userDeadline|expiresAtUser/i, category: 'USER_DEFINED_DEADLINE' },
  { id: 'operation', re: /task|mission|phase|operation|run_?timeout|deadline|process|runtime|engine|job|node|flow/i, category: 'OPERATION_DEADLINE' },
  { id: 'request', re: /fetch|request|http|axios|undici|signal|client|webhook|probe/i, category: 'REQUEST_TIMEOUT' },
]);

/**
 * Classificação por KIND quando nenhuma regra nomeada casou. É uma DECISÃO
 * explícita e rastreável (`ruleId` = `kind-*`), não ambiguidade: o inventário
 * registra quantos entraram por default e LISTA todos, para auditoria humana.
 * Sem isso, `timeout:`/`setTimeout` genéricos ficariam LEGACY_UNKNOWN para sempre
 * — o que a missão proíbe ("não simplesmente preservar porque já estava lá").
 */
const KIND_DEFAULTS = Object.freeze({
  setInterval: { category: 'POLL_INTERVAL', ruleId: 'kind-setInterval-polls' },
  setTimeout: { category: 'OPERATION_DEADLINE', ruleId: 'kind-setTimeout-deadline' },
  promiseRace: { category: 'OPERATION_DEADLINE', ruleId: 'kind-promiseRace-deadline' },
  abortSignalTimeout: { category: 'REQUEST_TIMEOUT', ruleId: 'kind-abortSignal-request' },
  optionKey: { category: 'OPERATION_DEADLINE', ruleId: 'kind-optionKey-deadline' },
  declaration: { category: 'OPERATION_DEADLINE', ruleId: 'kind-declaration-deadline' },
});

/**
 * Nomes que NÃO são durações — são handles, objetos de política ou ruído. Sem
 * esta denylist, `timeoutId` (id do timer), `timeoutPolicy` (objeto) e
 * `bottlenecks` ("bo-TTL-enecks"!) entravam no inventário como se fossem
 * timeouts configurados. Isso destruiria a confiança no gate.
 */
const NON_DURATION_NAMES = Object.freeze([
  /^timeout(Id|Handle|Ref)$/i,
  /^timeout(Policy|Condition|Config)$/i,
  /^timeoutPromise$/i,
  /bottleneck/i,
]);

function isNonDurationName(name) {
  return NON_DURATION_NAMES.some((re) => re.test(String(name || '')));
}

/**
 * Remove comentários e literais de string, preservando EXATAMENTE o comprimento
 * (substitui por espaços) para que os offsets — e portanto os números de linha —
 * continuem válidos.
 *
 * Por que isso é obrigatório (medido 2026-09-26): sem remover comentários, o
 * inventário contava `timeout:` escrito em PROSA e acusava
 * `PID_AS_LIVENESS_AUTHORITY` em `engine/engineeringMission/leasePolicy.js:6,13`
 * — linhas que APENAS DOCUMENTAM que `process.kill(pid, 0)` não é autoridade.
 * Um scanner que confunde documentação com código produz falso alarme em cima de
 * quem já corrigiu o problema.
 */
function stripCommentsAndStrings(src) {
  const out = src.split('');
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i += 1) {
      if (out[i] !== '\n') out[i] = ' ';
    }
  };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j += 1;
      blank(i, j);
      i = j;
    } else if (c === '/' && next === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j += 1;
      const end = Math.min(n, j + 2);
      blank(i, end);
      i = end;
    } else if (c === '"' || c === '\'' || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === quote) { j += 1; break; }
        if (quote !== '`' && src[j] === '\n') break; // string não terminada
        j += 1;
      }
      // mantém um caractere (a aspa) para preservar o comprimento e o token
      blank(i + 1, j - 1);
      i = j;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

/**
 * Índice de linhas: offsets de início de cada linha, para resolver o número da
 * linha por busca binária. Calcular `src.slice(0, index).split('\n')` POR SITE é
 * O(n) por site e dominou o tempo da varredura (medido 2026-09-26: >340s sem
 * terminar em ~1400 arquivos). Com o índice, é O(log n) por site.
 */
function buildLineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i += 1) {
    if (src.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineNumberAt(lineStarts, index) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * `setTimeout(resolve, ms)` dentro de um helper `sleep()`/`delay()` NÃO é timeout:
 * é espera cooperativa. Confundir os dois produz falso alarme em componente
 * crítico (medido 2026-09-26: `pipeline/runFullValidation.js:145`), e o gate
 * perderia credibilidade por acusar um utilitário de espera.
 * Critério: o corpo do callback é uma única chamada simples (resolve/next/done).
 */
function isSleepHelper(code, index, kind) {
  if (kind !== 'setTimeout' && kind !== 'setInterval') return false;
  const head = code.slice(index, index + 200);

  // Forma 1 (a mais comum e a que escapou na 1ª versão): callback é uma
  // REFERÊNCIA de continuação, sem chaves — `setTimeout(resolve, ms)`. A versão
  // anterior procurava `{` a partir do índice e encontrava a chave de uma função
  // POSTERIOR do arquivo, classificando o helper como "timer sem categoria".
  const ref = /^set(?:Timeout|Interval)\(\s*([A-Za-z0-9_$.]*)\s*,/.exec(head);
  if (ref) {
    const cb = ref[1];
    if (cb === '') return true; // setTimeout(, ) impossível; guarda
    if (/^(resolve|reject|done|next|cb|callback|onResolve|onDone|finish|noop)$/.test(cb)) return true;
    if (/^(resolve|done|next|cb|finish)($|\.)/.test(cb)) return true;
  }

  // Forma 2: arrow de expressão trivial — `setTimeout(() => resolve(), ms)`
  const exprArrow = /^set(?:Timeout|Interval)\(\s*\([^)]*\)\s*=>\s*[A-Za-z0-9_$.]+(\([^()]{0,60}\))?\s*,/.exec(head);
  if (exprArrow) return true;

  // Forma 3: arrow com bloco trivial — `setTimeout(() => { resolve(); }, ms)`
  const open = code.indexOf('{', index);
  if (open === -1 || open - index > 200) return false;
  const body = braceBody(code, open);
  const compact = body.replace(/\s+/g, ' ').trim();
  if (compact.length === 0 || compact.length > 120) return false;
  return /^(return )?[A-Za-z0-9_$.]+(\([^()]{0,80}\))?;?$/.test(compact);
}

/**
 * Extrai a linha de código e o contexto (nome da constante-chave/propriedade),
 * usando o índice de linhas pré-computado.
 */
function describeSite(source, lineStarts, index) {
  const line = lineNumberAt(lineStarts, index);
  const start = lineStarts[line - 1] || 0;
  let end = source.indexOf('\n', start);
  if (end === -1) end = source.length;
  return { line, lineText: source.slice(start, end).trim().slice(0, 200) };
}

/** Corpo de uma função/chamada a partir da chave de abertura. */
function braceBody(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1, open + 1200);
}

/**
 * Intervalos [start,end] de todas as funções/arrows do arquivo, calculados UMA
 * vez. A versão anterior re-varria o arquivo inteiro a cada site (O(n) por site).
 */
function buildFunctionRanges(src) {
  const ranges = [];
  const re = /(?:async\s+)?function\s*([A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{|(?:async\s*)?\([^)]*\)\s*=>\s*\{|([A-Za-z0-9_$]+)\s*[:=]\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(src)) !== null) {
    const open = src.indexOf('{', m.index + m[0].length - 1);
    if (open === -1) continue;
    ranges.push({ start: open, end: matchBraceEnd(src, open), name: m[1] || m[2] || '(arrow)' });
  }
  return ranges;
}

function matchBraceEnd(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return src.length;
}

/** Símbolo mais interno que contém a posição, a partir dos intervalos prontos. */
function symbolAt(ranges, pos) {
  let best = null;
  for (const r of ranges) {
    if (r.start < pos && pos < r.end && (!best || r.start > best.start)) best = r;
  }
  return best ? best.name : '(escopo de módulo)';
}

/** Interpreta a ação observada no corpo do callback do timer. */
function classifyAction(source, index, kind) {
  const actions = [];
  let body = '';
  if (kind === 'setTimeout' || kind === 'setInterval') {
    const open = source.indexOf('{', index);
    if (open !== -1) body = braceBody(source, open);
  }
  const probe = body || source.slice(Math.max(0, index - 400), index + 900);

  if (/KILL_PARENT|process\.exit\s*\(/.test(probe)) actions.push('KILL_PARENT_PROCESS');
  if (/SIGKILL|SIGTERM|\.kill\s*\(|killTree|terminateChild/.test(probe)) actions.push('KILL_CHILD_PROCESS');
  if (/abort\s*\(|\.abort\(\)|AbortError|controller\.abort/.test(probe)) actions.push('CANCEL_OPERATION');
  if (/failMission|MISSION_FAILED|missionFailed|fail_mission/.test(probe)) actions.push('FAIL_MISSION');
  if (/failTask|TASK_FAILED|taskFailed|markFailed|status.*FAILED/.test(probe)) actions.push('FAIL_TASK');
  if (/fallback|switchProvider|nextProvider/.test(probe)) actions.push('FALLBACK');
  if (/retry|attempt\s*\+|maxAttempts/.test(probe)) actions.push('RETRY');
  if (/recover|takeover|takeOver|reclaim/i.test(probe)) actions.push('RECOVER');
  return actions.length > 0 ? actions : ['UNKNOWN'];
}

/**
 * Detecta padrões DESTRUTIVOS — a razão de existir desta missão.
 * Cada achado é um defeito arquitetural, não um estilo.
 *
 * ATENÇÃO: TODAS as expressões PRECISAM da flag `g`. Sem ela, `re.exec()` não
 * avança `lastIndex` e o `while` de varredura é INFINITO — foi exatamente o que
 * travou a varredura e estourou o heap (medido 2026-09-26: 4 GB de OOM).
 */
const DESTRUCTIVE_PATTERNS = Object.freeze([
  {
    id: 'MISSION_KILL_BY_WALL_CLOCK',
    re: /(MISSION|TASK|MISSION_TOTAL|TASK_TOTAL)[A-Z0-9_]*(TIMEOUT|MAX_DURATION|DEADLINE)\s*=\s*\d+/g,
    detail: 'limite global de wall-clock para missão/task: decisão de morte por tempo decorrido',
    forbidden: true,
  },
  {
    id: 'STALE_BY_AGE_ONLY',
    re: /(elapsed|duration|now\s*-\s*\w*(started|created|updated))\s*[><]=?\s*\w*(TIMEOUT|MAX_DURATION|STALE)/g,
    detail: 'stale/takeover decidido por idade apenas, sem heartbeat/lease',
    forbidden: true,
  },
  {
    // NÃO usar `pid.*(alive|liveness)`: `.*` sem âncora casa em quase toda
    // posição do arquivo. A detecção tem de ser por SÍMBOLO concreto, não por
    // proximidade textual.
    id: 'PID_AS_LIVENESS_AUTHORITY',
    re: /\bisProcessAlive\s*\(|\bprocess\.kill\s*\(\s*[A-Za-z0-9_$.]+\s*,\s*0\s*\)/g,
    detail: 'PID usado como autoridade de liveness distribuída (deve ser lease+fence)',
    forbidden: true,
  },
]);

/**
 * Teto de work por arquivo: o inventário é evidência, não varredura exaustiva
 * sem limite. Sem isso, uma expressão patológica (ou um arquivo gerado) trava o
 * gate em vez de reportar.
 */
const MAX_SITES_PER_FILE = 4000;

function classify(entry) {
  const hay = `${entry.name} ${entry.file} ${entry.context}`;
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.re.test(hay)) return { category: rule.category, ruleId: rule.id, byDefault: false };
  }
  const fallback = KIND_DEFAULTS[entry.kind];
  if (fallback) return { category: fallback.category, ruleId: fallback.ruleId, byDefault: true };
  return { category: TIMEOUT_CATEGORIES.LEGACY_UNKNOWN_TIMEOUT, ruleId: null, byDefault: false };
}

/** Componentes críticos: onde um timeout errado mata trabalho legítimo. */
const CRITICAL_PATH_RE = /(engineeringRouter|engineeringMission|missionOrchestrator|missionStore|workforce|lease|qa-waves\/.*worker|executionQueue|pipeline)/i;

const SITE_PATTERNS = [
  { kind: 'setTimeout', re: /\bsetTimeout\s*\(/g },
  { kind: 'setInterval', re: /\bsetInterval\s*\(/g },
  { kind: 'abortSignalTimeout', re: /AbortSignal\.timeout\s*\(\s*([^)]*)\)/g },
  { kind: 'promiseRace', re: /Promise\.race\s*\(/g },
  { kind: 'declaration', re: /\b(?:const|let|var)\s+([A-Za-z0-9_$]*(?:TIMEOUT|Timeout|timeout|DEADLINE|Deadline|BACKOFF|Backoff|LEASE|LEASE_MS|HEARTBEAT|INTERVAL|ttlMs|TtlMs|ttlSec|TtlSec|ttlSeconds|TtlSeconds)[A-Za-z0-9_$]*)\s*=\s*([^;\n]+)/g },
  { kind: 'optionKey', re: /\b([A-Za-z0-9_$]*(?:timeout|Timeout|TIMEOUT|deadline|Deadline|ttlMs|TtlMs|ttlSec|TtlSec|ttlSeconds|TtlSeconds|backoff|Backoff)[A-Za-z0-9_$]*)\s*:\s*([^,\n}]+)/g },
];

/** Extrai o valor numérico bruto quando evidente (constante literal). */
function literalValue(raw) {
  const m = String(raw).match(/(\d[\d_]*(?:\.\d+)?)\s*(\*?\s*(?:1000|60|24)\b)?/);
  if (!m) return { value: null, unit: null };
  const num = Number(String(m[1]).replace(/_/g, ''));
  if (!Number.isFinite(num)) return { value: null, unit: null };
  const mult = m[2] || '';
  if (/60\s*\*\s*1000/.test(mult) || /\*/.test(mult)) return { value: num, unit: 'expression' };
  return { value: num, unit: /1000/.test(mult) ? 'ms' : null };
}

/**
 * Varre UM arquivo e devolve as entradas de timeout.
 * @param {{ file:string, source:string }} input
 */
function scanFile({ file, source }) {
  const entries = [];
  const destructive = [];
  const critical = CRITICAL_PATH_RE.test(file);
  // Casar SOMENTE contra código: comentários e strings viram espaços (mesmo
  // comprimento, offsets preservados). Ver stripCommentsAndStrings.
  const code = stripCommentsAndStrings(source);
  const lineStarts = buildLineIndex(source);
  const fnRanges = buildFunctionRanges(code);

  for (const pattern of SITE_PATTERNS) {
    pattern.re.lastIndex = 0;
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = pattern.re.exec(code)) !== null) {
      if (entries.length >= MAX_SITES_PER_FILE) break;
      const { line, lineText } = describeSite(source, lineStarts, m.index);
      const name = (pattern.kind === 'declaration' || pattern.kind === 'optionKey')
        ? (m[1] || '(anônimo)')
        : pattern.kind;
      if (isNonDurationName(name)) continue;
      const rawArg = pattern.kind === 'declaration' || pattern.kind === 'optionKey'
        ? (m[2] || '')
        : (m[1] || '');
      const { value, unit } = literalValue(rawArg);
      const context = lineText;
      const base = { file, line, kind: pattern.kind, name, rawArg: String(rawArg).trim().slice(0, 80), value, unit, context, critical };
      const isSleep = isSleepHelper(code, m.index, pattern.kind);
      const classified = classify(base);
      const category = isSleep ? TIMEOUT_CATEGORIES.DELAY_SLEEP : classified.category;
      const ruleId = isSleep ? 'sleep-helper' : classified.ruleId;
      const byDefault = isSleep ? false : classified.byDefault;
      entries.push({
        ...base,
        category,
        classificationRule: ruleId,
        classifiedByDefault: byDefault,
        symbol: symbolAt(fnRanges, m.index),
        expiryActions: classifyAction(code, m.index, pattern.kind),
        killsParentProcess: false,
        failsTask: false,
        failsMission: false,
        hasRetry: false,
        hasFallback: false,
        hasRecovery: false,
      });
    }
  }

  // preenche as flags a partir das ações observadas
  for (const e of entries) {
    e.killsParentProcess = e.expiryActions.includes('KILL_PARENT_PROCESS');
    e.failsTask = e.expiryActions.includes('FAIL_TASK');
    e.failsMission = e.expiryActions.includes('FAIL_MISSION');
    e.hasRetry = e.expiryActions.includes('RETRY');
    e.hasFallback = e.expiryActions.includes('FALLBACK');
    e.hasRecovery = e.expiryActions.includes('RECOVER') || e.expiryActions.includes('CANCEL_OPERATION');
    if (!e.killsParentProcess) e.expiryActions = e.expiryActions.filter((a) => a !== 'KILL_PARENT_PROCESS');
  }

  for (const dp of DESTRUCTIVE_PATTERNS) {
    dp.re.lastIndex = 0;
    let m;
    // eslint-disable-next-line no-const-assign, no-cond-assign
    while ((m = dp.re.exec(code)) !== null) {
      if (m[0] === '') { dp.re.lastIndex += 1; continue; }
      const { line, lineText } = describeSite(source, lineStarts, m.index);
      destructive.push({
        id: dp.id,
        detail: dp.detail,
        file,
        line,
        match: String(m[0]).slice(0, 160),
        context: lineText,
        critical,
      });
    }
  }

  // setTimeout/setInterval sem classificação em componente crítico = suspeito
  for (const e of entries) {
    if (e.critical && (e.kind === 'setTimeout' || e.kind === 'setInterval') && e.category === 'LEGACY_UNKNOWN_TIMEOUT') {
      destructive.push({
        id: 'UNCLASSIFIED_TIMER_IN_CRITICAL_COMPONENT',
        detail: 'timer sem categoria em componente crítico — finalidade não determinável',
        file,
        line: e.line,
        match: e.context,
        context: e.context,
        critical: true,
      });
    }
  }

  return { entries, destructive };
}

/** Agrega o inventário de muitos arquivos. */
function buildInventory(files) {
  const entries = [];
  const destructive = [];
  let filesScanned = 0;
  for (const f of files) {
    const out = scanFile(f);
    filesScanned += 1;
    entries.push(...out.entries);
    destructive.push(...out.destructive);
  }
  const byCategory = {};
  for (const key of Object.values(TIMEOUT_CATEGORIES)) byCategory[key] = 0;
  for (const e of entries) byCategory[e.category] = (byCategory[e.category] || 0) + 1;
  const classifiedByDefault = entries.filter((e) => e.classifiedByDefault);
  return {
    filesScanned,
    total: entries.length,
    byCategory,
    legacyUnknown: byCategory.LEGACY_UNKNOWN_TIMEOUT || 0,
    // Quantos entraram por default de KIND (decisão explícita e auditável) —
    // listados no relatório para revisão humana, nunca escondidos.
    classifiedByDefault: classifiedByDefault.length,
    defaultedEntries: classifiedByDefault.slice(0, 500),
    entries,
    destructive,
    destructiveCritical: destructive.filter((d) => d.critical).length,
  };
}

module.exports = {
  TIMEOUT_CATEGORIES,
  EXPIRY_ACTIONS,
  CLASSIFICATION_RULES,
  KIND_DEFAULTS,
  NON_DURATION_NAMES,
  DESTRUCTIVE_PATTERNS,
  SITE_PATTERNS,
  MAX_SITES_PER_FILE,
  scanFile,
  buildInventory,
  stripCommentsAndStrings,
  isSleepHelper,
  classify,
  literalValue,
  buildLineIndex,
  lineNumberAt,
  buildFunctionRanges,
  symbolAt,
};
