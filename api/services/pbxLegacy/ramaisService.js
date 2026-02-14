const { readXmlFile, writeXmlFile } = require('./xmlStore');
const { parseRamaisXml, serializeRamaisXml } = require('./ramaisXml');

const RAMAL_XML_FILE = 'ramal.xml';

function listRamais() {
  const xml = readXmlFile(RAMAL_XML_FILE);
  if (!xml) return [];
  return parseRamaisXml(xml);
}

function upsertRamal(payload) {
  const ramal = String(payload?.ramal || '').trim();
  if (!ramal) {
    const err = new Error('ramal_required');
    err.code = 'ramal_required';
    throw err;
  }

  const current = listRamais();
  const idx = current.findIndex(r => String(r.ramal) === ramal);
  const merged = {
    ...(idx >= 0 ? current[idx] : {}),
    ...payload,
    ramal,
  };

  const next = idx >= 0
    ? current.map((r, i) => (i === idx ? merged : r))
    : [...current, merged];

  const xmlOut = serializeRamaisXml(next);
  writeXmlFile(RAMAL_XML_FILE, xmlOut);

  return merged;
}

module.exports = {
  listRamais,
  upsertRamal,
};

