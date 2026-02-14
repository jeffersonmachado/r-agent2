import logger from './logger';

function isDev() {
  try {
    return !!import.meta.env.DEV;
  } catch {
    return false;
  }
}

function formatMessage(title, description, details) {
  const lines = [];
  if (title) lines.push(String(title).trim());
  if (description) lines.push(String(description).trim());
  // Só promete detalhes no console quando realmente vamos logar (dev).
  if (details && isDev()) lines.push('Ver detalhes no console.');
  return lines.filter(Boolean).join('\n');
}

function logDetails(level, title, details) {
  if (!details) return;
  if (!isDev()) return;
  try {
    // Log detalhado apenas em dev
    // eslint-disable-next-line no-console
    const groupTitle = `[Toast] ${title}`;
    // Deixa o log mais fácil de encontrar no console.
    // eslint-disable-next-line no-console
    if (typeof console.groupCollapsed === 'function') console.groupCollapsed(groupTitle);
    // eslint-disable-next-line no-console
    console[level](details);
    // eslint-disable-next-line no-console
    if (typeof console.groupEnd === 'function') console.groupEnd();
  } catch {
    // ignora
  }
}

/**
 * @param {(message: any, type?: 'success'|'error'|'warning'|'info', duration?: number) => any} showToast
 * @param {string} title
 * @param {string} [description]
 * @param {any} [details]
 */
export function toastError(showToast, title, description = '', details = null) {
  const msg = formatMessage(title, description, details);
  logDetails('error', title, details);
  logger.error(`Toast error: ${title}`, { description, details });
  if (typeof showToast === 'function') showToast(msg, 'error', 10000);
}

export function toastWarn(showToast, title, description = '', details = null) {
  const msg = formatMessage(title, description, details);
  logDetails('warn', title, details);
  logger.warn(`Toast warning: ${title}`, { description, details });
  if (typeof showToast === 'function') showToast(msg, 'warning', 8000);
}

export function toastSuccess(showToast, title, description = '') {
  const msg = formatMessage(title, description, null);
  logger.info(`Toast success: ${title}`, { description });
  if (typeof showToast === 'function') showToast(msg, 'success', 6000);
}

