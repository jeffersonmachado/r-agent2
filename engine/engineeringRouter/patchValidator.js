'use strict';

/**
 * engine/engineeringRouter/patchValidator.js
 *
 * Valida um patch ANTES de qualquer aplicação real (git apply roda depois, em workspace
 * isolado — ver `api/services/engineeringRouter/patchApplyService.js`). Este módulo é puro:
 * faz parsing textual de unified diff e checagens estruturais, sem tocar disco.
 *
 * O modelo NÃO pode declarar "mudei o arquivo assim" em texto livre — a única saída aceita do
 * CODER é um unified diff real. Este validador rejeita explicitamente qualquer coisa que não
 * seja um diff bem formado.
 */

const { FAILURE_CODES } = require('./constants');
const { checkPathBoundary, normalize } = require('./pathBoundary');

const DEFAULT_MAX_PATCH_SIZE_BYTES = 200 * 1024; // 200KB — patch de tarefa, não de release inteira.
const SECRET_LIKE_FILENAMES = [/(^|\/)\.env(\..*)?$/, /(^|\/)\.token\.env$/, /credentials\.json$/, /(^|\/)secrets?\//i];

const FILE_HEADER_RE = /^diff --git a\/(.+?) b\/(.+)$/;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const NO_NEWLINE_MARKER_RE = /^\\ No newline at end of file$/;

/**
 * Faz o parsing de um unified diff em uma lista estruturada de arquivos tocados.
 * Tolerante o bastante para diffs reais gerados por `git diff`/`git format-patch`; não tenta
 * ser um parser completo (a aplicação real via `git apply --check` é a fonte de verdade de
 * sintaxe). Aqui só precisamos saber: quais arquivos, é binário, é delete, é novo, tamanho — e,
 * desde o HUMAN_EXTERNAL_BOOTSTRAP de 2026-10-07, se algum hunk traz CORPO SEM PREFIXO.
 *
 * `bodyPrefixViolations` nasceu de um achado real medido em runtime: o coder
 * `qwen:qwen3-coder-flash` emite o CABEÇALHO do diff/hunk corretos e o CORPO inteiramente sem
 * prefixo (`'use strict';` em vez de `+'use strict';`) — `git apply` recusa o patch inteiro como
 * corrompido, e antes desta checagem a plataforma só descobria isso no apply
 * (`PATCH_APPLY_FAILED`, sem reroute), queimando todas as iterações no mesmo modelo.
 *
 * Nenhuma heurística aqui tenta consertar o corpo: apenas DETECTA, com arquivo/hunk/contagens
 * (inclusive exemplos das linhas nuas), para que o patch seja recusado ANTES do `git apply`.
 */
function parseUnifiedDiff(diffText) {
  const text = String(diffText || '');
  if (!text.trim()) {
    return { files: [], hasAnyFileHeader: false, hasAnyHunk: false, bodyPrefixViolations: [] };
  }

  const lines = text.split('\n');
  const files = [];
  const bodyPrefixViolations = [];
  let current = null;
  let currentHunk = null;
  let sawHunk = false;
  let sawBinary = false;

  // Fecha o hunk corrente. Duas assinaturas DETERMINÍSTICAS de corpo inválido (nenhuma delas
  // adivinha intenção — as duas derivam da semântica de unified diff):
  //  (i)  hunk sem NENHUMA linha prefixada, mas com linhas de conteúdo;
  //  (ii) hunk cujo HEADER declara mais adições (ou remoções) do que o corpo pode produzir: sem
  //       nenhuma linha '+' (ou '-'), um corpo só consegue contexto — e um hunk que declara
  //       adição sem nenhuma adição é inaplicável por definição.
  //
  // A assinatura (ii) é a que pega o defeito REAL medido: o corpo é o CONTEÚDO INTEGRAL do arquivo
  // sem prefixo, então as linhas indentadas do código começam com espaço e passariam pela
  // assinatura (i) — mas o header continua declarando as adições que o corpo não tem.
  const closeHunk = () => {
    if (!currentHunk) return;
    const declaredAdded = currentHunk.declaredNewCount - currentHunk.declaredOldCount;
    const reasons = [];
    if (currentHunk.prefixedLines === 0 && currentHunk.bareLines > 0) {
      reasons.push('nenhuma linha do corpo tem prefixo de unified diff');
    }
    if (declaredAdded > 0 && currentHunk.plusLines === 0) {
      reasons.push(`header declara ${declaredAdded} linha(s) adicionada(s) mas o corpo não tem nenhuma linha '+'`);
    }
    if (declaredAdded < 0 && currentHunk.minusLines === 0) {
      reasons.push(`header declara ${Math.abs(declaredAdded)} linha(s) removida(s) mas o corpo não tem nenhuma linha '-'`);
    }
    if (reasons.length > 0) {
      bodyPrefixViolations.push({
        path: current ? (current.newPath && current.newPath !== '/dev/null' ? current.newPath : current.oldPath) : null,
        hunkIndex: currentHunk.hunkIndex,
        hunkHeader: currentHunk.header,
        hunkLineNumber: currentHunk.lineNumber,
        declaredOldCount: currentHunk.declaredOldCount,
        declaredNewCount: currentHunk.declaredNewCount,
        bodyLines: currentHunk.bodyLines,
        plusLines: currentHunk.plusLines,
        minusLines: currentHunk.minusLines,
        spaceLines: currentHunk.spaceLines,
        prefixedLines: currentHunk.prefixedLines,
        bareLines: currentHunk.bareLines,
        emptyLines: currentHunk.emptyLines,
        reasons,
        bareExamples: currentHunk.bareExamples,
      });
    }
    currentHunk = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fileMatch = FILE_HEADER_RE.exec(line);
    if (fileMatch) {
      closeHunk();
      current = {
        oldPath: normalize(fileMatch[1]),
        newPath: normalize(fileMatch[2]),
        isNew: false,
        isDeleted: false,
        isBinary: false,
        isRename: fileMatch[1] !== fileMatch[2],
        hunkCount: 0,
      };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (/^new file mode/.test(line)) current.isNew = true;
    if (/^deleted file mode/.test(line)) current.isDeleted = true;
    if (/^Binary files .* differ$/.test(line) || /^GIT binary patch$/.test(line)) { current.isBinary = true; sawBinary = true; }
    if (/^\+\+\+ \/dev\/null$/.test(line)) current.isDeleted = true;
    if (/^--- \/dev\/null$/.test(line)) current.isNew = true;

    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (hunkMatch) {
      closeHunk();
      current.hunkCount += 1;
      sawHunk = true;
      currentHunk = {
        hunkIndex: current.hunkCount,
        header: line,
        lineNumber: i + 1,
        declaredOldCount: hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]),
        declaredNewCount: hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]),
        bodyLines: 0,
        plusLines: 0,
        minusLines: 0,
        spaceLines: 0,
        prefixedLines: 0,
        bareLines: 0,
        emptyLines: 0,
        bareExamples: [],
      };
      continue;
    }

    if (!currentHunk) continue;
    // Cabeçalho de arquivo ('--- '/'+++ ') encerra o corpo do hunk mesmo sem um novo '@@'.
    if (line.startsWith('--- ') || line.startsWith('+++ ')) { closeHunk(); continue; }
    if (NO_NEWLINE_MARKER_RE.test(line)) continue;
    // A última linha de `text.split('\n')` é sempre "" quando o texto termina com '\n' — é o fim
    // da string, não uma linha real do hunk (mesma convenção do `hunkNormalizer`, para que as
    // contagens de diagnóstico não fiquem infladas).
    if (line === '' && i === lines.length - 1) continue;

    currentHunk.bodyLines += 1;
    if (line[0] === '+') {
      currentHunk.plusLines += 1;
      currentHunk.prefixedLines += 1;
    } else if (line[0] === '-') {
      currentHunk.minusLines += 1;
      currentHunk.prefixedLines += 1;
    } else if (line[0] === ' ') {
      currentHunk.spaceLines += 1;
      currentHunk.prefixedLines += 1;
    } else if (line === '') {
      currentHunk.emptyLines += 1;
    } else {
      currentHunk.bareLines += 1;
      if (currentHunk.bareExamples.length < 3) currentHunk.bareExamples.push(line.slice(0, 120));
    }
  }
  closeHunk();

  return { files, hasAnyFileHeader: files.length > 0, hasAnyHunk: sawHunk, hasAnyBinary: sawBinary, bodyPrefixViolations };
}

function touchedPathsOf(parsed) {
  const set = new Set();
  for (const f of parsed.files) {
    if (f.oldPath && f.oldPath !== '/dev/null') set.add(f.oldPath);
    if (f.newPath && f.newPath !== '/dev/null') set.add(f.newPath);
  }
  return [...set];
}

/**
 * Valida um patch contra o Task Contract e políticas fixas de segurança.
 *
 * @param {string} diffText
 * @param {Object} options
 * @param {Object} options.contract - {allowedPaths, forbiddenPaths, allowDeletes}
 * @param {number} [options.maxPatchSizeBytes]
 * @returns {{ok:boolean, code?:string, issues:Object[], files:Object[], touchedPaths:string[]}}
 */
function validatePatch(diffText, { contract = {}, maxPatchSizeBytes = DEFAULT_MAX_PATCH_SIZE_BYTES } = {}) {
  const issues = [];
  const text = String(diffText || '');

  if (Buffer.byteLength(text, 'utf8') > maxPatchSizeBytes) {
    issues.push({ code: FAILURE_CODES.PATCH_TOO_LARGE, message: `Patch excede ${maxPatchSizeBytes} bytes` });
    return { ok: false, code: FAILURE_CODES.PATCH_TOO_LARGE, issues, files: [], touchedPaths: [] };
  }

  const parsed = parseUnifiedDiff(text);
  if (!parsed.hasAnyFileHeader || !(parsed.hasAnyHunk || parsed.hasAnyBinary)) {
    issues.push({ code: FAILURE_CODES.PATCH_INVALID_FORMAT, message: 'Patch não contém diff --git / hunk válido (unified diff obrigatório)' });
    return { ok: false, code: FAILURE_CODES.PATCH_INVALID_FORMAT, issues, files: parsed.files, touchedPaths: [] };
  }

  // HUMAN_EXTERNAL_BOOTSTRAP (2026-10-07) — falha de FORMATO do corpo do hunk, detectada ANTES de
  // qualquer aplicação. Recusa determinística, nunca reparo: acrescentar '+', '-' ou ' ' adivinhando
  // o que é contexto/adição mudaria a semântica do patch em silêncio (e o requisito de correção é
  // que o CODER emita um diff aplicável, ou que outro modelo assuma).
  if (parsed.bodyPrefixViolations.length > 0) {
    const described = parsed.bodyPrefixViolations
      .map((v) => `${v.path || '(arquivo desconhecido)'} hunk ${v.hunkIndex} (${v.bareLines} linha(s) sem prefixo de ${v.bodyLines} do corpo)`)
      .join('; ');
    issues.push({
      code: FAILURE_CODES.PATCH_BODY_MISSING_PREFIX,
      message: `Corpo de hunk sem prefixo de unified diff ('+', '-' ou ' ') — patch inaplicável por git apply: ${described}`,
      violations: parsed.bodyPrefixViolations,
    });
    return { ok: false, code: FAILURE_CODES.PATCH_BODY_MISSING_PREFIX, issues, files: parsed.files, touchedPaths: touchedPathsOf(parsed) };
  }

  const touchedPaths = touchedPathsOf(parsed);

  for (const f of parsed.files) {
    if (f.isBinary) {
      issues.push({ code: FAILURE_CODES.PATCH_BINARY_CHANGE, message: `Alteração binária não permitida: ${f.newPath || f.oldPath}` });
    }
    if (f.isDeleted && contract.allowDeletes !== true) {
      issues.push({ code: FAILURE_CODES.PATCH_UNEXPECTED_DELETE, message: `Delete não autorizado pelo Task Contract: ${f.oldPath}` });
    }
    const target = f.newPath && f.newPath !== '/dev/null' ? f.newPath : f.oldPath;
    if (SECRET_LIKE_FILENAMES.some((re) => re.test(target))) {
      issues.push({ code: FAILURE_CODES.PATCH_FORBIDDEN_FILE, message: `Arquivo sensível não pode ser alterado por patch: ${target}` });
    }
  }

  const boundary = checkPathBoundary(touchedPaths, contract);
  if (!boundary.ok) {
    // ER-V1-FINAL-003: propaga o code exato de checkPathBoundary — NO_PATCH_SCOPE (ausência
    // total de escopo declarado) é distinto de PATCH_OUTSIDE_ALLOWED_SCOPE (caminho específico
    // fora de um escopo que FOI declarado), nunca reportado como se fosse o mesmo motivo.
    const message = boundary.code === FAILURE_CODES.NO_PATCH_SCOPE
      ? 'Task Contract sem allowedPaths declarado — patch recusado (fail-closed)'
      : 'Patch toca caminho fora do escopo autorizado';
    issues.push({ code: boundary.code, message, violations: boundary.violations });
  }

  if (issues.length > 0) {
    return { ok: false, code: issues[0].code, issues, files: parsed.files, touchedPaths };
  }

  return { ok: true, issues: [], files: parsed.files, touchedPaths };
}

module.exports = {
  DEFAULT_MAX_PATCH_SIZE_BYTES,
  parseUnifiedDiff,
  touchedPathsOf,
  validatePatch,
};
