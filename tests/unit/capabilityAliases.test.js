'use strict';

/**
 * Aliases legados de capabilities (GAP: limpeza semântica não destrutiva).
 *
 * Garante que nomes legados (`ticket.*`, `inbox.process`, `support.*` de
 * Customer Service) continuam resolvendo para os ids canônicos
 * (`case.manage`, `inbox.manage`) sem remover grants existentes, e que a
 * deprecação está registrada em config/canonical-capabilities.json.
 */

const { createCapabilityRegistry } = require('../../src/core/cognitive/capability-registry');

// eslint-disable-next-line global-require
const canonicalConfig = require('../../config/canonical-capabilities.json');

describe('canonical capability aliases (ticket.*/support.* legados)', () => {
  const registry = createCapabilityRegistry();

  it('aliases legados de ticket resolvem para case.manage', () => {
    expect(registry.resolveId('ticket.manage')).toBe('case.manage');
    expect(registry.resolveId('ticket.read')).toBe('case.manage');
    expect(registry.resolveId('ticket.create')).toBe('case.manage');
  });

  it('alias legado de inbox resolve para inbox.manage', () => {
    expect(registry.resolveId('inbox.process')).toBe('inbox.manage');
  });

  it('tool ids legados support.* de Customer Service resolvem para case.manage', () => {
    expect(registry.resolveId('support.createTicket')).toBe('case.manage');
    expect(registry.resolveId('support.transferConversation')).toBe('case.manage');
  });

  it('nomes canônicos resolvem diretamente (nos dois sentidos de lookup)', () => {
    expect(registry.resolveId('case.manage')).toBe('case.manage');
    expect(registry.resolveId('inbox.manage')).toBe('inbox.manage');
    expect(registry.has('case.manage')).toBe(true);
    expect(registry.has('ticket.manage')).toBe(true);
  });

  it('normalize colapsa aliases e canônicos no mesmo id', () => {
    expect(registry.normalize(['ticket.manage', 'case.manage', 'support.createTicket'])).toEqual(['case.manage']);
    expect(registry.normalize(['inbox.process', 'inbox.manage'])).toEqual(['inbox.manage']);
  });

  it('capabilities técnicas de suporte da plataforma permanecem intactas (support.diagnose)', () => {
    // 'support.*' é nomenclatura reservada ao suporte INTERNO da plataforma.
    expect(registry.resolveId('support.diagnose')).toBe('support.diagnose');
    const cap = registry.get('support.diagnose');
    expect(cap.kind).toBe('technical');
    expect(cap.visibility).toBe('SUPPORT');
  });

  it('deprecação registrada: deprecatedAliases aponta para canônicos e cobre os aliases legados', () => {
    const deprecated = canonicalConfig.deprecatedAliases;
    expect(deprecated).toBeTruthy();

    for (const legacy of ['ticket.manage', 'ticket.read', 'ticket.create', 'inbox.process', 'support.createTicket', 'support.transferConversation']) {
      expect(deprecated[legacy]).toBeTruthy();
      expect(deprecated[legacy].canonical).toBeTruthy();
      // O registro de deprecação deve ser consistente com a tabela de aliases viva
      expect(canonicalConfig.aliases[legacy]).toBe(deprecated[legacy].canonical);
      expect(registry.resolveId(legacy)).toBe(deprecated[legacy].canonical);
    }
  });

  it('grants legados não foram removidos: aliases continuam na tabela viva', () => {
    for (const legacy of ['ticket.manage', 'ticket.read', 'ticket.create', 'inbox.process']) {
      expect(canonicalConfig.aliases[legacy]).toBeTruthy();
    }
  });
});
