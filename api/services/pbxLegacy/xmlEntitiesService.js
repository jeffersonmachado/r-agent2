const { readXmlFile, writeXmlFile } = require('./xmlStore');
const { detectItemTag, detectRootTag, parseXmlItems, serializeXmlItems } = require('./genericXml');

const ENTITY_MAP = {
  // XML-based entities used by legacy UI (xml.php + server.php)
  ddr: { file: 'ddr.xml' },
  grupo: { file: 'grupo.xml' },
  desvio: { file: 'desvio.xml' },
  transbordo: { file: 'transbordo.xml' },
  bloqueio: { file: 'bloqueio.xml' },
  retorno: { file: 'retorno.xml' },
  recusa: { file: 'recusa.xml' },
  feriado: { file: 'feriado.xml' },
  transferencia: { file: 'transferencia.xml' },
  operadora: { file: 'operadora.xml' },
  rota_base: { file: 'rota_base.xml' },
  rota: { file: 'rota.xml' },
  tipo: { file: 'tipo.xml' },
  categoria: { file: 'categoria.xml' },
  fax: { file: 'fax.xml' },
  sala: { file: 'sala.xml' },
  interconexao: { file: 'interconexao.xml' },
  fila: { file: 'fila.xml' },
  motivo: { file: 'motivo.xml' },
  motivo1: { file: 'motivo1.xml' },
  // ramal.xml is handled by ramaisService (special parser/serializer)
};

function requireEntity(entity) {
  const key = String(entity || '').trim();
  if (!key) {
    const err = new Error('entity_required');
    err.code = 'entity_required';
    throw err;
  }
  const cfg = ENTITY_MAP[key];
  if (!cfg) {
    const err = new Error('entity_not_supported');
    err.code = 'entity_not_supported';
    err.details = { entity: key, supported: Object.keys(ENTITY_MAP).sort() };
    throw err;
  }
  return { key, ...cfg };
}

function listXmlEntity({ entity }) {
  const cfg = requireEntity(entity);
  const xml = readXmlFile(cfg.file);
  if (!xml) {
    // file missing => empty list but return metadata for UI
    const rootTag = `${cfg.key}s`;
    const itemTag = cfg.key;
    return { entity: cfg.key, file: cfg.file, rootTag, itemTag, count: 0, items: [] };
  }

  const rootTag = detectRootTag(xml) || `${cfg.key}s`;

  // Try itemTag == entity, fallback to auto-detect
  let itemTag = cfg.key;
  let parsed = parseXmlItems({ xml, itemTag });
  if (!parsed.items.length) {
    const detected = detectItemTag(xml, rootTag);
    if (detected) {
      itemTag = detected;
      parsed = parseXmlItems({ xml, itemTag });
    }
  }

  const items = (parsed.items || []).map((it) => ({ ...it, _rootTag: rootTag, _itemTag: itemTag }));
  return {
    entity: cfg.key,
    file: cfg.file,
    rootTag,
    itemTag,
    count: items.length,
    items,
  };
}

function upsertXmlEntity({ entity, payload }) {
  const cfg = requireEntity(entity);
  const p = payload && typeof payload === 'object' ? payload : {};

  const id = p.id ? String(p.id).trim() : null;
  if (!id) {
    const err = new Error('id_required');
    err.code = 'id_required';
    throw err;
  }

  const current = listXmlEntity({ entity: cfg.key });
  const items = Array.isArray(current.items) ? current.items : [];
  const idx = items.findIndex((it) => String(it.id) === id);

  const merged = {
    ...(idx >= 0 ? items[idx] : {}),
    ...p,
    id,
  };

  // Normalize attrs: allow client to send _attrs; otherwise keep existing.
  if (!merged._attrs || typeof merged._attrs !== 'object') {
    merged._attrs = (idx >= 0 && items[idx] && items[idx]._attrs) ? items[idx]._attrs : { id };
  }

  const next = idx >= 0
    ? items.map((it, i) => (i === idx ? merged : it))
    : [...items, merged];

  const xmlOut = serializeXmlItems({
    rootTag: current.rootTag,
    itemTag: current.itemTag,
    items: next,
  });
  writeXmlFile(cfg.file, xmlOut);
  return merged;
}

function deleteXmlEntity({ entity, id }) {
  const cfg = requireEntity(entity);
  const key = String(id || '').trim();
  if (!key) {
    const err = new Error('id_required');
    err.code = 'id_required';
    throw err;
  }
  const current = listXmlEntity({ entity: cfg.key });
  const items = Array.isArray(current.items) ? current.items : [];
  const before = items.length;
  const next = items.filter((it) => String(it.id) !== key);
  const after = next.length;
  if (after === before) return { ok: true, deleted: false, before, after };

  const xmlOut = serializeXmlItems({
    rootTag: current.rootTag,
    itemTag: current.itemTag,
    items: next,
  });
  writeXmlFile(cfg.file, xmlOut);
  return { ok: true, deleted: true, before, after };
}

module.exports = {
  listXmlEntity,
  upsertXmlEntity,
  deleteXmlEntity,
  supportedXmlEntities: Object.keys(ENTITY_MAP).sort(),
};

