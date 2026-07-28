/**
 * Entidades XML de referência do PBX legado (Ripabx / r-pbx).
 *
 * Schemas fiéis aos parsers em C do legado (`fontes.novo/src/{entidade}_xml.c`):
 * cada entidade é um arquivo `${entidade}.xml` no diretório `dados/xml` do
 * legado, com blocos repetidos `<itemTag idAttr="...">` e campos filhos
 * (`<campo>valor</campo>`). O parser é tolerante: preserva atributos e campos
 * desconhecidos para migração gradual, no mesmo espírito de `ramaisXml.js`.
 */

const { readXmlFile, writeXmlFile } = require('./xmlStore');

const ENTITIES = {
  ddr: { file: 'ddr.xml', itemTag: 'ramal', idAttr: 'num', fields: ['origem', 'operadora'] },
  grupo: { file: 'grupo.xml', itemTag: 'numero', idAttr: 'num', fields: ['nome'] },
  desvio: { file: 'desvio.xml', itemTag: 'ramal', idAttr: 'num', fields: ['destino'] },
  transbordo: { file: 'transbordo.xml', itemTag: 'id', idAttr: 'num', fields: ['ramal', 'destino'] },
  bloqueio: { file: 'bloqueio.xml', itemTag: 'ramal', idAttr: 'num', fields: ['destino'] },
  retorno: { file: 'retorno.xml', itemTag: 'ramal', idAttr: 'num', fields: ['origem', 'destino'] },
  recusa: { file: 'recusa.xml', itemTag: 'telefone', idAttr: 'num', fields: ['tipo', 'numero'] },
  feriado: { file: 'feriado.xml', itemTag: 'data', idAttr: 'dat', fields: ['nome'] },
  transferencia: {
    file: 'transferencia.xml',
    itemTag: 'ramal',
    idAttr: 'num',
    fields: [
      'destino',
      'segunda', 'segunda_inicio', 'segunda_fim',
      'terca', 'terca_inicio', 'terca_fim',
      'quarta', 'quarta_inicio', 'quarta_fim',
      'quinta', 'quinta_inicio', 'quinta_fim',
      'sexta', 'sexta_inicio', 'sexta_fim',
      'sabado', 'sabado_inicio', 'sabado_fim',
      'domingo', 'domingo_inicio', 'domingo_fim',
      'feriado', 'feriado_inicio', 'feriado_fim',
    ],
  },
};

function makeError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function listSupportedEntities() {
  return Object.keys(ENTITIES);
}

function getEntitySchema(entity) {
  const key = String(entity || '').trim();
  const schema = ENTITIES[key];
  if (!schema) {
    throw makeError('unknown_entity');
  }
  return schema;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(value) {
  return String(value ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseAttributes(openTag) {
  const attrs = {};
  const re = /([a-zA-Z0-9_:-]+)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = re.exec(openTag)) !== null) {
    attrs[match[1]] = unescapeXml(match[2]);
  }
  return attrs;
}

function parseFields(body) {
  const fields = {};
  const re = /<([a-zA-Z0-9_]+)>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    fields[match[1]] = unescapeXml(normalizeWhitespace(match[2]));
  }
  return fields;
}

function detectRootTag(xml) {
  const text = String(xml ?? '').replace(/<\?xml[^>]*\?>/, '');
  const match = text.match(/<([a-zA-Z0-9_]+)[\s>]/);
  return match ? match[1] : null;
}

/**
 * @param {string} xml
 * @param {{ itemTag: string, idAttr: string }} schema
 * @returns {Array<Object>} itens `{ id, ...campos, _attrs }`
 */
function parseEntityXml(xml, schema) {
  const text = String(xml ?? '');
  const items = [];
  const re = new RegExp(`<${schema.itemTag}\\b([^>]*)>([\\s\\S]*?)<\\/${schema.itemTag}>`, 'gi');
  let match;
  while ((match = re.exec(text)) !== null) {
    const attrs = parseAttributes(match[1] || '');
    const fields = parseFields(match[2] || '');
    const id = attrs[schema.idAttr]
      || attrs.id
      || Object.values(attrs)[0]
      || fields.id
      || null;
    if (!id) continue;
    items.push({ id: normalizeWhitespace(id), ...fields, _attrs: attrs });
  }
  return items;
}

function serializeEntityXml(items, schema, rootTag) {
  const root = rootTag || `${schema.itemTag}s`;
  const blocks = (Array.isArray(items) ? items : [])
    .filter((item) => item && item.id)
    .map((item) => {
      const extraAttrs = Object.entries(item._attrs || {})
        .filter(([key]) => key !== schema.idAttr)
        .map(([key, value]) => `${key}="${escapeXml(value)}"`);
      const attrText = [`${schema.idAttr}="${escapeXml(item.id)}"`, ...extraAttrs].join(' ');

      const fieldKeys = [
        ...schema.fields.filter((key) => item[key] !== undefined && item[key] !== null && String(item[key]).trim() !== ''),
        ...Object.keys(item).filter((key) => !['id', '_attrs', ...schema.fields].includes(key)
          && item[key] !== undefined && item[key] !== null && String(item[key]).trim() !== ''),
      ];
      const lines = fieldKeys.map((key) => `    <${key}>${escapeXml(item[key])}</${key}>`);
      return [`  <${schema.itemTag} ${attrText}>`, ...lines, `  </${schema.itemTag}>`].join('\n');
    });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${root}>\n${blocks.join('\n')}\n</${root}>\n`;
}

/**
 * @param {string} entity
 * @returns {{ entity: string, file: string, rootTag: string|null, itemTag: string, supported: string[], items: Array<Object> }}
 */
function listXmlEntities(entity) {
  const schema = getEntitySchema(entity);
  const xml = readXmlFile(schema.file);
  const items = xml ? parseEntityXml(xml, schema) : [];
  return {
    entity,
    file: schema.file,
    rootTag: xml ? detectRootTag(xml) : null,
    itemTag: schema.itemTag,
    supported: listSupportedEntities(),
    items,
  };
}

/**
 * @param {string} entity
 * @param {{ id: string }} payload
 */
function upsertXmlEntity(entity, payload) {
  const schema = getEntitySchema(entity);
  const id = String(payload?.id || '').trim();
  if (!id) {
    throw makeError('id_required');
  }

  const xml = readXmlFile(schema.file);
  const rootTag = xml ? detectRootTag(xml) : null;
  const current = xml ? parseEntityXml(xml, schema) : [];
  const idx = current.findIndex((item) => String(item.id) === id);

  const patch = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (key === 'id' || key === '_attrs') continue;
    patch[key] = value;
  }
  const merged = {
    ...(idx >= 0 ? current[idx] : {}),
    ...patch,
    id,
  };

  const next = idx >= 0
    ? current.map((item, i) => (i === idx ? merged : item))
    : [...current, merged];

  writeXmlFile(schema.file, serializeEntityXml(next, schema, rootTag));
  return merged;
}

/**
 * @param {string} entity
 * @param {string} id
 */
function removeXmlEntity(entity, id) {
  const schema = getEntitySchema(entity);
  const target = String(id || '').trim();
  if (!target) {
    throw makeError('id_required');
  }

  const xml = readXmlFile(schema.file);
  const rootTag = xml ? detectRootTag(xml) : null;
  const current = xml ? parseEntityXml(xml, schema) : [];
  const next = current.filter((item) => String(item.id) !== target);
  if (next.length === current.length) {
    throw makeError('not_found');
  }

  writeXmlFile(schema.file, serializeEntityXml(next, schema, rootTag));
  return { removed: target };
}

module.exports = {
  ENTITIES,
  listSupportedEntities,
  getEntitySchema,
  parseEntityXml,
  serializeEntityXml,
  listXmlEntities,
  upsertXmlEntity,
  removeXmlEntity,
};
