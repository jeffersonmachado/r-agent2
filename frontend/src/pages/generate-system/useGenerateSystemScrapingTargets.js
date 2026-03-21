/**
 * @param {{scrapingTargets: Array<string>, setScrapingTargets: Function}} params
 * @returns {{addScrapingTarget: Function, removeScrapingTarget: Function, updateScrapingTarget: Function}}
 */
export function useGenerateSystemScrapingTargets({ scrapingTargets, setScrapingTargets }) {
  const addScrapingTarget = () => {
    setScrapingTargets([...scrapingTargets, '']);
  };

  const removeScrapingTarget = (index) => {
    setScrapingTargets(scrapingTargets.filter((_, i) => i !== index));
  };

  const updateScrapingTarget = (index, value) => {
    const newTargets = [...scrapingTargets];
    newTargets[index] = value;
    setScrapingTargets(newTargets);
  };

  return {
    addScrapingTarget,
    removeScrapingTarget,
    updateScrapingTarget,
  };
}