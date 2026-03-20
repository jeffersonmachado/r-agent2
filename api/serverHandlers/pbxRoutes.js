// Orquestrador PBX — delega para sub-handlers por subdomínio.
// O contrato externo (handlePbxRoutes) e a assinatura de contexto são preservados.

const { handlePbxLegacyRoutes } = require('./pbx/pbxLegacyRoutes');
const { handlePbxCoreRoutes } = require('./pbx/pbxCoreRoutes');
const { handlePbxContactCenterRoutes } = require('./pbx/pbxContactCenterRoutes');
const { handlePbxMediaRoutes } = require('./pbx/pbxMediaRoutes');

async function handlePbxRoutes(ctx) {
  const { pathname } = ctx;

  if (!pathname.startsWith('/api/pbx') && !pathname.startsWith('/api/cc')) {
    return false;
  }

  // A ordem importa: Legacy antes de Core (ambos iniciam com /api/pbx)
  // Media antes de Core para que /api/pbx/audio-assets* e /api/pbx/recordings*
  // sejam capturados antes do guard genérico de Core (/api/pbx).
  if (await handlePbxLegacyRoutes(ctx)) return true;
  if (await handlePbxMediaRoutes(ctx)) return true;
  if (await handlePbxCoreRoutes(ctx)) return true;
  if (await handlePbxContactCenterRoutes(ctx)) return true;

  return false;
}

module.exports = { handlePbxRoutes };
