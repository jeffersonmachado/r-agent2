const fs = require('fs');
const path = require('path');
const { getXmlDir } = require('./paths');

function ensureWithin(baseDir, targetPath) {
  const normalizedBase = path.normalize(baseDir);
  const normalizedTarget = path.normalize(targetPath);
  if (!normalizedTarget.startsWith(normalizedBase)) {
    const err = new Error('invalid_path_outside_base');
    err.code = 'invalid_path_outside_base';
    throw err;
  }
}

function getXmlFilePath(fileName) {
  const xmlDir = getXmlDir();
  if (!xmlDir) {
    const err = new Error('pbx_xml_dir_not_configured');
    err.code = 'pbx_xml_dir_not_configured';
    throw err;
  }
  const p = path.join(xmlDir, fileName);
  ensureWithin(xmlDir, p);
  return p;
}

function readXmlFile(fileName) {
  const p = getXmlFilePath(fileName);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

function writeXmlFile(fileName, content) {
  const p = getXmlFilePath(fileName);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return { path: p };
}

module.exports = {
  readXmlFile,
  writeXmlFile,
  getXmlFilePath,
};

