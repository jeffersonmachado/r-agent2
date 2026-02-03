import { fetchJson } from './client';

/**
 * Gera sugestões de perguntas (FAQ) agrupadas.
 *
 * Endpoint: POST /system/generate-faq
 */
export function generateFaqSuggestions(payload) {
  return fetchJson('/system/generate-faq', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
    timeoutMs: 60000,
    silent: true,
  });
}

/**
 * Gera respostas para um conjunto de perguntas (FAQ) usando contexto do tenant.
 *
 * Endpoint: POST /system/generate-faq-answers
 */
export function generateFaqAnswers(payload) {
  return fetchJson('/system/generate-faq-answers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
    timeoutMs: 60000,
    silent: true,
  });
}

