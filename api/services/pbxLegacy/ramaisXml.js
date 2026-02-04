/**
 * Parser/serializer pragmático do `ramal.xml`.
 *
 * Observação:
 * - O legado em C (`fontes.novo/src/ramal_xml.c`) usa libxml2 e assume `<ramal ...>` com campos filhos.
 * - Aqui mantemos um parser tolerante para migração gradual (sem dependências externas).
 */

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

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  return m ? normalizeWhitespace(m[1]) : null;
}

function extractRamalIdFromOpenTag(openTag) {
  // Prefer: ramal="1234"
  const m1 = openTag.match(/\bramal\s*=\s*"([^"]+)"/i);
  if (m1 && m1[1]) return normalizeWhitespace(m1[1]);
  // Fallback: first attribute value
  const m2 = openTag.match(/=\s*"([^"]+)"/);
  if (m2 && m2[1]) return normalizeWhitespace(m2[1]);
  return null;
}

/**
 * @param {string} xml
 * @returns {Array<Object>}
 */
function parseRamaisXml(xml) {
  const text = String(xml ?? '');
  const ramais = [];

  // Captura blocos <ramal ...> ... </ramal>
  const re = /<ramal\b([^>]*)>([\s\S]*?)<\/ramal>/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const openAttrs = match[1] || '';
    const body = match[2] || '';
    const id = extractRamalIdFromOpenTag(openAttrs);
    if (!id) continue;

    const r = {
      ramal: id,
      nome: extractTag(body, 'nome'),
      usuario: extractTag(body, 'usuario'),
      senha: extractTag(body, 'senha'),
      correio: extractTag(body, 'correio'),
      grupo: extractTag(body, 'grupo'),
      captura: extractTag(body, 'captura'),
      contexto: extractTag(body, 'contexto'),
      g729: extractTag(body, 'g729'),
      gsm: extractTag(body, 'gsm'),
      webfone: extractTag(body, 'webfone'),
      gravar: extractTag(body, 'gravar'),
      protocolo: extractTag(body, 'protocolo'),
      bloqueio: extractTag(body, 'bloqueio'),
      permissao: extractTag(body, 'permissao'),
      callerid: extractTag(body, 'callerid'),
      callerid2: extractTag(body, 'callerid2'),
      tipo: extractTag(body, 'tipo'),
      senhad: extractTag(body, 'senhad'),
      chamadas: extractTag(body, 'chamadas'),
      mac: extractTag(body, 'mac'),
      tempo: extractTag(body, 'tempo'),
    };
    ramais.push(r);
  }

  return ramais;
}

function buildRamalBlock(r) {
  const fields = [
    'nome','usuario','senha','correio','grupo','captura','contexto','g729','gsm','webfone','gravar',
    'protocolo','bloqueio','permissao','callerid','callerid2','tipo','senhad','chamadas','mac','tempo',
  ];

  const lines = [];
  lines.push(`  <ramal ramal="${escapeXml(r.ramal)}">`);
  for (const f of fields) {
    const v = r[f];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    lines.push(`    <${f}>${escapeXml(v)}</${f}>`);
  }
  lines.push('  </ramal>');
  return lines.join('\n');
}

/**
 * @param {Array<Object>} ramais
 */
function serializeRamaisXml(ramais) {
  const list = Array.isArray(ramais) ? ramais : [];
  const blocks = list
    .filter(r => r && r.ramal)
    .map(r => buildRamalBlock(r));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ramais>\n${blocks.join('\n')}\n</ramais>\n`;
}

module.exports = {
  parseRamaisXml,
  serializeRamaisXml,
};

