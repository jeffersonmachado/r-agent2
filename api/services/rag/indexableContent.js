'use strict';

/**
 * Conteúdo indexável do RAG.
 *
 * Documento sem texto extraído recebe o placeholder abaixo como CONTEÚDO, só
 * para continuar listável como asset (nome do arquivo, metadados, binário).
 * Esse texto NÃO tem o que embeddar: indexá-lo cria um "chunk fantasma" que
 * pontua alto e entra nas respostas do copiloto — medido em 2026-10-08, um
 * `.jpeg` sem OCR foi a 1ª FONTE de "Como faço uma matrícula?" (score 0.70), à
 * frente dos manuais de jornada, e reapareceu nas fontes de "O que é o RAP?".
 *
 * A regra vive num único módulo puro porque estava duplicada por omissão: a
 * ingestão gravava o placeholder e o indexador o aceitava como conteúdo válido —
 * corrigir só um dos dois deixaria o defeito entrar pelo outro caminho.
 */

const NO_TEXT_PLACEHOLDER = 'Sem texto extraído. Indexando metadados do arquivo.';
const NO_TEXT_PLACEHOLDER_WEB = 'Sem texto extraído. Indexando metadados do site.';

const PLACEHOLDER_PATTERNS = [
  // Placeholders gravados por ESTE repositório (upload de arquivo e scraping).
  /^sem texto extra[ií]do\b/i,
  // Outras frases de "nada foi extraído" já usadas em versões anteriores.
  // Ancoradas no INÍCIO de propósito: um documento real que EXPLICA o fallback
  // (runbook) continua indexável — a regra é sobre o conteúdo SER só o
  // placeholder, não sobre ele conter a frase.
  /^não foi possível extrair conteúdo automaticamente\b/i,
  /^\[arquivo:.+não foi possível extrair\b/i,
];

/**
 * O texto é APENAS o placeholder de "sem texto extraído"?
 *
 * Texto vazio devolve `false` (vazio é ausência, não placeholder) — quem decide
 * se vazio é indexável é `hasIndexableContent`.
 */
function isPlaceholderOnlyContent(text) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) return false;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * O conteúdo pode ser embeddado e recuperado?
 *
 * @param {unknown} text conteúdo do documento (ou texto extraído)
 * @returns {boolean} false para vazio/ausente e para placeholder
 */
function hasIndexableContent(text) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) return false;
  return !isPlaceholderOnlyContent(value);
}

module.exports = {
  NO_TEXT_PLACEHOLDER,
  NO_TEXT_PLACEHOLDER_WEB,
  isPlaceholderOnlyContent,
  hasIndexableContent,
};
