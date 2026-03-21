import { useEffect } from 'react';

const normalizeWs = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const formatEntityList = (items, max = 10) => {
  const normalized = (Array.isArray(items) ? items : [])
    .map((item) => normalizeWs(typeof item === 'string' ? item : (item?.name || item?.label || item?.title || '')))
    .filter(Boolean);
  const unique = Array.from(new Set(normalized.map((item) => item.toLowerCase())))
    .map((key) => normalized.find((item) => item.toLowerCase() === key));
  return unique.filter(Boolean).slice(0, max);
};

export const useGenerateSystemInitialFlowObjective = ({
  showInitialFlowModal,
  initialFlowEntities,
  tenantDescription,
  description,
  setInitialFlowObjectiveDraft,
}) => {
  useEffect(() => {
    if (!showInitialFlowModal) return;

    const entities = initialFlowEntities && typeof initialFlowEntities === 'object' ? initialFlowEntities : null;
    const services = formatEntityList(entities?.services, 10);
    const plans = formatEntityList(entities?.plans, 10);
    const prices = formatEntityList(entities?.prices, 8);
    const schedules = formatEntityList(entities?.schedules, 8);

    const objectiveLines = [];
    if (services.length) objectiveLines.push(`Serviços atendidos: ${services.join(', ')}`);
    if (plans.length) objectiveLines.push(`Planos: ${plans.join(', ')}`);
    if (prices.length) objectiveLines.push(`Preços/condições: ${prices.join(', ')}`);
    if (schedules.length) objectiveLines.push(`Horários: ${schedules.join(', ')}`);

    const objective =
      normalizeWs(objectiveLines.join('\n')) ||
      normalizeWs(tenantDescription) ||
      normalizeWs(description) ||
      '';

    setInitialFlowObjectiveDraft((prev) => (prev && prev.trim() ? prev : objective));
  }, [
    description,
    initialFlowEntities,
    setInitialFlowObjectiveDraft,
    showInitialFlowModal,
    tenantDescription,
  ]);
};
