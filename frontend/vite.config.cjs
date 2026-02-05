const { defineConfig } = require('vite');

module.exports = defineConfig(async (env) => {
  const mjsModule = await import('./vite.config.mjs');
  const config = mjsModule.default || mjsModule;
  if (typeof config === 'function') {
    return config(env);
  }
  return config;
});
