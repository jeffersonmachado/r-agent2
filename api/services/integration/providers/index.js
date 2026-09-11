'use strict';

/**
 * Registro dos providers de integração embutidos.
 *
 * Chamado no bootstrap da API (idempotente). Os testes registram o fake server
 * por conta própria — o runtime de produção nunca importa o fake.
 */

const { ensureProvider } = require('../integrationRegistry');
const evoProvider = require('./evo/evoProviderAdapter');

function registerBuiltinProviders() {
  ensureProvider(evoProvider);
  return { providers: ['evo'] };
}

module.exports = { registerBuiltinProviders, evoProvider };
