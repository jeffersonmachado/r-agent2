import { validateCanonicalProcess } from '../process-canonical/canonicalValidator';

export function canonicalReviewAssistant(canonicalProcessDefinition) {
  const validation = validateCanonicalProcess(canonicalProcessDefinition);

  const highlights = [];
  if (validation.errors.length > 0) {
    highlights.push('Critical semantic errors detected.');
  }
  if (validation.warnings.length > 0) {
    highlights.push('Warnings indicate possible runtime risk.');
  }
  if (validation.suggestions.length > 0) {
    highlights.push('Optimization suggestions available.');
  }

  return {
    reviewSummary: {
      valid: validation.valid,
      highlights,
    },
    validation,
  };
}

export default canonicalReviewAssistant;
