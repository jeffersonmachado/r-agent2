const { handleSystemPipelineRoutes } = require('./system-generation/pipelineRoutes');
const { handleSystemSuggestDescriptionRoute } = require('./system-generation/suggestDescriptionRoute');
const { handleSystemGenerationContentRoutes } = require('./system-generation/contentRoutes');
const { handleSystemGenerationControlRoutes } = require('./system-generation/controlRoutes');

async function handleSystemGenerationRoutes(ctx) {
  const { pathname } = ctx;

  if (!pathname.startsWith('/system/')) {
    return false;
  }

  if (await handleSystemPipelineRoutes(ctx)) {
    return true;
  }

  if (await handleSystemSuggestDescriptionRoute(ctx)) {
    return true;
  }

  if (await handleSystemGenerationContentRoutes(ctx)) {
    return true;
  }

  if (await handleSystemGenerationControlRoutes(ctx)) {
    return true;
  }

  return false;
}

module.exports = { handleSystemGenerationRoutes };
