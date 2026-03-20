const { handlePhysicalStationQueueRoutes } = require('./physical-station/physicalStationQueueRoutes');
const { handlePhysicalStationServiceRoutes } = require('./physical-station/physicalStationServiceRoutes');
const { handlePhysicalStationSupportRoutes } = require('./physical-station/physicalStationSupportRoutes');

async function handlePhysicalStationRoutes(ctx) {
  const { pathname } = ctx;

  if (!pathname.startsWith('/physical/station/')) {
    return false;
  }

  if (await handlePhysicalStationQueueRoutes(ctx)) return true;
  if (await handlePhysicalStationServiceRoutes(ctx)) return true;
  if (await handlePhysicalStationSupportRoutes(ctx)) return true;

  return false;
}

module.exports = {
  handlePhysicalStationRoutes,
};
