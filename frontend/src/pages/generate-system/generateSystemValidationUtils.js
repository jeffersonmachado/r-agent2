export function derivePreValidationStatus({
  name,
  description,
  generateRpa,
  bootstrap,
}) {
  if (String(name || '').trim() && String(description || '').trim()) {
    return {
      contract: 'valid',
      schema: 'valid',
      governance: 'valid',
      rpaPreValidation: generateRpa || bootstrap ? 'valid' : null,
    };
  }

  return {
    contract: null,
    schema: null,
    governance: null,
    rpaPreValidation: null,
  };
}

export function getGenerateSystemValidationError({
  isTenantMode,
  name,
  description,
  bootstrap,
  useRag,
  ragSources,
  useWebScraping,
  scrapingTargets,
  validationStatus,
  executionMode,
  validateUrl,
}) {
  const normalizedName = String(name || '').trim();
  const normalizedDescription = String(description || '').trim();

  if (!normalizedName || normalizedName.length < 3) {
    return 'O nome deve ter pelo menos 3 caracteres';
  }

  if (isTenantMode) {
    if (executionMode === 'real') {
      if (!normalizedDescription) {
        return 'A descricao do tenant e obrigatoria no modo execucao real';
      }
      if (normalizedDescription.length < 10) {
        return `A descricao do tenant deve ter pelo menos 10 caracteres (atual: ${normalizedDescription.length})`;
      }
    } else if (executionMode === 'dry-run' && normalizedDescription && normalizedDescription.length < 10) {
      return `A descricao do tenant deve ter pelo menos 10 caracteres (atual: ${normalizedDescription.length})`;
    }
  } else {
    if (executionMode === 'real') {
      if (!normalizedDescription || normalizedDescription.length < 10) {
        return 'A descricao deve ter pelo menos 10 caracteres (obrigatoria no modo execucao real)';
      }
    } else if (executionMode === 'dry-run' && normalizedDescription && normalizedDescription.length < 10) {
      return 'A descricao deve ter pelo menos 10 caracteres';
    }
  }

  if (bootstrap) {
    const validUrls = (scrapingTargets || []).filter((url) => validateUrl(url));
    if (validUrls.length === 0) {
      return 'No modo bootstrap, e necessario adicionar pelo menos uma URL valida para scraping';
    }
    return null;
  }

  if (!useRag && !useWebScraping) {
    return 'Selecione pelo menos uma fonte de conhecimento (RAG ou Web Scraping)';
  }

  if (useRag) {
    const hasRagSource = Object.values(ragSources || {}).some((v) => v === true);
    if (!hasRagSource) {
      return 'Selecione pelo menos uma fonte RAG (Fluxos, QA ou Documentos)';
    }
  }

  if (useWebScraping) {
    const validUrls = (scrapingTargets || []).filter((url) => validateUrl(url));
    if (validUrls.length === 0) {
      return 'Adicione pelo menos uma URL valida para Web Scraping';
    }
  }

  if (validationStatus?.contract === 'invalid') {
    return 'Validacao de contrato falhou';
  }
  if (validationStatus?.schema === 'invalid') {
    return 'Validacao de schema falhou';
  }
  if (validationStatus?.governance === 'invalid') {
    return 'Validacao de governanca falhou';
  }
  if (validationStatus?.rpaPreValidation === 'invalid') {
    return 'Validacao previa de RPA falhou';
  }

  return null;
}
