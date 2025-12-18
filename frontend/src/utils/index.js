/**
 * Helpers genéricos de UI.
 */

/**
 * Formata uma data ISO em string legível.
 *
 * @param {string|Date|undefined|null} value
 * @returns {string}
 */
export function formatDateTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}


