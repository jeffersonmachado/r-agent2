export const getGenerateSystemDescriptionSuggestionMeta = (suggestionResponse) => {
  const warnings = Array.isArray(suggestionResponse?.warnings) ? suggestionResponse.warnings : [];
  const fallback = warnings.some((warning) => String(warning?.code || '') === 'NO_INDEXED_CONTEXT_FALLBACK');
  const confidence =
    (typeof suggestionResponse?.confidence === 'number')
      ? suggestionResponse.confidence
      : (typeof suggestionResponse?.entityProfile?.confidence === 'number' ? suggestionResponse.entityProfile.confidence : null);
  const mode = suggestionResponse?.mode === 'technical' ? 'technical' : 'institutional';

  return { mode, fallback, confidence, warningsCount: warnings.length };
};
