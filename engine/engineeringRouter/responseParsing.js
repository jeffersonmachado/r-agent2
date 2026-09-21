'use strict';

/**
 * engine/engineeringRouter/responseParsing.js
 *
 * Extração determinística de JSON estruturado a partir da resposta textual de um LLM. O
 * CODER/REVIEWER são instruídos a responder SOMENTE JSON, mas providers reais às vezes
 * envolvem a resposta em ```json ... ``` ou acrescentam texto antes/depois — este módulo
 * tolera isso sem aceitar texto livre como substituto de dado estruturado.
 *
 * Módulo puro (sem I/O).
 */

function extractJsonBlock(text) {
  const raw = String(text || '');
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1] : raw;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  return candidate.slice(firstBrace, lastBrace + 1);
}

/**
 * @returns {{ok:true, value:Object}|{ok:false, error:string, message?:string}}
 */
function parseStructuredJson(text) {
  const block = extractJsonBlock(text);
  if (!block) return { ok: false, error: 'NO_JSON_FOUND' };
  try {
    return { ok: true, value: JSON.parse(block) };
  } catch (err) {
    return { ok: false, error: 'INVALID_JSON', message: err.message };
  }
}

function jsonStringUnescapeBestEffort(value) {
  return String(value || '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/**
 * Fallback de reparo para a resposta do CODER (`{"summary": "...", "diff": "..."}`).
 *
 * Achado real (pilot V1): quando a tarefa envolve gerar/testar código que por sua vez contém
 * exemplos de string JSON (ex.: um teste unitário de um parser de JSON, com fixtures como
 * `'{"a":"b"}'` dentro do próprio diff), o modelo pode escapar as aspas internas do diff de um
 * jeito que quebra o `JSON.parse` ingênuo do envelope externo — mesmo com `summary`/`diff` na
 * ordem certa e o texto sendo, na intenção, um JSON bem formado. `parseStructuredJson` ainda é
 * a via primária (rápida, cobre o caso comum); isto é usado apenas quando ela falha.
 *
 * Estratégia: localizar `"diff"` e extrair tudo entre a aspas de abertura do seu valor e a
 * ÚLTIMA aspas do texto que antecede o fechamento do objeto — sem depender de `JSON.parse`
 * conseguir interpretar o miolo — e desfazer o escaping mais comum manualmente. Isso é
 * suficiente porque, no prompt do CODER, `diff` é sempre o último campo do objeto.
 *
 * @returns {{summary:string, diff:string}|null}
 */
function repairCoderResponse(text) {
  const raw = String(text || '');
  const summaryMatch = raw.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)"/);

  const diffKeyIndex = raw.indexOf('"diff"');
  if (diffKeyIndex === -1) return null;
  const colonIndex = raw.indexOf(':', diffKeyIndex);
  if (colonIndex === -1) return null;

  let cursor = colonIndex + 1;
  while (cursor < raw.length && /\s/.test(raw[cursor])) cursor += 1;
  if (raw[cursor] !== '"') return null;
  const diffValueStart = cursor + 1;

  const tail = raw.slice(diffValueStart);
  const closeMatch = tail.match(/"\s*\}\s*(```)?\s*$/);
  if (!closeMatch) return null;

  const rawDiff = tail.slice(0, closeMatch.index);
  const diff = jsonStringUnescapeBestEffort(rawDiff);
  if (!diff.trim()) return null;

  const summary = summaryMatch ? jsonStringUnescapeBestEffort(summaryMatch[1]) : '';
  return { summary, diff };
}

module.exports = {
  extractJsonBlock,
  parseStructuredJson,
  repairCoderResponse,
};
