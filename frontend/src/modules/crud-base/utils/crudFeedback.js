export function resolveCrudErrorMessage(error, fallbackMessage = 'Nao foi possivel concluir a operacao') {
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error?.body?.message && String(error.body.message).trim()) return String(error.body.message).trim();
  if (error?.message && String(error.message).trim()) return String(error.message).trim();
  return fallbackMessage;
}

export function showCrudError(showToast, error, fallbackMessage = 'Nao foi possivel concluir a operacao') {
  const message = resolveCrudErrorMessage(error, fallbackMessage);
  if (typeof showToast === 'function') {
    showToast(message, 'error');
  }
  return message;
}

export function showCrudSuccess(showToast, message = 'Operacao concluida com sucesso') {
  if (typeof showToast === 'function') {
    showToast(message, 'success');
  }
  return message;
}
