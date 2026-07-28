'use strict';

/**
 * Filtros de ruído de página para validação RPA.
 *
 * Extraído de api/services/rpaService.impl.js (isIgnorableOnboardingNoise)
 * para ser testável isoladamente, acrescido do filtro de sonda de sessão.
 *
 * Regra geral: só é ruído aquilo que a aplicação TRATA por desenho e que não
 * indica defeito — telemetria best-effort (sendBeacon), falhas de rede do
 * fluxo de onboarding e a sonda de sessão /auth/me (401 = "não autenticado",
 * resposta correta que dispara login). Qualquer outra falha continua
 * crítica: 5xx, erros funcionais, exceções JS e 401 fora da sonda de auth.
 */

function asText(value) {
  return String(value || '');
}

/**
 * Ruído do fluxo de onboarding e da telemetria do Learning Core.
 * (Lógica movida verbatim de rpaService.impl.js.)
 */
function isIgnorableOnboardingNoise(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const url = asText(entry.url || entry.path || '');
  const message = asText(entry.message || entry.text || entry.error || '');
  const type = asText(entry.type || '').trim().toLowerCase();
  // Telemetria do Learning Core é best-effort por desenho (sendBeacon no
  // pagehide/unload). Um request_failed do ingest — típico quando o browser
  // fecha ou navega no meio do beacon — não é falha de produto.
  const hasLearningTelemetryRef = /\/api\/learning\/interactions(?:\?|$)/i.test(url);
  if (hasLearningTelemetryRef && type === 'request_failed') return true;
  const hasOnboardingRef = /\/onboarding\/(?:start|status|complete|complete-step)(?:\?|$)/i.test(url)
    || /\/onboarding\/(?:start|status|complete|complete-step)/i.test(message)
    || /Erro ao carregar status de onboarding/i.test(message)
    || /Erro ao carregar onboarding/i.test(message)
    || /Toast.*onboarding/i.test(message);
  if (!hasOnboardingRef) return false;

  if (type === 'request_failed') return true;
  // Toast de erro de onboarding é consequência direta da falha de rede
  if (/Toast.*onboarding/i.test(message)) return true;
  return /failed to fetch|api não acessível|err_connection_refused|fetch.*failed/i.test(message);
}

/**
 * Sonda de sessão: o frontend chama /auth/me na inicialização para saber se
 * há sessão válida. 401 é a resposta CORRETA para anônimo/sessão expirada —
 * o app trata com retry (fetchAuthWithRetry) e fluxo de login. O browser
 * emite "Failed to load resource: 401" no console; isso não é defeito da
 * página. Se a sessão quebrar de verdade no meio do cenário, os passos
 * funcionais reprovam (redirect para login, elementos ausentes).
 */
function isIgnorableAuthProbeNoise(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const url = asText(entry.url || entry.path || '');
  const message = asText(entry.message || entry.text || entry.error || '');
  const blob = `${url}\n${message}`;
  const touchesAuthMe = /\/auth\/me(?![\w/])/i.test(blob);
  if (!touchesAuthMe) return false;
  // Somente a resposta de recurso 401/403 da sonda é ruído; 5xx em /auth/me
  // é falha real do backend e continua crítico.
  return /failed to load resource[^\n]*\b(?:401|403)\b/i.test(message)
    || (/\b(?:401|403)\b/.test(message) && /failed to load resource/i.test(message));
}

/**
 * Filtro combinado usado pela validação de página do RPA.
 */
function isIgnorablePageNoise(entry) {
  return isIgnorableOnboardingNoise(entry) || isIgnorableAuthProbeNoise(entry);
}

module.exports = {
  isIgnorableOnboardingNoise,
  isIgnorableAuthProbeNoise,
  isIgnorablePageNoise,
};
