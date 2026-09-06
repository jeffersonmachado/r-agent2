import React from 'react';

function formatCause(cause) {
  const sign = cause.direction === 'up' ? '+' : '';
  return `${cause.label || cause.metricKey} (${sign}${Math.round((cause.changeRatio || 0) * 100)}%)`;
}

/**
 * Analytics -> Decision Intelligence: ancora a camada "por que / o que fazer"
 * nos mesmos KPIs descritivos. Insights trazem causa provavel e projecao;
 * recomendacoes abertas sao acionaveis (apply executa a acao real).
 * Secao fail-soft: sem dados, nao renderiza nada.
 */
export function AnalyticsDecisionIntelligenceSection({
  insights = [],
  recommendations = [],
  applyingId = null,
  onApplyRecommendation,
}) {
  const topInsights = (insights || []).slice(0, 3);
  const topRecommendations = (recommendations || []).slice(0, 3);

  if (topInsights.length === 0 && topRecommendations.length === 0) return null;

  return (
    <section className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg mb-6">
      <h3 className="text-lg font-semibold text-text-primary mb-1">Inteligência decisória</h3>
      <p className="text-text-secondary text-sm" style={{ marginBottom: '12px' }}>
        O que os indicadores significam, por que mudaram e o que fazer agora.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h4 className="text-sm font-semibold text-text-primary mb-2">Insights com causa e projeção</h4>
          {topInsights.length === 0 ? (
            <p className="text-text-secondary text-sm">Nenhum insight aberto no período.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {topInsights.map((item) => (
                <li key={item.id || item.title} className="border border-border-default rounded-lg p-3">
                  <div className="font-medium text-text-primary">{item.title || item.type || 'Insight'}</div>
                  <div className="text-text-secondary">
                    impacto: {item.impact || '-'} | confiança: {item.confidence != null ? Number(item.confidence).toFixed(2) : '-'}
                  </div>
                  {Array.isArray(item.metadata?.probableCauses) && item.metadata.probableCauses.length > 0 ? (
                    <div className="text-text-secondary" style={{ marginTop: '4px' }}>
                      Possíveis causas: {item.metadata.probableCauses.map(formatCause).join(', ')}
                    </div>
                  ) : null}
                  {item.metadata?.projection ? (
                    <div className="text-text-secondary" style={{ marginTop: '4px' }}>
                      Projeção de fechamento: ~{item.metadata.projection.projectedValue} vs alvo {item.metadata.projection.targetValue}
                      ({item.metadata.projection.projectedStatus === 'will_meet' ? 'atinge a meta' : 'não atinge a meta'})
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h4 className="text-sm font-semibold text-text-primary mb-2">Recomendações acionáveis</h4>
          {topRecommendations.length === 0 ? (
            <p className="text-text-secondary text-sm">Nenhuma recomendação aberta.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {topRecommendations.map((item) => (
                <li key={item.id || item.title} className="border border-border-default rounded-lg p-3">
                  <div className="font-medium text-text-primary">{item.title}</div>
                  <div className="text-text-secondary">prioridade: {item.priority || '-'}</div>
                  {item.description ? (
                    <div className="text-text-secondary" style={{ marginTop: '4px' }}>{item.description}</div>
                  ) : null}
                  {item.id && onApplyRecommendation ? (
                    <div style={{ marginTop: '8px' }}>
                      <button
                        type="button"
                        className="workspace-action-button"
                        disabled={applyingId === item.id}
                        onClick={() => onApplyRecommendation(item)}
                      >
                        {applyingId === item.id ? 'Aplicando...' : 'Aplicar recomendação'}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
