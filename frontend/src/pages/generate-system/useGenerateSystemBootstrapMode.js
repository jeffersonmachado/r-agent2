import { useEffect } from 'react';

export const useGenerateSystemBootstrapMode = ({
  bootstrap,
  scrapingTargets,
  setGenerateFlow,
  setGenerateRpa,
  setGenerateSeed,
  setUseRag,
  setRagSources,
  setUseWebScraping,
  setScrapingTargets,
}) => {
  useEffect(() => {
    if (bootstrap) {
      setGenerateFlow(true);
      setGenerateRpa(true);
      setGenerateSeed(true);
      setUseRag(false);
      setRagSources({ flows: false, qa: false, docs: false });
      setUseWebScraping(true);
      if (scrapingTargets.length === 0 || scrapingTargets[0] === '') {
        setScrapingTargets(['']);
      }
      return;
    }

    // Quando bootstrap não está ativo, todas as opções do BLOCO 2 devem estar marcadas
    setUseRag(true);
    setRagSources({ flows: true, qa: true, docs: true });
    setUseWebScraping(true);
  }, [bootstrap]);
};
