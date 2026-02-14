const crypto = require('crypto');

function extractTag(block, tagName) {
  const tag = String(tagName || '').trim();
  if (!tag) return null;
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = String(block || '').match(re);
  return m ? String(m[1] || '').trim() : null;
}

function parseXmlBlocks(xml, itemTag, opts = {}) {
  const tag = String(itemTag || '').trim();
  if (!tag) return [];
  const maxBlocks = Number.isFinite(opts.maxBlocks) ? opts.maxBlocks : 5000;
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const text = String(xml || '');
  const blocks = [];
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(text))) {
    blocks.push(m[0]);
    if (blocks.length >= maxBlocks) break;
  }
  return blocks;
}

function normalizeName(raw, fallbackPrefix) {
  const s = String(raw || '').trim();
  if (s) return s;
  return `${fallbackPrefix || 'item'}_${crypto.randomUUID()}`;
}

module.exports = {
  extractTag,
  parseXmlBlocks,
  normalizeName,
};

