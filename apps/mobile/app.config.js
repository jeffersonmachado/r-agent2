const fs = require('node:fs');
const path = require('node:path');

const baseConfig = require('./app.json');

module.exports = ({ config }) => {
  const resolved = { ...baseConfig.expo, ...config };
  const googleServicesPath = path.join(__dirname, 'google-services.json');

  if (fs.existsSync(googleServicesPath)) {
    resolved.android = {
      ...resolved.android,
      googleServicesFile: './google-services.json',
    };
  }

  return resolved;
};
