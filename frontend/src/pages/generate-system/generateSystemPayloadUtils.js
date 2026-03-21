export function buildGenerateSystemPayload({
  name,
  description,
  bootstrap,
  executionMode,
  useRag,
  ragSources,
  useWebScraping,
  scrapingTargets,
  validateUrl,
  generateFlow,
  generateSeed,
  generateRpa,
  rpaMode,
  executeFullValidation,
  includeQuestions,
  questionsList,
}) {
  const payload = {
    name: String(name || '').trim(),
    description: String(description || '').trim(),
    bootstrap: bootstrap || false,
    executionMode,
    useRag: bootstrap ? false : useRag,
    ragSources: bootstrap ? [] : (useRag ? Object.keys(ragSources || {}).filter((k) => ragSources[k]) : []),
    useWebScraping,
    scrapingTargets: useWebScraping ? (scrapingTargets || []).filter((url) => validateUrl(url)) : [],
    generate: {
      flow: bootstrap ? true : generateFlow,
      seed: bootstrap ? true : generateSeed,
      rpa: bootstrap ? true : generateRpa,
    },
    rpaMode,
    executeFullValidation,
  };

  if (bootstrap || includeQuestions) {
    payload.includeQuestions = true;
    payload.questions = Array.isArray(questionsList) ? questionsList.slice(0, 50) : [];
  }

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) {
      delete payload[key];
    }
  });

  return payload;
}
