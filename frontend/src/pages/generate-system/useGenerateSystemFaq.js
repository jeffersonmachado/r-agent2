import {
  getDefaultQuestionGenerationRules,
  mergeUniqueQuestions,
  parseQuestionsFromText,
} from '../../utils/ragQuestionGenerator';

function clearFaqDerivedState({
  setFaqGroups,
  setFaqCoverage,
  setFaqCoverageMeta,
  setFaqExclusions,
  setShowFaqExclusions,
  setInitialFlow,
}) {
  setFaqGroups(null);
  setFaqCoverage(null);
  setFaqCoverageMeta(null);
  setFaqExclusions(null);
  setShowFaqExclusions(false);
  setInitialFlow(null);
}

/** @typedef {{agent: {tenantId?: string}|null, fetchJson: (path: string, options: Record<string, unknown>) => Promise<Record<string, unknown>>, pipelineExecutionIdRef: {current: string|null}, pipelineMachine: {start: Function}, pipelineSocket: {subscribe: Function}, uploadedFiles: Array<{name?: string}>, scrapingTargets: string[], validateUrl: (url: string) => boolean, name: string, description: string, executionMode: 'dry-run'|'real', useInlineChunksForSuggestRef: {current: boolean}, ephemeralChunksRef: {current: unknown[]}, questionGenerationRules: Record<string, unknown>, questionsText: string, questionsList: string[], setQuestionsText: (text: string) => void, setQuestionsList: (value: any) => void, setFaqGroups: Function, setFaqCoverage: Function, setFaqCoverageMeta: Function, setFaqExclusions: Function, setShowFaqExclusions: Function, setInitialFlow: Function, setError: (message: string) => void, showToast?: (message: string, type?: string) => void}} UseGenerateSystemFaqParams */

/** @typedef {{suggestQuestionsAutoList: () => Promise<string[]|undefined>, handleAddQuestionsFromText: () => void, handleSuggestQuestionsFromDescription: () => Promise<void>, handleRemoveQuestion: (index: number) => void}} UseGenerateSystemFaqReturn */

/**
 * @param {UseGenerateSystemFaqParams} params
 * @returns {UseGenerateSystemFaqReturn}
 */
export function useGenerateSystemFaq({
  agent,
  fetchJson,
  pipelineExecutionIdRef,
  pipelineMachine,
  pipelineSocket,
  uploadedFiles,
  scrapingTargets,
  validateUrl,
  name,
  description,
  executionMode,
  useInlineChunksForSuggestRef,
  ephemeralChunksRef,
  questionGenerationRules,
  questionsText,
  questionsList,
  setQuestionsText,
  setQuestionsList,
  setFaqGroups,
  setFaqCoverage,
  setFaqCoverageMeta,
  setFaqExclusions,
  setShowFaqExclusions,
  setInitialFlow,
  setError,
  showToast,
}) {
  const suggestQuestionsAutoList = async () => {
    const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
    const normalizeQuestionRules = (maybeRules) => {
      const defaults = getDefaultQuestionGenerationRules();
      if (!isPlainObject(maybeRules)) return defaults;
      if (!isPlainObject(maybeRules.titleBased)) return defaults;

      const merged = {
        titleBased: { ...defaults.titleBased, ...(isPlainObject(maybeRules.titleBased) ? maybeRules.titleBased : {}) },
        keywordPatterns: { ...defaults.keywordPatterns, ...(isPlainObject(maybeRules.keywordPatterns) ? maybeRules.keywordPatterns : {}) },
        domainCoverage: {
          ...defaults.domainCoverage,
          ...(isPlainObject(maybeRules.domainCoverage) ? maybeRules.domainCoverage : {}),
          entities: {
            ...defaults.domainCoverage.entities,
            ...(isPlainObject(maybeRules.domainCoverage?.entities) ? maybeRules.domainCoverage.entities : {}),
          },
          templates: {
            ...defaults.domainCoverage.templates,
            ...(isPlainObject(maybeRules.domainCoverage?.templates) ? maybeRules.domainCoverage.templates : {}),
          },
          triggers: {
            ...defaults.domainCoverage.triggers,
            ...(isPlainObject(maybeRules.domainCoverage?.triggers) ? maybeRules.domainCoverage.triggers : {}),
          },
        },
        contentBased: { ...defaults.contentBased, ...(isPlainObject(maybeRules.contentBased) ? maybeRules.contentBased : {}) },
        deduplication: { ...defaults.deduplication, ...(isPlainObject(maybeRules.deduplication) ? maybeRules.deduplication : {}) },
        limits: { ...defaults.limits, ...(isPlainObject(maybeRules.limits) ? maybeRules.limits : {}) },
      };

      const anyEnabled =
        merged.titleBased?.enabled ||
        merged.keywordPatterns?.enabled ||
        merged.domainCoverage?.enabled ||
        merged.contentBased?.enabled;
      return anyEnabled ? merged : defaults;
    };

    const rules = normalizeQuestionRules(questionGenerationRules);

    try {
      const tenantId = agent?.tenantId || null;
      if (tenantId) {
        if (!pipelineExecutionIdRef.current) {
          const id = `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          pipelineExecutionIdRef.current = id;
          pipelineMachine.start(id);
          pipelineSocket.subscribe(id);
        }

        const uploadedFileNames = Array.from(new Set(
          (Array.isArray(uploadedFiles) ? uploadedFiles : [])
            .map((file) => (typeof file?.name === 'string' ? file.name.trim() : ''))
            .filter(Boolean)
        ));
        const validUrls = (Array.isArray(scrapingTargets) ? scrapingTargets : []).filter((url) => validateUrl(url));

        const resp = await fetchJson('/system/generate-faq', {
          method: 'POST',
          body: JSON.stringify({
            name: name?.trim() || null,
            description: description?.trim() || null,
            tenantId,
            urls: validUrls.slice(0, 5),
            fileNames: uploadedFileNames.slice(0, 10),
            executionId: pipelineExecutionIdRef.current,
            pipelineStage: 'questionsGenerated',
            contextMode: executionMode === 'dry-run' ? 'ephemeral' : 'auto',
            ...(executionMode === 'dry-run' && useInlineChunksForSuggestRef.current
              ? { chunks: (ephemeralChunksRef.current || []).slice(0, 30).map((chunk) => ({ ...chunk, text: (chunk?.text || '').slice(0, 5000) })) }
              : {}),
            rules,
          }),
          timeoutMs: 60000,
          silent: true,
        });

        const faq = Array.isArray(resp?.faq)
          ? resp.faq
          : (Array.isArray(resp?.data?.faq) ? resp.data.faq : null);
        const coverage = (typeof resp?.coverage === 'number')
          ? resp.coverage
          : (typeof resp?.data?.coverage === 'number' ? resp.data.coverage : null);
        const exclusions = Array.isArray(resp?.exclusions)
          ? resp.exclusions
          : (Array.isArray(resp?.data?.exclusions) ? resp.data.exclusions : null);
        const flat = Array.isArray(resp?.flatQuestions)
          ? resp.flatQuestions
          : (Array.isArray(resp?.data?.flatQuestions) ? resp.data.flatQuestions : null);

        if (Array.isArray(faq) && faq.length > 0) {
          setFaqGroups(faq);
          setFaqCoverage(typeof coverage === 'number' ? coverage : null);
          setFaqCoverageMeta(
            resp?.meta && typeof resp.meta === 'object'
              ? resp.meta
              : (resp?.data?.meta && typeof resp.data.meta === 'object' ? resp.data.meta : null)
          );
          setFaqExclusions(Array.isArray(exclusions) && exclusions.length > 0 ? exclusions : null);
          setShowFaqExclusions(false);

          if (Array.isArray(flat) && flat.length > 0) return mergeUniqueQuestions([], flat, 50);

          const flattened = faq.flatMap((group) => (Array.isArray(group?.questions) ? group.questions : []));
          return mergeUniqueQuestions([], flattened, 50);
        }
      }
    } catch (error) {
      throw error;
    }
  };

  const handleAddQuestionsFromText = () => {
    const parsed = parseQuestionsFromText(questionsText);
    if (parsed.length === 0) return;

    setQuestionsList((prev) => mergeUniqueQuestions(prev, parsed, 50));
    setQuestionsText('');
    clearFaqDerivedState({
      setFaqGroups,
      setFaqCoverage,
      setFaqCoverageMeta,
      setFaqExclusions,
      setShowFaqExclusions,
      setInitialFlow,
    });
  };

  const handleSuggestQuestionsFromDescription = async () => {
    let suggested = null;
    try {
      suggested = await suggestQuestionsAutoList();
    } catch (error) {
      const msg = error?.message || 'Falha ao gerar perguntas automaticamente. Adicione ao menos 1 pergunta.';
      setError(msg);
      showToast?.(msg, 'error');
      return;
    }

    if (!suggested || suggested.length === 0) return;

    const hadExisting = Array.isArray(questionsList) && questionsList.length > 0;
    if (hadExisting) {
      clearFaqDerivedState({
        setFaqGroups,
        setFaqCoverage,
        setFaqCoverageMeta,
        setFaqExclusions,
        setShowFaqExclusions,
        setInitialFlow,
      });
    }

    setQuestionsList((prev) => mergeUniqueQuestions(hadExisting ? prev : [], suggested, 50));
  };

  const handleRemoveQuestion = (index) => {
    setQuestionsList((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    clearFaqDerivedState({
      setFaqGroups,
      setFaqCoverage,
      setFaqCoverageMeta,
      setFaqExclusions,
      setShowFaqExclusions,
      setInitialFlow,
    });
  };

  return {
    suggestQuestionsAutoList,
    handleAddQuestionsFromText,
    handleSuggestQuestionsFromDescription,
    handleRemoveQuestion,
  };
}