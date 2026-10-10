'use strict';

/**
 * engine/engineeringRouter/hunkNormalizer.js
 *
 * Achado real (pilot V1): LLMs geram o CONTEÚDO de um hunk corretamente com frequência, mas
 * erram a CONTAGEM declarada no header (`@@ -oldStart,oldCount +newStart,newCount @@`) — um
 * erro sistemático e bem conhecido na geração de diffs por modelo (contar linhas com precisão
 * não é o forte de um LLM). `git apply` é estrito: se a contagem não bater com o corpo real do
 * hunk, ele rejeita o patch inteiro com "patch corrompido", mesmo que o conteúdo em si esteja
 * perfeito e aplicável.
 *
 * Este módulo recalcula a contagem real de cada hunk a partir do próprio corpo (linhas de
 * contexto/remoção contam para o lado "old"; contexto/adição contam para o lado "new") e
 * reescreve o header — SEM alterar `oldStart`/`newStart` (esses geralmente estão corretos) nem
 * uma linha sequer do conteúdo. Puro, sem I/O.
 */

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/**
 * Marcador do formato unified diff que sucede a linha (de contexto/remoção/adição) SEM newline
 * final. NÃO é uma linha de conteúdo: não pertence ao lado "old" nem ao lado "new" do hunk.
 * Ver `NO_NEWLINE_MARKER` abaixo para o defeito medido que a checagem corrige.
 */
const NO_NEWLINE_MARKER_RE = /^\\ No newline at end of file$/;

/**
 * @param {string} diffText
 * @returns {string} diff com os headers de hunk recalculados a partir do corpo real
 */
function normalizeHunkHeaders(diffText) {
  // Normaliza newlines finais redundantes para um só ANTES de dividir em linhas — modelos às
  // vezes acrescentam mais de uma quebra de linha ao final da resposta, e cada uma delas vira
  // um elemento "" extra em `split('\n')`, que sem este passo seria contado como uma linha de
  // contexto vazia fantasma dentro do último hunk (inflando oldCount/newCount).
  const source = String(diffText || '');
  const hadTrailingNewline = source.endsWith('\n');
  const normalizedText = source.replace(/\n+$/, '\n');
  const lines = normalizedText.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const match = HUNK_HEADER_RE.exec(line);
    if (!match) {
      out.push(line);
      i += 1;
      continue;
    }

    const oldStart = match[1];
    const newStart = match[3];
    const trailer = match[5] || '';

    // Consome o corpo do hunk: linhas de contexto (' '), remoção ('-') ou adição ('+'), até a
    // próxima linha de header/arquivo ou o fim do texto. Uma linha vazia real (sem nenhum
    // prefixo) só pertence ao hunk se vier ANTES do próximo `diff --git`/`@@`/fim — tratada
    // como contexto vazio (comportamento tolerante, comum quando o modelo omite o espaço
    // inicial de uma linha de contexto em branco).
    let oldCount = 0;
    let newCount = 0;
    const body = [];
    let j = i + 1;
    while (j < lines.length) {
      const bodyLine = lines[j];
      if (bodyLine.startsWith('diff --git') || HUNK_HEADER_RE.test(bodyLine) || bodyLine.startsWith('--- ') || bodyLine.startsWith('+++ ')) {
        break;
      }
      // A ÚLTIMA linha de `text.split('\n')` é sempre "" quando o texto termina com '\n' —
      // representa apenas o fim do arquivo/string, não uma linha real do hunk. Sem esta
      // checagem ela seria contada como uma linha de contexto vazia fantasma, inflando
      // oldCount/newCount e corrompendo a contagem recém-calculada.
      const isTrailingEmptyOfWholeText = bodyLine === '' && j === lines.length - 1;
      if (isTrailingEmptyOfWholeText) {
        j += 1;
        break;
      }
      // DEFEITO MEDIDO (2026-10-08): `\ No newline at end of file` é um MARCADOR do formato,
      // não uma linha de conteúdo — acompanha a linha anterior (que não termina em newline) e não
      // conta para oldCount nem newCount. Sem esta checagem ele caía no ramo de contexto (não
      // começa com '+', '-' nem ' ') e inflava AMBOS os lados em +1. Medido em diff REAL do
      // `git diff` (arquivo sem newline final): `@@ -1 +1 @@` virava `@@ -1,3 +1,3 @@`, e o
      // `git apply` recusava o patch inteiro como "corrompido" — a tentativa era queimada
      // (PATCH_APPLY_FAILED + reroute indevido) por defeito do normalizador, não do modelo.
      if (NO_NEWLINE_MARKER_RE.test(bodyLine)) {
        body.push(bodyLine);
        j += 1;
        continue;
      }
      if (bodyLine.startsWith('+')) {
        newCount += 1;
      } else if (bodyLine.startsWith('-')) {
        oldCount += 1;
      } else {
        // contexto (prefixo ' ' ou linha vazia tratada como contexto vazio)
        oldCount += 1;
        newCount += 1;
      }
      body.push(bodyLine);
      j += 1;
    }

    const oldHeader = oldCount === 1 ? `${oldStart}` : `${oldStart},${oldCount}`;
    const newHeader = newCount === 1 ? `${newStart}` : `${newStart},${newCount}`;
    out.push(`@@ -${oldHeader} +${newHeader} @@${trailer}`);
    out.push(...body);
    i = j;
  }

  const rebuilt = out.join('\n');
  // IDENTIDADE quando nada precisa ser corrigido: só restaura o newline final que JÁ existia na
  // entrada (e nunca inventa um para texto que não tinha). Sem isso a função sempre devolvia uma
  // string diferente da entrada e o chamador não conseguia distinguir "normalizei" de "não mexi"
  // — distinção que `applyDiffPolicy` usa para decidir se houve reparo de verdade.
  if (rebuilt === '') return '';
  if (rebuilt.endsWith('\n')) return rebuilt;
  return hadTrailingNewline ? `${rebuilt}\n` : rebuilt;
}

module.exports = {
  normalizeHunkHeaders,
};
