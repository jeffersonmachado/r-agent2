function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeWhitespace(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function parseAttrs(openAttrs) {
  const out = {};
  const text = String(openAttrs || '');
  const re = /([a-zA-Z0-9_:\-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out[m[1]] = normalizeWhitespace(m[2]);
  }
  return out;
}

function firstAttrValue(attrs) {
  for (const k of Object.keys(attrs || {})) {
    if (attrs[k] != null && String(attrs[k]).trim() !== '') return String(attrs[k]).trim();
  }
  return null;
}

function parseChildTags(body) {
  const out = {};
  const text = String(body || '');
  // Tolerante: captura tags filhas simples <k>v</k>
  const re = /<([a-zA-Z0-9_:\-]+)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const k = String(m[1]);
    const v = normalizeWhitespace(m[2]);
    // mantém o último valor se repetido (legado raramente repete campos)
    out[k] = v;
  }
  return out;
}

function detectRootTag(xml) {
  const text = String(xml || '');
  // pula declaração XML e comentários iniciais
  const cleaned = text.replace(/^\s*<\?xml[\s\S]*?\?>/i, '').trim();
  const m = cleaned.match(/^<([a-zA-Z0-9_:\-]+)\b/);
  return m ? m[1] : null;
}

function detectItemTag(xml, rootTag) {
  const text = String(xml || '');
  const cleaned = text.replace(/^\s*<\?xml[\s\S]*?\?>/i, '');
  const re = /<([a-zA-Z0-9_:\-]+)\b[^>]*>/g;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const tag = m[1];
    if (!tag) continue;
    if (tag.startsWith('!')) continue;
    if (tag.toLowerCase() === (rootTag || '').toLowerCase()) continue;
    return tag;
  }
  return null;
}

function parseXmlItems({ xml, itemTag, keyAttr = null }) {
  const text = String(xml || '');
  const tag = String(itemTag || '').trim();
  if (!tag) return { items: [], usedItemTag: null, rootTag: detectRootTag(text) };

  const items = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    const attrs = parseAttrs(m[1] || '');
    const body = m[2] || '';
    const id = keyAttr && attrs[keyAttr] ? String(attrs[keyAttr]).trim() : firstAttrValue(attrs);
    if (!id) continue;
    const fields = parseChildTags(body);
    items.push({ id, _attrs: attrs, ...fields });
  }
  return { items, usedItemTag: tag, rootTag: detectRootTag(text) };
}

function serializeXmlItems({ rootTag, itemTag, items }) {
  const rTag = String(rootTag || '').trim() || `${String(itemTag || 'items')}s`;
  const iTag = String(itemTag || '').trim() || 'item';
  const list = Array.isArray(items) ? items : [];

  const blocks = list
    .filter((it) => it && (it.id || (it._attrs && firstAttrValue(it._attrs))))
    .map((it) => {
      const attrs = (it._attrs && typeof it._attrs === 'object') ? it._attrs : {};
      const hasAttrs = Object.keys(attrs).length > 0;
      const id = it.id ? String(it.id).trim() : firstAttrValue(attrs);
      const finalAttrs = hasAttrs ? attrs : (id ? { id } : {});
      const attrText = Object.entries(finalAttrs)
        .filter(([, v]) => v != null && String(v).trim() !== '')
        .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
        .join('');

      const childKeys = Object.keys(it)
        .filter((k) => k !== 'id' && k !== '_attrs' && k !== '_meta' && k !== '_itemTag' && k !== '_rootTag');

      const children = childKeys
        .map((k) => {
          const v = it[k];
          if (v == null) return null;
          const s = String(v).trim();
          if (!s) return null;
          return `    <${k}>${escapeXml(s)}</${k}>`;
        })
        .filter(Boolean)
        .join('\n');

      return children
        ? `  <${iTag}${attrText}>\n${children}\n  </${iTag}>`
        : `  <${iTag}${attrText}></${iTag}>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<${rTag}>\n${blocks}\n</${rTag}>\n`;
}

module.exports = {
  parseAttrs,
  detectRootTag,
  detectItemTag,
  parseXmlItems,
  serializeXmlItems,
};

