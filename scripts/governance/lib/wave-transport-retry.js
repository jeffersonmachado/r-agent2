'use strict';

/**
 * wave-transport-retry.js — classificação PURA de falha de TRANSPORTE em ondas
 * de superfície (API/Page Surface Wave).
 *
 * Evidência real (2026-09-13, r-agent2): a Page Surface Wave reprovava páginas
 * DIFERENTES a cada execução com `net::ERR_NETWORK_CHANGED` em todos os samples
 * — inclusive `Failed to fetch dynamically imported module: …/DemoPage.jsx`. O
 * host tinha bridges Docker subindo/caindo (`br-* NO-CARRIER`), o que dispara
 * NetworkChangeNotifier no Chromium e ABORTA requisições em voo. Verificação
 * independente no browser real (login systemadmin → tenant system →
 * /fitness/students) renderizou a página completa, sem erro de console, no
 * mesmo intervalo.
 *
 * Um reset de transporte aborta o probe ANTES de qualquer veredito sobre a
 * página. Este módulo decide, de forma determinística, se o sinal observado é
 * exclusivamente de transporte — condição para repetir o probe. Nunca
 * classifica falha de aplicação (console.error do app, console.error de
 * assertiva, 4xx/5xx da aplicação) como transporte: esses continuam
 * reprovando.
 */

/** Erros de rede/transporte que NÃO são veredito sobre a página. */
const TRANSPORT_ERROR_PATTERN = /net::ERR_(NETWORK_CHANGED|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_ABORTED|CONNECTION_REFUSED|EMPTY_RESPONSE|SOCKET_NOT_CONNECTED|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED)|Failed to fetch dynamically imported module/i;

/** Quantos samples de erro do probe são de transporte. */
function countTransportSignals(probe) {
  if (!probe || typeof probe !== 'object') return 0;
  const samples = Array.isArray(probe.errorSamples) ? probe.errorSamples : [];
  return samples.filter((sample) => TRANSPORT_ERROR_PATTERN.test(String(sample))).length;
}

/** O probe falhou por transporte (e apenas por isso)? */
function isTransportOnlyFailure(probe) {
  if (!probe || typeof probe !== 'object') return false;
  if (probe.error) return true; // erro de navegação/rede: sem veredito
  const signals = countTransportSignals(probe);
  if (signals === 0) return false;
  // Se houver QUALQUER sample de erro que não seja de transporte, não é
  // "somente transporte" — o probe tem sinal de aplicação e deve reprovar.
  const samples = Array.isArray(probe.errorSamples) ? probe.errorSamples : [];
  const nonTransport = samples.filter((sample) => !TRANSPORT_ERROR_PATTERN.test(String(sample)));
  return nonTransport.length === 0;
}

/** Decisão de repetição, com limite explícito. */
function shouldRetryProbe(probe, attempt, maxAttempts = 2) {
  if (attempt >= maxAttempts) return false;
  return isTransportOnlyFailure(probe) || isInconclusiveProbe(probe);
}

/**
 * Probe INCONCLUSIVO: terminou sem veredito (não renderizou, não é superfície de
 * login, não foi negado) E sem nenhum sinal de erro da aplicação.
 *
 * Evidência real (2026-09-13): `/dev/qa-waves/enterprise-governance` falhava
 * com `rendered=false`, `consoleErrors=0`, `pageErrors=0` — e a página renderiza
 * completa no browser real (verificado: cabeçalho + Smoke Lineage + Replay
 * Artifacts) alguns segundos depois. Era orçamento de espera curto sob
 * concorrência, não defeito da tela. Probe sem veredito não pode virar
 * veredito: repete uma vez.
 */
function isInconclusiveProbe(probe) {
  if (!probe || typeof probe !== 'object' || probe.error) return false;
  if (probe.rendered || probe.loginSurface || probe.denied) return false;
  // Qualquer amostra de erro (mesmo sem contador) já é sinal de aplicação —
  // não é "sem veredito", é veredito de falha.
  if (Array.isArray(probe.errorSamples) && probe.errorSamples.length > 0) return false;
  const consoleErrors = Number(probe.consoleErrors || 0);
  const pageErrors = Number(probe.pageErrors || 0);
  return consoleErrors === 0 && pageErrors === 0;
}

module.exports = {
  TRANSPORT_ERROR_PATTERN,
  countTransportSignals,
  isTransportOnlyFailure,
  isInconclusiveProbe,
  shouldRetryProbe,
};
