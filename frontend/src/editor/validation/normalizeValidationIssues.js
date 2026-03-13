export function normalizeValidationIssues(errors, options = {}) {
  const source = options.source || 'backend';
  const defaultSeverity = options.defaultSeverity || 'error';
  const input = Array.isArray(errors) ? errors : [];

  return input.map((error) => {
    const message = error?.message || error?.messageUi || 'Erro de validação';

    return {
      source: typeof error?.source === 'string' && error.source.trim() ? error.source : source,
      code: error?.code || 'VALIDATION_ERROR',
      message,
      messageUi: error?.messageUi || message,
      severity: error?.severity || defaultSeverity,
      nodeIds: Array.isArray(error?.nodeIds) ? error.nodeIds : [],
      details: error?.details && typeof error.details === 'object' ? error.details : {},
    };
  });
}

export function buildValidationState(result, options = {}) {
  const issues = normalizeValidationIssues(result?.errors, options);

  return {
    ...(result && typeof result === 'object' ? result : {}),
    valid: result?.valid === true && issues.length === 0,
    errors: issues,
    uiErrors: issues,
  };
}

export function mergeValidationStates(...states) {
  const mergedIssues = [];
  const seen = new Set();
  let valid = true;
  let canonicalReport = null;
  let insights = null;

  states.filter(Boolean).forEach((state) => {
    if (state.valid === false) {
      valid = false;
    }
    if (!canonicalReport && state.canonicalReport) {
      canonicalReport = state.canonicalReport;
    }
    if (!insights && state.insights) {
      insights = state.insights;
    }

    const issues = Array.isArray(state.uiErrors)
      ? state.uiErrors
      : Array.isArray(state.errors)
        ? state.errors
        : [];

    issues.forEach((issue) => {
      const normalized = normalizeValidationIssues([issue])[0];
      const key = [
        normalized.source,
        normalized.code,
        normalized.message,
        normalized.severity,
        (normalized.nodeIds || []).join(','),
      ].join('|');
      if (seen.has(key)) return;
      seen.add(key);
      mergedIssues.push(normalized);
      if (String(normalized.severity || '').toLowerCase() === 'error') {
        valid = false;
      }
    });
  });

  return {
    valid,
    errors: mergedIssues,
    uiErrors: mergedIssues,
    canonicalReport,
    insights,
  };
}
