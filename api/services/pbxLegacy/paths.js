const path = require('path');
const config = require('../../utils/config');

function getLegacyRoot() {
  const legacyRoot = config.get('pbx.legacy.root', process.env.PBX_LEGACY_ROOT || '').trim();
  return legacyRoot || null;
}

function resolveFromRoot(root, relativePath) {
  if (!root) return null;
  return path.join(root, relativePath);
}

function getXmlDir() {
  const root = getLegacyRoot();
  const configured = config.get('pbx.legacy.xmlDir', process.env.PBX_LEGACY_XML_DIR || '').trim();
  if (configured) return configured;
  return resolveFromRoot(root, 'dados/xml');
}

function getBinDir() {
  const root = getLegacyRoot();
  const configured = config.get('pbx.legacy.binDir', process.env.PBX_LEGACY_BIN_DIR || '').trim();
  if (configured) return configured;
  return resolveFromRoot(root, 'bin');
}

function getCgiDir() {
  const root = getLegacyRoot();
  const configured = config.get('pbx.legacy.cgiDir', process.env.PBX_LEGACY_CGI_DIR || '').trim();
  if (configured) return configured;
  return resolveFromRoot(root, 'cgi-bin');
}

function getAsteriskConfigDir() {
  const root = getLegacyRoot();
  const configured = config.get('pbx.legacy.asteriskConfigDir', process.env.PBX_LEGACY_AST_DIR || '').trim();
  if (configured) return configured;
  return resolveFromRoot(root, 'etc/asterisk');
}

module.exports = {
  getLegacyRoot,
  getXmlDir,
  getBinDir,
  getCgiDir,
  getAsteriskConfigDir,
};

