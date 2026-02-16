const { getLegacyInventory } = require('./inventory');
const { checkMariaDbHealth } = require('./mariadbClient');
const { listRamais, upsertRamal } = require('./ramaisService');
const { listXmlEntity, upsertXmlEntity, deleteXmlEntity, supportedXmlEntities } = require('./xmlEntitiesService');

async function getPbxHealth() {
  const inventory = await getLegacyInventory();
  const mariadb = await checkMariaDbHealth();
  return {
    configured: !!inventory?.configured,
    inventory: {
      configured: inventory?.configured || false,
      root: inventory?.root || null,
    },
    mariadb,
  };
}

module.exports = {
  getLegacyInventory,
  getPbxHealth,
  listRamais,
  upsertRamal,
  listXmlEntity,
  upsertXmlEntity,
  deleteXmlEntity,
  supportedXmlEntities,
};
