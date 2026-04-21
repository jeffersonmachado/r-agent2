export function getExtractedText(doc) {
  if (!doc) return '';
  const meta = doc.metadata || {};
  const candidate =
    meta.extractedContent ??
    meta.extractedText ??
    meta.extracted_text ??
    meta.textoExtraido ??
    meta.texto_extraido;
  if (typeof candidate !== 'string') return '';
  const trimmed = candidate.trim();
  return trimmed ? trimmed : '';
}

export function getDetailsText(doc) {
  const extracted = getExtractedText(doc);
  if (extracted) return extracted;
  if (!doc || typeof doc.content !== 'string') return '';
  const trimmed = doc.content.trim();
  return trimmed ? trimmed : '';
}

export function formatDateTime(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString('pt-BR');
}

export function formatDateOnly(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString('pt-BR');
}