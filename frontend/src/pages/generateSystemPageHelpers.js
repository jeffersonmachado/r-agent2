export function validateGenerateSystemUrl(url) {
  if (!url || url.trim() === '') return false;
  try {
    new URL(url.trim());
    return true;
  } catch {
    return false;
  }
}

export function buildGenerateSystemPayload({
  name,
  description,
  bootstrap,
  executionMode,
  useRag,
  ragSources,
  useWebScraping,
  scrapingTargets,
  generateFlow,
  generateSeed,
  generateRpa,
  rpaMode,
  executeFullValidation,
  includeQuestions,
  questionsList,
}) {
  const payload = {
    name: name.trim(),
    description: description.trim(),
    bootstrap: bootstrap || false,
    executionMode,
    useRag: bootstrap ? false : useRag,
    ragSources: bootstrap ? [] : (useRag ? Object.keys(ragSources).filter((key) => ragSources[key]) : []),
    useWebScraping,
    scrapingTargets: useWebScraping ? scrapingTargets.filter((url) => validateGenerateSystemUrl(url)) : [],
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

export function getInitialPipelineStatus() {
  return {
    providerValidated: false,
    ragValidated: false,
    webScraping: false,
    descriptionSuggested: false,
    questionsGenerated: false,
    filesInferred: false,
    payloadValid: false,
    contractValid: false,
    contextBuilt: false,
    ragContextBuilt: false,
    aiExecuted: false,
    flowGenerated: false,
    seedGenerated: false,
    rpaGenerated: false,
    rpaExecuted: false,
    approved: false,
  };
}

export function getInitialPipelineDetails() {
  return {
    providerValidated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    ragValidated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    webScraping: { status: 'pending', timestamp: null, message: null, progress: 0 },
    descriptionSuggested: { status: 'pending', timestamp: null, message: null, progress: 0, meta: null },
    questionsGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    filesInferred: { status: 'pending', timestamp: null, message: null, progress: 0 },
    payloadValid: { status: 'pending', timestamp: null, message: null, progress: 0 },
    contractValid: { status: 'pending', timestamp: null, message: null, progress: 0 },
    contextBuilt: { status: 'pending', timestamp: null, message: null, progress: 0 },
    ragContextBuilt: { status: 'pending', timestamp: null, message: null, progress: 0 },
    aiExecuted: { status: 'pending', timestamp: null, message: null, progress: 0 },
    flowGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    seedGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    rpaGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    rpaExecuted: { status: 'pending', timestamp: null, message: null, progress: 0 },
    approved: { status: 'pending', timestamp: null, message: null, progress: 0 },
  };
}

export function validateTenantModeExecution({ name, description, executionMode }) {
  if (!name || !name.trim() || name.trim().length < 3) {
    return 'Por favor, preencha o nome do tenant (mínimo 3 caracteres)';
  }

  if (executionMode === 'real') {
    if (!description || !description.trim() || description.trim().length < 10) {
      return 'Por favor, preencha a descrição do tenant (mínimo 10 caracteres) - obrigatória no modo execução real';
    }
    return null;
  }

  if (description.trim() && description.trim().length < 10) {
    return 'A descrição do tenant deve ter pelo menos 10 caracteres';
  }

  return null;
}

export function createPipelineExecutionId(now = Date.now(), random = Math.random()) {
  return `exec-${now}-${random.toString(16).slice(2)}`;
}

export function getPipelinePrereqErrorMessage(error) {
  return error?.body?.message || error?.message || 'Falha ao validar pré-requisitos do pipeline';
}

export function mergeExistingUploadedFileEvidence(ephemeralChunks, uploadedFiles) {
  const targetChunks = Array.isArray(ephemeralChunks) ? ephemeralChunks : [];
  const files = Array.isArray(uploadedFiles) ? uploadedFiles : [];
  const seen = new Set(targetChunks.map((chunk) => `${chunk?.sourceType || 'unknown'}|${chunk?.sourceId || ''}`));

  const existingFileChunks = files
    .filter((file) => file && file.status === 'success')
    .map((file) => ({
      sourceType: 'uploaded_file',
      sourceId: (typeof file?.name === 'string' && file.name.trim()) ? file.name.trim() : (file?.id || 'arquivo'),
      text: (typeof file?.extractedContent === 'string' ? file.extractedContent : '').trim(),
    }))
    .filter((chunk) => chunk.text && chunk.text.length >= 20)
    .slice(0, 30);

  for (const chunk of existingFileChunks) {
    const key = `${chunk.sourceType}|${chunk.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targetChunks.push({ ...chunk, text: chunk.text.slice(0, 5000) });
  }

  return targetChunks;
}
