'use strict';

/**
 * engine/engineeringRouter/diffCanonicalizer.js
 *
 * HUMAN_EXTERNAL_BOOTSTRAP (2026-10-07) — CANONICALIZAÇÃO DETERMINÍSTICA DE HEADERS DE ARQUIVO
 * AUSENTES em unified diff. Autorizada explicitamente e com escopo fechado pelo dono da
 * plataforma.
 *
 * PROBLEMA MEDIDO: o coder `qwen:qwen3-coder-flash` emite o bloco como
 *     diff --git a/<PATH> b/<PATH>
 *     @@ -1,5 +1,5 @@          <-- faltam '--- a/<PATH>' e '+++ b/<PATH>'
 * e o `git apply` recusa o patch inteiro com "patch fragment without header". O validador
 * estrutural APROVA (o corpo tem prefixos válidos), então a tentativa é queimada em
 * `PATCH_APPLY_FAILED` — medido: 7 de 49 `PATCH_APPLY_FAILED` da amostra real são exatamente
 * este defeito, e ele aparece em toda primeira tentativa desse modelo.
 *
 * O QUE ESTE MÓDULO FAZ: quando (e somente quando) o bloco declara `diff --git a/<P> b/<P>` e
 * falta APENAS o par de headers de arquivo — `--- a/<P>` e/ou `+++ b/<P>` — que é derivável
 * DIRETAMENTE desses paths, insere os headers ausentes antes do primeiro `@@`. É reconstrução de
 * METADADO a partir de dado já declarado no próprio patch, não reparo de conteúdo.
 *
 * O QUE ESTE MÓDULO NUNCA FAZ (proibido pela autorização, e coberto por teste negativo):
 *   - inventar/alterar linhas '+' ou '-' ou transformar contexto;
 *   - alterar hunks ou corrigir contagens de header de hunk;
 *   - modificar qualquer linha produzida pelo modelo;
 *   - escolher paths por heurística (path vem SEMPRE do `diff --git`, e só quando a/b coincidem);
 *   - corrigir contexto não encontrado, resolver conflitos, fazer fuzzy apply;
 *   - mascarar source stale ou alterar `source_commit`;
 *   - adaptar semanticamente o patch;
 *   - aceitar patch que continue inválido (a revalidação estrutural e o `git apply --check`
 *     continuam valendo depois da canonicalização, e o patch original é preservado como evidência).
 *
 * Ambiguidade ⇒ NÃO canonicaliza aquele bloco (o patch segue exatamente como o modelo emitiu).
 */

const FILE_HEADER_RE = /^diff --git a\/(.+?) b\/(.+)$/;
const MINUS_FILE_HEADER_RE = /^--- a\/(.+)$/;
const PLUS_FILE_HEADER_RE = /^\+\+\+ b\/(.+)$/;
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;

/**
 * Marcadores que mudam a semântica do bloco (rename/copy/new/delete/binário). Nesses casos o par
 * de headers NÃO é derivável de forma inequívoca do `diff --git`, então o bloco é deixado intacto.
 */
const NON_DERIVABLE_MARKERS = Object.freeze([
  /^new file mode /,
  /^deleted file mode /,
  /^rename from /,
  /^rename to /,
  /^copy from /,
  /^copy to /,
  /^similarity index /,
  /^dissimilarity index /,
  /^Binary files /,
  /^GIT binary patch/,
]);

/**
 * Canonicaliza os blocos de um unified diff que declararam `diff --git` mas perderam o par de
 * headers de arquivo, quando a derivação é 100% determinística e inequívoca.
 *
 * @param {string} diffText saída CRUA do modelo
 * @returns {{applied:boolean, text:string, blocks:Array, skipped:Array}}
 */
function canonicalizeMissingFileHeaders(diffText) {
  const original = String(diffText || '');
  const result = { applied: false, text: original, blocks: [], skipped: [] };
  if (!original.trim()) return result;

  const endsWithNewline = original.endsWith('\n');
  const lines = original.split('\n');

  // Índices das linhas de abertura de bloco (`diff --git`).
  const blockStarts = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (FILE_HEADER_RE.test(lines[i])) blockStarts.push(i);
  }
  if (blockStarts.length === 0) return result;

  const insertions = []; // { atIndex, lines: string[], path, missing, derived }

  for (let b = 0; b < blockStarts.length; b += 1) {
    const start = blockStarts[b];
    const end = b + 1 < blockStarts.length ? blockStarts[b + 1] - 1 : lines.length - 1;
    const match = FILE_HEADER_RE.exec(lines[start]);
    const aPath = normalizePath(match[1]);
    const bPath = normalizePath(match[2]);

    const blockLines = lines.slice(start + 1, end + 1);
    const skip = (reason) => result.skipped.push({ path: `${aPath} -> ${bPath}`, reason });

    // 1) O par de headers só é derivável quando a/b do `diff --git` apontam para o MESMO path.
    //    Paths diferentes indicam rename/copy e exigem contrato explícito (fora do escopo).
    if (aPath !== bPath) { skip('paths a/b diferentes no diff --git (rename/copy) — derivação ambígua'); continue; }
    if (aPath === '/dev/null' || bPath === '/dev/null') { skip('path /dev/null (novo/removido) — derivação ambígua'); continue; }

    // 2) Marcadores que mudam a semântica do bloco: header não é derivável.
    const blocker = blockLines.find((l) => NON_DERIVABLE_MARKERS.some((re) => re.test(l)));
    if (blocker) { skip(`marcador não derivável no bloco: ${blocker.trim().slice(0, 60)}`); continue; }

    // 3) Primeiro hunk do bloco — onde os headers precisam aparecer.
    const firstHunkOffset = blockLines.findIndex((l) => HUNK_HEADER_RE.test(l));
    if (firstHunkOffset === -1) { skip('bloco sem hunk (@@) — nada a canonicalizar'); continue; }

    // 4) Headers presentes ANTES do primeiro hunk.
    const beforeHunk = blockLines.slice(0, firstHunkOffset);
    const minusHeader = beforeHunk.find((l) => MINUS_FILE_HEADER_RE.test(l)) || null;
    const plusHeader = beforeHunk.find((l) => PLUS_FILE_HEADER_RE.test(l)) || null;
    if (minusHeader && plusHeader) continue; // bloco íntegro: NUNCA tocar.

    // 5) Se um dos headers existe, ele precisa ser CONSISTENTE com o `diff --git`; caso contrário
    //    a derivação do que falta deixaria de ser inequívoca.
    if (minusHeader && normalizePath(MINUS_FILE_HEADER_RE.exec(minusHeader)[1]) !== aPath) {
      skip('header --- presente aponta para path diferente do diff --git — ambíguo');
      continue;
    }
    if (plusHeader && normalizePath(PLUS_FILE_HEADER_RE.exec(plusHeader)[1]) !== bPath) {
      skip('header +++ presente aponta para path diferente do diff --git — ambíguo');
      continue;
    }

    const missing = [];
    const derived = [];
    if (!minusHeader) { missing.push('---'); derived.push(`--- a/${aPath}`); }
    if (!plusHeader) { missing.push('+++'); derived.push(`+++ b/${bPath}`); }

    insertions.push({
      atIndex: start + 1 + firstHunkOffset,
      lines: derived,
      path: aPath,
      missingHeaders: missing,
      derivedHeaders: derived,
      hunkLineNumber: start + 1 + firstHunkOffset + 1,
    });
  }

  if (insertions.length === 0) return result;

  // Aplicação de trás para frente: preserva os índices ainda não processados.
  const out = [...lines];
  for (const insertion of [...insertions].sort((x, y) => y.atIndex - x.atIndex)) {
    out.splice(insertion.atIndex, 0, ...insertion.lines);
  }

  let text = out.join('\n');
  if (endsWithNewline && !text.endsWith('\n')) text += '\n';

  return {
    applied: true,
    text,
    blocks: insertions.map((i) => ({
      path: i.path,
      missingHeaders: i.missingHeaders,
      derivedHeaders: i.derivedHeaders,
      hunkLineNumber: i.hunkLineNumber,
    })),
    skipped: result.skipped,
  };
}

/** Normaliza um path declarado no patch (remove './' à esquerda e espaços das pontas). */
function normalizePath(value) {
  return String(value === null || value === undefined ? '' : value).trim().replace(/^\.\//, '');
}

module.exports = {
  NON_DERIVABLE_MARKERS,
  canonicalizeMissingFileHeaders,
};
