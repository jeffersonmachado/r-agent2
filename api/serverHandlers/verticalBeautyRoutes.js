'use strict';

const { handleBeautyCustomerRoutes } = require('./vertical-beauty/beautyCustomerRoutes');
const { handleBeautyLifecycleRoutes } = require('./vertical-beauty/beautyLifecycleRoutes');
const { handleBeautyInsightsRoutes } = require('./vertical-beauty/beautyInsightsRoutes');

async function handleBeautyRoutes(ctx) {
  const { pathname } = ctx;

  if (!pathname.startsWith('/api/beauty')) {
    return false;
  }

  if (await handleBeautyCustomerRoutes(ctx)) return true;
  if (await handleBeautyLifecycleRoutes(ctx)) return true;
  if (await handleBeautyInsightsRoutes(ctx)) return true;

  return false;
}

module.exports = { handleBeautyRoutes };
