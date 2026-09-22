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

/**
 * Faz o parsing de um unified diff em uma lista estruturada de arquivos tocados.
 * Tolerante o bastante para diffs reais gerados por `git diff`/`git format-patch`; não tenta
 * ser um parser completo (a aplicação real via `git apply --check` é a fonte de verdade de
 * sintaxe). Aqui só precisamos saber: quais arquivos, é binário, é delete, é novo, tamanho.
 */
function parseUnifiedDiff(diffText) {
  const text = String(diffText || '');
  if (!text.trim()) {
    return { files: [], hasAnyFileHeader: false, hasAnyHunk: false };
  }

  const lines = text.split('\n');
  const files = [];
  let current = null;
  let sawHunk = false;
  let sawBinary = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fileMatch = FILE_HEADER_RE.exec(line);
    if (fileMatch) {
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
    if (HUNK_HEADER_RE.test(line)) {
      current.hunkCount += 1;
      sawHunk = true;
    }
  }

  return { files, hasAnyFileHeader: files.length > 0, hasAnyHunk: sawHunk, hasAnyBinary: sawBinary };
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
