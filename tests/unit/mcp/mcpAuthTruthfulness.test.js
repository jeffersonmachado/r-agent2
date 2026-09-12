'use strict';

/**
 * M13–M18 — VERDADE dos modos de autenticação MCP (RED→GREEN).
 *
 * Defeito reproduzido (2026-09-12): `client-hub.resolveAuthHeaders` devolvia
 * `{ 'X-Client-Cert-Ref': secret }` para `authType: 'mtls'` e `AUTH_MODES` listava
 * os seis modos como válidos — declarar "SUPPORTED" apenas porque o enum existe.
 * A busca por `X-Client-Cert-Ref|mtls` em `tests/**` retornava VAZIO: nenhum teste
 * cobria o caminho, e por isso o mTLS falso sobreviveu a "22/22 invariantes MCP".
 */

const {
  AUTH_CAPABILITIES,
  AUTH_CAPABILITY_STATES,
  ALL_AUTH_MODES,
  isImplemented,
  evaluateAuthModeUse,
  buildAuthHeaders,
} = require('../../../src/core/mcp/auth-capabilities');

describe('M13–M18 verdade dos modos de autenticação MCP', () => {
  describe('M15 — mTLS NÃO pode ser declarado implementado', () => {
    it('mtls é UNSUPPORTED', () => {
      expect(AUTH_CAPABILITIES.mtls.state).toBe(AUTH_CAPABILITY_STATES.UNSUPPORTED);
      expect(isImplemented('mtls')).toBe(false);
    });

    it('a limitação é auditável e explica por que header não é mTLS', () => {
      expect(AUTH_CAPABILITIES.mtls.limitation).toMatch(/certificado de cliente/i);
      expect(AUTH_CAPABILITIES.mtls.limitation).toMatch(/X-Client-Cert-Ref/);
    });

    it('uso de mtls é recusado mesmo fora de PRODUCTION', () => {
      const result = evaluateAuthModeUse('mtls', { classification: 'DEVELOPMENT' });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/auth_mode_unsupported/);
    });

    it('buildAuthHeaders nunca emite header para mtls', () => {
      expect(() => buildAuthHeaders('mtls', 'segredo', { classification: 'DEVELOPMENT' }))
        .toThrow(/handshake TLS com certificado de cliente/);
    });

    it('o hub não contém mais ATRIBUIÇÃO do header de certificado falso', () => {
      const fs = require('fs');
      const path = require('path');
      const hubSource = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'core', 'mcp', 'client-hub.js'), 'utf8');
      // O nome pode aparecer em comentário explicativo; o que não pode existir é
      // o caminho que EMITE o header fingindo autenticar.
      expect(hubSource).not.toMatch(/X-Client-Cert-Ref'\s*:/);
      expect(hubSource).not.toMatch(/X-Client-Cert-Ref"\s*:/);
    });
  });

  describe('M16 — OAuth2 estático é PARTIAL, não IMPLEMENTED', () => {
    it('oauth2 é PARTIAL com limitação explícita', () => {
      expect(AUTH_CAPABILITIES.oauth2.state).toBe(AUTH_CAPABILITY_STATES.PARTIAL);
      expect(isImplemented('oauth2')).toBe(false);
      expect(AUTH_CAPABILITIES.oauth2.limitation).toMatch(/client_credentials/);
      expect(AUTH_CAPABILITIES.oauth2.limitation).toMatch(/expira/i);
    });

    it('o uso sinaliza partial=true para o consumidor não declarar conformidade plena', () => {
      const result = evaluateAuthModeUse('oauth2', { classification: 'PRODUCTION' });
      expect(result.ok).toBe(true);
      expect(result.partial).toBe(true);
      expect(result.state).toBe(AUTH_CAPABILITY_STATES.PARTIAL);
    });

    it('o transporte de oauth2 é bearer estático', () => {
      expect(buildAuthHeaders('oauth2', 'tok', { classification: 'PRODUCTION' })).toEqual({ Authorization: 'Bearer tok' });
    });
  });

  describe('M18 — no_auth', () => {
    it('é TEST_ONLY', () => {
      expect(AUTH_CAPABILITIES.no_auth.state).toBe(AUTH_CAPABILITY_STATES.TEST_ONLY);
    });

    it('proibido em PRODUCTION', () => {
      const result = evaluateAuthModeUse('no_auth', { classification: 'PRODUCTION', allowNoAuth: true });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/forbidden_in_production/);
    });

    it('fora de PRODUCTION exige opt-in explícito', () => {
      expect(evaluateAuthModeUse('no_auth', { classification: 'DEVELOPMENT' }).ok).toBe(false);
      expect(evaluateAuthModeUse('no_auth', { classification: 'DEVELOPMENT', allowNoAuth: true }).ok).toBe(true);
    });

    it('não emite header (com opt-in fora de PRODUCTION)', () => {
      expect(buildAuthHeaders('no_auth', null, { classification: 'DEVELOPMENT', allowNoAuth: true })).toEqual({});
    });

    it('sem opt-in o transporte é recusado', () => {
      expect(() => buildAuthHeaders('no_auth', null, { classification: 'DEVELOPMENT' })).toThrow(/auth_mode_requires_optin/);
      expect(() => buildAuthHeaders('no_auth', null, { classification: 'PRODUCTION', allowNoAuth: true })).toThrow(/forbidden_in_production/);
    });
  });

  describe('modos realmente implementados', () => {
    it.each(['bearer', 'api_key', 'service_principal'])('%s é IMPLEMENTED', (mode) => {
      expect(AUTH_CAPABILITIES[mode].state).toBe(AUTH_CAPABILITY_STATES.IMPLEMENTED);
      expect(isImplemented(mode)).toBe(true);
      expect(evaluateAuthModeUse(mode, { classification: 'PRODUCTION' }).partial).toBe(false);
    });

    it('api_key usa X-API-Key e bearer usa Authorization', () => {
      expect(buildAuthHeaders('api_key', 'k', { classification: 'PRODUCTION' })).toEqual({ 'X-API-Key': 'k' });
      expect(buildAuthHeaders('bearer', 't', { classification: 'PRODUCTION' })).toEqual({ Authorization: 'Bearer t' });
    });
  });

  describe('fail-closed', () => {
    it('modo desconhecido é recusado', () => {
      const result = evaluateAuthModeUse('magic', { classification: 'DEVELOPMENT' });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/auth_mode_unknown/);
    });

    it('buildAuthHeaders recusa modo desconhecido', () => {
      expect(() => buildAuthHeaders('magic', 'x')).toThrow(/auth_mode_unknown/);
    });

    it('a lista de modos vem da fonte de verdade', () => {
      expect(ALL_AUTH_MODES).toEqual(Object.keys(AUTH_CAPABILITIES));
      expect(ALL_AUTH_MODES.length).toBe(6);
    });
  });
});
