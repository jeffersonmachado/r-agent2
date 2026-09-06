/**
 * Labels operacionais (outcome-first) para tipos de insight do Workspace.
 * Tipos desconhecidos caem no tipo bruto — nunca escondem informação.
 */
const INSIGHT_TYPE_LABELS = {
  risk: 'Risco',
  churn: 'Risco de perda',
  delay: 'Atraso de resposta',
  upsell: 'Oportunidade',
  opportunity: 'Oportunidade',
  no_show: 'Falta em agendamento',
  qa_failure: 'Incidente',
};

export function formatInsightType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  return INSIGHT_TYPE_LABELS[normalized] || type || 'Sinal';
}
