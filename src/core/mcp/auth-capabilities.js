'use strict';

/**
 * auth-capabilities — VERDADE sobre o que cada modo de autenticação MCP
 * realmente implementa (§M13–M18 da missão corretiva).
 *
 * Problema corrigido: `AUTH_MODES` listava seis modos e `validateConnection`
 * aceitava todos — declarar "SUPPORTED" apenas porque o enum existe. Dois casos
 * eram falsos:
 *
 *   - `mtls`: o hub devolvia o header `X-Client-Cert-Ref`. Header NÃO é mTLS:
 *     não há handshake com certificado de cliente, chave privada nem política de
 *     CA. Um atacante com o valor do header passaria por autenticado.
 *   - `oauth2`: apenas um bearer estático. Não há `token_endpoint`, escopo,
 *     expiração nem reaquisição — o que existe é um token de longa duração.
 *
 * Este módulo é a FONTE ÚNICA da verdade. Hub, control plane e gate leem daqui,
 * de modo que nenhuma superfície possa declarar mais do que o runtime faz.
 *
 * Taxonomia:
 *   IMPLEMENTED          — funciona de ponta a ponta como declarado.
 *   PARTIAL              — funciona com escopo reduzido conhecido (documentado).
 *   UNSUPPORTED          — não implementado; usar em PRODUCTION é proibido.
 *   TEST_ONLY            — legítimo apenas fora de PRODUCTION.
 */

const AUTH_CAPABILITY_STATES = Object.freeze({
  IMPLEMENTED: 'IMPLEMENTED',
  PARTIAL: 'PARTIAL',
  UNSUPPORTED: 'UNSUPPORTED',
  TEST_ONLY: 'TEST_ONLY',
});

/**
 * Estado REAL por modo. `limitation` é obrigatório para PARTIAL/UNSUPPORTED/
 * TEST_ONLY — a limitação precisa ser auditável, não uma nota de rodapé.
 */
const AUTH_CAPABILITIES = Object.freeze({
  bearer: Object.freeze({
    state: AUTH_CAPABILITY_STATES.IMPLEMENTED,
    transport: 'Authorization: Bearer <token>',
    limitation: null,
  }),
  api_key: Object.freeze({
    state: AUTH_CAPABILITY_STATES.IMPLEMENTED,
    transport: 'X-API-Key: <key>',
    limitation: null,
  }),
  service_principal: Object.freeze({
    state: AUTH_CAPABILITY_STATES.IMPLEMENTED,
    transport: 'credencial de service principal resolvida por referência',
    limitation: null,
  }),
  oauth2: Object.freeze({
    state: AUTH_CAPABILITY_STATES.PARTIAL,
    transport: 'Authorization: Bearer <token estático>',
    limitation:
      'Token estático por referência. NÃO há fluxo OAuth2 completo (client_credentials, '
      + 'token_endpoint, expiração, refresh/reaquisição, validação de escopo). Rotação é manual.',
  }),
  mtls: Object.freeze({
    state: AUTH_CAPABILITY_STATES.UNSUPPORTED,
    transport: null,
    limitation:
      'Não implementado: exige handshake TLS com certificado de cliente (client cert + '
      + 'private key + política de CA). Enviar `X-Client-Cert-Ref` NÃO é mTLS.',
  }),
  no_auth: Object.freeze({
    state: AUTH_CAPABILITY_STATES.TEST_ONLY,
    transport: null,
    limitation:
      'Permitido apenas fora de PRODUCTION e somente com opt-in explícito (allowNoAuth). '
      + 'Conexão anônima em PRODUCTION é proibida.',
  }),
});

const ALL_AUTH_MODES = Object.freeze(Object.keys(AUTH_CAPABILITIES));

/** `true` apenas quando o modo funciona de ponta a ponta como declarado. */
function isImplemented(authType) {
  const capability = AUTH_CAPABILITIES[String(authType || '').toLowerCase()];
  return Boolean(capability && capability.state === AUTH_CAPABILITY_STATES.IMPLEMENTED);
}

/**
 * Valida se o modo pode ser USADO na classificação informada.
 *
 * Fail-closed: modo desconhecido é recusado; modo UNSUPPORTED é recusado sempre;
 * TEST_ONLY é recusado em PRODUCTION. PARTIAL é aceito FORA de PRODUCTION e
 * aceito em PRODUCTION apenas porque o modo funciona com limitação documentada —
 * porém o consumidor recebe `partial: true` para não declarar conformidade plena.
 *
 * @returns {{ ok: boolean, state: string, reason: string|null, partial: boolean }}
 */
function evaluateAuthModeUse(authType, { classification = 'PRODUCTION', allowNoAuth = false } = {}) {
  const mode = String(authType || '').toLowerCase();
  const capability = AUTH_CAPABILITIES[mode];
  const isProduction = String(classification || '').toUpperCase() === 'PRODUCTION';

  if (!capability) {
    return { ok: false, state: 'UNKNOWN', reason: `auth_mode_unknown: '${authType}'`, partial: false };
  }
  if (capability.state === AUTH_CAPABILITY_STATES.UNSUPPORTED) {
    return { ok: false, state: capability.state, reason: `auth_mode_unsupported: ${mode} — ${capability.limitation}`, partial: false };
  }
  if (mode === 'no_auth') {
    if (isProduction) {
      return { ok: false, state: capability.state, reason: 'auth_mode_forbidden_in_production: no_auth', partial: false };
    }
    if (allowNoAuth !== true) {
      return { ok: false, state: capability.state, reason: 'auth_mode_requires_optin: no_auth exige allowNoAuth=true', partial: false };
    }
    return { ok: true, state: capability.state, reason: null, partial: false };
  }
  if (capability.state === AUTH_CAPABILITY_STATES.PARTIAL) {
    return { ok: true, state: capability.state, reason: capability.limitation, partial: true };
  }
  return { ok: true, state: capability.state, reason: null, partial: false };
}

/**
 * Cabeçalhos de autenticação para o modo informado.
 *
 * `mtls` NÃO devolve header: mTLS acontece no handshake TLS, não em header. Se o
 * modo exigir transporte, o chamador recebe erro explícito em vez de um header
 * que finge autenticar.
 */
function buildAuthHeaders(authType, secret, { classification = 'PRODUCTION', allowNoAuth = false } = {}) {
  const mode = String(authType || '').toLowerCase();
  const use = evaluateAuthModeUse(mode, { classification, allowNoAuth });
  if (!use.ok) throw new Error(`mcp_auth_unavailable: ${use.reason}`);
  if (mode === 'no_auth') return {};
  if (mode === 'mtls') {
    throw new Error('mcp_auth_unavailable: mtls exige handshake TLS com certificado de cliente; não há header equivalente');
  }
  if (mode === 'api_key') return { 'X-API-Key': secret };
  // bearer, oauth2 (token estático) e service_principal usam bearer no transporte.
  return { Authorization: `Bearer ${secret}` };
}

module.exports = {
  AUTH_CAPABILITY_STATES,
  AUTH_CAPABILITIES,
  ALL_AUTH_MODES,
  isImplemented,
  evaluateAuthModeUse,
  buildAuthHeaders,
};
