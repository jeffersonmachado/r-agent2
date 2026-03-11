export function escapeXml(value) {
  const text = String(value ?? '');
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function sanitizeBpmnId(value, fallback = 'id') {
  const raw = String(value ?? '').trim();
  const base = raw || fallback;
  const normalized = base
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '');

  if (!normalized) return fallback;
  if (/^[A-Za-z_]/.test(normalized)) return normalized;
  return `_${normalized}`;
}

export function buildXmlAttributes(attributes = {}) {
  const parts = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || typeof value === 'undefined') continue;
    parts.push(`${key}="${escapeXml(value)}"`);
  }
  return parts.join(' ');
}

export function openTag(tagName, attributes = {}) {
  const attrs = buildXmlAttributes(attributes);
  return attrs ? `<${tagName} ${attrs}>` : `<${tagName}>`;
}

export function closeTag(tagName) {
  return `</${tagName}>`;
}

export function selfClosingTag(tagName, attributes = {}) {
  const attrs = buildXmlAttributes(attributes);
  return attrs ? `<${tagName} ${attrs} />` : `<${tagName} />`;
}

export function textTag(tagName, text, attributes = {}) {
  return `${openTag(tagName, attributes)}${escapeXml(text)}${closeTag(tagName)}`;
}

export function indentLines(lines, level = 1, spacer = '  ') {
  const prefix = spacer.repeat(level);
  return lines.map((line) => `${prefix}${line}`);
}

export function buildExtensionElementsLines(payload, options = {}) {
  if (!payload || typeof payload !== 'object') return [];

  const prefix = String(options.prefix || 'ragent2').trim() || 'ragent2';
  const type = String(payload.type || 'unknown');
  const dataJson = JSON.stringify(payload.data || {});

  return [
    '<bpmn:extensionElements>',
    `  ${textTag(`${prefix}:metadata`, dataJson, { type })}`,
    '</bpmn:extensionElements>',
  ];
}
