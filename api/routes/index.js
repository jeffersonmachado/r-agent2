'use strict';

const { handleOperationalOccRoutes } = require('./operationalOccRoutes');
const { handleOperationalSupportRoutes } = require('./operationalSupportRoutes');
const { handleCrmRoutes } = require('./crmRoutes');

function registerOperationalRoutes() {
  return {
    name: 'operational',
    handle: handleOperationalOccRoutes,
  };
}

function registerSupportRoutes() {
  return {
    name: 'support',
    handle: handleOperationalSupportRoutes,
  };
}

function registerWhatsappRoutes() {
  return {
    name: 'whatsapp',
    handle: null,
  };
}

function registerAdminRoutes() {
  return {
    name: 'admin',
    handle: null,
  };
}

function registerCrmRoutes() {
  return {
    name: 'crm',
    handle: handleCrmRoutes,
  };
}

function registerRouteLoaders() {
  return {
    operational: registerOperationalRoutes(),
    support: registerSupportRoutes(),
    whatsapp: registerWhatsappRoutes(),
    admin: registerAdminRoutes(),
    crm: registerCrmRoutes(),
  };
}

async function handleRegisteredRoutes({ groups, context }) {
  const orderedGroups = Array.isArray(groups) ? groups : Object.values(groups || {});
  for (const group of orderedGroups) {
    if (!group || typeof group.handle !== 'function') continue;
    const handled = await group.handle(context);
    if (handled) return true;
  }
  return false;
}

module.exports = {
  registerOperationalRoutes,
  registerSupportRoutes,
  registerWhatsappRoutes,
  registerAdminRoutes,
  registerCrmRoutes,
  registerRouteLoaders,
  handleRegisteredRoutes,
};
