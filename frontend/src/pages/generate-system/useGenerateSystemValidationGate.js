import { useMemo } from 'react';
import { getGenerateSystemValidationError } from './generateSystemValidationUtils';

export const useGenerateSystemValidationGate = ({
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
}) => {
  const getValidationError = useMemo(() => {
    return getGenerateSystemValidationError({
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
    });
  }, [
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
  ]);

  const isValid = useMemo(() => getValidationError === null, [getValidationError]);

  return { getValidationError, isValid };
};
