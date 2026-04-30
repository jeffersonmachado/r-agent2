export function normalizeContactName(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  if (text === 'Contato sem nome') return null;
  if (/^Contato\s+•{4}\d{4}$/u.test(text)) return null;
  if (/^Contato\s+\d{8,}$/u.test(text)) return null;

  return text;
}
