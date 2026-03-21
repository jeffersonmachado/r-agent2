import { useCallback } from 'react';
import { buildGenerateSystemPayload } from './generateSystemPayloadUtils';

export const useGenerateSystemPayloadBuilder = ({
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
}) => {
  return useCallback(() => {
    return buildGenerateSystemPayload({
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
    });
  }, [
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
  ]);
};
