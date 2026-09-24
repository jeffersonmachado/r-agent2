'use strict';

/**
 * engine/engineeringMission/diffAnalysis.js — análise REAL do código que a missão produziu.
 *
 * O Meta Reviewer não pode opinar sobre "o código parece bom": ele precisa inspecionar o diff.
 * Este módulo é a camada que transforma um unified diff (e, quando disponível, o conteúdo atual dos
 * arquivos) em OBSERVAÇÕES verificáveis: teste enfraquecido, teste desligado, catch vazio, segredo
 * adicionado, flag que desliga funcionalidade, código comentado.
 *
 * Onde a análise textual não prova nada, o resultado é explicitamente `NOT_VERIFIABLE` — com o
 * mecanismo que tornaria a verificação real nomeado. Nunca PASS por omissão.
 *
 * Módulo puro (sem I/O, sem parser obrigatório).
 */

const SECRET_PATTERNS = Object.freeze([
  { id: 'OPENAI_LIKE_KEY', re: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { id: 'AWS_ACCESS_KEY', re: /\bAKIA[0-9A-Z]{12,}\b/ },
  { id: 'PRIVATE_KEY_BLOCK', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'BEARER_LITERAL', re: /Bearer\s+[A-Za-z0-9._-]{20,}/ },
  { id: 'PASSWORD_ASSIGNMENT', re: /\b(password|passwd|secret|api_?key|access_?token)\s*[:=]\s*['"][^'"]{6,}['"]/i },
  { id: 'DASHSCOPE_KEY', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
]);

const ASSERTION_PATTERNS = Object.freeze([
  /\bexpect\s*\(/,
  /\bassert\s*[.(]/,
  /\btoHaveBeenCalled\b/,
  /\btoBe(Truthy|Falsy|Null|Undefined|Defined)\s*\(/,
  /\brejects\.to(Throw|MatchObject)/,
]);

const TEST_SKIP_PATTERNS = Object.freeze([
  /\.skip\s*\(/,
  /\.only\s*\(/,
  /\bxit\s*\(/,
  /\bxdescribe\s*\(/,
  /\bx?it\.todo\s*\(/,
  /\btest\.todo\s*\(/,
  /\bdescribe\.skip\b/,
  /\bit\.skip\b/,
]);

const FEATURE_DISABLE_PATTERNS = Object.freeze([
  { id: 'ENV_DISABLE_FLAG', re: /process\.env\.[A-Z0-9_]*DISABLE[A-Z0-9_]*/ },
  { id: 'HARDCODED_OFF_SWITCH', re: /\b(FEATURE|ENABLE|ENABLED|DISABLED|BYPASS|SKIP)[A-Z0-9_]*\s*[:=]\s*(true|false)\b/ },
  { id: 'RETURN_HARDCODED', re: /return\s+(true|false|null|\[\]|\{\})\s*;\s*\/\/\s*(fixme|hack|temporar|bypass|desliga)/i },
]);

const COMMENTED_CODE_PATTERNS = Object.freeze([
  /^\s*\/\/\s*(return|const|let|var|await|if|for|while|function|class|import|require|module\.exports|throw)\b/,
  /^\s*\/\/\s*[)}\]]\s*;?\s*$/,
]);

/**
 * Parser AST opcional: `@babel/parser` é dependência transitiva (via jest/babel), não declarada
 * neste projeto. Uso OPCIONAL por design — sem ele, os checks que dependem de AST viram
 * `NOT_VERIFIABLE` com a causa explícita, em vez de virarem PASS silencioso.
 */
function loadParser() {
  try {
    // eslint-disable-next-line global-require
    return require('@babel/parser');
  } catch (_) {
    return null;
  }
}

/**
 * Faz o parse de um unified diff. `addedLinesByFile` mapeia o NÚMERO DE LINHA NO ARQUIVO NOVO para
 * o texto adicionado — é isso que permite saber se uma construção encontrada no arquivo (via AST)
 * foi introduzida por esta missão, e não pré-existente.
 */
function parseUnifiedDiff(diffText) {
  const files = new Map();
  if (!diffText || typeof diffText !== 'string') return files;

  let current = null;
  let newLine = 0;
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const path = raw.replace(/^\+\+\+\s+/, '').replace(/^[ab]\//, '').trim();
      current = { path, addedLines: new Map(), removedLines: [], addedCount: 0, removedCount: 0 };
      files.set(path, current);
      continue;
    }
    if (raw.startsWith('--- ') || raw.startsWith('diff --git')) continue;
    if (!current) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith('+')) {
      current.addedLines.set(newLine, raw.slice(1));
      current.addedCount += 1;
      newLine += 1;
      continue;
    }
    if (raw.startsWith('-')) {
      current.removedLines.push(raw.slice(1));
      current.removedCount += 1;
      continue;
    }
    if (raw.startsWith(' ')) newLine += 1;
  }
  return files;
}

function matchAny(patterns, text) {
  return patterns.some((p) => (p instanceof RegExp ? p.test(text) : p.re.test(text)));
}

function findRemovedAssertions(files) {
  const hits = [];
  for (const [path, info] of files) {
    for (const line of info.removedLines) {
      if (matchAny(ASSERTION_PATTERNS, line)) {
        hits.push({ file: path, evidence: line.trim(), detail: 'linha de asserção removida pelo patch' });
      }
    }
  }
  return hits;
}

function findAddedTestSuppression(files) {
  const hits = [];
  for (const [path, info] of files) {
    for (const [lineNo, line] of info.addedLines) {
      if (matchAny(TEST_SKIP_PATTERNS, line)) {
        hits.push({ file: path, line: lineNo, evidence: line.trim(), detail: 'supressão de teste adicionada (.skip/.only/xit/xdescribe/todo)' });
      }
    }
  }
  return hits;
}

function findAddedSecrets(files) {
  const hits = [];
  for (const [path, info] of files) {
    for (const [lineNo, line] of info.addedLines) {
      for (const { id, re } of SECRET_PATTERNS) {
        if (re.test(line)) {
          hits.push({ file: path, line: lineNo, evidence: id, detail: `padrão de segredo adicionado (${id})` });
        }
      }
    }
  }
  return hits;
}

function findAddedFeatureDisables(files) {
  const hits = [];
  for (const [path, info] of files) {
    for (const [lineNo, line] of info.addedLines) {
      for (const { id, re } of FEATURE_DISABLE_PATTERNS) {
        if (re.test(line)) {
          hits.push({ file: path, line: lineNo, evidence: line.trim(), detail: `possível desligamento de funcionalidade (${id})` });
        }
      }
    }
  }
  return hits;
}

function findAddedCommentedCode(files) {
  const hits = [];
  for (const [path, info] of files) {
    for (const [lineNo, line] of info.addedLines) {
      if (COMMENTED_CODE_PATTERNS.some((re) => re.test(line))) {
        hits.push({ file: path, line: lineNo, evidence: line.trim(), detail: 'linha de código comentada adicionada (heurística)' });
      }
    }
  }
  return hits;
}

function findRemovedTestCases(files) {
  const hits = [];
  for (const [path, info] of files) {
    if (!/\.test\.jsx?$/.test(path)) continue;
    for (const line of info.removedLines) {
      if (/\b(test|it)\s*\(/.test(line)) {
        hits.push({ file: path, evidence: line.trim(), detail: 'caso de teste removido por inteiro' });
      }
    }
  }
  return hits;
}

/**
 * Checks que dependem de AST: executados apenas nos ARQUIVOS ALTERADOS e apenas quando a
 * construção está em uma linha ADICIONADA por este patch (nunca reporta código pré-existente).
 *
 * @param {Map<string,string>} fileContents  caminho → conteúdo atual do arquivo
 */
function findSilentErrorHandling(files, fileContents = new Map()) {
  const parser = loadParser();
  if (!parser) {
    return {
      notVerifiable: {
        detail: 'análise de catch silencioso exige parser AST; `@babel/parser` não está resolvível neste ambiente',
        mechanism: 'declarar `@babel/parser` (ou `acorn`) como dependência de desenvolvimento',
      },
      hits: [],
    };
  }

  const hits = [];
  for (const [path, info] of files) {
    const content = fileContents.get(path);
    if (!content) continue;
    let ast;
    try {
      ast = parser.parse(content, { sourceType: 'unambiguous', plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'] });
    } catch (_) {
      continue; // arquivo não parseável (ex.: JSX complexo) — não inventa resultado
    }
    const addedLineNumbers = new Set(info.addedLines.keys());

    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'CatchClause') {
        const body = node.body && node.body.body ? node.body.body : [];
        const start = node.loc?.start?.line ?? -1;
        const end = node.loc?.end?.line ?? -1;
        let touchesAdded = false;
        for (let l = start; l <= end; l += 1) if (addedLineNumbers.has(l)) { touchesAdded = true; break; }
        if (touchesAdded) {
          const sourceText = content.split('\n').slice(start - 1, end).join('\n');
          const logsOrSignals = /logger\.(warn|error|info)|degraded|console\.(warn|error)/.test(sourceText);
          const onlyReturn = body.length === 1 && body[0].type === 'ReturnStatement';
          if (body.length === 0) {
            hits.push({ file: path, line: start, kind: 'EMPTY_CATCH', evidence: 'catch {}', detail: 'exceção engolida: bloco catch vazio' });
          } else if (onlyReturn && !logsOrSignals) {
            hits.push({
              file: path,
              line: start,
              kind: 'SILENT_RETURN_CATCH',
              evidence: 'catch → return literal sem log/sinalização',
              detail: 'exceção convertida em retorno silencioso sem logger.warn nem marcador de degradação',
            });
          }
        }
      }
      for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'start' || key === 'end') continue;
        const value = node[key];
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object' && typeof value.type === 'string') visit(value);
      }
    };
    visit(ast.program);
  }
  return { notVerifiable: null, hits };
}

/**
 * Observações textuais que NÃO provam comportamento — reportadas como informativas, com o
 * mecanismo que as tornaria verificáveis.
 */
function detectUnverifiableConcerns(files) {
  const concerns = [];
  let floatingPromiseSuspects = 0;
  let hardcodedConfigSuspects = 0;
  for (const [, info] of files) {
    for (const line of info.addedLines.values()) {
      if (/^\s*(await\s+)?[A-Za-z_$][\w$.]*\([^)]*\)\s*;\s*$/.test(line) && !/await\s/.test(line) && !/^(return|const|let|var|if|for|while|describe|test|it|expect)\b/.test(line.trim())) {
        floatingPromiseSuspects += 1;
      }
      if (/['"](https?:\/\/[^'"]+|localhost:\d+)['"]/.test(line)) hardcodedConfigSuspects += 1;
    }
  }
  if (floatingPromiseSuspects > 0) {
    concerns.push({
      checkId: 'NO_UNAWAITED_PROMISES',
      suspects: floatingPromiseSuspects,
      mechanism: 'análise estática textual não distingue promise não aguardada de chamada síncrona; exige lint com tipos (typescript-eslint no-floating-promises) — não instalado neste projeto',
    });
  }
  if (hardcodedConfigSuspects > 0) {
    concerns.push({
      checkId: 'NO_HARDCODED_CONFIG',
      suspects: hardcodedConfigSuspects,
      mechanism: 'revisão humana/política de ambiente: URLs literais podem ser legítimas em testes — o check automático fica como informativo',
    });
  }
  return concerns;
}

/**
 * Análise completa do patch: retorna observações cruas (sem julgar severidade final).
 */
function analyzePatch({ diffText, fileContents = new Map() } = {}) {
  const files = parseUnifiedDiff(diffText);
  const silent = findSilentErrorHandling(files, fileContents);
  const addedLines = [...files.values()].reduce((acc, f) => acc + f.addedCount, 0);
  const removedLines = [...files.values()].reduce((acc, f) => acc + f.removedCount, 0);

  return {
    files: [...files.keys()],
    filesChanged: files.size,
    addedLines,
    removedLines,
    removedAssertions: findRemovedAssertions(files),
    addedTestSuppression: findAddedTestSuppression(files),
    addedSecrets: findAddedSecrets(files),
    addedFeatureDisables: findAddedFeatureDisables(files),
    addedCommentedCode: findAddedCommentedCode(files),
    removedTestCases: findRemovedTestCases(files),
    silentErrorHandling: silent.hits,
    silentErrorHandlingNotVerifiable: silent.notVerifiable,
    unverifiableConcerns: detectUnverifiableConcerns(files),
  };
}

module.exports = {
  SECRET_PATTERNS,
  ASSERTION_PATTERNS,
  TEST_SKIP_PATTERNS,
  FEATURE_DISABLE_PATTERNS,
  COMMENTED_CODE_PATTERNS,
  parseUnifiedDiff,
  analyzePatch,
};
